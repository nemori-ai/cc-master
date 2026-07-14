import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import * as fsPromises from 'node:fs/promises';
import { platform, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import {
  deriveQuotaHeadroom,
  evaluateLiveQuotaAdmission,
  evaluateQuotaObservation,
  evaluateQuotaOrphanAudit,
  evaluateQuotaReservationTransition,
} from '@ccm/engine';
import { createQuotaAdmissionStore } from '../src/quota-admission-store.js';

type Data = Record<string, unknown>;

interface AuthorityStore {
  publishObservation(request: Readonly<Data>): Promise<Data>;
  refreshObservation(request: Readonly<Data>, collect: () => Promise<Data>): Promise<Data>;
  reserve(request: Readonly<Data>): Promise<Data>;
  commitReservation(request: Readonly<Data>): Promise<Data>;
  preflight(request: Readonly<Data>): Promise<Data>;
  auditReservation(request: Readonly<Data>): Promise<Data>;
  inspectAggregation(aggregationKey: string): Promise<Data>;
}

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function home(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  roots.push(root);
  return join(root, 'home');
}

function reservation(overrides: Data = {}): Data {
  return {
    schema: 'ccm/quota-reservation-request/v1',
    aggregation_key: 'codex|identity-A|pool-A|seven_day',
    capacity_pct: 20,
    id: 'qres-1',
    key: 'attempt-1',
    hash: 'sha256:request-1',
    amount_pct: 4,
    state: 'held',
    expires_at: '2099-07-14T01:00:00Z',
    checked_at: new Date().toISOString(),
    source_revision: 'sha256:live-r2',
    attempt_id: 'attempt-1',
    candidate_id: 'codex-cli-worker',
    account_id: 'identity-A',
    pool_id: 'pool-A',
    identity_fingerprint: 'sha256:identity-A',
    ...overrides,
  };
}

function ticket(overrides: Data = {}): Data {
  return {
    schema: 'ccm/quota-admission-ticket/v1',
    ticket_id: 'ticket-1',
    reservation_id: 'qres-1',
    reservation_request_hash: 'sha256:request-1',
    reservation_expires_at: '2099-07-14T01:00:00Z',
    attempt_id: 'attempt-1',
    run_ref: 'run-1',
    account_id: 'identity-A',
    pool_id: 'pool-A',
    identity_fingerprint: 'sha256:identity-A',
    aggregation_key: 'codex|identity-A|pool-A|seven_day',
    live_source_revision: 'sha256:live-r2',
    runtime_sha256: 'sha256:runtime-1',
    launch_idempotency_key: 'launch-1',
    launch_nonce: 'nonce-1',
    issued_at: new Date().toISOString(),
    launch_by: '2099-07-14T01:00:00Z',
    ...overrides,
  };
}

function terminalProof(
  schema: 'ccm/quota-terminal-evidence/v1' | 'ccm/quota-terminal-audit/v1',
  binding: {
    reservationId: string;
    requestHash: unknown;
    attemptId: string;
    runRef: string;
    ticketDigest: unknown;
  },
  cleanupComplete: boolean,
): Data {
  return {
    schema,
    proof_revision: cleanupComplete ? 'audit-r1' : 'terminal-r1',
    reservation_id: binding.reservationId,
    reservation_request_hash: binding.requestHash,
    attempt_id: binding.attemptId,
    run_ref: binding.runRef,
    ticket_digest: binding.ticketDigest,
    journal_ref: `journal://${binding.runRef}`,
    journal_revision: 'sha256:journal-r1',
    journal_terminal: 'succeeded',
    journal_continuous: true,
    process_identity: 'dead-proven',
    cleanup_complete: cleanupComplete,
    evidence_retained: true,
  };
}

function authorityStore(
  quotaHome: string,
  filesystem?: Record<PropertyKey, unknown>,
  now?: () => Date,
): AuthorityStore {
  return (
    createQuotaAdmissionStore as unknown as (options: {
      home: string;
      filesystem?: Record<PropertyKey, unknown>;
      now?: () => Date;
    }) => AuthorityStore
  )({ home: quotaHome, filesystem, now });
}

function freshnessEnvelope(nowMs = Date.now()): Data {
  return {
    observed_at: new Date(nowMs - 1_000).toISOString(),
    valid_until: new Date(nowMs + 3_600_000).toISOString(),
    source_profile: {
      schema: 'ccm/quota-source-profile/v1',
      revision: 'ccm/test-quota-source/v1',
      fresh_ttl_sec: 60,
      hard_ttl_sec: 300,
      max_clock_skew_sec: 5,
    },
  };
}

async function publishAuthority(
  store: AuthorityStore,
  aggregationKeys: string[],
  capacityPct: number | Record<string, number>,
): Promise<void> {
  const capacityFor = (key: string): number =>
    typeof capacityPct === 'number' ? capacityPct : Number(capacityPct[key]);
  await store.publishObservation({
    source_key: 'codex-current',
    observation: {
      schema: 'ccm/quota-authority-observation/v1',
      provider: 'codex',
      provider_rule_revision: 'ccm/codex-7d-pacing/v1',
      source_revision: 'sha256:live-r2',
      ...freshnessEnvelope(),
      identity: 'identity-A',
      identity_fingerprint: 'sha256:identity-A',
      account_id: 'identity-A',
      pool_id: 'pool-A',
      hard_window: { name: 'seven_day', duration_sec: 604_800 },
      policy: {
        decision: 'allow',
        revision: 'ccm/codex-7d-pacing/v1',
        hard_ceiling_used_pct: 85,
      },
      effects: { decision: 'allow', effect: 'read-only' },
      buckets: aggregationKeys.map((aggregationKey) => ({
        id: `seven-day:${aggregationKey}`,
        window: 'seven_day',
        duration_sec: 604_800,
        freshness: 'fresh',
        used_pct: 85 - capacityFor(aggregationKey),
        safety_margin_pct: 0,
        projected_p80_pct: 0,
        aggregation_key: aggregationKey,
      })),
    },
  });
}

const r3AuthorityNowMs = Date.parse('2026-07-14T00:00:00.000Z');
const r3AuthorityRevision = `sha256:${'a'.repeat(64)}`;
const r3IdentityFingerprint = `sha256:${'b'.repeat(64)}`;
const r3AggregationKey = 'shared|identity-A|pool-A|quota';

function r3AuthorityObservation(
  provider: string,
  providerRule: string,
  windowName: string,
  windowDuration: number,
  usedPct: number,
  hardCeilingUsedPct: number,
): Data {
  return {
    schema: 'ccm/quota-authority-observation/v1',
    provider,
    provider_rule_revision: providerRule,
    source_revision: r3AuthorityRevision,
    observed_at: '2026-07-13T23:59:59.000Z',
    valid_until: '2026-07-14T00:05:00.000Z',
    source_profile: {
      schema: 'ccm/quota-source-profile/v1',
      revision: 'ccm/reviewer-r3/v1',
      fresh_ttl_sec: 60,
      hard_ttl_sec: 300,
      max_clock_skew_sec: 5,
    },
    identity: 'identity-A',
    identity_fingerprint: r3IdentityFingerprint,
    account_id: 'identity-A',
    pool_id: 'pool-A',
    hard_window: { name: windowName, duration_sec: windowDuration },
    policy: {
      decision: 'allow',
      revision: providerRule,
      hard_ceiling_used_pct: hardCeilingUsedPct,
    },
    effects: { decision: 'allow', effect: 'read-only' },
    buckets: [
      {
        id: `${windowName}:${r3AggregationKey}`,
        window: windowName,
        duration_sec: windowDuration,
        freshness: 'fresh',
        used_pct: usedPct,
        safety_margin_pct: 5,
        projected_p80_pct: 4,
        aggregation_key: r3AggregationKey,
      },
    ],
  };
}

async function r3CommittedAuthority(prefix: string): Promise<AuthorityStore> {
  const store = authorityStore(home(prefix), undefined, () => new Date(r3AuthorityNowMs));
  await store.publishObservation({
    source_key: 'source-A',
    observation: r3AuthorityObservation(
      'codex',
      'ccm/codex-7d-pacing/v1',
      'seven_day',
      604_800,
      20,
      85,
    ),
  });
  const expiresAt = '2026-07-14T00:02:00.000Z';
  const held = await store.reserve(
    reservation({
      source_key: 'source-A',
      aggregation_key: r3AggregationKey,
      capacity_pct: 60,
      checked_at: '2026-07-14T00:00:00.000Z',
      expires_at: expiresAt,
      source_revision: r3AuthorityRevision,
      identity_fingerprint: r3IdentityFingerprint,
    }),
  );
  assert.equal(held.action, 'created');
  const committed = await store.commitReservation({
    reservation_id: 'qres-1',
    checked_at: '2026-07-14T00:00:00.000Z',
    ticket: ticket({
      reservation_request_hash: held.request_hash,
      reservation_expires_at: expiresAt,
      aggregation_key: r3AggregationKey,
      live_source_revision: r3AuthorityRevision,
      identity_fingerprint: r3IdentityFingerprint,
      issued_at: '2026-07-13T23:59:59.000Z',
      launch_by: '2026-07-14T00:01:00.000Z',
    }),
  });
  assert.equal(committed.action, 'committed');
  return store;
}

async function seededSingleAuthority(prefix: string): Promise<{
  quotaHome: string;
  store: AuthorityStore;
  aggregationRoot: string;
  eventRef: string;
  snapshotRef: string;
}> {
  const quotaHome = home(prefix);
  const store = authorityStore(quotaHome);
  await publishAuthority(store, ['bucket-A', 'bucket-B'], {
    'bucket-A': 20,
    'bucket-B': 20,
  });
  assert.equal(
    (
      await store.reserve(
        reservation({
          id: 'global-id-corruption-mutant',
          key: 'original-key',
          aggregation_key: 'bucket-A',
        }),
      )
    ).action,
    'created',
  );
  const aggregationRoot = join(
    quotaHome,
    'quota',
    'v1',
    'reservations',
    createHash('sha256').update('bucket-A').digest('hex'),
  );
  const eventRef = join(
    aggregationRoot,
    'events',
    readdirSync(join(aggregationRoot, 'events')).sort()[0] as string,
  );
  return {
    quotaHome,
    store,
    aggregationRoot,
    eventRef,
    snapshotRef: join(aggregationRoot, 'snapshot.json'),
  };
}

async function assertCorruptAuthorityBlocksNewReservation(
  seeded: Awaited<ReturnType<typeof seededSingleAuthority>>,
): Promise<void> {
  await assert.rejects(
    () =>
      seeded.store.reserve(
        reservation({
          id: 'global-id-corruption-mutant',
          key: 'different-key',
          aggregation_key: 'bucket-B',
        }),
      ),
    /RESERVATION_STORE_CONFLICT/,
  );
  await assert.rejects(
    () =>
      seeded.store.auditReservation({
        reservation_id: 'global-id-corruption-mutant',
        now: '2026-07-14T01:00:00Z',
        launch_evidence: {
          store_locked: true,
          claim: 'absent',
          process_identity: 'proven-absent',
        },
      }),
    /RESERVATION_STORE_CONFLICT/,
  );
  await assert.rejects(
    () =>
      seeded.store.reserve(
        reservation({
          id: 'different-provisional-id',
          key: 'original-key',
          aggregation_key: 'bucket-B',
        }),
      ),
    /RESERVATION_STORE_CONFLICT/,
  );
  const bucketB = await seeded.store.inspectAggregation('bucket-B');
  assert.equal(bucketB.active_reserved_pct, 0);
  assert.deepEqual(bucketB.reservations, []);
  assert.equal(bucketB.durable_event_count, 0);
  assert.equal(readdirSync(join(seeded.aggregationRoot, 'events')).length, 1);
  assert.equal(
    existsSync(
      join(
        seeded.quotaHome,
        'quota',
        'v1',
        'reservation-keys',
        createHash('sha256').update('different-key').digest('hex'),
        'current.json',
      ),
    ),
    false,
  );
}

test('reviewer P1-1: empty headroom and caller-fabricated policy/effect decisions fail closed', () => {
  assert.deepEqual(deriveQuotaHeadroom({ policy: { hard_ceiling_used_pct: 85 }, buckets: [] }), {
    state: 'unknown',
    per_bucket: [],
    automatic_spawn_limit: 0,
    blocking_reasons: ['QUOTA_REQUIRED_WINDOW_UNKNOWN'],
  });
  const invalidProjected = deriveQuotaHeadroom({
    policy: { hard_ceiling_used_pct: 85 },
    buckets: [
      {
        id: 'invalid-projected-p80',
        freshness: 'fresh',
        used_pct: 20,
        active_reserved_pct: 0,
        safety_margin_pct: 5,
        projected_p80_pct: 'invalid',
      },
    ],
  }) as Data;
  assert.equal(invalidProjected.state, 'unknown');
  assert.equal(invalidProjected.automatic_spawn_limit, 0);
  for (const input of [
    {},
    {
      reservation: { state: 'committed' },
      live: { state: 'ample', freshness: 'fresh' },
      policy: { decision: 'deny' },
      effects: { decision: 'allow' },
      ticket: {},
    },
    {
      reservation: { state: 'committed' },
      live: { state: 'ample', freshness: 'fresh' },
      policy: { decision: 'allow' },
      effects: { decision: 'deny' },
      ticket: {},
    },
  ]) {
    const result = evaluateLiveQuotaAdmission(input) as Data;
    assert.equal(result.decision, 'reject');
    assert.equal(result.automatic_spawn_limit, 0);
  }

  const observationInput = {
    provider: 'codex',
    checked_at: '2026-07-14T00:00:00Z',
    profile: { fresh_ttl_sec: 60, hard_ttl_sec: 300, max_clock_skew_sec: 5 },
    required_bucket_ids: ['seven-day-global'],
    observations: [
      {
        id: 'obs-clock-guard',
        revision: 'rev-clock-guard',
        aggregation_key: 'codex|identity-A|pool-A|seven_day',
        bucket_id: 'seven-day-global',
        window: 'seven_day',
        duration_sec: 604_800,
        used_pct: 20,
        observed_at: '2026-07-14T00:00:30Z',
        valid_until: '2026-07-14T00:05:30Z',
      },
    ],
  };
  const futureObservation = evaluateQuotaObservation(observationInput) as Data;
  assert.equal(futureObservation.freshness, 'unknown');
  assert.equal(futureObservation.blocking_error, 'QUOTA_SOURCE_SCHEMA_UNSUPPORTED');
  assert.equal(futureObservation.automatic_spawn_limit, 0);

  const resetObservation = evaluateQuotaObservation({
    ...observationInput,
    observations: [
      {
        ...(observationInput.observations[0] as Data),
        observed_at: '2026-07-13T23:59:50Z',
        valid_until: '2026-07-14T00:05:00Z',
        resets_at: '2026-07-13T23:59:59Z',
      },
    ],
  }) as Data;
  assert.equal(resetObservation.freshness, 'hard-stale');
  assert.equal(resetObservation.blocking_error, 'QUOTA_HARD_STALE');

  for (const invalidTime of [
    {
      checked_at: 'not-an-instant',
      ticket: { launch_by: '2026-07-14T00:00:30Z' },
    },
    {
      checked_at: '2026-07-14T00:00:00Z',
      ticket: { launch_by: 'not-an-instant' },
    },
  ]) {
    const result = evaluateLiveQuotaAdmission({
      reservation: { id: 'qres-time-guard', state: 'committed' },
      live: { state: 'ample', freshness: 'fresh' },
      policy: { decision: 'allow' },
      effects: { decision: 'allow' },
      ...invalidTime,
    }) as Data;
    assert.equal(result.decision, 'reject');
    assert.equal(result.automatic_spawn_limit, 0);
    assert.deepEqual(result.blocking_reasons, ['ADMISSION_COMMIT_MISSING_OR_INVALID']);
    assert.equal(result.claim_count, 0);
  }
});

test('final audit P1: commit rejects a reservation after its current authority binding changes', async () => {
  const nowMs = Date.parse('2026-07-14T00:00:00Z');
  const checkedAt = new Date(nowMs).toISOString();
  const expiresAt = new Date(nowMs + 120_000).toISOString();
  const aggregationKey = 'codex|identity-A|pool-A|seven_day';
  const store = authorityStore(
    home('ccm-quota-commit-authority-rebind-'),
    undefined,
    () => new Date(nowMs),
  );
  const authority = {
    schema: 'ccm/quota-authority-observation/v1',
    provider: 'codex',
    provider_rule_revision: 'ccm/codex-7d-pacing/v1',
    source_revision: 'sha256:live-r1',
    ...freshnessEnvelope(nowMs),
    identity: 'identity-A',
    identity_fingerprint: 'sha256:identity-A',
    account_id: 'identity-A',
    pool_id: 'pool-A',
    hard_window: { name: 'seven_day', duration_sec: 604_800 },
    policy: {
      decision: 'allow',
      revision: 'ccm/codex-7d-pacing/v1',
      hard_ceiling_used_pct: 85,
    },
    effects: { decision: 'allow', effect: 'read-only' },
    buckets: [
      {
        id: 'seven-day:authority-rebind',
        window: 'seven_day',
        duration_sec: 604_800,
        freshness: 'fresh',
        used_pct: 65,
        safety_margin_pct: 0,
        projected_p80_pct: 0,
        aggregation_key: aggregationKey,
      },
    ],
  };
  await store.publishObservation({ source_key: 'codex-current', observation: authority });
  const held = await store.reserve(
    reservation({
      source_revision: 'sha256:live-r1',
      checked_at: checkedAt,
      expires_at: expiresAt,
    }),
  );
  assert.equal(held.action, 'created');

  await store.publishObservation({
    source_key: 'codex-current',
    observation: {
      ...authority,
      source_revision: 'sha256:live-r2',
      identity: 'identity-B',
      identity_fingerprint: 'sha256:identity-B',
      account_id: 'identity-B',
      pool_id: 'pool-B',
    },
  });
  const committed = await store.commitReservation({
    reservation_id: 'qres-1',
    checked_at: checkedAt,
    ticket: ticket({
      reservation_request_hash: held.request_hash,
      reservation_expires_at: expiresAt,
      live_source_revision: 'sha256:live-r1',
      issued_at: checkedAt,
      launch_by: new Date(nowMs + 60_000).toISOString(),
    }),
  });
  assert.equal(committed.action, 'rejected');
  assert.equal(committed.error, 'ADMISSION_COMMIT_MISSING_OR_INVALID');
  assert.equal(committed.spawn_count, 0);
});

test('final review P1-1: source TTL/reset and reservation expiry are recomputed by the owner clock', async () => {
  const nowMs = Date.now();
  let clockMs = nowMs;
  const now = () => new Date(clockMs);
  const aggregationKey = 'codex|identity-A|pool-A|seven_day';
  const staleHome = home('ccm-quota-stale-authority-');
  const staleStore = authorityStore(staleHome, undefined, now);
  const staleObservation = {
    schema: 'ccm/quota-authority-observation/v1',
    provider: 'codex',
    provider_rule_revision: 'ccm/codex-7d-pacing/v1',
    source_revision: 'sha256:live-r2',
    ...freshnessEnvelope(nowMs),
    observed_at: new Date(nowMs - 600_000).toISOString(),
    valid_until: new Date(nowMs + 3_600_000).toISOString(),
    account_id: 'identity-A',
    pool_id: 'pool-A',
    identity_fingerprint: 'sha256:identity-A',
    hard_window: { name: 'seven_day', duration_sec: 604_800 },
    policy: {
      decision: 'allow',
      revision: 'ccm/codex-7d-pacing/v1',
      hard_ceiling_used_pct: 85,
    },
    effects: { decision: 'allow', effect: 'read-only' },
    buckets: [
      {
        id: 'seven-day:stale',
        window: 'seven_day',
        duration_sec: 604_800,
        freshness: 'fresh',
        used_pct: 65,
        safety_margin_pct: 0,
        projected_p80_pct: 0,
        aggregation_key: aggregationKey,
      },
    ],
  };
  await staleStore.publishObservation({
    source_key: 'codex-current',
    observation: staleObservation,
  });
  const staleReserve = await staleStore.reserve(
    reservation({
      checked_at: new Date(nowMs).toISOString(),
      expires_at: new Date(nowMs + 60_000).toISOString(),
    }),
  );
  assert.equal(staleReserve.action, 'rejected');
  assert.equal(staleReserve.error, 'QUOTA_HARD_STALE');
  assert.equal(staleReserve.new_reservation_count, 0);

  let collectorCalls = 0;
  const refreshed = await staleStore.refreshObservation(
    { source_key: 'codex-current', checked_at: new Date(nowMs).toISOString() },
    async () => {
      collectorCalls += 1;
      return {
        ...staleObservation,
        ...freshnessEnvelope(nowMs),
        source_revision: 'sha256:live-r3',
      };
    },
  );
  assert.equal(collectorCalls, 1);
  assert.equal(refreshed.source_revision, 'sha256:live-r3');

  const resetStore = authorityStore(home('ccm-quota-reset-authority-'), undefined, now);
  const resetExpiresAt = new Date(nowMs + 60_000).toISOString();
  await resetStore.publishObservation({
    source_key: 'codex-reset',
    observation: {
      ...staleObservation,
      ...freshnessEnvelope(nowMs),
      buckets: [
        {
          ...((staleObservation.buckets as Data[])[0] as Data),
          id: 'seven-day:reset-bound',
          resets_at: new Date(nowMs + 5_000).toISOString(),
        },
      ],
    },
  });
  const resetHeld = await resetStore.reserve(
    reservation({
      source_key: 'codex-reset',
      id: 'qres-reset-before-commit',
      key: 'reset-before-commit',
      attempt_id: 'reset-before-commit',
      checked_at: new Date(nowMs).toISOString(),
      expires_at: resetExpiresAt,
    }),
  );
  assert.equal(resetHeld.action, 'created');
  clockMs = nowMs + 10_000;
  const resetCommit = await resetStore.commitReservation({
    reservation_id: 'qres-reset-before-commit',
    checked_at: new Date(clockMs).toISOString(),
    ticket: ticket({
      ticket_id: 'ticket-reset-before-commit',
      reservation_id: 'qres-reset-before-commit',
      reservation_request_hash: resetHeld.request_hash,
      reservation_expires_at: resetExpiresAt,
      attempt_id: 'reset-before-commit',
      issued_at: new Date(nowMs).toISOString(),
      launch_by: new Date(nowMs + 30_000).toISOString(),
    }),
  });
  assert.equal(resetCommit.action, 'rejected');
  assert.equal(resetCommit.error, 'QUOTA_HARD_STALE');
  clockMs = nowMs;

  const expiryHome = home('ccm-quota-reservation-expiry-');
  const expiryStore = authorityStore(expiryHome, undefined, now);
  await publishAuthority(expiryStore, [aggregationKey], 20);
  const expiredHold = await expiryStore.reserve(
    reservation({
      id: 'qres-expired-before-hold',
      key: 'expired-before-hold',
      attempt_id: 'expired-before-hold',
      checked_at: new Date(nowMs).toISOString(),
      expires_at: new Date(nowMs - 1).toISOString(),
    }),
  );
  assert.equal(expiredHold.action, 'rejected');
  assert.equal(expiredHold.error, 'RESERVATION_EXPIRED');

  const reservationExpiresAt = new Date(nowMs + 20_000).toISOString();
  const held = await expiryStore.reserve(
    reservation({
      id: 'qres-expiry-preflight',
      key: 'expiry-preflight',
      attempt_id: 'expiry-preflight',
      checked_at: new Date(nowMs).toISOString(),
      expires_at: reservationExpiresAt,
    }),
  );
  assert.equal(held.action, 'created');
  const committed = await expiryStore.commitReservation({
    reservation_id: 'qres-expiry-preflight',
    checked_at: new Date(nowMs).toISOString(),
    ticket: ticket({
      ticket_id: 'ticket-expiry-preflight',
      reservation_id: 'qres-expiry-preflight',
      reservation_request_hash: held.request_hash,
      reservation_expires_at: reservationExpiresAt,
      attempt_id: 'expiry-preflight',
      issued_at: new Date(nowMs).toISOString(),
      launch_by: new Date(nowMs + 10_000).toISOString(),
    }),
  });
  assert.equal(committed.action, 'committed');
  clockMs = nowMs + 30_000;
  const expiredPreflight = await expiryStore.preflight({
    source_key: 'codex-current',
    reservation_id: 'qres-expiry-preflight',
    checked_at: new Date(clockMs).toISOString(),
  });
  assert.equal(expiredPreflight.decision, 'reject');
  assert.equal(expiredPreflight.automatic_spawn_limit, 0);
  assert.deepEqual(expiredPreflight.blocking_reasons, ['ADMISSION_TICKET_EXPIRED']);
});

test('reviewer P1-2: strict hold, immutable commit lineage, and committed audit retention', async () => {
  const fabricatedTransition = evaluateQuotaReservationTransition({
    reservation: {
      id: 'qres-proof-red',
      hash: 'sha256:proof-red',
      attempt_id: 'attempt-proof-red',
      state: 'committed',
      amount_pct: 4,
      ticket_digest: 'sha256:ticket-proof-red',
      run_lineage: { run_ref: 'run-proof-red' },
    },
    audit: { arbitrary_unverified_claim: true },
  }) as Data;
  assert.equal(fabricatedTransition.action, 'orphan-audit');
  assert.equal(fabricatedTransition.state, 'orphaned');
  assert.equal(fabricatedTransition.capacity_counted_pct, 4);
  const fabricatedBinding = {
    reservationId: 'qres-proof-red',
    requestHash: 'sha256:proof-red',
    attemptId: 'attempt-proof-red',
    runRef: 'run-proof-red',
    ticketDigest: 'sha256:ticket-proof-red',
  };
  const nonterminalProof = evaluateQuotaReservationTransition({
    reservation: {
      id: fabricatedBinding.reservationId,
      hash: fabricatedBinding.requestHash,
      attempt_id: fabricatedBinding.attemptId,
      state: 'committed',
      amount_pct: 4,
      ticket_digest: fabricatedBinding.ticketDigest,
      run_lineage: { run_ref: fabricatedBinding.runRef },
    },
    audit: {
      ...terminalProof('ccm/quota-terminal-audit/v1', fabricatedBinding, true),
      journal_terminal: 'still-running',
      journal_ref: 'made-up://journal',
      journal_revision: 'made-up-revision',
    },
  }) as Data;
  assert.equal(nonterminalProof.action, 'orphan-audit');
  assert.equal(nonterminalProof.state, 'orphaned');
  assert.equal(nonterminalProof.capacity_counted_pct, 4);
  const nonterminalAudit = evaluateQuotaOrphanAudit({
    reservation: { state: 'release_pending', amount_pct: 4 },
    journal: { terminal: 'still-running', continuous: true },
    process_identity: 'dead-proven',
    cleanup_complete: true,
    evidence_retained: true,
  }) as Data;
  assert.equal(nonterminalAudit.audit_class, 'orphan-audit');
  assert.equal(nonterminalAudit.state, 'orphaned');
  assert.equal(nonterminalAudit.capacity_counted_pct, 4);
  const emptyBindingAudit = evaluateQuotaReservationTransition({
    reservation: {
      id: '',
      hash: '',
      attempt_id: '',
      state: 'release_pending',
      amount_pct: 4,
      ticket_digest: '',
      run_lineage: { run_ref: '' },
    },
    audit: terminalProof(
      'ccm/quota-terminal-audit/v1',
      {
        reservationId: '',
        requestHash: '',
        attemptId: '',
        runRef: '',
        ticketDigest: '',
      },
      true,
    ),
  }) as Data;
  assert.equal(emptyBindingAudit.action, 'orphan-audit');
  assert.equal(emptyBindingAudit.state, 'orphaned');
  assert.equal(emptyBindingAudit.capacity_counted_pct, 4);

  const store = authorityStore(home('ccm-quota-authority-lineage-'));
  await publishAuthority(store, ['codex|identity-A|pool-A|seven_day'], 20);
  for (const amount of [-1, 0, Number.NaN, Number.POSITIVE_INFINITY]) {
    const result = await store.reserve(
      reservation({ id: `bad-${String(amount)}`, amount_pct: amount }),
    );
    assert.equal(result.action, 'rejected');
    assert.equal(result.error, 'RESERVATION_INVALID_REQUEST');
  }
  const fabricated = await store.reserve(
    reservation({ id: 'committed-direct', state: 'committed' }),
  );
  assert.equal(fabricated.action, 'rejected');
  assert.equal(fabricated.error, 'RESERVATION_INVALID_REQUEST');
  const openSchema = await store.reserve(
    reservation({ id: 'open-schema', caller_trusts_me: true }),
  );
  assert.equal(openSchema.action, 'rejected');
  assert.equal(openSchema.error, 'RESERVATION_INVALID_REQUEST');

  const created = await store.reserve(reservation());
  assert.equal(created.action, 'created');
  const boundTicket = ticket({ reservation_request_hash: created.request_hash });
  const invalidCommit = await store.commitReservation({
    reservation_id: 'qres-1',
    checked_at: new Date().toISOString(),
    ticket: { ...boundTicket, run_ref: '' },
  });
  assert.equal(invalidCommit.action, 'rejected');
  assert.equal(invalidCommit.error, 'ADMISSION_TICKET_INVALID');
  const callerMintedCommitTime = await store.commitReservation({
    reservation_id: 'qres-1',
    checked_at: new Date().toISOString(),
    ticket: { ...boundTicket, committed_at: '2026-07-14T00:00:01Z' },
  });
  assert.equal(callerMintedCommitTime.action, 'rejected');
  assert.equal(callerMintedCommitTime.error, 'ADMISSION_TICKET_INVALID');

  const committed = await store.commitReservation({
    reservation_id: 'qres-1',
    checked_at: new Date().toISOString(),
    ticket: boundTicket,
  });
  assert.equal(committed.action, 'committed');
  assert.equal(committed.state, 'committed');
  assert.match(String(committed.ticket_digest), /^sha256:[a-f0-9]{64}$/);
  const lineage = committed.run_lineage as Data;
  assert.match(String(lineage.committed_at), /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
  assert.deepEqual(
    { ...lineage, committed_at: '<commit-time>' },
    {
      attempt_id: 'attempt-1',
      ticket_id: 'ticket-1',
      run_ref: 'run-1',
      account_id: 'identity-A',
      pool_id: 'pool-A',
      identity_fingerprint: 'sha256:identity-A',
      aggregation_key: 'codex|identity-A|pool-A|seven_day',
      source_revision: 'sha256:live-r2',
      reservation_expires_at: '2099-07-14T01:00:00Z',
      ticket_launch_by: '2099-07-14T01:00:00Z',
      committed_at: '<commit-time>',
      transition: 'held->committed',
    },
  );

  const fabricatedAudit = await store.auditReservation({
    reservation_id: 'qres-1',
    audit: { arbitrary_unverified_claim: true },
  });
  assert.equal(fabricatedAudit.action, 'orphan-audit');
  assert.equal(fabricatedAudit.state, 'orphaned');
  assert.equal(fabricatedAudit.capacity_counted_pct, 4);
  assert.equal(
    (await store.inspectAggregation('codex|identity-A|pool-A|seven_day')).active_reserved_pct,
    4,
  );

  const proofHeld = await store.reserve(
    reservation({
      id: 'qres-valid-proof',
      key: 'attempt-valid-proof',
      hash: 'sha256:valid-proof',
      attempt_id: 'attempt-valid-proof',
      candidate_id: 'candidate-valid-proof',
    }),
  );
  assert.equal(proofHeld.action, 'created');
  const proofCommit = await store.commitReservation({
    reservation_id: 'qres-valid-proof',
    checked_at: new Date().toISOString(),
    ticket: ticket({
      ticket_id: 'ticket-valid-proof',
      reservation_id: 'qres-valid-proof',
      reservation_request_hash: proofHeld.request_hash,
      attempt_id: 'attempt-valid-proof',
      run_ref: 'run-valid-proof',
      launch_idempotency_key: 'launch-valid-proof',
      launch_nonce: 'nonce-valid-proof',
    }),
  });
  assert.equal(proofCommit.action, 'committed');
  const proofBinding = {
    reservationId: 'qres-valid-proof',
    requestHash: proofHeld.request_hash,
    attemptId: 'attempt-valid-proof',
    runRef: 'run-valid-proof',
    ticketDigest: proofCommit.ticket_digest,
  };
  const releasePending = await store.auditReservation({
    reservation_id: 'qres-valid-proof',
    terminal_evidence: terminalProof('ccm/quota-terminal-evidence/v1', proofBinding, false),
  });
  assert.equal(releasePending.state, 'release_pending');
  const validAudit = terminalProof('ccm/quota-terminal-audit/v1', proofBinding, true);
  const released = await store.auditReservation({
    reservation_id: 'qres-valid-proof',
    audit: validAudit,
  });
  assert.equal(released.state, 'released');
  const conflictingAudit = await store.auditReservation({
    reservation_id: 'qres-valid-proof',
    audit: { ...validAudit, journal_revision: 'sha256:conflicting-journal-r2' },
  });
  assert.equal(conflictingAudit.action, 'rejected');
  assert.equal(conflictingAudit.error, 'RESERVATION_AUDIT_CONFLICT');
  assert.equal(conflictingAudit.state, 'released');

  const audited = await store.auditReservation({
    reservation_id: 'qres-1',
    now: '2100-07-14T01:00:00Z',
    launch_evidence: { store_locked: true, claim: 'absent', process_identity: 'proven-absent' },
  });
  assert.equal(audited.state, 'orphaned');
  assert.equal(audited.capacity_counted_pct, 4);
});

test('reviewer P1-3: multi-key crash is logically all-or-none and retry repairs', async () => {
  const quotaHome = home('ccm-quota-multikey-journal-');
  await publishAuthority(authorityStore(quotaHome), ['bucket-A', 'bucket-B'], {
    'bucket-A': 10,
    'bucket-B': 10,
  });
  let authoritativePublishes = 0;
  const crashingFs = new Proxy(fsPromises as unknown as Record<PropertyKey, unknown>, {
    get(target, property): unknown {
      if (property !== 'rename') return Reflect.get(target, property, target);
      return async (from: string, to: string) => {
        if (to.includes('/transactions/') && to.endsWith('/current.json')) {
          authoritativePublishes += 1;
          if (authoritativePublishes === 2) {
            const error = new Error('injected coordinator crash') as NodeJS.ErrnoException;
            error.code = 'EIO';
            throw error;
          }
        }
        return fsPromises.rename(from, to);
      };
    },
  });
  const request = reservation({
    aggregation_keys: ['bucket-A', 'bucket-B'],
    capacity_pct: { 'bucket-A': 10, 'bucket-B': 10 },
    amount_pct: { 'bucket-A': 4, 'bucket-B': 4 },
  });
  delete request.aggregation_key;
  await assert.rejects(() => authorityStore(quotaHome, crashingFs).reserve(request), /injected/);
  const afterCrash = authorityStore(quotaHome);
  assert.equal((await afterCrash.inspectAggregation('bucket-A')).active_reserved_pct, 0);
  assert.equal((await afterCrash.inspectAggregation('bucket-B')).active_reserved_pct, 0);

  const retried = await afterCrash.reserve(request);
  assert.equal(retried.action, 'created');
  assert.equal((await afterCrash.inspectAggregation('bucket-A')).active_reserved_pct, 4);
  assert.equal((await afterCrash.inspectAggregation('bucket-B')).active_reserved_pct, 4);
  const idempotent = await afterCrash.reserve(request);
  assert.equal(idempotent.action, 'idempotent-existing');

  const committedHome = home('ccm-quota-multikey-committed-crash-');
  await publishAuthority(authorityStore(committedHome), ['bucket-A', 'bucket-B'], {
    'bucket-A': 10,
    'bucket-B': 10,
  });
  let projectionPublishes = 0;
  const projectionCrashFs = new Proxy(fsPromises as unknown as Record<PropertyKey, unknown>, {
    get(target, property): unknown {
      if (property !== 'rename') return Reflect.get(target, property, target);
      return async (from: string, to: string) => {
        if (to.includes('/reservations/') && to.endsWith('/snapshot.json')) {
          projectionPublishes += 1;
          if (projectionPublishes === 1) {
            const error = new Error(
              'injected post-commit projection crash',
            ) as NodeJS.ErrnoException;
            error.code = 'EIO';
            throw error;
          }
        }
        return fsPromises.rename(from, to);
      };
    },
  });
  await assert.rejects(
    () => authorityStore(committedHome, projectionCrashFs).reserve(request),
    /post-commit projection crash/,
  );
  const afterCommittedCrash = authorityStore(committedHome);
  const repaired = await afterCommittedCrash.reserve(request);
  assert.equal(repaired.action, 'idempotent-existing');
  const repairedA = await afterCommittedCrash.inspectAggregation('bucket-A');
  const repairedB = await afterCommittedCrash.inspectAggregation('bucket-B');
  assert.equal(repairedA.active_reserved_pct, 4);
  assert.equal(repairedB.active_reserved_pct, 4);
  assert.equal(repairedA.snapshot_rebuilt, false);
  assert.equal(repairedB.snapshot_rebuilt, false);
});

test('reviewer P1-4: preflight derives Codex 7d authority from store and keeps rolling24h advisory', async () => {
  const store = authorityStore(home('ccm-quota-store-preflight-'));
  await store.publishObservation({
    source_key: 'codex-current',
    observation: {
      schema: 'ccm/quota-authority-observation/v1',
      provider: 'codex',
      provider_rule_revision: 'ccm/codex-7d-pacing/v1',
      source_revision: 'sha256:live-r2',
      ...freshnessEnvelope(),
      identity: 'identity-A',
      identity_fingerprint: 'sha256:identity-A',
      account_id: 'identity-A',
      pool_id: 'pool-A',
      hard_window: { name: 'seven_day', duration_sec: 604800 },
      policy: {
        decision: 'allow',
        revision: 'ccm/codex-7d-pacing/v1',
        hard_ceiling_used_pct: 85,
      },
      effects: { decision: 'allow', effect: 'read-only' },
      buckets: [
        {
          id: 'five-hour-poison',
          window: 'five_hour',
          duration_sec: 18000,
          freshness: 'fresh',
          used_pct: 100,
          aggregation_key: 'codex|identity-A|pool-A|five_hour',
        },
        {
          id: 'seven-day',
          window: 'seven_day',
          duration_sec: 604800,
          freshness: 'fresh',
          used_pct: 20,
          safety_margin_pct: 5,
          projected_p80_pct: 4,
          aggregation_key: 'codex|identity-A|pool-A|seven_day',
        },
      ],
      rolling24h: { advisory: 'throttle-risk', hard_gate_effect: 'none' },
    },
  });
  const created = await store.reserve(reservation({ capacity_pct: 60 }));
  assert.equal(created.action, 'created');
  assert.equal(
    (
      await store.commitReservation({
        reservation_id: 'qres-1',
        checked_at: new Date().toISOString(),
        ticket: ticket({ reservation_request_hash: created.request_hash }),
      })
    ).action,
    'committed',
  );

  const result = await store.preflight({
    source_key: 'codex-current',
    reservation_id: 'qres-1',
    checked_at: '2026-07-14T00:00:10Z',
    live: { state: 'ample' },
    policy: { decision: 'deny' },
  });
  assert.equal(result.decision, 'launch-claim-allowed');
  assert.equal(result.automatic_spawn_limit, 1);
  assert.deepEqual(result.advisories, ['throttle-risk']);
  assert.equal(result.hard_window, 'seven_day');
  assert.equal(result.provider_rule_revision, 'ccm/codex-7d-pacing/v1');
  assert.deepEqual(result.ignored_windows, ['five_hour']);

  await store.publishObservation({
    source_key: 'codex-empty',
    observation: {
      schema: 'ccm/quota-authority-observation/v1',
      provider: 'codex',
      provider_rule_revision: 'ccm/codex-7d-pacing/v1',
      source_revision: 'sha256:live-r2',
      ...freshnessEnvelope(),
      identity: 'identity-A',
      identity_fingerprint: 'sha256:identity-A',
      account_id: 'identity-A',
      pool_id: 'pool-A',
      hard_window: { name: 'seven_day', duration_sec: 604800 },
      policy: { decision: 'allow', revision: 'ccm/codex-7d-pacing/v1', hard_ceiling_used_pct: 85 },
      effects: { decision: 'allow', effect: 'read-only' },
      buckets: [],
    },
  });
  const empty = await store.preflight({
    source_key: 'codex-empty',
    reservation_id: 'qres-1',
    checked_at: '2026-07-14T00:00:10Z',
  });
  assert.equal(empty.decision, 'reject');
  assert.equal(empty.automatic_spawn_limit, 0);
});

test('final review P1-3: provider-neutral hard window reaches production reserve, commit, and preflight', async () => {
  const nowMs = Date.now();
  const checkedAt = new Date(nowMs).toISOString();
  const expiresAt = new Date(nowMs + 120_000).toISOString();
  const aggregationKey = 'acme|identity-A|pool-A|thirty_day';
  const store = authorityStore(
    home('ccm-quota-provider-neutral-'),
    undefined,
    () => new Date(nowMs),
  );
  await store.publishObservation({
    source_key: 'acme-current',
    observation: {
      schema: 'ccm/quota-authority-observation/v1',
      provider: 'acme',
      provider_rule_revision: 'acme/thirty-day/v1',
      source_revision: 'sha256:live-r2',
      ...freshnessEnvelope(nowMs),
      identity: 'identity-A',
      identity_fingerprint: 'sha256:identity-A',
      account_id: 'identity-A',
      pool_id: 'pool-A',
      hard_window: { name: 'thirty_day', duration_sec: 2_592_000 },
      policy: {
        decision: 'allow',
        revision: 'acme/thirty-day/v1',
        hard_ceiling_used_pct: 85,
      },
      effects: { decision: 'allow', effect: 'read-only' },
      buckets: [
        {
          id: 'thirty-day',
          window: 'thirty_day',
          duration_sec: 2_592_000,
          freshness: 'fresh',
          used_pct: 65,
          safety_margin_pct: 0,
          projected_p80_pct: 0,
          aggregation_key: aggregationKey,
        },
      ],
    },
  });
  const held = await store.reserve(
    reservation({
      source_key: 'acme-current',
      aggregation_key: aggregationKey,
      checked_at: checkedAt,
      expires_at: expiresAt,
    }),
  );
  assert.equal(held.action, 'created');
  const committed = await store.commitReservation({
    reservation_id: 'qres-1',
    checked_at: checkedAt,
    ticket: ticket({
      reservation_request_hash: held.request_hash,
      reservation_expires_at: expiresAt,
      aggregation_key: aggregationKey,
      issued_at: checkedAt,
      launch_by: new Date(nowMs + 60_000).toISOString(),
    }),
  });
  assert.equal(committed.action, 'committed');
  const result = await store.preflight({
    source_key: 'acme-current',
    reservation_id: 'qres-1',
    checked_at: checkedAt,
  });
  assert.equal(result.decision, 'launch-claim-allowed');
  assert.equal(result.automatic_spawn_limit, 1);
  assert.equal(result.hard_window, 'thirty_day');
  assert.equal(result.provider_rule_revision, 'acme/thirty-day/v1');
  assert.deepEqual(result.ignored_windows, []);
});

test('reviewer R3 P1: preflight rejects a cross-source authority rebind', async () => {
  const store = await r3CommittedAuthority('ccm-quota-r3-cross-source-');
  await store.publishObservation({
    source_key: 'source-B',
    observation: r3AuthorityObservation(
      'future-provider',
      'future-provider/thirty-day/v1',
      'thirty_day',
      2_592_000,
      0,
      95,
    ),
  });

  const preflight = await store.preflight({
    source_key: 'source-B',
    reservation_id: 'qres-1',
    checked_at: '2026-07-14T00:00:00.000Z',
  });
  assert.equal(preflight.decision, 'reject');
  assert.equal(preflight.automatic_spawn_limit, 0);
  assert.deepEqual(preflight.blocking_reasons, ['ADMISSION_COMMIT_MISSING_OR_INVALID']);
  assert.equal((await store.inspectAggregation(r3AggregationKey)).active_reserved_pct, 4);
});

test('reviewer R3 P1: preflight rejects same-source same-revision authority rewrite', async () => {
  const store = await r3CommittedAuthority('ccm-quota-r3-same-source-rewrite-');
  await store.publishObservation({
    source_key: 'source-A',
    observation: r3AuthorityObservation(
      'codex',
      'ccm/codex-7d-pacing/v1',
      'seven_day',
      604_800,
      0,
      85,
    ),
  });

  const preflight = await store.preflight({
    source_key: 'source-A',
    reservation_id: 'qres-1',
    checked_at: '2026-07-14T00:00:00.000Z',
  });
  assert.equal(preflight.decision, 'reject');
  assert.equal(preflight.automatic_spawn_limit, 0);
  assert.deepEqual(preflight.blocking_reasons, ['ADMISSION_COMMIT_MISSING_OR_INVALID']);
  assert.equal((await store.inspectAggregation(r3AggregationKey)).active_reserved_pct, 4);
});

test('reviewer P2-1: managed lock owner includes boot and process-start identity', async () => {
  const lockOwners: Data[] = [];
  const filesystem = new Proxy(fsPromises as unknown as Record<PropertyKey, unknown>, {
    get(target, property): unknown {
      if (property !== 'open') return Reflect.get(target, property, target);
      return async (path: string, flags: string | number, mode?: number) => {
        const handle = await fsPromises.open(path, flags, mode);
        if (!path.endsWith('/lock')) return handle;
        return new Proxy(handle, {
          get(fileHandle, handleProperty): unknown {
            if (handleProperty === 'writeFile') {
              return async (value: string) => {
                lockOwners.push(JSON.parse(value) as Data);
                return fileHandle.writeFile(value);
              };
            }
            const member = Reflect.get(fileHandle, handleProperty, fileHandle) as unknown;
            return typeof member === 'function' ? member.bind(fileHandle) : member;
          },
        });
      };
    },
  });
  const store = authorityStore(home('ccm-quota-lock-identity-'), filesystem);
  await publishAuthority(store, ['codex|identity-A|pool-A|seven_day'], 20);
  assert.equal((await store.reserve(reservation())).action, 'created');
  assert.ok(lockOwners.length > 0);
  for (const owner of lockOwners) {
    assert.equal(typeof owner.boot_id, 'string');
    assert.notEqual(owner.boot_id, '');
    assert.notEqual(owner.boot_id, 'unknown');
    assert.equal(typeof owner.process_start_identity, 'string');
    assert.notEqual(owner.process_start_identity, '');
    assert.notEqual(owner.process_start_identity, 'unknown');
  }

  if (platform() === 'linux') {
    const staleHome = home('ccm-quota-lock-recovery-');
    const aggregationKey = 'codex|identity-A|pool-A|seven_day';
    const aggregationHash = createHash('sha256').update(aggregationKey).digest('hex');
    const aggregationRoot = join(staleHome, 'quota', 'v1', 'reservations', aggregationHash);
    mkdirSync(aggregationRoot, { recursive: true, mode: 0o700 });
    writeFileSync(
      join(aggregationRoot, 'lock'),
      `${JSON.stringify({
        schema: 'ccm/quota-lock/v1',
        managed_by: 'ccm-quota-store',
        pid: 2_147_483_647,
        boot_id: readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim(),
        boot_id_source: 'linux-proc',
        process_start_identity: 'definitely-not-live',
        process_start_identity_source: 'linux-proc',
        owner_nonce: 'stale-owner',
        acquired_at: '2026-07-14T00:00:00Z',
      })}\n`,
      { mode: 0o600 },
    );
    await publishAuthority(authorityStore(staleHome), [aggregationKey], 20);
    const recovered = await authorityStore(staleHome).reserve(
      reservation({ id: 'qres-recovered', key: 'attempt-recovered' }),
    );
    assert.equal(recovered.action, 'created');
    assert.equal(
      readdirSync(aggregationRoot).some((name) => name.startsWith('lock-recovery-')),
      true,
    );
  }
});

test('reviewer R2 P1-1: reserve capacity and idempotency digest come from store authority', async () => {
  const store = authorityStore(home('ccm-quota-authoritative-reserve-'));
  await publishAuthority(store, ['codex|identity-A|pool-A|seven_day'], 3);
  const oversized = await store.reserve(
    reservation({ capacity_pct: 100, amount_pct: 50, hash: 'sha256:caller-forged' }),
  );
  assert.equal(oversized.action, 'rejected');
  assert.equal(oversized.error, 'RESERVATION_AUTHORITY_MISMATCH');

  const validHome = home('ccm-quota-canonical-digest-');
  const validStore = authorityStore(validHome);
  await publishAuthority(validStore, ['codex|identity-A|pool-A|seven_day'], 20);
  const created = await validStore.reserve(reservation());
  assert.equal(created.action, 'created');
  assert.match(String(created.request_hash), /^sha256:[a-f0-9]{64}$/);
  const changedCanonicalBinding = await validStore.reserve(
    reservation({
      id: 'qres-binding-counterfeit',
      hash: String(created.request_hash),
      amount_pct: 5,
      attempt_id: 'attempt-binding-counterfeit',
      candidate_id: 'candidate-binding-counterfeit',
    }),
  );
  assert.equal(changedCanonicalBinding.action, 'rejected');
  assert.equal(changedCanonicalBinding.error, 'RESERVATION_IDEMPOTENCY_CONFLICT');
  const changedBinding = await validStore.reserve(
    reservation({
      id: 'qres-counterfeit',
      hash: String(created.request_hash),
      source_revision: 'sha256:live-r999',
      attempt_id: 'attempt-counterfeit',
      candidate_id: 'candidate-counterfeit',
      account_id: 'account-counterfeit',
      pool_id: 'pool-counterfeit',
      identity_fingerprint: 'sha256:identity-counterfeit',
    }),
  );
  assert.equal(changedBinding.action, 'rejected');
  assert.match(
    String(changedBinding.error),
    /RESERVATION_(?:AUTHORITY|IDEMPOTENCY)_(?:MISMATCH|CONFLICT)/,
  );
});

test('reviewer R2 P1-2: reservation id collision is globally rejected and replay-stable', async () => {
  const quotaHome = home('ccm-quota-id-collision-');
  const store = authorityStore(quotaHome);
  await publishAuthority(store, ['bucket-A', 'bucket-B'], { 'bucket-A': 20, 'bucket-B': 20 });
  assert.equal(
    (await store.reserve(reservation({ aggregation_key: 'bucket-A' }))).action,
    'created',
  );
  const collision = await store.reserve(
    reservation({
      aggregation_key: 'bucket-B',
      key: 'attempt-2',
      attempt_id: 'attempt-2',
      hash: 'sha256:request-2',
    }),
  );
  assert.equal(collision.action, 'rejected');
  assert.equal(collision.error, 'RESERVATION_ID_CONFLICT');
  const before = await store.inspectAggregation('bucket-A');
  const after = await authorityStore(quotaHome).inspectAggregation('bucket-A');
  assert.equal(before.active_reserved_pct, 4);
  assert.equal(after.active_reserved_pct, 4);
  assert.equal((before.reservations as Data[]).length, 1);
  assert.equal((after.reservations as Data[]).length, 1);
  assert.equal((await store.inspectAggregation('bucket-B')).active_reserved_pct, 0);
});

test('reviewer R2 P1-3: committed multi-key journal owns lookup and all-leg audit transition', async () => {
  const expiresAt = new Date(Date.now() + 60_000).toISOString();
  const auditAt = new Date(Date.now() + 120_000).toISOString();
  const quotaHome = home('ccm-quota-multikey-transition-');
  const store = authorityStore(quotaHome);
  await publishAuthority(store, ['bucket-A', 'bucket-B'], { 'bucket-A': 10, 'bucket-B': 10 });
  const request = reservation({
    aggregation_keys: ['bucket-A', 'bucket-B'],
    capacity_pct: { 'bucket-A': 10, 'bucket-B': 10 },
    amount_pct: { 'bucket-A': 4, 'bucket-B': 4 },
    expires_at: expiresAt,
  });
  delete request.aggregation_key;
  assert.equal((await store.reserve(request)).action, 'created');
  const audited = await store.auditReservation({
    reservation_id: 'qres-1',
    now: auditAt,
    launch_evidence: { store_locked: true, claim: 'absent', process_identity: 'proven-absent' },
  });
  assert.equal(audited.action, 'expired');
  assert.equal((await store.inspectAggregation('bucket-A')).active_reserved_pct, 0);
  assert.equal((await store.inspectAggregation('bucket-B')).active_reserved_pct, 0);

  const releaseRequest = {
    ...request,
    id: 'qres-release',
    key: 'attempt-release',
    attempt_id: 'attempt-release',
    checked_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 300_000).toISOString(),
  };
  assert.equal((await store.reserve(releaseRequest)).action, 'created');
  const releasePending = await store.auditReservation({
    reservation_id: 'qres-release',
    terminal_evidence: { terminal: 'succeeded', cleanup: 'pending' },
  });
  assert.equal(releasePending.state, 'orphaned');
  assert.equal((await store.inspectAggregation('bucket-A')).active_reserved_pct, 4);
  assert.equal((await store.inspectAggregation('bucket-B')).active_reserved_pct, 4);
  const released = await store.auditReservation({
    reservation_id: 'qres-release',
    audit: { terminal: 'succeeded', child: 'proven-absent', cleanup: 'complete' },
  });
  assert.equal(released.state, 'orphaned');
  assert.equal((await store.inspectAggregation('bucket-A')).active_reserved_pct, 4);
  assert.equal((await store.inspectAggregation('bucket-B')).active_reserved_pct, 4);

  const crashHome = home('ccm-quota-multikey-transition-crash-');
  await publishAuthority(authorityStore(crashHome), ['bucket-A', 'bucket-B'], {
    'bucket-A': 10,
    'bucket-B': 10,
  });
  let projectionPublishes = 0;
  const projectionCrashFs = new Proxy(fsPromises as unknown as Record<PropertyKey, unknown>, {
    get(target, property): unknown {
      if (property !== 'rename') return Reflect.get(target, property, target);
      return async (from: string, to: string) => {
        if (to.includes('/reservations/') && to.endsWith('/snapshot.json')) {
          projectionPublishes += 1;
          if (projectionPublishes === 1) {
            const error = new Error(
              'injected transition projection crash',
            ) as NodeJS.ErrnoException;
            error.code = 'EIO';
            throw error;
          }
        }
        return fsPromises.rename(from, to);
      };
    },
  });
  await assert.rejects(
    () => authorityStore(crashHome, projectionCrashFs).reserve(request),
    /transition projection crash/,
  );
  const recovered = authorityStore(crashHome);
  const recoveredAudit = await recovered.auditReservation({
    reservation_id: 'qres-1',
    now: auditAt,
    launch_evidence: { store_locked: true, claim: 'absent', process_identity: 'proven-absent' },
  });
  assert.equal(recoveredAudit.action, 'expired');
  assert.equal((await recovered.inspectAggregation('bucket-A')).active_reserved_pct, 0);
  assert.equal((await recovered.inspectAggregation('bucket-B')).active_reserved_pct, 0);
  assert.equal(
    (
      await recovered.auditReservation({
        reservation_id: 'qres-1',
        now: auditAt,
        launch_evidence: { store_locked: true, claim: 'absent', process_identity: 'proven-absent' },
      })
    ).action,
    'idempotent-existing',
  );

  const auditCrashHome = home('ccm-quota-multikey-audit-projection-crash-');
  const auditCrashBase = authorityStore(auditCrashHome);
  await publishAuthority(auditCrashBase, ['bucket-A', 'bucket-B'], {
    'bucket-A': 10,
    'bucket-B': 10,
  });
  assert.equal((await auditCrashBase.reserve(request)).action, 'created');
  let auditProjectionPublishes = 0;
  const auditProjectionCrashFs = new Proxy(fsPromises as unknown as Record<PropertyKey, unknown>, {
    get(target, property): unknown {
      if (property !== 'rename') return Reflect.get(target, property, target);
      return async (from: string, to: string) => {
        if (to.includes('/reservations/') && to.endsWith('/snapshot.json')) {
          auditProjectionPublishes += 1;
          if (auditProjectionPublishes === 1) {
            const error = new Error(
              'injected post-audit-commit projection crash',
            ) as NodeJS.ErrnoException;
            error.code = 'EIO';
            throw error;
          }
        }
        return fsPromises.rename(from, to);
      };
    },
  });
  await assert.rejects(
    () =>
      authorityStore(auditCrashHome, auditProjectionCrashFs).auditReservation({
        reservation_id: 'qres-1',
        now: auditAt,
        launch_evidence: {
          store_locked: true,
          claim: 'absent',
          process_identity: 'proven-absent',
        },
      }),
    /post-audit-commit projection crash/,
  );
  const auditRecovered = authorityStore(auditCrashHome);
  assert.equal(
    (
      await auditRecovered.auditReservation({
        reservation_id: 'qres-1',
        now: auditAt,
        launch_evidence: {
          store_locked: true,
          claim: 'absent',
          process_identity: 'proven-absent',
        },
      })
    ).action,
    'idempotent-existing',
  );
  for (const aggregationKey of ['bucket-A', 'bucket-B']) {
    const aggregationDigest = createHash('sha256').update(aggregationKey).digest('hex');
    const snapshot = JSON.parse(
      readFileSync(
        join(auditCrashHome, 'quota', 'v1', 'reservations', aggregationDigest, 'snapshot.json'),
        'utf8',
      ),
    ) as Data;
    assert.equal(snapshot.active_reserved_pct, 0);
    assert.equal((snapshot.reservations as Data[])[0]?.state, 'expired');
  }
  const transactionDigest = createHash('sha256').update('attempt-1').digest('hex');
  const transactionRef = join(
    auditCrashHome,
    'quota',
    'v1',
    'transactions',
    transactionDigest,
    'current.json',
  );
  const corruptedTransaction = JSON.parse(readFileSync(transactionRef, 'utf8')) as Data;
  const corruptedLegs = corruptedTransaction.legs as Data[];
  const corruptedReservation = corruptedLegs[0]?.reservation as Data;
  corruptedLegs[0] = {
    ...corruptedLegs[0],
    reservation: { ...corruptedReservation, amount_pct: 9 },
  };
  writeFileSync(transactionRef, `${JSON.stringify(corruptedTransaction)}\n`, 'utf8');
  await assert.rejects(
    () => auditRecovered.inspectAggregation('bucket-A'),
    /transaction request hash mismatch/,
  );
});

test('reviewer R2 P1-4: expired audit retry is terminal and cannot reoccupy capacity', async () => {
  const expiresAt = new Date(Date.now() + 60_000).toISOString();
  const auditAt = new Date(Date.now() + 120_000).toISOString();
  const quotaHome = home('ccm-quota-terminal-audit-');
  const store = authorityStore(quotaHome);
  await publishAuthority(store, ['codex|identity-A|pool-A|seven_day'], 20);
  assert.equal((await store.reserve(reservation({ expires_at: expiresAt }))).action, 'created');
  const input = {
    reservation_id: 'qres-1',
    now: auditAt,
    launch_evidence: { store_locked: true, claim: 'absent', process_identity: 'proven-absent' },
  };
  const first = await store.auditReservation(input);
  const second = await store.auditReservation(input);
  assert.equal(first.state, 'expired');
  assert.equal(second.state, 'expired');
  assert.equal(second.action, 'idempotent-existing');
  const inspected = await authorityStore(quotaHome).inspectAggregation(
    'codex|identity-A|pool-A|seven_day',
  );
  assert.equal(inspected.active_reserved_pct, 0);
  assert.equal((inspected.reservations as Data[])[0]?.state, 'expired');
  assert.equal(inspected.durable_event_count, 2);
});

test('reviewer R3 P1-1: idempotency key is machine-scoped across provisional ids and aggregations', async () => {
  const quotaHome = home('ccm-quota-global-idempotency-key-');
  const store = authorityStore(quotaHome);
  await publishAuthority(store, ['bucket-A', 'bucket-B'], { 'bucket-A': 20, 'bucket-B': 20 });
  const first = await store.reserve(
    reservation({
      id: 'provisional-A',
      key: 'same-machine-key',
      aggregation_key: 'bucket-A',
    }),
  );
  assert.equal(first.action, 'created');
  const conflicting = await store.reserve(
    reservation({
      id: 'provisional-B',
      key: 'same-machine-key',
      aggregation_key: 'bucket-B',
    }),
  );
  assert.equal(conflicting.action, 'rejected');
  assert.equal(conflicting.error, 'RESERVATION_IDEMPOTENCY_CONFLICT');
  assert.equal(
    (await authorityStore(quotaHome).inspectAggregation('bucket-A')).active_reserved_pct,
    4,
  );
  assert.equal(
    (await authorityStore(quotaHome).inspectAggregation('bucket-B')).active_reserved_pct,
    0,
  );

  const concurrentHome = home('ccm-quota-global-idempotency-concurrency-');
  const concurrentStore = authorityStore(concurrentHome);
  await publishAuthority(concurrentStore, ['bucket-A', 'bucket-B'], {
    'bucket-A': 20,
    'bucket-B': 20,
  });
  const contenders = await Promise.all(
    Array.from({ length: 10 }, (_, index) =>
      authorityStore(concurrentHome).reserve(
        reservation({
          id: `provisional-concurrent-${index}`,
          key: 'same-concurrent-machine-key',
          aggregation_key: index % 2 === 0 ? 'bucket-A' : 'bucket-B',
        }),
      ),
    ),
  );
  assert.equal(contenders.filter((result) => result.action === 'created').length, 1);
  assert.equal(
    contenders.every((result) =>
      ['created', 'idempotent-existing', 'rejected'].includes(String(result.action)),
    ),
    true,
  );
  const concurrentA = await authorityStore(concurrentHome).inspectAggregation('bucket-A');
  const concurrentB = await authorityStore(concurrentHome).inspectAggregation('bucket-B');
  assert.equal(
    Number(concurrentA.active_reserved_pct) + Number(concurrentB.active_reserved_pct),
    4,
  );
  assert.equal(
    (concurrentA.reservations as Data[]).length + (concurrentB.reservations as Data[]).length,
    1,
  );

  const indexCrashHome = home('ccm-quota-global-idempotency-index-crash-');
  await publishAuthority(authorityStore(indexCrashHome), ['bucket-A'], 20);
  let failedIndexPublish = false;
  const indexCrashFs = new Proxy(fsPromises as unknown as Record<PropertyKey, unknown>, {
    get(target, property): unknown {
      if (property !== 'rename') return Reflect.get(target, property, target);
      return async (from: string, to: string) => {
        if (
          !failedIndexPublish &&
          to.includes('/reservation-keys/') &&
          to.endsWith('/current.json')
        ) {
          failedIndexPublish = true;
          const error = new Error(
            'injected idempotency index publish crash',
          ) as NodeJS.ErrnoException;
          error.code = 'EIO';
          throw error;
        }
        return fsPromises.rename(from, to);
      };
    },
  });
  const indexRequest = reservation({
    id: 'provisional-index-crash',
    key: 'same-index-crash-key',
    aggregation_key: 'bucket-A',
  });
  await assert.rejects(
    () => authorityStore(indexCrashHome, indexCrashFs).reserve(indexRequest),
    /idempotency index publish crash/,
  );
  const indexRecovered = await authorityStore(indexCrashHome).reserve(indexRequest);
  assert.equal(indexRecovered.action, 'idempotent-existing');
  assert.equal(
    (await authorityStore(indexCrashHome).inspectAggregation('bucket-A')).durable_event_count,
    1,
  );
});

test('reviewer R3 P1-2: Codex policy revision and percentage domain fail closed before hold', async () => {
  const reserveAgainst = async (
    quotaHome: string,
    policy: Data,
    usedPct: number,
    capacityPct: number,
    amountPct: number,
  ): Promise<Data> => {
    const store = authorityStore(quotaHome);
    await store.publishObservation({
      source_key: 'codex-current',
      observation: {
        schema: 'ccm/quota-authority-observation/v1',
        provider: 'codex',
        provider_rule_revision: 'ccm/codex-7d-pacing/v1',
        source_revision: 'sha256:live-r2',
        ...freshnessEnvelope(),
        account_id: 'identity-A',
        pool_id: 'pool-A',
        identity_fingerprint: 'sha256:identity-A',
        hard_window: { name: 'seven_day', duration_sec: 604_800 },
        policy,
        effects: { decision: 'allow', effect: 'read-only' },
        buckets: [
          {
            id: 'seven-day:policy-domain',
            window: 'seven_day',
            duration_sec: 604_800,
            freshness: 'fresh',
            used_pct: usedPct,
            safety_margin_pct: 0,
            projected_p80_pct: 0,
            aggregation_key: 'codex|identity-A|pool-A|seven_day',
          },
        ],
      },
    });
    return await store.reserve(reservation({ capacity_pct: capacityPct, amount_pct: amountPct }));
  };

  const counterfeitPolicy = await reserveAgainst(
    home('ccm-quota-counterfeit-policy-'),
    { decision: 'allow', revision: 'counterfeit-policy/v999', hard_ceiling_used_pct: 85 },
    75,
    10,
    4,
  );
  assert.equal(counterfeitPolicy.action, 'rejected');
  assert.equal(counterfeitPolicy.error, 'QUOTA_AUTHORITY_MISSING');
  assert.equal(counterfeitPolicy.new_reservation_count, 0);

  const impossibleCeiling = await reserveAgainst(
    home('ccm-quota-impossible-ceiling-'),
    { decision: 'allow', revision: 'ccm/codex-7d-pacing/v1', hard_ceiling_used_pct: 185 },
    0,
    85,
    4,
  );
  assert.equal(impossibleCeiling.action, 'rejected');
  assert.equal(impossibleCeiling.error, 'QUOTA_AUTHORITY_MISSING');
  assert.equal(impossibleCeiling.new_reservation_count, 0);

  const impossibleCallerAssertion = await reserveAgainst(
    home('ccm-quota-impossible-caller-assertion-'),
    { decision: 'allow', revision: 'ccm/codex-7d-pacing/v1', hard_ceiling_used_pct: 85 },
    0,
    185,
    4,
  );
  assert.equal(impossibleCallerAssertion.action, 'rejected');
  assert.equal(impossibleCallerAssertion.error, 'RESERVATION_INVALID_REQUEST');
  assert.equal(impossibleCallerAssertion.invalid_field, 'capacity_pct');
  assert.equal(impossibleCallerAssertion.new_reservation_count, 0);

  for (const [label, usedPct] of [
    ['negative', -1],
    ['above-domain', 101],
  ] as const) {
    const invalidBucket = await reserveAgainst(
      home(`ccm-quota-${label}-bucket-`),
      { decision: 'allow', revision: 'ccm/codex-7d-pacing/v1', hard_ceiling_used_pct: 85 },
      usedPct,
      20,
      4,
    );
    assert.equal(invalidBucket.action, 'rejected');
    assert.equal(invalidBucket.error, 'QUOTA_AUTHORITY_MISSING');
    assert.equal(invalidBucket.new_reservation_count, 0);
  }

  const preflightHome = home('ccm-quota-invalid-policy-preflight-');
  const preflightStore = authorityStore(preflightHome);
  await publishAuthority(preflightStore, ['codex|identity-A|pool-A|seven_day'], 20);
  const held = await preflightStore.reserve(reservation());
  assert.equal(held.action, 'created');
  const committed = await preflightStore.commitReservation({
    reservation_id: 'qres-1',
    checked_at: new Date().toISOString(),
    ticket: ticket({ reservation_request_hash: held.request_hash }),
  });
  assert.equal(committed.action, 'committed');
  const preflightObservationRef = join(
    preflightHome,
    'quota',
    'v1',
    'observations',
    createHash('sha256').update('codex-current').digest('hex'),
    'current.json',
  );
  const validObservation = JSON.parse(readFileSync(preflightObservationRef, 'utf8')) as Data;
  await preflightStore.publishObservation({
    source_key: 'codex-current',
    observation: {
      ...validObservation,
      policy: {
        ...((validObservation.policy ?? {}) as Data),
        hard_ceiling_used_pct: 185,
      },
    },
  });
  const invalidPreflight = await preflightStore.preflight({
    source_key: 'codex-current',
    reservation_id: 'qres-1',
    checked_at: '2026-07-14T00:00:10Z',
  });
  assert.equal(invalidPreflight.decision, 'reject');
  assert.equal(invalidPreflight.automatic_spawn_limit, 0);
});

test('reviewer R3 P1-3: explicit source key cannot bypass embedded directory identity', async () => {
  const quotaHome = home('ccm-quota-explicit-source-identity-');
  const store = authorityStore(quotaHome);
  await publishAuthority(store, ['codex|identity-A|pool-A|seven_day'], 20);
  const observationRef = join(
    quotaHome,
    'quota',
    'v1',
    'observations',
    createHash('sha256').update('codex-current').digest('hex'),
    'current.json',
  );
  const observation = JSON.parse(readFileSync(observationRef, 'utf8')) as Data;
  writeFileSync(
    observationRef,
    `${JSON.stringify({ ...observation, source_key: 'different-authority-coordinate' })}\n`,
    'utf8',
  );
  await assert.rejects(
    () => store.reserve(reservation({ source_key: 'codex-current' })),
    /observation directory identity mismatch/,
  );
});

test('reviewer R3 P2-1: single-key terminal retry repairs post-event stale projection', async () => {
  const expiresAt = new Date(Date.now() + 60_000).toISOString();
  const auditAt = new Date(Date.now() + 120_000).toISOString();
  const quotaHome = home('ccm-quota-single-transition-projection-crash-');
  const aggregationKey = 'codex|identity-A|pool-A|seven_day';
  const store = authorityStore(quotaHome);
  await publishAuthority(store, [aggregationKey], 20);
  assert.equal((await store.reserve(reservation({ expires_at: expiresAt }))).action, 'created');
  const aggregationDigest = createHash('sha256').update(aggregationKey).digest('hex');
  const snapshotRef = join(
    quotaHome,
    'quota',
    'v1',
    'reservations',
    aggregationDigest,
    'snapshot.json',
  );
  let failed = false;
  const projectionCrashFs = new Proxy(fsPromises as unknown as Record<PropertyKey, unknown>, {
    get(target, property): unknown {
      if (property !== 'rename') return Reflect.get(target, property, target);
      return async (from: string, to: string) => {
        if (!failed && to === snapshotRef) {
          failed = true;
          const error = new Error(
            'injected single transition projection crash',
          ) as NodeJS.ErrnoException;
          error.code = 'EIO';
          throw error;
        }
        return fsPromises.rename(from, to);
      };
    },
  });
  const auditInput = {
    reservation_id: 'qres-1',
    now: auditAt,
    launch_evidence: { store_locked: true, claim: 'absent', process_identity: 'proven-absent' },
  };
  await assert.rejects(
    () => authorityStore(quotaHome, projectionCrashFs).auditReservation(auditInput),
    /single transition projection crash/,
  );
  const stale = JSON.parse(readFileSync(snapshotRef, 'utf8')) as Data;
  assert.equal(stale.active_reserved_pct, 4);
  assert.equal((stale.reservations as Data[])[0]?.state, 'held');

  const retried = await authorityStore(quotaHome).auditReservation(auditInput);
  assert.equal(retried.action, 'idempotent-existing');
  assert.equal(retried.state, 'expired');
  const repaired = JSON.parse(readFileSync(snapshotRef, 'utf8')) as Data;
  assert.equal(repaired.active_reserved_pct, 0);
  assert.equal((repaired.reservations as Data[])[0]?.state, 'expired');
});

test('reviewer R4 P1-1: truncated first event blocks global key, id, reserve, and audit paths', async () => {
  const seeded = await seededSingleAuthority('ccm-quota-r4-global-id-corruption-');
  unlinkSync(seeded.snapshotRef);
  writeFileSync(seeded.eventRef, '{"truncated":', 'utf8');
  await assertCorruptAuthorityBlocksNewReservation(seeded);
});

test('reviewer R4 P1-1: undecodable authority identity variants fail closed', async (t) => {
  await t.test('invalid first-event JSON', async () => {
    const seeded = await seededSingleAuthority('ccm-quota-r4-invalid-event-json-');
    writeFileSync(seeded.snapshotRef, '{"damaged":', 'utf8');
    writeFileSync(seeded.eventRef, 'not-json', 'utf8');
    await assertCorruptAuthorityBlocksNewReservation(seeded);
  });

  await t.test('first event missing aggregation_key', async () => {
    const seeded = await seededSingleAuthority('ccm-quota-r4-missing-event-aggregation-');
    unlinkSync(seeded.snapshotRef);
    const event = JSON.parse(readFileSync(seeded.eventRef, 'utf8')) as Data;
    delete event.aggregation_key;
    writeFileSync(seeded.eventRef, `${JSON.stringify(event)}\n`, 'utf8');
    await assertCorruptAuthorityBlocksNewReservation(seeded);
  });

  await t.test('event identity does not match directory hash', async () => {
    const seeded = await seededSingleAuthority('ccm-quota-r4-directory-hash-mismatch-');
    unlinkSync(seeded.snapshotRef);
    const mismatchedRoot = join(
      seeded.quotaHome,
      'quota',
      'v1',
      'reservations',
      createHash('sha256').update('untrusted-directory-coordinate').digest('hex'),
    );
    renameSync(seeded.aggregationRoot, mismatchedRoot);
    await assertCorruptAuthorityBlocksNewReservation({
      ...seeded,
      aggregationRoot: mismatchedRoot,
      eventRef: join(
        mismatchedRoot,
        'events',
        seeded.eventRef.slice(seeded.eventRef.lastIndexOf('/') + 1),
      ),
      snapshotRef: join(mismatchedRoot, 'snapshot.json'),
    });
  });
});

test('reviewer R4 P1-1: empty non-authority directory does not block reservation', async () => {
  const quotaHome = home('ccm-quota-r4-empty-non-authority-');
  const store = authorityStore(quotaHome);
  await publishAuthority(store, ['bucket-B'], 20);
  mkdirSync(
    join(
      quotaHome,
      'quota',
      'v1',
      'reservations',
      createHash('sha256').update('empty-lock-only').digest('hex'),
      'events',
    ),
    { recursive: true },
  );
  const created = await store.reserve(
    reservation({
      id: 'unrelated-reservation',
      key: 'unrelated-key',
      aggregation_key: 'bucket-B',
    }),
  );
  assert.equal(created.action, 'created');
  assert.equal((await store.inspectAggregation('bucket-B')).active_reserved_pct, 4);
});

test('reviewer R4 P1-1: valid first event replays after missing or damaged snapshot', async (t) => {
  for (const snapshotState of ['missing', 'damaged'] as const) {
    await t.test(snapshotState, async () => {
      const seeded = await seededSingleAuthority(`ccm-quota-r4-valid-replay-${snapshotState}-`);
      if (snapshotState === 'missing') unlinkSync(seeded.snapshotRef);
      else writeFileSync(seeded.snapshotRef, '{"damaged":', 'utf8');
      const duplicateId = await seeded.store.reserve(
        reservation({
          id: 'global-id-corruption-mutant',
          key: `different-key-${snapshotState}`,
          aggregation_key: 'bucket-B',
        }),
      );
      assert.equal(duplicateId.action, 'rejected');
      assert.equal(duplicateId.error, 'RESERVATION_ID_CONFLICT');
      assert.equal((await seeded.store.inspectAggregation('bucket-A')).active_reserved_pct, 4);
      assert.equal((await seeded.store.inspectAggregation('bucket-B')).active_reserved_pct, 0);
      assert.equal(
        (JSON.parse(readFileSync(seeded.snapshotRef, 'utf8')) as Data).aggregation_key,
        'bucket-A',
      );
    });
  }
});
