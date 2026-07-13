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
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const SAFE_HARNESS = /^[a-z0-9][a-z0-9-]{0,63}$/;
const SAFE_CODE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

const ENUMS = {
  surface: new Set(['host-native', 'cli-headless']),
  availability: new Set(['available', 'unavailable', 'unknown']),
  quota: new Set(['ample', 'tight', 'exhausted', 'unknown']),
  auth: new Set(['authenticated', 'unauthenticated', 'expired', 'unknown']),
  model: new Set(['available', 'unavailable', 'unknown']),
  runtime: new Set(['healthy', 'unhealthy', 'unknown']),
  qualification: new Set(['pass', 'fail', 'unknown']),
  freshness: new Set(['fresh', 'stale', 'unknown']),
  activation: new Set(['legacy', 'enabled', 'invalid']),
  outcome: new Set(['same-native', 'same-harness-cli', 'other-harness-cli', 'origin-stay', 'no-route']),
};

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function boardMatches(board, sid) {
  const owner = board && typeof board === 'object' && board.owner;
  return !!owner && owner.active === true && (!sid || owner.session_id === sid);
}

function containedBoardFile(boardsDir, candidate) {
  try {
    const realBoardsDir = fs.realpathSync(boardsDir);
    if (!fs.statSync(realBoardsDir).isDirectory()) return null;
    const lexical = path.resolve(candidate);
    if (!lexical.endsWith('.board.json') || !fs.lstatSync(lexical).isFile()) return null;
    const real = fs.realpathSync(lexical);
    if (!real.startsWith(`${realBoardsDir}${path.sep}`) || !fs.statSync(real).isFile()) return null;
    return real;
  } catch {
    return null;
  }
}

function activeBoard(home, sid) {
  const boardsDir = path.resolve(home, 'boards');
  const supplied = process.env.CC_MASTER_BOARD;
  if (supplied) {
    const resolved = containedBoardFile(boardsDir, supplied);
    return resolved && boardMatches(readJson(resolved), sid) ? resolved : null;
  }
  let entries;
  try { entries = fs.readdirSync(boardsDir, { withFileTypes: true }); } catch { return null; }
  const matches = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.board.json'))
    .map((entry) => containedBoardFile(boardsDir, path.join(boardsDir, entry.name)))
    .filter((file) => file && boardMatches(readJson(file), sid))
    .sort();
  return matches.length === 1 ? matches[0] : null;
}

function sha256(value) {
  return `sha256:${crypto.createHash('sha256').update(value, 'utf8').digest('hex')}`;
}

function record(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value, keys) {
  return record(value) && Object.keys(value).sort().join('\0') === [...keys].sort().join('\0');
}

function safeId(value) {
  return typeof value === 'string' && SAFE_ID.test(value);
}

function safeHarness(value) {
  return typeof value === 'string' && SAFE_HARNESS.test(value);
}

function safeCode(value) {
  return typeof value === 'string' && SAFE_CODE.test(value);
}

function strictIso(value) {
  if (typeof value !== 'string' || !ISO_UTC.test(value)) return false;
  const epoch = Date.parse(value);
  return Number.isFinite(epoch) && new Date(epoch).toISOString().replace('.000Z', 'Z') === value;
}

function privateShapedString(value) {
  if (value === 'ccm/origin-context/v1') return false;
  if (/\bsk-[A-Za-z0-9_-]{16,}\b/i.test(value)) return true;
  if (/\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{8,}\b/i.test(value)) return true;
  if (/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}\b/i.test(value)) return true;
  if (/\b(?:api[\s_-]*key|credentials?|(?:access|refresh)[\s_-]*token|client[\s_-]*secret|secret[\s_-]*key)\b\s*[:=]/i.test(value)) return true;
  if (/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(value)) return true;
  return value.includes('/') || value.includes('\\');
}

