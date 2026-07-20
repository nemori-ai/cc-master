import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import {
  deliverCoordinationNotification,
  listCurrentCoordinationSubscriptions,
} from '../src/handlers/coordination.js';
import {
  aggregateMachineQuotaCapacityViews,
  type MachineQuotaAuthorityRefs,
  type MachineQuotaCollection,
  type MachineQuotaCollectorBoundary,
  type MachineQuotaStore,
  readMachineWideQuotaStatus,
  refreshMachineWideQuota,
} from '../src/machine-wide-quota.js';
import { createQuotaAdmissionStore } from '../src/quota-admission-store.js';
import { createProductionQuotaEffectBoundary } from '../src/quota-production-effects.js';
import { run } from '../src/router.js';

type Data = Record<string, any>;

const NOW = new Date('2026-07-16T08:00:00Z');
const RESET = Date.parse('2026-07-20T08:00:00Z') / 1000;
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fakeStore(): MachineQuotaStore & {
  observations: Map<string, Data>;
  aggregations: Map<string, Data>;
  projection?: Data;
} {
  const observations = new Map<string, Data>();
  const aggregations = new Map<string, Data>();
  return {
    observations,
    aggregations,
    async readObservation(sourceKey) {
      return observations.get(sourceKey);
    },
    async refreshObservation(request, collect) {
      const observation = await collect();
      observations.set(String(request.source_key), observation);
      return observation;
    },
    async readMachineProjection() {
      return this.projection;
    },
    async publishMachineProjection(projection) {
      this.projection = structuredClone(projection);
      return this.projection;
    },
    async readAggregation(aggregationKey) {
      return (
        aggregations.get(aggregationKey) ?? {
          schema: 'ccm/quota-reservation-snapshot/v1',
          aggregation_key: aggregationKey,
          active_reserved_pct: 0,
          reservations: [],
        }
      );
    },
  };
}

function setupSubscription(input: { brokenBoard?: boolean } = {}): {
  home: string;
  boardPath: string;
} {
  const root = mkdtempSync(join(tmpdir(), 'ccm-machine-quota-'));
  roots.push(root);
  const home = join(root, '.cc_master');
  const boardPath = join(home, 'boards', 'board.json');
  mkdirSync(join(home, 'boards'), { recursive: true });
  mkdirSync(join(home, 'coordination'), { recursive: true });
  if (!input.brokenBoard) {
    writeFileSync(
      boardPath,
      `${JSON.stringify({
        schema: 'cc-master/v2',
        goal: 'machine quota',
        owner: { active: true, session_id: 'session-codex' },
        git: { worktree: root, branch: 'test' },
        tasks: [],
      })}\n`,
    );
  }
  writeFileSync(
    join(home, 'coordination', 'subscriptions.json'),
    `${JSON.stringify({
      schema: 'ccm/coordination-subscriptions/v1',
      subscriptions: [
        {
          subscription_id: 'sub-codex',
          session_id: 'session-codex',
          session_epoch: 'epoch-codex',
          origin: 'codex',
          capability: 'coordination-inbox',
          state: 'current',
          board_path: boardPath,
          registered_at: NOW.toISOString(),
          source_policy_revision: 'ccm/cached-board-inbox/v1',
          consent_provenance_ref: 'ccm://coordination/subscriptions/cached-only',
        },
      ],
    })}\n`,
  );
  return { home, boardPath };
}

function authorityFor(
  target: Readonly<Data>,
  overrides: {
    identity?: string;
    ceiling?: number;
    margin?: number;
  } = {},
): MachineQuotaAuthorityRefs {
  const identity = overrides.identity ?? `${target.provider_id}-identity-a`;
  const ceiling = overrides.ceiling ?? (target.provider_id === 'anthropic' ? 90 : 85);
  const margin = overrides.margin ?? (target.provider_id === 'anthropic' ? 10 : 5);
  return {
    schema: 'ccm/machine-quota-collector-authority/v1',
    account_key: `${target.provider_id}-account-${identity}`,
    identity_fingerprint: identity,
    payer_scope: 'subscription',
    pool_id: `${target.provider_id}-pool-shared`,
    aggregation_key: `${target.provider_id}|${identity}|pool-shared|${target.window_name}`,
    policy: {
      revision:
        target.provider_id === 'codex'
          ? 'ccm/codex-7d-pacing/v1'
          : `policy:${target.surface_id}:${target.window_name}:v1`,
      hard_ceiling_used_pct: ceiling,
    },
    requirement: {
      revision: `requirement:${target.surface_id}:${target.window_name}:v1`,
      required_bucket_ids: [target.bucket_id],
      safety_margin: { [target.bucket_id]: margin },
    },
  };
}

