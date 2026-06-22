// board-graph-core.test.mjs — D3.2 图分析库单测（设计稿 §5.6/§5.7）。
//
// 两件事：① 算法 correctness——faithful 小 board fixture（线性 / 钻石 / 多源汇 / 含环 / 含悬挂 /
//   含 nested owner+子 / 全缺时间戳）；CPM 用教科书 ground-truth 验。② DRY 守门——断言 board-graph-core
//   require 的是 board-lint-core 的 buildGraph（不另起图），且抽 buildGraph 后 lint 报告行为不变（纯重构）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const require = createRequire(import.meta.url);

const LINT_CORE = 'hooks/scripts/board-lint-core.js';
const GRAPH_CORE = 'hooks/scripts/board-graph-core.js';
const CLI = 'skills/orchestrating-to-completion/scripts/board-graph.js';

const { analyzeGraph } = require(join(ROOT, GRAPH_CORE));
const lintCore = require(join(ROOT, LINT_CORE));

// 小 board 构造糖：tasks → 一个合法 board 对象。
const board = (tasks, extra = {}) => ({
  schema: 'cc-master/v1', goal: 'g', owner: { active: true, session_id: 's' },
  git: { worktree: '', branch: '' }, tasks, ...extra,
});

// ── DRY 守门（设计稿 §5.2：一份图，不漂移）──────────────────────────────────────────────────────
test('DRY: board-graph-core requires board-lint-core (the ONE buildGraph, not a re-implemented graph)', () => {
  assert.ok(existsSync(join(ROOT, GRAPH_CORE)), 'board-graph-core.js exists in hooks/scripts');
  assert.match(read(GRAPH_CORE), /require\(['"]\.\/board-lint-core(\.js)?['"]\)/, 'graph-core requires ./board-lint-core');
  // 它确实从 lint-core 拿到了 buildGraph（不是自己又写了一份邻接构建）。
  assert.equal(typeof lintCore.buildGraph, 'function', 'lint-core exports buildGraph');
});

test('CLI exists, requires the shared graph-core, and uses ${CLAUDE_SKILL_DIR} prose (红线5)', () => {
  assert.ok(existsSync(join(ROOT, CLI)), 'board-graph.js CLI exists');
  const cli = read(CLI);
  assert.match(cli, /board-graph-core/, 'CLI wires to the shared graph-core');
  assert.match(cli, /CLAUDE_SKILL_DIR|CLAUDE_PLUGIN_ROOT/, 'CLI prose uses plugin-root/skill-dir references, not bare relative paths');
});

// ── 纯重构证明：抽 buildGraph 后 lint R4 报告行为不变 ─────────────────────────────────────────────
test('pure-refactor: lint R4 (dangling/self-loop/cycle) reports unchanged after buildGraph extraction', () => {
  const { lintBoard } = lintCore;
  const rs = (arr) => new Set(arr.map((v) => v.rule));
  // R4a dangling
  assert.ok(rs(lintBoard(JSON.stringify(board([{ id: 'T7', status: 'ready', deps: ['GONE'] }]))).errors).has('R4a'));
  // R4b self-loop
  assert.ok(rs(lintBoard(JSON.stringify(board([{ id: 'S', status: 'ready', deps: ['S'] }]))).errors).has('R4b'));
  // R4c cycle
  assert.ok(rs(lintBoard(JSON.stringify(board([{ id: 'A', status: 'ready', deps: ['B'] }, { id: 'B', status: 'ready', deps: ['A'] }]))).errors).has('R4c'));
  // good board → no R4
  const good = lintBoard(JSON.stringify(board([{ id: 'A', status: 'done', deps: [] }, { id: 'B', status: 'ready', deps: ['A'] }])));
  assert.equal(good.errors.length, 0);
});

test('D3.3 / PR-2: lint now enforces R7 nesting rules (parent is硬 waist) — full R7 coverage lives in board-lint-core.test.mjs', () => {
  const { lintBoard } = lintCore;
  // D3.3 landed R7（parent 升入硬 waist·ADR-012）：parent 指向不存在 id 现在是 R7a hard error。
  // 这里只 smoke-check「图库侧的 lint 现在确实跑 R7」，详尽 R7a/b/c/d 断言在 board-lint-core.test.mjs。
  const r = lintBoard(JSON.stringify(board([
    { id: 'M1', status: 'in_flight', deps: [], kind: 'owner' },
    { id: 'M1.a', status: 'done', deps: [], parent: 'M1' },
    { id: 'orphan', status: 'ready', deps: [], parent: 'GHOST' }, // parent 指向不存在 id → R7a
  ])));
  assert.ok(new Set(r.errors.map((e) => e.rule)).has('R7a'), 'dangling parent is now an R7a hard error (post-D3.3)');
  // 向后兼容：无 parent 的扁平板仍零 R7。
  const flat = lintBoard(JSON.stringify(board([{ id: 'A', status: 'done', deps: [] }, { id: 'B', status: 'ready', deps: ['A'] }])));
  for (const e of [...flat.errors, ...flat.warnings]) assert.ok(!/^R7/.test(e.rule), `flat board has no R7 (got ${e.rule})`);
});

// ── buildGraph: parent 倒排 ──────────────────────────────────────────────────────────────────────
test('buildGraph: parent inverse edges (children / parentOf)', () => {
  const g = lintCore.buildGraph([
    { id: 'M1', status: 'in_flight', deps: [], kind: 'owner' },
    { id: 'M1.a', status: 'done', deps: [], parent: 'M1' },
    { id: 'M1.b', status: 'ready', deps: [], parent: 'M1' },
    { id: 'X', status: 'ready', deps: [] },
  ]);
  assert.deepEqual(g.children.get('M1'), ['M1.a', 'M1.b'], 'children inverts parent edges in task order');
  assert.equal(g.parentOf.get('M1.a'), 'M1');
  assert.equal(g.parentOf.get('M1.b'), 'M1');
  assert.ok(!g.parentOf.has('X'), 'no-parent node absent from parentOf');
  assert.ok(!g.children.has('X'), 'leaf with no children absent from children');
});

// ── cheap 子集 ──────────────────────────────────────────────────────────────────────────────────
test('topoSort + cycle: linear chain', () => {
  const g = analyzeGraph(board([
    { id: 'A', status: 'done', deps: [] },
    { id: 'B', status: 'ready', deps: ['A'] },
    { id: 'C', status: 'ready', deps: ['B'] },
  ]));
  assert.deepEqual(g.topoSort().order, ['A', 'B', 'C']);
  assert.equal(g.topoSort().cycle, null);
  assert.equal(g.cycle(), null);
});

test('cycle detection: a 2-cycle is reported and topo order is partial', () => {
  const g = analyzeGraph(board([
    { id: 'A', status: 'ready', deps: ['B'] },
    { id: 'B', status: 'ready', deps: ['A'] },
  ]));
  assert.ok(Array.isArray(g.cycle()) && g.cycle().length === 2, 'cycle found');
  assert.equal(g.topoSort().order.length, 0, 'nothing topo-sortable when all in a cycle');
});

test('predecessors / successors are direct edges only', () => {
  const g = analyzeGraph(board([
    { id: 'A', status: 'done', deps: [] },
    { id: 'B', status: 'ready', deps: ['A'] },
    { id: 'C', status: 'ready', deps: ['B'] },
  ]));
  assert.deepEqual(g.predecessors('B'), ['A']);
  assert.deepEqual(g.successors('A'), ['B']);
  assert.deepEqual(g.successors('C'), []);
});

test('readySet: strictly deps-all-done ∧ status==ready', () => {
  const g = analyzeGraph(board([
    { id: 'A', status: 'done', deps: [] },
    { id: 'B', status: 'ready', deps: ['A'] },     // ready: dep A done
    { id: 'C', status: 'ready', deps: ['B'] },     // NOT ready: dep B not done
    { id: 'D', status: 'in_flight', deps: ['A'] }, // NOT ready: wrong status
    { id: 'E', status: 'ready', deps: [] },        // ready: no deps
  ]));
  assert.deepEqual(g.readySet().sort(), ['B', 'E']);
});

test('wipStats: in_flight / blocked / user-gate counts', () => {
  const g = analyzeGraph(board([
    { id: 'A', status: 'in_flight', deps: [] },
    { id: 'B', status: 'in_flight', deps: [] },
    { id: 'C', status: 'blocked', deps: [], blocked_on: 'user' },
    { id: 'D', status: 'blocked', deps: [], blocked_on: 'A' },
    { id: 'E', status: 'done', deps: [] },
  ]));
  const w = g.wipStats();
  assert.equal(w.in_flight, 2);
  assert.equal(w.blocked, 2);
  assert.equal(w.userGates, 1, 'only blocked_on:user pending counts as a user gate');
  assert.equal(w.counts.done, 1);
});

// ── nesting cheap 子集 ──────────────────────────────────────────────────────────────────────────
test('rollupConsistency: done owner with a non-done child is flagged', () => {
  const g = analyzeGraph(board([
    { id: 'M1', status: 'done', deps: [], kind: 'owner' },
    { id: 'M1.a', status: 'done', deps: [], parent: 'M1' },
    { id: 'M1.b', status: 'in_flight', deps: [], parent: 'M1' }, // non-done child under a done owner
    { id: 'M2', status: 'done', deps: [], kind: 'owner' },
    { id: 'M2.a', status: 'done', deps: [], parent: 'M2' },      // all children done → consistent
  ]));
  const inc = g.rollupConsistency();
  assert.equal(inc.length, 1, 'only M1 is inconsistent');
  assert.equal(inc[0].owner, 'M1');
  assert.deepEqual(inc[0].nonDoneChildren, ['M1.b']);
});

test('checkDepth1: a child that is itself a parent violates depth=1', () => {
  const g = analyzeGraph(board([
    { id: 'M1', status: 'in_flight', deps: [] },
    { id: 'M1.a', status: 'ready', deps: [], parent: 'M1' },
    { id: 'M1.a.x', status: 'ready', deps: [], parent: 'M1.a' }, // grandchild → depth 2
  ]));
  const v = g.checkDepth1();
  assert.equal(v.length, 1);
  assert.equal(v[0].owner, 'M1');
  assert.equal(v[0].grandchild, 'M1.a.x');
  // valid depth=1 board → no violation
  const ok = analyzeGraph(board([
    { id: 'M1', status: 'in_flight', deps: [] },
    { id: 'M1.a', status: 'ready', deps: [], parent: 'M1' },
  ]));
  assert.equal(ok.checkDepth1().length, 0);
});

test('parentCycles: self-pointing and 2-cycle parent edges are detected', () => {
  const selfRef = analyzeGraph(board([{ id: 'A', status: 'ready', deps: [], parent: 'A' }]));
  assert.ok(selfRef.parentCycles().length >= 1, 'A.parent=A is a parent cycle');
  const twoCyc = analyzeGraph(board([
    { id: 'A', status: 'ready', deps: [], parent: 'B' },
    { id: 'B', status: 'ready', deps: [], parent: 'A' },
  ]));
  assert.ok(twoCyc.parentCycles().length >= 1, 'A.parent=B,B.parent=A is a parent cycle');
  // clean parent edges → no cycle
  const clean = analyzeGraph(board([
    { id: 'M1', status: 'in_flight', deps: [] },
    { id: 'M1.a', status: 'ready', deps: [], parent: 'M1' },
  ]));
  assert.equal(clean.parentCycles().length, 0);
});

// ── rich: descendants / ancestors / reachable ───────────────────────────────────────────────────
test('descendants / ancestors / reachable: diamond', () => {
  const g = analyzeGraph(board([
    { id: 'A', status: 'done', deps: [] },
    { id: 'B', status: 'ready', deps: ['A'] },
    { id: 'C', status: 'ready', deps: ['A'] },
    { id: 'D', status: 'ready', deps: ['B', 'C'] },
  ]));
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
  const mk = (id, deps, durH, started, finished) => ({
    id, status: 'done', deps,
    started_at: started, finished_at: finished,
  });
  // measured durations encoded as started/finished spans on a fixed day.
  const g = analyzeGraph(board([
    mk('A', [], 3, '2026-06-01T00:00:00Z', '2026-06-01T03:00:00Z'),
    mk('B', ['A'], 2, '2026-06-01T03:00:00Z', '2026-06-01T05:00:00Z'),
    mk('C', ['A'], 4, '2026-06-01T03:00:00Z', '2026-06-01T07:00:00Z'),
    mk('D', ['B', 'C'], 1, '2026-06-01T07:00:00Z', '2026-06-01T08:00:00Z'),
  ]));
  const cp = g.criticalPath();
  assert.equal(cp.weight_source, 'measured', 'all nodes have measured durations');
  assert.equal(cp.makespan, 8, 'makespan = 8h');
  const s = cp.schedule;
  assert.equal(s.get('A').es, 0); assert.equal(s.get('A').ef, 3); assert.equal(s.get('A').float, 0);
  assert.equal(s.get('B').es, 3); assert.equal(s.get('B').ef, 5); assert.equal(s.get('B').float, 2);
  assert.equal(s.get('C').es, 3); assert.equal(s.get('C').ef, 7); assert.equal(s.get('C').float, 0);
  assert.equal(s.get('D').es, 7); assert.equal(s.get('D').ef, 8); assert.equal(s.get('D').float, 0);
  assert.deepEqual(cp.chain, ['A', 'C', 'D'], 'critical chain follows zero-float longest path');
});

test('criticalPath honesty: all-missing-timestamps → unit, makespan null (no pseudo-precision)', () => {
  const g = analyzeGraph(board([
    { id: 'A', status: 'ready', deps: [] },
    { id: 'B', status: 'ready', deps: ['A'] },
    { id: 'C', status: 'ready', deps: ['B'] },
  ]));
  const cp = g.criticalPath();
  assert.equal(cp.weight_source, 'unit', 'no timestamps → unit weights');
  assert.equal(cp.makespan, null, 'unit/mixed → makespan suppressed (only structure + node count reported)');
  assert.deepEqual(cp.chain, ['A', 'B', 'C'], 'chain structure still correct');
});

test('criticalPath honesty: mixed (some measured, some missing) → weight_source mixed, makespan null', () => {
  const g = analyzeGraph(board([
    { id: 'A', status: 'done', deps: [], started_at: '2026-06-01T00:00:00Z', finished_at: '2026-06-01T03:00:00Z' },
    { id: 'B', status: 'ready', deps: ['A'] }, // no timestamps → unit
  ]));
  const cp = g.criticalPath();
  assert.equal(cp.weight_source, 'mixed');
  assert.equal(cp.makespan, null, 'mixed → no hour-level makespan');
});

test('criticalPath on a cyclic graph degrades to empty schedule + weight_source:cycle (no throw)', () => {
  const g = analyzeGraph(board([
    { id: 'A', status: 'ready', deps: ['B'] },
    { id: 'B', status: 'ready', deps: ['A'] },
  ]));
  const cp = g.criticalPath();
  assert.equal(cp.weight_source, 'cycle');
  assert.equal(cp.makespan, null);
  assert.deepEqual(cp.chain, []);
});

// ── multi-source / multi-sink ───────────────────────────────────────────────────────────────────
test('longestPath + parallelism: multi-source multi-sink', () => {
  // two sources S1,S2 → M → two sinks K1,K2. Longest chain length = 3 (S→M→K).
  const g = analyzeGraph(board([
    { id: 'S1', status: 'done', deps: [] },
    { id: 'S2', status: 'done', deps: [] },
    { id: 'M', status: 'ready', deps: ['S1', 'S2'] },
    { id: 'K1', status: 'ready', deps: ['M'] },
    { id: 'K2', status: 'ready', deps: ['M'] },
  ]));
  assert.equal(g.longestPath().length, 3, 'longest chain = 3 nodes');
  const par = g.parallelism();
  assert.equal(par.T1, 5, 'T1 = total node count');
  assert.equal(par.Tinf, 3, 'Tinf = critical chain length');
  assert.ok(Math.abs(par.parallelism - 5 / 3) < 1e-9);
});

// ── nested owner + 子 fixture（含 open deps 跨指）──────────────────────────────────────────────
test('nested owner+children fixture: open deps cross-pointing + rollupProgress advisory', () => {
  const g = analyzeGraph(board([
    { id: 'X', status: 'in_flight', deps: [] },                              // a non-owner top-level
    { id: 'M1', status: 'in_flight', deps: [], kind: 'owner' },
    { id: 'M1.a', status: 'done', deps: [], parent: 'M1' },
    { id: 'M1.b', status: 'ready', deps: ['M1.a'], parent: 'M1' },           // intra-owner dep
    { id: 'M1.c', status: 'blocked', deps: ['X'], parent: 'M1', blocked_on: 'X' }, // OPEN dep: child depends on non-M1 top-level
  ]));
  // parent inverse
  assert.deepEqual(g.children('M1'), ['M1.a', 'M1.b', 'M1.c']);
  assert.equal(g.parentOf('M1.c'), 'M1');
  // open deps are normal scheduling edges across the parent boundary
  assert.deepEqual(g.predecessors('M1.c'), ['X']);
  assert.deepEqual(g.successors('X'), ['M1.c']);
  // rollupProgress is advisory: 1 of 3 children done
  const rp = g.rollupProgress('M1');
  assert.equal(rp.done, 1); assert.equal(rp.total, 3);
  assert.ok(Math.abs(rp.ratio - 1 / 3) < 1e-9);
  // M1 is in_flight (not done) → no rollup inconsistency despite non-done children
  assert.equal(g.rollupConsistency().length, 0);
});

// ── bad-input robustness：纯、不抛、退化 ─────────────────────────────────────────────────────────
test('bad input never throws: non-array tasks / missing board → empty degenerate graph', () => {
  for (const bad of [null, undefined, {}, { tasks: 'nope' }, { tasks: null }, 42, 'str']) {
    const g = analyzeGraph(bad);
    assert.equal(g.ids.size, 0);
    assert.deepEqual(g.topoSort().order, []);
    assert.deepEqual(g.readySet(), []);
    assert.equal(g.criticalPath().makespan, null);
    assert.deepEqual(g.rollupConsistency(), []);
  }
});

test('dangling deps are dropped from adjacency (graph stays clean; lint reports them separately)', () => {
  const g = analyzeGraph(board([
    { id: 'A', status: 'ready', deps: ['GONE'] }, // dangling
    { id: 'B', status: 'ready', deps: ['A'] },
  ]));
  assert.deepEqual(g.predecessors('A'), [], 'dangling dep not an edge');
  assert.deepEqual(g.predecessors('B'), ['A']);
  assert.equal(g.cycle(), null, 'no spurious cycle from dangling');
});

// ── the shipped example.json loads + analyzes cleanly (real schema-data smoke) ───────────────────
test('shipped board.example.json analyzes cleanly with the nested owner present', () => {
  const ex = JSON.parse(read('skills/orchestrating-to-completion/assets/board.example.json'));
  const g = analyzeGraph(ex);
  assert.deepEqual(g.children('M1').sort(), ['M1.a', 'M1.b', 'M1.c']);
  assert.equal(g.parentOf('M1.c'), 'M1');
  // M1.c carries an OPEN dep onto T1 (a non-M1 top-level node) — the example's whole point.
  assert.ok(g.predecessors('M1.c').includes('T1'), 'example demonstrates an open cross-parent dep');
  assert.equal(g.cycle(), null, 'example board is acyclic');
  assert.equal(g.checkDepth1().length, 0, 'example respects depth=1');
  assert.equal(g.parentCycles().length, 0, 'example has no parent cycles');
});
