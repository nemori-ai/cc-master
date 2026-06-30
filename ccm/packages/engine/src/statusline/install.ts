// statusline/install.ts — 把 `ccm statusline` 装进 claude 的 settings.json（幂等·可备份恢复·无感知自动安装）。
//
// 三个动作 + 一个无感知自动安装：
//   · installStatusline(env, command)   覆写**全局** `<claudeConfigDir>/settings.json` 的 `statusLine` 为
//       `{type:'command', command:'<ccm 绝对命令> statusline'}`；用户原有的 `statusLine` **备份**进一个单独的
//       state 文件（`.cc-master-statusline-state.json`），不污染 settings.json 的 schema。幂等：已是 ours → 仅更新
//       命令、不重复备份。**显式 install 会清除 opt-out 标记**（用户改主意了）。
//   · uninstallStatusline(env)          从 state 备份**恢复**用户原 `statusLine`（无备份则删 `statusLine` 字段），
//       并落一个 **opt-out 标记**让自动安装不再覆盖回去（不跟用户较劲）。
//   · autoInstallStatuslineOnce(env, command)  **首次被调用时**幂等、marker 守、静默地跑一次 install——
//       kill-switch（`CC_MASTER_NO_AUTOINSTALL`）/ opt-out 标记 / installed 标记任一在 → skip；否则装一次落 marker。
//       **任何失败一律吞掉**（绝不让自动安装影响任何 ccm 命令）。
//
// 落点（全部跟随 CLAUDE_CONFIG_DIR·resolveClaudeConfigDir）：
//   settings        <claudeConfigDir>/settings.json
//   state(备份)      <claudeConfigDir>/.cc-master-statusline-state.json   { managed, backup, command, installed_at }
//   installed-marker <claudeConfigDir>/.cc-master-statusline-installed
//   optout-marker    <claudeConfigDir>/.cc-master-statusline-optout
//
// 安全：settings.json 存在但**坏 JSON** → 绝不覆写（可能毁掉用户配置）；install 返回 error、autoInstall skip。
//
// 红线1 / ADR-006：node/JS only，纯 node stdlib（fs/path），零网络、零第三方依赖。

import * as fs from 'node:fs';
import * as path from 'node:path';
import { type PathEnv, resolveClaudeConfigDir } from '../paths.js';

// ── 路径派生 ────────────────────────────────────────────────────────────────────────────────────
export function settingsPath(env: PathEnv): string {
  return path.join(resolveClaudeConfigDir(env), 'settings.json');
}
function statePath(env: PathEnv): string {
  return path.join(resolveClaudeConfigDir(env), '.cc-master-statusline-state.json');
}
function installedMarkerPath(env: PathEnv): string {
  return path.join(resolveClaudeConfigDir(env), '.cc-master-statusline-installed');
}
function optoutMarkerPath(env: PathEnv): string {
  return path.join(resolveClaudeConfigDir(env), '.cc-master-statusline-optout');
}

// ── JSON 读写（容错 + 原子）─────────────────────────────────────────────────────────────────────
interface ReadResult {
  obj: Record<string, unknown>; // 解析出的对象（缺文件 → {}）
  existed: boolean; // 文件是否存在
  ok: boolean; // 存在且**可解析**（坏 JSON → false·调用方据此拒写）
}
function readJsonObject(file: string): ReadResult {
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return { obj: {}, existed: false, ok: true }; // 缺文件 = 干净起点
  }
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { obj: parsed as Record<string, unknown>, existed: true, ok: true };
    }
    return { obj: {}, existed: true, ok: false }; // 非对象（数组 / 标量）→ 当坏，不覆写
  } catch {
    return { obj: {}, existed: true, ok: false }; // 坏 JSON → 不覆写
  }
}

