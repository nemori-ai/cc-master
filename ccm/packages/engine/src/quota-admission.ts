// Quota admission is deliberately a pure domain seam.  It derives authority from immutable
// observations/evidence; collectors, locks, durable publication and worker spawn live outside the
// engine.  In particular, Codex' retired five-hour window is filtered here and can never become a
// hard gate or a reservation input.

type Value = Readonly<Record<string, unknown>>;

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function list(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(object) : [];
}

function number(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function instant(value: unknown): number {
  return typeof value === 'string' ? Date.parse(value) : Number.NaN;
}

function capacityCounted(state: unknown): boolean {
  return ['held', 'committed', 'release_pending', 'orphaned'].includes(String(state));
}

export function evaluateQuotaObservation(input: Value): Record<string, unknown> {
  const provider = String(input.provider ?? '');
  const rule = object(input.provider_window_rule);
  const hardWindow = provider === 'codex' ? 'seven_day' : String(rule.name ?? 'unknown');
  const observations = list(input.observations);
  const ignored =
    provider === 'codex' ? observations.filter((row) => row.window === 'five_hour') : [];
  const candidates = observations.filter((row) => {
    if (ignored.includes(row)) return false;
    if (String(row.window) !== hardWindow) return false;
    if (provider === 'codex' && number(row.duration_sec) !== 604_800) return false;
    if (rule.duration_sec !== undefined && number(row.duration_sec) !== number(rule.duration_sec)) {
      return false;
    }
    return true;
  });

  const revisionsByIdentity = new Map<string, Set<string>>();
  for (const row of candidates) {
    const keys = [row.id, row.observation_id, row.source_sequence]
      .filter((value) => value !== undefined)
      .map(String);
    for (const key of keys) {
      const revisions = revisionsByIdentity.get(key) ?? new Set<string>();
      revisions.add(String(row.revision ?? JSON.stringify(row)));
      revisionsByIdentity.set(key, revisions);
    }
  }
  if ([...revisionsByIdentity.values()].some((revisions) => revisions.size > 1)) {
    return {
      hard_window: hardWindow,
      freshness: 'unknown',
      accepted_observation_ids: [],
      circuit: 'open',
      automatic_spawn_limit: 0,
      blocking_error: 'QUOTA_OBSERVATION_CONFLICT',
    };
  }

  const aggregationKeys = new Set(
    candidates
      .map((row) => row.aggregation_key)
      .filter((value) => value !== undefined)
      .map(String),
  );
  if (aggregationKeys.size > 1) {
    return {
      hard_window: hardWindow,
      freshness: 'unknown',
      accepted_observation_ids: [],
      blocking_error: 'QUOTA_AGGREGATION_MISMATCH',
    };
  }

  const required = Array.isArray(input.required_bucket_ids)
    ? input.required_bucket_ids.map(String)
    : [];
  const accepted = candidates.filter((row) => required.includes(String(row.bucket_id)));
  const acceptedIds = accepted.map((row) => String(row.id ?? row.observation_id));
  const missing = required.filter(
    (bucket) => !accepted.some((row) => String(row.bucket_id) === bucket),
  );
  if (missing.length > 0) {
    return {
      hard_window: hardWindow,
      freshness: 'unknown',
      accepted_observation_ids: acceptedIds,
      ...(ignored.length > 0
        ? { ignored_observation_ids: ignored.map((row) => String(row.id ?? row.observation_id)) }
        : {}),
      ...(accepted.length === 0 && required.length === 1 ? {} : { missing_bucket_ids: missing }),
      blocking_error:
        accepted.length === 0 && required.length === 1
          ? 'QUOTA_REQUIRED_WINDOW_UNKNOWN'
          : 'QUOTA_REQUIRED_BUCKET_UNKNOWN',
    };
  }

  const checkedAt = instant(input.checked_at);
  const profile = object(input.profile);
  const freshTtlSec = profile.fresh_ttl_sec;
  const hardTtlSec = profile.hard_ttl_sec;
  const maxClockSkewSec = profile.max_clock_skew_sec ?? 0;
  const profileValid =
    typeof freshTtlSec === 'number' &&
    Number.isFinite(freshTtlSec) &&
    freshTtlSec > 0 &&
    typeof hardTtlSec === 'number' &&
    Number.isFinite(hardTtlSec) &&
    hardTtlSec > 0 &&
    freshTtlSec <= hardTtlSec &&
    typeof maxClockSkewSec === 'number' &&
    Number.isFinite(maxClockSkewSec) &&
    maxClockSkewSec >= 0;
  const temporal = accepted.map((row) => {
    const observedAt = instant(row.observed_at);
    const validUntil = instant(row.valid_until);
    const resetsAt =
      row.resets_at === undefined ? Number.POSITIVE_INFINITY : instant(row.resets_at);
    return { observedAt, validUntil, resetsAt };
  });
  if (
    !Number.isFinite(checkedAt) ||
    !profileValid ||
    temporal.some(
      ({ observedAt, validUntil, resetsAt }) =>
        !Number.isFinite(observedAt) ||
        !Number.isFinite(validUntil) ||
        validUntil < observedAt ||
        (!Number.isFinite(resetsAt) && resetsAt !== Number.POSITIVE_INFINITY) ||
        resetsAt < observedAt ||
        observedAt > checkedAt + number(maxClockSkewSec) * 1_000,
    )
  ) {
    return {
      hard_window: hardWindow,
      freshness: 'unknown',
      accepted_observation_ids: [],
      ignored_observation_ids: ignored.map((row) => String(row.id ?? row.observation_id)),
      automatic_spawn_limit: 0,
      blocking_error: 'QUOTA_SOURCE_SCHEMA_UNSUPPORTED',
    };
  }
  const freshTtlMs = number(freshTtlSec) * 1_000;
  const hardTtlMs = number(hardTtlSec) * 1_000;
  const ages = temporal.map(({ observedAt }) => Math.max(0, checkedAt - observedAt));
  const expired = temporal.some(
    ({ observedAt, validUntil, resetsAt }) =>
      checkedAt > Math.min(observedAt + hardTtlMs, validUntil, resetsAt),
  );
  if (expired || ages.some((age) => !Number.isFinite(age) || age > hardTtlMs)) {
    return {
      hard_window: hardWindow,
      freshness: 'hard-stale',
      accepted_observation_ids: [],
      ignored_observation_ids: ignored.map((row) => String(row.id ?? row.observation_id)),
      blocking_error: 'QUOTA_HARD_STALE',
    };
  }
  if (ages.some((age) => age > freshTtlMs)) {
    return {
      hard_window: hardWindow,
      freshness: 'soft-stale',
      accepted_observation_ids: [],
      report_observation_ids: acceptedIds,
      refresh_required: true,
      automatic_spawn_limit: 0,
      blocking_error: 'QUOTA_SOFT_STALE',
    };
  }
  return {
    hard_window: hardWindow,
    freshness: 'fresh',
    accepted_observation_ids: acceptedIds,
    ignored_observation_ids: ignored.map((row) => String(row.id ?? row.observation_id)),
    blocking_error: null,
    ...(provider === 'codex' && ignored.length > 0 ? { five_hour_actions: [] } : {}),
  };
}

export function deriveQuotaHeadroom(input: Value): Record<string, unknown> {
  const policy = object(input.policy);
  const ceiling = number(policy.hard_ceiling_used_pct);
  const ceilingValid =
    typeof policy.hard_ceiling_used_pct === 'number' &&
    Number.isFinite(policy.hard_ceiling_used_pct) &&
    policy.hard_ceiling_used_pct > 0 &&
    policy.hard_ceiling_used_pct <= 100;
  const allBuckets = list(input.buckets);
  const requiredKey =
    typeof input.required_aggregation_key === 'string' ? input.required_aggregation_key : undefined;
  const buckets = requiredKey
    ? allBuckets.filter((bucket) => bucket.aggregation_key === requiredKey)
    : allBuckets;
  const perBucket = buckets.map((bucket) => {
    const requiredNumbersValid =
      typeof bucket.used_pct === 'number' &&
      Number.isFinite(bucket.used_pct) &&
      bucket.used_pct >= 0 &&
      bucket.used_pct <= 100;
    const optionalNumbersValid = [
      bucket.active_reserved_pct,
      bucket.safety_margin_pct,
      bucket.projected_p80_pct,
    ].every(
      (value) =>
        value === undefined ||
        (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100),
    );
    const numericInputsValid = ceilingValid && requiredNumbersValid && optionalNumbersValid;
    const used = number(bucket.used_pct);
    const active = number(bucket.active_reserved_pct);
    const margin = number(bucket.safety_margin_pct);
    const p80 = number(bucket.projected_p80_pct);
    const headroom = ceiling - used - active - margin;
    const remaining = headroom - p80;
    const state =
      !numericInputsValid || String(bucket.freshness) !== 'fresh'
        ? 'unknown'
        : used + active >= ceiling
          ? 'exhausted'
          : remaining < 0
            ? 'tight'
            : 'ample';
    return {
      id: bucket.id,
      reservable_headroom_pct: headroom,
      remaining_after_p80_pct: remaining,
      state,
    };
  });
  const states = perBucket.map((bucket) => bucket.state);
  const state =
    states.length === 0
      ? 'unknown'
      : states.includes('unknown')
        ? 'unknown'
        : states.includes('exhausted')
          ? 'exhausted'
          : states.includes('tight')
            ? 'tight'
            : 'ample';
  const blockingReasons =
    state === 'ample'
      ? []
      : [
          state === 'tight'
            ? 'QUOTA_TIGHT'
            : state === 'exhausted'
              ? 'QUOTA_EXHAUSTED'
              : 'QUOTA_REQUIRED_WINDOW_UNKNOWN',
        ];
  const aggregationFields = requiredKey
    ? {
        used_aggregation_keys: [requiredKey],
        ignored_aggregation_keys: [
          ...new Set(
            allBuckets
              .map((bucket) => bucket.aggregation_key)
              .filter((key) => key !== undefined && key !== requiredKey)
              .map(String),
          ),
        ],
      }
    : {};
  return {
    state,
    ...aggregationFields,
    ...(requiredKey ? {} : { per_bucket: perBucket }),
    automatic_spawn_limit: state === 'ample' ? 1 : 0,
    blocking_reasons: blockingReasons,
  };
}

const TERMINAL_PROOF_FIELDS = new Set([
  'schema',
  'proof_revision',
  'reservation_id',
  'reservation_request_hash',
  'attempt_id',
  'run_ref',
  'ticket_digest',
  'journal_ref',
  'journal_revision',
  'journal_terminal',
  'journal_continuous',
  'process_identity',
  'cleanup_complete',
  'evidence_retained',
]);
const TERMINAL_JOURNAL_KINDS = new Set(['succeeded', 'failed', 'cancelled', 'supervisor-lost']);

function nonempty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function validTerminalProof(
  proof: Readonly<Record<string, unknown>>,
  reservation: Readonly<Record<string, unknown>>,
  schema: 'ccm/quota-terminal-evidence/v1' | 'ccm/quota-terminal-audit/v1',
  cleanupComplete: boolean,
): boolean {
  const lineage = object(reservation.run_lineage);
  const proofRevision = schema === 'ccm/quota-terminal-evidence/v1' ? 'terminal-r1' : 'audit-r1';
  return (
    proof.schema === schema &&
    Object.keys(proof).length === TERMINAL_PROOF_FIELDS.size &&
    Object.keys(proof).every((field) => TERMINAL_PROOF_FIELDS.has(field)) &&
    proof.proof_revision === proofRevision &&
    nonempty(reservation.id) &&
    nonempty(proof.reservation_id) &&
    proof.reservation_id === reservation.id &&
    nonempty(reservation.hash) &&
    nonempty(proof.reservation_request_hash) &&
    proof.reservation_request_hash === reservation.hash &&
    nonempty(reservation.attempt_id) &&
    nonempty(proof.attempt_id) &&
    proof.attempt_id === reservation.attempt_id &&
    nonempty(lineage.run_ref) &&
    nonempty(proof.run_ref) &&
    proof.run_ref === lineage.run_ref &&
    nonempty(reservation.ticket_digest) &&
    nonempty(proof.ticket_digest) &&
    proof.ticket_digest === reservation.ticket_digest &&
    nonempty(proof.journal_ref) &&
    nonempty(proof.journal_revision) &&
    proof.journal_revision.startsWith('sha256:') &&
    TERMINAL_JOURNAL_KINDS.has(String(proof.journal_terminal)) &&
    proof.journal_continuous === true &&
    proof.process_identity === 'dead-proven' &&
    proof.cleanup_complete === cleanupComplete &&
    proof.evidence_retained === true
  );
}

export function deriveRolling24h(input: Value): Record<string, unknown> {
  const samples = list(input.samples)
    .filter(
      (sample) =>
        sample.aggregation_key === undefined || sample.aggregation_key === input.aggregation_key,
    )
    .sort((left, right) => instant(left.at) - instant(right.at));
  const byTimestamp = new Map<string, Set<number>>();
  for (const sample of samples) {
    const key = String(sample.at);
    const values = byTimestamp.get(key) ?? new Set<number>();
    values.add(number(sample.used_pct));
    byTimestamp.set(key, values);
  }
  const unavailable = (reason: string, coverageHours?: number): Record<string, unknown> => ({
    state: 'unavailable',
    ...(coverageHours === undefined ? {} : { coverage_hours: coverageHours }),
    confidence: 'none',
    advisory: 'none',
    reason,
    hard_gate_effect: 'none',
  });
  if ([...byTimestamp.values()].some((values) => values.size > 1)) {
    return unavailable('ROLLING24H_SAMPLE_CONFLICT');
  }
  if (samples.length < 2) return unavailable('ROLLING24H_INSUFFICIENT_COVERAGE', 0);
  const end = samples.at(-1) as Record<string, unknown>;
  const asOf = instant(input.as_of);
  const cutoff = asOf - 24 * 60 * 60 * 1_000;
  const eligibleStarts = samples.slice(0, -1).filter((sample) => instant(sample.at) >= cutoff);
  const start = (eligibleStarts[0] ??
    samples.find((sample) => instant(sample.at) <= cutoff) ??
    samples[0]) as Record<string, unknown>;
  const coverageHours = Math.min(
    24,
    (instant(end.at) - Math.max(instant(start.at), cutoff)) / 3_600_000,
  );
  if (coverageHours < 6) return unavailable('ROLLING24H_INSUFFICIENT_COVERAGE', coverageHours);
  const delta = number(end.used_pct) - number(start.used_pct);
  if (delta < 0) return unavailable('ROLLING24H_RESET_CROSSING');
  if (start.fresh_endpoint === false || end.fresh_endpoint === false) {
    return unavailable('ROLLING24H_STALE_ENDPOINT');
  }
  const dailyBudget = 100 / 7;
  const velocity = (delta / coverageHours) * 24;
  const ratio = velocity / dailyBudget;
  const rounded = (value: number, digits = 6): number => Number(value.toFixed(digits));
  return {
    state: 'available',
    coverage_kind: coverageHours >= 24 ? 'full' : 'partial',
    coverage_hours: coverageHours,
    delta_used_pct: delta,
    daily_budget_pct: rounded(dailyBudget),
    observed_daily_velocity_pct: rounded(velocity),
    velocity_ratio: rounded(ratio, 2),
    confidence: coverageHours >= 20 ? 'high' : coverageHours >= 12 ? 'medium' : 'low',
    advisory: ratio > 1 ? 'throttle-risk' : 'none',
    hard_gate_effect: 'none',
  };
}

export function evaluateQuotaReservationTransition(input: Value): Record<string, unknown> {
  const existing = list(input.existing);
  const request = object(input.request);
  if (Object.keys(request).length > 0) {
    const duplicate = existing.find((row) => row.key === request.key);
    const active = existing
      .filter((row) => capacityCounted(row.state))
      .reduce((sum, row) => sum + number(row.amount_pct), 0);
    if (duplicate) {
      if (duplicate.hash !== request.hash) {
        return {
          action: 'rejected',
          error: 'RESERVATION_IDEMPOTENCY_CONFLICT',
          active_reserved_pct: active,
          new_reservation_count: 0,
        };
      }
      return {
        action: 'idempotent-existing',
        reservation_id: duplicate.id,
        state: duplicate.state,
        active_reserved_pct: active,
        new_reservation_count: 0,
      };
    }
    const next = active + number(request.amount_pct);
    if (next > number(input.capacity_pct)) {
      return {
        action: 'rejected',
        error: 'RESERVATION_CAPACITY_CONFLICT',
        active_reserved_pct: active,
        new_reservation_count: 0,
      };
    }
    return {
      action: 'created',
      reservation_id: request.id,
      state: request.state,
      active_reserved_pct: next,
      new_reservation_count: 1,
    };
  }

  const reservation = object(input.reservation);
  if (reservation.state === 'expired' || reservation.state === 'released') {
    return {
      action: 'idempotent-existing',
      reservation_id: reservation.id,
      state: reservation.state,
      capacity_counted_pct: 0,
      automatic_spawn_limit: 0,
      new_reservation_count: 0,
    };
  }
  if (Object.keys(object(input.ticket)).length > 0) {
    return {
      action: 'committed',
      reservation_id: reservation.id,
      state: 'committed',
      claim_authorized: true,
      new_reservation_count: 0,
    };
  }
  const evidence = object(input.launch_evidence);
  if (Object.keys(evidence).length > 0) {
    const provenAbsent =
      reservation.state === 'held' &&
      Number.isFinite(instant(input.now)) &&
      Number.isFinite(instant(reservation.expires_at)) &&
      instant(input.now) >= instant(reservation.expires_at) &&
      evidence.store_locked === true &&
      evidence.claim === 'absent' &&
      evidence.process_identity === 'proven-absent';
    return provenAbsent
      ? {
          action: 'expired',
          state: 'expired',
          capacity_counted_pct: 0,
          automatic_spawn_limit: 0,
        }
      : {
          action: 'orphan-audit',
          state: 'orphaned',
          capacity_counted_pct: number(reservation.amount_pct),
          automatic_spawn_limit: 0,
        };
  }
  const terminal = object(input.terminal_evidence);
  if (Object.keys(terminal).length > 0) {
    return validTerminalProof(terminal, reservation, 'ccm/quota-terminal-evidence/v1', false)
      ? {
          action: 'release-pending',
          state: 'release_pending',
          capacity_counted_pct: number(reservation.amount_pct),
          provider_refund_claimed: false,
        }
      : {
          action: 'orphan-audit',
          state: 'orphaned',
          capacity_counted_pct: number(reservation.amount_pct),
          automatic_spawn_limit: 0,
        };
  }
  const audit = object(input.audit);
  if (Object.keys(audit).length > 0) {
    return validTerminalProof(audit, reservation, 'ccm/quota-terminal-audit/v1', true)
      ? {
          action: 'released',
          state: 'released',
          capacity_counted_pct: 0,
          provider_refund_claimed: false,
        }
      : {
          action: 'orphan-audit',
          state: 'orphaned',
          capacity_counted_pct: number(reservation.amount_pct),
          automatic_spawn_limit: 0,
        };
  }
  return { action: 'rejected', error: 'RESERVATION_INVALID_TRANSITION' };
}

export function evaluateLiveQuotaAdmission(input: Value): Record<string, unknown> {
  const reservation = object(input.reservation);
  const live = object(input.live);
  const preflight = object(input.preflight);
  const rolling = object(input.rolling24h);
  const policy = object(input.policy);
  const effects = object(input.effects);
  const reject = (
    reason: string,
    action = 'audit-release',
    extras = {},
  ): Record<string, unknown> => ({
    decision: 'reject',
    automatic_spawn_limit: 0,
    blocking_reasons: [reason],
    reservation_action: action,
    ...extras,
  });
  const refresh = object(input.live_refresh);
  if (number(refresh.status) === 429) {
    return reject('QUOTA_RATE_LIMITED', 'audit-release', { circuit: 'open', claim_count: 0 });
  }
  if (policy.decision === 'deny' || policy.decision === 'unknown') {
    return reject('QUOTA_POLICY_DENIED', 'retain-orphaned', { claim_count: 0 });
  }
  if (effects.decision === 'deny' || effects.decision === 'unknown') {
    return reject('QUOTA_EFFECT_DENIED', 'retain-orphaned', { claim_count: 0 });
  }
  if (live.observation_status === 'conflict') {
    return {
      decision: 'reject',
      automatic_spawn_limit: 0,
      blocking_reasons: ['QUOTA_OBSERVATION_CONFLICT'],
      circuit: 'open',
      hold_count: 0,
      commit_count: 0,
      claim_count: 0,
      spawn_count: 0,
    };
  }
  if (
    Object.keys(live).length === 0 ||
    !['ample', 'tight', 'exhausted', 'unknown'].includes(String(live.state)) ||
    !['fresh', 'soft-stale', 'hard-stale', 'unknown'].includes(String(live.freshness))
  ) {
    return reject('QUOTA_REQUIRED_WINDOW_UNKNOWN');
  }
  if (live.state === 'unknown' || live.freshness === 'unknown') {
    if (reservation.id === undefined) {
      return {
        decision: 'reject',
        automatic_spawn_limit: 0,
        blocking_reasons: ['QUOTA_REQUIRED_WINDOW_UNKNOWN'],
        hold_count: 0,
        commit_count: 0,
        claim_count: 0,
        spawn_count: 0,
      };
    }
    return reject('QUOTA_REQUIRED_WINDOW_UNKNOWN');
  }
  if (
    preflight.identity !== undefined &&
    (preflight.identity !== live.identity || preflight.aggregation_key !== live.aggregation_key)
  ) {
    return {
      decision: 'orphan-audit',
      automatic_spawn_limit: 0,
      blocking_reasons: ['LIVE_QUOTA_IDENTITY_CONFLICT'],
      reservation_action: 'retain-orphaned',
      account_mutation_count: 0,
    };
  }
  if (live.freshness === 'hard-stale') return reject('QUOTA_HARD_STALE');
  if (live.freshness === 'soft-stale') return reject('QUOTA_SOFT_STALE');
  if (live.state === 'tight') {
    return reject('QUOTA_TIGHT', 'audit-release', input.preflight ? { claim_count: 0 } : {});
  }
  if (live.state === 'exhausted') return reject('QUOTA_EXHAUSTED');

  const ticket = object(input.ticket);
  const checkedAt = instant(input.checked_at);
  const launchBy = instant(ticket.launch_by);
  if (!Number.isFinite(checkedAt) || !Number.isFinite(launchBy)) {
    if (Object.keys(object(input.claim_attempt)).length > 0 || reservation.state !== 'committed') {
      return {
        decision: 'orphan-audit',
        automatic_spawn_limit: 0,
        blocking_reasons: ['ADMISSION_COMMIT_MISSING_OR_INVALID'],
        reservation_action: 'retain-orphaned',
        claim_count: 0,
      };
    }
    return reject('ADMISSION_COMMIT_MISSING_OR_INVALID', 'retain-orphaned', { claim_count: 0 });
  }
  if (checkedAt >= launchBy) {
    return reject('ADMISSION_TICKET_EXPIRED', 'audit-release', { claim_count: 0 });
  }
  if (Object.keys(object(input.claim_attempt)).length > 0 || reservation.state !== 'committed') {
    return {
      decision: 'orphan-audit',
      automatic_spawn_limit: 0,
      blocking_reasons: ['ADMISSION_COMMIT_MISSING_OR_INVALID'],
      reservation_action: 'retain-orphaned',
      claim_count: 0,
    };
  }
  const advisories =
    rolling.advisory && rolling.advisory !== 'none' ? [rolling.advisory] : undefined;
  return {
    decision: 'launch-claim-allowed',
    automatic_spawn_limit: 1,
    blocking_reasons: [],
    ...(advisories ? { advisories } : {}),
    reservation_action: 'retain-committed',
  };
}

export function evaluateQuotaOrphanAudit(input: Value): Record<string, unknown> {
  const reservation = object(input.reservation);
  const amount = number(reservation.amount_pct);
  const launch = object(input.launch);
  const lease = object(input.lease);
  const process = object(input.process);
  const journal = object(input.journal);
  const terminalJournal =
    TERMINAL_JOURNAL_KINDS.has(String(journal.terminal)) && journal.continuous === true;
  if (
    launch.claim === 'present' &&
    launch.hello === 'valid' &&
    input.parent_manager === 'dead' &&
    input.process_identity === 'match'
  ) {
    return {
      audit_class: 'active',
      state: 'committed',
      capacity_counted_pct: amount,
      release_count: 0,
      spawn_count: 0,
      handoff_action: 'attach-same-run',
    };
  }
  if (
    reservation.state === 'release_pending' &&
    terminalJournal &&
    input.process_identity === 'dead-proven' &&
    input.cleanup_complete === true &&
    input.evidence_retained === true
  ) {
    return {
      audit_class: 'releasable',
      state: 'released',
      capacity_counted_pct: 0,
      release_count: 1,
      provider_refund_claimed: false,
      spawn_count: 0,
    };
  }
  if (
    terminalJournal &&
    input.process_identity === 'dead-proven' &&
    input.cleanup_complete === false
  ) {
    return {
      audit_class: 'terminal-pending-cleanup',
      state: 'release_pending',
      capacity_counted_pct: amount,
      release_count: 0,
      spawn_count: 0,
    };
  }
  const signalCount =
    lease.pid !== undefined &&
    process.pid === lease.pid &&
    (lease.boot_id !== process.boot_id ||
      lease.process_start_identity !== process.process_start_identity)
      ? { signal_count: 0 }
      : {};
  return {
    audit_class: 'orphan-audit',
    state: 'orphaned',
    capacity_counted_pct: amount,
    release_count: 0,
    ...signalCount,
    spawn_count: 0,
  };
}

const FORBIDDEN_ACCOUNT_EFFECTS = new Set([
  'account_login',
  'account_logout',
  'account_switch',
  'session_switch',
  'credential_import',
  'credential_copy',
  'credential_write',
  'auth_write',
]);

export function evaluateQuotaLifecycleEffect(input: Value): Record<string, unknown> {
  if (FORBIDDEN_ACCOUNT_EFFECTS.has(String(input.requested_effect))) {
    const effect = String(input.requested_effect);
    return {
      action: 'deny',
      error: 'ACCOUNT_MUTATION_FORBIDDEN',
      effect_count: 0,
      [`${effect}_count`]: 0,
    };
  }
  const reservation = object(input.reservation);
  const handoff = object(input.handoff);
  if (input.run_ref === 'durable_run_ref') {
    return {
      action: 'attach-existing-run',
      reservation_id: reservation.id,
      reservation_action: 'retain-committed',
      new_reservation_count: 0,
      automatic_spawn_limit: 0,
    };
  }
  if (input.run_ref === 'journal_only') {
    return {
      action: 'observe-journal-only',
      reservation_id: reservation.id,
      reservation_action: 'retain-committed',
      control_capability: 'degraded',
      new_reservation_count: 0,
      automatic_spawn_limit: 0,
    };
  }
  if (input.run_ref === 'legacy_session_bound') {
    return {
      action: 'audit-required',
      reservation_action: 'retain-committed',
      release_count: 0,
      automatic_spawn_limit: 0,
    };
  }
  if (input.run_ref === 'orphaned' || reservation.state === 'orphaned') {
    return {
      action: 'orphan-audit',
      reservation_action: 'retain-orphaned',
      release_count: 0,
      automatic_spawn_limit: 0,
    };
  }
  const active = object(input.active_run);
  if (active.id !== undefined) {
    return {
      action: 'active-run-keeps-pinned-runtime',
      runtime_sha256: active.runtime_sha256,
      ...(active.reservation_id !== undefined && input.activation !== undefined
        ? { reservation_id: active.reservation_id }
        : {}),
      reservation_action: 'retain-committed',
      ...(input.rollback !== undefined ? { release_count: 0 } : {}),
      interrupt_count: 0,
      ...(input.activation !== undefined ? { rereservation_count: 0 } : {}),
      automatic_spawn_limit: 0,
    };
  }
  if (input.runtime_image !== undefined) {
    return {
      action: 'deny',
      error: 'RUNTIME_IMAGE_IN_USE',
      runtime_delete_count: 0,
      reservation_action: 'retain-committed',
    };
  }
  return {
    action: 'deny',
    error:
      handoff.identity_evidence === 'unknown' ? 'RESERVATION_ORPHANED' : 'QUOTA_EFFECT_FORBIDDEN',
  };
}

export function classifyQuotaError(input: Value): Record<string, unknown> {
  const error = object(input.error);
  const code = String(error.code ?? '');
  const generic = new Map<string, string>([
    ['QUOTA_TIGHT', 'quota-tight'],
    ['QUOTA_EXHAUSTED', 'quota-tight'],
    ['RESERVATION_CAPACITY_CONFLICT', 'quota-tight'],
    ['QUOTA_RATE_LIMITED', 'rate-limited'],
    ['QUOTA_REQUIRED_WINDOW_UNKNOWN', 'quota-unknown'],
    ['QUOTA_REQUIRED_BUCKET_UNKNOWN', 'quota-unknown'],
    ['RESERVATION_ORPHANED', 'reservation-orphaned'],
    ['LIVE_QUOTA_IDENTITY_CONFLICT', 'quota-identity-conflict'],
  ]);
  const reservation = object(input.reservation);
  const fallback =
    [
      'QUOTA_TIGHT',
      'QUOTA_EXHAUSTED',
      'RESERVATION_CAPACITY_CONFLICT',
      'QUOTA_RATE_LIMITED',
    ].includes(code) &&
    input.launch_claim === 'absent' &&
    (reservation.state === undefined ||
      ['released', 'expired'].includes(String(reservation.state)));
  return {
    generic_reason: generic.get(code) ?? 'quota-error',
    automatic_fallback_allowed: fallback,
    ...(fallback || code.includes('UNKNOWN')
      ? { fallback_requires_new_attempt_key: fallback }
      : {}),
    ...(code === 'RESERVATION_ORPHANED' ? { release_count: 0 } : {}),
    ...(code === 'LIVE_QUOTA_IDENTITY_CONFLICT' ? { account_mutation_count: 0 } : {}),
    automatic_spawn_limit: 0,
  };
}
