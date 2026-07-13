import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { readCodexUsageSignal } from '../codex-rate-limits.js';
import { probeExecutable } from './probe.js';
import type { Env, HarnessAdapter, PluginUpgradeRequest, PluginUpgradeResult } from './types.js';

const EXIT_OK = 0;
const EXIT_ERROR = 1;

const ACCOUNT_POOL_REASON =
  'Codex support is currently limited to current-account usage signals; account-pool management and account switching remain unsupported.';
const STATUSLINE_REASON =
  'Codex exposes configurable built-in footer items, not a Claude Code-style external statusLine.command hook.';
const PLUGIN_DISTRIBUTION_REASON =
  'Codex installs cc-master through a local Codex marketplace/plugin registration and skill/hook delivery from that package.';
const MARKETPLACE_NAME = 'cc-master';
const PLUGIN_NAME = 'cc-master';
const PLUGIN_ID = `${MARKETPLACE_NAME}@${PLUGIN_NAME}`;

export const codexAdapter: HarnessAdapter = {
  id: 'codex',
  displayName: 'Codex',
  aliases: ['codex', 'openai-codex'],
  detect(env) {
    return !!(
      env.CODEX_HOME ||
      env.CODEX_SESSION_ID ||
      env.CODEX_THREAD_ID ||
      env.CODEX_SANDBOX ||
      env.CODEX_PROJECT_DIR
    );
  },
  inspectInstallation(env) {
    const cli = probeExecutable(env.CCM_CODEX_BIN || env.CODEX_BIN || 'codex', env);
    const configDir = codexConfigDir(env);
    const hasConfig = pathExists(configDir);
    const installed = cli.available || hasConfig;
    return {
      id: 'codex',
      displayName: 'Codex',
      installed,
      active: this.detect(env),
      reason: installed ? null : 'codex CLI not found and Codex config directory not present',
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
    const id = env.CODEX_SESSION_ID || env.CODEX_THREAD_ID || '';
    const source = env.CODEX_SESSION_ID
      ? 'env:CODEX_SESSION_ID'
      : env.CODEX_THREAD_ID
        ? 'env:CODEX_THREAD_ID'
        : 'none';
    return { id, source };
  },
  sessionStoreRoots(env) {
    return [path.join(codexConfigDir(env), 'sessions')];
  },
  usageSource: () => ({
    kind: 'app-server',
    pollable: true,
    // Codex exposes app-server rateLimits buckets rather than Claude's rolling subscription windows.
    quotaModel: 'primary-secondary',
  }),
  accountPoolLocation: () => null,
  readCurrentUsage(env) {
    const signal = readCodexUsageSignal(env)?.signal ?? null;
    return {
      signal,
      source: 'codex-app-server',
      unavailableReason: 'Codex app-server rateLimits 不可用',
    };
  },
  accountSwitchPreflight: () => ({ action: 'continue' }),
  async upgradePlugin(request) {
    return upgradeCodexPlugin(request);
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

function codexConfigDir(env: Env): string {
  return env.CODEX_HOME
    ? path.resolve(env.CODEX_HOME)
    : path.join(env.HOME || os.homedir(), '.codex');
}

async function upgradeCodexPlugin(req: PluginUpgradeRequest): Promise<PluginUpgradeResult> {
  if (req.to) {
    req.err(
      `upgrade(plugin): 注意——Codex adapter 当前注册的是本机已安装 cc-master 包，不按 release tag ${req.to} 拉取历史版本。需要指定版本时请先用 install.sh 安装该版本，再运行本命令刷新 Codex plugin。`,
    );
  }
  const pluginRoot = localPluginRoot(req.env);
  const marketplaceRoot = codexMarketplaceRoot(req.env, pluginRoot);
  if (req.dryRun) {
    req.out('── ccm upgrade plugin DRY-RUN（Codex plugin·不写文件）──');
    req.out('harness     : codex');
    req.out(`plugin_root : ${pluginRoot}`);
    req.out(`skills_root : ${path.join(pluginRoot, 'skills')}`);
    req.out(`marketplace : ${marketplaceRoot}`);
    req.out(`would       : register local Codex marketplace, install ${PLUGIN_ID}`);
    if (req.json) {
      req.out(
        req.jsonOk({
          component: 'plugin',
          harness: 'codex',
          dry_run: true,
          plugin_root: pluginRoot,
          marketplace_root: marketplaceRoot,
          plugin_id: PLUGIN_ID,
        }),
      );
    }
    return {
      component: 'plugin',
      harness: 'codex',
      action: 'dry_run',
      exitCode: EXIT_OK,
      plugin_root: pluginRoot,
      marketplaceRoot,
    };
  }

  const pluginInstall = installCodexPlugin(req.env, pluginRoot);
  if (!pluginInstall.ok) {
    const reason = pluginInstall.reason || 'Codex plugin install failed';
    req.err(`upgrade(plugin): ${reason}。请确认 cc-master manifest 与 Codex CLI 环境。`);
    if (req.json) {
      req.out(
        req.jsonOk({
          component: 'plugin',
          harness: 'codex',
          action: 'failed',
          reason,
          plugin_root: pluginRoot,
        }),
      );
    }
    return {
      component: 'plugin',
      harness: 'codex',
      action: 'failed',
      exitCode: EXIT_ERROR,
      reason,
      plugin_root: pluginRoot,
      marketplaceRoot: pluginInstall.marketplaceRoot,
      pluginInstalled: false,
    };
  }

  req.out(
    `✓ Codex cc-master plugin 已安装：${PLUGIN_ID}。重开 Codex session 后 skills/hooks 生效。`,
  );
  if (req.json) {
    req.out(
      req.jsonOk({
        component: 'plugin',
        harness: 'codex',
        action: 'updated',
        plugin_root: pluginRoot,
        marketplace_root: pluginInstall.marketplaceRoot,
        plugin_id: PLUGIN_ID,
        plugin_installed: true,
      }),
    );
  }
  return {
    component: 'plugin',
    harness: 'codex',
    action: 'updated',
    exitCode: EXIT_OK,
    plugin_root: pluginRoot,
    marketplaceRoot: pluginInstall.marketplaceRoot,
    pluginInstalled: true,
  };
}

function localPluginRoot(env: Env): string {
  if (env.CC_MASTER_PLUGIN_ROOT) return path.resolve(env.CC_MASTER_PLUGIN_ROOT);
  const base = localPluginBase(env);
  const perHarness = path.join(base, 'codex', 'cc-master');
  if (fs.existsSync(perHarness)) return perHarness;
  return path.join(base, 'cc-master');
}

function localPluginBase(env: Env): string {
  return env.CC_MASTER_PLUGIN_DIR
    ? path.resolve(env.CC_MASTER_PLUGIN_DIR)
    : path.join(env.HOME || os.homedir(), '.local', 'share', 'cc-master');
}

function codexMarketplaceRoot(env: Env, pluginRoot: string): string {
  const base = env.CC_MASTER_PLUGIN_ROOT
    ? path.dirname(path.resolve(pluginRoot))
    : localPluginBase(env);
  return path.join(base, 'codex-marketplace');
}

function installCodexPlugin(
  env: Env,
  pluginRoot: string,
): { ok: boolean; marketplaceRoot: string; reason?: string } {
  const marketplaceRoot = codexMarketplaceRoot(env, pluginRoot);
  const codex = codexBin(env);
  if (!codexCliAvailable(codex, env)) {
    return {
      ok: false,
      marketplaceRoot,
      reason: `Codex CLI not found: ${codex}`,
    };
  }

  if (!fs.existsSync(path.join(pluginRoot, '.codex-plugin', 'plugin.json'))) {
    return {
      ok: false,
      marketplaceRoot,
      reason: `Codex plugin manifest not found: ${path.join(pluginRoot, '.codex-plugin', 'plugin.json')}`,
    };
  }

  try {
    fs.rmSync(marketplaceRoot, { recursive: true, force: true });
    fs.mkdirSync(path.join(marketplaceRoot, '.agents', 'plugins'), { recursive: true });
    const linkDir = path.join(marketplaceRoot, 'plugins');
    const linkPath = path.join(linkDir, PLUGIN_NAME);
    fs.mkdirSync(linkDir, { recursive: true });
    fs.symlinkSync(pluginRoot, linkPath, 'dir');
    fs.writeFileSync(
      path.join(marketplaceRoot, '.agents', 'plugins', 'marketplace.json'),
      `${JSON.stringify(
        {
          name: MARKETPLACE_NAME,
          interface: { displayName: 'cc-master' },
          plugins: [
            {
              name: PLUGIN_NAME,
              source: { source: 'local', path: `./plugins/${PLUGIN_NAME}` },
              policy: { installation: 'AVAILABLE', authentication: 'ON_USE' },
              category: 'Developer Tools',
            },
          ],
        },
        null,
        2,
      )}\n`,
    );

    runCodex(codex, ['plugin', 'remove', PLUGIN_ID], env, { bestEffort: true });
    runCodex(codex, ['plugin', 'marketplace', 'remove', MARKETPLACE_NAME], env, {
      bestEffort: true,
    });
    runCodex(codex, ['plugin', 'marketplace', 'add', marketplaceRoot], env);
    runCodex(codex, ['plugin', 'add', PLUGIN_ID], env);
    const listed = runCodex(codex, ['plugin', 'list', '--json'], env);
    const parsed = JSON.parse(listed || '{}') as { installed?: Array<{ pluginId?: string }> };
    if (!parsed.installed?.some((p) => p.pluginId === PLUGIN_ID)) {
      return {
        ok: false,
        marketplaceRoot,
        reason: `Codex plugin registry did not report installed ${PLUGIN_ID}`,
      };
    }
    return { ok: true, marketplaceRoot };
  } catch (error) {
    return {
      ok: false,
      marketplaceRoot,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

function codexBin(env: Env): string {
  return env.CCM_CODEX_BIN || env.CODEX_BIN || 'codex';
}

function codexCliAvailable(codex: string, env: Env): boolean {
  try {
    execFileSync(codex, ['--version'], {
      env: childEnv(env),
      stdio: 'ignore',
      timeout: 15_000,
    });
    return true;
  } catch {
    return false;
  }
}

function runCodex(
  codex: string,
  args: string[],
  env: Env,
  options: { bestEffort?: boolean } = {},
): string {
  try {
    return execFileSync(codex, args, {
      env: childEnv(env),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', options.bestEffort ? 'ignore' : 'pipe'],
      timeout: 30_000,
    });
  } catch (error) {
    if (options.bestEffort) return '';
    if (error instanceof Error) throw error;
    throw new Error(String(error));
  }
}

function childEnv(env: Env): NodeJS.ProcessEnv {
  const merged: NodeJS.ProcessEnv = { ...process.env };
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) merged[key] = value;
  }
  return merged;
}
