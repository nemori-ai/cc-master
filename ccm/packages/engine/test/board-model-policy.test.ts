// board-model-policy.test.ts — policy 字段 + FMT-POLICY 规则契约门。

import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as M from '../dist/index.mjs';

// ── board-model：FIELDS.board.policy 存在且 tier=✎ ────────────────────────
test('FIELDS.board.policy exists with tier=✎ (agent-shaped non-waist)', () => {
  assert.ok(M.FIELDS.board.policy, 'FIELDS.board.policy must exist');
  assert.equal(M.FIELDS.board.policy.tier, '✎');
});

// ── ENUMS：accountSwitchPolicy 登记在册 ─────────────────────────────────────
test('ENUMS.accountSwitchPolicy contains allow and deny', () => {
  assert.ok(Array.isArray(M.ENUMS.accountSwitchPolicy), 'must be an array');
  assert.ok(M.ENUMS.accountSwitchPolicy.includes('allow'), 'must include allow');
  assert.ok(M.ENUMS.accountSwitchPolicy.includes('deny'), 'must include deny');
});

// ── INVARIANTS：FMT-POLICY 登记在册 ─────────────────────────────────────────
test('INVARIANTS includes FMT-POLICY at warn level', () => {
  const inv = M.INVARIANTS.find((i: { id: string }) => i.id === 'FMT-POLICY');
  assert.ok(inv, 'FMT-POLICY must be in INVARIANTS');
  assert.equal(inv.level, 'warn');
  assert.equal(inv.family, 'FMT');
});

// ── lintBoard：FMT-POLICY 触发场景 ──────────────────────────────────────────

function makeBoard(policy?: unknown): object {
  const board: Record<string, unknown> = {
    schema: 'cc-master/v2',
    goal: 'policy test',
    tasks: [],
    owner: { active: true, session_id: '' },
    git: { worktree: '', branch: '' },
  };
  if (policy !== undefined) board.policy = policy;
  return board;
}

test('valid policy {autonomous_account_switch:"deny"} produces 0 errors 0 warnings', () => {
  const result = M.lintBoard(JSON.stringify(makeBoard({ autonomous_account_switch: 'deny' })));
  assert.equal(result.errors.length, 0);
  assert.equal(result.warnings.length, 0);
});

test('valid policy {autonomous_account_switch:"allow"} produces 0 errors 0 warnings', () => {
  const result = M.lintBoard(JSON.stringify(makeBoard({ autonomous_account_switch: 'allow' })));
  assert.equal(result.errors.length, 0);
  assert.equal(result.warnings.length, 0);
});

test('FMT-POLICY warns when policy is a non-object scalar (42)', () => {
  const result = M.lintBoard(JSON.stringify(makeBoard(42)));
  assert.equal(result.errors.length, 0);
  const warn = result.warnings.find((w: { rule: string }) => w.rule === 'FMT-POLICY');
  assert.ok(warn, 'must warn FMT-POLICY on non-object policy');
});

test('FMT-POLICY warns when policy is an array', () => {
  const result = M.lintBoard(JSON.stringify(makeBoard(['allow'])));
  assert.equal(result.errors.length, 0);
  const warn = result.warnings.find((w: { rule: string }) => w.rule === 'FMT-POLICY');
  assert.ok(warn, 'must warn FMT-POLICY on array policy');
});

test('FMT-POLICY warns when autonomous_account_switch is an invalid value "maybe"', () => {
  const result = M.lintBoard(JSON.stringify(makeBoard({ autonomous_account_switch: 'maybe' })));
  assert.equal(result.errors.length, 0);
  const warn = result.warnings.find((w: { rule: string }) => w.rule === 'FMT-POLICY');
  assert.ok(warn, 'must warn FMT-POLICY on invalid autonomous_account_switch');
});

test('FMT-POLICY does not fire when policy is absent', () => {
  const result = M.lintBoard(JSON.stringify(makeBoard()));
  const warn = result.warnings.find((w: { rule: string }) => w.rule === 'FMT-POLICY');
  assert.equal(warn, undefined, 'no FMT-POLICY when policy absent');
});

test('FMT-POLICY does not fire when policy is null', () => {
  const result = M.lintBoard(JSON.stringify(makeBoard(null)));
  const warn = result.warnings.find((w: { rule: string }) => w.rule === 'FMT-POLICY');
  assert.equal(warn, undefined, 'no FMT-POLICY when policy is null');
});
