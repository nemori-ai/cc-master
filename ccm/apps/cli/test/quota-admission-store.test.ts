import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, test } from 'node:test';
import { createQuotaAdmissionStore } from '../src/quota-admission-store.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function home(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  roots.push(root);
  return join(root, 'home');
}

function request(index: number, aggregationKey = 'payer-A|pool-A|seven_day') {
  return {
    schema: 'ccm/quota-reservation-request/v1',
    aggregation_key: aggregationKey,
    capacity_pct: 10,
    id: `reservation-${index}`,
    key: `attempt-${index}`,
    hash: `request-${index}`,
    amount_pct: 3,
    state: 'held',
    checked_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    source_revision: 'sha256:live-r1',
    attempt_id: `attempt-${index}`,
    candidate_id: 'codex-cli-worker',
    account_id: 'payer-A',
    pool_id: 'pool-A',
    identity_fingerprint: 'sha256:payer-A',
  };
}

async function seedAuthority(quotaHome: string, aggregationKey = 'payer-A|pool-A|seven_day') {
  await createQuotaAdmissionStore({ home: quotaHome }).publishObservation({
    source_key: 'codex-current',
    observation: {
      schema: 'ccm/quota-authority-observation/v1',
      provider: 'codex',
      provider_rule_revision: 'ccm/codex-7d-pacing/v1',
      source_revision: 'sha256:live-r1',
      observed_at: new Date(Date.now() - 1_000).toISOString(),
      valid_until: new Date(Date.now() + 300_000).toISOString(),
      source_profile: {
        schema: 'ccm/quota-source-profile/v1',
        revision: 'ccm/test-quota-source/v1',
        fresh_ttl_sec: 60,
        hard_ttl_sec: 300,
        max_clock_skew_sec: 5,
      },
      account_id: 'payer-A',
      pool_id: 'pool-A',
      identity_fingerprint: 'sha256:payer-A',
      hard_window: { name: 'seven_day', duration_sec: 604_800 },
      policy: {
        decision: 'allow',
        revision: 'ccm/codex-7d-pacing/v1',
        hard_ceiling_used_pct: 85,
      },
      effects: { decision: 'allow', effect: 'read-only' },
      buckets: [
        {
          id: 'seven-day',
          window: 'seven_day',
          duration_sec: 604_800,
          freshness: 'fresh',
          used_pct: 75,
          safety_margin_pct: 0,
          projected_p80_pct: 0,
          aggregation_key: aggregationKey,
        },
      ],
    },
  });
}

test('concurrency mutant cannot authorize more capacity than one payer+pool owns', async () => {
  const quotaHome = home('ccm-quota-concurrency-mutant-');
  await seedAuthority(quotaHome);
  const results = await Promise.all(
    Array.from({ length: 10 }, (_, index) =>
      createQuotaAdmissionStore({ home: quotaHome }).reserve(request(index)),
    ),
  );
  assert.equal(results.filter((result) => result.action === 'created').length, 3);
  assert.equal(
    results.filter((result) => result.error === 'RESERVATION_CAPACITY_CONFLICT').length,
    7,
  );
  const inspected = await createQuotaAdmissionStore({ home: quotaHome }).inspectAggregation(
    'payer-A|pool-A|seven_day',
  );
  assert.equal(inspected.active_reserved_pct, 9);
  assert.equal(inspected.oversubscribed, false);
});

test('duplicate-key mutant creates one durable authority and reuses its receipt', async () => {
  const quotaHome = home('ccm-quota-duplicate-mutant-');
  await seedAuthority(quotaHome);
  const base = request(0);
  const results = await Promise.all(
    Array.from({ length: 10 }, (_, index) =>
      createQuotaAdmissionStore({ home: quotaHome }).reserve({
        ...base,
        id: `provisional-${index}`,
        key: 'same-attempt',
        hash: 'same-request',
      }),
    ),
  );
  assert.equal(results.filter((result) => result.action === 'created').length, 1);
  assert.equal(results.filter((result) => result.action === 'idempotent-existing').length, 9);
  assert.equal(new Set(results.map((result) => result.reservation_id)).size, 1);
  assert.equal(new Set(results.map((result) => result.event_ref)).size, 1);
});

test('crash-loss mutant replays durable event and corrupted authority fails closed', async () => {
  const quotaHome = home('ccm-quota-crash-mutant-');
  await seedAuthority(quotaHome);
  const store = createQuotaAdmissionStore({ home: quotaHome });
  const created = await store.reserve(request(0));
  const snapshotRef = String(created.snapshot_ref);
  const eventRef = String(created.event_ref);
  unlinkSync(snapshotRef);
  const recovered = await createQuotaAdmissionStore({ home: quotaHome }).inspectAggregation(
    'payer-A|pool-A|seven_day',
  );
  assert.equal(recovered.active_reserved_pct, 3);
  assert.equal(recovered.snapshot_rebuilt, true);
  assert.equal(recovered.replayed_event_count, 1);

  const event = JSON.parse(readFileSync(eventRef, 'utf8')) as Record<string, unknown>;
  writeFileSync(eventRef, `${JSON.stringify({ ...event, sequence: 99 })}\n`, { mode: 0o600 });
  unlinkSync(snapshotRef);
  await assert.rejects(
    () =>
      createQuotaAdmissionStore({ home: quotaHome }).inspectAggregation('payer-A|pool-A|seven_day'),
    /RESERVATION_STORE_CONFLICT/,
  );
  assert.equal(
    readdirSync(dirname(eventRef)).length,
    1,
    'corruption audit cannot append authority',
  );
});
