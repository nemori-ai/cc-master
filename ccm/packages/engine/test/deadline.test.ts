// deadline.test.ts — 交付 DDL（goal_contract.deadline·issue #149）引擎层契约门。
//
// 覆盖：
//   · ENUMS deadlineState/Kind/Precision/Source 闭集。
//   · normalizeDeadlineAt：minute 只收严格 ISO UTC；day 落当日末刻 23:59:59Z；非 ISO / 坏日期 → null。
//   · readDeadline：键缺失=pending/gating；none/asserted/confirmed 视图；rev 读取。
//   · isDeadlineWellShaped：state/at/none/precision/kind(v1 hard-only)/rev/provenance 全谱。
//   · isDeadlineSettled。
//   · lintBoard 三规则：FMT-DEADLINE hard、BIZ-DEADLINE-PENDING warn、BIZ-DEADLINE-OVERDUE warn（含 now 注入）。
//   · legacy 兼容（无 goal_contract / 无 deadline → 三规则早返回·板仍合法）。

import assert from 'node:assert/strict';
import { test } from 'node:test';
// node 原生 type-stripping 不把 `.js`→`.ts` 重映射，对有内部依赖的模块须 import 构建产物 dist/index.mjs
//   （与 board-model.test.ts / board-lint-core.test.ts 同型·turbo test 依赖 build）。
import {
  ENUMS,
  isDeadlineSettled,
  isDeadlineWellShaped,
  lintBoard,
  normalizeDeadlineAt,
  readDeadline,
} from '../dist/index.mjs';

// ── 基线合法板（含已激活 goal_contract）────────────────────────────────────────────────────────────
function baseBoard(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: 'cc-master/v2',
    meta: { template_version: 3 },
    goal: 'ship the thing',
    goal_contract: {
      schema: 'ccm/goal-contract/v1',
      revision: 1,
      assurance: 'asserted',
      updated_at: '2026-07-16T10:00:00Z',
    },
    owner: { active: true, session_id: 'sid-dl', heartbeat: '2026-07-16T10:00:00Z' },
    git: { worktree: '', branch: '' },
    scheduling: { wip_limit: 4 },
    tasks: [],
    log: [],
    ...overrides,
  };
}

function withDeadline(deadline: unknown, extra: Record<string, unknown> = {}) {
  const b = baseBoard(extra);
  (b.goal_contract as Record<string, unknown>).deadline = deadline;
  return b;
}

// ── ENUMS ──────────────────────────────────────────────────────────────────────────────────────────
test('ENUMS deadline* are closed sets', () => {
  assert.deepEqual(ENUMS.deadlineState, ['pending', 'asserted', 'confirmed', 'none']);
  assert.deepEqual(ENUMS.deadlineKind, ['hard', 'soft']);
  assert.deepEqual(ENUMS.deadlinePrecision, ['minute', 'day']);
  assert.deepEqual(ENUMS.deadlineSource, ['goal-evidence', 'cli-flag', 'user-reply']);
});

// ── normalizeDeadlineAt ─────────────────────────────────────────────────────────────────────────────
test('normalizeDeadlineAt: minute keeps strict ISO, rejects non-ISO (agent-only tz normalization)', () => {
  assert.equal(normalizeDeadlineAt('2026-08-01T09:00:00Z', 'minute'), '2026-08-01T09:00:00Z');
  assert.equal(normalizeDeadlineAt('2026-08-01T09:00:00Z'), '2026-08-01T09:00:00Z'); // default minute
  assert.equal(normalizeDeadlineAt('8月1日下午5点', 'minute'), null);
  assert.equal(normalizeDeadlineAt('2026-08-01', 'minute'), null); // date-only not ISO for minute
  assert.equal(normalizeDeadlineAt('2026-08-01T09:00:00.123Z', 'minute'), null); // millis not accepted
  assert.equal(normalizeDeadlineAt('', 'minute'), null);
  assert.equal(normalizeDeadlineAt(undefined, 'minute'), null);
});

