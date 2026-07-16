#!/usr/bin/env node
'use strict';

const { codexSevenDayOnly } = require('./machine-quota-semantics.js');

const QUOTA_STATES = new Set(['healthy', 'tight', 'exhausted', 'unknown']);
const QUOTA_EDGES = new Set([
  'entered_tight',
  'entered_exhausted',
  'became_unknown',
  'recovered',
  'reset',
]);
const FRESHNESS = new Set(['fresh', 'soft-stale', 'hard-stale', 'unknown']);
const SAFE_NAME = /^[a-z0-9][a-z0-9_.:-]{0,127}$/;
const SAFE_PROVENANCE = /^[A-Za-z0-9][A-Za-z0-9_./:-]{0,127}$/;
const SAFE_REVISION = /^sha256:[0-9a-f]{64}$/;
const SAFE_REASON = /^[A-Z0-9][A-Z0-9_:-]{0,127}$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const RESET_MARKER_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const SENSITIVE_KEY = /(?:^|_)(?:account|email|identity|fingerprint|credential|token|secret|argv|env|path|balance|used_pct|used_percentage|provider_response|raw)(?:_|$)/i;
const SENSITIVE_VALUE = /(?:\bBearer\s+|\bsk-[A-Za-z0-9_-]{8,}|\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b|\/home\/|\/Users\/|\\Users\\|eyJhbGciOi)/i;
const DELIVERY_PROVENANCE_FIELDS = [
  'subscription_id',
  'session_id',
  'session_epoch',
  'origin',
  'capability',
  'source_policy_revision',
  'consent_provenance_ref',
];

