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
const path = require('path');

// resolveHome() → HOME_DIR（CC_MASTER_HOME 覆写 → CLAUDE_PROJECT_DIR/.claude/cc-master → cwd/.claude/cc-master）。
//   与全 hook 同口径（board-lint.js / 各 bash hook）。测试经 CC_MASTER_HOME 注入。
function resolveHome() {
  return process.env.CC_MASTER_HOME ||
    path.join(process.env.CLAUDE_PROJECT_DIR || process.cwd(), '.claude', 'cc-master');
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

// listMatchingBoards(homeDir, sid) → [{ path, name, board }]——home 里所有能解析且 boardMatches 的 *.board.json。
//   坏板（读/解析失败）跳过（按「不匹配」处理）。供需要遍历自己所有 active 板的 hook（reinject / verify-board）。
function listMatchingBoards(homeDir, sid) {
  const out = [];
  let entries;
  try { entries = fs.readdirSync(homeDir, { withFileTypes: true }); } catch (_e) { return out; }
  for (const ent of entries) {
    if (!ent.isFile() || !ent.name.endsWith('.board.json')) continue;
    const p = path.join(homeDir, ent.name);
    let board;
    try { board = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_e) { continue; }
    if (boardMatches(board, sid)) out.push({ path: p, name: ent.name, board });
  }
  return out;
}

// isArmed(homeDir, sid) → 本 session 是否武装（存在至少一块匹配的 active 板）。
//   与 board-lint.js 旧内联 isArmed 语义字字相同（红线6 dormant-until-armed 的唯一判定）。
function isArmed(homeDir, sid) {
  let entries;
  try { entries = fs.readdirSync(homeDir, { withFileTypes: true }); } catch (_e) { return false; }
  for (const ent of entries) {
    if (!ent.isFile() || !ent.name.endsWith('.board.json')) continue;
    let board;
    try { board = JSON.parse(fs.readFileSync(path.join(homeDir, ent.name), 'utf8')); } catch (_e) { continue; }
    if (boardMatches(board, sid)) return true;
  }
  return false;
}

// jsonEscape(str) → 安全注入进 JSON 字符串字面量的转义（hook 输出 additionalContext 用）。
function jsonEscape(str) { return JSON.stringify(String(str)); }

module.exports = { resolveHome, readStdin, parseStdin, boardMatches, listMatchingBoards, isArmed, jsonEscape };
