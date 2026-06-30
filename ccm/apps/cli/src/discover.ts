// discover.ts — 板 / home 解析（CLI 发现层·设计稿 §6 + 契约 §三）。
//
// 职责：把「现在该读 / 写哪块 board」这个发现问题，按确定性优先级解出 {boardPath, board}。
//   优先级（设计稿 §6，显式注入 > 自动发现）：
//     ① --board / $CC_MASTER_BOARD              — 显式指定文件，最高优先
//     ② session→board 指针注册表                — bootstrap arm 时写的 sid→path 小指针（确定性、与 cwd 无关）
//     ③ home 内扫 *.board.json                   — resolveHome 兜底（--home > $CC_MASTER_HOME > $CLAUDE_PROJECT_DIR/.. > walk-up）
//          · sid 可用：boardMatches 精确锚（命中 0 → throw NotFound，**绝不退化抓唯一 active**·镜像 hook 武装语义）
//          · sid 不可用：唯一 owner.active 板（多板 → throw Ambiguous，可用 goalSubstr 过滤 goal 消歧）
//
// 依赖反转（守红线·设计稿 §8）：本文件**自带**一份 boardMatches（4 行），**不** import hooks/hook-common——
//   让 cli 永不依赖 hooks。hook 与 cli 各持一份同义谓词，是有意的轻量重复（容许）。
//
// 红线6：CLI 只**读** owner.session_id / owner.active 做发现匹配，**绝不写**它们（arming 专属 bootstrap）。
//   `--session-id` 是「找哪块板」的查询输入，非「把板盖成此 sid」的 arming 动作。
//
// 零 npm 依赖、纯 node stdlib（红线1+5·ship-anywhere）。
//
// T2a port 注：原 CJS 源（discover.js）的 require('fs'/'path'/'os') 换成 ESM node import；module.exports
//   换成命名导出。逻辑/报错文案/.errKind 逐字保持。

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { resolveClaudeConfigDir } from '@ccm/engine';

// 带 .errKind 的 Error（router 据此映射退出码）。
interface KindedError extends Error {
  errKind?: string;
}

// board 的最小读形（发现层只看 owner / goal）。
interface DiscoveredBoard {
  owner?: { active?: boolean; session_id?: string } | null;
  goal?: string;
  [k: string]: unknown;
}

type Env = Record<string, string | undefined>;

// 错误工厂：带 .errKind（router 据此映射退出码：NotFound→3 / Ambiguous→5 等·契约 §router）。
function discoverError(message: string, errKind: string): KindedError {
  const e = new Error(message) as KindedError;
  e.errKind = errKind;
  return e;
}

// ── home 解析（统一全局口径·board-v2 home 收口）────────────────────────────────────────────────────
// resolveHome({homeFlag, env}) → 绝对 home **根**目录（.claude/cc-master 那一级）。
//   优先级：--home > $CC_MASTER_HOME > $HOME/.claude/cc-master（全局·默认）> throw NotFound（无 HOME 时）。
//   **不再** per-repo（$CLAUDE_PROJECT_DIR/.claude/cc-master）或从 cwd walk-up——所有 orchestration 的 board
//   集中到一个用户级 home，跨 repo 不再各起一份。这与 hook 侧 hook-common.resolveHome / bootstrap-board.sh
//   的 cc_master_home 三处同口径。board 集中落 <home>/boards/（见 boardsDir）。
//   env.HOME 缺时退 os.homedir()（生产稳健·测试可经 env.HOME 注入隔离 home）。
export function resolveHome({ homeFlag, env }: { homeFlag?: string; env?: Env } = {}): string {
  env = env || {};

  // ① --home：显式指定，直接用（不要求存在——调用者负责，镜像 hook 注入语义）。
  if (homeFlag) return path.resolve(homeFlag);

  // ② $CC_MASTER_HOME。
  if (env.CC_MASTER_HOME) return path.resolve(env.CC_MASTER_HOME);

  // ③ claudeConfigDir 派生 + /cc-master（claudeConfigDir 跟随 $CLAUDE_CONFIG_DIR·默认 $HOME/.claude·
  //    HOME 缺退 os.homedir()·paths.resolveClaudeConfigDir SSOT）。
  if (env.CLAUDE_CONFIG_DIR || env.HOME || os.homedir()) {
    return path.join(resolveClaudeConfigDir(env), 'cc-master');
  }

  // ④ 连 CLAUDE_CONFIG_DIR / HOME / homedir 都没有（极端环境）→ NotFound。
  throw discoverError(
    'No cc-master home found (--home / $CC_MASTER_HOME / $CLAUDE_CONFIG_DIR / $HOME all missed)',
    'NotFound',
  );
}

