#!/usr/bin/env node
const fs = require('fs');
const os = require('os');
const path = require('path');

const DENY_BODY = [
  '直接 file-edit board 被拦（board-guard·rule:board-write-single-path）。',
  'why：board 的 schema / 状态机 / 锁不变式只在走 ccm 时才被强制。手改 board JSON 会绕过写关卡，',
  '让 deps 图 / 状态机转移 / hook 读到的窄腰状态静默腐蚀。',
  'fix：改用 ccm verb：ccm task start|done|block|set-status|unblock、ccm task update、ccm task add、ccm board update。',
].join('\n');

// PARITY: rule-board-guard-directive-tag — ADR-018 标签协议（ambient/advisory/directive）在 cursor 侧的
// 等价包装（无共享 hook-common 可 require，故本文件本地复刻同形 wrapper，与 claude-code board-guard.js
// 的 `directive(source, body)` 语义/格式一致：真硬闸用 <directive>，含 source + why + fix）。
function directive(source, body) {
  return `<directive source="${source}">\n${String(body)}\n</directive>`;
}

function readJson() {
  const raw = fs.readFileSync(0, 'utf8');
  return raw ? JSON.parse(raw) : {};
}

function resolveHome(env) {
  return env.CC_MASTER_HOME || path.join(env.HOME || os.homedir(), '.cc_master');
}

function boardsDir(home) {
  return path.resolve(path.join(home, 'boards'));
}

function boardMatches(board, sessionId) {
  const owner = board && typeof board === 'object' && board.owner && typeof board.owner === 'object'
    ? board.owner
    : {};
  if (owner.active !== true) return false;
  if (!sessionId) return true;
  return owner.session_id === sessionId;
}

function isArmed(home, sessionId) {
  const dir = boardsDir(home);
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.board.json')) continue;
    let board;
    try {
      board = JSON.parse(fs.readFileSync(path.join(dir, entry.name), 'utf8'));
    } catch {
      continue;
    }
    if (boardMatches(board, sessionId)) return true;
  }
  return false;
}

function pathIsBoard(filePath, home) {
  if (!filePath) return false;
  const resolved = path.resolve(String(filePath));
  const dir = boardsDir(home);
  if (resolved !== dir && !resolved.startsWith(`${dir}${path.sep}`)) return false;
  return path.basename(resolved).endsWith('.board.json');
}

const WRITE_OP_RE = />>?|(^|\s)sed\s+[^|]*-i|(^|\s)tee(\s|$)|(^|\s)cp(\s|$)|(^|\s)mv(\s|$)|(^|\s)dd(\s|$)|(^|\s)truncate(\s|$)/;
const BOARD_PATH_RE = /\.board\.json/;
// BOARD_TOKEN_RE — 从一个 command segment 里抓取形似路径的 token（含 `.board.json` 的非空白串，允许
// 包一层引号）。与 claude-code board-guard.js 的 BOARD_TOKEN_RE 字节级一致（PARITY: rule-board-guard-segment-touches-real-board）。
const BOARD_TOKEN_RE = /["']?[^\s"']*\.board\.json[^\s"']*["']?/g;

function stripShellComments(command) {
  let out = '';
  let quote = null;
  let escaped = false;
  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i];
    if (escaped) {
      out += ch;
      escaped = false;
      continue;
    }
    if (ch === '\\' && quote !== "'") {
      out += ch;
      escaped = true;
      continue;
    }
    if ((ch === "'" || ch === '"') && !quote) {
      quote = ch;
      out += ch;
      continue;
    }
    if (quote && ch === quote) {
      quote = null;
      out += ch;
      continue;
    }
    if (!quote && ch === '#') break;
    out += ch;
  }
  return out;
}

function shellSegments(command) {
  return stripShellComments(command)
    .split(/(?:&&|\|\||[;|\n])/)
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function isCcmCommandSegment(segment) {
  let s = segment.trim();
  while (/^[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|[^\s]+)\s+/.test(s)) {
    s = s.replace(/^[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|[^\s]+)\s+/, '');
  }
  return /^ccm(?:\s|$)/.test(s);
}

// segmentTouchesRealBoard(segment, home) → 该 segment 里含 `.board.json` 的 token 是否指向一块**真板**
// （落在 boardsDir(home) 下，对齐 Write/Edit 分支的 pathIsBoard() 语义），而不是任意同名字符串（scratch
// 假板 / 文档示例 / /tmp 下的测试夹具）。与 claude-code board-guard.js 字字对齐（PARITY:
// rule-board-guard-segment-touches-real-board·HOOKPAR-DEC 分叉修复：codex 侧此前缺失该检查，且额外带一条
// 「整条命令兜底」fallback 分支，两者叠加会对形似 `echo hi > /tmp/scratch.txt; cat notes.board.json` 这类
// 命令误报 deny——本轮对齐 claude-code 逻辑，删除兜底分支）。
function segmentTouchesRealBoard(segment, home) {
  const tokens = segment.match(BOARD_TOKEN_RE) || [];
  for (const raw of tokens) {
    const token = raw.replace(/^["']|["']$/g, '');
    if (token.includes('$')) return true; // 变量展开，拿不准就保守偏拦
    if (pathIsBoard(path.resolve(token), home)) return true;
  }
  return false;
}

// bashWritesBoard(command, home) → 该 Bash 命令是否**启发式命中**「手改 board」。须同一个 command segment
// 内同时含 .board.json 路径（且 resolve 到真板）+ 写操作符，且该 segment 不是 `ccm ...` 调用。
// PARITY: rule-board-guard-segment-touches-real-board — 与 claude-code board-guard.js 的 bashWritesBoard()
// 判定表字节级对齐；不再有「整条命令」兜底分支（该分支是 HOOKPAR §2.5 host-convention-divergence 的根因）。
function bashWritesBoard(command, home) {
  if (typeof command !== 'string' || !command) return false;
  if (!BOARD_PATH_RE.test(command)) return false;
  for (const segment of shellSegments(command)) {
    if (!BOARD_PATH_RE.test(segment) || !WRITE_OP_RE.test(segment)) continue;
    if (!segmentTouchesRealBoard(segment, home)) continue; // board-looking token outside boardsDir → not a real board
    if (!isCcmCommandSegment(segment)) return true;
  }
  return false;
}

function inputFilePath(input) {
  if (!input || typeof input !== 'object') return '';
  return input.file_path || input.path || input.filename || '';
}

function block() {
  process.stdout.write(`${JSON.stringify({ kind: 'block', message: directive('board-guard', DENY_BODY) })}\n`);
}

function main() {
  const payload = readJson();
  if (payload.event !== 'pre-tool-use') return;
  const sessionId = payload.session && payload.session.id ? payload.session.id : '';
  const home = resolveHome(process.env);
  if (!isArmed(home, sessionId)) return;

  // Cursor tool surface (probe + strategy.yaml): Shell | Write only.
  // No Edit / MultiEdit / apply_patch / Bash on this host.
  const tool = payload.tool || {};
  const name = tool.name || '';
  const input = tool.input || {};
  if (name === 'Write') {
    if (pathIsBoard(inputFilePath(input), home)) block();
    return;
  }
  if (name === 'Shell') {
    const command = input && typeof input.command === 'string' ? input.command : '';
    if (bashWritesBoard(command, home)) block();
  }
}

try {
  main();
} catch {
  process.exit(0);
}
