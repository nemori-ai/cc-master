#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { codexSevenDayOnly } = require('./machine-quota-semantics.js');

const STATES = new Set(['healthy', 'tight', 'exhausted', 'unknown']);
const FRESHNESS = new Set(['fresh', 'soft-stale', 'hard-stale', 'unknown']);
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const SAFE_HARNESS = /^[a-z0-9][a-z0-9-]{0,63}$/;
const SAFE_REASON = /^[A-Z0-9][A-Z0-9_:-]{0,127}$/;
const SAFE_DIGEST = /^sha256:[0-9a-f]{64}$/;
const SAFE_PROVENANCE = /^[A-Za-z0-9][A-Za-z0-9_./:-]{0,127}$/;

function record(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value, keys) {
  return record(value) && Object.keys(value).sort().join('\0') === [...keys].sort().join('\0');
}

function safeId(value) {
  return typeof value === 'string' && SAFE_ID.test(value);
}

function rebuildTarget(value) {
  if (!exactKeys(value, ['harness_id', 'surface_id', 'provider_id', 'window'])) return null;
  if (typeof value.harness_id !== 'string' || !SAFE_HARNESS.test(value.harness_id)) return null;
  if (!safeId(value.surface_id) || !safeId(value.provider_id)) return null;
  if (!exactKeys(value.window, ['kind', 'name', 'duration_sec'])) return null;
  if (!safeId(value.window.kind) || !safeId(value.window.name) || !Number.isSafeInteger(value.window.duration_sec) || value.window.duration_sec <= 0) return null;
  return {
    harness_id: value.harness_id,
    surface_id: value.surface_id,
    provider_id: value.provider_id,
    window: { kind: value.window.kind, name: value.window.name, duration_sec: value.window.duration_sec },
  };
}

function rebuildSource(value) {
  if (!exactKeys(value, ['collector_id', 'source_schema', 'auth_source'])) return null;
  if (![value.collector_id, value.source_schema, value.auth_source].every((entry) =>
    typeof entry === 'string' && SAFE_PROVENANCE.test(entry)
  )) return null;
  return {
    collector_id: value.collector_id,
    source_schema: value.source_schema,
    auth_source: value.auth_source,
  };
}

function rebuildDecision(value) {
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
  const target = rebuildTarget(value.target);
  const source = rebuildSource(value.source);
  if (!target || !source || ![value.scope_digest, value.decision_revision, value.observation_revision].every((digest) => SAFE_DIGEST.test(digest))) return null;
  if (value.quota_scope_digest !== null && !SAFE_DIGEST.test(value.quota_scope_digest)) return null;
  if (!STATES.has(value.state) || !FRESHNESS.has(value.freshness)) return null;
  if (!Array.isArray(value.reason_codes) || !value.reason_codes.every((code) => typeof code === 'string' && SAFE_REASON.test(code))) return null;
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

function parseStatus(stdout) {
  let parsed;
  try { parsed = JSON.parse(stdout || ''); } catch { return null; }
  if (!exactKeys(parsed, ['schema', 'summary', 'readings', 'capacity_views']) || parsed.schema !== 'ccm/machine-quota-status/v1') return null;
  const summary = parsed.summary;
  if (!exactKeys(summary, ['schema', 'decisions']) || summary.schema !== 'ccm/machine-quota-summary/v1' || !Array.isArray(summary.decisions)) return null;
  const decisions = summary.decisions.map(rebuildDecision);
  if (decisions.some((decision) => decision === null)) return null;
  const scopes = decisions.map((decision) => decision.scope_digest);
  if (new Set(scopes).size !== scopes.length) return null;
  for (let index = 1; index < scopes.length; index += 1) {
    if (scopes[index - 1].localeCompare(scopes[index]) >= 0) return null;
  }
  return decisions;
}

function readCachedStatus(options) {
  let child;
  try {
    child = spawnSync(options.ccmBin || 'ccm', [
      'quota',
      'status',
      '--machine-wide',
      '--json',
      '--home',
      options.home,
    ], {
      encoding: 'utf8',
      timeout: 5000,
      shell: false,
      env: { ...process.env, CC_MASTER_HOME: options.home, CC_MASTER_NO_AUTOINSTALL: '1' },
    });
  } catch {
    return null;
  }
  if (!child || child.error || child.signal || child.status !== 0) return null;
  return parseStatus(child.stdout);
}

function statePath(home, harness, sessionId, boardPath) {
  const digest = crypto.createHash('sha256').update(`${harness}\0${sessionId}\0${boardPath}`).digest('hex');
  return path.join(home, 'hooks', 'usage-pacing-machine-quota', `${digest}.json`);
}

function readState(file) {
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    return record(value) && record(value.revisions) ? value : { revisions: {} };
  } catch {
    return { revisions: {} };
  }
}

function remember(file, revisions) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    fs.writeFileSync(file, `${JSON.stringify({ schema: 'cc-master/usage-pacing-machine-quota-sidecar/v1', revisions })}\n`, { mode: 0o600 });
    fs.chmodSync(file, 0o600);
  } catch {
    // Disposable dedupe state must not affect Stop.
  }
}

function uncoveredChanges(options) {
  const decisions = readCachedStatus(options);
  if (!decisions) return [];
  const relevant = decisions.filter((decision) =>
    decision.target.harness_id === options.harness &&
    decision.state !== 'healthy' &&
    decision.fanout_covered === false,
  );
  const file = statePath(options.home, options.harness, options.sessionId, options.boardPath);
  const previous = readState(file).revisions;
  const selected = relevant.filter((decision) => previous[decision.scope_digest] !== decision.decision_revision);
  const revisions = {};
  for (const decision of relevant) revisions[decision.scope_digest] = decision.decision_revision;
  remember(file, revisions);
  return selected;
}

function decisionLine(decision) {
  const target = decision.target;
  const reasons = decision.reason_codes.length ? `; reasons=${decision.reason_codes.join(',')}` : '';
  const window = `${target.window.kind}/${target.window.name}/${target.window.duration_sec}s`;
  const capacity = decision.quota_scope_digest === null ? 'unknown' : decision.quota_scope_digest;
  return `${target.harness_id}/${target.surface_id}/${target.provider_id}: scope=${decision.scope_digest}; quota_scope=${capacity}; window=${window}; state=${decision.state}; freshness=${decision.freshness}; source=${decision.source.collector_id}/${decision.source.source_schema}/${decision.source.auth_source}; revision=${decision.decision_revision}${reasons}`;
}

module.exports = {
  decisionLine,
  parseStatus,
  uncoveredChanges,
};
