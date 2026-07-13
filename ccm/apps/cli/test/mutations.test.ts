// mutations.test.ts — board v2 写 SSOT（纯函数·零 IO）契约门。
//
// mutations.ts 是写入关卡管线的「mutate(raw,args)→next」纯函数环节（cli-design §5 步骤 4）：
//   每个 verb 一个纯函数，structuredClone 输入后改、返回新对象，零 IO，每次盖 owner.heartbeat。
//   本测试钉死：每个 verb 的 happy path + 关键错误路径（transition 非法 throw、applySet 命中 🔒 throw、
//   cadenceShip 不在此校验成员）+ **纯函数纪律**（原 board 不被 alias / 原地改）。
//
// T2a port 注：原 .mjs 经 createRequire 加载 CJS（cli/test/unit/mutations.test.mjs），改成正常 ESM import
//   ported mutations.ts；board-model 的 ISO_UTC_RE / SCHEMA_VERSION 从 `@ccm/engine` import（rewire 真链路）。

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ISO_UTC_RE, SCHEMA_VERSION } from '@ccm/engine';
import * as m from '../src/mutations.js';

const model = { ISO_UTC_RE, SCHEMA_VERSION };

// 严格 ISO-8601 UTC 秒级正则（与 board-model 同口径）。
const ISO = model.ISO_UTC_RE;

type AnyBoard = Record<string, any>;

// 一块最小但结构合法的 board（用于写测试），含两个 task。
function baseBoard(): AnyBoard {
  return {
    schema: 'cc-master/v2',
    meta: { template_version: 3 },
    goal: 'g',
    owner: { active: true, session_id: 'sid-1', heartbeat: '2020-01-01T00:00:00Z' },
    git: { worktree: '/w', branch: 'b' },
    scheduling: { wip_limit: 4 },
    tasks: [
      { id: 'T0', status: 'done', deps: [], finished_at: '2020-01-01T00:00:00Z' },
      { id: 'T1', status: 'ready', deps: ['T0'] },
    ],
    log: [],
  };
}

// 深冻结快照（用于断言原入参不被改）。
function snapshot(o: unknown): string {
  return JSON.stringify(o);
}

function routedPlanning(): AnyBoard {
  return {
    schema: 'ccm/task-planning/v1',
    assessed_at: '2026-07-10T08:00:00Z',
    assessor: 'master-orchestrator',
    dimensions: {
      reasoning: 'multi-step',
      uncertainty: 'low',
      risk: 'medium',
      scope: 'multi-file',
      context: 'medium',
      coordination: 'none',
      reversibility: 'reversible',
    },
    estimate_confidence: 'high',
    quality: { effect_floor: 'meets-required-capabilities' },
    budget: { posture: 'ample', max_attempts: 2 },
    capabilities: {
      required: [{ id: 'structured-output' }],
      preferred: [],
      forbidden: [{ id: 'push-remote' }],
    },
  };
}

function routedPolicy(): AnyBoard {
  return {
    objective: 'balanced',
    constraints: {
      effect_floor: 'meets-required-capabilities',
      quota_unknown: 'ineligible',
      cross_harness_quota_admission: 'ample-only',
    },
    candidates: [
      {
        id: 'codex-cli',
        surface: 'cli-headless',
        adapter: 'codex-cli/headless-v1',
        harness: 'codex',
        provider: 'openai',
        model: 'gpt-future',
        effort: 'high',
        capabilities: ['structured-output'],
        effect_floors_met: ['meets-required-capabilities'],
        permission: { profile: 'workspace-write', denies: ['push-remote', 'account-mutation'] },
        account_mutation: 'forbidden',
        requires: [
          'runtime-healthy',
          'capability-match',
          'effect-floor',
          'permission-compatible',
          'account-mutation-forbidden',
        ],
      },
    ],
    chains: { ample: ['codex-cli'], tight: ['codex-cli'] },
    fallback: {
      on: ['transport-error'],
      never_on: [
        'policy-blocked',
        'permission-blocked',
        'security-blocked',
        'workspace-mismatch',
        'task-blocked',
        'acceptance-failed',
      ],
      exhaustion: 'fail-closed',
      same_harness: 'explicit-candidate-only',
    },
  };
}

function routeSelection(): AnyBoard {
  return {
    candidate_id: 'codex-cli',
    chain: 'ample',
    selected_at: '2026-07-10T08:01:00Z',
    evidence: {
      observed_at: '2026-07-10T08:00:30Z',
      valid_until: '2026-07-10T08:05:00Z',
      qualification_results: [
        { predicate: 'runtime-healthy', status: 'pass', ref: 'capability://codex/cli' },
        { predicate: 'capability-match', status: 'pass', ref: 'contract://capabilities' },
        { predicate: 'effect-floor', status: 'pass', ref: 'contract://effect' },
        { predicate: 'permission-compatible', status: 'pass', ref: 'contract://permission' },
        {
          predicate: 'account-mutation-forbidden',
          status: 'pass',
          ref: 'contract://account-mutation',
        },
      ],
    },
    reason_codes: ['capability-best-fit'],
    rationale: 'fixture-backed route',
  };
}

// ── stampNow ───────────────────────────────────────────────────────────────────────────────────
test('stampNow → strict ISO-8601 UTC seconds (no millis)', () => {
  const s = m.stampNow();
  assert.ok(ISO.test(s), `stampNow() must match YYYY-MM-DDTHH:MM:SSZ, got ${s}`);
  assert.ok(!/\.\d/.test(s), 'no millisecond fraction');
});

// ── boardInit ────────────────────────────────────────────────────────────────────────────────────
test('boardInit({goal}) → template-shaped board; active:true, session_id:"" (NOT arming)', () => {
  const b = m.boardInit({ goal: 'ship it' });
  assert.equal(b.schema, model.SCHEMA_VERSION);
  assert.equal(b.schema, 'cc-master/v2');
  assert.equal(b.goal, 'ship it');
  assert.equal(b.owner.active, true);
  assert.equal(b.owner.session_id, '', 'session_id is EMPTY — init never arms (红线6)');
  assert.ok(ISO.test(b.owner.heartbeat), 'heartbeat stamped');
  assert.deepEqual(b.tasks, []);
  assert.deepEqual(b.log, []);
  assert.equal(b.meta.template_version, 3);
  assert.equal(b.scheduling.wip_limit, 4);
});

test('boardInit() with no goal → empty goal string', () => {
  const b = m.boardInit();
  assert.equal(b.goal, '');
  assert.equal(b.owner.session_id, '');
});

