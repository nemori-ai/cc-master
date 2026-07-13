// board-graph-core.test.ts — @ccm/engine·图分析库单测（设计稿 §5.6/§5.7）。
//   T1 port：从 cli/test/unit/board-graph-core.test.mjs 移植，CJS createRequire 加载改为对 ported TS 源的 ESM import。
//   原「DRY 守门」（断言 board-graph-core require board-lint-core）+「CLI 接线」两条布局断言测的是旧 cli/src
//   + skills/ 仓库形态——TS 引擎里 board-graph-core 静态 import board-lint-core 的 buildGraph（编译期依赖图天然
//   保证一份图），故那两条接线断言已删（pure-refactor 行为断言仍保留，间接覆盖 lint GRAPH-* 复用同一 buildGraph）。
//   shipped board.example.json smoke 测改读包内自带 fixture 副本（test/fixtures/，自洽不跨仓）。

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
// 测 build 后的 dist 公开 API barrel（见 board-model.test.ts 注：源 NodeNext `.js` specifier 直跑解析不了）。
import { analyzeGraph, buildGraph, estimateHours, lintBoard } from '../dist/index.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

// 小 board 构造糖：tasks → 一个合法 board 对象。
const board = (tasks: unknown[], extra: Record<string, unknown> = {}) => ({
  schema: 'cc-master/v2',
  goal: 'g',
  owner: { active: true, session_id: 's' },
  git: { worktree: '', branch: '' },
  tasks,
  ...extra,
});

// ── 纯重构证明：lint GRAPH-* 报告复用同一份 buildGraph（v2 规则码）────────────────────────────
test('pure-refactor: lint GRAPH-* (dangling/self-loop/cycle) reports use the shared buildGraph', () => {
  const rs = (arr: { rule: string }[]) => new Set(arr.map((v) => v.rule));
  // graph-core 确实复用 lint-core 的 buildGraph（不是自己又写了一份邻接构建）。
  assert.equal(typeof buildGraph, 'function', 'lint-core exports buildGraph');
  // dangling
  assert.ok(
    rs(
      lintBoard(JSON.stringify(board([{ id: 'T7', status: 'ready', deps: ['GONE'] }]))).errors,
    ).has('GRAPH-DANGLING'),
  );
  // self-loop
  assert.ok(
    rs(lintBoard(JSON.stringify(board([{ id: 'S', status: 'ready', deps: ['S'] }]))).errors).has(
      'GRAPH-SELFLOOP',
    ),
  );
  // cycle
  assert.ok(
    rs(
      lintBoard(
        JSON.stringify(
          board([
            { id: 'A', status: 'ready', deps: ['B'] },
            { id: 'B', status: 'ready', deps: ['A'] },
          ]),
        ),
      ).errors,
    ).has('GRAPH-CYCLE'),
  );
  // good board → no graph errors（done 无 finished 只产 BIZ-TIME-ORDER warn，不进 errors）
  const good = lintBoard(
    JSON.stringify(
      board([
        { id: 'A', status: 'done', deps: [], verified: true, artifact: '/abs/a.md' },
        { id: 'B', status: 'ready', deps: ['A'] },
      ]),
    ),
  );
  assert.equal(good.errors.length, 0, JSON.stringify(good.errors));
});

test('readySet applies the same review dependency gate as reconcileGating', () => {
  const gate = { kind: 'review', required_verdict: 'APPROVE' };
  const negative = analyzeGraph(
    board([
      {
        id: 'R1',
        status: 'done',
        deps: [],
        dependency_gate: gate,
        review_verdict: 'REQUEST-CHANGES',
      },
      { id: 'I1', status: 'ready', deps: ['R1'] },
    ]),
  );
  assert.deepEqual(negative.readySet(), [], 'REQUEST-CHANGES must not appear ready on read path');
  assert.deepEqual(
    analyzeGraph(
      board([
        { id: 'OWNER', status: 'done', deps: [] },
        {
          id: 'R1',
          status: 'done',
          deps: [],
          parent: 'OWNER',
          dependency_gate: gate,
          review_verdict: 'REQUEST-CHANGES',
        },
      ]),
    ).rollupConsistency(),
    [],
    'review execution completion remains done for rollup even when its dependency gate is closed',
  );

  const approved = analyzeGraph(
    board([
      {
        id: 'R1',
        status: 'done',
        deps: [],
        dependency_gate: gate,
        review_verdict: 'APPROVE',
      },
      { id: 'I1', status: 'ready', deps: ['R1'] },
    ]),
  );
  assert.deepEqual(approved.readySet(), ['I1']);
});