function collectionFor(target: Readonly<Data>): MachineQuotaCollection {
  const common = { captured_at: NOW.getTime() / 1000 };
  if (target.surface_id === 'kimi-cli') {
    return {
      status: 'refreshed',
      source: 'kimi-usages-api',
      authSource: 'kimi-code-current-login',
      signal: {
        ...common,
        five_hour: { used_percentage: 22, resets_at: RESET },
        seven_day: { used_percentage: 61, resets_at: RESET },
      },
    };
  }
  if (target.surface_id === 'codex-cli') {
    return {
      status: 'refreshed',
      source: 'fake-codex',
      authority: authorityFor(target),
      signal: {
        ...common,
        five_hour: { used_percentage: 100, resets_at: RESET },
        seven_day: { used_percentage: 81, resets_at: RESET },
      },
    };
  }
  if (target.surface_id === 'claude-cli') {
    return {
      status: 'refreshed',
      source: 'fake-claude',
      authority: authorityFor(target),
      signal: {
        ...common,
        five_hour: { used_percentage: 40, resets_at: RESET },
        seven_day: { used_percentage: 40, resets_at: RESET },
      },
    };
  }
  if (target.surface_id === 'claude-fable-5-cli') {
    return {
      status: 'refreshed',
      source: 'fake-claude-fable',
      authority: authorityFor(target),
      signal: {
        ...common,
        five_hour: null,
        seven_day: { used_percentage: 52, resets_at: RESET },
      },
    };
  }
  if (target.surface_id === 'cursor-ide-plugin') {
    return {
      status: 'refreshed',
      source: 'fake-cursor-ide',
      authority: authorityFor(target),
      signal: {
        ...common,
        billing_period: { used_percentage: 86, resets_at: RESET },
      },
    };
  }
  if (target.surface_id === 'cursor-agent-cli') {
    return {
      status: 'refreshed',
      source: 'fake-cursor-agent-dashboard',
      authSource: 'cursor-agent-current-login',
      quotaScopeFingerprint: 'sha256:shared-cursor-subscription',
      signal: {
        ...common,
        billing_period: { used_percentage: 86, resets_at: RESET },
      },
    };
  }
  return { status: 'unsupported', reason: 'unknown fixture surface' };
}

const collectors: MachineQuotaCollectorBoundary = {
  collect: (target) => collectionFor(target),
};

const coordination = {
  listSubscriptions: listCurrentCoordinationSubscriptions,
  deliverNotification: deliverCoordinationNotification,
};