// ── boardUpdate ──────────────────────────────────────────────────────────────────────────────────
test('boardUpdate updates goal / scheduling / git; stamps heartbeat; does NOT mutate input', () => {
  const orig = baseBoard();
  const snap = snapshot(orig);
  const b = m.boardUpdate(orig, {
    goal: 'new goal',
    wipLimit: 8,
    ownerWip: 3,
    branch: 'feat/x',
    worktree: '/ww',
  });
  assert.equal(b.goal, 'new goal');
  assert.equal(b.scheduling.wip_limit, 8);
  assert.equal(b.scheduling.owner_wip_limit, 3);
  assert.equal(b.git.branch, 'feat/x');
  assert.equal(b.git.worktree, '/ww');
  assert.ok(ISO.test(b.owner.heartbeat));
  assert.notEqual(b.owner.heartbeat, orig.owner.heartbeat, 'heartbeat changed');
  assert.equal(snapshot(orig), snap, 'input board untouched (pure)');
});

test('boardUpdate sets coordination.priority (creates coordination if absent; preserves other coordination keys)', () => {
  // 缺 coordination → 建块写 priority
  const b1 = m.boardUpdate(baseBoard(), { priority: 'high' });
  assert.equal(b1.coordination.priority, 'high');
  // 已有 coordination.state → 写 priority 不擦掉 state
  const seeded = baseBoard();
  seeded.coordination = { state: { current: { active_tasks: 2 } } };
  const b2 = m.boardUpdate(seeded, { priority: 'urgent' });
  assert.equal(b2.coordination.priority, 'urgent');
  assert.deepEqual(
    b2.coordination.state.current,
    { active_tasks: 2 },
    'existing coordination.state preserved',
  );
});

// ── boardStampHarness ───────────────────────────────────────────────────────────────────────────
test('boardStampHarness stamps trusted harness and overwrites prior trusted value', () => {
  const orig = baseBoard();
  orig.owner.harness = 'codex';
  const snap = snapshot(orig);

  const b = m.boardStampHarness(orig, { harnessId: 'cursor' });
  assert.equal(b.owner.harness, 'cursor');
  assert.ok(ISO.test(b.owner.heartbeat));
  assert.notEqual(b.owner.heartbeat, orig.owner.heartbeat, 'trusted stamp refreshes heartbeat');
  assert.equal(snapshot(orig), snap, 'input board untouched (pure)');
});

test('boardStampHarness no-ops when no trusted harness is detected', () => {
  const orig = baseBoard();
  orig.owner.harness = 'codex';
  const b = m.boardStampHarness(orig, { harnessId: null });

  assert.equal(b.owner.harness, 'codex');
  assert.equal(
    b.owner.heartbeat,
    orig.owner.heartbeat,
    'no trusted detect must not touch heartbeat',
  );
  assert.notEqual(b, orig, 'returns a clone even on no-op');
});

test('boardStampHarness rejects unknown or invalid harness ids', () => {
  assert.throws(
    () => m.boardStampHarness(baseBoard(), { harnessId: 'unknown' }),
    /trusted known harness id/,
  );
  assert.throws(
    () => m.boardStampHarness(baseBoard(), { harnessId: 'future-harness' }),
    /trusted known harness id/,
  );
});

// ── addTask ──────────────────────────────────────────────────────────────────────────────────────
test('addTask appends a task with defaults (status ready, deps [], created_at stamped)', () => {
  const orig = baseBoard();
  const snap = snapshot(orig);
  const b = m.addTask(orig, { id: 'T9', title: 'hello' });
  assert.equal(b.tasks.length, 3);
  const t = b.tasks.find((x: AnyBoard) => x.id === 'T9');
  assert.equal(t.status, 'ready');
  assert.deepEqual(t.deps, []);
  assert.equal(t.title, 'hello');
  assert.ok(ISO.test(t.created_at));
  assert.equal(snapshot(orig), snap, 'input untouched');
});

test('addTask honors explicit fields incl deps, type, executor, references', () => {
  const b = m.addTask(baseBoard(), {
    id: 'T9',
    deps: ['T0', 'T1'],
    type: 'development',
    executor: 'subagent',
    handle: 'bg-1',
    references: [{ kind: 'spec', ref: '/abs/spec.md' }],
    estimate: { value: 3, unit: 'h' },
  });
  const t = b.tasks.find((x: AnyBoard) => x.id === 'T9');
  assert.deepEqual(t.deps, ['T0', 'T1']);
  assert.equal(t.type, 'development');
  assert.equal(t.executor, 'subagent');
  assert.equal(t.handle, 'bg-1');
  assert.deepEqual(t.references, [{ kind: 'spec', ref: '/abs/spec.md' }]);
  assert.deepEqual(t.estimate, { value: 3, unit: 'h' });
});

test('addTask does NOT alias deps/references arrays from input fields', () => {
  const deps = ['T0'];
  const b = m.addTask(baseBoard(), { id: 'T9', deps });
  const t = b.tasks.find((x: AnyBoard) => x.id === 'T9');
  deps.push('MUTATED');
  assert.deepEqual(t.deps, ['T0'], 'task.deps not aliased to caller array');
});

test('addTask/updateTask declare a review gate through the dedicated reviewGate input', () => {
  let b = m.addTask(baseBoard(), { id: 'R1', reviewGate: 'APPROVE' });
  assert.deepEqual(b.tasks.find((x: AnyBoard) => x.id === 'R1').dependency_gate, {
    kind: 'review',
    required_verdict: 'APPROVE',
  });
  b = m.updateTask(b, 'T1', { reviewGate: 'APPROVE' });
  assert.deepEqual(b.tasks.find((x: AnyBoard) => x.id === 'T1').dependency_gate, {
    kind: 'review',
    required_verdict: 'APPROVE',
  });
  assert.throws(
    () => m.addTask(baseBoard(), { id: 'BAD', reviewGate: 'REQUEST-CHANGES' }),
    (e: any) => e.errKind === 'Validation',
  );
});

// ── updateTask ───────────────────────────────────────────────────────────────────────────────────
test('updateTask overwrites flexible fields; stamps heartbeat; pure', () => {
  const orig = baseBoard();
  const snap = snapshot(orig);
  const b = m.updateTask(orig, 'T1', { title: 'updated', estimate: { value: 2, unit: 'h' } });
  const t = b.tasks.find((x: AnyBoard) => x.id === 'T1');
  assert.equal(t.title, 'updated');
  assert.deepEqual(t.estimate, { value: 2, unit: 'h' });
  assert.equal(snapshot(orig), snap, 'input untouched');
});