test('lint enforces GRAPH-PARENT-* nesting rules (parent is 硬 waist) — full coverage lives in board-lint-core.test.ts', () => {
  // parent 升入硬 waist（ADR-012）：parent 指向不存在 id 现在是 GRAPH-PARENT-EXISTS hard error。
  const r = lintBoard(
    JSON.stringify(
      board([
        { id: 'M1', status: 'in_flight', deps: [], kind: 'owner' },
        { id: 'M1.a', status: 'done', deps: [], parent: 'M1' },
        { id: 'orphan', status: 'ready', deps: [], parent: 'GHOST' }, // parent 指向不存在 id → GRAPH-PARENT-EXISTS
      ]),
    ),
  );
  assert.ok(
    new Set(r.errors.map((e) => e.rule)).has('GRAPH-PARENT-EXISTS'),
    'dangling parent is a GRAPH-PARENT-EXISTS hard error',
  );
  // 向后兼容：无 parent 的扁平板仍零 nesting 报错（GRAPH-PARENT-*）。
  const flat = lintBoard(
    JSON.stringify(
      board([
        { id: 'A', status: 'done', deps: [] },
        { id: 'B', status: 'ready', deps: ['A'] },
      ]),
    ),
  );
  for (const e of [...flat.errors, ...flat.warnings])
    assert.ok(!/^GRAPH-PARENT/.test(e.rule), `flat board has no nesting error (got ${e.rule})`);
});

// ── buildGraph: parent 倒排 ──────────────────────────────────────────────────────────────────────
test('buildGraph: parent inverse edges (children / parentOf)', () => {
  const g = buildGraph([
    { id: 'M1', status: 'in_flight', deps: [], kind: 'owner' },
    { id: 'M1.a', status: 'done', deps: [], parent: 'M1' },
    { id: 'M1.b', status: 'ready', deps: [], parent: 'M1' },
    { id: 'X', status: 'ready', deps: [] },
  ]);
  assert.deepEqual(
    g.children.get('M1'),
    ['M1.a', 'M1.b'],
    'children inverts parent edges in task order',
  );
  assert.equal(g.parentOf.get('M1.a'), 'M1');
  assert.equal(g.parentOf.get('M1.b'), 'M1');
  assert.ok(!g.parentOf.has('X'), 'no-parent node absent from parentOf');
  assert.ok(!g.children.has('X'), 'leaf with no children absent from children');
});

// ── cheap 子集 ──────────────────────────────────────────────────────────────────────────────────
test('topoSort + cycle: linear chain', () => {
  const g = analyzeGraph(
    board([
      { id: 'A', status: 'done', deps: [] },
      { id: 'B', status: 'ready', deps: ['A'] },
      { id: 'C', status: 'ready', deps: ['B'] },
    ]),
  );
  assert.deepEqual(g.topoSort().order, ['A', 'B', 'C']);
  assert.equal(g.topoSort().cycle, null);
  assert.equal(g.cycle(), null);
});

test('cycle detection: a 2-cycle is reported and topo order is partial', () => {
  const g = analyzeGraph(
    board([
      { id: 'A', status: 'ready', deps: ['B'] },
      { id: 'B', status: 'ready', deps: ['A'] },
    ]),
  );
  assert.ok(Array.isArray(g.cycle()) && g.cycle()!.length === 2, 'cycle found');
  assert.equal(g.topoSort().order.length, 0, 'nothing topo-sortable when all in a cycle');
});

test('predecessors / successors are direct edges only', () => {
  const g = analyzeGraph(
    board([
      { id: 'A', status: 'done', deps: [] },
      { id: 'B', status: 'ready', deps: ['A'] },
      { id: 'C', status: 'ready', deps: ['B'] },
    ]),
  );
  assert.deepEqual(g.predecessors('B'), ['A']);
  assert.deepEqual(g.successors('A'), ['B']);
  assert.deepEqual(g.successors('C'), []);
});