test('explicit refresh fans out scoped deltas, checkpoints, and retry is duplicate-free', async () => {
  const { home, boardPath } = setupSubscription();
  const store = fakeStore();
  const first = await refreshMachineWideQuota({
    home,
    env: {},
    store,
    collectors,
    coordination,
    now: NOW,
  });
  assert.equal(first.fanout_complete, true);
  assert.equal(first.checkpoint_advanced, true);
  assert.deepEqual(
    first.deltas.map((delta: Data) => [delta.target.surface_id, delta.edge]).sort(),
    [
      ['codex-cli', 'entered_tight'],
      ['cursor-agent-cli', 'entered_exhausted'],
      ['cursor-ide-plugin', 'entered_exhausted'],
    ],
  );
  const board = JSON.parse(readFileSync(boardPath, 'utf8'));
  assert.equal(board.coordination.inbox.length, 3);
  assert.ok(board.coordination.inbox.every((item: Data) => item.kind === 'quota_state_change'));
  assert.doesNotMatch(JSON.stringify(board.coordination.inbox), /identity_fingerprint|account_id/);

  const retry = await refreshMachineWideQuota({
    home,
    env: {},
    store,
    collectors,
    coordination,
    now: NOW,
  });
  assert.equal(retry.deltas.length, 0);
  assert.equal(JSON.parse(readFileSync(boardPath, 'utf8')).coordination.inbox.length, 3);

  const status = await readMachineWideQuotaStatus(store, NOW);
  assert.equal(status.schema, 'ccm/machine-quota-status/v1');
  assert.equal(status.readings.length, 8);
  const cursorAgentReading = status.readings.find(
    (reading: Data) => reading.target.surface_id === 'cursor-agent-cli',
  );
  assert.equal(cursorAgentReading.used_percentage, 86);
  assert.equal(cursorAgentReading.resets_at, '2026-07-20T08:00:00Z');
  assert.deepEqual(cursorAgentReading.source, {
    collector_id: 'cursor-agent-dashboard',
    source_schema: 'cursor/GetCurrentPeriodUsage/v1',
    auth_source: 'cursor-agent-current-login',
  });
  assert.doesNotMatch(JSON.stringify(status.readings), /access_token|refresh_token|credential/i);
  assert.ok(status.summary.decisions.every((decision: Data) => decision.fanout_covered === true));
  const cursor = status.summary.decisions.filter(
    (decision: Data) => decision.target.harness_id === 'cursor',
  );
  assert.deepEqual(
    cursor.map((decision: Data) => [decision.target.surface_id, decision.state]).sort(),
    [
      ['cursor-agent-cli', 'exhausted'],
      ['cursor-ide-plugin', 'exhausted'],
    ],
  );
});

test('Codex five-hour-only changes do not change the decision revision or emit an edge', async () => {
  const { home } = setupSubscription();
  const store = fakeStore();
  await refreshMachineWideQuota({ home, env: {}, store, collectors, coordination, now: NOW });
  const before = (await readMachineWideQuotaStatus(store, NOW)).summary.decisions.find(
    (decision: Data) => decision.target.surface_id === 'codex-cli',
  );
  const fiveHourChanged: MachineQuotaCollectorBoundary = {
    collect(target) {
      const result = collectionFor(target);
      if (target.surface_id === 'codex-cli' && result.signal) {
        result.signal.five_hour = { used_percentage: 0, resets_at: RESET + 18_000 };
      }
      return result;
    },
  };
  const refreshed = await refreshMachineWideQuota({
    home,
    env: {},
    store,
    collectors: fiveHourChanged,
    coordination,
    now: NOW,
  });
  const after = (await readMachineWideQuotaStatus(store, NOW)).summary.decisions.find(
    (decision: Data) => decision.target.surface_id === 'codex-cli',
  );
  assert.equal(after.decision_revision, before.decision_revision);
  assert.equal(refreshed.deltas.length, 0);
});

test('ambient production posture ignores admission reservation and collector ceiling/margin', async () => {
  const { home } = setupSubscription();
  const store = fakeStore();
  let codexAggregation = '';
  const authorityCollector: MachineQuotaCollectorBoundary = {
    collect(target) {
      const result = collectionFor(target);
      if (target.surface_id !== 'codex-cli') return result;
      const authority = authorityFor(target, { ceiling: 90, margin: 2 });
      codexAggregation = authority.aggregation_key;
      return {
        ...result,
        authority,
        signal: {
          captured_at: NOW.getTime() / 1000,
          five_hour: { used_percentage: 100, resets_at: RESET - 10_000 },
          seven_day: { used_percentage: 79, resets_at: RESET },
        },
      };
    },
  };

  await refreshMachineWideQuota({
    home,
    env: {},
    store,
    collectors: authorityCollector,
    coordination,
    now: NOW,
  });
  const before = (await readMachineWideQuotaStatus(store, NOW)).summary.decisions.find(
    (decision: Data) => decision.target.surface_id === 'codex-cli',
  );
  assert.equal(before.state, 'healthy');

  store.aggregations.set(codexAggregation, {
    schema: 'ccm/quota-reservation-snapshot/v1',
    aggregation_key: codexAggregation,
    active_reserved_pct: 10,
    reservations: [{ state: 'held', amount_pct: 10, aggregation_key: codexAggregation }],
  });
  const after = (await readMachineWideQuotaStatus(store, NOW)).summary.decisions.find(
    (decision: Data) => decision.target.surface_id === 'codex-cli',
  );
  assert.equal(after.state, 'healthy', 'ambient pacing must not consume task reservation headroom');
  assert.equal(after.decision_revision, before.decision_revision);
});

