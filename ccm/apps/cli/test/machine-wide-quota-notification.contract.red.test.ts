import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { counterfeits } from './fixtures/machine-wide-quota-notification-v1/counterfeits.mjs';
import { projectMachineWideQuotaNotifications as knownGood } from './fixtures/machine-wide-quota-notification-v1/known-good.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(here, 'fixtures', 'machine-wide-quota-notification-v1');
const manifest = JSON.parse(readFileSync(join(fixtureDir, 'manifest.json'), 'utf8'));
const runProduction = process.env.CCM_MACHINE_WIDE_QUOTA_RED === '1';

type Projector = (input: Record<string, any>) => Record<string, any>;

const subscriptions = manifest.origins.map((origin: string) => ({
  subscription_id: `sub-${origin}`,
  session_id: `session-${origin}`,
  session_epoch: `epoch-${origin}`,
  origin,
  capability: 'coordination-inbox',
  state: 'current',
  valid: true
}));

function decision(target: Record<string, string>, state: string, revision: string, extra = {}) {
  return {
    schema: 'ccm/machine-quota-decision/v1',
    scope_digest: target.scope_digest,
    target: {harness_id:target.harness_id, surface_id:target.surface_id, provider_id:target.provider_id},
    state,
    freshness: state === 'stale' ? 'hard-stale' : state === 'unknown' ? 'unknown' : 'fresh',
    decision_revision: `sha256:${revision}`,
    observation_revision: `sha256:obs-${revision}`,
    reason_codes: state === 'healthy' ? [] : [`QUOTA_${state.toUpperCase()}`],
    policy_revision: target.provider_id === 'codex' ? 'ccm/codex-7d-pacing/v1' : 'provider-policy/v1',
    reset_marker: null,
    ...extra
  };
}

function assertSafe(value: unknown) {
  const text = JSON.stringify(value);
  assert.doesNotMatch(text, /sk-|token|credential|raw_account|identity_fingerprint|provider_response/i);
}

function exercise(project: Projector) {
  const targets = manifest.targets as Record<string, string>[];
  for (const target of targets) {
    const before = decision(target, 'healthy', `${target.provider_id}-healthy`);
    const after = decision(target, 'tight', `${target.provider_id}-tight`);
    const out = project({previous:[before], decisions:[after], subscriptions});
    assert.equal(out.notifications.length, 3, `${target.provider_id}: fan-out to every origin`);
    assert.deepEqual([...new Set(out.notifications.map((item: any) => item.destination.origin))].sort(), [...manifest.origins].sort());
    assert.equal(new Set(out.notifications.map((item: any) => item.payload.delta_revision)).size, 1);
    assert.ok(out.notifications.every((item: any) => item.payload.edge === 'entered_tight'));
    assertSafe(out);
  }

  const codex = targets[0]!;
  const states = [
    ['exhausted','entered_exhausted'], ['stale','became_stale'], ['unknown','became_unknown']
  ] as const;
  for (const [state, edge] of states) {
    const out = project({previous:[decision(codex,'healthy','base')], decisions:[decision(codex,state,`now-${state}`)], subscriptions});
    assert.equal(out.notifications.length, 3);
    assert.ok(out.notifications.every((item: any) => item.payload.edge === edge));
  }
  const recovery = project({previous:[decision(codex,'tight','tight')], decisions:[decision(codex,'healthy','recovered')], subscriptions});
  assert.equal(recovery.notifications.length, 3);
  assert.ok(recovery.notifications.every((item: any) => item.payload.edge === 'recovered' && item.strength === 'weak'));
  const reset = project({previous:[decision(codex,'exhausted','old',{reset_marker:'r1'})], decisions:[decision(codex,'healthy','new',{reset_marker:'r2'})], subscriptions});
  assert.equal(reset.notifications.length, 3);
  assert.ok(reset.notifications.every((item: any) => item.payload.edge === 'reset'));

  const unchanged = decision(codex,'healthy','same');
  assert.equal(project({previous:[unchanged], decisions:[{...unchanged, observation_revision:'sha256:obs-routine'}], subscriptions}).notifications.length, 0);
  assert.equal(project({previous:[unchanged], decisions:[unchanged], subscriptions, legacy_five_hour_pct:100}).notifications.length, 0, 'Codex 5h cannot create an edge');

  const two = project({
    previous:[decision(targets[0]!,'healthy','c0'), decision(targets[1]!,'healthy','a0')],
    decisions:[decision(targets[0]!,'tight','c1'), decision(targets[1]!,'tight','a1')],
    subscriptions
  });
  assert.equal(two.notifications.length, 6, 'same kind retains both provider scopes');
  assert.equal(new Set(two.notifications.map((item: any) => item.payload.scope_digest)).size, 2);
  const retry = project({previous:[decision(codex,'healthy','retry0')], decisions:[decision(codex,'tight','retry1')], subscriptions});
  assert.equal(new Set(retry.notifications.map((item: any) => item.id)).size, retry.notifications.length, 'deterministic per-destination ids');
}

test('fixture oracle accepts known-good machine-wide fan-out', () => exercise(knownGood));

test('fixture oracle kills reviewed counterfeit classes', () => {
  for (const id of manifest.counterfeits as string[]) {
    assert.throws(() => exercise(counterfeits[id]!), id);
  }
});

test('production projector satisfies machine-wide contract (RED until implementation)', {skip: !runProduction}, async () => {
  const production = await import('../src/machine-wide-quota-notification.js');
  assert.equal(typeof production.projectMachineWideQuotaNotifications, 'function');
  exercise(production.projectMachineWideQuotaNotifications);
});

test('production CLI exposes explicit machine-wide floor and opt-in monitor mode (RED until implementation)', {skip: !runProduction}, () => {
  const registry = readFileSync(join(here, '..', 'src', 'registry.ts'), 'utf8');
  const quota = registry.slice(registry.indexOf('  quota: {'), registry.indexOf('  // ════════════════════ provider'));
  const monitorRegistry = registry.slice(registry.indexOf('  monitor: {'), registry.indexOf('  // ════════════════════ services'));
  assert.match(quota, /refresh:\s*{/);
  assert.match(quota, /status:\s*{[\s\S]*?options:\s*{[\s\S]*?'machine-wide'/);
  assert.match(monitorRegistry, /start:\s*{[\s\S]*?options:\s*{[\s\S]*?'quota-source'/);
  assert.match(monitorRegistry, /'install-service':\s*{[\s\S]*?options:\s*{[\s\S]*?'quota-source'/);
  const monitor = readFileSync(join(here, '..', 'src', 'handlers', 'monitor.ts'), 'utf8');
  assert.match(monitor, /quota_source_mode/);
  assert.match(monitor, /cached-only/);
  assert.match(monitor, /machine-wide/);
});
