// board-model.test.ts — @ccm/engine·board v2 数据模型 keystone（单一真相源 SSOT）契约门。
//   T1 port：从 cli/test/unit/board-model.test.mjs 移植，CJS createRequire 加载改为对 ported TS 源的 ESM import。
//   原 UMD/IIFE 浏览器形态断言（globalThis.__ccmBoardModel + 顶层零泄漏）已删——TS 引擎不再有 UMD 尾，
//   浏览器形态改由 tsdown 的单个 IIFE 产物（globalThis.__ccmEngine）承接，那条契约在 board-iife.test.ts 守。

import assert from 'node:assert/strict';
import { test } from 'node:test';
// 测 build 后的 dist 公开 API barrel（@ccm/engine 的实际 shipped 面）。源用 NodeNext `.js` specifier
//   跨模块 import，node 原生 type-stripping 不把 `.js`→`.ts` 重映射，故直跑 .ts 源对有内部依赖的模块解析
//   不了——按任务「退而对 build 后的 dist 测」走 dist barrel（三道门顺序 build→typecheck→test 保证 dist 在）。
import * as M from '../dist/index.mjs';

// ── schema 版本锚 ────────────────────────────────────────────────────────────────────────────────
test('SCHEMA_VERSION is the v2 literal', () => {
  assert.equal(M.SCHEMA_VERSION, 'cc-master/v2');
});

// ── ENUMS：全部命名枚举一处定义 ──────────────────────────────────────────────────────────────────
test('ENUMS defines every named enum with the agreed members', () => {
  assert.ok(M.ENUMS && typeof M.ENUMS === 'object');
  assert.deepEqual(
    [...M.ENUMS.status].sort(),
    ['blocked', 'done', 'escalated', 'failed', 'in_flight', 'ready', 'stale', 'uncertain'].sort(),
  );
  assert.deepEqual(
    [...M.ENUMS.executor].sort(),
    ['external', 'master-orchestrator', 'subagent', 'user', 'workflow'].sort(),
  );
  assert.deepEqual(
    [...M.ENUMS.taskType].sort(),
    [
      'acceptance',
      'design',
      'development',
      'development-demo',
      'doc-alignment',
      'e2e-integration',
      'planning',
      'pr',
    ].sort(),
  );
  assert.deepEqual([...M.ENUMS.role].sort(), ['fill-work', 'normal'].sort());
  assert.deepEqual(
    [...M.ENUMS.refKind].sort(),
    ['code', 'doc', 'issue', 'other', 'plan', 'spec', 'web'].sort(),
  );
  assert.deepEqual([...M.ENUMS.askType].sort(), ['advice', 'decision', 'solution'].sort());
  assert.deepEqual(
    [...M.ENUMS.logKind].sort(),
    ['decision', 'dispatch', 'finding', 'handoff', 'note', 'recon', 'replan', 'verify'].sort(),
  );
  assert.deepEqual(
    [...M.ENUMS.jcCategory].sort(),
    ['architecture', 'drift', 'other', 'spec-impl-misalignment'].sort(),
  );
  assert.deepEqual([...M.ENUMS.jcSeverity].sort(), ['critical', 'high', 'low', 'medium'].sort());
  assert.deepEqual([...M.ENUMS.jcStatus].sort(), ['overturned', 'pending_review', 'upheld'].sort());
  assert.deepEqual([...M.ENUMS.iterationStatus].sort(), ['open', 'shipped'].sort());
  assert.deepEqual(
    [...M.ENUMS.watchdogMechanism].sort(),
    ['cron', 'loop', 'monitor', 'shell'].sort(),
  );
  assert.deepEqual(
    [...M.ENUMS.acceptanceKind].sort(),
    ['manual', 'metric', 'review', 'test'].sort(),
  );
  assert.deepEqual([...M.ENUMS.acceptanceStatus].sort(), ['failed', 'met', 'pending'].sort());
});

test('OPEN_ENUMS marks taskType + refKind as open (unknown value → warn, not hard fail)', () => {
  const open = new Set(M.OPEN_ENUMS);
  assert.ok(open.has('taskType'), 'taskType is open/extensible');
  assert.ok(open.has('refKind'), 'refKind is open/extensible');
  assert.ok(!open.has('status'), 'status is CLOSED (hard enum)');
  assert.ok(!open.has('executor'), 'executor is CLOSED (hard enum)');
});

test('isEnumMember checks membership for a named enum', () => {
  assert.equal(M.isEnumMember('status', 'in_flight'), true);
  assert.equal(M.isEnumMember('status', 'bogus'), false);
  assert.equal(M.isEnumMember('executor', 'external'), true);
  assert.equal(M.isEnumMember('executor', 'shell'), false); // shell 不再是 executor（并入前面几类）
});

