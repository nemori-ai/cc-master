import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  captureRuntimeEnvironment,
  hostConfig,
  pluginInstallRoot,
  localPluginBase as resolvePluginBase,
} from '@ccm/engine';
import {
  type CursorAgentQuotaReading,
  readCursorAgentQuotaFact,
  readCursorUsageSignal,
} from '../cursor-usage.js';
import type {
  InstallationDiscoveryFace,
  PluginProjectionFace,
  SessionObservationFace,
  UsageObservationFace,
} from './capability-model.js';
import { createUnprobedCursorAgentAdmission } from './cursor-agent-admission.js';
import { probeExecutable } from './probe.js';
import type {
  Env,
  HarnessCliProbe,
  HarnessSurfaceDescriptor,
  PluginUpgradeRequest,
  PluginUpgradeResult,
  SurfaceFact,
} from './types.js';

const EXIT_OK = 0;
const EXIT_ERROR = 1;

export const CURSOR_ACCOUNT_POOL_REASON =
  'Cursor has no ccm account-pool autoswitch; billing-period usage is single-login dashboard quota only.';
export const CURSOR_STATUSLINE_REASON =
  'Cursor has no Claude Code-style external statusLine.command hook; usage is read from the dashboard API.';
const PLUGIN_DISTRIBUTION_REASON =
  'Cursor installs cc-master as a local plugin under ~/.cursor/plugins/local/cc-master.';
const ACCOUNT_MUTATION_REASON =
  'Cursor account login/logout/session mutation is forbidden; ccm only observes the current identity.';
const ACCOUNT_AUTOSWITCH_REASON =
  'Cursor account-pool mutation and automatic account switching are unsupported.';
const HEADLESS_PLUGIN_REASON =
  'Cursor Agent headless CLI is a worker surface, not the Cursor IDE plugin distribution target.';

function detectCursor(env: Env): boolean {
  return !!(
    env.CURSOR_AGENT ||
    env.CURSOR_VERSION ||
    env.CURSOR_PROJECT_DIR ||
    env.CURSOR_CONVERSATION_ID
  );
}

export const cursorInstallationDiscovery: InstallationDiscoveryFace = {
  detect: detectCursor,
  discoverInstallation(env, opts) {
    const cli = probeExecutable(env.CCM_CURSOR_BIN || env.CURSOR_BIN || 'cursor', env);
    const pluginRoot = cursorPluginRoot(env);
    const configDir = cursorConfigDir(env);
    const hasPlugin = pathExists(pluginRoot);
    const hasConfig = pathExists(configDir);
    const installed = cli.available || hasPlugin || hasConfig;
    const headlessCli = probeExecutable(
      env.CCM_CURSOR_AGENT_BIN || env.CURSOR_AGENT_BIN || 'cursor-agent',
      env,
    );
    return {
      id: 'cursor',
      displayName: 'Cursor',
      installed,
      active: detectCursor(env),
      reason: installed
        ? null
        : 'cursor CLI not found and Cursor config/plugin directories not present',
      cli,
      configPaths: [configDir, pluginRoot],
      surfaces: cursorSurfaces({
        ideCli: cli,
        ideInstalled: installed,
        ideConfigPaths: [configDir, pluginRoot],
        headlessCli,
        env,
        probeHeadlessAuth: opts?.probeHeadlessAuth === true,
      }),
      capabilities: {
        accountPool: { supported: false, reason: CURSOR_ACCOUNT_POOL_REASON },
        externalStatusline: { supported: false, reason: CURSOR_STATUSLINE_REASON },
        pluginDistribution: { supported: true, reason: PLUGIN_DISTRIBUTION_REASON },
      },
    };
  },
};

export const cursorSessionObservation: SessionObservationFace = {
  observeSession(env) {
    if (env.CURSOR_CONVERSATION_ID) {
      return { id: env.CURSOR_CONVERSATION_ID, source: 'env:CURSOR_CONVERSATION_ID' };
    }
    if (env.CURSOR_AGENT) {
      return { id: env.CURSOR_AGENT, source: 'env:CURSOR_AGENT' };
    }
    return { id: '', source: 'none' };
  },
  sessionStoreRoots(env) {
    if (env.CCM_CURSOR_STATE_DB) return [path.dirname(path.resolve(env.CCM_CURSOR_STATE_DB))];
    return [path.join(cursorConfigDir(env), 'User', 'globalStorage')];
  },
};