test('updateTask addDep / rmDep (dedup)', () => {
  let b = m.updateTask(baseBoard(), 'T1', { addDep: ['T0', 'X', 'X'] }); // T0 already present
  let t = b.tasks.find((x: AnyBoard) => x.id === 'T1');
  assert.deepEqual(t.deps, ['T0', 'X'], 'addDep dedups + appends');
  b = m.updateTask(b, 'T1', { rmDep: ['T0'] });
  t = b.tasks.find((x: AnyBoard) => x.id === 'T1');
  assert.deepEqual(t.deps, ['X'], 'rmDep removes');
});

test('updateTask addRef / rmRef (by ref string)', () => {
  let b = m.updateTask(baseBoard(), 'T1', {
    addRef: [
      { kind: 'spec', ref: '/a' },
      { kind: 'plan', ref: '/b' },
    ],
  });
  let t = b.tasks.find((x: AnyBoard) => x.id === 'T1');
  assert.equal(t.references.length, 2);
  b = m.updateTask(b, 'T1', { rmRef: ['/a'] });
  t = b.tasks.find((x: AnyBoard) => x.id === 'T1');
  assert.deepEqual(t.references, [{ kind: 'plan', ref: '/b' }]);
});

test('updateTask never changes id; unknown task → NotFound throw', () => {
  const b = m.updateTask(baseBoard(), 'T1', { id: 'HACKED', title: 'x' });
  const t = b.tasks.find((x: AnyBoard) => x.title === 'x');
  assert.equal(t.id, 'T1', 'id is immutable via updateTask');
  assert.throws(
    () => m.updateTask(baseBoard(), 'NOPE', { title: 'x' }),
    (e: any) => e.errKind === 'NotFound',
  );
});

test('recordTaskReviewVerdict requires an explicit gate and validates the verdict', () => {
  let b = m.addTask(baseBoard(), { id: 'R1', reviewGate: 'APPROVE' });
  b = m.recordTaskReviewVerdict(b, 'R1', 'REQUEST-CHANGES');
  assert.equal(b.tasks.find((x: AnyBoard) => x.id === 'R1').review_verdict, 'REQUEST-CHANGES');
  assert.throws(
    () => m.recordTaskReviewVerdict(baseBoard(), 'T1', 'APPROVE'),
    (e: any) => e.errKind === 'Validation' && /review gate/i.test(e.message),
  );
  assert.throws(
    () =>
      m.recordTaskReviewVerdict(
        m.addTask(baseBoard(), { id: 'R1', reviewGate: 'APPROVE' }),
        'R1',
        'MAYBE',
      ),
    (e: any) => e.errKind === 'Validation' && /review verdict/i.test(e.message),
  );
});

function completedReview(verdict: unknown): AnyBoard {
  const b = baseBoard();
  b.tasks = [
    {
      id: 'R1',
      status: 'done',
      deps: [],
      dependency_gate: { kind: 'review', required_verdict: 'APPROVE' },
      review_verdict: verdict,
      verified: true,
      artifact: '/abs/review-v1.md',
      finished_at: '2026-07-13T01:00:00Z',
    },
  ];
  return b;
}

test('every named retry boundary clears attempt-scoped review verdicts, including malformed legacy residue', () => {
  for (const from of ['stale', 'failed', 'escalated']) {
    for (const verdict of ['APPROVE', 'REQUEST-CHANGES', '', null]) {
      const input = completedReview(verdict);
      input.tasks[0].status = from;
      const next = m.transition(input, 'R1', 'ready', {});
      assert.equal(
        Object.hasOwn(next.tasks[0], 'review_verdict'),
        false,
        `${from}→ready must clear prior ${String(verdict)} verdict`,
      );
      assert.equal(input.tasks[0].review_verdict, verdict, 'transition remains pure');
    }
  }
});

test('APPROVE → stale → ready → in_flight → done without a new verdict cannot reuse old approval', () => {
  let b = completedReview('APPROVE');
  b = m.transition(b, 'R1', 'stale', {});
  assert.equal(b.tasks[0].review_verdict, 'APPROVE', 'stale still describes the old attempt');
  b = m.transition(b, 'R1', 'ready', {});
  assert.equal(
    b.tasks[0].review_verdict,
    undefined,
    'new attempt starts without a current verdict',
  );
  b = m.transition(b, 'R1', 'in_flight', {});
  b = m.transition(b, 'R1', 'done', {});
  assert.equal(b.tasks[0].review_verdict, undefined, 'done writer cannot resurrect prior approval');
});

// ── transition ───────────────────────────────────────────────────────────────────────────────────
test('transition ready→in_flight stamps started_at (legal)', () => {
  const orig = baseBoard();
  const snap = snapshot(orig);
  const b = m.transition(orig, 'T1', 'in_flight', {});
  const t = b.tasks.find((x: AnyBoard) => x.id === 'T1');
  assert.equal(t.status, 'in_flight');
  assert.ok(ISO.test(t.started_at), 'started_at stamped');
  assert.equal(snapshot(orig), snap, 'input untouched');
});

test('transition in_flight→done stamps finished_at (legal)', () => {
  let b = m.transition(baseBoard(), 'T1', 'in_flight', {});
  b = m.transition(b, 'T1', 'done', {});
  const t = b.tasks.find((x: AnyBoard) => x.id === 'T1');
  assert.equal(t.status, 'done');
  assert.ok(ISO.test(t.finished_at), 'finished_at stamped');
});

test('transition illegal (done→in_flight) throws .errKind=IllegalTransition listing legal next', () => {
  assert.throws(
    () => m.transition(baseBoard(), 'T0', 'in_flight', {}), // T0 is done; done→in_flight illegal
    (e: any) => {
      assert.equal(e.errKind, 'IllegalTransition');
      assert.match(e.message, /done/);
      assert.match(e.message, /stale/, 'lists legal next (done→stale)');
      return true;
    },
  );
});

test('transition illegal with {force:true} is allowed (越闸)', () => {
  const b = m.transition(baseBoard(), 'T0', 'in_flight', { force: true });
  const t = b.tasks.find((x: AnyBoard) => x.id === 'T0');
  assert.equal(t.status, 'in_flight', 'force bypasses isLegalTransition');
});