test('owner-only admission reservation cannot redefine ambient machine pacing posture', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ccm-machine-quota-real-reservation-'));
  roots.push(root);
  const home = join(root, '.cc_master');
  const store = createQuotaAdmissionStore({ home, now: () => NOW });
  let used = 70;
  let codexAuthority: MachineQuotaAuthorityRefs | undefined;
  const reservationCollector: MachineQuotaCollectorBoundary = {
    collect(target) {
      const result = collectionFor(target);
      if (target.surface_id !== 'codex-cli') return result;
      codexAuthority = authorityFor(target, { ceiling: 90, margin: 2 });
      return {
        ...result,
        authority: codexAuthority,
        signal: {
          captured_at: NOW.getTime() / 1000,
          five_hour: { used_percentage: 100, resets_at: RESET - 10_000 },
          seven_day: { used_percentage: used, resets_at: RESET },
        },
      };
    },
  };
  await refreshMachineWideQuota({
    home,
    env: {},
    store,
    collectors: reservationCollector,
    coordination,
    now: NOW,
  });
  assert.ok(codexAuthority);
  const sourceKey = 'machine-wide/codex/codex-cli/seven_day';
  const observation = await store.readObservation(sourceKey);
  assert.ok(observation);
  const held = await store.reserve({
    schema: 'ccm/quota-reservation-request/v1',
    source_key: sourceKey,
    aggregation_key: codexAuthority.aggregation_key,
    capacity_pct: 18,
    id: 'qres-machine-posture-1',
    key: 'attempt-machine-posture-1',
    hash: 'sha256:caller-hash-is-not-authority',
    amount_pct: 10,
    state: 'held',
    expires_at: '2026-07-16T09:00:00Z',
    checked_at: NOW.toISOString(),
    source_revision: observation.source_revision,
    attempt_id: 'attempt-machine-posture-1',
    candidate_id: 'codex-cli-worker',
    account_id: codexAuthority.account_key,
    pool_id: codexAuthority.pool_id,
    identity_fingerprint: codexAuthority.identity_fingerprint,
  });
  assert.equal(held.action, 'created', JSON.stringify(held));
  assert.equal(held.active_reserved_pct, 10);

  used = 79;
  await refreshMachineWideQuota({
    home,
    env: {},
    store,
    collectors: reservationCollector,
    coordination,
    now: NOW,
  });
  const decision = (await readMachineWideQuotaStatus(store, NOW)).summary.decisions.find(
    (candidate: Data) => candidate.target.surface_id === 'codex-cli',
  );
  assert.equal(decision.state, 'healthy');
  assert.deepEqual(decision.reason_codes, []);
});

test('machine posture reuses provider pacing boundaries for Cursor 80% and Claude 7d 87%', async () => {
  const { home } = setupSubscription();
  const store = fakeStore();
  const boundaries: MachineQuotaCollectorBoundary = {
    collect(target) {
      const result = collectionFor(target);
      if (!result.signal) return result;
      if (target.surface_id === 'cursor-agent-cli') {
        result.signal.billing_period = { used_percentage: 80, resets_at: RESET };
      }
      if (target.surface_id === 'claude-cli' && target.window_name === 'seven_day') {
        result.signal.seven_day = { used_percentage: 87, resets_at: RESET };
      }
      return result;
    },
  };
  await refreshMachineWideQuota({
    home,
    env: {},
    store,
    collectors: boundaries,
    coordination,
    now: NOW,
  });
  const decisions = (await readMachineWideQuotaStatus(store, NOW)).summary.decisions;
  const cursor = decisions.find(
    (decision: Data) => decision.target.surface_id === 'cursor-agent-cli',
  );
  const claude7d = decisions.find(
    (decision: Data) =>
      decision.target.surface_id === 'claude-cli' && decision.target.window.name === 'seven_day',
  );
  assert.equal(cursor.state, 'tight', 'Cursor billing period at 80% is pacing throttle, not stop');
  assert.deepEqual(cursor.reason_codes, ['QUOTA_TIGHT']);
  assert.equal(claude7d.state, 'exhausted', 'Claude 7d at 87% is pacing stop_7d');
  assert.deepEqual(claude7d.reason_codes, ['QUOTA_EXHAUSTED']);
});

