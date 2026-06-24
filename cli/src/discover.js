'use strict';
// discover.js — 板 / home 解析（CLI 发现层·设计稿 §6 + 契约 §三）。
//
// 职责：把「现在该读 / 写哪块 board」这个发现问题，按确定性优先级解出 {boardPath, board}。
//   优先级（设计稿 §6，显式注入 > 自动发现）：
//     ① --board / $CC_MASTER_BOARD              — 显式指定文件，最高优先
//     ② session→board 指针注册表                — bootstrap arm 时写的 sid→path 小指针（确定性、与 cwd 无关）
//     ③ home 内扫 *.board.json                   — resolveHome 兜底（--home > $CC_MASTER_HOME > $CLAUDE_PROJECT_DIR/.. > walk-up）
//          · sid 可用：boardMatches 精确锚（命中 0 → throw NotFound，**绝不退化抓唯一 active**·镜像 hook 武装语义）
//          · sid 不可用：唯一 owner.active 板（多板 → throw Ambiguous，可用 goalSubstr 过滤 goal 消歧）
//
// 依赖反转（守红线·设计稿 §8）：本文件**自带**一份 boardMatches（4 行），**不** require hooks/hook-common——
//   让 cli 永不依赖 hooks。hook 与 cli 各持一份同义谓词，是有意的轻量重复（容许）。
//
// 红线6：CLI 只**读** owner.session_id / owner.active 做发现匹配，**绝不写**它们（arming 专属 bootstrap）。
//   `--session-id` 是「找哪块板」的查询输入，非「把板盖成此 sid」的 arming 动作。
//
// 零 npm 依赖、纯 node stdlib（红线1+5·ship-anywhere）。CommonJS。

const fs = require('fs');
const path = require('path');
const os = require('os');

// 错误工厂：带 .errKind（router 据此映射退出码：NotFound→3 / Ambiguous→5 等·契约 §router）。
function discoverError(message, errKind) {
  const e = new Error(message);
  e.errKind = errKind;
  return e;
}

// ── home 解析 ─────────────────────────────────────────────────────────────────────────────────────
// resolveHome({homeFlag, env}) → 绝对 home 目录（.claude/cc-master 那一级）。
//   优先级：--home > $CC_MASTER_HOME > $CLAUDE_PROJECT_DIR/.claude/cc-master > 从 cwd 向上 walk-up > throw NotFound。
//   walk-up：像 git 找 .git 那样，从 cwd 逐级向上找最近一个**存在的** .claude/cc-master 目录。
function resolveHome({ homeFlag, env } = {}) {
  env = env || {};

  // ① --home：显式指定，直接用（不要求存在——调用者负责，镜像 hook 注入语义）。
  if (homeFlag) return path.resolve(homeFlag);

  // ② $CC_MASTER_HOME。
  if (env.CC_MASTER_HOME) return path.resolve(env.CC_MASTER_HOME);

  // ③ $CLAUDE_PROJECT_DIR/.claude/cc-master（env 在时；Bash 子进程常无·设计稿 §6 实测）。
  if (env.CLAUDE_PROJECT_DIR) {
    return path.resolve(env.CLAUDE_PROJECT_DIR, '.claude', 'cc-master');
  }

  // ④ 从 cwd 向上 walk-up 找最近的 .claude/cc-master。
  let dir = process.cwd();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const candidate = path.join(dir, '.claude', 'cc-master');
    try {
      if (fs.statSync(candidate).isDirectory()) return candidate;
    } catch (_) { /* 不存在，继续上爬 */ }
    const parent = path.dirname(dir);
    if (parent === dir) break; // 到根（path.dirname('/') === '/'）
    dir = parent;
  }

  // ⑤ 都没命中 → NotFound。
  throw discoverError('No cc-master home found (--home / $CC_MASTER_HOME / $CLAUDE_PROJECT_DIR / walk-up from cwd all missed)', 'NotFound');
}

// ── boardMatches（自带一份·守依赖反转）──────────────────────────────────────────────────────────
// board 是否匹配给定 sid：owner.active===true 且 (sid 给了 → owner.session_id===sid；没给 → 任一 active)。
//   坏输入（board 非对象 / 无 owner）→ false（防御性）。
function boardMatches(board, sid) {
  if (!board || typeof board !== 'object') return false;
  const owner = board.owner;
  if (!owner || typeof owner !== 'object') return false;
  if (owner.active !== true) return false;
  if (sid) return owner.session_id === sid;
  return true;
}

// ── session→board 指针注册表（user-global XDG state·设计稿 §6/§7）────────────────────────────────
// pointerPath(sid, env) → ($XDG_STATE_HOME || ~/.local/state)/cc-master/boards/<sid>.path。
function pointerDir(env) {
  env = env || {};
  const base = env.XDG_STATE_HOME
    ? path.resolve(env.XDG_STATE_HOME)
    : path.join(os.homedir(), '.local', 'state');
  return path.join(base, 'cc-master', 'boards');
}

