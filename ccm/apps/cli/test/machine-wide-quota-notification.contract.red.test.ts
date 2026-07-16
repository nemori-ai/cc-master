import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
// @ts-expect-error Executable fixture modules intentionally remain plain ESM next to their JSON manifest.
import { counterfeits } from './fixtures/machine-wide-quota-notification-v1/counterfeits.mjs';
// @ts-expect-error Executable fixture modules intentionally remain plain ESM next to their JSON manifest.
import { knownGood } from './fixtures/machine-wide-quota-notification-v1/known-good.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(here, 'fixtures', 'machine-wide-quota-notification-v1');
const manifest = JSON.parse(readFileSync(join(fixtureDir, 'manifest.json'), 'utf8'));
const runProduction = process.env.CCM_MACHINE_WIDE_QUOTA_RED === '1';

interface Implementation {
  projectPosture(authority: Record<string, any>, input?: Record<string, any>): any;
  projectNotifications(input: Record<string, any>): any;
  runCycle(input: Record<string, any>): Promise<any>;
}

const subscriptions = manifest.origins.map((origin: string) => ({
  subscription_id: `sub-${origin}`,
  board_id: `board-${origin}-primary`,
  session_id: `session-${origin}`,
  session_epoch: `epoch-${origin}`,
  authoritative_epoch: `epoch-${origin}`,
  origin,
  capability: 'coordination-inbox',
  state: 'current',
  valid: true,
}));

subscriptions.push({
  subscription_id: 'sub-codex-second-board',
  board_id: 'board-codex-secondary',
  session_id: 'session-codex-second-board',
  session_epoch: 'epoch-codex-second-board',
  authoritative_epoch: 'epoch-codex-second-board',
  origin: 'codex',
  capability: 'coordination-inbox',
  state: 'current',
  valid: true,
});

const expectedCurrentSubscriptions = 4;

const rejectedSubscriptions = [
  {
    ...subscriptions[0],
    subscription_id: 'sub-stale',
    session_epoch: 'epoch-stale',
    authoritative_epoch: 'epoch-current',
  },
  { ...subscriptions[1], subscription_id: 'sub-invalid', valid: false },
  { ...subscriptions[2], subscription_id: 'sub-wrong-capability', capability: 'other' },
];

function assertSafe(value: unknown) {
  const text = JSON.stringify(value);
  assert.doesNotMatch(
    text,
    /sk-secret|credential|raw_account|identity_fingerprint|provider_response|pool-codex|pool-cursor|identity-codex|identity-cursor/i,
  );
}

function memoryEffects(failSubscriptionOnce: string | null = null) {
  const checkpoints = new Map<string, any>();
  const items = new Map<string, any>();
  const attempts: Array<{ subscription_id: string; id: string }> = [];
  let pendingFailure = failSubscriptionOnce;
  return {
    checkpoints,
    items,
    attempts,
    checkpoint: {
      read: async (scopeDigest: string) => checkpoints.get(scopeDigest) ?? null,
      publish: async (scopeDigest: string, decision: any) => {
        checkpoints.set(scopeDigest, structuredClone(decision));
      },
    },
    inbox: {
      put: async (notification: any) => {
        attempts.push({
          subscription_id: notification.destination.subscription_id,
          id: notification.id,
        });
        if (pendingFailure === notification.destination.subscription_id) {
          pendingFailure = null;
          throw new Error('INJECTED_PARTIAL_INBOX_FAILURE');
        }
        const prior = items.get(notification.id);
        if (prior) assert.deepEqual(prior, notification, 'same deterministic id must be an exact no-op');
        else items.set(notification.id, structuredClone(notification));
      },
    },
  };
}

