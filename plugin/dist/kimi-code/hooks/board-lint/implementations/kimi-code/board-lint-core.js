#!/usr/bin/env node
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CCM_BIN = process.env.CCM_BIN || 'ccm';

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

function targetIsMyActiveBoard(filePath, sessionId) {
  let board;
  try {
    board = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
  if (!boardMatches(board, sessionId)) return false;
  return true;
}

function targetOwnedByMeTolerant(filePath, sessionId) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch {
    return false;
  }
  const match = raw.match(/"session_id"\s*:\s*"([^"]*)"/);
  if (sessionId) return !!match && match[1] === sessionId;
  return true;
}

function lintViaCcm(filePath) {
  let result;
  try {
    result = spawnSync(CCM_BIN, ['board', 'lint', '--board', filePath, '--raw', '--json'], {
      encoding: 'utf8',
      timeout: 15000,
    });
  } catch {
    return null;
  }
  if (!result || result.error || result.signal) return null;
  let parsed;
  try {
    parsed = JSON.parse(result.stdout || '');
  } catch {
    return null;
  }
  const data = parsed && typeof parsed === 'object' ? parsed.data : null;
  if (!data || typeof data !== 'object' || !Array.isArray(data.violations)) return null;
  if (data.violations.length === 0) return { report: '', hasHard: false };
  const report = typeof data.report === 'string' ? data.report : '';
  const hasHard = data.violations.some((violation) => violation && violation.level === 'hard');
  return { report, hasHard };
}

// PARITY: rule-board-lint-tag-protocol
function advisory(strength, body) {
  return `<advisory source="board-lint" strength="${strength === 'strong' ? 'strong' : 'weak'}">\n${body}\n</advisory>`;
}

function context(message) {
  process.stdout.write(`${JSON.stringify({ kind: 'context', context: message })}\n`);
}

function inputFilePath(input) {
  if (!input || typeof input !== 'object') return '';
  return input.file_path || input.path || input.filename || '';
}

function candidatePaths(payload, home) {
  // kimi-code matcher is Write|Edit|MultiEdit. Bash redirects that mutate boards are blocked earlier
  // by board-guard (PreToolUse deny); lint does not need to cover them here.
  // NOTE: on kimi, PostToolUse hook output is discarded (fireAndForgetTrigger) — this lint advisory
  // may not reach the model context; board-guard's PreToolUse deny is the authoritative gate.
  const tool = payload.tool || {};
  const input = tool.input || {};
  const name = tool.name || '';
  if (name === 'Write' || name === 'Edit' || name === 'MultiEdit') {
    const filePath = inputFilePath(input);
    return pathIsBoard(filePath, home) ? [path.resolve(filePath)] : [];
  }
  return [];
}

function main() {
  const payload = readJson();
  if (payload.event !== 'post-tool-use') return;
  const sessionId = payload.session && payload.session.id ? payload.session.id : '';
  const home = resolveHome(process.env);
  const reports = [];
  for (const filePath of candidatePaths(payload, home)) {
    const verdict = targetIsMyActiveBoard(filePath, sessionId);
    if (verdict === false) continue;
    if (verdict === true) {
      if (!isArmed(home, sessionId)) continue;
    } else if (!targetOwnedByMeTolerant(filePath, sessionId)) {
      continue;
    }
    const outcome = lintViaCcm(filePath);
    if (!outcome || !outcome.report) continue;
    reports.push(advisory(outcome.hasHard ? 'strong' : 'weak', outcome.report));
  }
  if (reports.length === 0) return;
  context(reports.join('\n\n'));
}

try {
  main();
} catch {
  process.exit(0);
}
