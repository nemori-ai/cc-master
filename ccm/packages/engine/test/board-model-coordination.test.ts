// board-model-coordination.test.ts — coordination 块字段 + FMT-COORD 规则契约门（COORD·设计稿 §3.1）。

import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as M from '../dist/index.mjs';

// ── board-model：FIELDS.board.coordination 存在且 tier=✎（agent-shaped 非窄腰）─────────────────────
test('FIELDS.board.coordination exists with tier=✎ (agent-shaped non-waist)', () => {
  assert.ok(M.FIELDS.board.coordination, 'FIELDS.board.coordination must exist');
  assert.equal(M.FIELDS.board.coordination.tier, '✎');
});

// ── ENUMS：coordPriority 五挡（有序 urgent>high>normal>low>trivial）─────────────────────────────────
test('ENUMS.coordPriority has the five priority tiers in order', () => {
  assert.deepEqual(M.ENUMS.coordPriority, ['urgent', 'high', 'normal', 'low', 'trivial']);
});

// ── INVARIANTS：FMT-COORD 登记在册（warn·FMT 家族）────────────────────────────────────────────────
test('INVARIANTS includes FMT-COORD at warn level', () => {
  const inv = M.INVARIANTS.find((i: { id: string }) => i.id === 'FMT-COORD');
  assert.ok(inv, 'FMT-COORD must be in INVARIANTS');
  assert.equal(inv.level, 'warn');
  assert.equal(inv.family, 'FMT');
});

// ── lintBoard：FMT-COORD 触发场景 ────────────────────────────────────────────────────────────────

function makeBoard(coordination?: unknown): object {
  const board: Record<string, unknown> = {
    schema: 'cc-master/v2',
    goal: 'coord test',
    tasks: [],
    owner: { active: true, session_id: '' },
    git: { worktree: '', branch: '' },
  };
  if (coordination !== undefined) board.coordination = coordination;
  return board;
}

test('valid full coordination block produces 0 errors 0 warnings', () => {
  const co = {
    priority: 'high',
    state: {
      current: { active_tasks: 3, workload: 'building auth', burn_contribution: 18 },
      planned: { remaining_work: 'finish migration', cost_to_complete_pct: 24 },
    },
  };
  const result = M.lintBoard(JSON.stringify(makeBoard(co)));
  assert.equal(result.errors.length, 0);
  assert.equal(result.warnings.length, 0);
});

test('minimal coordination {priority:"urgent"} produces 0 errors 0 warnings', () => {
  const result = M.lintBoard(JSON.stringify(makeBoard({ priority: 'urgent' })));
  assert.equal(result.errors.length, 0);
  assert.equal(result.warnings.length, 0);
});

test('FMT-COORD never produces hard errors (all warn·advisory ✎)', () => {
  // 各种坏形态——全应是 warn（0 errors），不阻断写盘（fail-safe 退单板·非阻塞）。
  for (const bad of [42, ['urgent'], { priority: 'maybe' }, { state: 99 }]) {
    const result = M.lintBoard(JSON.stringify(makeBoard(bad)));
    assert.equal(
      result.errors.length,
      0,
      `coordination=${JSON.stringify(bad)} must not hard-error`,
    );
  }
});

test('FMT-COORD warns when coordination is a non-object scalar', () => {
  const result = M.lintBoard(JSON.stringify(makeBoard(42)));
  const warn = result.warnings.find((w: { rule: string }) => w.rule === 'FMT-COORD');
  assert.ok(warn, 'must warn FMT-COORD on non-object coordination');
});

test('FMT-COORD warns on invalid priority value', () => {
  const result = M.lintBoard(JSON.stringify(makeBoard({ priority: 'maybe' })));
  const warn = result.warnings.find((w: { rule: string }) => w.rule === 'FMT-COORD');
  assert.ok(warn, 'must warn FMT-COORD on invalid priority');
});

test('FMT-COORD warns on non-numeric burn_contribution', () => {
  const co = { state: { current: { burn_contribution: 'lots' } } };
  const result = M.lintBoard(JSON.stringify(makeBoard(co)));
  const warn = result.warnings.find((w: { rule: string }) => w.rule === 'FMT-COORD');
  assert.ok(warn, 'must warn FMT-COORD on non-numeric burn_contribution');
});

test('FMT-COORD warns on non-numeric cost_to_complete_pct', () => {
  const co = { state: { planned: { cost_to_complete_pct: 'a lot' } } };
  const result = M.lintBoard(JSON.stringify(makeBoard(co)));
  const warn = result.warnings.find((w: { rule: string }) => w.rule === 'FMT-COORD');
  assert.ok(warn, 'must warn FMT-COORD on non-numeric cost_to_complete_pct');
});

test('FMT-COORD warns when state.current is not an object', () => {
  const result = M.lintBoard(JSON.stringify(makeBoard({ state: { current: 5 } })));
  const warn = result.warnings.find((w: { rule: string }) => w.rule === 'FMT-COORD');
  assert.ok(warn, 'must warn FMT-COORD on non-object state.current');
});

test('FMT-COORD does not fire when coordination is absent', () => {
  const result = M.lintBoard(JSON.stringify(makeBoard()));
  const warn = result.warnings.find((w: { rule: string }) => w.rule === 'FMT-COORD');
  assert.equal(warn, undefined, 'no FMT-COORD when coordination absent');
});

test('FMT-COORD does not fire when coordination is null', () => {
  const result = M.lintBoard(JSON.stringify(makeBoard(null)));
  const warn = result.warnings.find((w: { rule: string }) => w.rule === 'FMT-COORD');
  assert.equal(warn, undefined, 'no FMT-COORD when coordination is null');
});