export const cursorUsageObservation: UsageObservationFace = {
  source: () => ({
    kind: 'dashboard-api',
    pollable: true,
    quotaModel: 'billing-period',
  }),
  observeUsage({ env, surfaceId }) {
    if (surfaceId) {
      return surfaceId === 'cursor-agent-cli' || surfaceId === 'cursor-agent'
        ? readCursorSurfaceUsage('cursor-agent-cli', env)
        : readCursorSurfaceUsage('cursor-ide-plugin', env);
    }
    // Cursor's billing-period quota is one first-party subscription observed by either surface;
    // the only difference is where the accessToken is stored (cursor-agent → auth.json, IDE →
    // state.vscdb). A bare `--harness cursor` read must not hard-code the IDE surface: when only
    // the headless cursor-agent is logged in (worker hosts, or IDE token absent), that would report
    // `unavailable` even though the subscription usage is fully readable. Prefer the cursor-agent
    // surface (self-contained auth.json, the reliable machine reader) and fall back to the IDE
    // surface, returning the first surface that yields a live signal. Fail-open: neither → unavailable.
    const agent = readCursorSurfaceUsage('cursor-agent-cli', env);
    if (agent.signal) return agent;
    return readCursorSurfaceUsage('cursor-ide-plugin', env);
  },
};

export const cursorPluginProjection: PluginProjectionFace = {
  upgrade: upgradeCursorPlugin,
};

function readCursorSurfaceUsage(surfaceId: 'cursor-ide-plugin' | 'cursor-agent-cli', env: Env) {
  const reading = readCursorUsageSignal(env, surfaceId);
  if (!reading?.signal) {
    return {
      signal: null,
      source: 'unavailable',
      unavailableReason:
        surfaceId === 'cursor-agent-cli'
          ? 'Cursor Agent dashboard GetCurrentPeriodUsage 不可用（未登录 / token 失效 / API 变更）'
          : 'Cursor IDE dashboard GetCurrentPeriodUsage 不可用（未登录 / token 失效 / API 变更）',
    };
  }
  return {
    signal: reading.signal,
    source: reading.source,
    unavailableReason: 'Cursor dashboard GetCurrentPeriodUsage 不可用',
    authSource: reading.auth_source,
    quotaScopeFingerprint: reading.quota_scope_fingerprint,
  };
}

function cursorSurfaces(input: {
  ideCli: HarnessCliProbe;
  ideInstalled: boolean;
  ideConfigPaths: string[];
  headlessCli: HarnessCliProbe;
  env: Env;
  probeHeadlessAuth: boolean;
}): HarnessSurfaceDescriptor[] {
  const ideFacts = unprobedFacts();
  // headless（cursor-agent）认证态：opt-in 时经官方机读接口 `status --format json` 探测；
  //   否则维持轻量 unprobed（默认零 spawn）。
  const headlessAuth = input.probeHeadlessAuth
    ? probeCursorAgentAuthFact(input.headlessCli, input.env)
    : unprobedFacts().authentication;
  // headless quota：opt-in 且已认证时经 cursor-agent 自己的 accessToken 读 dashboard billing-period
  //   （与 machine-wide collector 同一只读源·pacing SSOT 分档）；否则 / 未认证 / 读不到 → unknown（fail-open·
  //   no-token 早返回不 spawn Worker）。有 quota 信号即让 admission 不再对可读额度 fail-closed 误拒。
  const headlessFacts: HarnessSurfaceDescriptor['facts'] = {
    authentication: headlessAuth,
    quota:
      input.probeHeadlessAuth && headlessAuth.state === 'available'
        ? probeCursorAgentQuotaFact(input.env)
        : unprobedFacts().quota,
  };
  return [
    {
      id: 'cursor-ide-plugin',
      displayName: 'Cursor IDE Agent plugin',
      kind: 'ide-plugin',
      installed: input.ideInstalled,
      available: input.ideInstalled,
      reason: input.ideInstalled ? null : 'Cursor IDE CLI/config/plugin directories not found',
      binary: input.ideCli,
      configPaths: input.ideConfigPaths,
      facts: ideFacts,
      admission: null,
      capabilities: {
        accountMutation: { state: 'forbidden', reason: ACCOUNT_MUTATION_REASON },
        accountAutoswitch: { state: 'unsupported', reason: ACCOUNT_AUTOSWITCH_REASON },
        pluginDistribution: { state: 'supported', reason: PLUGIN_DISTRIBUTION_REASON },
      },
    },
    {
      id: 'cursor-agent-cli',
      displayName: 'Cursor Agent headless CLI',
      kind: 'cli-headless',
      installed: input.headlessCli.available,
      available: input.headlessCli.available,
      reason: input.headlessCli.available ? null : 'cursor-agent executable not found',
      binary: input.headlessCli,
      configPaths: [],
      facts: headlessFacts,
      admission: createUnprobedCursorAgentAdmission(
        input.headlessCli,
        headlessFacts.authentication,
        headlessFacts.quota,
      ),
      capabilities: {
        accountMutation: { state: 'forbidden', reason: ACCOUNT_MUTATION_REASON },
        accountAutoswitch: { state: 'unsupported', reason: ACCOUNT_AUTOSWITCH_REASON },
        pluginDistribution: { state: 'unsupported', reason: HEADLESS_PLUGIN_REASON },
      },
    },
  ];
}

