// board-lint-agents.test.ts — @ccm/engine·Agent Registry lint 规则契约门（FMT-AGENTS + BIZ-INFLIGHT-AGENT）。
//   两条都是 warn（软约束·非 hard 闸）。消费 build 后的 dist 公开面（与下游一致）。

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { levelOf, lintBoard } from '../dist/index.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROUTED_TASK = JSON.parse(
  readFileSync(join(HERE, 'fixtures', 'cross-harness-routing', 'same-harness-cli.json'), 'utf8'),
).task;
const ROUTING_CONTRACTS = {
  task_planning: 'ccm/task-planning/v1',
  agent_routing: 'ccm/agent-routing/v1',
  agent_routing_activated_at: '2026-07-10T08:00:00Z',
  agent_routing_grandfathered_terminal: [],
};

const J = (o: unknown) => JSON.stringify(o);
const ruleSet = (arr: { rule: string }[]) => new Set(arr.map((v) => v.rule));
const errs = (r: { errors: { rule: string }[] }) => ruleSet(r.errors);
const warns = (r: { warnings: { rule: string }[] }) => ruleSet(r.warnings);

// 干净基座（无 in_flight 任务·不触发 BIZ-INFLIGHT-AGENT）。
const BASE = {
  schema: 'cc-master/v2',
  meta: { template_version: 3 },
  goal: 'g',
  owner: { active: true, session_id: 's' },
  git: { worktree: '/w', branch: 'b' },
  tasks: [{ id: 'T1', status: 'ready', deps: [] }],
};
const withAgents = (agents: unknown) => J({ ...BASE, agents });

const GOOD_AGENT = {
  id: 'agt-001',
  type: 'cli-worker',
  harness: 'codex',
  intent: 'review diff',
  launch: { created_at: '2026-07-16T08:00:00Z' },
  handle: { kind: 'session-id', value: '0197-abc' },
  lifecycle: { state: 'running', registered_at: '2026-07-16T08:00:00Z', ended_at: null, outcome: null },
  probe: {
    last_probe_at: '2026-07-16T08:05:00Z',
    method: 'session-file-mtime',
    observed: 'alive',
    as_of: '2026-07-16T08:05:00Z',
  },
  account_ref: null,
  quota_pool_ref: null,
};

// ── 级别 SSOT ────────────────────────────────────────────────────────────────────────────────────
test('FMT-AGENTS and BIZ-INFLIGHT-AGENT are warn (soft, non-blocking)', () => {
  assert.equal(levelOf('FMT-AGENTS'), 'warn');
  assert.equal(levelOf('BIZ-INFLIGHT-AGENT'), 'warn');
});

// ── FMT-AGENTS 正例 ───────────────────────────────────────────────────────────────────────────────
test('well-formed agents[] → no FMT-AGENTS', () => {
  const r = lintBoard(withAgents([GOOD_AGENT]));
  assert.ok(!warns(r).has('FMT-AGENTS'), J(r.warnings));
  assert.ok(!errs(r).has('FMT-AGENTS'));
});

test('absent agents section → no FMT-AGENTS', () => {
  const r = lintBoard(J(BASE));
  assert.ok(!warns(r).has('FMT-AGENTS'));
});

// ── FMT-AGENTS 反例 ───────────────────────────────────────────────────────────────────────────────
test('agents not an array → FMT-AGENTS warn', () => {
  assert.ok(warns(lintBoard(withAgents({ nope: 1 }))).has('FMT-AGENTS'));
});

test('bad id syntax → FMT-AGENTS warn', () => {
  const r = lintBoard(withAgents([{ ...GOOD_AGENT, id: '-bad id!' }]));
  assert.ok(warns(r).has('FMT-AGENTS'));
});

test('duplicate agent ids → FMT-AGENTS warn', () => {
  const r = lintBoard(withAgents([GOOD_AGENT, { ...GOOD_AGENT }]));
  assert.ok(warns(r).has('FMT-AGENTS'));
});

test('bad type enum → FMT-AGENTS warn', () => {
  assert.ok(warns(lintBoard(withAgents([{ ...GOOD_AGENT, type: 'daemon' }]))).has('FMT-AGENTS'));
});

test('bad harness enum → FMT-AGENTS warn', () => {
  assert.ok(warns(lintBoard(withAgents([{ ...GOOD_AGENT, harness: 'gemini' }]))).has('FMT-AGENTS'));
});

test('bad lifecycle.state enum → FMT-AGENTS warn', () => {
  const r = lintBoard(withAgents([{ ...GOOD_AGENT, lifecycle: { state: 'zombie' } }]));
  assert.ok(warns(r).has('FMT-AGENTS'));
});

