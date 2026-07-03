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

function advise(home) {
  const env = { ...process.env, CC_MASTER_HOME: home };
  let result;
  try {
    result = spawnSync(CCM_BIN, ['usage', 'advise', '--json', '--home', home], {
      encoding: 'utf8',
      timeout: 15000,
      env,
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
  if (!data || typeof data !== 'object' || typeof data.verdict !== 'string') return null;
  if (data.available !== true) return null;
  return data;
}

function fmtPct(value) {
  return typeof value === 'number' ? `${value}%` : 'unknown';
}

function messageFor(data) {
  const p5 = fmtPct(data.window_5h_pct);
  const p7 = fmtPct(data.window_7d_pct);
  if (data.verdict === 'hold') return '';
  if (data.verdict === 'throttle') {
    return `cc-master Codex pacing advisory: current quota is near the limit (5h ${p5}, 7d ${p7}). Slow down: reduce WIP, defer non-critical work, or use a cheaper model tier where available.`;
  }
  if (data.verdict === 'switch') {
    return `cc-master Codex pacing advisory: ccm recommends switching quota/account (5h ${p5}, 7d ${p7}, candidate ${data.switch_candidate || 'unknown'}), but Codex account-pool switching is not implemented in this adapter yet. Treat this as a signal to throttle or ask the user.`;
  }
  if (data.verdict === 'stop_5h') {
    return `cc-master Codex pacing advisory: 5h quota is exhausted or unsafe (5h ${p5}, 7d ${p7}). Pause new dispatch until reset${data.nearest_reset ? ` at ${data.nearest_reset}` : ''}.`;
  }
  if (data.verdict === 'stop_7d') {
    return `cc-master Codex pacing advisory: 7d quota is at the hard total gate (5h ${p5}, 7d ${p7}). Pause new dispatch and surface the decision to the user.`;
  }
  return '';
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
  const data = advise(home);
  if (!data) return;
  const msg = messageFor(data);
  if (msg) system(msg);
}

try {
  main();
} catch {
  process.exit(0);
}
