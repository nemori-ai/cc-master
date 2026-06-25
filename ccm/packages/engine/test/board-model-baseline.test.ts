// board-model-baseline.test.ts — baseline + model 字段 + FMT-BASELINE/FMT-MODEL 规则契约门（P1·ADR-015）。

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import * as M from '../dist/index.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, 'fixtures', 'boards', 'current', 'baseline-example.board.json');

// ── board-model：FIELDS.board.baseline / task.model 存在且 tier=✎ ─────────────────
test('FIELDS.board.baseline exists with tier=✎ (agent-shaped non-waist)', () => {
  assert.ok(M.FIELDS.board.baseline, 'FIELDS.board.baseline must exist');
  assert.equal(M.FIELDS.board.baseline.tier, '✎');
});

test('FIELDS.task.model exists with tier=✎', () => {
  assert.ok(M.FIELDS.task.model, 'FIELDS.task.model must exist');
  assert.equal(M.FIELDS.task.model.tier, '✎');
});

// ── INVARIANTS：FMT-BASELINE + FMT-MODEL 登记在册 ────────────────────────────────
test('INVARIANTS includes FMT-BASELINE at warn level', () => {
  const inv = M.INVARIANTS.find((i: { id: string }) => i.id === 'FMT-BASELINE');
  assert.ok(inv, 'FMT-BASELINE must be in INVARIANTS');
  assert.equal(inv.level, 'warn');
  assert.equal(inv.family, 'FMT');
});

test('INVARIANTS includes FMT-MODEL at warn level', () => {
  const inv = M.INVARIANTS.find((i: { id: string }) => i.id === 'FMT-MODEL');
  assert.ok(inv, 'FMT-MODEL must be in INVARIANTS');
  assert.equal(inv.level, 'warn');
  assert.equal(inv.family, 'FMT');
});

// ── lintBoard：fixture 零 error 零 warning ──────────────────────────────────────
test('baseline-example fixture lints clean (0 errors, 0 warnings)', () => {
  const text = readFileSync(FIXTURE, 'utf8');
  const result = M.lintBoard(text);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.warnings, []);
});

// ── lintBoard：FMT-BASELINE 触发场景 ────────────────────────────────────────────
test('FMT-BASELINE warns on baseline with non-ISO captured_at', () => {
  const board = {
    schema: 'cc-master/v2',
    goal: 'test',
    tasks: [],
    owner: { active: true, session_id: '' },
    git: { worktree: '', branch: '' },
    baseline: {
      captured_at: 'not-a-date',
      t0: '2026-06-25T08:00:00Z',
      task_estimates: {},
      dag_snapshot: {},
      bac_h: 0,
      history: [],
    },
  };
  const result = M.lintBoard(JSON.stringify(board));
  assert.equal(result.errors.length, 0);
  const warn = result.warnings.find((w: { rule: string }) => w.rule === 'FMT-BASELINE');
  assert.ok(warn, 'must warn FMT-BASELINE on bad captured_at');
});

test('FMT-BASELINE warns when baseline is a non-object scalar', () => {
  const board = {
    schema: 'cc-master/v2',
    goal: 'test',
    tasks: [],
    owner: { active: true, session_id: '' },
    git: { worktree: '', branch: '' },
    baseline: 42,
  };
  const result = M.lintBoard(JSON.stringify(board));
  assert.equal(result.errors.length, 0);
  const warn = result.warnings.find((w: { rule: string }) => w.rule === 'FMT-BASELINE');
  assert.ok(warn, 'must warn FMT-BASELINE on non-object baseline');
});

test('FMT-BASELINE does not fire when baseline is absent', () => {
  const board = {
    schema: 'cc-master/v2',
    goal: 'test',
    tasks: [],
    owner: { active: true, session_id: '' },
    git: { worktree: '', branch: '' },
  };
  const result = M.lintBoard(JSON.stringify(board));
  const warn = result.warnings.find((w: { rule: string }) => w.rule === 'FMT-BASELINE');
  assert.equal(warn, undefined, 'no FMT-BASELINE when baseline absent');
});

// ── lintBoard：FMT-MODEL 触发场景 ───────────────────────────────────────────────
test('FMT-MODEL warns when task.model is a non-string value', () => {
  const board = {
    schema: 'cc-master/v2',
    goal: 'test',
    owner: { active: true, session_id: '' },
    git: { worktree: '', branch: '' },
    tasks: [{ id: 'T1', status: 'ready', deps: [], model: 42 }],
  };
  const result = M.lintBoard(JSON.stringify(board));
  const warn = result.warnings.find((w: { rule: string }) => w.rule === 'FMT-MODEL');
  assert.ok(warn, 'must warn FMT-MODEL on non-string model');
});

test('FMT-MODEL does not fire when task.model is a string', () => {
  const board = {
    schema: 'cc-master/v2',
    goal: 'test',
    owner: { active: true, session_id: '' },
    git: { worktree: '', branch: '' },
    tasks: [{ id: 'T1', status: 'ready', deps: [], model: 'claude-sonnet-4-5' }],
  };
  const result = M.lintBoard(JSON.stringify(board));
  const warn = result.warnings.find((w: { rule: string }) => w.rule === 'FMT-MODEL');
  assert.equal(warn, undefined, 'no FMT-MODEL for string model');
});

test('FMT-MODEL does not fire when task.model is absent', () => {
  const board = {
    schema: 'cc-master/v2',
    goal: 'test',
    owner: { active: true, session_id: '' },
    git: { worktree: '', branch: '' },
    tasks: [{ id: 'T1', status: 'ready', deps: [] }],
  };
  const result = M.lintBoard(JSON.stringify(board));
  const warn = result.warnings.find((w: { rule: string }) => w.rule === 'FMT-MODEL');
  assert.equal(warn, undefined, 'no FMT-MODEL when absent');
});