test('same surface identity diagnostics do not redefine the signal scope', async () => {
  const { home } = setupSubscription();
  const store = fakeStore();
  let identity = 'codex-identity-a';
  const identityCollector: MachineQuotaCollectorBoundary = {
    collect(target) {
      const result = collectionFor(target);
      return target.surface_id === 'codex-cli'
        ? { ...result, authority: authorityFor(target, { identity }) }
        : result;
    },
  };
  await refreshMachineWideQuota({
    home,
    env: {},
    store,
    collectors: identityCollector,
    coordination,
    now: NOW,
  });
  const before = (await readMachineWideQuotaStatus(store, NOW)).summary.decisions.find(
    (decision: Data) => decision.target.surface_id === 'codex-cli',
  );

  identity = 'codex-identity-b';
  await refreshMachineWideQuota({
    home,
    env: {},
    store,
    collectors: identityCollector,
    coordination,
    now: NOW,
  });
  const after = (await readMachineWideQuotaStatus(store, NOW)).summary.decisions.find(
    (decision: Data) => decision.target.surface_id === 'codex-cli',
  );
  assert.equal(after.scope_digest, before.scope_digest);
  assert.equal(after.state, before.state);
});

test('refreshed usage without identity/payer authority still produces signal posture', async () => {
  const { home } = setupSubscription();
  const store = fakeStore();
  const identityBlind: MachineQuotaCollectorBoundary = {
    collect(target) {
      const result = collectionFor(target) as MachineQuotaCollection & { authority?: Data };
      if (target.surface_id === 'codex-cli') delete result.authority;
      return result;
    },
  };
  await refreshMachineWideQuota({
    home,
    env: {},
    store,
    collectors: identityBlind,
    coordination,
    now: NOW,
  });
  const decision = (await readMachineWideQuotaStatus(store, NOW)).summary.decisions.find(
    (candidate: Data) => candidate.target.surface_id === 'codex-cli',
  );
  assert.equal(decision.state, 'tight');
  assert.deepEqual(decision.reason_codes, ['QUOTA_TIGHT']);
});

test('machine-wide target catalog includes exact kimi five-hour and seven-day quota faces', async () => {
  const { home } = setupSubscription();
  const store = fakeStore();
  const capturedTargets: Data[] = [];
  const captureCollector: MachineQuotaCollectorBoundary = {
    collect(target) {
      capturedTargets.push(structuredClone(target));
      return collectionFor(target);
    },
  };
  await refreshMachineWideQuota({
    home,
    env: {},
    store,
    collectors: captureCollector,
    coordination,
    now: NOW,
  });

  assert.deepEqual(
    capturedTargets
      .filter((target) => target.harness_id === 'kimi-code')
      .map((target) => ({
        harness_id: target.harness_id,
        surface_id: target.surface_id,
        provider_id: target.provider_id,
        bucket_id: target.bucket_id,
        window: target.window,
        window_name: target.window_name,
        collector_id: target.collector_id,
        default_collector_harness: target.default_collector_harness,
      }))
      .sort((left, right) => left.window_name.localeCompare(right.window_name)),
    [
      {
        harness_id: 'kimi-code',
        surface_id: 'kimi-cli',
        provider_id: 'moonshot',
        bucket_id: 'five-hour-global',
        window: { kind: 'rolling', name: 'five_hour', duration_sec: 18_000 },
        window_name: 'five_hour',
        collector_id: 'kimi-usages-api',
        default_collector_harness: 'kimi-code',
      },
      {
        harness_id: 'kimi-code',
        surface_id: 'kimi-cli',
        provider_id: 'moonshot',
        bucket_id: 'seven-day-global',
        window: { kind: 'rolling', name: 'seven_day', duration_sec: 604_800 },
        window_name: 'seven_day',
        collector_id: 'kimi-usages-api',
        default_collector_harness: 'kimi-code',
      },
    ],
  );
});