test('transition idempotent from===to is legal (no throw)', () => {
  const b = m.transition(baseBoard(), 'T1', 'ready', {});
  assert.equal(b.tasks.find((x: AnyBoard) => x.id === 'T1').status, 'ready');
});

test('transition unknown task → NotFound', () => {
  assert.throws(
    () => m.transition(baseBoard(), 'NOPE', 'done', {}),
    (e: any) => e.errKind === 'NotFound',
  );
});

test('retryTask stale→ready archives prior evidence and resets the current attempt atomically', () => {
  const orig = baseBoard();
  const t0 = orig.tasks.find((x: AnyBoard) => x.id === 'T0');
  t0.started_at = '2019-12-31T23:00:00Z';
  t0.artifact = '/abs/old.md';
  t0.verified = true;
  const stale = m.transition(orig, 'T0', 'stale', {});
  const retried = m.retryTask(stale, 'T0');
  const task = retried.tasks.find((x: AnyBoard) => x.id === 'T0');

  assert.equal(task.status, 'ready');
  assert.equal(task.started_at, undefined);
  assert.equal(task.finished_at, undefined);
  assert.equal(task.artifact, undefined);
  assert.equal(task.verified, false);
  assert.equal(typeof task.verified, 'boolean', 'verified reset is typed, never string "false"');

  const entry = retried.log.at(-1);
  assert.equal(entry.kind, 'replan');
  assert.equal(entry.task, 'T0');
  const detail = JSON.parse(entry.detail);
  assert.equal(detail.schema, 'ccm/task-retry/v1');
  assert.equal(detail.from_status, 'stale');
  assert.deepEqual(detail.prior_evidence, {
    started_at: '2019-12-31T23:00:00Z',
    finished_at: '2020-01-01T00:00:00Z',
    artifact: '/abs/old.md',
    verified: true,
  });
  assert.equal(snapshot(stale).includes('/abs/old.md'), true, 'input board remains untouched');
});

test('generic legal stale→ready transition shares retry reset semantics before start', () => {
  const orig = baseBoard();
  const t0 = orig.tasks.find((x: AnyBoard) => x.id === 'T0');
  t0.artifact = '/abs/old.md';
  t0.verified = true;
  let board = m.transition(orig, 'T0', 'stale', {});
  board = m.transition(board, 'T0', 'ready', {});
  board = m.transition(board, 'T0', 'in_flight', {});
  const task = board.tasks.find((x: AnyBoard) => x.id === 'T0');
  assert.equal(task.status, 'in_flight');
  assert.match(task.started_at, ISO);
  assert.equal(task.finished_at, undefined);
  assert.equal(task.artifact, undefined);
  assert.equal(task.verified, false);
  assert.equal(board.log.filter((entry: AnyBoard) => entry.task === 'T0').length, 1);
});

test('retryTask rejects non-retryable statuses and leaves ordinary first start/done unchanged', () => {
  assert.throws(
    () => m.retryTask(baseBoard(), 'T1'),
    (e: any) => e.errKind === 'IllegalTransition' && /ready/.test(e.message),
  );

  let board = m.transition(baseBoard(), 'T1', 'in_flight', {});
  board = m.transition(board, 'T1', 'done', {});
  const task = board.tasks.find((x: AnyBoard) => x.id === 'T1');
  assert.equal(task.status, 'done');
  assert.match(task.started_at, ISO);
  assert.match(task.finished_at, ISO);
  assert.equal(board.log.length, 0, 'ordinary first attempt emits no retry audit');
});

test('routing contract dedicated writers bind selection + immutable attempt snapshot + handle claim atomically', () => {
  let board = baseBoard();
  board.tasks.find((task: AnyBoard) => task.id === 'T1').executor = 'subagent';
  board.tasks.find((task: AnyBoard) => task.id === 'T1').estimate = { value: 1, unit: 'h' };
  board = m.setTaskPlanning(board, 'T1', routedPlanning());
  board = m.setTaskRoutingPolicy(board, 'T1', routedPolicy());
  board = m.bindTaskRoute(board, 'T1', {
    selection: routeSelection(),
    attempt: {
      id: 'A1',
      candidate_id: 'codex-cli',
      state: 'running',
      started_at: '2026-07-10T08:01:01Z',
      handle: 'run://codex/A1',
      requested: { model: 'gpt-future', effort: 'high' },
    },
  });
  const task = board.tasks.find((entry: AnyBoard) => entry.id === 'T1');
  assert.equal(task.status, 'in_flight');
  assert.equal(task.handle, 'run://codex/A1');
  assert.deepEqual(task.routing.selected, routeSelection());
  assert.deepEqual(task.routing.attempts[0].selection_snapshot, routeSelection());
});

test('route bind rejects an empty handle claim and never mutates input', () => {
  let board = baseBoard();
  board.tasks.find((task: AnyBoard) => task.id === 'T1').executor = 'subagent';
  board.tasks.find((task: AnyBoard) => task.id === 'T1').estimate = { value: 1, unit: 'h' };
  board = m.setTaskPlanning(board, 'T1', routedPlanning());
  board = m.setTaskRoutingPolicy(board, 'T1', routedPolicy());
  const before = snapshot(board);
  assert.throws(
    () =>
      m.bindTaskRoute(board, 'T1', {
        selection: routeSelection(),
        attempt: {
          id: 'A1',
          candidate_id: 'codex-cli',
          state: 'running',
          started_at: '2026-07-10T08:01:01Z',
          handle: '',
        },
      }),
    (error: any) => error.errKind === 'Validation' && /handle/.test(error.message),
  );
  assert.equal(snapshot(board), before);
});

test('contract-enabled routed start cannot bypass bind gate, even with force or initial in_flight add', () => {
  const board = baseBoard();
  board.meta.contracts = {
    task_planning: 'ccm/task-planning/v1',
    agent_routing: 'ccm/agent-routing/v1',
    agent_routing_activated_at: '2026-07-10T08:00:00Z',
    agent_routing_grandfathered_terminal: [],
  };
  board.tasks.find((task: AnyBoard) => task.id === 'T1').executor = 'subagent';
  assert.throws(
    () => m.transition(board, 'T1', 'in_flight', { force: true }),
    (error: any) => error.errKind === 'Validation' && /route-bind/.test(error.message),
  );
  assert.throws(
    () => m.addTask(board, { id: 'NEW', status: 'in_flight', executor: 'subagent' }),
    (error: any) => error.errKind === 'Validation' && /route-bind/.test(error.message),
  );
});

