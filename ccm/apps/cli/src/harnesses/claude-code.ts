import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import { resolveClaudeConfigDir, resolveRateCachePath, type UsageSignal } from '@ccm/engine';
import { probeExecutable } from './probe.js';
import type { Env, HarnessAdapter, PluginUpgradeRequest, PluginUpgradeResult } from './types.js';

const EXIT_OK = 0;
const EXIT_ERROR = 1;
const MARKETPLACE = 'cc-master';
const PLUGIN_REF = 'cc-master@cc-master';

export const claudeCodeAdapter: HarnessAdapter = {
  id: 'claude-code',
  displayName: 'Claude Code',
  aliases: ['claude', 'claude-code', 'claudecode'],
  detect(env) {
    return !!(
      env.CLAUDE_CODE_SESSION_ID ||
      env.CLAUDE_CONFIG_DIR ||
      env.CLAUDE_PROJECT_DIR ||
      env.CLAUDE_CODE_USE_BEDROCK ||
      env.CLAUDE_CODE_USE_VERTEX ||
      env.CLAUDE_CODE_USE_FOUNDRY
    );
  },
  inspectInstallation(env) {
    const cli = probeExecutable(env.CCM_CLAUDE_BIN || env.CLAUDE_BIN || 'claude', env);
    const configDir = resolveClaudeConfigDir(env);
    const hasConfig = pathExists(configDir);
    const installed = cli.available || hasConfig;
    return {
      id: 'claude-code',
      displayName: 'Claude Code',
      installed,
      active: this.detect(env),
      reason: installed
        ? null
        : 'claude CLI not found and Claude Code config directory not present',
      cli,
      configPaths: [configDir],
      capabilities: {
        accountPool: this.accountPool,
        externalStatusline: this.externalStatusline,
        pluginDistribution: this.pluginDistribution,
      },
    };
  },
  session(env) {
    const id = env.CLAUDE_CODE_SESSION_ID || '';
    return { id, source: id ? 'env:CLAUDE_CODE_SESSION_ID' : 'none' };
  },
  readCurrentUsage(env) {
    const signal = readClaudeCodeUsageSidecar(env);
    return {
      signal,
      source: 'account',
      unavailableReason: '无 status-line sidecar',
    };
  },
  accountSwitchPreflight(env) {
    if (env.CLAUDE_CODE_USE_BEDROCK || env.CLAUDE_CODE_USE_VERTEX || env.CLAUDE_CODE_USE_FOUNDRY) {
      return {
        action: 'noop',
        reason:
          '云后端（Bedrock/Vertex/Foundry）无订阅 5h/7d 配额窗口、无可换的订阅 OAuth token —— 换号不适用，no-op 退出。',
      };
    }
    return { action: 'continue' };
  },
  async upgradePlugin(request) {
    return upgradeClaudePlugin(request);
  },
  accountPool: { supported: true },
  externalStatusline: { supported: true },
  pluginDistribution: { supported: true },
};

