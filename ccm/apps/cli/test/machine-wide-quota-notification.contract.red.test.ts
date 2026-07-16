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
  session_id: `session-${origin}`,
  session_epoch: `epoch-${origin}`,
  authoritative_epoch: `epoch-${origin}`,
  origin,
  capability: 'coordination-inbox',
  state: 'current',
  valid: true,
}));

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
    assert.equal(out.notifications.length, 3, 'fan-out only to three exact current subscriptions');
    assert.deepEqual(
      [...new Set(out.notifications.map((item: any) => item.destination.origin))].sort(),
      [...manifest.origins].sort(),
    );
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
    assert.equal(out.notifications.length, 3);
    assert.ok(out.notifications.every((item: any) => item.payload.edge === edge));
  }
  const recovery = implementation.projectNotifications({
    previous: [implementation.projectPosture(codexAuthority, { state: 'tight' })],
    decisions: [implementation.projectPosture(codexAuthority, { state: 'healthy' })],
    subscriptions,
  });
  assert.ok(
    recovery.notifications.every((item: any) => item.payload.edge === 'recovered' && item.strength === 'weak'),
  );
  const reset = implementation.projectNotifications({
    previous: [implementation.projectPosture(codexAuthority, { state: 'exhausted', reset_marker: 'r1' })],
    decisions: [implementation.projectPosture(codexAuthority, { state: 'healthy', reset_marker: 'r2' })],
    subscriptions,
  });
  assert.ok(reset.notifications.every((item: any) => item.payload.edge === 'reset'));

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
  assert.equal(two.notifications.length, 6, 'same kind retains both provider scopes');
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
  assert.equal(effects.items.size, 3, 'retry delivers every current destination exactly once');
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
  assert.equal(production.effects.items.size, 3);
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