test('generic setters and updateTask cannot overwrite dedicated planning/routing/contract/handle paths', () => {
  const board = baseBoard();
  assert.throws(() => m.applySetJson(board, 'tasks[T1].planning', routedPlanning()));
  assert.throws(() => m.applySetJson(board, 'tasks[T1].routing', {}));
  assert.throws(() =>
    m.applySetJson(board, 'meta.contracts', {
      task_planning: 'ccm/task-planning/v1',
    }),
  );
  assert.throws(() => m.updateTask(board, 'T1', { planning: routedPlanning() }));

  const enabled = structuredClone(board);
  enabled.meta.contracts = {
    task_planning: 'ccm/task-planning/v1',
    agent_routing: 'ccm/agent-routing/v1',
    agent_routing_activated_at: '2026-07-10T08:00:00Z',
    agent_routing_grandfathered_terminal: [],
  };
  enabled.tasks.find((task: AnyBoard) => task.id === 'T1').executor = 'subagent';
  assert.throws(
    () => m.applySetJson(enabled, 'meta', { template_version: 3 }),
    (error: any) => error.errKind === 'Validation' && /dedicated/.test(error.message),
    'an ancestor replacement must not erase meta.contracts activation',
  );
  assert.throws(
    () => m.applySetJson(enabled, 'meta.contracts', {}),
    (error: any) => error.errKind === 'Validation' && /dedicated/.test(error.message),
  );
  assert.throws(() => m.updateTask(enabled, 'T1', { handle: 'fake' }));
  assert.throws(() => m.applySet(enabled, 'tasks[T1].handle', 'fake'));
});

test('contract executor is mutation-frozen and the subagent→user→start→subagent attack never persists', () => {
  const enabled = baseBoard();
  enabled.meta.contracts = {
    task_planning: 'ccm/task-planning/v1',
    agent_routing: 'ccm/agent-routing/v1',
    agent_routing_activated_at: '2026-07-10T08:00:00Z',
    agent_routing_grandfathered_terminal: [],
  };
  const routed = enabled.tasks.find((task: AnyBoard) => task.id === 'T1');
  routed.executor = 'subagent';

  assert.throws(
    () => m.updateTask(enabled, 'T1', { executor: 'master-orchestrator' }),
    (error: any) => error.errKind === 'Validation' && /executor/.test(error.message),
    'the first disguise step is blocked once contracts are active',
  );
  assert.throws(
    () => m.applySet(enabled, 'tasks[T1].executor', 'master-orchestrator'),
    (error: any) => error.errKind === 'Validation' && /executor/.test(error.message),
    'generic setters cannot provide a second executor mutation path',
  );

  const disguised = structuredClone(enabled);
  disguised.tasks.find((task: AnyBoard) => task.id === 'T1').executor = 'master-orchestrator';
  const flying = m.transition(disguised, 'T1', 'in_flight', { force: true });
  assert.throws(
    () => m.updateTask(flying, 'T1', { executor: 'subagent' }),
    (error: any) => error.errKind === 'Validation' && /executor|route-bind/.test(error.message),
    'the final reclassification step is blocked even if hostile state predates this mutation',
  );
  assert.throws(
    () => m.addTask(enabled, { id: 'NEW', status: 'ready', executor: 'subagent' }),
    (error: any) =>
      error.errKind === 'Validation' && /executor|planning|routing/.test(error.message),
    'new active-contract subagents must be prepared before executor assignment',
  );
});

test('a prepared ready task may become subagent exactly once under the active contract', () => {
  let board = baseBoard();
  board.meta.contracts = {
    task_planning: 'ccm/task-planning/v1',
    agent_routing: 'ccm/agent-routing/v1',
    agent_routing_activated_at: '2026-07-10T08:00:00Z',
    agent_routing_grandfathered_terminal: [],
  };
  board.tasks.find((task: AnyBoard) => task.id === 'T1').executor = 'master-orchestrator';
  board.tasks.find((task: AnyBoard) => task.id === 'T1').estimate = { value: 1, unit: 'h' };
  board = m.setTaskPlanning(board, 'T1', routedPlanning());
  board = m.setTaskRoutingPolicy(board, 'T1', routedPolicy());
  const next = m.updateTask(board, 'T1', { executor: 'subagent' });
  assert.equal(next.tasks.find((task: AnyBoard) => task.id === 'T1').executor, 'subagent');
});

test('enableRoutingContracts grandfathers exact historical terminal fingerprints; retry loses exemption', () => {
  const board = baseBoard();
  const done = board.tasks.find((task: AnyBoard) => task.id === 'T0');
  done.executor = 'subagent';
  done.created_at = '2026-07-01T08:00:00Z';
  const active = board.tasks.find((task: AnyBoard) => task.id === 'T1');
  active.executor = 'master-orchestrator';

  const enabled = m.enableRoutingContracts(board);
  assert.deepEqual(enabled.meta.contracts.agent_routing_grandfathered_terminal, [
    { task_id: 'T0', created_at: '2026-07-01T08:00:00Z' },
  ]);
  const retried = m.transition(m.transition(enabled, 'T0', 'stale', {}), 'T0', 'ready', {});
  assert.throws(
    () => m.transition(retried, 'T0', 'in_flight', { force: true }),
    (error: any) => error.errKind === 'Validation' && /route-bind/.test(error.message),
  );
});

// ── blockTask ────────────────────────────────────────────────────────────────────────────────────
test('blockTask sets status=blocked + blocked_on; carries decision_package', () => {
  const dp = { ask_type: 'decision', context_md: '...', what_i_need: '...' };
  const b = m.blockTask(baseBoard(), 'T1', { on: 'user', decisionPackage: dp });
  const t = b.tasks.find((x: AnyBoard) => x.id === 'T1');
  assert.equal(t.status, 'blocked');
  assert.equal(t.blocked_on, 'user');
  assert.deepEqual(t.decision_package, dp);
});

test('blockTask on a task id (non-user) — no decision_package required at this layer', () => {
  const b = m.blockTask(baseBoard(), 'T1', { on: 'T0' });
  const t = b.tasks.find((x: AnyBoard) => x.id === 'T1');
  assert.equal(t.status, 'blocked');
  assert.equal(t.blocked_on, 'T0');
  assert.equal(t.decision_package, undefined);
});

