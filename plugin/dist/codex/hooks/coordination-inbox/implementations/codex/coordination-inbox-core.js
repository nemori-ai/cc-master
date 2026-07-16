#!/usr/bin/env node
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  rebuildDeliveryProvenance,
  sanitizeInboxItems,
  selectItemsToSurface,
  surfaceStateKey,
} = require('../../../_shared/coordination-inbox-delivery.js');
// PARITY: rule-coordination-inbox-machine-quota-delta
// PARITY: rule-coordination-inbox-machine-quota-scope-dedup
// PARITY: rule-coordination-inbox-machine-quota-read-boundary
// PARITY: rule-coordination-inbox-machine-quota-no-account-mutation

const CCM_BIN = process.env.CCM_BIN || 'ccm';
const STATE_FILE =
  process.env.CC_MASTER_INBOX_SURFACE_STATE ||
  path.join(process.env.CC_MASTER_HOME || path.join(process.env.HOME || os.homedir(), '.cc_master'), '.cc-master-coordination-inbox-surface.json');
const COOLDOWN_RAW = process.env.CC_MASTER_INBOX_SURFACE_COOLDOWN_SEC || '';
const NOW_OVERRIDE = process.env.CC_MASTER_NOW || '';

function readJson() {
  const raw = fs.readFileSync(0, 'utf8');
  return raw ? JSON.parse(raw) : {};
}

function parseIsoMs(value) {
  if (typeof value !== 'string' || !value) return null;
  const t = Date.parse(value.replace('Z', '+00:00'));
  return Number.isNaN(t) ? null : t;
}

function nowMs() {
  const forced = NOW_OVERRIDE ? parseIsoMs(NOW_OVERRIDE) : null;
  return forced === null ? Date.now() : forced;
}

function cooldownSec() {
  if (!COOLDOWN_RAW) return 900;
  const n = Number(COOLDOWN_RAW);
  return Number.isFinite(n) && n >= 0 ? n : 900;
}

function readState() {
  try {
    const obj = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    return obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : {};
  } catch {
    return {};
  }
}

function writeState(state) {
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, `${JSON.stringify(state)}\n`, { mode: 0o600 });
  } catch {
    // Repeat suppression must never affect Stop.
  }
}

function itemsToSurface(boardPath, sessionEpoch, items, atMs) {
  const key = surfaceStateKey(boardPath, sessionEpoch);
  const state = readState();
  const selected = selectItemsToSurface(state, key, items, atMs, cooldownSec());
  writeState(state);
  return selected;
}

function callCcm(home, args) {
  let result;
  try {
    result = spawnSync(CCM_BIN, args, {
      encoding: 'utf8',
      timeout: 10000,
      env: { ...process.env, CC_MASTER_HOME: home },
    });
  } catch {
    return null;
  }
  if (!result || result.error || result.signal || result.status !== 0) return null;
  let parsed;
  try {
    parsed = JSON.parse(result.stdout || '');
  } catch {
    return null;
  }
  return parsed && parsed.ok === true && parsed.data && typeof parsed.data === 'object'
    ? parsed.data
    : null;
}

function validSubscription(value, expected, requireState) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  for (const field of ['subscription_id', 'session_id', 'session_epoch', 'origin', 'capability']) {
    if (typeof value[field] !== 'string' || !value[field]) return false;
  }
  if (value.session_id !== expected.session_id) return false;
  if (value.origin !== expected.origin || value.capability !== 'coordination-inbox') return false;
  if (expected.subscription_id && value.subscription_id !== expected.subscription_id) return false;
  if (expected.session_epoch && value.session_epoch !== expected.session_epoch) return false;
  return !requireState || value.state === 'current';
}