test('normalizeDeadlineAt: day lands on end-of-day 23:59:59Z from date prefix', () => {
  assert.equal(normalizeDeadlineAt('2026-08-01', 'day'), '2026-08-01T23:59:59Z');
  // full ISO with day precision → still forced to end-of-day (avoid treating 当日交付 as 00:00)
  assert.equal(normalizeDeadlineAt('2026-08-01T09:00:00Z', 'day'), '2026-08-01T23:59:59Z');
  // invalid calendar date rejected
  assert.equal(normalizeDeadlineAt('2026-13-40', 'day'), null);
  assert.equal(normalizeDeadlineAt('nope', 'day'), null);
});

test('normalizeDeadlineAt: day rejects trailing garbage (anchored·非 prefix match)', () => {
  // 裸日期尾部垃圾 → null（旧 prefix match 会抽出 2026-08-01 误收）。
  assert.equal(normalizeDeadlineAt('2026-08-01oops', 'day'), null);
  // 完整 ISO 后接垃圾 → null（旧 prefix match 会抽日期前缀丢尾部误收）。
  assert.equal(normalizeDeadlineAt('2026-08-01T09:00:00Z garbage', 'day'), null);
  // 非严格 ISO 形态（无 Z / 带毫秒）在 day 下也不作完整 ISO 接受。
  assert.equal(normalizeDeadlineAt('2026-08-01T09:00:00', 'day'), null);
  assert.equal(normalizeDeadlineAt('2026-08-01T09:00:00.123Z', 'day'), null);
  // 回归保护：合法裸日期 + 合法完整 ISO 仍被接受、落当日末刻。
  assert.equal(normalizeDeadlineAt('2026-08-01', 'day'), '2026-08-01T23:59:59Z');
  assert.equal(normalizeDeadlineAt('2026-08-01T09:00:00Z', 'day'), '2026-08-01T23:59:59Z');
});

// ── readDeadline ────────────────────────────────────────────────────────────────────────────────────
test('readDeadline: missing key = pending/gating (未询问·≠ none)', () => {
  const view = readDeadline(baseBoard());
  assert.equal(view.present, false);
  assert.equal(view.state, 'pending');
  assert.equal(view.gating, true);
  assert.equal(view.settled, false);
  assert.equal(view.at, null);
  assert.equal(view.rev, null);
});

test('readDeadline: none is settled and distinct from missing', () => {
  const view = readDeadline(
    withDeadline({ state: 'none', rev: 2, updated_at: '2026-07-16T11:00:00Z' }),
  );
  assert.equal(view.present, true);
  assert.equal(view.state, 'none');
  assert.equal(view.settled, true);
  assert.equal(view.gating, false);
  assert.equal(view.at, null);
  assert.equal(view.rev, 2);
});

test('readDeadline: confirmed exposes at/at_ms/precision/kind/rev', () => {
  const view = readDeadline(
    withDeadline({
      state: 'confirmed',
      at: '2026-08-01T09:00:00Z',
      precision: 'minute',
      kind: 'hard',
      rev: 3,
      updated_at: '2026-07-16T11:00:00Z',
    }),
  );
  assert.equal(view.state, 'confirmed');
  assert.equal(view.settled, true);
  assert.equal(view.at, '2026-08-01T09:00:00Z');
  assert.equal(view.at_ms, Date.parse('2026-08-01T09:00:00Z'));
  assert.equal(view.rev, 3);
});

test('isDeadlineSettled: pending/absent false; asserted/confirmed/none true', () => {
  assert.equal(isDeadlineSettled(baseBoard()), false);
  assert.equal(
    isDeadlineSettled(withDeadline({ state: 'pending', updated_at: '2026-07-16T11:00:00Z' })),
    false,
  );
  assert.equal(
    isDeadlineSettled(
      withDeadline({
        state: 'asserted',
        at: '2026-08-01T09:00:00Z',
        updated_at: '2026-07-16T11:00:00Z',
      }),
    ),
    true,
  );
  assert.equal(
    isDeadlineSettled(withDeadline({ state: 'none', updated_at: '2026-07-16T11:00:00Z' })),
    true,
  );
});