test('fresh kimi signal produces healthy fresh five-hour and seven-day machine-wide decisions', async () => {
  const { home } = setupSubscription();
  const store = fakeStore();
  await refreshMachineWideQuota({ home, env: {}, store, collectors, coordination, now: NOW });

  const status = await readMachineWideQuotaStatus(store, NOW);
  const decisions = status.summary.decisions
    .filter((decision: Data) => decision.target.harness_id === 'kimi-code')
    .sort((left: Data, right: Data) =>
      left.target.window.name.localeCompare(right.target.window.name),
    );
  assert.equal(decisions.length, 2);
  assert.deepEqual(
    decisions.map((decision: Data) => [
      decision.target.window.name,
      decision.state,
      decision.freshness,
      decision.reason_codes,
    ]),
    [
      ['five_hour', 'healthy', 'fresh', []],
      ['seven_day', 'healthy', 'fresh', []],
    ],
  );
  const readings = status.readings
    .filter((reading: Data) => reading.target.harness_id === 'kimi-code')
    .sort((left: Data, right: Data) =>
      left.target.window.name.localeCompare(right.target.window.name),
    );
  assert.deepEqual(
    readings.map((reading: Data) => [
      reading.target.window.name,
      reading.used_percentage,
      reading.source,
    ]),
    [
      [
        'five_hour',
        22,
        {
          collector_id: 'kimi-usages-api',
          source_schema: 'kimi-code/usages/v1',
          auth_source: 'kimi-code-current-login',
        },
      ],
      [
        'seven_day',
        61,
        {
          collector_id: 'kimi-usages-api',
          source_schema: 'kimi-code/usages/v1',
          auth_source: 'kimi-code-current-login',
        },
      ],
    ],
  );
});

test('machine-wide target catalog includes claude-fable-5 independent seven-day quota face', async () => {
  const { home } = setupSubscription();
  const store = fakeStore();
  const capturedTargets: Data[] = [];
  const captureCollector: MachineQuotaCollectorBoundary = {
    collect(target) {
      capturedTargets.push(structuredClone(target));
      return collectionFor(target);
    },
  };
  await refreshMachineWideQuota({
    home,
    env: {},
    store,
    collectors: captureCollector,
    coordination,
    now: NOW,
  });

  const fableTarget = capturedTargets.find((target) => target.surface_id === 'claude-fable-5-cli');
  assert.ok(fableTarget);
  assert.equal(fableTarget.bucket_id, 'seven-day-fable-global');
  assert.equal(fableTarget.window_name, 'seven_day');
  assert.equal(fableTarget.collector_id, 'claude-statusline-sidecar');
});

test('fresh fable 7d signal produces healthy machine-wide decision + reading', async () => {
  const { home } = setupSubscription();
  const store = fakeStore();
  await refreshMachineWideQuota({ home, env: {}, store, collectors, coordination, now: NOW });

  const status = await readMachineWideQuotaStatus(store, NOW);
  const decision = status.summary.decisions.find(
    (candidate: Data) => candidate.target.surface_id === 'claude-fable-5-cli',
  );
  assert.ok(decision);
  assert.equal(decision.target.window.name, 'seven_day');
  assert.equal(decision.state, 'healthy');
  const reading = status.readings.find(
    (candidate: Data) => candidate.target.surface_id === 'claude-fable-5-cli',
  );
  assert.equal(reading?.used_percentage, 52);
  assert.equal(reading?.source.collector_id, 'claude-statusline-sidecar');
});

test('expired or absent kimi signal degrades both machine-wide windows to honest unknown', async () => {
  const { home } = setupSubscription();
  const store = fakeStore();
  const expiredKimi: MachineQuotaCollectorBoundary = {
    collect(target) {
      if (target.harness_id === 'kimi-code') {
        return { status: 'unknown', reason: 'kimi-code access_token expired' };
      }
      return collectionFor(target);
    },
  };
  await refreshMachineWideQuota({
    home,
    env: {},
    store,
    collectors: expiredKimi,
    coordination,
    now: NOW,
  });

  const status = await readMachineWideQuotaStatus(store, NOW);
  const decisions = status.summary.decisions.filter(
    (decision: Data) => decision.target.harness_id === 'kimi-code',
  );
  assert.equal(decisions.length, 2);
  assert.ok(decisions.every((decision: Data) => decision.state === 'unknown'));
  assert.ok(decisions.every((decision: Data) => decision.freshness === 'unknown'));
  assert.ok(
    decisions.every(
      (decision: Data) =>
        decision.reason_codes.length === 1 && decision.reason_codes[0] === 'QUOTA_SIGNAL_UNKNOWN',
    ),
  );
  const readings = status.readings.filter(
    (reading: Data) => reading.target.harness_id === 'kimi-code',
  );
  assert.equal(readings.length, 2);
  assert.ok(readings.every((reading: Data) => reading.used_percentage === null));
  assert.ok(readings.every((reading: Data) => reading.resets_at === null));
});