async function exercise(implementation: Implementation) {
  const authorities = manifest.authorities as Record<string, any>[];
  const healthy = authorities.map((authority) =>
    implementation.projectPosture(authority, { state: 'healthy' }),
  );
  const tight = authorities.map((authority) =>
    implementation.projectPosture(authority, { state: 'tight' }),
  );

  for (const decision of healthy) {
    assert.match(decision.scope_digest, /^sha256:[0-9a-f]{64}$/);
    assert.match(decision.target.identity_scope_digest, /^sha256:[0-9a-f]{64}$/);
    assert.match(decision.target.pool_scope_digest, /^sha256:[0-9a-f]{64}$/);
    assert.match(decision.policy_digest, /^sha256:[0-9a-f]{64}$/);
    assert.match(decision.requirement_digest, /^sha256:[0-9a-f]{64}$/);
    assert.ok(Object.values(decision.posture.projected_p80).every((value) => value === 0));
    assertSafe(decision);
  }

  const cursorIde = healthy[2];
  const cursorAgent = healthy[3];
  assert.equal(cursorIde.target.identity_scope_digest, cursorAgent.target.identity_scope_digest);
  assert.equal(cursorIde.target.pool_scope_digest, cursorAgent.target.pool_scope_digest);
  assert.notEqual(cursorIde.scope_digest, cursorAgent.scope_digest, 'Cursor IDE/Agent are distinct surfaces');

  const swappedAuthority = { ...authorities[0], identity_fingerprint: 'identity-codex-b' };
  const swapped = implementation.projectPosture(swappedAuthority, { state: 'tight' });
  assert.equal(healthy[0].target.pool_scope_digest, swapped.target.pool_scope_digest);
  assert.notEqual(healthy[0].target.identity_scope_digest, swapped.target.identity_scope_digest);
  assert.notEqual(healthy[0].scope_digest, swapped.scope_digest, 'same pool identity swap is a new scope');
  const swappedOut = implementation.projectNotifications({
    previous: [healthy[0]],
    decisions: [swapped],
    subscriptions,
  });
  assert.equal(swappedOut.notifications.length, expectedCurrentSubscriptions);
  assert.ok(
    swappedOut.notifications.every(
      (item: any) => item.payload.previous_state === null && item.payload.edge === 'entered_tight',
    ),
    'identity swap cannot reuse the prior identity checkpoint',
  );

  for (let index = 0; index < tight.length; index += 1) {
    const out = implementation.projectNotifications({
      previous: [healthy[index]],
      decisions: [tight[index]],
      subscriptions: [...subscriptions, ...rejectedSubscriptions],
    });
    assert.equal(
      out.notifications.length,
      expectedCurrentSubscriptions,
      'fan-out reaches every exact current board/session subscription',
    );
    assert.deepEqual(
      [...new Set(out.notifications.map((item: any) => item.destination.origin))].sort(),
      [...manifest.origins].sort(),
    );
    const codexDestinations = out.notifications.filter(
      (item: any) => item.destination.origin === 'codex',
    );
    assert.equal(codexDestinations.length, 2);
    assert.equal(new Set(codexDestinations.map((item: any) => item.destination.board_id)).size, 2);
    assert.equal(new Set(codexDestinations.map((item: any) => item.destination.session_id)).size, 2);
    assert.equal(new Set(out.notifications.map((item: any) => item.payload.delta_revision)).size, 1);
    assert.ok(out.notifications.every((item: any) => item.payload.edge === 'entered_tight'));
    assertSafe(out);
  }

  const codexAuthority = authorities[0]!;
  const states = [
    ['exhausted', 'entered_exhausted'],
    ['stale', 'became_stale'],
    ['unknown', 'became_unknown'],
  ];
  for (const [state, edge] of states) {
    const out = implementation.projectNotifications({
      previous: [implementation.projectPosture(codexAuthority, { state: 'healthy' })],
      decisions: [implementation.projectPosture(codexAuthority, { state })],
      subscriptions,
    });
    assert.equal(out.notifications.length, expectedCurrentSubscriptions);
    assert.ok(out.notifications.every((item: any) => item.payload.edge === edge));
  }
  const recovery = implementation.projectNotifications({
    previous: [implementation.projectPosture(codexAuthority, { state: 'tight' })],
    decisions: [implementation.projectPosture(codexAuthority, { state: 'healthy' })],
    subscriptions,
  });
  assert.equal(recovery.notifications.length, expectedCurrentSubscriptions);
  assert.ok(
    recovery.notifications.every((item: any) => item.payload.edge === 'recovered' && item.strength === 'weak'),
  );
  const reset = implementation.projectNotifications({
    previous: [implementation.projectPosture(codexAuthority, { state: 'exhausted', reset_marker: 'r1' })],
    decisions: [implementation.projectPosture(codexAuthority, { state: 'healthy', reset_marker: 'r2' })],
    subscriptions,
  });
  assert.equal(reset.notifications.length, expectedCurrentSubscriptions);
  assert.ok(reset.notifications.every((item: any) => item.payload.edge === 'reset'));

  const initialHealthyWithMarker = implementation.projectNotifications({
    previous: [],
    decisions: [
      implementation.projectPosture(codexAuthority, { state: 'healthy', reset_marker: 'initial-r1' }),
    ],
    subscriptions,
  });
  assert.equal(initialHealthyWithMarker.notifications.length, 0, 'initial healthy only establishes baseline');
  const initialTightWithMarker = implementation.projectNotifications({
    previous: [],
    decisions: [
      implementation.projectPosture(codexAuthority, { state: 'tight', reset_marker: 'initial-r1' }),
    ],
    subscriptions,
  });
  assert.equal(initialTightWithMarker.notifications.length, expectedCurrentSubscriptions);
  assert.ok(
    initialTightWithMarker.notifications.every(
      (item: any) => item.payload.edge === 'entered_tight' && item.payload.previous_state === null,
    ),
    'an initial reset marker does not counterfeit a reset edge',
  );

  const unchanged = implementation.projectPosture(codexAuthority, { state: 'healthy' });
  const reobserved = { ...unchanged, observation_revision: `sha256:${'f'.repeat(64)}` };
  assert.equal(
    implementation.projectNotifications({ previous: [unchanged], decisions: [reobserved], subscriptions })
      .notifications.length,
    0,
  );
  assert.equal(
    implementation.projectNotifications({
      previous: [unchanged],
      decisions: [unchanged],
      subscriptions,
      legacy_five_hour_pct: 100,
      legacy_switch: true,
    }).notifications.length,
    0,
    'Codex 5h/switch cannot enter notification/reset/wakeup/account switching',
  );

  const two = implementation.projectNotifications({
    previous: healthy.slice(0, 2),
    decisions: tight.slice(0, 2),
    subscriptions,
  });
  assert.equal(two.notifications.length, 8, 'same kind retains both provider scopes and both Codex sessions');
  assert.equal(new Set(two.notifications.map((item: any) => item.payload.scope_digest)).size, 2);
  assert.equal(new Set(two.notifications.map((item: any) => item.id)).size, two.notifications.length);

  const effects = memoryEffects('sub-codex');
  await assert.rejects(
    implementation.runCycle({
      decisions: [tight[0]],
      subscriptions: [...subscriptions, ...rejectedSubscriptions],
      checkpoint: effects.checkpoint,
      inbox: effects.inbox,
    }),
    /INJECTED_PARTIAL_INBOX_FAILURE/,
  );
  assert.equal(effects.checkpoints.size, 0, 'partial write cannot advance checkpoint');
  await implementation.runCycle({
    decisions: [tight[0]],
    subscriptions: [...subscriptions, ...rejectedSubscriptions],
    checkpoint: effects.checkpoint,
    inbox: effects.inbox,
  });
  assert.equal(effects.items.size, expectedCurrentSubscriptions, 'retry delivers every current destination exactly once');
  assert.equal(effects.checkpoints.get(tight[0].scope_digest).decision_revision, tight[0].decision_revision);
  assert.ok(
    [...effects.items.values()].every((item) =>
      subscriptions.some(
        (subscription: { subscription_id: string }) =>
          subscription.subscription_id === item.destination.subscription_id,
      ),
    ),
  );
  const retried = effects.attempts.filter((item) => item.subscription_id === 'sub-claude-code');
  assert.equal(retried.length, 2);
  assert.equal(retried[0]!.id, retried[1]!.id, 'retry id is stable');
}

