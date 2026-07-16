#!/usr/bin/env node
'use strict';

// PARITY: rule-orchestrator-context-ccm-owned
// PARITY: rule-orchestrator-context-cached-only
// PARITY: rule-orchestrator-context-bounded-redacted
// PARITY: rule-orchestrator-context-dedup
// PARITY: rule-orchestrator-context-fail-open
// PARITY: rule-orchestrator-context-shadow-only
// PARITY: rule-orchestrator-context-cursor-surfaces
// PARITY: rule-orchestrator-context-machine-quota-summary

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { codexSevenDayOnly } = require('./machine-quota-semantics.js');
const { secretShapedValue } = require('./orchestrator-context-private-value.js');

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

const CURSOR_STATES = new Set(['only-ide', 'only-agent', 'both', 'neither']);
const CURSOR_SURFACE_SPECS = [
  {
    surface_id: 'cursor-ide-plugin', surface: 'host-native', role: 'master-origin',
    installed_source: 'cursor-ide/plugin-install-probe/v1',
    authentication_source: null,
    eligibility_sources: [
      'cursor-ide/plugin-host-qualification/v1',
      'cursor-ide/origin-session-attestation/v1',
    ],
  },
  {
    surface_id: 'cursor-agent-cli', surface: 'cli-headless', role: 'worker-target',
    installed_source: 'cursor-agent/version-help-probe/v1',
    authentication_source: 'cursor-agent/status-json/v1',
    eligibility_sources: [
      'cursor-agent/status-json/v1',
      'cursor-agent/model-entitlement-collector/v1',
      'cursor-agent/quota-collector/v1',
      'cursor-agent/sandbox-runtime-qualification/v1',
      'cursor-agent/transport-qualification/v1',
      'ccm/supervisor-process-tree-qualification/v1',
    ],
  },
];
const PUBLIC_PATH_VALUES = new Set([
  'ccm/origin-context/v1',
  'ccm/cursor-surface-context/v1',
  'ccm/machine-quota-summary/v1',
  ...CURSOR_SURFACE_SPECS.flatMap((spec) => [
    spec.installed_source,
    ...spec.eligibility_sources,
  ]),
]);

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
  if (PUBLIC_PATH_VALUES.has(value)) return false;
  if (secretShapedValue(value)) return true;
  if (/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(value)) return true;
  return value.includes('/') || value.includes('\\');
}

function cursorState(ideInstalled, agentInstalled) {
  if (ideInstalled && agentInstalled) return 'both';
  if (ideInstalled) return 'only-ide';
  if (agentInstalled) return 'only-agent';
  return 'neither';
}

function rebuildCursorSurface(value, spec) {
  if (!exactKeys(value, ['surface_id', 'harness', 'surface', 'role', 'installed', 'auth_state', 'role_eligible', 'blocker_codes', 'provenance'])) return null;
  if (value.surface_id !== spec.surface_id || value.harness !== 'cursor' || value.surface !== spec.surface || value.role !== spec.role) return null;
  if (typeof value.installed !== 'boolean' || !['authenticated', 'unauthenticated', 'unknown'].includes(value.auth_state) || typeof value.role_eligible !== 'boolean') return null;
  if (value.auth_state !== 'unknown' && !value.installed) return null;
  if (spec.surface_id === 'cursor-ide-plugin' && value.auth_state !== 'unknown') return null;
  if (spec.surface_id === 'cursor-agent-cli' && value.role_eligible && value.auth_state !== 'authenticated') return null;
  if (value.role_eligible && !value.installed) return null;
  if (!Array.isArray(value.blocker_codes) || !value.blocker_codes.every(safeCode)) return null;
  if (new Set(value.blocker_codes).size !== value.blocker_codes.length) return null;
  if (value.role_eligible !== (value.blocker_codes.length === 0)) return null;
  if (!exactKeys(value.provenance, ['installed', 'authentication', 'role_eligibility'])) return null;
  if (value.provenance.installed !== spec.installed_source) return null;
  if (value.provenance.authentication !== null && value.provenance.authentication !== spec.authentication_source) return null;
  if (value.auth_state !== 'unknown' && value.provenance.authentication !== spec.authentication_source) return null;
  if (!Array.isArray(value.provenance.role_eligibility)) return null;
  if (new Set(value.provenance.role_eligibility).size !== value.provenance.role_eligibility.length) return null;
  if (!value.provenance.role_eligibility.every((source) => spec.eligibility_sources.includes(source))) return null;
  if (value.role_eligible && value.provenance.role_eligibility.length !== spec.eligibility_sources.length) return null;
  return {
    surface_id: value.surface_id,
    harness: 'cursor',
    surface: value.surface,
    role: value.role,
    installed: value.installed,
    auth_state: value.auth_state,
    role_eligible: value.role_eligible,
    blocker_codes: [...value.blocker_codes],
    provenance: {
      installed: value.provenance.installed,
      authentication: value.provenance.authentication,
      role_eligibility: [...value.provenance.role_eligibility],
    },
  };
}