// ── FIELDS：每字段六要素齐全（「完整建模」机械门）──────────────────────────────────────────────────
const SIX = ['tier', 'type', 'default', 'readers', 'writers', 'when', 'degrade'] as const;
const TIER_VALUES = new Set(['🔒', '👁', '✎']);

test('FIELDS models both board top-level and task entity', () => {
  assert.ok(M.FIELDS && M.FIELDS.board && M.FIELDS.task);
  // 11 顶层模块（spec §2.1）。
  for (const k of [
    'schema',
    'meta',
    'source',
    'goal',
    'owner',
    'git',
    'scheduling',
    'watchdog',
    'tasks',
    'log',
    'judgment_calls',
    'cadence',
  ]) {
    assert.ok(
      (M.FIELDS.board as Record<string, unknown>)[k],
      `board top-level field "${k}" is modeled`,
    );
  }
  // task 关键字段（spec §3.1）。
  for (const k of [
    'id',
    'status',
    'deps',
    'parent',
    'title',
    'acceptance',
    'references',
    'estimate',
    'executor',
    'type',
    'role',
    'verified',
    'artifact',
    'handle',
    'blocked_on',
    'decision_package',
    'created_at',
    'started_at',
    'finished_at',
    'wip_limit',
    'hitl_rounds',
    'observability',
  ]) {
    assert.ok((M.FIELDS.task as Record<string, unknown>)[k], `task field "${k}" is modeled`);
  }
});

test('every modeled field carries all six 要素 + a legal tier (完整 baseline, mechanical)', () => {
  for (const scope of ['board', 'task'] as const) {
    for (const [name, meta] of Object.entries(M.FIELDS[scope])) {
      for (const key of SIX) {
        assert.ok(
          (meta as Record<string, unknown>)[key] !== undefined &&
            (meta as Record<string, unknown>)[key] !== '',
          `FIELDS.${scope}.${name}.${key} must be defined & non-empty (六要素 completeness)`,
        );
      }
      assert.ok(
        TIER_VALUES.has(meta.tier),
        `FIELDS.${scope}.${name}.tier must be one of 🔒/👁/✎ (got ${JSON.stringify(meta.tier)})`,
      );
    }
  }
});

test('load-bearing (🔒) subset matches the narrow-waist red-line set', () => {
  const lb = Object.entries(M.FIELDS.board)
    .filter(([, m]) => m.tier === '🔒')
    .map(([k]) => k)
    .sort();
  // 红线2 真正保护的子集（spec §2.1 主档列）。
  assert.deepEqual(lb, ['git', 'goal', 'owner', 'schema', 'tasks'].sort());
  const lbTask = Object.entries(M.FIELDS.task)
    .filter(([, m]) => m.tier === '🔒')
    .map(([k]) => k)
    .sort();
  assert.deepEqual(lbTask, ['deps', 'id', 'parent', 'status'].sort());
});

// ── status 状态机 ────────────────────────────────────────────────────────────────────────────────
test('STATUS_MACHINE defines transitions for all 8 statuses + classifications', () => {
  assert.ok(M.STATUS_MACHINE && M.STATUS_MACHINE.transitions);
  for (const s of M.ENUMS.status) {
    assert.ok(
      Array.isArray(M.STATUS_MACHINE.transitions[s]),
      `transitions["${s}"] is an array (every status has an out-edge list, possibly empty)`,
    );
  }
  // 关键合法转移（spec §6）。
  assert.ok(M.isLegalTransition('ready', 'in_flight'));
  assert.ok(M.isLegalTransition('in_flight', 'done'));
  assert.ok(M.isLegalTransition('in_flight', 'uncertain'));
  assert.ok(M.isLegalTransition('uncertain', 'done'));
  assert.ok(M.isLegalTransition('done', 'stale'));
  assert.ok(M.isLegalTransition('failed', 'ready'));
  // 非法转移示例：done 不能直接回 in_flight（须先 stale 再 ready）。
  assert.equal(M.isLegalTransition('done', 'in_flight'), false);
});

test('isRetryTransition names every legal new-attempt boundary without widening the state machine', () => {
  assert.deepEqual(M.RETRYABLE_STATUSES, ['stale', 'failed', 'escalated']);
  for (const from of M.RETRYABLE_STATUSES) {
    assert.equal(M.isLegalTransition(from, 'ready'), true, `${from}→ready remains a legal edge`);
    assert.equal(M.isRetryTransition(from, 'ready'), true, `${from}→ready starts a new attempt`);
  }
  assert.equal(
    M.isRetryTransition('done', 'stale'),
    false,
    'marking old output stale is not a new attempt',
  );
  assert.equal(
    M.isRetryTransition('ready', 'in_flight'),
    false,
    'ordinary start is inside the new attempt',
  );
  assert.equal(
    M.isRetryTransition('blocked', 'ready'),
    false,
    'dependency unblocking is not a retry',
  );
});