test('fixture oracle accepts R1 machine-wide posture and crash-safe fan-out', async () => {
  await exercise(knownGood);
});

test('fixture oracle kills bounded R1 counterfeit classes', async () => {
  for (const id of manifest.counterfeits as string[]) {
    const counterfeit = (counterfeits as Record<string, Implementation>)[id];
    assert.ok(counterfeit, id);
    await assert.rejects(() => exercise(counterfeit));
  }
});

function rawProjectorInput(
  authority: Record<string, any>,
  overrides: {
    identity_fingerprint?: string;
    seven_day_used_pct?: number;
    five_hour_used_pct?: number;
    five_hour_reset_marker?: string;
  } = {},
) {
  const identityFingerprint = overrides.identity_fingerprint || authority.identity_fingerprint;
  const observation = {
    schema: 'ccm/quota-observation/v1',
    observation_id: `obs-${authority.surface_id}-${authority.bucket_id}`,
    revision: `sha256:${'1'.repeat(64)}`,
    source_key: {
      harness: authority.harness_id,
      surface_id: authority.surface_id,
      provider: authority.provider_id,
      identity_fingerprint: identityFingerprint,
      payer_scope: authority.payer_scope,
      pool_id: authority.pool_id,
      bucket_id: authority.bucket_id,
      unit: authority.unit,
      window: structuredClone(authority.window),
    },
    value: {
      used: overrides.seven_day_used_pct ?? 20,
      limit: 100,
      resets_at:
        authority.window.name === 'billing_period'
          ? '2026-08-01T00:00:00Z'
          : '2026-07-20T08:00:00Z',
    },
    source: {
      collector: `${authority.provider_id}-fixture`,
      schema: `${authority.provider_id}/quota-fixture/v1`,
      raw_revision: `sha256:${'a'.repeat(64)}`,
    },
    observed_at: '2026-07-16T08:00:00Z',
    valid_until: '2026-07-16T08:05:00Z',
  };
  const observations: Array<Record<string, any>> = [observation];
  if (authority.provider_id === 'codex' && overrides.five_hour_used_pct !== undefined) {
    observations.push({
      ...structuredClone(observation),
      observation_id: `obs-${authority.surface_id}-five-hour`,
      revision: `sha256:${'2'.repeat(64)}`,
      source_key: {
        ...structuredClone(observation.source_key),
        bucket_id: 'five-hour',
        window: { kind: 'rolling', name: 'five_hour', duration_sec: 18000 },
      },
      value: {
        used: overrides.five_hour_used_pct,
        limit: 100,
        resets_at: overrides.five_hour_reset_marker
          ? '2026-07-16T09:00:00Z'
          : '2026-07-16T12:00:00Z',
      },
      source: {
        collector: `${authority.provider_id}-fixture`,
        schema: `${authority.provider_id}/quota-fixture/v1`,
        raw_revision: `sha256:${'b'.repeat(64)}`,
      },
    });
  }
  return {
    schema: 'ccm/machine-quota-posture-input/v1',
    home_scope_salt: 'owner-only-fixture-home-salt',
    checked_at: '2026-07-16T08:01:00Z',
    authority: {
      harness_id: authority.harness_id,
      surface_id: authority.surface_id,
      provider_id: authority.provider_id,
      identity_fingerprint: identityFingerprint,
      payer_scope: authority.payer_scope,
      pool_id: authority.pool_id,
      unit: authority.unit,
    },
    observations,
    source_profiles: [
      {
        schema: 'ccm/quota-source-profile/v1',
        source_schema: `${authority.provider_id}/quota-fixture/v1`,
        fresh_ttl_sec: 60,
        hard_ttl_sec: 300,
        max_clock_skew_sec: 5,
      },
    ],
    active_reservations: [],
    policy: {
      revision: authority.policy_revision,
      hard_ceiling_used_pct: { [authority.bucket_id]: 85 },
    },
    requirement: {
      revision: `requirement:${authority.surface_id}:ambient-v1`,
      required_bucket_ids: structuredClone(authority.required_bucket_ids),
      safety_margin: structuredClone(authority.safety_margin),
    },
  };
}