function record(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function exactOrSubsetKeys(value, required, allowed) {
  if (!record(value)) return false;
  const keys = Object.keys(value);
  return required.every((key) => keys.includes(key)) && keys.every((key) => allowed.includes(key));
}

function safeName(value) {
  return typeof value === 'string' && SAFE_NAME.test(value);
}

function safeRevision(value) {
  return typeof value === 'string' && SAFE_REVISION.test(value);
}

function validResetMarker(value) {
  if (typeof value !== 'string' || !RESET_MARKER_UTC.test(value)) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().replace('.000Z', 'Z') === value;
}

function containsPrivate(value, key = '') {
  if (key && SENSITIVE_KEY.test(key)) return true;
  if (typeof value === 'string') return SENSITIVE_VALUE.test(value);
  if (Array.isArray(value)) return value.some((entry) => containsPrivate(entry));
  if (!record(value)) return false;
  return Object.entries(value).some(([childKey, child]) => containsPrivate(child, childKey));
}

function rebuildDeliveryProvenance(value, current) {
  if (!exactOrSubsetKeys(value, DELIVERY_PROVENANCE_FIELDS, DELIVERY_PROVENANCE_FIELDS)) return null;
  if (!record(current)) return null;
  if (!DELIVERY_PROVENANCE_FIELDS.every((key) => typeof value[key] === 'string' && value[key].length > 0)) return null;
  for (const key of ['subscription_id', 'session_id', 'session_epoch', 'origin', 'capability']) {
    if (value[key] !== current[key]) return null;
  }
  if (value.source_policy_revision.length > 256 || /\s/.test(value.source_policy_revision)) return null;
  if (value.consent_provenance_ref.length > 256 || !value.consent_provenance_ref.startsWith('ccm://') || /\s/.test(value.consent_provenance_ref)) return null;
  const rebuilt = Object.fromEntries(DELIVERY_PROVENANCE_FIELDS.map((key) => [key, value[key]]));
  return containsPrivate(rebuilt) ? null : rebuilt;
}

function rebuildWindow(value) {
  if (!exactOrSubsetKeys(value, ['kind', 'name', 'duration_sec'], ['kind', 'name', 'duration_sec'])) return null;
  if (!safeName(value.kind) || !safeName(value.name)) return null;
  if (!Number.isSafeInteger(value.duration_sec) || value.duration_sec <= 0) return null;
  return { kind: value.kind, name: value.name, duration_sec: value.duration_sec };
}

function rebuildTarget(value) {
  const required = ['harness_id', 'surface_id', 'provider_id', 'window'];
  if (!exactOrSubsetKeys(value, required, required)) return null;
  if (!['harness_id', 'surface_id', 'provider_id'].every((key) => safeName(value[key]))) return null;
  const window = rebuildWindow(value.window);
  if (!window) return null;
  const rebuilt = {
    harness_id: value.harness_id,
    surface_id: value.surface_id,
    provider_id: value.provider_id,
    window,
  };
  return rebuilt;
}

function rebuildSource(value) {
  const fields = ['collector_id', 'source_schema', 'auth_source'];
  if (!exactOrSubsetKeys(value, fields, fields)) return null;
  if (!fields.every((key) => typeof value[key] === 'string' && SAFE_PROVENANCE.test(value[key]))) return null;
  return Object.fromEntries(fields.map((key) => [key, value[key]]));
}

function edgeMatchesState(edge, current) {
  if (edge === 'entered_tight') return current === 'tight';
  if (edge === 'entered_exhausted') return current === 'exhausted';
  if (edge === 'became_unknown') return current === 'unknown';
  if (edge === 'recovered') return current === 'healthy';
  return edge === 'reset';
}

function rebuildQuotaDelta(value) {
  const required = [
    'schema',
    'producer',
    'delta_revision',
    'scope_digest',
    'target',
    'quota_scope_digest',
    'source',
    'previous_state',
    'current_state',
    'edge',
    'decision_revision',
    'observation_revision',
    'freshness',
    'reason_codes',
    'reset_marker',
  ];
  const optional = ['observed_at', 'valid_until'];
  if (!exactOrSubsetKeys(value, required, [...required, ...optional])) return null;
  if (value.schema !== 'ccm/machine-quota-decision-delta/v1') return null;
  if (value.producer !== 'machine-wide-quota-observer') return null;
  if (!safeRevision(value.delta_revision) || !safeRevision(value.scope_digest)) return null;
  if (!safeRevision(value.decision_revision) || !safeRevision(value.observation_revision)) return null;
  const target = rebuildTarget(value.target);
  const source = rebuildSource(value.source);
  if (!target || !source) return null;
  if (value.quota_scope_digest !== null && !safeRevision(value.quota_scope_digest)) return null;
  if (value.previous_state !== null && !QUOTA_STATES.has(value.previous_state)) return null;
  if (!QUOTA_STATES.has(value.current_state) || !QUOTA_EDGES.has(value.edge)) return null;
  if (!edgeMatchesState(value.edge, value.current_state)) return null;
  if (!FRESHNESS.has(value.freshness)) return null;
  if (!Array.isArray(value.reason_codes) || !value.reason_codes.every((code) => typeof code === 'string' && SAFE_REASON.test(code))) return null;
  if (new Set(value.reason_codes).size !== value.reason_codes.length) return null;
  if (!codexSevenDayOnly(target, value.reason_codes, [
    ...Object.values(source),
    ...(value.reset_marker === null ? [] : [value.reset_marker]),
  ])) return null;
  if (value.reset_marker !== null && !validResetMarker(value.reset_marker)) return null;
  for (const key of optional) {
    if (value[key] !== undefined && (typeof value[key] !== 'string' || !ISO_UTC.test(value[key]) || !Number.isFinite(Date.parse(value[key])))) return null;
  }

  const rebuilt = {
    schema: value.schema,
    producer: value.producer,
    delta_revision: value.delta_revision,
    scope_digest: value.scope_digest,
    target,
    quota_scope_digest: value.quota_scope_digest,
    source,
    previous_state: value.previous_state,
    current_state: value.current_state,
    edge: value.edge,
    decision_revision: value.decision_revision,
    observation_revision: value.observation_revision,
    freshness: value.freshness,
    reason_codes: [...value.reason_codes],
    reset_marker: value.reset_marker,
    ...(value.observed_at === undefined ? {} : { observed_at: value.observed_at }),
    ...(value.valid_until === undefined ? {} : { valid_until: value.valid_until }),
  };
  return containsPrivate(rebuilt) ? null : rebuilt;
}

function quotaStrength(edge) {
  return edge === 'recovered' || edge === 'reset' ? 'weak' : 'strong';
}

function sanitizeInboxItems(items) {
  if (!Array.isArray(items)) return [];
  const out = [];
  const quotaSeen = new Set();
  for (const item of items) {
    if (!record(item)) continue;
    if (item.kind !== 'quota_state_change') {
      out.push(item);
      continue;
    }
    if (containsPrivate(item) || !safeName(item.id)) continue;
    const payload = rebuildQuotaDelta(item.payload);
    if (!payload) continue;
    const quotaKey = `${payload.producer}\0${payload.scope_digest}\0${payload.delta_revision}`;
    if (quotaSeen.has(quotaKey)) continue;
    quotaSeen.add(quotaKey);
    const target = payload.target;
    out.push({
      id: item.id,
      kind: 'quota_state_change',
      strength: quotaStrength(payload.edge),
      summary: `Machine quota ${target.harness_id}/${target.surface_id}/${target.provider_id}: ${payload.edge} (${payload.current_state}).`,
      payload,
      delivery_provenance: item.delivery_provenance,
      ...(typeof item.expires_at === 'string' && item.expires_at.length <= 64 ? { expires_at: item.expires_at } : {}),
    });
  }
  return out;
}

function surfaceStateKey(boardPath, sessionEpoch) {
  return Buffer.from(`${String(boardPath || '')}\0${String(sessionEpoch || '')}`, 'utf8').toString('base64url');
}

function selectItemsToSurface(state, key, items, atMs, cooldownSeconds) {
  const current = Array.isArray(items) ? items : [];
  const ids = current.map((item) => item && item.id).filter((id) => typeof id === 'string').sort();
  const prev = record(state[key]) ? state[key] : {};
  const prevIds = Array.isArray(prev.ids) ? prev.ids.filter((id) => typeof id === 'string') : [];
  const seen = new Set(prevIds);
  const fresh = current.filter((item) => typeof item.id === 'string' && !seen.has(item.id));
  const last = typeof prev.last_surface_at_ms === 'number' ? prev.last_surface_at_ms : 0;
  const cooled = atMs - last >= cooldownSeconds * 1000;
  const selected = fresh.length > 0 ? fresh : current.length > 0 && cooled ? current : [];
  state[key] = {
    ids,
    last_surface_at_ms: selected.length > 0 ? atMs : last,
  };
  return selected;
}

module.exports = {
  rebuildDeliveryProvenance,
  rebuildQuotaDelta,
  sanitizeInboxItems,
  selectItemsToSurface,
  surfaceStateKey,
};
