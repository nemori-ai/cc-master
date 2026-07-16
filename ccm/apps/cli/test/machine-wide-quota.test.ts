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
  type MachineQuotaCollection,
  type MachineQuotaCollectorBoundary,
  type MachineQuotaStore,
  readMachineWideQuotaStatus,
  refreshMachineWideQuota,
} from '../src/machine-wide-quota.js';
import { createProductionQuotaEffectBoundary } from '../src/quota-production-effects.js';
import { run } from '../src/router.js';

type Data = Record<string, any>;

const NOW = new Date('2026-07-16T08:00:00Z');
const RESET = Date.parse('2026-07-20T08:00:00Z') / 1000;
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fakeStore(): MachineQuotaStore & { observations: Map<string, Data>; projection?: Data } {
  const observations = new Map<string, Data>();
  return {
    observations,
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

function collectionFor(target: Readonly<Data>): MachineQuotaCollection {
  const common = { captured_at: NOW.getTime() / 1000 };
  if (target.surface_id === 'codex-cli') {
    return {
      status: 'refreshed',
      source: 'fake-codex',
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
      signal: {
        ...common,
        five_hour: { used_percentage: 40, resets_at: RESET },
        seven_day: { used_percentage: 40, resets_at: RESET },
      },
    };
  }
  if (target.surface_id === 'cursor-ide-plugin') {
    return {
      status: 'refreshed',
      source: 'fake-cursor-ide',
      signal: {
        ...common,
        billing_period: { used_percentage: 86, resets_at: RESET },
      },
    };
  }
  return { status: 'unsupported', reason: 'Cursor Agent has no surface-owned collector' };
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
      ['cursor-agent-cli', 'became_unknown'],
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
  assert.ok(status.summary.decisions.every((decision: Data) => decision.fanout_covered === true));
  const cursor = status.summary.decisions.filter(
    (decision: Data) => decision.target.harness_id === 'cursor',
  );
  assert.deepEqual(
    cursor.map((decision: Data) => [decision.target.surface_id, decision.state]).sort(),
    [
      ['cursor-agent-cli', 'unknown'],
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
  assert.equal(collectionCount, 5);
  assert.equal(JSON.parse(refreshed.stdout).schema, 'ccm/machine-quota-refresh/v1');
});