function unprobedFacts(): HarnessSurfaceDescriptor['facts'] {
  return {
    authentication: { state: 'unknown', source: 'not-probed' },
    quota: { state: 'unknown', source: 'not-probed' },
  };
}

// cursor-agent 认证态探测的可注入 runner（测试注入 mock；默认跑真实只读子进程）。
export type CursorStatusRunner = (binaryPath: string, env: Env) => { ok: boolean; stdout: string };

const CURSOR_STATUS_PROBE_TIMEOUT_MS = 3_000;

// 默认 runner：只读跑 `cursor-agent status --format json`（净化子进程 env·超时·失败即 ok=false）。
function runCursorStatusJson(binaryPath: string, env: Env): { ok: boolean; stdout: string } {
  try {
    const stdout = execFileSync(binaryPath, ['status', '--format', 'json'], {
      encoding: 'utf8',
      timeout: CURSOR_STATUS_PROBE_TIMEOUT_MS,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: cursorProbeChildEnv(env),
    });
    return { ok: true, stdout: String(stdout) };
  } catch {
    // 非零退出 / 超时 / spawn 失败：拿不到→ok=false（上游 fail-closed 判 unknown）。
    return { ok: false, stdout: '' };
  }
}

// 只转发 cursor-agent 定位配置所需的最小 env（不泄露任意/凭据 env 给子进程）。
function cursorProbeChildEnv(env: Env): NodeJS.ProcessEnv {
  const child: NodeJS.ProcessEnv = {
    PATH: env.PATH || process.env.PATH,
    HOME: env.HOME || os.homedir(),
    NO_OPEN_BROWSER: '1',
  };
  for (const key of ['XDG_CONFIG_HOME', 'APPDATA', 'LOCALAPPDATA']) {
    if (env[key]) child[key] = env[key];
  }
  return child;
}

// probeCursorAgentAuthFact — 由 cursor-agent 官方机读接口 `status --format json` 判定认证态。
//   fail-closed：仅在明确读到 `isAuthenticated: true`（兼容旧键 `authenticated`）时判 available（放行）；
//   明确未登录→unavailable（observed negative·如实报告、同样不放行）；进程失败 / 无法解析 / schema 变更
//   / 二进制不可用→unknown（拿不到就不猜、绝不据此放行）。绝不 grep 人类可读文案。
export function probeCursorAgentAuthFact(
  binary: HarnessCliProbe,
  env: Env,
  run: CursorStatusRunner = runCursorStatusJson,
): SurfaceFact {
  // 二进制不可用：未探测（保真·不 spawn）。
  if (!binary.available || !binary.path) return { state: 'unknown', source: 'not-probed' };
  const result = run(binary.path, env);
  if (!result.ok) return { state: 'unknown', source: 'cursor-agent:status-unavailable' };

  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    return { state: 'unknown', source: 'cursor-agent:status-unparseable' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { state: 'unknown', source: 'cursor-agent:status-schema-unknown' };
  }

  const record = parsed as Record<string, unknown>;
  const authenticated = record.isAuthenticated ?? record.authenticated;
  if (authenticated === true) return { state: 'available', source: 'cursor-agent:status-json' };
  if (authenticated === false) return { state: 'unavailable', source: 'cursor-agent:status-json' };
  // 布尔缺失 / 非布尔：schema 变更→unknown（不猜、绝不默认 authed）。
  return { state: 'unknown', source: 'cursor-agent:status-schema-unknown' };
}

// cursorQuotaReadingToSurfaceFact — 把 cursor-agent billing-period 额度分档映射成粗粒度 SurfaceFact（admission 用）。
//   ample/tight（本账单周期仍有余量）→ available（可调度·pacing 是 advisory·由 quota status 承载细档）；
//   exhausted（≥停机线）→ unavailable（本周期无余量·fail-closed）；读不到 → unknown（不猜、不据此放行）。
export function cursorQuotaReadingToSurfaceFact(fact: CursorAgentQuotaReading): SurfaceFact {
  if (fact.state === 'ample' || fact.state === 'tight') {
    return { state: 'available', source: `${fact.source}:${fact.state}` };
  }
  if (fact.state === 'exhausted') {
    return { state: 'unavailable', source: `${fact.source}:exhausted` };
  }
  return { state: 'unknown', source: fact.source };
}