test('Cursor IDE and Agent independently observe one shared billing pool with explicit provenance', async () => {
  const { home } = setupSubscription();
  const store = fakeStore();
  const sharedCursorPool: MachineQuotaCollectorBoundary = {
    collect(target) {
      const result = collectionFor(target) as MachineQuotaCollection & { authority?: Data };
      if (target.provider_id !== 'cursor') return result;
      delete result.authority;
      result.quotaScopeFingerprint = 'sha256:one-cursor-subscription';
      result.authSource =
        target.surface_id === 'cursor-agent-cli'
          ? 'cursor-agent-current-login'
          : 'cursor-ide-current-login';
      return result;
    },
  };
  await refreshMachineWideQuota({
    home,
    env: {},
    store,
    collectors: sharedCursorPool,
    coordination,
    now: NOW,
  });
  const decisions = (await readMachineWideQuotaStatus(store, NOW)).summary.decisions.filter(
    (candidate: Data) => candidate.target.provider_id === 'cursor',
  );
  assert.equal(decisions.length, 2);
  assert.ok(decisions.every((decision: Data) => decision.state === 'exhausted'));
  assert.equal(decisions[0].quota_scope_digest, decisions[1].quota_scope_digest);
  assert.notEqual(decisions[0].scope_digest, decisions[1].scope_digest);
  assert.deepEqual(decisions.map((decision: Data) => decision.source.auth_source).sort(), [
    'cursor-agent-current-login',
    'cursor-ide-current-login',
  ]);
  assert.ok(decisions.every((decision: Data) => decision.target.window.name === 'billing_period'));
  const sharedCapacity = aggregateMachineQuotaCapacityViews(decisions);
  assert.equal(sharedCapacity.known_capacities.length, 1);
  assert.equal(sharedCapacity.known_capacities[0].capacity_units, 1);
  assert.deepEqual(
    sharedCapacity.known_capacities[0].scope_digests,
    decisions.map((decision: Data) => decision.scope_digest).sort(),
  );
  const unresolvedCapacity = aggregateMachineQuotaCapacityViews(
    decisions.map((decision: Data) => ({ ...decision, quota_scope_digest: null })),
  );
  assert.equal(unresolvedCapacity.known_capacities.length, 0);
  assert.deepEqual(
    unresolvedCapacity.unresolved_scope_digests,
    decisions.map((decision: Data) => decision.scope_digest).sort(),
  );
  assert.equal(unresolvedCapacity.unresolved_capacity_units, null);
});

test('missing and hard-stale provider signals both degrade to unknown with explicit reason', async () => {
  const { home } = setupSubscription();
  const store = fakeStore();
  const degraded: MachineQuotaCollectorBoundary = {
    collect(target) {
      if (target.surface_id === 'cursor-agent-cli') {
        return { status: 'unknown', reason: 'agent auth unavailable' };
      }
      const result = collectionFor(target);
      if (target.surface_id === 'cursor-ide-plugin' && result.signal) {
        result.signal.captured_at = NOW.getTime() / 1000 - 1_000;
      }
      return result;
    },
  };
  await refreshMachineWideQuota({
    home,
    env: {},
    store,
    collectors: degraded,
    coordination,
    now: NOW,
  });
  const decisions = (await readMachineWideQuotaStatus(store, NOW)).summary.decisions;
  const missing = decisions.find(
    (decision: Data) => decision.target.surface_id === 'cursor-agent-cli',
  );
  const hardStale = decisions.find(
    (decision: Data) => decision.target.surface_id === 'cursor-ide-plugin',
  );
  assert.equal(missing.state, 'unknown');
  assert.equal(hardStale.state, 'unknown');
  assert.equal(hardStale.freshness, 'hard-stale');
  assert.deepEqual(hardStale.reason_codes, ['QUOTA_HARD_STALE']);
});

