#!/usr/bin/env node
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CCM_BIN = process.env.CCM_BIN || 'ccm';

// PARITY: rule-usage-pacing-tag-protocol — ADR-018 标签协议在 codex 侧的本地等价包装（无共享 hook-common
// 可 require，故本文件本地复刻；与 claude-code usage-pacing.js 的 advisory(source,strength,body) 语义一致）。
function advisory(source, strength, body) {
  const s = strength === 'strong' ? 'strong' : 'weak';
  return `<advisory source="${source}" strength="${s}">\n${String(body)}\n</advisory>`;
}
// PACING_STRENGTH — 与 claude-code usage-pacing.js 的映射表字节级一致（PARITY:
// rule-usage-pacing-tag-protocol）：stop_7d/stop_5h/throttle 高 stakes → strong；switch 可逆低 stakes → weak。
const PACING_STRENGTH = { stop_7d: 'strong', stop_5h: 'strong', throttle: 'strong', switch: 'weak' };

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
  if (verdict === 'stop_5h' || verdict === 'stop_7d') return 'pacing_stop';
  if (verdict === 'throttle' && strength === 'strong') return 'pacing_throttle';
  if (verdict === 'switch') return 'pacing_switch';
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