test('production pure projector derives posture from raw authority rather than injected decisions', { skip: !runProduction }, async () => {
  const modulePath: string = '../src/machine-wide-quota-posture.js';
  const production = await import(modulePath);
  assert.equal(typeof production.projectMachineQuotaPosture, 'function');
  const project = production.projectMachineQuotaPosture as (
    input: ReturnType<typeof rawProjectorInput>,
  ) => any;
  const authorities = manifest.authorities as Record<string, any>[];

  const codexInput = rawProjectorInput(authorities[0]!);
  const codex = project(codexInput);
  assert.equal(codex.state, 'healthy');
  assert.deepEqual(codex.posture.projected_p80, { 'seven-day-global': 0 });
  assert.match(codex.scope_digest, /^sha256:[0-9a-f]{64}$/);
  assert.match(codex.target.identity_scope_digest, /^sha256:[0-9a-f]{64}$/);
  assert.match(codex.target.pool_scope_digest, /^sha256:[0-9a-f]{64}$/);
  assert.doesNotMatch(JSON.stringify(codex), /identity-codex-a|pool-codex-shared|owner-only-fixture-home-salt/);

  const identitySwap = project(
    rawProjectorInput(authorities[0]!, { identity_fingerprint: 'identity-codex-b' }),
  );
  assert.equal(identitySwap.target.pool_scope_digest, codex.target.pool_scope_digest);
  assert.notEqual(identitySwap.target.identity_scope_digest, codex.target.identity_scope_digest);
  assert.notEqual(identitySwap.scope_digest, codex.scope_digest);

  const cursorIde = project(rawProjectorInput(authorities[2]!));
  const cursorAgent = project(rawProjectorInput(authorities[3]!));
  assert.equal(cursorIde.target.identity_scope_digest, cursorAgent.target.identity_scope_digest);
  assert.equal(cursorIde.target.pool_scope_digest, cursorAgent.target.pool_scope_digest);
  assert.notEqual(cursorIde.scope_digest, cursorAgent.scope_digest);

  const poisonedFiveHour = project(
    rawProjectorInput(authorities[0]!, {
      five_hour_used_pct: 100,
      five_hour_reset_marker: 'legacy-reset-must-be-ignored',
    }),
  );
  assert.equal(poisonedFiveHour.state, codex.state);
  assert.equal(poisonedFiveHour.scope_digest, codex.scope_digest);
  assert.equal(poisonedFiveHour.decision_revision, codex.decision_revision);
  assert.doesNotMatch(JSON.stringify(poisonedFiveHour), /five_hour|legacy-reset/);

  const changedSevenDay = project(
    rawProjectorInput(authorities[0]!, { seven_day_used_pct: 90 }),
  );
  assert.equal(changedSevenDay.state, 'exhausted');
  assert.notEqual(changedSevenDay.decision_revision, codex.decision_revision);
});