function pathExists(p: string): boolean {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

function readClaudeCodeUsageSidecar(env: Env): UsageSignal | null {
  try {
    const raw = fs.readFileSync(resolveRateCachePath(env), 'utf8');
    const obj = JSON.parse(raw);
    if (obj && typeof obj === 'object') return normalizeSignal(obj as Record<string, unknown>);
  } catch {
    return null;
  }
  return null;
}

async function upgradeClaudePlugin(req: PluginUpgradeRequest): Promise<PluginUpgradeResult> {
  let latest: string | null = null;
  try {
    latest = await req.resolveLatestPluginTag();
  } catch (e) {
    req.err(
      `upgrade(plugin): 取 release 列表失败（${(e as Error).message}）——继续走 claude plugin update（marketplace 驱动·不依赖 tag）。`,
    );
  }

  if (req.to) {
    req.err(
      `upgrade(plugin): 注意——\`claude plugin update\` 只能更新到 marketplace 当前指向版本（通常即最新${latest ? ` ${latest}` : ''}），无法精确切到任意历史 tag ${req.to}；将更新到 marketplace 最新。如需特定版本请用 install.sh --plugin-version ${req.to}。`,
    );
  }

  if (req.dryRun) {
    req.out('── ccm upgrade plugin DRY-RUN（不执行 claude）──');
    req.out('harness    : claude-code');
    req.out(`latest tag : ${latest || '（暂无 plugin release tag）'}`);
    req.out(`would run  : claude plugin marketplace update ${MARKETPLACE}`);
    req.out(`           : claude plugin update ${PLUGIN_REF}`);
    if (req.json) {
      req.out(req.jsonOk({ component: 'plugin', harness: 'claude-code', dry_run: true, latest }));
    }
    return {
      component: 'plugin',
      harness: 'claude-code',
      action: 'dry_run',
      exitCode: EXIT_OK,
      latest,
    };
  }

  if (!hasClaude(req.env)) {
    req.err(
      'upgrade(plugin): 找不到 claude CLI——插件升级需要它（要求 ≥ v2.1.195）。装好 Claude Code 后重试。',
    );
    return {
      component: 'plugin',
      harness: 'claude-code',
      action: 'failed',
      exitCode: EXIT_ERROR,
      reason: 'claude CLI not found',
      latest,
    };
  }

  req.err(`upgrade(plugin): 刷新 marketplace ${MARKETPLACE} …`);
  if (!runClaude(['plugin', 'marketplace', 'update', MARKETPLACE], req)) {
    req.err('  marketplace update 未成功（继续尝试 plugin update）。');
  }
  req.err(`upgrade(plugin): 更新插件 ${PLUGIN_REF} …`);
  if (!runClaude(['plugin', 'update', PLUGIN_REF], req)) {
    req.err(
      `upgrade(plugin): \`claude plugin update ${PLUGIN_REF}\` 失败——插件未更新。请手动重跑该命令查看详情。`,
    );
    return {
      component: 'plugin',
      harness: 'claude-code',
      action: 'failed',
      exitCode: EXIT_ERROR,
      reason: 'claude plugin update failed',
      latest,
    };
  }
  req.out(
    `✓ cc-master 插件已更新（claude plugin update ${PLUGIN_REF}·marketplace 最新${latest ? `=${latest}` : ''}）。重开 Claude Code session 生效。`,
  );
  if (req.json) {
    req.out(req.jsonOk({ component: 'plugin', harness: 'claude-code', action: 'updated', latest }));
  }
  return {
    component: 'plugin',
    harness: 'claude-code',
    action: 'updated',
    exitCode: EXIT_OK,
    latest,
  };
}

function claudeBin(env: Env): string {
  return env.CCM_CLAUDE_BIN || env.CLAUDE_BIN || 'claude';
}

function hasClaude(env: Env): boolean {
  try {
    execFileSync(claudeBin(env), ['--version'], { stdio: 'ignore', timeout: 15000 });
    return true;
  } catch {
    return false;
  }
}

function runClaude(args: string[], req: PluginUpgradeRequest): boolean {
  try {
    const out = execFileSync(claudeBin(req.env), args, { encoding: 'utf8', timeout: 120000 });
    if (req.verbose && out.trim()) req.err(out.trim());
    return true;
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string };
    const msg = (err.stderr || err.stdout || (e as Error).message || '').toString().trim();
    if (msg) req.err(`  claude: ${msg.split('\n').slice(0, 4).join('\n  claude: ')}`);
    return false;
  }
}

function normalizeSignal(obj: Record<string, unknown>): UsageSignal {
  const win = (
    k1: string,
    k2: string,
  ): { used_percentage: number | null; resets_at: number | null } => {
    const w = (obj[k1] ?? obj[k2]) as Record<string, unknown> | undefined;
    if (!w || typeof w !== 'object') return { used_percentage: null, resets_at: null };
    const up =
      typeof w.used_percentage === 'number'
        ? w.used_percentage
        : typeof w.used_pct === 'number'
          ? w.used_pct
          : null;
    let ra: number | null = null;
    if (typeof w.resets_at === 'number') ra = w.resets_at;
    else if (typeof w.resets_at === 'string') {
      const ms = Date.parse(w.resets_at);
      ra = Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
    }
    return { used_percentage: up, resets_at: ra };
  };
  let capturedAt: number | null = null;
  if (typeof obj.captured_at === 'number') capturedAt = obj.captured_at;
  else if (typeof obj.captured_at === 'string') {
    const ms = Date.parse(obj.captured_at);
    capturedAt = Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
  }
  return {
    five_hour: win('five_hour', '5h'),
    seven_day: win('seven_day', '7d'),
    captured_at: capturedAt,
  };
}
