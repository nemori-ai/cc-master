#!/usr/bin/env node
'use strict';

// PARITY: rule-orchestrator-context-ccm-owned
// PARITY: rule-orchestrator-context-cached-only
// PARITY: rule-orchestrator-context-bounded-redacted
// PARITY: rule-orchestrator-context-dedup
// PARITY: rule-orchestrator-context-fail-open
// PARITY: rule-orchestrator-context-shadow-only

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const MAX_BYTES = 4096;

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function boardMatches(board, sid) {
  const owner = board && typeof board === 'object' && board.owner;
  return !!owner && owner.active === true && (!sid || owner.session_id === sid);
}

function activeBoard(home, sid) {
  const boardsDir = path.resolve(home, 'boards');
  const supplied = process.env.CC_MASTER_BOARD;
  if (supplied) {
    const resolved = path.resolve(supplied);
    if (!resolved.startsWith(`${boardsDir}${path.sep}`) || !resolved.endsWith('.board.json')) return null;
    return boardMatches(readJson(resolved), sid) ? resolved : null;
  }
  let names;
  try { names = fs.readdirSync(boardsDir).filter((name) => name.endsWith('.board.json')).sort(); } catch { return null; }
  const matches = names
    .map((name) => path.join(boardsDir, name))
    .filter((file) => boardMatches(readJson(file), sid));
  return matches.length === 1 ? matches[0] : null;
}

function sha256(value) {
  return `sha256:${crypto.createHash('sha256').update(value, 'utf8').digest('hex')}`;
}

function safeDelivery(value, harness) {
  if (!value || typeof value !== 'object' || value.schema !== 'ccm/origin-context-delivery/v1') return null;
  if (value.cached_only !== true || value.shadow_only !== true || value.dispatch_enabled !== false) return null;
  if (value.origin_harness !== harness || typeof value.content !== 'string') return null;
  const bytes = Buffer.byteLength(value.content, 'utf8');
  if (bytes > MAX_BYTES || value.content_bytes !== bytes || value.content_sha256 !== sha256(value.content)) return null;
  const match = /^<ambient source="orchestrator-context">([\s\S]*)<\/ambient>$/.exec(value.content);
  if (!match) return null;
  let payload;
  try { payload = JSON.parse(match[1]); } catch { return null; }
  if (!payload || payload.schema !== 'ccm/origin-context/v1' || payload.dispatch_enabled !== false || payload.shadow_only !== true) return null;
  const serialized = JSON.stringify(payload);
  if (/"(?:credential|token|ref|path|balance|argv|env|transcript|raw_response)"\s*:/i.test(serialized)) return null;
  if (/\bsk-[A-Za-z0-9_-]{16,}\b|\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/.test(serialized)) return null;
  if (/(?:^|["\s])\/(?:home|Users|etc|tmp|var)\//.test(serialized)) return null;
  return value;
}

function sidecarPath(home, harness, sid, board) {
  const key = crypto.createHash('sha256').update(`${harness}\0${sid}\0${board}`).digest('hex');
  return path.join(home, 'hooks', 'orchestrator-context', `${key}.json`);
}

function priorHash(file) {
  const value = readJson(file);
  return value && typeof value.content_sha256 === 'string' ? value.content_sha256 : '';
}

function remember(file, delivery) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    fs.chmodSync(path.dirname(file), 0o700);
    fs.writeFileSync(file, `${JSON.stringify({ schema: 'cc-master/origin-context-sidecar/v1', content_sha256: delivery.content_sha256 })}\n`, { mode: 0o600 });
    fs.chmodSync(file, 0o600);
  } catch { /* disposable, non-authoritative sidecar */ }
}

function main() {
  if (process.env.CC_MASTER_ORCHESTRATOR_CONTEXT === '0') return;
  let input = {};
  try { input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); } catch { return; }
  const harness = process.env.CC_MASTER_HARNESS || input.harness || 'claude-code';
  if (!['claude-code', 'codex', 'cursor'].includes(harness)) return;
  const sid = process.env.CC_MASTER_SESSION_ID || (input.session && input.session.id) || input.session_id || '';
  const home = process.env.CC_MASTER_HOME || path.join(process.env.HOME || '', '.cc_master');
  const board = activeBoard(home, sid);
  if (!board) return;
  const cache = path.join(home, 'cache', 'machine-context-cache.json');
  const now = new Date().toISOString().replace('.000Z', 'Z');
  const args = ['orchestrator', 'context', '--cached-only', '--agent-visible', '--as-of', now, '--harness', harness, '--board', board, '--json'];
  try { if (fs.statSync(cache).isFile()) args.push('--snapshot', `@${cache}`); } catch { /* explicit unknown */ }
  const requestedTimeout = Number(process.env.CC_MASTER_ORCHESTRATOR_CONTEXT_TIMEOUT_MS || 1500);
  const timeout = Number.isFinite(requestedTimeout) ? Math.min(5000, Math.max(50, requestedTimeout)) : 1500;
  let child;
  try {
    child = spawnSync(process.env.CCM_BIN || 'ccm', args, {
      encoding: 'utf8', timeout, killSignal: 'SIGKILL', shell: false,
      env: { PATH: process.env.PATH || '', HOME: process.env.HOME || '', CC_MASTER_HOME: home, CC_MASTER_NO_AUTOINSTALL: '1' },
    });
  } catch { return; }
  if (child.error || child.status !== 0 || !child.stdout) return;
  let outer;
  try {
    const parsed = JSON.parse(child.stdout);
    outer = parsed && parsed.ok === true ? parsed.data : parsed;
  } catch { return; }
  const delivery = safeDelivery(outer, harness);
  if (!delivery) return;
  const event = process.env.CC_MASTER_HOOK_EVENT || input.event || input.hook_event_name || '';
  const initial = String(event).toLowerCase().includes('sessionstart') || String(event).toLowerCase().includes('session-start');
  const sidecar = sidecarPath(home, harness, sid, board);
  if (!initial && priorHash(sidecar) === delivery.content_sha256) return;
  remember(sidecar, delivery);
  if (harness === 'claude-code') {
    process.stdout.write(`${JSON.stringify({ hookSpecificOutput: { hookEventName: input.hook_event_name || (initial ? 'SessionStart' : 'PostToolBatch'), additionalContext: delivery.content } })}\n`);
  } else {
    process.stdout.write(`${JSON.stringify({ kind: 'context', context: delivery.content })}\n`);
  }
}

try { main(); } catch { /* all origin-context failures are fail-open */ }