// ── isDeadlineWellShaped ────────────────────────────────────────────────────────────────────────────
test('isDeadlineWellShaped: valid shapes', () => {
  assert.equal(
    isDeadlineWellShaped({ state: 'pending', updated_at: '2026-07-16T11:00:00Z' }),
    true,
  );
  assert.equal(
    isDeadlineWellShaped({ state: 'pending', at: '2026-08-01T09:00:00Z' }),
    true, // pending 可带暂定候选 at（§3.2）
  );
  assert.equal(
    isDeadlineWellShaped({ state: 'asserted', at: '2026-08-01T09:00:00Z', rev: 1 }),
    true,
  );
  assert.equal(
    isDeadlineWellShaped({
      state: 'confirmed',
      at: '2026-08-01T09:00:00Z',
      kind: 'hard',
      precision: 'day',
    }),
    true,
  );
  assert.equal(isDeadlineWellShaped({ state: 'none' }), true);
  assert.equal(
    isDeadlineWellShaped({
      state: 'asserted',
      at: '2026-08-01T09:00:00Z',
      provenance: { raw: '8月1日', source: 'user-reply', tz_input: 'Asia/Shanghai' },
    }),
    true,
  );
});

test('isDeadlineWellShaped: invalid shapes rejected', () => {
  assert.equal(isDeadlineWellShaped({ state: 'bogus' }), false); // bad enum
  assert.equal(isDeadlineWellShaped({ state: 'asserted' }), false); // asserted needs at
  assert.equal(isDeadlineWellShaped({ state: 'confirmed', at: '2026-08-01' }), false); // at not strict ISO
  assert.equal(isDeadlineWellShaped({ state: 'none', at: '2026-08-01T09:00:00Z' }), false); // none must not have at
  assert.equal(isDeadlineWellShaped({ state: 'pending', at: 'not-iso' }), false); // pending at must be ISO if present
  assert.equal(
    isDeadlineWellShaped({ state: 'asserted', at: '2026-08-01T09:00:00Z', precision: 'week' }),
    false,
  );
  assert.equal(
    isDeadlineWellShaped({ state: 'asserted', at: '2026-08-01T09:00:00Z', kind: 'soft' }),
    false,
  ); // v1 hard-only
  assert.equal(
    isDeadlineWellShaped({ state: 'asserted', at: '2026-08-01T09:00:00Z', rev: 0 }),
    false,
  ); // rev>=1
  assert.equal(
    isDeadlineWellShaped({
      state: 'asserted',
      at: '2026-08-01T09:00:00Z',
      provenance: { source: 'bad' },
    }),
    false,
  );
  assert.equal(isDeadlineWellShaped(null), false);
  assert.equal(isDeadlineWellShaped([]), false);
});

// ── lint FMT-DEADLINE (hard) ────────────────────────────────────────────────────────────────────────
function ruleHit(
  res: { errors: { rule: string }[]; warnings: { rule: string }[] },
  rule: string,
): 'hard' | 'warn' | null {
  if (res.errors.some((e) => e.rule === rule)) return 'hard';
  if (res.warnings.some((e) => e.rule === rule)) return 'warn';
  return null;
}

test('lint: legacy board (no goal_contract) is valid, no deadline rules fire', () => {
  const legacy = baseBoard();
  delete (legacy as Record<string, unknown>).goal_contract;
  const res = lintBoard(JSON.stringify(legacy));
  assert.equal(res.errors.length, 0);
  assert.equal(ruleHit(res, 'FMT-DEADLINE'), null);
  assert.equal(ruleHit(res, 'BIZ-DEADLINE-PENDING'), null);
});

test('lint: goal_contract with no deadline key is valid (未询问·early return)', () => {
  const res = lintBoard(JSON.stringify(baseBoard()));
  assert.equal(res.errors.length, 0);
  assert.equal(ruleHit(res, 'FMT-DEADLINE'), null);
});

test('lint: FMT-DEADLINE hard error on malformed deadline shape', () => {
  const bad = withDeadline({ state: 'confirmed' }); // confirmed without at
  const res = lintBoard(JSON.stringify(bad));
  assert.equal(ruleHit(res, 'FMT-DEADLINE'), 'hard');
});

test('lint: FMT-DEADLINE hard error rejects kind soft (v1)', () => {
  const bad = withDeadline({ state: 'asserted', at: '2026-08-01T09:00:00Z', kind: 'soft' });
  assert.equal(ruleHit(lintBoard(JSON.stringify(bad)), 'FMT-DEADLINE'), 'hard');
});

test('lint: FMT-DEADLINE hard error rejects none with at', () => {
  const bad = withDeadline({ state: 'none', at: '2026-08-01T09:00:00Z' });
  assert.equal(ruleHit(lintBoard(JSON.stringify(bad)), 'FMT-DEADLINE'), 'hard');
});