// ── unblockTask ──────────────────────────────────────────────────────────────────────────────────
test('unblockTask clears blocked_on + decision_package; does NOT set status (reconcile owns it)', () => {
  let b = m.blockTask(baseBoard(), 'T1', {
    on: 'user',
    decisionPackage: { ask_type: 'advice' },
  });
  b = m.unblockTask(b, 'T1');
  const t = b.tasks.find((x: AnyBoard) => x.id === 'T1');
  assert.equal(t.blocked_on, undefined);
  assert.equal(t.decision_package, undefined);
  assert.equal(
    t.status,
    'blocked',
    'mutation leaves status as-is; reconcileGating (write关卡) 定 ready/blocked',
  );
});

test('unblockTask on missing id → NotFound', () => {
  assert.throws(
    () => m.unblockTask(baseBoard(), 'NOPE'),
    (e: unknown) => {
      return (e as { errKind?: string }).errKind === 'NotFound';
    },
  );
});

test('unblockTask is pure (input board untouched)', () => {
  const orig = m.blockTask(baseBoard(), 'T1', { on: 'user' });
  const snap = snapshot(orig);
  m.unblockTask(orig, 'T1');
  assert.deepEqual(snapshot(orig), snap);
});

// ── appendLog ────────────────────────────────────────────────────────────────────────────────────
test('appendLog appends an entry with ts stamped; append-only; pure', () => {
  const orig = baseBoard();
  const snap = snapshot(orig);
  const b = m.appendLog(orig, { summary: 'did a thing', kind: 'decision', task: 'T1' });
  assert.equal(b.log.length, 1);
  const e = b.log[0];
  assert.ok(ISO.test(e.ts), 'ts stamped');
  assert.equal(e.summary, 'did a thing');
  assert.equal(e.kind, 'decision');
  assert.equal(e.task, 'T1');
  assert.equal(snapshot(orig), snap, 'input untouched');
});

// ── jc ───────────────────────────────────────────────────────────────────────────────────────────
test('addJc appends a judgment_call with status pending_review + raised_at stamped', () => {
  const b = m.addJc(baseBoard(), {
    id: 'J1',
    summary: 'chose X over Y',
    category: 'architecture',
    severity: 'high',
    decision: 'adopt X',
    rationale: 'standard',
    impact: 'wide',
    refs: ['commit abc'],
    task_ref: 'T0',
  });
  assert.equal(b.judgment_calls.length, 1);
  const jc = b.judgment_calls[0];
  assert.equal(jc.id, 'J1');
  assert.equal(jc.status, 'pending_review');
  assert.equal(jc.category, 'architecture');
  assert.equal(jc.severity, 'high');
  assert.equal(jc.task_ref, 'T0');
  assert.ok(ISO.test(jc.raised_at));
});

test('resolveJc sets status upheld/overturned + note; unknown → NotFound', () => {
  let b = m.addJc(baseBoard(), {
    id: 'J1',
    summary: 's',
    category: 'architecture',
    severity: 'low',
  });
  b = m.resolveJc(b, 'J1', { status: 'upheld', note: 'kept' });
  const jc = b.judgment_calls[0];
  assert.equal(jc.status, 'upheld');
  assert.equal(jc.note, 'kept');
  assert.ok(ISO.test(jc.resolved_at));
  assert.throws(
    () => m.resolveJc(b, 'NOPE', { status: 'upheld' }),
    (e: any) => e.errKind === 'NotFound',
  );
});

// ── cadence ──────────────────────────────────────────────────────────────────────────────────────
test('cadenceUpdate sets target={ship_every,min_unit}', () => {
  const b = m.cadenceUpdate(baseBoard(), { shipEvery: '3h', minUnit: '1 PR' });
  assert.deepEqual(b.cadence.target, { ship_every: '3h', min_unit: '1 PR' });
});

test('cadenceOpen opens an iteration {id, started_at, status:open, goal, deadline, members}', () => {
  const b = m.cadenceOpen(baseBoard(), 'I1', {
    goal: 'ship slice',
    deadline: '2026-06-05T14:00:00Z',
    members: ['T0', 'T1'],
  });
  assert.equal(b.cadence.iterations.length, 1);
  const it = b.cadence.iterations[0];
  assert.equal(it.id, 'I1');
  assert.equal(it.status, 'open');
  assert.equal(it.goal, 'ship slice');
  assert.equal(it.deadline, '2026-06-05T14:00:00Z');
  assert.deepEqual(it.members, ['T0', 'T1']);
  assert.ok(ISO.test(it.started_at));
});

test('cadenceShip sets status=shipped WITHOUT checking member completeness (that is lint BIZ-CADENCE-SHIPPED)', () => {
  // members reference non-existent / unverified tasks — mutations must NOT enforce; only set status.
  let b = m.cadenceOpen(baseBoard(), 'I1', { members: ['T1'] }); // T1 is ready, not done+verified
  b = m.cadenceShip(b, 'I1', {});
  const it = b.cadence.iterations[0];
  assert.equal(
    it.status,
    'shipped',
    'mutations only flips status; member completeness is lint job',
  );
  assert.ok(ISO.test(it.shipped_at));
});

test('cadenceShip unknown iteration → NotFound', () => {
  assert.throws(
    () => m.cadenceShip(baseBoard(), 'NOPE', {}),
    (e: any) => e.errKind === 'NotFound',
  );
  assert.throws(
    () => m.cadenceOpen(baseBoard(), 'I1', {}) && m.cadenceShip(baseBoard(), 'I1', {}),
    (e: any) => e.errKind === 'NotFound',
  );
});

// ── watchdog ─────────────────────────────────────────────────────────────────────────────────────
test('watchdogArm writes full object {armed_at, fire_at, mechanism, job_id, checklist}', () => {
  const b = m.watchdogArm(baseBoard(), {
    fireAt: '2026-06-24T13:00:00Z',
    mechanism: 'cron',
    jobId: 'job-1',
    checklist: ['drain'],
  });
  assert.ok(ISO.test(b.watchdog.armed_at));
  assert.equal(b.watchdog.fire_at, '2026-06-24T13:00:00Z');
  assert.equal(b.watchdog.mechanism, 'cron');
  assert.equal(b.watchdog.job_id, 'job-1');
  assert.deepEqual(b.watchdog.checklist, ['drain']);
});

test('watchdogDisarm nulls the whole object (no残骸)', () => {
  let b = m.watchdogArm(baseBoard(), { fireAt: '2026-06-24T13:00:00Z', mechanism: 'cron' });
  b = m.watchdogDisarm(b);
  assert.equal(b.watchdog, null);
});