// ── INVARIANTS 注册表：规则 id/级别/家族 的 SSOT（spec §5）─────────────────────────────────────────
test('INVARIANTS is a registry of {id, level, family, scope, summary}, ids unique', () => {
  assert.ok(Array.isArray(M.INVARIANTS) && M.INVARIANTS.length > 0);
  const seen = new Set<string>();
  const LEVELS = new Set(['hard', 'warn', 'reserved']);
  const FAMILIES = new Set(['FMT', 'GRAPH', 'BIZ']);
  for (const inv of M.INVARIANTS) {
    assert.ok(inv.id && !seen.has(inv.id), `invariant id "${inv.id}" is present & unique`);
    seen.add(inv.id);
    assert.ok(LEVELS.has(inv.level), `${inv.id}.level ∈ {hard,warn,reserved} (got ${inv.level})`);
    assert.ok(FAMILIES.has(inv.family), `${inv.id}.family ∈ {FMT,GRAPH,BIZ} (got ${inv.family})`);
    assert.ok(inv.scope, `${inv.id}.scope present`);
    assert.ok(inv.summary, `${inv.id}.summary present`);
  }
});

test('INVARIANTS catalog covers the key v2 rules at the agreed levels (spec §5)', () => {
  const lvl = (id: string) => M.levelOf(id);
  // FMT / GRAPH 硬。
  assert.equal(lvl('FMT-SCHEMA'), 'hard');
  assert.equal(lvl('FMT-STATUS'), 'hard');
  assert.equal(lvl('GRAPH-CYCLE'), 'hard');
  assert.equal(lvl('GRAPH-PARENT-DEPTH'), 'hard');
  // rollup 容瞬态 → warn。
  assert.equal(lvl('GRAPH-ROLLUP'), 'warn');
  // type 开放枚举 → warn。
  assert.equal(lvl('FMT-TYPE'), 'warn');
  // awaiting-user 必带 decision_package → hard（采访闭环机制保障）。
  assert.equal(lvl('BIZ-AWAITING'), 'hard');
  // cadence 收口完整性 → hard。
  assert.equal(lvl('BIZ-CADENCE-SHIPPED'), 'hard');
  assert.equal(lvl('BIZ-CADENCE-MISSING-ESTIMATE'), 'warn');
  assert.equal(lvl('BIZ-CADENCE-OVERBOOKED'), 'warn');
  assert.equal(lvl('BIZ-CADENCE-CRITICAL-PATH-OVER'), 'warn');
  assert.equal(lvl('BIZ-TASK-OVERSIZED-FOR-CADENCE'), 'warn');
  assert.equal(lvl('BIZ-AGILE-ACCEPTANCE-MISSING'), 'warn');
  assert.equal(lvl('BIZ-ESTIMATE-STALE'), 'warn');
  // 条件业务规则 → warn（BIZ-DEV-REFS 例外：development 缺 spec/plan 锚点 → hard，--force 可越）。
  assert.equal(lvl('BIZ-DEV-REFS'), 'hard');
  assert.equal(lvl('BIZ-ACCEPTANCE-REQUIRED'), 'warn');
  assert.equal(lvl('BIZ-EXECUTOR-HANDLE'), 'warn');
  assert.equal(lvl('BIZ-EXTERNAL-ISSUE'), 'warn');
  assert.equal(lvl('BIZ-EXTERNAL-ARTIFACT'), 'warn');
  // done 真语义：status=done 必须有 verified + artifact 证据。
  assert.equal(lvl('BIZ-DONE-VERIFIED'), 'hard');
});

test('invariant(id) looks up the full entry; unknown id → undefined', () => {
  const inv = M.invariant('GRAPH-CYCLE');
  assert.equal(inv!.family, 'GRAPH');
  assert.equal(inv!.level, 'hard');
  assert.equal(M.invariant('NOPE'), undefined);
});