test('readySet: strictly deps-all-done ∧ status==ready', () => {
  const g = analyzeGraph(
    board([
      { id: 'A', status: 'done', deps: [] },
      { id: 'B', status: 'ready', deps: ['A'] }, // ready: dep A done
      { id: 'C', status: 'ready', deps: ['B'] }, // NOT ready: dep B not done
      { id: 'D', status: 'in_flight', deps: ['A'] }, // NOT ready: wrong status
      { id: 'E', status: 'ready', deps: [] }, // ready: no deps
    ]),
  );
  assert.deepEqual(g.readySet().sort(), ['B', 'E']);
});

test('wipStats: in_flight / blocked / user-gate counts', () => {
  const g = analyzeGraph(
    board([
      { id: 'A', status: 'in_flight', deps: [] },
      { id: 'B', status: 'in_flight', deps: [] },
      { id: 'C', status: 'blocked', deps: [], blocked_on: 'user' },
      { id: 'D', status: 'blocked', deps: [], blocked_on: 'A' },
      { id: 'E', status: 'done', deps: [] },
    ]),
  );
  const w = g.wipStats();
  assert.equal(w.in_flight, 2);
  assert.equal(w.blocked, 2);
  assert.equal(w.userGates, 1, 'only blocked_on:user pending counts as a user gate');
  assert.equal(w.counts.done, 1);
});

// ── nesting cheap 子集 ──────────────────────────────────────────────────────────────────────────
test('rollupConsistency: done owner with a non-done child is flagged', () => {
  const g = analyzeGraph(
    board([
      { id: 'M1', status: 'done', deps: [], kind: 'owner' },
      { id: 'M1.a', status: 'done', deps: [], parent: 'M1' },
      { id: 'M1.b', status: 'in_flight', deps: [], parent: 'M1' }, // non-done child under a done owner
      { id: 'M2', status: 'done', deps: [], kind: 'owner' },
      { id: 'M2.a', status: 'done', deps: [], parent: 'M2' }, // all children done → consistent
    ]),
  );
  const inc = g.rollupConsistency();
  assert.equal(inc.length, 1, 'only M1 is inconsistent');
  assert.equal(inc[0]!.owner, 'M1');
  assert.deepEqual(inc[0]!.nonDoneChildren, ['M1.b']);
});

test('checkDepth1: a child that is itself a parent violates depth=1', () => {
  const g = analyzeGraph(
    board([
      { id: 'M1', status: 'in_flight', deps: [] },
      { id: 'M1.a', status: 'ready', deps: [], parent: 'M1' },
      { id: 'M1.a.x', status: 'ready', deps: [], parent: 'M1.a' }, // grandchild → depth 2
    ]),
  );
  const v = g.checkDepth1();
  assert.equal(v.length, 1);
  assert.equal(v[0]!.owner, 'M1');
  assert.equal(v[0]!.grandchild, 'M1.a.x');
  // valid depth=1 board → no violation
  const ok = analyzeGraph(
    board([
      { id: 'M1', status: 'in_flight', deps: [] },
      { id: 'M1.a', status: 'ready', deps: [], parent: 'M1' },
    ]),
  );
  assert.equal(ok.checkDepth1().length, 0);
});

test('parentCycles: self-pointing and 2-cycle parent edges are detected', () => {
  const selfRef = analyzeGraph(board([{ id: 'A', status: 'ready', deps: [], parent: 'A' }]));
  assert.ok(selfRef.parentCycles().length >= 1, 'A.parent=A is a parent cycle');
  const twoCyc = analyzeGraph(
    board([
      { id: 'A', status: 'ready', deps: [], parent: 'B' },
      { id: 'B', status: 'ready', deps: [], parent: 'A' },
    ]),
  );
  assert.ok(twoCyc.parentCycles().length >= 1, 'A.parent=B,B.parent=A is a parent cycle');
  // clean parent edges → no cycle
  const clean = analyzeGraph(
    board([
      { id: 'M1', status: 'in_flight', deps: [] },
      { id: 'M1.a', status: 'ready', deps: [], parent: 'M1' },
    ]),
  );
  assert.equal(clean.parentCycles().length, 0);
});