// ── applySet / applySetJson — 🔒 守门 + ✎ 放行 ─────────────────────────────────────────────────────
test('applySet sets a flexible board-level field (✎)', () => {
  const orig = baseBoard();
  const snap = snapshot(orig);
  const b = m.applySet(orig, 'meta.template_version', 9); // meta is ✎
  assert.equal(b.meta.template_version, 9);
  assert.equal(snapshot(orig), snap, 'input untouched');
});

test('applySet sets a flexible task field via tasks[<id>].field', () => {
  const b = m.applySet(baseBoard(), 'tasks[T1].hitl_rounds', 2); // hitl_rounds is ✎
  assert.equal(b.tasks.find((x: AnyBoard) => x.id === 'T1').hitl_rounds, 2);
});

test('applySet sets a flexible task field via tasks.<id>.field (dot form)', () => {
  const b = m.applySet(baseBoard(), 'tasks.T1.hitl_rounds', 5);
  assert.equal(b.tasks.find((x: AnyBoard) => x.id === 'T1').hitl_rounds, 5);
});

test('applySet creates intermediate objects for nested ✎ dotpath', () => {
  const b = m.applySet(baseBoard(), 'tasks[T1].observability.source', 'task-notification');
  assert.equal(
    b.tasks.find((x: AnyBoard) => x.id === 'T1').observability.source,
    'task-notification',
  );
});

test('applySet REFUSES board 🔒 fields (schema/goal/owner/git/tasks) with errKind=Validation', () => {
  for (const p of ['schema', 'goal', 'owner.active', 'owner.session_id', 'git.branch', 'tasks']) {
    assert.throws(
      () => m.applySet(baseBoard(), p, 'x'),
      (e: any) => {
        assert.equal(e.errKind, 'Validation', `${p} → Validation`);
        return true;
      },
      `applySet must refuse load-bearing board path "${p}"`,
    );
  }
});

test('applySet REFUSES task 🔒 fields (id/status/deps/parent) with errKind=Validation', () => {
  for (const p of [
    'tasks[T1].id',
    'tasks[T1].status',
    'tasks[T1].deps',
    'tasks[T1].parent',
    'tasks.T1.status',
  ]) {
    assert.throws(
      () => m.applySet(baseBoard(), p, 'x'),
      (e: any) => {
        assert.equal(e.errKind, 'Validation', `${p} → Validation`);
        return true;
      },
      `applySet must refuse load-bearing task path "${p}"`,
    );
  }
});

test('applySet refuses replacing a whole task object (tasks[<id>]) — Validation', () => {
  assert.throws(
    () => m.applySet(baseBoard(), 'tasks[T1]', { id: 'T1' }),
    (e: any) => e.errKind === 'Validation',
  );
});

test('applySet on unknown task id throws NotFound (after 🔒 gate passes)', () => {
  assert.throws(
    () => m.applySet(baseBoard(), 'tasks[NOPE].hitl_rounds', 1),
    (e: any) => e.errKind === 'NotFound',
  );
});

test('applySet invalid/empty dotpath → Validation', () => {
  assert.throws(
    () => m.applySet(baseBoard(), '', 'x'),
    (e: any) => e.errKind === 'Validation',
  );
});

test('applySetJson parses JSON string into a flexible field', () => {
  const b = m.applySetJson(baseBoard(), 'tasks[T1].output_schema', '{"type":"object","ok":true}');
  assert.deepEqual(b.tasks.find((x: AnyBoard) => x.id === 'T1').output_schema, {
    type: 'object',
    ok: true,
  });
});

test('applySetJson accepts an already-parsed object/array', () => {
  const b = m.applySetJson(baseBoard(), 'tasks[T1].dep_pins', { T0: 'sha256:abc' });
  assert.deepEqual(b.tasks.find((x: AnyBoard) => x.id === 'T1').dep_pins, { T0: 'sha256:abc' });
});

test('applySetJson bad JSON string → Validation', () => {
  assert.throws(
    () => m.applySetJson(baseBoard(), 'meta.x', '{bad json'),
    (e: any) => e.errKind === 'Validation',
  );
});

test('applySetJson honors 🔒 gate too (refuses deps)', () => {
  assert.throws(
    () => m.applySetJson(baseBoard(), 'tasks[T1].deps', '["X"]'),
    (e: any) => e.errKind === 'Validation',
  );
});

// ── applySet / applySetJson 的 defaultTaskId scoping（Finding #83·task verb 语境）──────────────────
test('applySet with defaultTaskId: bare dotpath lands on THAT task (not board top-level)', () => {
  const b = m.applySet(baseBoard(), 'hitl_rounds', 3, { defaultTaskId: 'T1' });
  assert.equal(b.tasks.find((x: AnyBoard) => x.id === 'T1').hitl_rounds, 3, '落在 task 上');
  assert.equal(b.hitl_rounds, undefined, 'board 顶层不被污染');
});

test('applySet with defaultTaskId: explicit tasks[<其它id>].field prefix still targets that task', () => {
  const b = m.applySet(baseBoard(), 'tasks[T0].hitl_rounds', 7, { defaultTaskId: 'T1' });
  assert.equal(b.tasks.find((x: AnyBoard) => x.id === 'T0').hitl_rounds, 7, '显式前缀优先');
  assert.equal(b.tasks.find((x: AnyBoard) => x.id === 'T1').hitl_rounds, undefined);
});

test('applySet with defaultTaskId: bare 🔒 task field (status/deps/parent/id) REFUSED (no silent junk)', () => {
  for (const p of ['status', 'deps', 'parent', 'id']) {
    assert.throws(
      () => m.applySet(baseBoard(), p, 'x', { defaultTaskId: 'T1' }),
      (e: any) => e.errKind === 'Validation',
      `bare "${p}" in task scope must be refused (曾静默落 board 顶层 junk)`,
    );
  }
});

test('applySetJson with defaultTaskId: bare dotpath lands the JSON on that task', () => {
  const b = m.applySetJson(baseBoard(), 'decision_package', '{"q":"?"}', {
    defaultTaskId: 'T1',
  });
  assert.deepEqual(b.tasks.find((x: AnyBoard) => x.id === 'T1').decision_package, { q: '?' });
});

test('applySet without defaultTaskId: bare dotpath still lands board top-level (board update 语境)', () => {
  const b = m.applySet(baseBoard(), 'notes', 'hello');
  assert.equal(b.notes, 'hello');
});

