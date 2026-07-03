#!/usr/bin/env node
const fs = require('fs');
const os = require('os');
const path = require('path');

const DENY_BODY = [
  '直接 file-edit board 被拦（board-guard）。',
  'why：board 的 schema / 状态机 / 锁不变式只在走 ccm 时才被强制。手改 board JSON 会绕过写关卡，',
  '让 deps 图 / 状态机转移 / hook 读到的窄腰状态静默腐蚀。',
  'fix：改用 ccm verb：ccm task start|done|block|set-status|unblock、ccm task update、ccm task add、ccm board update。',
].join('\n');

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

function bashWritesBoard(command) {
  if (typeof command !== 'string' || !command) return false;
  if (!BOARD_PATH_RE.test(command)) return false;
  let sawBoardWrite = false;
  for (const segment of shellSegments(command)) {
    if (!BOARD_PATH_RE.test(segment) || !WRITE_OP_RE.test(segment)) continue;
    sawBoardWrite = true;
    if (!isCcmCommandSegment(segment)) return true;
  }
  return sawBoardWrite ? false : WRITE_OP_RE.test(stripShellComments(command));
}

function inputFilePath(input) {
  if (!input || typeof input !== 'object') return '';
  return input.file_path || input.path || input.filename || '';
}

function applyPatchTouchesBoard(input, home) {
  const text = typeof input === 'string' ? input : JSON.stringify(input || {});
  if (!BOARD_PATH_RE.test(text)) return false;
  const dir = boardsDir(home);
  return text.includes(dir) || /(?:^|\s|[ab]\/)[^\s'"]+\.board\.json/.test(text);
}

function block() {
  process.stdout.write(`${JSON.stringify({ kind: 'block', message: DENY_BODY })}\n`);
}

function main() {
  const payload = readJson();
  if (payload.event !== 'pre-tool-use') return;
  const sessionId = payload.session && payload.session.id ? payload.session.id : '';
  const home = resolveHome(process.env);
  if (!isArmed(home, sessionId)) return;

  const tool = payload.tool || {};
  const name = tool.name || '';
  const input = tool.input || {};
  if (name === 'Write' || name === 'Edit' || name === 'MultiEdit') {
    if (pathIsBoard(inputFilePath(input), home)) block();
    return;
  }
  if (name === 'apply_patch') {
    if (applyPatchTouchesBoard(input, home)) block();
    return;
  }
  if (name === 'Bash') {
    const command = input && typeof input.command === 'string' ? input.command : '';
    if (bashWritesBoard(command)) block();
  }
}

try {
  main();
} catch {
  process.exit(0);
}