// ── boards 目录 ─────────────────────────────────────────────────────────────────────────────────
// boardsDir(home) → home 下集中放所有 *.board.json 的子目录（<home>/boards/·board-v2 布局）。
//   home 根另放 accounts.json（全局·不动）+ 预留 channel/；board 枚举 / init 落点一律走这里。
export function boardsDir(home: string): string {
  return path.join(home, 'boards');
}

// ── boardMatches（自带一份·守依赖反转）──────────────────────────────────────────────────────────
// board 是否匹配给定 sid：owner.active===true 且 (sid 给了 → owner.session_id===sid；没给 → 任一 active)。
//   坏输入（board 非对象 / 无 owner）→ false（防御性）。
export function boardMatches(board: unknown, sid: string | null | undefined): boolean {
  if (!board || typeof board !== 'object') return false;
  const owner = (board as DiscoveredBoard).owner;
  if (!owner || typeof owner !== 'object') return false;
  if (owner.active !== true) return false;
  if (sid) return owner.session_id === sid;
  return true;
}

// ── session→board 指针注册表（user-global XDG state·设计稿 §6/§7）────────────────────────────────
// pointerPath(sid, env) → ($XDG_STATE_HOME || ~/.local/state)/cc-master/boards/<sid>.path。
function pointerDir(env?: Env): string {
  env = env || {};
  const base = env.XDG_STATE_HOME
    ? path.resolve(env.XDG_STATE_HOME)
    : path.join(os.homedir(), '.local', 'state');
  return path.join(base, 'cc-master', 'boards');
}

export function pointerPath(sid: string, env?: Env): string {
  return path.join(pointerDir(env), `${sid}.path`);
}

// readPointer(sid, env) → 指针指向的 board 绝对路径，读不到 / 空 → null（best-effort）。
export function readPointer(sid: string, env?: Env): string | null {
  if (!sid) return null;
  try {
    const raw = fs.readFileSync(pointerPath(sid, env), 'utf8').trim();
    return raw.length > 0 ? raw : null;
  } catch (_) {
    return null;
  }
}

// writePointer(sid, boardPath, env) → 写指针（mkdir -p 父目录 + writeFileSync）。best-effort：失败静默吞。
export function writePointer(sid: string, boardPath: string, env?: Env): void {
  if (!sid) return;
  try {
    const p = pointerPath(sid, env);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, String(boardPath), 'utf8');
  } catch (_) {
    /* best-effort */
  }
}

// deletePointer(sid, env) → 删指针（best-effort：不存在 / 失败静默吞）。
export function deletePointer(sid: string, env?: Env): void {
  if (!sid) return;
  try {
    fs.rmSync(pointerPath(sid, env), { force: true });
  } catch (_) {
    /* best-effort */
  }
}

// ── 读盘 helper ─────────────────────────────────────────────────────────────────────────────────
// 读一个 board 文件 → 解析后的对象；读不到 / 坏 JSON → null（坏板跳过，不抛）。
function readBoardFile(boardPath: string): DiscoveredBoard | null {
  try {
    const raw = fs.readFileSync(boardPath, 'utf8');
    const board = JSON.parse(raw);
    if (!board || typeof board !== 'object' || Array.isArray(board)) return null;
    return board;
  } catch (_) {
    return null;
  }
}

// 列出 <home>/boards/ 下所有 *.board.json 的绝对路径（目录不存在 / 读不到 → []）。
function listBoardFiles(home: string): string[] {
  const dir = boardsDir(home);
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch (_) {
    return [];
  }
  return names
    .filter((n) => n.endsWith('.board.json'))
    .map((n) => path.join(dir, n))
    .sort(); // 稳定顺序（time-sortable 文件名天然有序）
}

// goalSubstr 过滤：board.goal 含给定子串（大小写不敏感）。
function goalMatches(board: DiscoveredBoard | null, goalSubstr?: string): boolean {
  if (!goalSubstr) return true;
  const goal = board && typeof board.goal === 'string' ? board.goal : '';
  return goal.toLowerCase().includes(String(goalSubstr).toLowerCase());
}

// resolveBoard 入参 / 出参。
interface ResolveBoardArgs {
  boardFlag?: string;
  sid?: string;
  homeFlag?: string;
  goalSubstr?: string;
  env?: Env;
}
interface ResolvedBoard {
  boardPath: string;
  board: DiscoveredBoard;
}

