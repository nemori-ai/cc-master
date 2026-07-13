import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  captureRuntimeEnvironment,
  hostConfig,
  pluginInstallRoot,
  localPluginBase as resolvePluginBase,
} from '@ccm/engine';
import { readCursorUsageSignal } from '../cursor-usage.js';
import { createUnprobedCursorAgentAdmission } from './cursor-agent-admission.js';
import { probeExecutable } from './probe.js';
import type {
  Env,
  HarnessAdapter,
  HarnessCliProbe,
  HarnessSurfaceDescriptor,
  PluginUpgradeRequest,
  PluginUpgradeResult,
} from './types.js';

const EXIT_OK = 0;
const EXIT_ERROR = 1;

const ACCOUNT_POOL_REASON =
  'Cursor has no ccm account-pool autoswitch; billing-period usage is single-login dashboard quota only.';
const STATUSLINE_REASON =
  'Cursor has no Claude Code-style external statusLine.command hook; usage is read from the dashboard API.';
const PLUGIN_DISTRIBUTION_REASON =
  'Cursor installs cc-master as a local plugin under ~/.cursor/plugins/local/cc-master.';
const ACCOUNT_MUTATION_REASON =
  'Cursor account login/logout/session mutation is forbidden; ccm only observes the current identity.';
const ACCOUNT_AUTOSWITCH_REASON =
  'Cursor account-pool mutation and automatic account switching are unsupported.';
const HEADLESS_PLUGIN_REASON =
  'Cursor Agent headless CLI is a worker surface, not the Cursor IDE plugin distribution target.';

export const cursorAdapter: HarnessAdapter = {
  id: 'cursor',
  displayName: 'Cursor',
  aliases: ['cursor', 'cursor-ide'],
  detect(env) {
    return !!(
      env.CURSOR_AGENT ||
      env.CURSOR_VERSION ||
      env.CURSOR_PROJECT_DIR ||
      env.CURSOR_CONVERSATION_ID
    );
  },
  inspectInstallation(env) {
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
      active: this.detect(env),
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
      }),
      capabilities: {
        accountPool: this.accountPool,
        externalStatusline: this.externalStatusline,
        pluginDistribution: this.pluginDistribution,
      },
    };
  },
  session(env) {
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
  usageSource: () => ({
    kind: 'dashboard-api',
    pollable: true,
    quotaModel: 'billing-period',
  }),
  accountPoolLocation: () => null,
  readCurrentUsage(env) {
    const reading = readCursorUsageSignal(env);
    if (!reading?.signal) {
      return {
        signal: null,
        source: 'unavailable',
        unavailableReason:
          'Cursor dashboard GetCurrentPeriodUsage 不可用（未登录 / token 失效 / API 变更）',
      };
    }
    return {
      signal: reading.signal,
      source: 'cursor-dashboard',
      unavailableReason: 'Cursor dashboard GetCurrentPeriodUsage 不可用',
    };
  },
  accountSwitchPreflight: () => ({
    action: 'noop',
    reason: ACCOUNT_POOL_REASON,
  }),
  async upgradePlugin(request) {
    return upgradeCursorPlugin(request);
  },
  accountPool: { supported: false, reason: ACCOUNT_POOL_REASON },
  externalStatusline: { supported: false, reason: STATUSLINE_REASON },
  pluginDistribution: { supported: true, reason: PLUGIN_DISTRIBUTION_REASON },
};

function cursorSurfaces(input: {
  ideCli: HarnessCliProbe;
  ideInstalled: boolean;
  ideConfigPaths: string[];
  headlessCli: HarnessCliProbe;
}): HarnessSurfaceDescriptor[] {
  const ideFacts = unprobedFacts();
  const headlessFacts = unprobedFacts();
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
      id: 'cursor-agent',
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
