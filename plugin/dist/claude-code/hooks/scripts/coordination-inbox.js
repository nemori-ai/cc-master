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

function boardKey(boardPath) {
  return Buffer.from(String(boardPath || ''), 'utf8').toString('base64url');
}

function shouldSurface(boardPath, ids, atMs) {
  if (!ids.length) return false;
  const key = boardKey(boardPath);
  const state = readState();
  const prev = state[key] && typeof state[key] === 'object' ? state[key] : {};
  const prevIds = Array.isArray(prev.ids) ? prev.ids.filter((x) => typeof x === 'string') : [];
  const prevSet = new Set(prevIds);
  const hasNew = ids.some((id) => !prevSet.has(id));
  const last = typeof prev.last_surface_at_ms === 'number' ? prev.last_surface_at_ms : 0;
  const cooled = atMs - last >= cooldownSec() * 1000;
  if (!hasNew && !cooled) return false;
  state[key] = { ids, last_surface_at_ms: atMs };
  writeState(state);
  return true;
}

function listUnconsumed(homeDir, boardPath) {
  let result;
  try {
    result = spawnSync(CCM_BIN, [
      'coordination',
      'inbox',
      'list',
      '--unconsumed',
      '--json',
      '--home',
      homeDir,
      '--board',
      boardPath,
    ], {
      encoding: 'utf8',
      timeout: 10000,
      env: Object.assign({}, process.env, { CC_MASTER_HOME: homeDir }),
    });
  } catch (_e) {
    return [];
  }
  if (!result || result.error || result.signal || result.status !== 0) return [];
  let parsed;
  try {
    parsed = JSON.parse(result.stdout || '');
  } catch (_e) {
    return [];
  }
  const inbox = parsed && parsed.data && Array.isArray(parsed.data.inbox) ? parsed.data.inbox : [];
  return inbox.filter((item) => item && typeof item === 'object' && typeof item.id === 'string');
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

function itemBody(item) {
  const lines = [
    `[coordination inbox] ${item.kind || 'unknown'} ${item.id}: ${item.summary || '(no summary)'}`,
  ];
  if (item.expires_at) lines.push(`Expires: ${item.expires_at}`);
  lines.push(`After reading and acting, run: ccm coordination inbox ack ${item.id}`);
  return `${lines.join('\n')}${payloadLine(item)}`;
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
    const items = listUnconsumed(ctx.homeDir, entry.path);
    const ids = items.map((item) => item.id).sort();
    // PARITY: rule-coordination-inbox-repeat-suppression
    if (!shouldSurface(entry.path, ids, atMs)) continue;
    for (const item of items) blocks.push(tagged(item));
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