function listUnconsumed(home, boardPath, origin, sessionId) {
  // PARITY: rule-coordination-inbox-subscription-fail-closed
  // PARITY: rule-coordination-inbox-current-subscription
  const currentData = callCcm(home, [
    'coordination',
    'subscription',
    'current',
    '--board',
    boardPath,
    '--origin',
    origin,
    '--session-id',
    sessionId,
    '--capability',
    'coordination-inbox',
    '--json',
    '--no-input',
  ]);
  const current = currentData && currentData.subscription;
  if (!validSubscription(current, { session_id: sessionId, origin }, true)) return null;
  // PARITY: rule-coordination-inbox-bounded-list
  const listData = callCcm(home, [
    'coordination',
    'inbox',
    'list',
    '--current-subscription',
    '--board',
    boardPath,
    '--origin',
    origin,
    '--session-id',
    sessionId,
    '--session-epoch',
    current.session_epoch,
    '--capability',
    'coordination-inbox',
    '--unconsumed',
    '--json',
    '--no-input',
  ]);
  const selected = listData && listData.subscription;
  if (!validSubscription(selected, current, false)) return null;
  const inbox = Array.isArray(listData.inbox) ? listData.inbox : [];
  // PARITY: rule-coordination-inbox-delivery-provenance
  const items = inbox.map((item) => {
    if (!item || typeof item !== 'object' || typeof item.id !== 'string') return null;
    const deliveryProvenance = rebuildDeliveryProvenance(item.delivery_provenance, current);
    return deliveryProvenance ? { ...item, delivery_provenance: deliveryProvenance } : null;
  }).filter(Boolean);
  return { current, items: sanitizeInboxItems(items) };
}

function advisory(source, strength, body) {
  const s = strength === 'strong' ? 'strong' : 'weak';
  return `<advisory source="${source}" strength="${s}">\n${String(body)}\n</advisory>`;
}

function directive(source, body) {
  return `<directive source="${source}">\n${String(body)}\n</directive>`;
}

function strengthOf(item) {
  return item.strength === 'strong' || item.strength === 'weak' ? item.strength : 'weak';
}

function payloadLine(item) {
  if (!item.payload || typeof item.payload !== 'object' || Array.isArray(item.payload)) return '';
  try {
    return `\nPayload: ${JSON.stringify(item.payload)}`;
  } catch {
    return '';
  }
}

function provenanceLine(item) {
  try {
    return `\nDelivery provenance: ${JSON.stringify(item.delivery_provenance)}`;
  } catch {
    return '';
  }
}

function itemBody(item) {
  const lines = [
    `[coordination inbox] ${item.kind || 'unknown'} ${item.id}: ${item.summary || '(no summary)'}`,
  ];
  if (item.expires_at) lines.push(`Expires: ${item.expires_at}`);
  lines.push('After reading and acting, acknowledge it explicitly with ccm coordination inbox ack using the id above.');
  return `${lines.join('\n')}${payloadLine(item)}${provenanceLine(item)}`;
}

function tagged(item) {
  // PARITY: rule-coordination-inbox-tag-protocol
  if (item.kind === 'pacing_stop' || item.kind === 'hitl_turn') {
    return directive('coordination-inbox', itemBody(item));
  }
  return advisory('coordination-inbox', strengthOf(item), itemBody(item));
}

function system(message) {
  process.stdout.write(`${JSON.stringify({ kind: 'system', message })}\n`);
}

function main() {
  const payload = readJson();
  if (payload.event !== 'stop') return;
  if (payload.raw && payload.raw.stop_hook_active === true) return;
  const home = process.env.CC_MASTER_HOME || path.join(process.env.HOME || os.homedir(), '.cc_master');
  const boardPath = process.env.CC_MASTER_BOARD || (payload.board && payload.board.path) || '';
  const sessionId = payload.session_id || (payload.session && payload.session.id) || '';
  if (!boardPath) return;

  // PARITY: rule-coordination-inbox-read-only
  const listed = listUnconsumed(home, boardPath, 'codex', sessionId);
  if (!listed) return;
  // PARITY: rule-coordination-inbox-repeat-suppression
  const selected = itemsToSurface(
    boardPath,
    listed.current.session_epoch,
    listed.items,
    nowMs(),
  );
  if (!selected.length) return;
  system(selected.map(tagged).join('\n'));
}

try {
  main();
} catch {
  process.exit(0);
}