test('bad handle.kind enum → FMT-AGENTS warn', () => {
  const r = lintBoard(withAgents([{ ...GOOD_AGENT, handle: { kind: 'url', value: 'x' } }]));
  assert.ok(warns(r).has('FMT-AGENTS'));
});

test('bad probe.observed / probe.method enum → FMT-AGENTS warn', () => {
  const bo = lintBoard(
    withAgents([{ ...GOOD_AGENT, probe: { ...GOOD_AGENT.probe, observed: 'dead' } }]),
  );
  assert.ok(warns(bo).has('FMT-AGENTS'));
  const bm = lintBoard(
    withAgents([{ ...GOOD_AGENT, probe: { ...GOOD_AGENT.probe, method: 'ouija' } }]),
  );
  assert.ok(warns(bm).has('FMT-AGENTS'));
});

test('non-ISO time anchor → FMT-AGENTS warn', () => {
  const r = lintBoard(withAgents([{ ...GOOD_AGENT, launch: { created_at: 'yesterday' } }]));
  assert.ok(warns(r).has('FMT-AGENTS'));
});

test('links[] with empty task_id → FMT-AGENTS warn', () => {
  const r = lintBoard(withAgents([{ ...GOOD_AGENT, links: [{ task_id: '' }] }]));
  assert.ok(warns(r).has('FMT-AGENTS'));
});

test('account_ref/quota_pool_ref non-string non-null → FMT-AGENTS warn', () => {
  const r = lintBoard(withAgents([{ ...GOOD_AGENT, account_ref: 42 }]));
  assert.ok(warns(r).has('FMT-AGENTS'));
});

test('account_ref/quota_pool_ref as string ref (reserved) → no FMT-AGENTS', () => {
  const r = lintBoard(
    withAgents([{ ...GOOD_AGENT, account_ref: 'acct-7', quota_pool_ref: 'pool-a' }]),
  );
  assert.ok(!warns(r).has('FMT-AGENTS'), J(r.warnings));
});

// ── BIZ-INFLIGHT-AGENT ───────────────────────────────────────────────────────────────────────────
const inflightBoard = (extra: Record<string, unknown> = {}) =>
  J({
    ...BASE,
    tasks: [{ id: 'T9', status: 'in_flight', deps: [], started_at: '2026-07-16T08:00:00Z' }],
    ...extra,
  });

test('in_flight task with no agent registration → BIZ-INFLIGHT-AGENT warn', () => {
  assert.ok(warns(lintBoard(inflightBoard())).has('BIZ-INFLIGHT-AGENT'));
});

test('in_flight task linked via agents[].links[] → no BIZ-INFLIGHT-AGENT', () => {
  const linked = inflightBoard({
    agents: [{ ...GOOD_AGENT, links: [{ task_id: 'T9', linked_at: '2026-07-16T08:00:00Z' }] }],
  });
  assert.ok(!warns(lintBoard(linked)).has('BIZ-INFLIGHT-AGENT'), linked);
});

test('non-in_flight tasks never trigger BIZ-INFLIGHT-AGENT', () => {
  const r = lintBoard(J({ ...BASE, tasks: [{ id: 'T1', status: 'ready', deps: [] }] }));
  assert.ok(!warns(r).has('BIZ-INFLIGHT-AGENT'));
});

// ── agent_ref 旁路引用合法性：attempt 上加 agent_ref 不破冻结 routing 合同、且抑制 BIZ-INFLIGHT-AGENT ──
test('agent_ref on a routed attempt is a legal bypass reference (no new routing hard error)', () => {
  const base = J({
    ...BASE,
    meta: { template_version: 3, contracts: ROUTING_CONTRACTS },
    tasks: [ROUTED_TASK],
  });
  const withRef = structuredClone(ROUTED_TASK);
  withRef.routing.attempts[0].agent_ref = 'agt-001';
  const withRefBoard = J({
    ...BASE,
    meta: { template_version: 3, contracts: ROUTING_CONTRACTS },
    tasks: [withRef],
  });
  const before = lintBoard(base);
  const after = lintBoard(withRefBoard);
  // 冻结 routing 合同校验对未知字段 agent_ref 容忍——加它前后 routing 硬规则集合不变。
  for (const rule of ['FMT-TASK-ROUTING', 'BIZ-ROUTE-ATTEMPT-REQUIRED', 'BIZ-ROUTE-SELECTION-REQUIRED']) {
    assert.equal(errs(after).has(rule), errs(before).has(rule), `${rule} changed by agent_ref`);
  }
  // 且 attempt.agent_ref 抑制 BIZ-INFLIGHT-AGENT（in_flight 已登记）。
  assert.ok(!warns(after).has('BIZ-INFLIGHT-AGENT'), J(after.warnings));
});
