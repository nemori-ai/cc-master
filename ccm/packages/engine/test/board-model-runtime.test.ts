// board-model-runtime.test.ts — runtime 参数区字段 + FMT-RUNTIME 规则契约门（ADR-020）。
//
// runtime 是 hook-owned ✎ 参数区（IDNUDGE 周期提示写 last_identity_remind）。本测试钉死：
//   ① FIELDS.board.runtime 存在且 tier=✎（非窄腰·红线2 不破）；
//   ② INVARIANTS 含 FMT-RUNTIME（warn·非 hard·缺/坏一律 graceful-degrade）；
//   ③ lintBoard 的 FMT-RUNTIME 触发场景全是 warning（errors.length===0），含缺省优雅降级。

import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as M from '../dist/index.mjs';

// ── board-model：FIELDS.board.runtime 存在且 tier=✎ ────────────────────────
test('FIELDS.board.runtime exists with tier=✎ (hook-owned non-waist param region)', () => {
  assert.ok(M.FIELDS.board.runtime, 'FIELDS.board.runtime must exist');
  assert.equal(M.FIELDS.board.runtime.tier, '✎');
});

// ── INVARIANTS：FMT-RUNTIME 登记在册（warn·FMT·board scope）─────────────────
test('INVARIANTS includes FMT-RUNTIME at warn level (board scope)', () => {
  const inv = M.INVARIANTS.find((i: { id: string }) => i.id === 'FMT-RUNTIME');
  assert.ok(inv, 'FMT-RUNTIME must be in INVARIANTS');
  assert.equal(inv.level, 'warn');
  assert.equal(inv.family, 'FMT');
  assert.equal(inv.scope, 'board');
});

// ── lintBoard：FMT-RUNTIME 触发场景（全 warn·永不 hard）────────────────────
function makeBoard(runtime?: unknown): object {
  const board: Record<string, unknown> = {
    schema: 'cc-master/v2',
    goal: 'runtime test',
    tasks: [],
    owner: { active: true, session_id: '' },
    git: { worktree: '', branch: '' },
  };
  if (runtime !== undefined) board.runtime = runtime;
  return board;
}

test('no runtime field → 0 errors 0 warnings (graceful: absent = never reminded)', () => {
  const result = M.lintBoard(JSON.stringify(makeBoard()));
  assert.equal(result.errors.length, 0);
  assert.equal(result.warnings.filter((w: { rule: string }) => w.rule === 'FMT-RUNTIME').length, 0);
});

test('valid runtime {last_identity_remind: ISO} → 0 errors 0 FMT-RUNTIME warnings', () => {
  const result = M.lintBoard(
    JSON.stringify(makeBoard({ last_identity_remind: '2026-06-29T12:34:56Z' })),
  );
  assert.equal(result.errors.length, 0);
  assert.equal(result.warnings.filter((w: { rule: string }) => w.rule === 'FMT-RUNTIME').length, 0);
});

test('empty runtime {} → 0 errors 0 FMT-RUNTIME warnings (silent-on-unknown)', () => {
  const result = M.lintBoard(JSON.stringify(makeBoard({})));
  assert.equal(result.errors.length, 0);
  assert.equal(result.warnings.filter((w: { rule: string }) => w.rule === 'FMT-RUNTIME').length, 0);
});

test('FMT-RUNTIME warns (NOT hard) when runtime is a non-object scalar (42)', () => {
  const result = M.lintBoard(JSON.stringify(makeBoard(42)));
  assert.equal(result.errors.length, 0, 'must be warn, never hard');
  assert.ok(
    result.warnings.find((w: { rule: string }) => w.rule === 'FMT-RUNTIME'),
    'must warn FMT-RUNTIME on non-object runtime',
  );
});

test('FMT-RUNTIME warns when runtime is an array', () => {
  const result = M.lintBoard(JSON.stringify(makeBoard(['x'])));
  assert.equal(result.errors.length, 0);
  assert.ok(result.warnings.find((w: { rule: string }) => w.rule === 'FMT-RUNTIME'));
});

test('FMT-RUNTIME warns when last_identity_remind is a non-ISO string', () => {
  const result = M.lintBoard(JSON.stringify(makeBoard({ last_identity_remind: 'not-iso' })));
  assert.equal(result.errors.length, 0);
  assert.ok(
    result.warnings.find((w: { rule: string }) => w.rule === 'FMT-RUNTIME'),
    'non-ISO timestamp → FMT-RUNTIME warn',
  );
});

// last_critpath_remind 是 runtime 时间锚第二成员（critpath-nudge·hooks-enhancements-v2 ②）：合法 ISO 0 warn，
//   非 ISO → FMT-RUNTIME warn（与 last_identity_remind 同口径）。
test('valid runtime {last_critpath_remind: ISO} → 0 errors 0 FMT-RUNTIME warnings', () => {
  const result = M.lintBoard(
    JSON.stringify(makeBoard({ last_critpath_remind: '2026-06-30T08:00:00Z' })),
  );
  assert.equal(result.errors.length, 0);
  assert.equal(result.warnings.filter((w: { rule: string }) => w.rule === 'FMT-RUNTIME').length, 0);
});

test('FMT-RUNTIME warns when last_critpath_remind is a non-ISO string', () => {
  const result = M.lintBoard(JSON.stringify(makeBoard({ last_critpath_remind: 'not-iso' })));
  assert.equal(result.errors.length, 0);
  assert.ok(
    result.warnings.find((w: { rule: string }) => w.rule === 'FMT-RUNTIME'),
    'non-ISO last_critpath_remind → FMT-RUNTIME warn',
  );
});

// stop_allow_until 是 Codex Stop decision:block 的显式释放阀：合法 ISO 0 warn，
//   非 ISO → FMT-RUNTIME warn（同属 runtime 参数区）。
test('valid runtime {stop_allow_until: ISO} → 0 errors 0 FMT-RUNTIME warnings', () => {
  const result = M.lintBoard(
    JSON.stringify(makeBoard({ stop_allow_until: '2026-07-03T15:30:00Z' })),
  );
  assert.equal(result.errors.length, 0);
  assert.equal(result.warnings.filter((w: { rule: string }) => w.rule === 'FMT-RUNTIME').length, 0);
});

test('FMT-RUNTIME warns when stop_allow_until is a non-ISO string', () => {
  const result = M.lintBoard(JSON.stringify(makeBoard({ stop_allow_until: 'not-iso' })));
  assert.equal(result.errors.length, 0);
  assert.ok(
    result.warnings.find((w: { rule: string }) => w.rule === 'FMT-RUNTIME'),
    'non-ISO stop_allow_until → FMT-RUNTIME warn',
  );
});

// 未知键 silent-on-unknown：未来同形成员复用本规则·扩展位无须改 lint（只校验已知键）。
test('unknown runtime key (silent-on-unknown) → no FMT-RUNTIME warning', () => {
  const result = M.lintBoard(JSON.stringify(makeBoard({ some_future_hook_key: 'whatever' })));
  assert.equal(result.errors.length, 0);
  assert.equal(result.warnings.filter((w: { rule: string }) => w.rule === 'FMT-RUNTIME').length, 0);
});