function rebuildCursorSurfaces(value) {
  if (!exactKeys(value, ['schema', 'state', 'surfaces'])) return null;
  if (value.schema !== 'ccm/cursor-surface-context/v1' || !CURSOR_STATES.has(value.state)) return null;
  if (!Array.isArray(value.surfaces) || value.surfaces.length !== 2) return null;
  const surfaces = value.surfaces.map((surface, index) =>
    rebuildCursorSurface(surface, CURSOR_SURFACE_SPECS[index]),
  );
  if (surfaces.some((surface) => surface === null)) return null;
  if (value.state !== cursorState(surfaces[0].installed, surfaces[1].installed)) return null;
  return { schema: value.schema, state: value.state, surfaces };
}

const MACHINE_QUOTA_STATES = new Set(['healthy', 'tight', 'exhausted', 'unknown']);
const MACHINE_QUOTA_FRESHNESS = new Set(['fresh', 'soft-stale', 'hard-stale', 'unknown']);
const MACHINE_QUOTA_REASON = /^[A-Z0-9][A-Z0-9_:-]{0,127}$/;
const MACHINE_QUOTA_DIGEST = /^sha256:[0-9a-f]{64}$/;
const MACHINE_QUOTA_PROVENANCE = /^[A-Za-z0-9][A-Za-z0-9_./:-]{0,127}$/;

function rebuildMachineQuotaTarget(value) {
  if (!exactKeys(value, ['harness_id', 'surface_id', 'provider_id', 'window'])) return null;
  if (!safeHarness(value.harness_id) || !safeId(value.surface_id) || !safeId(value.provider_id)) return null;
  if (!exactKeys(value.window, ['kind', 'name', 'duration_sec'])) return null;
  if (!safeId(value.window.kind) || !safeId(value.window.name) || !Number.isSafeInteger(value.window.duration_sec) || value.window.duration_sec <= 0) return null;
  return {
    harness_id: value.harness_id,
    surface_id: value.surface_id,
    provider_id: value.provider_id,
    window: { kind: value.window.kind, name: value.window.name, duration_sec: value.window.duration_sec },
  };
}

function rebuildMachineQuotaSource(value) {
  if (!exactKeys(value, ['collector_id', 'source_schema', 'auth_source'])) return null;
  if (![value.collector_id, value.source_schema, value.auth_source].every((entry) =>
    typeof entry === 'string' && MACHINE_QUOTA_PROVENANCE.test(entry)
  )) return null;
  return {
    collector_id: value.collector_id,
    source_schema: value.source_schema,
    auth_source: value.auth_source,
  };
}

function rebuildMachineQuotaDecision(value) {
  if (!exactKeys(value, [
    'scope_digest',
    'target',
    'quota_scope_digest',
    'state',
    'freshness',
    'reason_codes',
    'source',
    'decision_revision',
    'observation_revision',
    'fanout_covered',
  ])) return null;
  if (![value.scope_digest, value.decision_revision, value.observation_revision].every((digest) => MACHINE_QUOTA_DIGEST.test(digest))) return null;
  if (value.quota_scope_digest !== null && !MACHINE_QUOTA_DIGEST.test(value.quota_scope_digest)) return null;
  const target = rebuildMachineQuotaTarget(value.target);
  const source = rebuildMachineQuotaSource(value.source);
  if (!target || !source || !MACHINE_QUOTA_STATES.has(value.state) || !MACHINE_QUOTA_FRESHNESS.has(value.freshness)) return null;
  if (!Array.isArray(value.reason_codes) || !value.reason_codes.every((code) => typeof code === 'string' && MACHINE_QUOTA_REASON.test(code))) return null;
  if (new Set(value.reason_codes).size !== value.reason_codes.length || typeof value.fanout_covered !== 'boolean') return null;
  if (!codexSevenDayOnly(target, value.reason_codes)) return null;
  return {
    scope_digest: value.scope_digest,
    target,
    quota_scope_digest: value.quota_scope_digest,
    state: value.state,
    freshness: value.freshness,
    reason_codes: [...value.reason_codes],
    source,
    decision_revision: value.decision_revision,
    observation_revision: value.observation_revision,
    fanout_covered: value.fanout_covered,
  };
}