test('a current destination write failure prevents checkpoint advance for crash-safe replay', async () => {
  const { home } = setupSubscription({ brokenBoard: true });
  const store = fakeStore();
  const result = await refreshMachineWideQuota({
    home,
    env: {},
    store,
    collectors,
    coordination,
    now: NOW,
  });
  assert.equal(result.fanout_complete, false);
  assert.equal(result.checkpoint_advanced, false);
  const projection = await store.readMachineProjection();
  assert.equal(projection?.schema, 'ccm/machine-quota-projection/v1');
  assert.match(String(projection?.home_salt), /^[0-9a-f-]{36}$/i);
  assert.deepEqual(
    projection?.decisions,
    [],
    'salt metadata is durable but decision checkpoint stays empty',
  );
  assert.ok(result.deliveries.some((delivery: Data) => delivery.status === 'error'));
});

test('one provider collector failure is scope-local and cannot erase successful providers', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ccm-machine-quota-partial-'));
  roots.push(root);
  const home = join(root, '.cc_master');
  const store = fakeStore();
  const partial: MachineQuotaCollectorBoundary = {
    collect(target) {
      if (target.surface_id === 'claude-cli') throw new Error('anthropic unavailable');
      return collectionFor(target);
    },
  };
  const refreshed = await refreshMachineWideQuota({
    home,
    env: {},
    store,
    collectors: partial,
    coordination,
    now: NOW,
  });
  assert.equal(
    refreshed.scopes.filter((scope: Data) => scope.target.surface_id === 'claude-cli').length,
    2,
  );
  assert.ok(
    refreshed.scopes
      .filter((scope: Data) => scope.target.surface_id === 'claude-cli')
      .every((scope: Data) => scope.status === 'error'),
  );
  assert.equal(
    refreshed.scopes.find((scope: Data) => scope.target.surface_id === 'codex-cli').status,
    'refreshed',
  );
  const status = await readMachineWideQuotaStatus(store, NOW);
  assert.equal(
    status.summary.decisions.find((decision: Data) => decision.target.surface_id === 'codex-cli')
      .state,
    'tight',
  );
  assert.ok(
    status.summary.decisions
      .filter((decision: Data) => decision.target.surface_id === 'claude-cli')
      .every((decision: Data) => decision.state === 'unknown'),
  );
});

test('CLI status is cached-only and refresh is an explicit machine-wide live seam', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ccm-machine-quota-cli-'));
  roots.push(root);
  const home = join(root, '.cc_master');
  let collectionCount = 0;
  const boundary: MachineQuotaCollectorBoundary = {
    collect(target) {
      collectionCount += 1;
      return collectionFor(target);
    },
  };
  const invoke = async (argv: string[]) => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const code = await run(argv, {
      env: { HOME: root, CC_MASTER_HOME: home },
      out: (line) => stdout.push(line),
      err: (line) => stderr.push(line),
      quotaEffects: createProductionQuotaEffectBoundary({ home }),
      machineQuotaCollectors: boundary,
    });
    return { code, stdout: stdout.join('\n'), stderr: stderr.join('\n') };
  };

  const cached = await invoke(['quota', 'status', '--machine-wide', '--json']);
  assert.equal(cached.code, 0, cached.stderr);
  assert.equal(collectionCount, 0, 'status cannot call a provider collector');
  assert.equal(JSON.parse(cached.stdout).schema, 'ccm/machine-quota-status/v1');

  const missingFlag = await invoke(['quota', 'refresh', '--json']);
  assert.equal(missingFlag.code, 2);
  assert.equal(collectionCount, 0);

  const refreshed = await invoke(['quota', 'refresh', '--machine-wide', '--json']);
  assert.equal(refreshed.code, 0, refreshed.stderr);
  assert.equal(collectionCount, 8);
  assert.equal(JSON.parse(refreshed.stdout).schema, 'ccm/machine-quota-refresh/v1');
});