function productionBoundary() {
  const decision = knownGood.projectPosture(manifest.authorities[0], { state: 'tight' });
  const effects = memoryEffects('sub-codex');
  const counters = { cached_reads: 0, live_reads: 0, account_switches: 0 };
  return {
    decision,
    effects,
    counters,
    boundary: {
      readPostures: async ({ refresh }: { refresh: boolean }) => {
        if (refresh) counters.live_reads += 1;
        else counters.cached_reads += 1;
        return [decision];
      },
      listSubscriptions: async () => [...subscriptions, ...rejectedSubscriptions],
      readCheckpoint: effects.checkpoint.read,
      publishCheckpoint: effects.checkpoint.publish,
      putInbox: effects.inbox.put,
      switchAccount: async () => {
        counters.account_switches += 1;
        throw new Error('ACCOUNT_SWITCH_FORBIDDEN');
      },
    },
  };
}

async function runCli(argv: string[], boundary: any, env: Record<string, string | undefined> = {}) {
  const { run } = await import('../src/router.js');
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = await run(argv, {
    out: (line: string) => stdout.push(line),
    err: (line: string) => stderr.push(line),
    env,
    quotaEffects: {} as any,
    machineWideQuotaNotifications: boundary,
  } as any);
  return { code, stdout, stderr };
}