// ── rich: descendants / ancestors / reachable ───────────────────────────────────────────────────
test('descendants / ancestors / reachable: diamond', () => {
  const g = analyzeGraph(
    board([
      { id: 'A', status: 'done', deps: [] },
      { id: 'B', status: 'ready', deps: ['A'] },
      { id: 'C', status: 'ready', deps: ['A'] },
      { id: 'D', status: 'ready', deps: ['B', 'C'] },
    ]),
  );
  assert.deepEqual([...g.descendants('A')].sort(), ['B', 'C', 'D']);
  assert.deepEqual([...g.ancestors('D')].sort(), ['A', 'B', 'C']);
  assert.equal(g.reachable('A', 'D'), true);
  assert.equal(g.reachable('B', 'C'), false);
});

// ── CPM: 教科书 ground-truth（measured 时长）────────────────────────────────────────────────────
test('criticalPath: textbook diamond with measured durations (full ES/EF/LS/LF/float)', () => {
  // A(3h)→B(2h)→D(1h), A→C(4h)→D. ES/EF forward, LS/LF backward.
  // ES: A=0 B=3 C=3 D=7. EF: A=3 B=5 C=7 D=8. makespan=8.
  // float: A=0, B=2, C=0, D=0. Critical chain = A→C→D.
  const mk = (id: string, deps: string[], _durH: number, started: string, finished: string) => ({
    id,
    status: 'done',
    deps,
    started_at: started,
    finished_at: finished,
  });
  const g = analyzeGraph(
    board([
      mk('A', [], 3, '2026-06-01T00:00:00Z', '2026-06-01T03:00:00Z'),
      mk('B', ['A'], 2, '2026-06-01T03:00:00Z', '2026-06-01T05:00:00Z'),
      mk('C', ['A'], 4, '2026-06-01T03:00:00Z', '2026-06-01T07:00:00Z'),
      mk('D', ['B', 'C'], 1, '2026-06-01T07:00:00Z', '2026-06-01T08:00:00Z'),
    ]),
  );
  const cp = g.criticalPath();
  assert.equal(cp.weight_source, 'measured', 'all nodes have measured durations');
  assert.equal(cp.makespan, 8, 'makespan = 8h');
  const s = cp.schedule;
  assert.equal(s.get('A')!.es, 0);
  assert.equal(s.get('A')!.ef, 3);
  assert.equal(s.get('A')!.float, 0);
  assert.equal(s.get('B')!.es, 3);
  assert.equal(s.get('B')!.ef, 5);
  assert.equal(s.get('B')!.float, 2);
  assert.equal(s.get('C')!.es, 3);
  assert.equal(s.get('C')!.ef, 7);
  assert.equal(s.get('C')!.float, 0);
  assert.equal(s.get('D')!.es, 7);
  assert.equal(s.get('D')!.ef, 8);
  assert.equal(s.get('D')!.float, 0);
  assert.deepEqual(cp.chain, ['A', 'C', 'D'], 'critical chain follows zero-float longest path');
});

test('criticalPath honesty: all-missing-timestamps → unit, makespan null (no pseudo-precision)', () => {
  const g = analyzeGraph(
    board([
      { id: 'A', status: 'ready', deps: [] },
      { id: 'B', status: 'ready', deps: ['A'] },
      { id: 'C', status: 'ready', deps: ['B'] },
    ]),
  );
  const cp = g.criticalPath();
  assert.equal(cp.weight_source, 'unit', 'no timestamps → unit weights');
  assert.equal(
    cp.makespan,
    null,
    'unit/mixed → makespan suppressed (only structure + node count reported)',
  );
  assert.deepEqual(cp.chain, ['A', 'B', 'C'], 'chain structure still correct');
});

test('criticalPath honesty: mixed (some measured, some missing) → weight_source mixed, makespan null', () => {
  const g = analyzeGraph(
    board([
      {
        id: 'A',
        status: 'done',
        deps: [],
        started_at: '2026-06-01T00:00:00Z',
        finished_at: '2026-06-01T03:00:00Z',
      },
      { id: 'B', status: 'ready', deps: ['A'] }, // no timestamps → unit
    ]),
  );
  const cp = g.criticalPath();
  assert.equal(cp.weight_source, 'mixed');
  assert.equal(cp.makespan, null, 'mixed → no hour-level makespan');
});

