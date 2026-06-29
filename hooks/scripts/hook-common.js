'use strict';
// hook-common.js — node hook 共享地基（武装闸 SSOT + HOME 解析 + stdin + 找板）。
//
// ★v2 收编（ADR-013 §2.4）：reinject / verify-board / posttool-batch / board-lint 四个 node hook 共用这一份
//   武装逻辑，取代 v1 时代每个 bash hook 各自一份脆弱的 awk 深度扫描（owner_region/board_matches/tasks_region）。
//   node 的 JSON.parse 一行替代那些「字符串/转义/方括号双深度」手写扫描——这正是收编消除的最大一类漂移。
//
// 红线1 / ADR-006：node/JS only，纯 stdlib（fs + path），零 spawn、零网络、零 npm 依赖。
// 红线2：只读 narrow-waist 的 owner.active / owner.session_id 判武装（不碰 agent-shaped 字段、不写 board）。
// 红线6（dormant-until-armed）：boardMatches / isArmed 即这道闸——本文件**含 `isArmed` 字样**，故天然过
//   §3 红线6 的 grep 门（与 board-lint-core.js 同——纯库无 hook 入口，但因含该词自然不被旗标，无需列豁免）。
//
// 武装语义（与 v1 board_matches 字字对齐·ADR-007）：一块板「是我的」⟺ owner.active===true 且
//   （stdin sid 空 → 非对称降级：任一 active 板；否则 owner.session_id===sid 精确匹配）。空 owner.session_id
//   的板**不被收养**（落到 "" === "<非空 sid>" → false → 休眠，fail-safe·红线6 防跨 session 污染·CODEX14）。

const fs = require('fs');
const os = require('os');
const path = require('path');

// resolveHome() → HOME_DIR（cc-master home **根**·统一全局口径·ADR-board-v2 home 收口）。
//   优先级：$CC_MASTER_HOME 覆写 → $HOME/.claude/cc-master（全局·默认）。**不再** per-repo
//   （CLAUDE_PROJECT_DIR/.claude/cc-master）或 cwd fallback——所有 orchestration 的 board 集中到一个
//   用户级 home，跨 repo 不再各起一份。**这是全 hook（node + bash）+ ccm discover 的 node SSOT**：
//   board-lint / usage-pacing / reinject / verify-board / posttool-batch 都经本函数解析，不再各自内联。
//   测试经 CC_MASTER_HOME 注入隔离 home。
function resolveHome() {
  return process.env.CC_MASTER_HOME ||
    path.join(process.env.HOME || os.homedir(), '.claude', 'cc-master');
}

// boardsDir(homeDir) → home 下集中放所有 *.board.json 的子目录（<home>/boards/·board-v2 布局）。
//   board 枚举 / 武装扫描一律走这里；home 根只放 accounts.json（全局·不动）+ hook sidecar（.stopcheck）
//   + 预留 channel/。把「home 根」与「boards 目录」分开，使 home 根能承载非 board 的全局资源不互撞。
function boardsDir(homeDir) {
  return path.join(homeDir, 'boards');
}

// readStdin() → stdin 原始字符串（读不到 → ''）。
function readStdin() {
  try { return fs.readFileSync(0, 'utf8'); } catch (_e) { return ''; }
}

// parseStdin(raw) → { obj, sid, toolName, filePath }。非法 JSON → 空壳（sid='' 等）。
//   与 board-lint.js 取值口径一致：session_id / tool_name / tool_input.file_path。
function parseStdin(raw) {
  const out = { obj: {}, sid: '', toolName: '', filePath: '' };
  try {
    const o = JSON.parse(raw || '{}');
    if (o && typeof o === 'object') {
      out.obj = o;
      if (typeof o.session_id === 'string') out.sid = o.session_id;
      if (typeof o.tool_name === 'string') out.toolName = o.tool_name;
      const ti = o.tool_input || {};
      if (ti && typeof ti.file_path === 'string') out.filePath = ti.file_path;
    }
  } catch (_e) { /* 非法 stdin → 空壳 */ }
  return out;
}