function pointerPath(sid, env) {
  return path.join(pointerDir(env), `${sid}.path`);
}

// readPointer(sid, env) → 指针指向的 board 绝对路径，读不到 / 空 → null（best-effort）。
function readPointer(sid, env) {
  if (!sid) return null;
  try {
    const raw = fs.readFileSync(pointerPath(sid, env), 'utf8').trim();
    return raw.length > 0 ? raw : null;
  } catch (_) {
    return null;
  }
}

// writePointer(sid, boardPath, env) → 写指针（mkdir -p 父目录 + writeFileSync）。best-effort：失败静默吞。
function writePointer(sid, boardPath, env) {
  if (!sid) return;
  try {
    const p = pointerPath(sid, env);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, String(boardPath), 'utf8');
  } catch (_) { /* best-effort */ }
}

// deletePointer(sid, env) → 删指针（best-effort：不存在 / 失败静默吞）。
function deletePointer(sid, env) {
  if (!sid) return;
  try {
    fs.rmSync(pointerPath(sid, env), { force: true });
  } catch (_) { /* best-effort */ }
}

// ── 读盘 helper ─────────────────────────────────────────────────────────────────────────────────
// 读一个 board 文件 → 解析后的对象；读不到 / 坏 JSON → null（坏板跳过，不抛）。
function readBoardFile(boardPath) {
  try {
    const raw = fs.readFileSync(boardPath, 'utf8');
    const board = JSON.parse(raw);
    if (!board || typeof board !== 'object' || Array.isArray(board)) return null;
    return board;
  } catch (_) {
    return null;
  }
}

// 列出 home 下所有 *.board.json 的绝对路径（home 不存在 / 读不到 → []）。
function listBoardFiles(home) {
  let names;
  try {
    names = fs.readdirSync(home);
  } catch (_) {
    return [];
  }
  return names
    .filter((n) => n.endsWith('.board.json'))
    .map((n) => path.join(home, n))
    .sort(); // 稳定顺序（time-sortable 文件名天然有序）
}

// goalSubstr 过滤：board.goal 含给定子串（大小写不敏感）。
function goalMatches(board, goalSubstr) {
  if (!goalSubstr) return true;
  const goal = board && typeof board.goal === 'string' ? board.goal : '';
  return goal.toLowerCase().includes(String(goalSubstr).toLowerCase());
}

// ── resolveBoard：发现主入口（设计稿 §6 优先级）────────────────────────────────────────────────
// resolveBoard({boardFlag, sid, homeFlag, goalSubstr, env}) → {boardPath, board}。
//   找不到 → throw .errKind='NotFound'；多块未消歧 → throw .errKind='Ambiguous'。
function resolveBoard({ boardFlag, sid, homeFlag, goalSubstr, env } = {}) {
  env = env || {};

  // ① 显式指定：--board / $CC_MASTER_BOARD（最高优先，直接读盘）。
  const explicit = boardFlag || env.CC_MASTER_BOARD;
  if (explicit) {
    const boardPath = path.resolve(explicit);
    const board = readBoardFile(boardPath);
    if (!board) {
      throw discoverError(`--board path is missing or not valid board JSON: ${boardPath}`, 'NotFound');
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
    // sid 可用：boardMatches 精确锚（active && session_id===sid）。命中 0 → NotFound（绝不退化抓唯一 active）。
    const hits = [];
    for (const f of files) {
      const b = readBoardFile(f);
      if (b && boardMatches(b, sid) && goalMatches(b, goalSubstr)) {
        hits.push({ boardPath: f, board: b });
      }
    }
    if (hits.length === 0) {
      throw discoverError(`No active board owned by session ${sid} found in ${home}`, 'NotFound');
    }
    if (hits.length > 1) {
      // 同一 sid 多块 active（异常但防御）：归 Ambiguous，让调用者用 --board/--goal 消歧。
      throw discoverError(`Multiple active boards match session ${sid} in ${home}; pass --board or --goal to disambiguate`, 'Ambiguous');
    }
    return hits[0];
  }

  // sid 不可用（human 终端）：唯一 owner.active 板（多板 → Ambiguous，goalSubstr 可过滤消歧）。
  const actives = [];
  for (const f of files) {
    const b = readBoardFile(f);
    if (boardMatches(b, null) && goalMatches(b, goalSubstr)) {
      actives.push({ boardPath: f, board: b });
    }
  }
  if (actives.length === 0) {
    throw discoverError(`No active board found in ${home}`, 'NotFound');
  }
  if (actives.length > 1) {
    throw discoverError(`Multiple active boards in ${home}; pass --board or --goal to disambiguate`, 'Ambiguous');
  }
  return actives[0];
}

module.exports = {
  resolveHome,
  boardMatches,
  pointerPath,
  readPointer,
  writePointer,
  deletePointer,
  resolveBoard,
};