test('lint: deadline.updated_at bad → FMT-TIME warn (not hard·不拦写盘)', () => {
  const b = withDeadline({ state: 'asserted', at: '2026-08-01T09:00:00Z', updated_at: 'nope' });
  const res = lintBoard(JSON.stringify(b));
  assert.equal(ruleHit(res, 'FMT-DEADLINE'), null); // shape OK
  assert.equal(ruleHit(res, 'FMT-TIME'), 'warn');
});

// ── lint BIZ-DEADLINE-PENDING (warn) ────────────────────────────────────────────────────────────────
test('lint: BIZ-DEADLINE-PENDING warns when deadline unsettled + executable task', () => {
  const b = baseBoard({ tasks: [{ id: 'T1', status: 'ready', deps: [] }] });
  const res = lintBoard(JSON.stringify(b));
  assert.equal(ruleHit(res, 'BIZ-DEADLINE-PENDING'), 'warn');
});

test('lint: BIZ-DEADLINE-PENDING silent once deadline settled', () => {
  const b = withDeadline(
    { state: 'confirmed', at: '2027-08-01T09:00:00Z', updated_at: '2026-07-16T11:00:00Z' },
    { tasks: [{ id: 'T1', status: 'ready', deps: [] }] },
  );
  assert.equal(ruleHit(lintBoard(JSON.stringify(b)), 'BIZ-DEADLINE-PENDING'), null);
});

test('lint: BIZ-DEADLINE-PENDING silent when no executable task', () => {
  const b = baseBoard({ tasks: [{ id: 'T1', status: 'blocked', deps: [] }] });
  assert.equal(ruleHit(lintBoard(JSON.stringify(b)), 'BIZ-DEADLINE-PENDING'), null);
});

// ── lint BIZ-DEADLINE-OVERDUE (warn·now 注入) ────────────────────────────────────────────────────────
test('lint: BIZ-DEADLINE-OVERDUE warns when now >= at and work incomplete', () => {
  const b = withDeadline(
    { state: 'confirmed', at: '2026-08-01T09:00:00Z', updated_at: '2026-07-16T11:00:00Z' },
    { tasks: [{ id: 'T1', status: 'ready', deps: [] }] },
  );
  const res = lintBoard(JSON.stringify(b), { now: '2026-08-02T00:00:00Z' });
  assert.equal(ruleHit(res, 'BIZ-DEADLINE-OVERDUE'), 'warn');
});

test('lint: BIZ-DEADLINE-OVERDUE silent before deadline', () => {
  const b = withDeadline(
    { state: 'confirmed', at: '2026-08-01T09:00:00Z', updated_at: '2026-07-16T11:00:00Z' },
    { tasks: [{ id: 'T1', status: 'ready', deps: [] }] },
  );
  const res = lintBoard(JSON.stringify(b), { now: '2026-07-20T00:00:00Z' });
  assert.equal(ruleHit(res, 'BIZ-DEADLINE-OVERDUE'), null);
});

test('lint: BIZ-DEADLINE-OVERDUE silent when board archived (owner.active=false)', () => {
  const b = withDeadline(
    { state: 'confirmed', at: '2026-08-01T09:00:00Z', updated_at: '2026-07-16T11:00:00Z' },
    {
      owner: { active: false, session_id: '', heartbeat: '2026-07-16T10:00:00Z' },
      tasks: [{ id: 'T1', status: 'ready', deps: [] }],
    },
  );
  const res = lintBoard(JSON.stringify(b), { now: '2026-08-02T00:00:00Z' });
  assert.equal(ruleHit(res, 'BIZ-DEADLINE-OVERDUE'), null);
});

test('lint: BIZ-DEADLINE-OVERDUE silent when all tasks trulyDone', () => {
  const b = withDeadline(
    { state: 'confirmed', at: '2026-08-01T09:00:00Z', updated_at: '2026-07-16T11:00:00Z' },
    { tasks: [{ id: 'T1', status: 'done', verified: true, artifact: 'PR#1', deps: [] }] },
  );
  const res = lintBoard(JSON.stringify(b), { now: '2026-08-02T00:00:00Z' });
  assert.equal(ruleHit(res, 'BIZ-DEADLINE-OVERDUE'), null);
});
