import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { captureRuntimeEnvironment, localPluginBase as resolvePluginBase } from '@ccm/engine';
import { describeKimiUsageRefresh, readKimiUsageSignal } from '../kimi-usage.js';
import { probeExecutable } from './probe.js';
import type { Env, HarnessAdapter, PluginUpgradeRequest, PluginUpgradeResult } from './types.js';

const EXIT_OK = 0;
const EXIT_ERROR = 1;
const PLUGIN_NAME = 'cc-master';

const ACCOUNT_POOL_REASON =
  'kimi-code authenticates through a single managed OAuth login; ccm exposes no account pool or account switching for it.';
const STATUSLINE_REASON =
  'kimi-code has no Claude Code-style external statusLine.command hook; its /usage panel is TUI-internal.';
const PLUGIN_DISTRIBUTION_REASON =
  'kimi-code installs cc-master as a managed plugin under $KIMI_CODE_HOME/plugins/managed/cc-master registered in plugins/installed.json.';

export const kimiCodeAdapter: HarnessAdapter = {
  id: 'kimi-code',
  displayName: 'Kimi Code',
  aliases: ['kimi', 'kimi-code', 'kimicode', 'moonshot-kimi'],
  detect(env) {
    // kimi injects KIMI_CODE_HOME into its origin session and plugin hook subprocesses;
    // the cc-master launcher additionally sets CC_MASTER_HARNESS=kimi-code (resolved earlier).
    return !!env.KIMI_CODE_HOME;
  },
  inspectInstallation(env) {
    const cli = probeExecutable(env.CCM_KIMI_BIN || env.KIMI_BIN || 'kimi', env);
    const configDir = kimiHome(env);
    const hasConfig = pathExists(configDir);
    const installed = cli.available || hasConfig;
    return {
      id: 'kimi-code',
      displayName: 'Kimi Code',
      installed,
      active: this.detect(env),
      reason: installed
        ? null
        : 'kimi CLI not found and kimi-code home directory ($KIMI_CODE_HOME / ~/.kimi-code) not present',
      cli,
      configPaths: [configDir],
      surfaces: [],
      capabilities: {
        accountPool: this.accountPool,
        externalStatusline: this.externalStatusline,
        pluginDistribution: this.pluginDistribution,
      },
    };
  },
  session(env) {
    const id = env.KIMI_SESSION_ID || '';
    return { id, source: id ? 'env:KIMI_SESSION_ID' : 'none' };
  },
  sessionStoreRoots(env) {
    return [path.join(kimiHome(env), 'sessions')];
  },
  usageSource: () => ({
    // kimi's account quota is a rolling 5h/weekly model served by the managed /usages dashboard API.
    // Poll-on-demand against the stored OAuth token; freshness = stored-token validity (see readCurrentUsage).
    kind: 'dashboard-api',
    pollable: true,
    quotaModel: 'rolling-5h-7d',
  }),
  accountPoolLocation: () => null,
  readCurrentUsage(env) {
    // kimi exposes GET /coding/v1/usages (Bearer OAuth) → rolling 5h + weekly quota. The collector is
    // strictly read-only on the stored token — it never refreshes/rotates the credential file. When the
    // stored access_token is expired (kimi only refreshes it during an active session) or absent, the
    // read degrades to an honest `unavailable` reason instead of mutating credentials.
    const reading = readKimiUsageSignal(env);
    if (reading?.signal) {
      return { signal: reading.signal, source: reading.source, unavailableReason: '' };
    }
    // Signal unavailable → attach an actionable recovery hint (which kimi command self-refreshes the
    // token + how to re-query). ccm stays read-only on the credential; the hint is text only.
    const hint = describeKimiUsageRefresh(env);
    return {
      signal: null,
      source: 'unavailable',
      unavailableReason: hint.reason,
      refreshHint: hint,
    };
  },
  accountSwitchPreflight: () => ({
    action: 'noop',
    reason: ACCOUNT_POOL_REASON,
  }),
  async upgradePlugin(request) {
    return upgradeKimiPlugin(request);
  },
  accountPool: { supported: false, reason: ACCOUNT_POOL_REASON },
  externalStatusline: { supported: false, reason: STATUSLINE_REASON },
  pluginDistribution: { supported: true, reason: PLUGIN_DISTRIBUTION_REASON },
};

