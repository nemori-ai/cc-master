#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  decisionLine,
  uncoveredChanges,
} = require('../../../_shared/machine-quota-status.js');

const CCM_BIN = process.env.CCM_BIN || 'ccm';

// PARITY: rule-usage-pacing-tag-protocol
// PARITY: rule-usage-pacing-origin-local-floor
// PARITY: rule-usage-pacing-machine-wide-dedup
// PARITY: rule-usage-pacing-no-automatic-switch
// PARITY: rule-usage-pacing-dual-delivery
// PARITY: rule-usage-pacing-agent-safe-target-line
function advisory(body) {
  return `<advisory source="usage-pacing" strength="strong">\n${String(body)}\n</advisory>`;
}

function readJson() {
  const raw = fs.readFileSync(0, 'utf8');
  return raw ? JSON.parse(raw) : {};
}

function resolveHome(env) {
  return env.CC_MASTER_HOME || path.join(env.HOME || os.homedir(), '.cc_master');
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
  const dir = path.join(home, 'boards');
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return false; }
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.board.json')) continue;
    try {
      const board = JSON.parse(fs.readFileSync(path.join(dir, entry.name), 'utf8'));
      if (boardMatches(board, sessionId)) return true;
    } catch {
      // A corrupt unrelated board never arms the hook.
    }
  }
  return false;
}

function system(message) {
  process.stdout.write(`${JSON.stringify({ kind: 'system', message })}\n`);
}

function main() {
  const payload = readJson();
  if (payload.event !== 'stop') return;
  if (payload.raw && payload.raw.stop_hook_active === true) return;
  const sessionId = payload.session && payload.session.id ? payload.session.id : '';
  const home = resolveHome(process.env);
  if (!isArmed(home, sessionId)) return;
  const boardPath = process.env.CC_MASTER_BOARD || (payload.board && payload.board.path) || '';
  const decisions = uncoveredChanges({
    ccmBin: CCM_BIN,
    home,
    harness: 'cursor',
    sessionId,
    boardPath,
  });
  if (!decisions.length) return;
  const lines = decisions.map(decisionLine);
  lines.push('Cursor decisions stay surface-scoped: Cursor IDE and Cursor Agent are never inferred from one another, and no account switch is performed. Machine-wide fan-out remains the durable delivery authority.');
  system(advisory(lines.join('\n')));
}

try { main(); } catch { process.exit(0); }
