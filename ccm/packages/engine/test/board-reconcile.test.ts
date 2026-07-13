// board-reconcile.test.ts — reconcileGating（deps 驱动 ready↔blocked 门控归一）+ BIZ-STATUS-DEPS 契约门（ADR-023）。
//   测 build 后的 dist 公开 API barrel（同 board-graph-core.test.ts 注·NodeNext .js specifier 直跑解析不了）。

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lintBoard, reconcileGating } from '../dist/index.mjs';

// 小 board 构造糖：tasks → 一个合法 board 对象。
const board = (tasks: unknown[], extra: Record<string, unknown> = {}) => ({
  schema: 'cc-master/v2',
  goal: 'g',
  owner: { active: true, session_id: '' },
  git: { worktree: '', branch: '' },
  tasks,
  ...extra,
});

const byId = (b: { tasks: Array<{ id: string; status: string }> }) =>
  Object.fromEntries(b.tasks.map((t) => [t.id, t.status]));

// ── reconcileGating：核心归一语义 ────────────────────────────────────────────────────────────────────
test('ready 但 deps 未全 done → 归一为 blocked', () => {
  const out = reconcileGating(
    board([
      { id: 'T1', status: 'in_flight', deps: [] },
      { id: 'T2', status: 'ready', deps: ['T1'] },
    ]),
  );
  assert.equal(byId(out).T2, 'blocked');
});

test('blocked 无 blocked_on 但 deps 全 done → 归一为 ready', () => {
  const out = reconcileGating(
    board([
      { id: 'T1', status: 'done', deps: [] },
      { id: 'T2', status: 'blocked', deps: ['T1'] },
    ]),
  );
  assert.equal(byId(out).T2, 'ready');
});

test('legacy done dep without dependency_gate remains satisfied', () => {
  const out = reconcileGating(
    board([
      { id: 'R1', status: 'done', deps: [], verified: true, artifact: '/abs/review.md' },
      { id: 'I1', status: 'blocked', deps: ['R1'] },
    ]),
  );
  assert.equal(byId(out).I1, 'ready');
});

test('review-gated dep with REQUEST-CHANGES keeps downstream blocked', () => {
  const out = reconcileGating(
    board([
      {
        id: 'R1',
        status: 'done',
        deps: [],
        verified: true,
        artifact: '/abs/review.md',
        dependency_gate: { kind: 'review', required_verdict: 'APPROVE' },
        review_verdict: 'REQUEST-CHANGES',
      },
      { id: 'I1', status: 'blocked', deps: ['R1'] },
    ]),
  );
  assert.equal(byId(out).I1, 'blocked');
});

test('review-gated dep with missing/empty/null verdict keeps downstream blocked', () => {
  for (const review_verdict of [undefined, '', null]) {
    const review: Record<string, unknown> = {
      id: 'R1',
      status: 'done',
      deps: [],
      verified: true,
      artifact: '/abs/review.md',
      dependency_gate: { kind: 'review', required_verdict: 'APPROVE' },
    };
    if (review_verdict !== undefined) review.review_verdict = review_verdict;
    const out = reconcileGating(board([review, { id: 'I1', status: 'blocked', deps: ['R1'] }]));
    assert.equal(byId(out).I1, 'blocked', `verdict=${String(review_verdict)}`);
  }
});

test('review-gated dep with APPROVE readies downstream', () => {
  const out = reconcileGating(
    board([
      {
        id: 'R1',
        status: 'done',
        deps: [],
        verified: true,
        artifact: '/abs/review.md',
        dependency_gate: { kind: 'review', required_verdict: 'APPROVE' },
        review_verdict: 'APPROVE',
      },
      { id: 'I1', status: 'blocked', deps: ['R1'] },
    ]),
  );
  assert.equal(byId(out).I1, 'ready');
});

test('ready 且 deps 全 done → 保持 ready（幂等·无变化）', () => {
  const out = reconcileGating(
    board([
      { id: 'T1', status: 'done', deps: [] },
      { id: 'T2', status: 'ready', deps: ['T1'] },
    ]),
  );
  assert.equal(byId(out).T2, 'ready');
});

test('无上游（deps 空）→ ready', () => {
  const out = reconcileGating(board([{ id: 'T1', status: 'blocked', deps: [] }]));
  assert.equal(byId(out).T1, 'ready');
});

test('有 blocked_on=user（语义阻塞）→ 整体豁免：deps 全 done 也不翻', () => {
  const out = reconcileGating(
    board([
      { id: 'T1', status: 'done', deps: [] },
      {
        id: 'T2',
        status: 'blocked',
        deps: ['T1'],
        blocked_on: 'user',
        decision_package: {},
      },
    ]),
  );
  assert.equal(byId(out).T2, 'blocked');
});

test('有 blocked_on=<taskid>（语义阻塞）→ 豁免', () => {
  const out = reconcileGating(
    board([
      { id: 'T1', status: 'done', deps: [] },
      { id: 'T2', status: 'blocked', deps: ['T1'], blocked_on: 'T1' },
    ]),
  );
  assert.equal(byId(out).T2, 'blocked');
});

test('非 ready/blocked 态（in_flight/done/failed/escalated/stale/uncertain）一律不碰', () => {
  const states = ['in_flight', 'done', 'failed', 'escalated', 'stale', 'uncertain'];
  for (const s of states) {
    const out = reconcileGating(
      board([
        { id: 'T1', status: 'in_flight', deps: [] }, // 未 done 上游
        { id: 'T2', status: s, deps: ['T1'] },
      ]),
    );
    assert.equal(byId(out).T2, s, `${s} 应保持不变`);
  }
});