test('production quota status is zero-effect through the real registry/handler seam', { skip: !runProduction }, async () => {
  const production = productionBoundary();
  const result = await runCli(['quota', 'status', '--machine-wide', '--json'], production.boundary);
  assert.equal(result.code, 0, result.stderr.join('\n'));
  assert.equal(production.counters.cached_reads, 1);
  assert.equal(production.counters.live_reads, 0);
  assert.equal(production.effects.items.size, 0);
  assert.equal(production.effects.checkpoints.size, 0);
  assert.equal(JSON.parse(result.stdout.at(-1) || '{}').schema, 'ccm/machine-quota-status/v1');
});

test('production explicit refresh retries partial fan-out without checkpoint loss', { skip: !runProduction }, async () => {
  const production = productionBoundary();
  const implicit = await runCli(['quota', 'refresh', '--json'], production.boundary);
  assert.equal(implicit.code, 2, 'refresh without --machine-wide is a usage error');
  assert.equal(production.counters.live_reads, 0);

  const first = await runCli(['quota', 'refresh', '--machine-wide', '--json'], production.boundary);
  assert.notEqual(first.code, 0, 'injected partial inbox failure must be observable');
  assert.equal(production.effects.checkpoints.size, 0, 'checkpoint cannot run ahead of fan-out');
  const second = await runCli(['quota', 'refresh', '--machine-wide', '--json'], production.boundary);
  assert.equal(second.code, 0, second.stderr.join('\n'));
  assert.equal(production.counters.live_reads, 2);
  assert.equal(production.effects.items.size, expectedCurrentSubscriptions);
  assert.equal(production.effects.checkpoints.size, 1);
  assert.equal(production.counters.account_switches, 0);
  const retried = production.effects.attempts.filter(
    (item) => item.subscription_id === 'sub-claude-code',
  );
  assert.equal(retried.length, 2);
  assert.equal(retried[0]!.id, retried[1]!.id);
});

test('production monitor keeps cached-only default and persists explicit source mode', { skip: !runProduction }, async () => {
  const { __resetMonitorTestHooks, __setMonitorTestHooks } = await import('../src/handlers/monitor.js');
  const root = mkdtempSync(join(tmpdir(), 'ccm-machine-quota-monitor-'));
  const env = { HOME: join(root, 'user'), XDG_CONFIG_HOME: join(root, 'xdg') };
  const production = productionBoundary();
  __setMonitorTestHooks({
    runtimePlatform: 'linux',
    runServiceCommand: () => ({ status: 0, stdout: '', stderr: '' }),
    isPidAlive: () => false,
  });
  try {
    const cachedHome = join(root, 'cached-home');
    const cached = await runCli(
      ['monitor', 'install-service', '--home', cachedHome, '--json'],
      production.boundary,
      env,
    );
    assert.equal(cached.code, 0, cached.stderr.join('\n'));
    const cachedStatus = await runCli(
      ['monitor', 'status', '--home', cachedHome, '--json'],
      production.boundary,
      env,
    );
    assert.equal(JSON.parse(cachedStatus.stdout.at(-1) || '{}').service.quota_source_mode, 'cached-only');
    assert.equal(production.counters.live_reads, 0, 'install/default cannot autostart live quota refresh');

    const liveHome = join(root, 'live-home');
    const live = await runCli(
      ['monitor', 'install-service', '--quota-source', 'machine-wide', '--home', liveHome, '--json'],
      production.boundary,
      env,
    );
    assert.equal(live.code, 0, live.stderr.join('\n'));
    const liveStatus = await runCli(
      ['monitor', 'status', '--home', liveHome, '--json'],
      production.boundary,
      env,
    );
    assert.equal(JSON.parse(liveStatus.stdout.at(-1) || '{}').service.quota_source_mode, 'machine-wide');
    assert.equal(production.counters.live_reads, 0, 'install persists mode but does not itself collect');
  } finally {
    __resetMonitorTestHooks();
    rmSync(root, { recursive: true, force: true });
  }
});