test('logicalSetPath: 归一化逻辑落点（回显用）', () => {
  assert.equal(m.logicalSetPath('foo.bar', { defaultTaskId: 'T1' }), 'tasks[T1].foo.bar');
  assert.equal(m.logicalSetPath('tasks[T0].foo', { defaultTaskId: 'T1' }), 'tasks[T0].foo');
  assert.equal(m.logicalSetPath('tasks.T0.foo', { defaultTaskId: 'T1' }), 'tasks[T0].foo');
  assert.equal(m.logicalSetPath('foo.bar'), 'foo.bar');
});

// ── boardSetParam（ADR-020·hook-owned runtime 参数区·白名单 + 值校验）─────────────────────────────────
test('boardSetParam: 白名单 key + 合法 ISO → 写 runtime.<key> + stamp heartbeat', () => {
  const b = baseBoard();
  const out = m.boardSetParam(b, { key: 'last_identity_remind', value: '2026-06-29T12:34:56Z' });
  assert.equal(out.runtime.last_identity_remind, '2026-06-29T12:34:56Z');
  assert.ok(ISO.test(out.owner.heartbeat), 'heartbeat stamped');
  assert.notEqual(out, b, '返回新对象');
});

test('boardSetParam: 已有 runtime 时只覆写该 key（不抹其它键）', () => {
  const b = baseBoard();
  b.runtime = { some_future_hook_key: 'keep-me' };
  const out = m.boardSetParam(b, { key: 'last_identity_remind', value: '2026-06-29T00:00:00Z' });
  assert.equal(out.runtime.last_identity_remind, '2026-06-29T00:00:00Z');
  assert.equal(out.runtime.some_future_hook_key, 'keep-me', '其它键保留');
});

// last_critpath_remind 是 runtime 白名单第二成员（critpath-nudge·hooks-enhancements-v2 ②）。
test('boardSetParam: last_critpath_remind 白名单 key + 合法 ISO → 写 runtime.last_critpath_remind', () => {
  const b = baseBoard();
  const out = m.boardSetParam(b, { key: 'last_critpath_remind', value: '2026-06-30T08:00:00Z' });
  assert.equal(out.runtime.last_critpath_remind, '2026-06-30T08:00:00Z');
  assert.ok(ISO.test(out.owner.heartbeat), 'heartbeat stamped');
});

test('boardSetParam: last_critpath_remind 与 last_identity_remind 共存不互抹', () => {
  const b = baseBoard();
  b.runtime = { last_identity_remind: '2026-06-29T00:00:00Z' };
  const out = m.boardSetParam(b, { key: 'last_critpath_remind', value: '2026-06-30T08:00:00Z' });
  assert.equal(out.runtime.last_critpath_remind, '2026-06-30T08:00:00Z');
  assert.equal(out.runtime.last_identity_remind, '2026-06-29T00:00:00Z', 'identity key 保留');
});

test('boardSetParam: last_critpath_remind 非法 ISO 值 → throw .errKind=Usage（exit 2）', () => {
  const b = baseBoard();
  assert.throws(
    () => m.boardSetParam(b, { key: 'last_critpath_remind', value: 'not-iso' }),
    (e: any) => {
      assert.equal(e.errKind, 'Usage');
      return /ISO/.test(e.message);
    },
  );
});

test('boardSetParam: stop_allow_until 白名单 key + 合法 ISO → 写 runtime.stop_allow_until', () => {
  const b = baseBoard();
  const out = m.boardSetParam(b, { key: 'stop_allow_until', value: '2026-07-03T15:30:00Z' });
  assert.equal(out.runtime.stop_allow_until, '2026-07-03T15:30:00Z');
  assert.ok(ISO.test(out.owner.heartbeat), 'heartbeat stamped');
});

test('boardSetParam: 非白名单 key → throw .errKind=Usage（exit 2）', () => {
  const b = baseBoard();
  assert.throws(
    () => m.boardSetParam(b, { key: 'bogus_key', value: 'x' }),
    (e: any) => {
      assert.equal(e.errKind, 'Usage');
      return /白名单/.test(e.message);
    },
  );
});

test('boardSetParam: 白名单 key 但非法 ISO 值 → throw .errKind=Usage（exit 2）', () => {
  const b = baseBoard();
  assert.throws(
    () => m.boardSetParam(b, { key: 'last_identity_remind', value: 'not-iso' }),
    (e: any) => {
      assert.equal(e.errKind, 'Usage');
      return /ISO/.test(e.message);
    },
  );
});

test('boardSetParam: runtime 是 ✎ 非窄腰——绝不触碰 🔒 字段（owner/goal/tasks 原样）', () => {
  const b = baseBoard();
  const out = m.boardSetParam(b, { key: 'last_identity_remind', value: '2026-06-29T12:34:56Z' });
  assert.equal(out.goal, b.goal);
  assert.equal(out.tasks.length, b.tasks.length);
  assert.equal(out.owner.session_id, b.owner.session_id);
});

// ── 纯函数纪律全覆盖：每个 mutator 都不 alias / 不原地改输入 ─────────────────────────────────────────
test('all mutators stamp heartbeat and leave input board structurally untouched', () => {
  const probes: ((b: AnyBoard) => AnyBoard)[] = [
    (b) => m.boardUpdate(b, { goal: 'z' }),
    (b) => m.addTask(b, { id: 'NEW' }),
    (b) => m.updateTask(b, 'T1', { title: 'z' }),
    (b) => m.transition(b, 'T1', 'in_flight', {}),
    (b) => m.blockTask(b, 'T1', { on: 'T0' }),
    (b) => m.appendLog(b, { summary: 'z' }),
    (b) => m.addJc(b, { id: 'J', summary: 's', category: 'other', severity: 'low' }),
    (b) => m.cadenceUpdate(b, { shipEvery: '1h' }),
    (b) => m.cadenceOpen(b, 'I', {}),
    (b) => m.watchdogArm(b, { fireAt: '2026-06-24T13:00:00Z', mechanism: 'shell' }),
    (b) => m.watchdogDisarm(b),
    (b) => m.applySet(b, 'meta.x', 1),
  ];
  for (const fn of probes) {
    const orig = baseBoard();
    const snap = snapshot(orig);
    const out = fn(orig);
    assert.notEqual(out, orig, 'returns a new object');
    assert.ok(ISO.test(out.owner.heartbeat), 'heartbeat stamped on every write');
    assert.equal(snapshot(orig), snap, 'input board not mutated in place');
  }
});
