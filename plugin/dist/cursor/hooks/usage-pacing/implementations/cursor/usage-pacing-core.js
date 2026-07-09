#!/usr/bin/env node
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CCM_BIN = process.env.CCM_BIN || 'ccm';

// PARITY: rule-usage-pacing-tag-protocol — ADR-018 advisory wrapper for Cursor stop (kind:system →
// launcher followup_message per ENVELOPE.md). Local copy: no shared hook-common require from Cursor cores.
function advisory(source, strength, body) {
  const s = strength === 'strong' ? 'strong' : 'weak';
  return `<advisory source="${source}" strength="${s}">\n${String(body)}\n</advisory>`;
}

// Cursor billing-period pacing only — never 5h/7d/switch. Both actionable verdicts are strong.
const PACING_STRENGTH = { throttle: 'strong', stop_billing_period: 'strong' };

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

function parseIsoMs(value) {
  if (typeof value !== 'string' || !value) return null;
  const t = Date.parse(value.replace('Z', '+00:00'));
  return Number.isNaN(t) ? null : t;
}

function isoUtcFromMs(ms) {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function expiresFor(data) {
  const nearest = data && typeof data.nearest_reset === 'string' ? data.nearest_reset : '';
  const nowMs = Date.now();
  const nearestMs = parseIsoMs(nearest);
  if (nearestMs !== null && nearestMs > nowMs) return nearest;
  return isoUtcFromMs(nowMs + 60 * 60 * 1000);
}

function durableKindFor(verdict, strength) {
  if (verdict === 'stop_billing_period') return 'pacing_stop';
  if (verdict === 'throttle' && strength === 'strong') return 'pacing_throttle';
  return null;
}

function notifyCoordination(home, boardPath, data, strength, message) {
  const kind = durableKindFor(data.verdict, strength);
  if (!kind || !boardPath) return false;
  // PARITY: rule-usage-pacing-dual-delivery
  const payload = JSON.stringify({
    producer: 'usage-pacing',
    p3_mode: 'single-board usage advise; P4 replaces this producer with pool-aware arbitrate',
    verdict: data.verdict,
    route: 'coordination-inbox',
    advice: data,
  });
  let result;
  try {
    result = spawnSync(CCM_BIN, [
      'coordination',
      'notify',
      '--kind',
      kind,
      '--summary',
      message,
      '--strength',
      strength,
      '--payload',
      payload,
      '--expires',
      expiresFor(data),
      '--json',
      '--home',
      home,
      '--board',
      boardPath,
    ], {
      encoding: 'utf8',
      timeout: 10000,
      env: { ...process.env, CC_MASTER_HOME: home },
    });
  } catch {
    return false;
  }
  return !!result && !result.error && !result.signal && result.status === 0;
}

function fmtPct(value) {
  return typeof value === 'number' ? `${value}%` : 'unknown';
}

function messageFor(data) {
  const pBp = fmtPct(data.window_billing_period_pct);
  if (data.verdict === 'hold') return '';
  if (data.verdict === 'throttle') {
    return `cc-master Cursor pacing advisory: billing_period quota is near the limit (${pBp}). Slow down: reduce WIP, defer non-critical work, or use a cheaper model tier where available.`;
  }
  if (data.verdict === 'stop_billing_period') {
    return `cc-master Cursor pacing advisory: billing_period quota is at the hard gate (${pBp}). Pause new dispatch until billing reset${data.nearest_reset ? ` at ${data.nearest_reset}` : ''}. Surface whether to continue spending to the user.`;
  }
  // Defensive: Claude/Codex verdicts must not leak into Cursor messaging.
  if (
    data.verdict === 'switch' ||
    data.verdict === 'stop_5h' ||
    data.verdict === 'stop_7d'
  ) {
    return '';
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
  if (!msg) return;
  const strength =
    data.strength === 'strong' || data.strength === 'weak'
      ? data.strength
      : PACING_STRENGTH[data.verdict] || 'weak';
  const boardPath = process.env.CC_MASTER_BOARD || (payload.board && payload.board.path) || '';
  if (notifyCoordination(home, boardPath, data, strength, msg)) return;
  system(advisory('usage-pacing', strength, msg));
}

try {
  main();
} catch {
  process.exit(0);
}