function pathExists(p: string): boolean {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

// kimi home resolution: $KIMI_CODE_HOME > ~/.kimi-code (kimi-code.md §9 resolveKimiHome).
function kimiHome(env: Env): string {
  if (env.KIMI_CODE_HOME) return path.resolve(env.KIMI_CODE_HOME);
  return path.join(env.HOME || os.homedir(), '.kimi-code');
}

// managed plugin dir kimi discovers cc-master from (kimi-code.md §4).
function kimiManagedPluginRoot(env: Env): string {
  return path.join(kimiHome(env), 'plugins', 'managed', PLUGIN_NAME);
}

// local install staging root (mirrors cursor localInstallPluginRoot): CC_MASTER_PLUGIN_ROOT >
//   <base>/kimi-code/cc-master (per-harness) > <base>/cc-master. base is host-neutral (contract).
function localInstallPluginRoot(env: Env): string {
  if (env.CC_MASTER_PLUGIN_ROOT) return path.resolve(env.CC_MASTER_PLUGIN_ROOT);
  const base = resolvePluginBase(captureRuntimeEnvironment({ env }));
  const perHarness = path.join(base, 'kimi-code', PLUGIN_NAME);
  if (fs.existsSync(perHarness)) return perHarness;
  return path.join(base, PLUGIN_NAME);
}

async function upgradeKimiPlugin(req: PluginUpgradeRequest): Promise<PluginUpgradeResult> {
  const target = kimiManagedPluginRoot(req.env);
  const source = localInstallPluginRoot(req.env);
  const registry = path.join(kimiHome(req.env), 'plugins', 'installed.json');

  if (req.to) {
    req.err(
      `upgrade(plugin): 注意——kimi-code adapter 当前从本机已安装包刷新 managed plugin，不按 release tag ${req.to} 拉取历史版本。需要指定版本时请先用 install.sh 安装该版本，再运行本命令。`,
    );
  }

  if (req.dryRun) {
    req.out('── ccm upgrade plugin DRY-RUN（kimi-code plugin·不写文件）──');
    req.out('harness     : kimi-code');
    req.out(`source      : ${source}`);
    req.out(`target      : ${target}`);
    req.out(`registry    : ${registry}`);
    req.out(
      'would       : copy local install → $KIMI_CODE_HOME/plugins/managed/cc-master + upsert installed.json',
    );
    if (req.json) {
      req.out(
        req.jsonOk({
          component: 'plugin',
          harness: 'kimi-code',
          dry_run: true,
          source,
          target,
        }),
      );
    }
    return {
      component: 'plugin',
      harness: 'kimi-code',
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
    return failed(req, source, target, reason);
  }
  if (!fs.existsSync(path.join(source, 'kimi.plugin.json'))) {
    const reason = `kimi-code plugin manifest not found: ${path.join(source, 'kimi.plugin.json')}`;
    req.err(`upgrade(plugin): ${reason}`);
    return failed(req, source, target, reason);
  }

  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.rmSync(target, { recursive: true, force: true });
    fs.cpSync(source, target, { recursive: true });
    upsertInstalledRegistry(registry, target);
    req.out(
      `✓ kimi-code cc-master plugin 已刷新：${target}。重开 kimi session 后 skills/hooks 生效。`,
    );
    if (req.json) {
      req.out(
        req.jsonOk({
          component: 'plugin',
          harness: 'kimi-code',
          action: 'updated',
          source,
          target,
          plugin_root: target,
        }),
      );
    }
    return {
      component: 'plugin',
      harness: 'kimi-code',
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
    return failed(req, source, target, reason);
  }
}

function failed(
  req: PluginUpgradeRequest,
  source: string,
  target: string,
  reason: string,
): PluginUpgradeResult {
  if (req.json) {
    req.out(
      req.jsonOk({
        component: 'plugin',
        harness: 'kimi-code',
        action: 'failed',
        reason,
        source,
        target,
      }),
    );
  }
  return {
    component: 'plugin',
    harness: 'kimi-code',
    action: 'failed',
    exitCode: EXIT_ERROR,
    reason,
    source,
    target,
    plugin_root: target,
  };
}

interface InstalledEntry {
  id: string;
  root: string;
  source: string;
  enabled: boolean;
  installedAt: string;
  updatedAt: string;
}

// Upsert the cc-master entry into $KIMI_CODE_HOME/plugins/installed.json (kimi-code.md §4 schema).
function upsertInstalledRegistry(registryPath: string, root: string): void {
  const now = new Date().toISOString();
  let doc: { version: number; plugins: InstalledEntry[] } = { version: 1, plugins: [] };
  try {
    const raw = fs.readFileSync(registryPath, 'utf8');
    const parsed = JSON.parse(raw) as { version?: number; plugins?: InstalledEntry[] };
    if (parsed && Array.isArray(parsed.plugins)) {
      doc = {
        version: typeof parsed.version === 'number' ? parsed.version : 1,
        plugins: parsed.plugins,
      };
    }
  } catch {
    // No existing registry (or unreadable) → start fresh.
  }
  const existing = doc.plugins.find((p) => p.id === PLUGIN_NAME);
  if (existing) {
    existing.root = root;
    existing.source = 'local-path';
    existing.enabled = true;
    existing.updatedAt = now;
  } else {
    doc.plugins.push({
      id: PLUGIN_NAME,
      root,
      source: 'local-path',
      enabled: true,
      installedAt: now,
      updatedAt: now,
    });
  }
  fs.mkdirSync(path.dirname(registryPath), { recursive: true });
  fs.writeFileSync(registryPath, `${JSON.stringify(doc, null, 2)}\n`);
}