function containsPrivateValue(value) {
  if (typeof value === 'string') return privateShapedString(value);
  if (Array.isArray(value)) return value.some(containsPrivateValue);
  if (!record(value)) return false;
  return Object.values(value).some(containsPrivateValue);
}

function rebuildQualification(value) {
  if (!exactKeys(value, ['predicate', 'status'])) return null;
  if (!safeCode(value.predicate) || !ENUMS.qualification.has(value.status)) return null;
  return { predicate: value.predicate, status: value.status };
}

function rebuildCandidate(value) {
  if (!exactKeys(value, ['candidate_id', 'harness', 'surface', 'availability', 'quota', 'auth', 'model', 'runtime', 'qualifications'])) return null;
  if (!safeId(value.candidate_id) || !safeHarness(value.harness)) return null;
  if (!ENUMS.surface.has(value.surface) || !ENUMS.availability.has(value.availability) || !ENUMS.quota.has(value.quota) || !ENUMS.auth.has(value.auth) || !ENUMS.model.has(value.model) || !ENUMS.runtime.has(value.runtime)) return null;
  if (!Array.isArray(value.qualifications)) return null;
  const qualifications = value.qualifications.map(rebuildQualification);
  if (qualifications.some((entry) => entry === null)) return null;
  const predicates = qualifications.map((entry) => entry.predicate);
  if (new Set(predicates).size !== predicates.length) return null;
  return {
    candidate_id: value.candidate_id,
    harness: value.harness,
    surface: value.surface,
    availability: value.availability,
    quota: value.quota,
    auth: value.auth,
    model: value.model,
    runtime: value.runtime,
    qualifications,
  };
}

function rebuildSelected(value) {
  if (!exactKeys(value, ['candidate_id', 'harness', 'surface'])) return null;
  if (!safeId(value.candidate_id) || !safeHarness(value.harness) || !ENUMS.surface.has(value.surface)) return null;
  return { candidate_id: value.candidate_id, harness: value.harness, surface: value.surface };
}

function rebuildRoute(value, harness) {
  if (!exactKeys(value, ['task_id', 'status', 'eligible', 'outcome', 'selected', 'reason_codes'])) return null;
  if (!safeId(value.task_id) || value.status !== 'ready' || typeof value.eligible !== 'boolean' || !ENUMS.outcome.has(value.outcome)) return null;
  const selected = value.selected === null ? null : rebuildSelected(value.selected);
  if (value.selected !== null && selected === null) return null;
  if (!Array.isArray(value.reason_codes) || !value.reason_codes.every(safeCode)) return null;
  if (value.eligible !== (selected !== null)) return null;
  if ((value.outcome === 'no-route') !== (selected === null)) return null;
  if (
    selected &&
    ['same-native', 'origin-stay'].includes(value.outcome) &&
    (selected.surface !== 'host-native' || selected.harness !== harness)
  ) return null;
  if (
    selected &&
    value.outcome === 'same-harness-cli' &&
    (selected.surface !== 'cli-headless' || selected.harness !== harness)
  ) return null;
  if (
    selected &&
    value.outcome === 'other-harness-cli' &&
    (selected.surface !== 'cli-headless' || selected.harness === harness)
  ) return null;
  return {
    task_id: value.task_id,
    status: 'ready',
    eligible: value.eligible,
    outcome: value.outcome,
    selected,
    reason_codes: [...value.reason_codes],
  };
}