function rebuildMachineQuotaSummary(value) {
  if (!exactKeys(value, ['schema', 'decisions'])) return null;
  if (value.schema !== 'ccm/machine-quota-summary/v1' || !Array.isArray(value.decisions)) return null;
  const decisions = value.decisions.map(rebuildMachineQuotaDecision);
  if (decisions.some((decision) => decision === null)) return null;
  const scopes = decisions.map((decision) => decision.scope_digest);
  if (new Set(scopes).size !== scopes.length) return null;
  for (let index = 1; index < scopes.length; index += 1) {
    if (scopes[index - 1].localeCompare(scopes[index]) >= 0) return null;
  }
  return { schema: value.schema, decisions };
}

function containsPrivateValue(value, key = '') {
  if (typeof value === 'string') {
    if (key === 'source_schema' && MACHINE_QUOTA_PROVENANCE.test(value)) {
      return secretShapedValue(value) || /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(value);
    }
    return privateShapedString(value);
  }
  if (Array.isArray(value)) return value.some((entry) => containsPrivateValue(entry, key));
  if (!record(value)) return false;
  return Object.entries(value).some(([childKey, child]) => containsPrivateValue(child, childKey));
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
  if (value && value.cursor_surfaces !== undefined) keys.push('cursor_surfaces');
  if (value && value.machine_quota !== undefined) keys.push('machine_quota');
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
  const cursorSurfaces = value.cursor_surfaces === undefined
    ? undefined
    : rebuildCursorSurfaces(value.cursor_surfaces);
  if (value.cursor_surfaces !== undefined && cursorSurfaces === null) return null;
  const machineQuota = value.machine_quota === undefined
    ? undefined
    : rebuildMachineQuotaSummary(value.machine_quota);
  if (value.machine_quota !== undefined && machineQuota === null) return null;
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
    if (value.available !== true || value.freshness.state !== 'fresh' || value.contract_activation !== 'enabled') return null;
    if (
      candidate.availability !== 'available' ||
      candidate.auth !== 'authenticated' ||
      candidate.model !== 'available' ||
      candidate.runtime !== 'healthy' ||
      candidate.quota === 'unknown' ||
      candidate.quota === 'exhausted' ||
      (candidate.surface === 'cli-headless' && candidate.quota !== 'ample') ||
      candidate.qualifications.some((entry) => entry.status !== 'pass')
    ) return null;
  }
  if (!exactKeys(value.truncation, ['applied', 'omitted_candidates', 'omitted_routes', 'omitted_warnings', 'omitted_quota_scopes', 'max_bytes'])) return null;
  if (typeof value.truncation.applied !== 'boolean' || value.truncation.max_bytes !== MAX_BYTES) return null;
  const truncationCounts = ['omitted_candidates', 'omitted_routes', 'omitted_warnings', 'omitted_quota_scopes'];
  for (const key of truncationCounts) {
    if (!Number.isSafeInteger(value.truncation[key]) || value.truncation[key] < 0) return null;
  }
  if (value.truncation.applied !== truncationCounts.some((key) => value.truncation[key] > 0)) return null;
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
    ...(cursorSurfaces === undefined ? {} : { cursor_surfaces: cursorSurfaces }),
    ...(machineQuota === undefined ? {} : { machine_quota: machineQuota }),
    routes,
    warnings: [...value.warnings],
    truncation: {
      applied: value.truncation.applied,
      omitted_candidates: value.truncation.omitted_candidates,
      omitted_routes: value.truncation.omitted_routes,
      omitted_warnings: value.truncation.omitted_warnings,
      omitted_quota_scopes: value.truncation.omitted_quota_scopes,
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
  const rebuilt = rebuildPayload(payload, harness, value.revisions);
  if (!rebuilt) return null;
  const canonicalContent = `<ambient source="orchestrator-context">${JSON.stringify(rebuilt)}</ambient>`;
  if (canonicalContent !== value.content) return null;
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