function writeJsonAtomic(file: string, obj: unknown): void {
  const dir = path.dirname(file);
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    /* 让后续 write 失败被外层兜 */
  }
  const tmp = path.join(dir, `.cc-sl-${process.pid}-${Math.random().toString(36).slice(2)}.tmp`);
  fs.writeFileSync(tmp, `${JSON.stringify(obj, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

function fileExists(file: string): boolean {
  try {
    fs.accessSync(file);
    return true;
  } catch {
    return false;
  }
}

function removeFileQuiet(file: string): void {
  try {
    fs.unlinkSync(file);
  } catch {
    /* 不存在 / 不可删 → 忽略 */
  }
}

// state 文件形态。
interface SlState {
  managed: boolean;
  backup: unknown; // 用户原 statusLine（首次接管时捕获）·无则 null
  command: string;
  installed_at: string;
}
function readState(env: PathEnv): SlState | null {
  const r = readJsonObject(statePath(env));
  if (!r.existed || !r.ok) return null;
  const o = r.obj;
  if (o.managed !== true) return null;
  return {
    managed: true,
    backup: 'backup' in o ? o.backup : null,
    command: typeof o.command === 'string' ? o.command : '',
    installed_at: typeof o.installed_at === 'string' ? o.installed_at : '',
  };
}

// ── 动作返回壳 ──────────────────────────────────────────────────────────────────────────────────
export interface StatuslineActionResult {
  action: 'installed' | 'updated' | 'restored' | 'removed' | 'noop' | 'skipped' | 'error';
  reason?: string; // skipped/error 的原因
  settingsPath: string;
  backedUp?: boolean; // install：是否捕获了用户原 statusLine 备份
  command?: string;
}

function nowIso(env: PathEnv): string {
  const o = env.CC_MASTER_NOW;
  if (o) {
    const t = Date.parse(o.replace('Z', '+00:00'));
    if (!Number.isNaN(t)) return new Date(t).toISOString().replace(/\.\d{3}Z$/, 'Z');
  }
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

// ── installStatusline(env, command) ────────────────────────────────────────────────────────────
//   幂等覆写 settings.statusLine；首次接管时把用户原值备份进 state；显式 install 清 opt-out 标记。
export function installStatusline(env: PathEnv, command: string): StatuslineActionResult {
  const sFile = settingsPath(env);
  const read = readJsonObject(sFile);
  if (read.existed && !read.ok) {
    // settings.json 坏 JSON → 绝不覆写（可能毁用户配置）。
    return { action: 'error', reason: 'settings-unparseable', settingsPath: sFile };
  }
  const settings = read.obj;
  const prevState = readState(env);

  let backup: unknown;
  let backedUp = false;
  let action: StatuslineActionResult['action'];
  if (prevState && prevState.managed) {
    // 已是 ours → 保留首次备份、仅更新命令（幂等）。
    backup = prevState.backup;
    action = prevState.command === command ? 'noop' : 'updated';
  } else {
    // 首次接管 → 捕获用户当前 statusLine 作备份（可能 undefined → null）。
    backup = 'statusLine' in settings ? settings.statusLine : null;
    backedUp = backup != null;
    action = 'installed';
  }

  settings.statusLine = { type: 'command', command };
  writeJsonAtomic(sFile, settings);
  writeJsonAtomic(statePath(env), {
    managed: true,
    backup: backup ?? null,
    command,
    installed_at: nowIso(env),
  } satisfies SlState);

  // 落 installed 标记 + 清 opt-out（显式 install = 用户改主意，允许后续自动安装再接管）。
  try {
    fs.writeFileSync(installedMarkerPath(env), `${nowIso(env)}\n`);
  } catch {
    /* 标记落盘失败不致命（install 本体已成功） */
  }
  removeFileQuiet(optoutMarkerPath(env));

  return { action, settingsPath: sFile, backedUp, command };
}

// ── uninstallStatusline(env) ───────────────────────────────────────────────────────────────────
//   从 state 备份恢复用户原 statusLine（无备份则删字段）；落 opt-out 标记让自动安装不再覆盖回去。
export function uninstallStatusline(env: PathEnv): StatuslineActionResult {
  const sFile = settingsPath(env);
  const read = readJsonObject(sFile);
  if (read.existed && !read.ok) {
    // 坏 JSON → 不动 settings，但仍落 opt-out（用户意图明确：别再装）。
    writeOptOut(env);
    removeFileQuiet(installedMarkerPath(env));
    return { action: 'error', reason: 'settings-unparseable', settingsPath: sFile };
  }
  const settings = read.obj;
  const state = readState(env);

  let action: StatuslineActionResult['action'];
  if (state && state.managed) {
    if (state.backup != null) {
      settings.statusLine = state.backup;
      action = 'restored';
    } else {
      delete settings.statusLine;
      action = 'removed';
    }
    writeJsonAtomic(sFile, settings);
    removeFileQuiet(statePath(env));
  } else {
    // 无 state（不是我们装的，或 state 丢了）→ 保守：不动 settings.statusLine，只记 opt-out。
    action = 'noop';
  }

  writeOptOut(env);
  removeFileQuiet(installedMarkerPath(env));
  return { action, settingsPath: sFile };
}

function writeOptOut(env: PathEnv): void {
  try {
    fs.writeFileSync(optoutMarkerPath(env), `${nowIso(env)}\n`);
  } catch {
    /* opt-out 标记落盘失败 → 自动安装仍可能重装，但 install 已恢复·非致命 */
  }
}

// killSwitch(env) → `CC_MASTER_NO_AUTOINSTALL` 非空且非 '0' → 禁用自动安装（CI / 测试套 / power-user 用）。
function killSwitch(env: PathEnv): boolean {
  const v = env.CC_MASTER_NO_AUTOINSTALL;
  return v !== undefined && v !== '' && v !== '0';
}

// ── DEV-GUARD：从「非安装位置」跑起来时不自动安装 ────────────────────────────────────────────────────
//   背景：无感知自动安装会改写**全局** `<claudeConfigDir>/settings.json`。但开发本仓时 ccm 是从 git
//   worktree / 仓库内（dev-bin shim → `ccm/apps/cli/bin/ccm.cjs`）跑的——若那时也自动安装，会拿 dev 树里的
//   命令路径污染开发者真实的 `~/.claude/settings.json`（且 dev 命令路径随 worktree 销毁即失效）。所以：检测到
//   ccm 是从非安装位置跑起来的 → **跳过**自动安装。真实用户经 install.sh 把 SEA 二进制装到稳定路径
//   `$HOME/.local/bin/ccm`（无 dev 标记邻居·不含 `/worktrees/`）→ 不命中 → 自动安装照常。
//
//   `binPath` = 本次 ccm 进程的入口绝对路径（node-bin 形态 = `process.argv[1]`〔bin/ccm.cjs〕；SEA 形态 =
//   `process.execPath`〔二进制自身〕；由 apps/cli 侧 self.resolveSelfBinPath() 注入·见 handler）。缺省
//   `undefined`（如旧调用方 / 单元测试不注入）→ 视为「非 dev」（不阻止自动安装·保持向后兼容）。
//
//   检测信号（任一命中即判 dev·从严避免误判真实用户）：
//     1. 路径含 `/worktrees/`——git worktree 约定目录（本仓 `.claude/worktrees/<id>/...`）。
//     2. 从 binPath 所在目录**向上 walk**命中 monorepo / 仓库 dev 标记：`.git`（dir 或 file·worktree 用 file）/
//        `pnpm-workspace.yaml` / `turbo.json`——后两者是 monorepo **根**专属、绝不出现在已发布的单包或 SEA 安装树里。
//   **刻意不**把裸 `package.json` 当标记：全局 npm 安装的 ccm 自带 `package.json`，用它会误伤真实全局安装用户。
//   纯 `fs.accessSync` 探活·全程吞错（探测异常 → 保守判「非 dev」·绝不因探测失败而拦住真实用户的自动安装）。
const DEV_WALKUP_MARKERS = ['.git', 'pnpm-workspace.yaml', 'turbo.json'] as const;
function hasMarker(dir: string, name: string): boolean {
  try {
    fs.accessSync(path.join(dir, name));
    return true;
  } catch {
    return false;
  }
}
export function looksLikeDevInvocation(binPath: string | undefined): boolean {
  if (!binPath) return false;
  try {
    // 归一化分隔符做 substring（Windows 容错）。
    if (binPath.replace(/\\/g, '/').includes('/worktrees/')) return true;
    let dir = path.dirname(binPath);
    for (let i = 0; i < 40; i++) {
      for (const m of DEV_WALKUP_MARKERS) if (hasMarker(dir, m)) return true;
      const parent = path.dirname(dir);
      if (parent === dir) break; // 抵达文件系统根
      dir = parent;
    }
    return false;
  } catch {
    return false; // 探测异常 → 保守判非 dev（不拦真实用户）。
  }
}

// ── autoInstallStatuslineOnce(env, command, binPath?) ──────────────────────────────────────────
//   marker 守 · 幂等 · 静默 · 绝不抛。首次（无 marker / 未 opt-out / 未 kill / 非 dev 调用）才装一次。
//   `binPath`（可选）= 本次 ccm 进程入口绝对路径，注入给 DEV-GUARD（见 looksLikeDevInvocation）：从 git
//   worktree / 仓库内跑（dev 自测）→ skip（reason `dev-invocation`），绝不污染真实 ~/.claude/settings.json。
//   不注入 → 跳过 dev 判定（向后兼容·单元测试默认路径）。
export function autoInstallStatuslineOnce(
  env: PathEnv,
  command: string,
  binPath?: string,
): StatuslineActionResult {
  const sFile = settingsPath(env);
  try {
    if (killSwitch(env)) return { action: 'skipped', reason: 'kill-switch', settingsPath: sFile };
    if (looksLikeDevInvocation(binPath))
      return { action: 'skipped', reason: 'dev-invocation', settingsPath: sFile };
    if (fileExists(optoutMarkerPath(env)))
      return { action: 'skipped', reason: 'opt-out', settingsPath: sFile };
    if (fileExists(installedMarkerPath(env)))
      return { action: 'skipped', reason: 'already-installed', settingsPath: sFile };
    // 防御：state 已 managed（marker 丢但 state 在）→ 当已装·补回 marker、skip。
    const st = readState(env);
    if (st && st.managed) {
      try {
        fs.writeFileSync(installedMarkerPath(env), `${nowIso(env)}\n`);
      } catch {
        /* 补 marker 失败不致命 */
      }
      return { action: 'skipped', reason: 'already-managed', settingsPath: sFile };
    }
    return installStatusline(env, command);
  } catch {
    return { action: 'skipped', reason: 'error', settingsPath: sFile };
  }
}