function rebuildPayload(value, harness, outerRevisions) {
  const keys = ['schema', 'cached_only', 'shadow_only', 'dispatch_enabled', 'origin_harness', 'available', 'revisions', 'freshness', 'contract_activation', 'candidates', 'routes', 'warnings', 'truncation'];
  if (!exactKeys(value, keys)) return null;
  if (value.schema !== 'ccm/origin-context/v1' || value.cached_only !== true || value.shadow_only !== true || value.dispatch_enabled !== false || value.origin_harness !== harness || typeof value.available !== 'boolean') return null;
  if (!exactKeys(value.revisions, ['board', 'machine']) || !safeId(value.revisions.board) || !safeId(value.revisions.machine)) return null;
  if (value.revisions.board !== outerRevisions.board || value.revisions.machine !== outerRevisions.machine) return null;
  if (!exactKeys(value.freshness, ['state', 'valid_until']) || !ENUMS.freshness.has(value.freshness.state) || !strictIso(value.freshness.valid_until)) return null;
  if (!ENUMS.activation.has(value.contract_activation)) return null;
  if (!Array.isArray(value.candidates) || !Array.isArray(value.routes) || value.routes.length > 12 || !Array.isArray(value.warnings)) return null;
  const candidates = value.candidates.map(rebuildCandidate);
  const routes = value.routes.map((entry) => rebuildRoute(entry, harness));
  if (candidates.some((entry) => entry === null) || routes.some((entry) => entry === null) || !value.warnings.every(safeCode)) return null;
  const candidateIds = candidates.map((entry) => entry.candidate_id);
  const taskIds = routes.map((entry) => entry.task_id);
  if (new Set(candidateIds).size !== candidateIds.length || new Set(taskIds).size !== taskIds.length) return null;
  for (const route of routes) {
    if (!route.selected) continue;
    const candidate = candidates.find((entry) => entry.candidate_id === route.selected.candidate_id);
    if (
      !candidate ||
      candidate.harness !== route.selected.harness ||
      candidate.surface !== route.selected.surface
    ) return null;
  }
  if (!exactKeys(value.truncation, ['applied', 'omitted_candidates', 'omitted_routes', 'omitted_warnings', 'max_bytes'])) return null;
  if (typeof value.truncation.applied !== 'boolean' || value.truncation.max_bytes !== MAX_BYTES) return null;
  for (const key of ['omitted_candidates', 'omitted_routes', 'omitted_warnings']) {
    if (!Number.isSafeInteger(value.truncation[key]) || value.truncation[key] < 0) return null;
  }
  const rebuilt = {
    schema: value.schema,
    cached_only: true,
    shadow_only: true,
    dispatch_enabled: false,
    origin_harness: value.origin_harness,
    available: value.available,
    revisions: { board: value.revisions.board, machine: value.revisions.machine },
    freshness: { state: value.freshness.state, valid_until: value.freshness.valid_until },
    contract_activation: value.contract_activation,
    candidates,
    routes,
    warnings: [...value.warnings],
    truncation: {
      applied: value.truncation.applied,
      omitted_candidates: value.truncation.omitted_candidates,
      omitted_routes: value.truncation.omitted_routes,
      omitted_warnings: value.truncation.omitted_warnings,
      max_bytes: MAX_BYTES,
    },
  };
  return containsPrivateValue(rebuilt) ? null : rebuilt;
}

function safeDelivery(value, harness) {
  if (!exactKeys(value, ['schema', 'cached_only', 'shadow_only', 'dispatch_enabled', 'origin_harness', 'revisions', 'content_sha256', 'content_bytes', 'content'])) return null;
  if (value.schema !== 'ccm/origin-context-delivery/v1') return null;
  if (value.cached_only !== true || value.shadow_only !== true || value.dispatch_enabled !== false) return null;
  if (value.origin_harness !== harness || typeof value.content !== 'string') return null;
  if (!exactKeys(value.revisions, ['board', 'machine']) || !safeId(value.revisions.board) || !safeId(value.revisions.machine)) return null;
  const bytes = Buffer.byteLength(value.content, 'utf8');
  if (bytes > MAX_BYTES || value.content_bytes !== bytes || value.content_sha256 !== sha256(value.content)) return null;
  const match = /^<ambient source="orchestrator-context">([\s\S]*)<\/ambient>$/.exec(value.content);
  if (!match) return null;
  let payload;
  try { payload = JSON.parse(match[1]); } catch { return null; }
  if (!rebuildPayload(payload, harness, value.revisions)) return null;
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
