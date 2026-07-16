#!/usr/bin/env node
// coordination-inbox.js — Stop-time read-only delivery surface for coordination.inbox.
//
// The hook lists unconsumed notifications through ccm, wraps them with ADR-018 tags, and never
// acknowledges them. A hook-owned sidecar suppresses repeat delivery without touching the board.

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { advisory, directive, runHook } = require('./hook-common.js');
const deliveryHelperPath = [
  path.resolve(__dirname, '../../../_shared/coordination-inbox-delivery.js'),
  path.resolve(__dirname, '../_shared/coordination-inbox-delivery.js'),
].find((candidate) => fs.existsSync(candidate));
const {
  rebuildDeliveryProvenance,
  sanitizeInboxItems,
  selectItemsToSurface,
  surfaceStateKey,
} = require(deliveryHelperPath);
// PARITY: rule-coordination-inbox-machine-quota-delta
// PARITY: rule-coordination-inbox-machine-quota-scope-dedup
// PARITY: rule-coordination-inbox-machine-quota-read-boundary
// PARITY: rule-coordination-inbox-machine-quota-no-account-mutation

const CCM_BIN = process.env.CCM_BIN || 'ccm';
const STATE_FILE =
  process.env.CC_MASTER_INBOX_SURFACE_STATE ||
  path.join(process.env.CC_MASTER_HOME || path.join(process.env.HOME || '', '.cc_master'), '.cc-master-coordination-inbox-surface.json');
const COOLDOWN_RAW = process.env.CC_MASTER_INBOX_SURFACE_COOLDOWN_SEC || '';
const NOW_OVERRIDE = process.env.CC_MASTER_NOW || '';

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
  } catch (_e) {
    return {};
  }
}

function writeState(state) {
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, `${JSON.stringify(state)}\n`, { mode: 0o600 });
  } catch (_e) {
    /* fail-silent */
  }
}

function itemsToSurface(boardPath, sessionEpoch, items, atMs) {
  const key = surfaceStateKey(boardPath, sessionEpoch);
  const state = readState();
  const selected = selectItemsToSurface(state, key, items, atMs, cooldownSec());
  writeState(state);
  return selected;
}

function callCcm(homeDir, args) {
  let result;
  try {
    result = spawnSync(CCM_BIN, args, {
      encoding: 'utf8',
      timeout: 10000,
      env: Object.assign({}, process.env, { CC_MASTER_HOME: homeDir }),
    });
  } catch (_e) {
    return null;
  }
  if (!result || result.error || result.signal || result.status !== 0) return null;
  let parsed;
  try {
    parsed = JSON.parse(result.stdout || '');
  } catch (_e) {
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

function listUnconsumed(homeDir, boardPath, origin, sessionId) {
  // PARITY: rule-coordination-inbox-subscription-fail-closed
  // PARITY: rule-coordination-inbox-current-subscription
  const currentData = callCcm(homeDir, [
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
  const listData = callCcm(homeDir, [
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

function strengthOf(item) {
  return item.strength === 'strong' || item.strength === 'weak' ? item.strength : 'weak';
}

function payloadLine(item) {
  if (!item.payload || typeof item.payload !== 'object' || Array.isArray(item.payload)) return '';
  try {
    return `\nPayload: ${JSON.stringify(item.payload)}`;
  } catch (_e) {
    return '';
  }
}

function provenanceLine(item) {
  try {
    return `\nDelivery provenance: ${JSON.stringify(item.delivery_provenance)}`;
  } catch (_e) {
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

function body(ctx) {
  if (!ctx.boards || ctx.boards.length === 0) return;
  const blocks = [];
  const atMs = nowMs();

  for (const entry of ctx.boards) {
    // PARITY: rule-coordination-inbox-read-only
    const listed = listUnconsumed(ctx.homeDir, entry.path, 'claude-code', ctx.sid);
    if (!listed) continue;
    // PARITY: rule-coordination-inbox-repeat-suppression
    const selected = itemsToSurface(
      entry.path,
      listed.current.session_epoch,
      listed.items,
      atMs,
    );
    for (const item of selected) blocks.push(tagged(item));
  }

  if (!blocks.length) return;
  return { additionalContext: blocks.join('\n') };
}

runHook({
  event: 'Stop',
  arm: 'boards',
  preGate(ctx) {
    return !!(ctx.obj && ctx.obj.stop_hook_active === true);
  },
  body,
});