// ── resolveBoard：发现主入口（设计稿 §6 优先级）────────────────────────────────────────────────
// resolveBoard({boardFlag, sid, homeFlag, goalSubstr, env}) → {boardPath, board}。
//   找不到 → throw .errKind='NotFound'；多块未消歧 → throw .errKind='Ambiguous'。
export function resolveBoard({
  boardFlag,
  sid,
  homeFlag,
  goalSubstr,
  env,
}: ResolveBoardArgs = {}): ResolvedBoard {
  env = env || {};

  // ① 显式指定：--board / $CC_MASTER_BOARD（最高优先，直接读盘）。
  const explicit = boardFlag || env.CC_MASTER_BOARD;
  if (explicit) {
    const boardPath = path.resolve(explicit);
    const board = readBoardFile(boardPath);
    if (!board) {
      throw discoverError(
        `--board path is missing or not valid board JSON: ${boardPath}`,
        'NotFound',
      );
    }
    return { boardPath, board };
  }

  // ② 指针注册表（sid → board 绝对路径·确定性、与 cwd 无关）。
  //    命中且该板 boardMatches 一致 → 用；陈旧（板已非 active / sid 不符 / 文件没了）→ 落 ③ 兜底。
  if (sid) {
    const ptr = readPointer(sid, env);
    if (ptr) {
      const board = readBoardFile(ptr);
      if (board && boardMatches(board, sid)) {
        return { boardPath: path.resolve(ptr), board };
      }
      // 指针陈旧 → 不抛，落 ③ home 兜底。
    }
  }

  // ③ home 发现兜底：resolveHome 内扫 *.board.json。
  const home = resolveHome({ homeFlag, env }); // home 解不出本身会 throw NotFound
  const files = listBoardFiles(home);

  if (sid) {
    // sid 可用：两档匹配（QA #1·镜像 hook「绝不抢他 session 已认领板」精神，但容未认领板被取用）。
    //   一档 exact —— active && session_id===sid（本 session 已 arm/认领的板·最优先）。
    //   二档 unclaimed —— active && session_id===""（`ccm board init` 建的未认领板：没被任何 session
    //     认领，任何 session 取用都安全；这不是「退化抓唯一 active」——绝不碰他 sid 已认领的板）。
    //   仅当 exact 全空时才落 unclaimed——故本 session 的板永远盖过未认领板。
    const exact: ResolvedBoard[] = [];
    const unclaimed: ResolvedBoard[] = [];
    for (const f of files) {
      const b = readBoardFile(f);
      if (!b || !goalMatches(b, goalSubstr)) continue;
      const owner = b.owner;
      if (!owner || typeof owner !== 'object' || owner.active !== true) continue;
      if (owner.session_id === sid) exact.push({ boardPath: f, board: b });
      else if (!owner.session_id) unclaimed.push({ boardPath: f, board: b });
    }
    const hits = exact.length > 0 ? exact : unclaimed;
    if (hits.length === 0) {
      // 诚实记账：若 goalSubstr 过滤过 goal，未认领板可能本存在却被滤掉——「也无未认领 active 板」会是假信息，
      //   故显式标注「已按 goal 过滤」让用户知道可能是过滤所致（Finding #77：board update 等 payload `--goal`
      //   漏进发现的旧坑已在 handler 侧 resolveBoardIgnoringGoal 堵死，此处兜其余 goalSubstr 消歧路径的诚实性）。
      const filterNote = goalSubstr ? `·已按 goal "${goalSubstr}" 过滤` : '';
      throw discoverError(
        `No active board owned by session ${sid}（也无未认领 active 板${filterNote}）found in ${home}；先 \`ccm board init\` 或传 --board <path>`,
        'NotFound',
      );
    }
    if (hits.length > 1) {
      const tier = exact.length > 0 ? `match session ${sid}` : 'unclaimed（session_id 空）';
      throw discoverError(
        `Multiple active boards ${tier} in ${home}; pass --board or --goal to disambiguate`,
        'Ambiguous',
      );
    }
    // 上面已挡 length 0 与 >1，此处 length===1·hits[0] 必有值（as 窄断言·不改逻辑）。
    return hits[0] as ResolvedBoard;
  }

  // sid 不可用（human 终端）：唯一 owner.active 板（多板 → Ambiguous，goalSubstr 可过滤消歧）。
  const actives: ResolvedBoard[] = [];
  for (const f of files) {
    const b = readBoardFile(f);
    if (boardMatches(b, null) && goalMatches(b, goalSubstr)) {
      // boardMatches(null,…) 已为 false → 短路，故此处 b 必非 null（断言供 TS）。
      actives.push({ boardPath: f, board: b as DiscoveredBoard });
    }
  }
  if (actives.length === 0) {
    throw discoverError(`No active board found in ${home}`, 'NotFound');
  }
  if (actives.length > 1) {
    throw discoverError(
      `Multiple active boards in ${home}; pass --board or --goal to disambiguate`,
      'Ambiguous',
    );
  }
  // 同上·length===1·actives[0] 必有值（as 窄断言·不改逻辑）。
  return actives[0] as ResolvedBoard;
}
