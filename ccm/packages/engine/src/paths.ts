// paths.ts — claude 配置目录 + 派生路径解析（跟随 claude code 的 `CLAUDE_CONFIG_DIR` 重定位语义）。
//
// 背景（官方确证·claude-code-guide）：claude code 支持用 `CLAUDE_CONFIG_DIR` 把 `~/.claude/` 整体重定位。
//   本模块把这条语义收成 `@ccm/engine` 的**单一真相源**：引擎内部（vault/switch/registry）与 apps/cli 的
//   handlers/discover 都从这里派生 home / rate-cache / credentials / `.claude.json` / projects 路径，杜绝
//   「15 处各自硬写 ~/.claude」在重定位下静默分叉。**hook（bash/node）不 import 本模块**（红线5：hook 经
//   进程边界 shell 调 ccm·绝不 in-process require 引擎）——它们各自内联同口径的纯 env 读（红线1 安全）。
//
// 覆写优先级链（统一）：显式 flag/env（--home / CC_MASTER_HOME / CLAUDE_JSON_PATH / CRED_PATH /
//   CC_MASTER_RATE_CACHE）> CLAUDE_CONFIG_DIR 派生 > $HOME/.claude 派生（HOME 缺退 os.homedir()）。
//
// 红线1 / ADR-006：node/JS only，纯 node stdlib（fs/os/path），零第三方依赖。
//
// **macOS keychain 不受影响**：darwin 下官方凭证活在 Keychain（vault.ts 的 keychain 分支·与本模块无关）；
//   本模块只解析**文件**落点（Linux/Windows 的 `.credentials.json` 明文 + 各平台共享的 home/sidecar/`.claude.json`）。

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export type PathEnv = Record<string, string | undefined>;

// resolveClaudeConfigDir(env) → claude 配置根目录（绝对路径）。
//   = $CLAUDE_CONFIG_DIR（绝对化）|| $HOME/.claude（HOME 缺退 os.homedir()）。
export function resolveClaudeConfigDir(env?: PathEnv): string {
  const e = env || process.env;
  if (e.CLAUDE_CONFIG_DIR) return path.resolve(e.CLAUDE_CONFIG_DIR);
  const home = e.HOME || os.homedir();
  return path.join(home, '.claude');
}

// resolveCcMasterHome(env) → cc-master home **根**默认（不含 --home flag·调用方自己叠 flag）。
//   = $CC_MASTER_HOME || <claudeConfigDir>/cc-master。
export function resolveCcMasterHome(env?: PathEnv): string {
  const e = env || process.env;
  if (e.CC_MASTER_HOME) return path.resolve(e.CC_MASTER_HOME);
  return path.join(resolveClaudeConfigDir(e), 'cc-master');
}

// resolveRateCachePath(env) → status-line sidecar（账户权威 5h/7d used%·跨 project 共享）。
//   = $CC_MASTER_RATE_CACHE || <claudeConfigDir>/.cc-master-rate-limits.json。
export function resolveRateCachePath(env?: PathEnv): string {
  const e = env || process.env;
  if (e.CC_MASTER_RATE_CACHE) return e.CC_MASTER_RATE_CACHE;
  return path.join(resolveClaudeConfigDir(e), '.cc-master-rate-limits.json');
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
  const home = e.HOME || os.homedir();
  return path.join(home, '.claude.json');
}

// resolveProjectsDir(env) → usage JSONL 根目录。= <claudeConfigDir>/projects（随目录·与 settings 同口径）。
export function resolveProjectsDir(env?: PathEnv): string {
  return path.join(resolveClaudeConfigDir(env), 'projects');
}
