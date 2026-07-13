// paths.ts — cc-master home + harness host 配置路径解析。
//
// cc-master 自身状态必须是 harness-neutral：boards / accounts registry / file vault / rate-cache 默认落
//   `$HOME/.cc_master`。Claude Code 的 host 配置仍按 `CLAUDE_CONFIG_DIR` 解析：settings.json、projects、
//   `.credentials.json`、`.claude.json` 等属于 Claude Code backend，不跟 cc-master home 混放。
//   本模块把两条路径语义拆开，避免把 cc-master home 绑死在某个 harness 的 config dir 下。
//   **hook（bash/node）不 import 本模块**（红线5：hook 经进程边界 shell 调 ccm·绝不 in-process require 引擎）
//   ——它们各自内联同口径的纯 env 读（红线1 安全）。
//
// 覆写优先级链：
//   cc-master home: --home（调用方处理）/ CC_MASTER_HOME > $HOME/.cc_master（HOME 缺退 os.homedir()）。
//   Claude Code host paths: CLAUDE_CONFIG_DIR > $HOME/.claude（HOME 缺退 os.homedir()）。
//   Explicit file envs（CLAUDE_JSON_PATH / CRED_PATH / CC_MASTER_RATE_CACHE）仍各自最高优先。
//
// 红线1 / ADR-006：node/JS only，纯 node stdlib（fs/os/path），零第三方依赖。
//
// **macOS keychain 不受影响**：darwin 下官方凭证活在 Keychain（vault.ts 的 keychain 分支·与本模块无关）；
//   本模块只解析**文件**落点（Linux/Windows 的 `.credentials.json` 明文 + 各平台共享的 home/sidecar/`.claude.json`）。

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { captureRuntimeEnvironment, ccMasterHome, homeBase, hostConfig } from './runtime-env.js';

export type PathEnv = Record<string, string | undefined>;

// resolveClaudeCodeConfigDir(env) → 兼容 Claude Code 的 host config 目录（绝对路径）。
//   = $CLAUDE_CONFIG_DIR（绝对化）|| $HOME/.claude（HOME 缺退 os.homedir()）。
export function resolveClaudeCodeConfigDir(env?: PathEnv): string {
  const e = env || process.env;
  return hostConfig(captureRuntimeEnvironment({ env: e }), 'claude-code')[0] as string;
}

// resolveHostConfigDir(env) → 与 host 配置目录的通用命名。
// 目前仍映射到 resolveClaudeCodeConfigDir（仅 Claude-style host 有明确定义）。
export function resolveHostConfigDir(env?: PathEnv): string {
  return resolveClaudeCodeConfigDir(env);
}

// 兼容导出：历史命名沿用不变。
export const resolveClaudeConfigDir = resolveClaudeCodeConfigDir;

// resolveCcMasterHome(env) → cc-master home **根**默认（不含 --home flag·调用方自己叠 flag）。
//   = $CC_MASTER_HOME || $HOME/.cc_master（HOME 缺退 os.homedir()）。
export function resolveCcMasterHome(env?: PathEnv): string {
  const e = env || process.env;
  return ccMasterHome(captureRuntimeEnvironment({ env: e }));
}

// resolveRateCachePath(env) → status-line sidecar（账户权威 5h/7d used%·跨 project 共享）。
//   = $CC_MASTER_RATE_CACHE || <cc-master-home>/.cc-master-rate-limits.json。
export function resolveRateCachePath(env?: PathEnv): string {
  const e = env || process.env;
  if (e.CC_MASTER_RATE_CACHE) return e.CC_MASTER_RATE_CACHE;
  return path.join(resolveCcMasterHome(e), '.cc-master-rate-limits.json');
}

// resolveCredentialsPath(env) → 官方明文凭证文件（**Linux/Windows** 凭证存储·macOS 走 keychain 不读此）。
//   = $CRED_PATH || <claudeConfigDir>/.credentials.json。
export function resolveCredentialsPath(env?: PathEnv): string {
  const e = env || process.env;
  if (e.CRED_PATH) return e.CRED_PATH;
  return path.join(resolveClaudeConfigDir(e), '.credentials.json');
}

// resolveClaudeJsonPath(env) → `.claude.json`（含 oauthAccount 身份）的落点。
//   官方对其是否随 CLAUDE_CONFIG_DIR 移动**不确定**→**双路径容错**：优先 <claudeConfigDir>/.claude.json，
//   不存在退 $HOME/.claude.json（HOME 缺退 os.homedir()）。$CLAUDE_JSON_PATH 覆写为最高优先级。
export function resolveClaudeJsonPath(env?: PathEnv): string {
  const e = env || process.env;
  if (e.CLAUDE_JSON_PATH) return path.resolve(e.CLAUDE_JSON_PATH);
  const inConfigDir = path.join(resolveClaudeConfigDir(e), '.claude.json');
  try {
    if (fs.existsSync(inConfigDir)) return inConfigDir;
  } catch {
    /* fall through to $HOME/.claude.json */
  }
  const home = homeBase(e, os.homedir());
  return path.join(home, '.claude.json');
}

// resolveProjectsDir(env) → usage JSONL 根目录。= <claudeConfigDir>/projects（随目录·与 settings 同口径）。
export function resolveProjectsDir(env?: PathEnv): string {
  return path.join(resolveClaudeConfigDir(env), 'projects');
}