test('criticalPath on a cyclic graph degrades to empty schedule + weight_source:cycle (no throw)', () => {
  const g = analyzeGraph(
    board([
      { id: 'A', status: 'ready', deps: ['B'] },
      { id: 'B', status: 'ready', deps: ['A'] },
    ]),
  );
  const cp = g.criticalPath();
  assert.equal(cp.weight_source, 'cycle');
  assert.equal(cp.makespan, null);
  assert.deepEqual(cp.chain, []);
});

// ── multi-source / multi-sink ───────────────────────────────────────────────────────────────────
test('longestPath + parallelism: multi-source multi-sink', () => {
  // two sources S1,S2 → M → two sinks K1,K2. Longest chain length = 3 (S→M→K).
  const g = analyzeGraph(
    board([
      { id: 'S1', status: 'done', deps: [] },
      { id: 'S2', status: 'done', deps: [] },
      { id: 'M', status: 'ready', deps: ['S1', 'S2'] },
      { id: 'K1', status: 'ready', deps: ['M'] },
      { id: 'K2', status: 'ready', deps: ['M'] },
    ]),
  );
  assert.equal(g.longestPath().length, 3, 'longest chain = 3 nodes');
  const par = g.parallelism();
  assert.equal(par.T1, 5, 'T1 = total node count');
  assert.equal(par.Tinf, 3, 'Tinf = critical chain length');
  assert.ok(Math.abs(par.parallelism - 5 / 3) < 1e-9);
});

// ── nested owner + 子 fixture（含 open deps 跨指）──────────────────────────────────────────────
test('nested owner+children fixture: open deps cross-pointing + rollupProgress advisory', () => {
  const g = analyzeGraph(
    board([
      { id: 'X', status: 'in_flight', deps: [] }, // a non-owner top-level
      { id: 'M1', status: 'in_flight', deps: [], kind: 'owner' },
      { id: 'M1.a', status: 'done', deps: [], parent: 'M1' },
      { id: 'M1.b', status: 'ready', deps: ['M1.a'], parent: 'M1' }, // intra-owner dep
      { id: 'M1.c', status: 'blocked', deps: ['X'], parent: 'M1', blocked_on: 'X' }, // OPEN dep: child depends on non-M1 top-level
    ]),
  );
  // parent inverse
  assert.deepEqual(g.children('M1'), ['M1.a', 'M1.b', 'M1.c']);
  assert.equal(g.parentOf('M1.c'), 'M1');
  // open deps are normal scheduling edges across the parent boundary
  assert.deepEqual(g.predecessors('M1.c'), ['X']);
  assert.deepEqual(g.successors('X'), ['M1.c']);
  // rollupProgress is advisory: 1 of 3 children done
  const rp = g.rollupProgress('M1');
  assert.equal(rp.done, 1);
  assert.equal(rp.total, 3);
  assert.ok(Math.abs(rp.ratio - 1 / 3) < 1e-9);
  // M1 is in_flight (not done) → no rollup inconsistency despite non-done children
  assert.equal(g.rollupConsistency().length, 0);
});

// ── bad-input robustness：纯、不抛、退化 ─────────────────────────────────────────────────────────
test('bad input never throws: non-array tasks / missing board → empty degenerate graph', () => {
  for (const bad of [
    null,
    undefined,
    {},
    { tasks: 'nope' },
    { tasks: null },
    42,
    'str',
  ] as unknown[]) {
    const g = analyzeGraph(bad as never);
    assert.equal(g.ids.size, 0);
    assert.deepEqual(g.topoSort().order, []);
    assert.deepEqual(g.readySet(), []);
    assert.equal(g.criticalPath().makespan, null);
    assert.deepEqual(g.rollupConsistency(), []);
  }
});