test('不产生新 done（无级联）：done 数量在归一前后一致', () => {
  const out = reconcileGating(
    board([
      { id: 'T1', status: 'done', deps: [] },
      { id: 'T2', status: 'blocked', deps: ['T1'] }, // → ready
      { id: 'T3', status: 'ready', deps: ['T2'] }, // T2 非 done → blocked
    ]),
  );
  const s = byId(out);
  assert.equal(s.T2, 'ready');
  assert.equal(s.T3, 'blocked'); // 单趟：T2 归一为 ready（非 done），故 T3 判 blocked（无级联传播）
  assert.equal(out.tasks.filter((t) => t.status === 'done').length, 1);
});

test('幂等：再跑一次结果稳定', () => {
  const once = reconcileGating(
    board([
      { id: 'T1', status: 'done', deps: [] },
      { id: 'T2', status: 'ready', deps: ['T3'] },
      { id: 'T3', status: 'blocked', deps: ['T1'] },
    ]),
  );
  const twice = reconcileGating(once);
  assert.deepEqual(byId(twice), byId(once));
});

test('纯函数：不 alias 入参（原 board 的 status 不被改）', () => {
  const input = board([
    { id: 'T1', status: 'in_flight', deps: [] },
    { id: 'T2', status: 'ready', deps: ['T1'] },
  ]);
  const out = reconcileGating(input);
  assert.equal(input.tasks[1].status, 'ready', '入参不被 mutate');
  assert.equal(out.tasks[1].status, 'blocked', '返回的新板被归一');
});

test('坏输入（null / 非对象 / 无 tasks）→ 原样返回不抛', () => {
  assert.equal(reconcileGating(null), null);
  assert.equal(reconcileGating(undefined), undefined);
  const noTasks = { schema: 'cc-master/v2', goal: 'g' };
  assert.equal(reconcileGating(noTasks), noTasks);
});

// ── BIZ-STATUS-DEPS：lint warn（精确等于「reconcile 本应改动此 task」）───────────────────────────────
const warnRules = (text: string) => lintBoard(text).warnings.map((w: { rule: string }) => w.rule);

test('BIZ-STATUS-DEPS warns：ready 但 deps 未全 done', () => {
  const text = JSON.stringify(
    board([
      { id: 'T1', status: 'in_flight', deps: [], started_at: '2026-06-25T08:00:00Z' },
      { id: 'T2', status: 'ready', deps: ['T1'] },
    ]),
  );
  assert.ok(warnRules(text).includes('BIZ-STATUS-DEPS'));
});

test('BIZ-STATUS-DEPS warns：blocked 无 blocked_on 但 deps 全 done', () => {
  const text = JSON.stringify(
    board([
      { id: 'T1', status: 'done', deps: [], finished_at: '2026-06-25T08:00:00Z' },
      { id: 'T2', status: 'blocked', deps: ['T1'] },
    ]),
  );
  assert.ok(warnRules(text).includes('BIZ-STATUS-DEPS'));
});

test('BIZ-STATUS-DEPS 不报：一致态（reconcile 后的板 lint 干净）', () => {
  const consistent = board([
    { id: 'T1', status: 'in_flight', deps: [], started_at: '2026-06-25T08:00:00Z' },
    { id: 'T2', status: 'blocked', deps: ['T1'] }, // deps 未 done → blocked 正确
  ]);
  assert.ok(!warnRules(JSON.stringify(consistent)).includes('BIZ-STATUS-DEPS'));
  // 且经 reconcile 的板必然 lint 无 BIZ-STATUS-DEPS（互补性验证）。
  const reconciled = reconcileGating(
    board([
      { id: 'T1', status: 'done', deps: [], finished_at: '2026-06-25T08:00:00Z' },
      { id: 'T2', status: 'ready', deps: ['T3'] },
      { id: 'T3', status: 'blocked', deps: ['T1'] },
    ]),
  );
  assert.ok(!warnRules(JSON.stringify(reconciled)).includes('BIZ-STATUS-DEPS'));
});

test('BIZ-STATUS-DEPS 不报：有 blocked_on 的语义阻塞（即便 deps 全 done）', () => {
  const text = JSON.stringify(
    board([
      { id: 'T1', status: 'done', deps: [], finished_at: '2026-06-25T08:00:00Z' },
      {
        id: 'T2',
        status: 'blocked',
        deps: ['T1'],
        blocked_on: 'user',
        decision_package: {
          context_md: 'x',
          what_i_need: 'y',
          ask_type: 'advice',
          inputs_hash: `sha256:${'a'.repeat(64)}`,
          enter_cmd: 'z',
        },
      },
    ]),
  );
  assert.ok(!warnRules(text).includes('BIZ-STATUS-DEPS'));
});

test('INVARIANTS 登记 BIZ-STATUS-DEPS 为 warn/BIZ', async () => {
  const { INVARIANTS } = await import('../dist/index.mjs');
  const inv = INVARIANTS.find((i: { id: string }) => i.id === 'BIZ-STATUS-DEPS');
  assert.ok(inv, 'BIZ-STATUS-DEPS must be registered');
  assert.equal(inv.level, 'warn');
  assert.equal(inv.family, 'BIZ');
});
