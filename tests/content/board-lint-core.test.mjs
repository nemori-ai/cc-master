// board-lint-core.test.mjs — T9. Asserts the SHARED lint core (single source of truth) and that both
// consumers (the PostToolUse hook + the manual skill script) wire to that ONE core file — no drift, no
// duplicated rule-set (the spec's §5.2 "Option B but DRY": one physical core, two thin wrappers). The
// core is a CommonJS module under hooks/scripts/ (a distributed convention dir) so the hook can
// `require('./board-lint-core.js')` without reaching into the skill tree (红线5: hook self-contained);
// the manual script requires the same file via a stable in-plugin relative path.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const require = createRequire(import.meta.url);

const CORE = 'hooks/scripts/board-lint-core.js';
const HOOK = 'hooks/scripts/board-lint.js';
const MANUAL = 'skills/orchestrating-to-completion/scripts/board-lint.js';

test('shared lint core exists and is the single source both consumers wire to (no drift)', () => {
  assert.ok(existsSync(join(ROOT, CORE)), 'board-lint-core.js exists in hooks/scripts');
  // Hook requires the core from its own dir (same distributed dir → 红线5 safe).
  assert.match(read(HOOK), /require\(['"]\.\/board-lint-core(\.js)?['"]\)/, 'hook requires ./board-lint-core');
  // Manual script requires the SAME core file via an in-plugin relative path resolved from __dirname.
  assert.match(read(MANUAL), /board-lint-core/, 'manual script references board-lint-core (one source)');
});

// Load the core and exercise the rule set directly (the DRY proof: the same lintBoard both
// wrappers call). lintBoard(text) → { errors:[{rule,...}], warnings:[{rule,...}] }.
const { lintBoard } = require(join(ROOT, CORE));

const ruleSet = (arr) => new Set(arr.map((v) => v.rule));
const GOOD = JSON.stringify({
  schema: 'cc-master/v1', meta: { template_version: 1 }, goal: 'g',
  owner: { active: true, session_id: 's' }, git: { worktree: '/w', branch: 'b' },
  tasks: [{ id: 'T0', status: 'done', deps: [] }, { id: 'T1', status: 'ready', deps: ['T0'] }],
});

test('lintBoard exports a pure function returning {errors,warnings}', () => {
  const r = lintBoard(GOOD);
  assert.ok(Array.isArray(r.errors) && Array.isArray(r.warnings));
});

test('R1: invalid JSON is a hard error (does not throw)', () => {
  const r = lintBoard('{"schema":"cc-master/v1","tasks":[{');
  assert.ok(ruleSet(r.errors).has('R1'), 'R1 invalid JSON');
});

test('good board → zero errors, zero warnings', () => {
  const r = lintBoard(GOOD);
  assert.equal(r.errors.length, 0, JSON.stringify(r.errors));
  assert.equal(r.warnings.length, 0, JSON.stringify(r.warnings));
});

test('R2: pinned-waist type violations are hard errors', () => {
  // tasks not an array (R2f)
  assert.ok(ruleSet(lintBoard(JSON.stringify({ schema: 'cc-master/v1', goal: 'g', owner: { active: true, session_id: 's' }, git: {}, tasks: 9 })).errors).has('R2f'));
  // schema wrong (R2a)
  assert.ok(ruleSet(lintBoard(JSON.stringify({ schema: 'nope', goal: 'g', owner: { active: true, session_id: 's' }, git: {}, tasks: [] })).errors).has('R2a'));
  // owner.active non-boolean (R2c)
  assert.ok(ruleSet(lintBoard(JSON.stringify({ schema: 'cc-master/v1', goal: 'g', owner: { active: 'yes', session_id: 's' }, git: {}, tasks: [] })).errors).has('R2c'));
  // goal missing (R2b)
  assert.ok(ruleSet(lintBoard(JSON.stringify({ schema: 'cc-master/v1', owner: { active: true, session_id: 's' }, git: {}, tasks: [] })).errors).has('R2b'));
});

test('R2d: empty owner.session_id is LEGAL (not flagged) — fresh-bootstrap blank board', () => {
  const r = lintBoard(JSON.stringify({ schema: 'cc-master/v1', goal: 'g', owner: { active: true, session_id: '' }, git: { worktree: '', branch: '' }, tasks: [] }));
  assert.equal(r.errors.length, 0, 'empty session_id is a legal state, not an error');
});

test('R3: per-task id/status/deps contract', () => {
  // bad status enum (R3c)
  assert.ok(ruleSet(lintBoard(JSON.stringify({ schema: 'cc-master/v1', goal: 'g', owner: { active: true, session_id: 's' }, git: {}, tasks: [{ id: 'T1', status: 'in_flght', deps: [] }] })).errors).has('R3c'));
  // missing id (R3a)
  assert.ok(ruleSet(lintBoard(JSON.stringify({ schema: 'cc-master/v1', goal: 'g', owner: { active: true, session_id: 's' }, git: {}, tasks: [{ status: 'ready', deps: [] }] })).errors).has('R3a'));
  // duplicate id (R3b)
  assert.ok(ruleSet(lintBoard(JSON.stringify({ schema: 'cc-master/v1', goal: 'g', owner: { active: true, session_id: 's' }, git: {}, tasks: [{ id: 'X', status: 'ready', deps: [] }, { id: 'X', status: 'done', deps: [] }] })).errors).has('R3b'));
  // deps present but not an array (R3d)
  assert.ok(ruleSet(lintBoard(JSON.stringify({ schema: 'cc-master/v1', goal: 'g', owner: { active: true, session_id: 's' }, git: {}, tasks: [{ id: 'X', status: 'ready', deps: 'T0' }] })).errors).has('R3d'));
});

test('R3d: missing deps is a hard error (deps is a required narrow-waist field, not a flexible edge)', () => {
  // board.md §narrow-waist: {id,status,deps} are the pinned per-task triplet (line 208). The
  // "flexible edges that may be omitted" list (line 210) is title/artifact/wip_limit/三时间戳 —
  // it does NOT include deps. A task missing deps is a malformed waist, exactly what lint must catch
  // (the real error: an agent hand-edits tasks[] and forgets deps; silently defaulting to [] hid it).
  const r = lintBoard(JSON.stringify({ schema: 'cc-master/v1', goal: 'g', owner: { active: true, session_id: 's' }, git: { worktree: '', branch: '' }, tasks: [{ id: 'X', status: 'ready' }] }));
  assert.ok(ruleSet(r.errors).has('R3d'), 'omitting deps is a hard R3d error (required waist field)');
  // agent-friendly: names the task and tells the fix (add "deps": []).
  const e = r.errors.find((x) => x.rule === 'R3d');
  assert.match(e.message, /deps/, 'message points at deps');
  assert.match(e.message, /\[\]/, 'message tells how to fix (add "deps": [])');
});

test('R4: deps-graph integrity (dangling / self-loop / cycle) are hard errors', () => {
  // R4a dangling
  assert.ok(ruleSet(lintBoard(JSON.stringify({ schema: 'cc-master/v1', goal: 'g', owner: { active: true, session_id: 's' }, git: {}, tasks: [{ id: 'T7', status: 'ready', deps: ['GONE'] }] })).errors).has('R4a'));
  // R4b self-loop
  assert.ok(ruleSet(lintBoard(JSON.stringify({ schema: 'cc-master/v1', goal: 'g', owner: { active: true, session_id: 's' }, git: {}, tasks: [{ id: 'S', status: 'ready', deps: ['S'] }] })).errors).has('R4b'));
  // R4c cycle
  assert.ok(ruleSet(lintBoard(JSON.stringify({ schema: 'cc-master/v1', goal: 'g', owner: { active: true, session_id: 's' }, git: {}, tasks: [{ id: 'A', status: 'ready', deps: ['B'] }, { id: 'B', status: 'ready', deps: ['A'] }] })).errors).has('R4c'));
});

// ── R7：nesting 不变式（D3.3 / PR-2·路 ii lint 侧）─────────────────────────────────────────────
// 口径与 board-graph-core.js 的 rollupConsistency()/checkDepth1()/parentCycles() 完全一致（同语义两处实现）。
const withTasks = (tasks) => JSON.stringify({
  schema: 'cc-master/v1', goal: 'g', owner: { active: true, session_id: 's' }, git: { worktree: '', branch: '' }, tasks,
});

test('R7a: parent pointing at a nonexistent id is a hard error (dangling parent, 类比 R4a)', () => {
  const r = lintBoard(withTasks([{ id: 'C', status: 'ready', deps: [], parent: 'GHOST' }]));
  assert.ok(ruleSet(r.errors).has('R7a'), 'R7a dangling parent is hard error');
  const e = r.errors.find((x) => x.rule === 'R7a');
  assert.match(e.message, /GHOST/, 'names the missing owner id so agent can locate it');
});

test('R7b: depth>1 (owner 的子又有子) is a hard error', () => {
  // M1 是 owner（C 的 parent）；C 自己又是 GC 的 parent —— C 既是子又是父 = depth>1。
  const r = lintBoard(withTasks([
    { id: 'M1', status: 'in_flight', deps: [] },
    { id: 'C', status: 'in_flight', deps: [], parent: 'M1' },
    { id: 'GC', status: 'ready', deps: [], parent: 'C' },
  ]));
  assert.ok(ruleSet(r.errors).has('R7b'), 'R7b depth>1 is hard error');
});

test('R7c: parent self-loop is a hard error', () => {
  const r = lintBoard(withTasks([{ id: 'A', status: 'ready', deps: [], parent: 'A' }]));
  assert.ok(ruleSet(r.errors).has('R7c'), 'R7c parent self-loop is hard error');
});

test('R7c: parent 2-cycle (A.parent=B, B.parent=A) is a hard error', () => {
  const r = lintBoard(withTasks([
    { id: 'A', status: 'ready', deps: [], parent: 'B' },
    { id: 'B', status: 'ready', deps: [], parent: 'A' },
  ]));
  assert.ok(ruleSet(r.errors).has('R7c'), 'R7c parent 2-cycle is hard error');
});

test('R7e: malformed parent (key present, value not a non-empty string) is a hard error', () => {
  // parent 是硬 waist 字段（ADR-012·单值 string 或缺省）。畸形值会被 buildGraph 静默丢弃 → R7 误当顶层节点、
  // rollup/depth=1 保护静默失效。一个 typo（数组 / 数字 / 空串）必须硬报错。口径对齐 R3d（deps 类型 hard error）。

  // 数组 parent:["M1"] → hard R7e
  const arr = lintBoard(withTasks([
    { id: 'M1', status: 'in_flight', deps: [] },
    { id: 'C', status: 'ready', deps: [], parent: ['M1'] },
  ]));
  assert.ok(ruleSet(arr.errors).has('R7e'), 'array parent is hard R7e');
  const e = arr.errors.find((x) => x.rule === 'R7e');
  assert.equal(e.task, 'C', 'names the offending task so agent can locate it');
  assert.match(e.message, /parent/, 'message points at parent');

  // 数字 parent:123 → hard R7e
  const num = lintBoard(withTasks([{ id: 'C', status: 'ready', deps: [], parent: 123 }]));
  assert.ok(ruleSet(num.errors).has('R7e'), 'numeric parent is hard R7e');

  // 空串 parent:"" → hard R7e（空 string 非合法 owner 引用）
  const empty = lintBoard(withTasks([{ id: 'C', status: 'ready', deps: [], parent: '' }]));
  assert.ok(ruleSet(empty.errors).has('R7e'), 'empty-string parent is hard R7e');
});

test('R7e: legal parent ("M1") and absent parent produce no R7e error', () => {
  // 合法单值 string parent — 不报 R7e（M1 是存在的 owner）。
  const legal = lintBoard(withTasks([
    { id: 'M1', status: 'in_flight', deps: [] },
    { id: 'C', status: 'ready', deps: [], parent: 'M1' },
  ]));
  assert.equal(legal.errors.filter((e) => e.rule === 'R7e').length, 0, 'legal string parent: no R7e');

  // 无 parent 键 — 缺省合法顶层节点，silent-on-unknown 不破。
  const absent = lintBoard(withTasks([{ id: 'C', status: 'ready', deps: [] }]));
  assert.equal(absent.errors.filter((e) => e.rule === 'R7e').length, 0, 'absent parent: no R7e');
});

test('R7d: done owner with a non-done child WARNS (not a hard fail — 容瞬态)', () => {
  const r = lintBoard(withTasks([
    { id: 'M1', status: 'done', deps: [] },
    { id: 'M1.a', status: 'done', deps: [], parent: 'M1' },
    { id: 'M1.b', status: 'in_flight', deps: [], parent: 'M1' },
  ]));
  assert.equal(r.errors.length, 0, 'R7d is warn-only, never a hard error: ' + JSON.stringify(r.errors));
  assert.ok(ruleSet(r.warnings).has('R7d'), 'R7d rollup inconsistency warns');
  const w = r.warnings.find((x) => x.rule === 'R7d');
  assert.match(w.message, /M1\.b/, 'names the non-done child');
});

test('R7: legal nested board (owner + all-done children) is clean — zero R7 errors/warnings', () => {
  const r = lintBoard(withTasks([
    { id: 'M1', status: 'done', deps: [] },
    { id: 'M1.a', status: 'done', deps: [], parent: 'M1' },
    { id: 'M1.b', status: 'done', deps: ['M1.a'], parent: 'M1' },
  ]));
  assert.equal(r.errors.filter((e) => e.rule.startsWith('R7')).length, 0, 'no R7 errors: ' + JSON.stringify(r.errors));
  assert.equal(r.warnings.filter((w) => w.rule.startsWith('R7')).length, 0, 'no R7 warnings: ' + JSON.stringify(r.warnings));
});

test('R7 backward-compat: a board with NO parent fields produces zero R7 errors/warnings (silent-on-unknown)', () => {
  // The default-shaped GOOD board (flat, no parent) must stay completely clean under R7.
  const r = lintBoard(GOOD);
  assert.equal(r.errors.length, 0, 'old flat board: zero errors');
  assert.equal(r.warnings.length, 0, 'old flat board: zero warnings');
});

test('R5/R6: degradable fields only WARN, never hard-fail', () => {
  const r = lintBoard(JSON.stringify({
    schema: 'cc-master/v1', goal: 'g', owner: { active: true, session_id: 's' }, git: { worktree: '', branch: '' },
    tasks: [{ id: 'T1', status: 'in_flight', deps: [], started_at: '12:18Z' }, { id: 'T9', status: 'blocked', deps: [], blocked_on: 'T8' }],
  }));
  assert.equal(r.errors.length, 0, 'R5/R6 are warn-only, never hard errors');
  const w = ruleSet(r.warnings);
  assert.ok(w.has('R5b'), 'R5b dangling blocked_on warns');
  assert.ok(w.has('R6a'), 'R6a bad timestamp format warns');
});

test('红线2: arbitrary agent-shaped fields produce NO errors and NO warnings (silent-on-unknown)', () => {
  const r = lintBoard(JSON.stringify({
    schema: 'cc-master/v1', goal: 'g', owner: { active: true, session_id: 's' }, git: { worktree: '', branch: '' },
    invented_top: 42, weird: { nested: true },
    tasks: [{ id: 'T0', status: 'done', deps: [], artifact: 'x', whatever_i_want: [1, 2], notes: 'free' }],
  }));
  assert.equal(r.errors.length, 0, JSON.stringify(r.errors));
  assert.equal(r.warnings.length, 0, JSON.stringify(r.warnings));
});

test('agent-friendly report: errors carry rule + human message + how-to-fix (not a stack trace)', () => {
  const r = lintBoard(JSON.stringify({ schema: 'cc-master/v1', goal: 'g', owner: { active: true, session_id: 's' }, git: {}, tasks: [{ id: 'T7', status: 'ready', deps: ['T5'] }] }));
  const e = r.errors.find((x) => x.rule === 'R4a');
  assert.ok(e, 'R4a present');
  assert.ok(typeof e.message === 'string' && e.message.length > 0, 'has a human message');
  assert.match(e.message, /T5/, 'names the missing id so agent can locate it');
});