// ── 跨消费者共享谓词（lint 与 graph 一份口径，杜绝两处漂移）───────────────────────────────────────
test('isAwaitingUser: blocked_on==="user" ∧ status ∈ {blocked,in_flight}', () => {
  assert.equal(M.isAwaitingUser({ blocked_on: 'user', status: 'blocked' }), true);
  assert.equal(M.isAwaitingUser({ blocked_on: 'user', status: 'in_flight' }), true);
  assert.equal(M.isAwaitingUser({ blocked_on: 'user', status: 'done' }), false);
  assert.equal(M.isAwaitingUser({ blocked_on: 'T1', status: 'blocked' }), false);
  assert.equal(M.isAwaitingUser({ status: 'blocked' }), false);
});

test('isDoneStatus / isActiveStatus', () => {
  assert.equal(M.isDoneStatus('done'), true);
  assert.equal(M.isDoneStatus('uncertain'), false);
  assert.equal(M.isActiveStatus('in_flight'), true);
  assert.equal(M.isActiveStatus('ready'), false);
});

test('isISOUTC: strict YYYY-MM-DDTHH:MM:SSZ only', () => {
  assert.equal(M.isISOUTC('2026-06-23T10:00:00Z'), true);
  assert.equal(M.isISOUTC('2026-06-23T10:00Z'), false);
  assert.equal(M.isISOUTC('not-a-date'), false);
  assert.equal(M.isISOUTC(123), false);
});

test('isAbsolutePathOrUrl: absolute path or http(s) URL, never relative', () => {
  assert.equal(M.isAbsolutePathOrUrl('/repo/docs/spec.md'), true);
  assert.equal(M.isAbsolutePathOrUrl('https://example.com/x'), true);
  assert.equal(M.isAbsolutePathOrUrl('http://example.com'), true);
  assert.equal(M.isAbsolutePathOrUrl('docs/spec.md'), false); // 相对路径禁
  assert.equal(M.isAbsolutePathOrUrl('./x'), false);
  assert.equal(M.isAbsolutePathOrUrl('../x'), false);
  assert.equal(M.isAbsolutePathOrUrl(42), false);
});

test('acceptanceConverged: string → null (不可判); object → 全 criteria met 才 true', () => {
  assert.equal(M.acceptanceConverged('一句话 DoD'), null);
  assert.equal(M.acceptanceConverged(undefined), null);
  assert.equal(
    M.acceptanceConverged({
      criteria: [
        { desc: 'a', status: 'met' },
        { desc: 'b', status: 'met' },
      ],
    }),
    true,
  );
  assert.equal(
    M.acceptanceConverged({
      criteria: [
        { desc: 'a', status: 'met' },
        { desc: 'b', status: 'pending' },
      ],
    }),
    false,
  );
  assert.equal(M.acceptanceConverged({ criteria: [] }), false); // 空 criteria 不算收敛
});

test('taskTrulyDone (P3 #32 语义): status=done ∧ verified ∧ artifact 非空', () => {
  assert.equal(M.taskTrulyDone({ status: 'done', verified: true, artifact: 'commit abc' }), true);
  assert.equal(M.taskTrulyDone({ status: 'done', verified: true }), false); // 缺 artifact
  assert.equal(M.taskTrulyDone({ status: 'done', verified: false, artifact: 'x' }), false); // 未验
  assert.equal(M.taskTrulyDone({ status: 'in_flight', verified: true, artifact: 'x' }), false);
});

test('dependencySatisfied separates review execution completion from approval (Finding #84)', () => {
  const legacyDone = { status: 'done' };
  const reviewGate = { kind: 'review', required_verdict: 'APPROVE' };

  assert.equal(M.dependencySatisfied(legacyDone), true, 'legacy done task remains compatible');
  assert.equal(
    M.dependencySatisfied({
      status: 'done',
      dependency_gate: reviewGate,
      review_verdict: 'APPROVE',
    }),
    true,
    'only APPROVE satisfies an explicit review gate',
  );
  assert.equal(
    M.dependencySatisfied({
      status: 'done',
      dependency_gate: reviewGate,
      review_verdict: 'REQUEST-CHANGES',
    }),
    false,
    'negative review completed execution but does not approve downstream consumption',
  );
  for (const review_verdict of [undefined, '', null]) {
    assert.equal(
      M.dependencySatisfied({ status: 'done', dependency_gate: reviewGate, review_verdict }),
      false,
      `silent verdict ${String(review_verdict)} must fail closed`,
    );
  }
  assert.equal(
    M.dependencySatisfied({
      status: 'done',
      dependency_gate: { kind: 'review', required_verdict: 'MERGE' },
      review_verdict: 'APPROVE',
    }),
    false,
    'malformed explicit gate fails closed',
  );
  assert.equal(
    M.dependencySatisfied({
      status: 'in_flight',
      dependency_gate: reviewGate,
      review_verdict: 'APPROVE',
    }),
    false,
    'approval does not replace execution completion',
  );
});