test('dangling deps are dropped from adjacency (graph stays clean; lint reports them separately)', () => {
  const g = analyzeGraph(
    board([
      { id: 'A', status: 'ready', deps: ['GONE'] }, // dangling
      { id: 'B', status: 'ready', deps: ['A'] },
    ]),
  );
  assert.deepEqual(g.predecessors('A'), [], 'dangling dep not an edge');
  assert.deepEqual(g.predecessors('B'), ['A']);
  assert.equal(g.cycle(), null, 'no spurious cycle from dangling');
});

// ── the shipped example.json loads + analyzes cleanly (real schema-data smoke) ───────────────────
test('shipped board.example.json analyzes cleanly with the nested owner present', () => {
  const ex = JSON.parse(readFileSync(join(HERE, 'fixtures', 'board.example.json'), 'utf8'));
  const g = analyzeGraph(ex);
  assert.deepEqual(g.children('M1').sort(), ['M1.a', 'M1.b', 'M1.c']);
  assert.equal(g.parentOf('M1.c'), 'M1');
  // M1.c carries an OPEN dep onto T1 (a non-M1 top-level node) — the example's whole point.
  assert.ok(g.predecessors('M1.c').includes('T1'), 'example demonstrates an open cross-parent dep');
  assert.equal(g.cycle(), null, 'example board is acyclic');
  assert.equal(g.checkDepth1().length, 0, 'example respects depth=1');
  assert.equal(g.parentCycles().length, 0, 'example has no parent cycles');
});

// ── P4.3·v2：estimate 喂 CPM 时长（measured → estimate → unit 降级链·#29/#34）────────────────────────
test('estimateHours: 单位折算 h/m/d/w；未知单位 / 非正 / 缺 → null', () => {
  assert.equal(estimateHours({ value: 2, unit: 'h' }), 2);
  assert.equal(estimateHours({ value: 120, unit: 'm' }), 2);
  assert.equal(estimateHours({ value: 1, unit: 'd' }), 24);
  assert.equal(estimateHours({ value: 1, unit: 'w' }), 168);
  assert.equal(estimateHours({ value: 3, unit: 'sprints' }), null); // 未知单位
  assert.equal(estimateHours({ value: 0, unit: 'h' }), null); // 非正
  assert.equal(estimateHours({ value: 'big', unit: 'h' }), null); // 非数字
  assert.equal(estimateHours(undefined), null);
});

test('criticalPath: 纯 estimate 板 → weight_source="estimate" + 报小时级 makespan', () => {
  const g = analyzeGraph(
    board([
      { id: 'A', status: 'ready', deps: [], estimate: { value: 2, unit: 'h' } },
      { id: 'B', status: 'ready', deps: ['A'], estimate: { value: 3, unit: 'h' } },
    ]),
  );
  const cp = g.criticalPath({ now: 0 });
  assert.equal(cp.weight_source, 'estimate');
  assert.equal(cp.makespan, 5, '计划工时连贯 → 报 makespan(2+3=5h)');
  assert.deepEqual(cp.chain, ['A', 'B']);
});

test('criticalPath: estimate + 无数据节点(unit) 混合 → mixed，不报小时级 makespan', () => {
  const g = analyzeGraph(
    board([
      { id: 'A', status: 'ready', deps: [], estimate: { value: 2, unit: 'h' } },
      { id: 'B', status: 'ready', deps: ['A'] }, // 无 estimate 无时间戳 → unit
    ]),
  );
  const cp = g.criticalPath({ now: 0 });
  assert.equal(cp.weight_source, 'mixed');
  assert.equal(cp.makespan, null, 'mixed 不报小时级 makespan(伪精确)');
});

test('criticalPath: measured 优先于 estimate（实测盖过计划）', () => {
  const g = analyzeGraph(
    board([
      {
        id: 'A',
        status: 'done',
        deps: [],
        started_at: '2026-06-23T10:00:00Z',
        finished_at: '2026-06-23T14:00:00Z',
        estimate: { value: 1, unit: 'h' },
      },
    ]),
  );
  const cp = g.criticalPath({ now: 0 });
  assert.equal(cp.weight_source, 'measured', 'A 有实测时间戳 → measured 盖过 estimate');
  assert.equal(cp.makespan, 4, '用实测 4h（非 estimate 的 1h）');
});