// probeCursorAgentQuotaFact — 读 cursor-agent 自己的 accessToken → dashboard billing-period → 映射 SurfaceFact。
export function probeCursorAgentQuotaFact(env: Env): SurfaceFact {
  return cursorQuotaReadingToSurfaceFact(readCursorAgentQuotaFact(env));
}

function pathExists(p: string): boolean {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

// Cursor host config：darwin/Linux 收口进 RuntimeEnvironment/PathResolver 契约（Linux 现按 XDG_CONFIG_HOME
//   解析·host config 属外部 OS 约定·默认 <home>/.config/Cursor 不变）；win32（APPDATA）不在契约承诺内、留适配器。
function cursorConfigDir(env: Env): string {
  if (process.platform === 'win32') {
    const home = env.HOME || os.homedir();
    const appData = env.APPDATA || path.join(home, 'AppData', 'Roaming');
    return path.join(appData, 'Cursor');
  }
  return hostConfig(captureRuntimeEnvironment({ env }), 'cursor')[0] as string;
}

// Cursor host-native 插件根收口进契约（CC_MASTER_CURSOR_PLUGIN_ROOT > <home>/.cursor/plugins/local/cc-master）。
function cursorPluginRoot(env: Env): string {
  return pluginInstallRoot(captureRuntimeEnvironment({ env }), 'cursor');
}

function localInstallPluginRoot(env: Env): string {
  if (env.CC_MASTER_PLUGIN_ROOT) return path.resolve(env.CC_MASTER_PLUGIN_ROOT);
  // 基座收口进契约（CC_MASTER_PLUGIN_DIR > <home>/.local/share/cc-master·首轮不迁移 XDG_DATA_HOME）；
  //   per-harness `<base>/cursor/cc-master` 的 existsSync 精化留适配器。
  const base = resolvePluginBase(captureRuntimeEnvironment({ env }));
  const perHarness = path.join(base, 'cursor', 'cc-master');
  if (fs.existsSync(perHarness)) return perHarness;
  return path.join(base, 'cc-master');
}

async function upgradeCursorPlugin(req: PluginUpgradeRequest): Promise<PluginUpgradeResult> {
  const target = cursorPluginRoot(req.env);
  const source = localInstallPluginRoot(req.env);

  if (req.to) {
    req.err(
      `upgrade(plugin): 注意——Cursor adapter 当前从本机已安装包刷新 local plugin，不按 release tag ${req.to} 拉取历史版本。需要指定版本时请先用 install.sh 安装该版本，再运行本命令。`,
    );
  }

  if (req.dryRun) {
    req.out('── ccm upgrade plugin DRY-RUN（Cursor plugin·不写文件）──');
    req.out('harness     : cursor');
    req.out(`source      : ${source}`);
    req.out(`target      : ${target}`);
    req.out('would       : copy local install → ~/.cursor/plugins/local/cc-master');
    if (req.json) {
      req.out(
        req.jsonOk({
          component: 'plugin',
          harness: 'cursor',
          dry_run: true,
          source,
          target,
        }),
      );
    }
    return {
      component: 'plugin',
      harness: 'cursor',
      action: 'dry_run',
      exitCode: EXIT_OK,
      source,
      target,
      plugin_root: target,
    };
  }

  if (!fs.existsSync(source)) {
    const reason = `local cc-master install not found: ${source}`;
    req.err(`upgrade(plugin): ${reason}`);
    if (req.json) {
      req.out(
        req.jsonOk({
          component: 'plugin',
          harness: 'cursor',
          action: 'failed',
          reason,
          source,
          target,
        }),
      );
    }
    return {
      component: 'plugin',
      harness: 'cursor',
      action: 'failed',
      exitCode: EXIT_ERROR,
      reason,
      source,
      target,
      plugin_root: target,
    };
  }

  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.rmSync(target, { recursive: true, force: true });
    fs.cpSync(source, target, { recursive: true });
    req.out(`✓ Cursor cc-master plugin 已刷新：${target}。重开 Cursor Agent session 后生效。`);
    if (req.json) {
      req.out(
        req.jsonOk({
          component: 'plugin',
          harness: 'cursor',
          action: 'updated',
          source,
          target,
          plugin_root: target,
        }),
      );
    }
    return {
      component: 'plugin',
      harness: 'cursor',
      action: 'updated',
      exitCode: EXIT_OK,
      source,
      target,
      plugin_root: target,
      pluginInstalled: true,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    req.err(`upgrade(plugin): ${reason}`);
    if (req.json) {
      req.out(
        req.jsonOk({
          component: 'plugin',
          harness: 'cursor',
          action: 'failed',
          reason,
          source,
          target,
        }),
      );
    }
    return {
      component: 'plugin',
      harness: 'cursor',
      action: 'failed',
      exitCode: EXIT_ERROR,
      reason,
      source,
      target,
      plugin_root: target,
    };
  }
}