// boardMatches(board, sid) → 这块（已解析的）board 是不是「我的 active 板」（武装谓词·narrow-waist only）。
//   只读 owner.active / owner.session_id。坏输入 → false。
function boardMatches(board, sid) {
  const owner = (board && typeof board === 'object' && board.owner) || {};
  if (owner.active !== true) return false;
  if (!sid) return true;                       // 非对称降级：stdin sid 空 → 任一 active 板
  return owner.session_id === sid;             // session-scoped 精确匹配（空 board sid 落 false → 不收养）
}

// listMatchingBoards(homeDir, sid) → [{ path, name, board }]——<home>/boards/ 里所有能解析且 boardMatches
//   的 *.board.json。坏板（读/解析失败）跳过（按「不匹配」处理）。供需要遍历自己所有 active 板的 hook
//   （reinject / verify-board / posttool-batch）。入参是 home **根**，内部走 boardsDir 扫 boards/ 子目录。
function listMatchingBoards(homeDir, sid) {
  const out = [];
  const dir = boardsDir(homeDir);
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_e) { return out; }
  for (const ent of entries) {
    if (!ent.isFile() || !ent.name.endsWith('.board.json')) continue;
    const p = path.join(dir, ent.name);
    let board;
    try { board = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_e) { continue; }
    if (boardMatches(board, sid)) out.push({ path: p, name: ent.name, board });
  }
  return out;
}

// isArmed(homeDir, sid) → 本 session 是否武装（<home>/boards/ 里存在至少一块匹配的 active 板）。
//   与 board-lint.js 旧内联 isArmed 语义字字相同（红线6 dormant-until-armed 的唯一判定）。入参是 home
//   **根**，内部走 boardsDir 扫 boards/ 子目录。
function isArmed(homeDir, sid) {
  const dir = boardsDir(homeDir);
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_e) { return false; }
  for (const ent of entries) {
    if (!ent.isFile() || !ent.name.endsWith('.board.json')) continue;
    let board;
    try { board = JSON.parse(fs.readFileSync(path.join(dir, ent.name), 'utf8')); } catch (_e) { continue; }
    if (boardMatches(board, sid)) return true;
  }
  return false;
}

// jsonEscape(str) → 安全注入进 JSON 字符串字面量的转义（hook 输出 additionalContext 用）。
function jsonEscape(str) { return JSON.stringify(String(str)); }

// ── ADR-018 hook→agent 标签化消息协议（作者侧 SSOT·AGENTS.md §13）──────────────────────────────────
// 所有 hook 往 agent context 注入的 transient 文本都按三类标签写（reinject/bootstrap 的角色 substrate 豁免，
//   见 ADR-018 §2.5）。三类固定对应三个标签；`strength`（weak|strong）**只给 advisory**（ambient 恒低 /
//   directive 恒满，保持最小集·P4）；**所有标签必带 `source`**（注的是哪个 hook·可追溯可审计·P6）。
//   把包装收口到这一份共享 helper：① 各 hook 注入嗓音一致、不漂移；② tag/source 语法只有一处写法，
//   防回潮 lint（structure.test.mjs）有唯一锚点对得上。纯字符串拼接、零依赖（红线1）。
//
//   ambient(source, body)             → <ambient source="...">…</ambient>     背景·塑模型·无 action
//   advisory(source, strength, body)  → <advisory source="..." strength="weak|strong">…</advisory>  喂判断·action 可选
//   directive(source, body)           → <directive source="...">…</directive>  硬约束·必须遵从·内含 why（P5 由调用方保证）
// body 已含必要 why（directive）/ levers（advisory）的完整文案；helper 只负责套标签外壳，不改文案语义。
function ambient(source, body) {
  return `<ambient source="${source}">\n${String(body)}\n</ambient>`;
}
function advisory(source, strength, body) {
  const s = (strength === 'strong') ? 'strong' : 'weak'; // 非法/缺 → weak（最低够用·P2）
  return `<advisory source="${source}" strength="${s}">\n${String(body)}\n</advisory>`;
}
function directive(source, body) {
  return `<directive source="${source}">\n${String(body)}\n</directive>`;
}

module.exports = {
  resolveHome, boardsDir, readStdin, parseStdin, boardMatches, listMatchingBoards, isArmed, jsonEscape,
  ambient, advisory, directive,
};
