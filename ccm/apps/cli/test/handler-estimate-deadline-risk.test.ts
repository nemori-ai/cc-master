// handler-estimate-deadline-risk.test.ts — `ccm estimate deadline-risk` 端点契约门（issue #149·契约 §4.3·D3B）。
//   wired handler：读 goal_contract.deadline（readDeadline）→ buildMcParams → computeDeadlineRisk → §4.3 JSON。
//   断言 wiring / schema 稳定 / 诚实降级 / 零写；精确 band 数学在 engine 层（deadline-risk-endpoint.test.ts）验。

import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { Ctx } from '../src/handlers/_common.js';
import * as estimateHandler from '../src/handlers/estimate.js';
import * as io from '../src/io.js';

const EXIT = io.EXIT;
const __dirname = dirname(fileURLToPath(import.meta.url));
const FIX = resolve(__dirname, '../../../packages/engine/test/fixtures/boards');
const ACTIVE = JSON.parse(
  readFileSync(resolve(FIX, 'current/active-estimate-engine.board.json'), 'utf8'),
);
const NOW = '2026-06-25T12:00:00Z';

// 跨板语料 home（home-corpus·40 done → historyN=40·confidence high → on_track 可达）。
const HOME_CORPUS = (() => {
  const root = mkdtempSync(join(tmpdir(), 'ccm-ddl-home-'));
  cpSync(resolve(FIX, 'home-corpus'), join(root, 'boards'), { recursive: true });
  return root;
})();

let TMP: string[] = [];
afterEach(() => {
  TMP = [];
});

// mkBoardWithDeadline(deadline|null) → 临时板文件（clone ACTIVE + 注入 goal_contract.deadline）。
function mkBoardWithDeadline(deadline: Record<string, unknown> | null): string {
  const root = mkdtempSync(join(tmpdir(), 'ccm-ddl-board-'));
  TMP.push(root);
  const b = JSON.parse(JSON.stringify(ACTIVE));
  b.goal_contract = {
    schema: 'ccm/goal-contract/v1',
    revision: 1,
    assurance: 'confirmed',
    updated_at: '2026-06-25T10:00:00Z',
  };
  if (deadline) b.goal_contract.deadline = deadline;
  const bp = join(root, 'target.board.json');
  writeFileSync(bp, JSON.stringify(b));
  return bp;
}

// confirmed 截止期在 as-of 之后 offsetHours 小时处。
function confirmedDeadline(offsetHours: number): Record<string, unknown> {
  const atMs = Date.parse(NOW) + offsetHours * 3600000;
  return {
    state: 'confirmed',
    at: new Date(atMs).toISOString().replace(/\.\d{3}Z$/, 'Z'),
    precision: 'minute',
    kind: 'hard',
    rev: 1,
    updated_at: '2026-06-25T10:00:00Z',
  };
}

type TestCtx = Ctx & { outBuf: string[] };
function mkCtx(boardPath: string, values: Record<string, unknown> = {}, json = true): TestCtx {
  const outBuf: string[] = [];
  return {
    values: { board: boardPath, home: HOME_CORPUS, 'as-of': NOW, ...values },
    positionals: [],
    flags: {
      json,
      dryRun: false,
      force: false,
      yes: false,
      quiet: false,
      verbose: false,
      color: false,
    },
    sid: '',
    env: { CC_MASTER_HOME: HOME_CORPUS },
    out: (s: string) => outBuf.push(s),
    err: () => {},
    isTTY: true,
    outBuf,
  } as TestCtx;
}
function dataOf(ctx: TestCtx): any {
  return JSON.parse(ctx.outBuf.join('')).data;
}

// ── wiring + schema ────────────────────────────────────────────────────────────────────
test('deadline-risk: wired end-to-end → §4.3 schema keys present', () => {
  const bp = mkBoardWithDeadline(confirmedDeadline(500));
  const ctx = mkCtx(bp, { scope: 'home', seed: '42', runs: '2000' });
  const code = estimateHandler.deadlineRisk(ctx);
  assert.equal(code, EXIT.OK);
  const d = dataOf(ctx);
  for (const k of [
    'deadline',
    'deadline_state',
    'as_of',
    'time_remaining_hours',
    'on_time_probability',
    'on_time_probability_source',
    'forecast',
    'margin',
    'risk_band',
    'strength',
    'channels',
    'channel_disagreement',
    'coverage_pct',
    'confidence',
    'history_n',
    'scope',
    'calibration_status',
    'top_drivers',
    'runs',
    'rcpsp_runs',
    'seed',
    'source',
    'notes',
  ])
    assert.ok(k in d, `missing key ${k}`);
  assert.equal(d.deadline_state, 'confirmed');
  assert.equal(d.calibration_status, 'uncalibrated-conservative');
  assert.equal(d.history_n, 40, 'home corpus → 40 done records');
});

test('deadline-risk: loose DDL + confident corpus → on_track, source rcpsp-in-trial', () => {
  const bp = mkBoardWithDeadline(confirmedDeadline(500));
  const ctx = mkCtx(bp, { scope: 'home', seed: '42' });
  estimateHandler.deadlineRisk(ctx);
  const d = dataOf(ctx);
  assert.equal(d.risk_band, 'on_track');
  assert.equal(d.on_time_probability_source, 'rcpsp-in-trial');
  assert.ok(d.on_time_probability >= 0.9);
  assert.equal(d.channels.resource_aware.source, 'rcpsp-in-trial');
});

test('deadline-risk: on_time_probability_source is always rcpsp-in-trial or unknown (never throughput)', () => {
  for (const off of [500, 25, 8]) {
    const bp = mkBoardWithDeadline(confirmedDeadline(off));
    const ctx = mkCtx(bp, { scope: 'home', seed: '42' });
    estimateHandler.deadlineRisk(ctx);
    const d = dataOf(ctx);
    assert.ok(
      d.on_time_probability_source === 'rcpsp-in-trial' ||
        d.on_time_probability_source === 'unknown',
      `source ${d.on_time_probability_source} must be rcpsp-in-trial|unknown`,
    );
    // throughput 只作 heuristic 参考（若存在）·绝不是 verdict 源。
    if (d.channels.throughput_reference)
      assert.equal(d.channels.throughput_reference.kind, 'heuristic-reference');
  }
});

// ── 诚实降级 ───────────────────────────────────────────────────────────────────────────
test('deadline-risk: overdue when DDL in the past + unfinished backlog', () => {
  const bp = mkBoardWithDeadline(confirmedDeadline(-2));
  const ctx = mkCtx(bp, { scope: 'home', seed: '42' });
  estimateHandler.deadlineRisk(ctx);
  const d = dataOf(ctx);
  assert.equal(d.risk_band, 'overdue');
  assert.equal(d.strength, 'strong');
  assert.ok(d.time_remaining_hours < 0);
});

test('deadline-risk: soft overdue → weak advisory (issue #169)', () => {
  const dl = confirmedDeadline(-2);
  dl.kind = 'soft';
  const bp = mkBoardWithDeadline(dl);
  const ctx = mkCtx(bp, { scope: 'home', seed: '42' });
  estimateHandler.deadlineRisk(ctx);
  const d = dataOf(ctx);
  assert.equal(d.risk_band, 'overdue');
  assert.equal(d.strength, 'weak');
});

test('deadline-risk: no deadline key (pending) → unknown, null probability (不假绿)', () => {
  const bp = mkBoardWithDeadline(null); // goal_contract 存在但无 deadline 键
  const ctx = mkCtx(bp, { scope: 'home', seed: '42' });
  const code = estimateHandler.deadlineRisk(ctx);
  assert.equal(code, EXIT.OK);
  const d = dataOf(ctx);
  assert.equal(d.risk_band, 'unknown');
  assert.equal(d.on_time_probability, null);
  assert.equal(d.on_time_probability_source, 'unknown');
  assert.equal(d.deadline, null);
  assert.equal(d.channels.resource_aware, null);
});

test('deadline-risk: state none (confirmed no-DDL) → unknown, no false-green', () => {
  const bp = mkBoardWithDeadline({ state: 'none', rev: 2, updated_at: '2026-06-25T10:00:00Z' });
  const ctx = mkCtx(bp, { scope: 'home', seed: '42' });
  estimateHandler.deadlineRisk(ctx);
  const d = dataOf(ctx);
  assert.equal(d.risk_band, 'unknown');
  assert.equal(d.on_time_probability, null);
});

test('deadline-risk: asserted deadline is settled → produces verdict (not unknown-for-no-DDL)', () => {
  const dl = confirmedDeadline(500);
  dl.state = 'asserted';
  const bp = mkBoardWithDeadline(dl);
  const ctx = mkCtx(bp, { scope: 'home', seed: '42' });
  estimateHandler.deadlineRisk(ctx);
  const d = dataOf(ctx);
  assert.equal(d.deadline_state, 'asserted');
  assert.ok(d.deadline != null, 'asserted DDL has an at');
  assert.notEqual(d.risk_band, undefined);
  assert.equal(d.on_time_probability_source, 'rcpsp-in-trial');
});

// ── 确定性 + 零写 ──────────────────────────────────────────────────────────────────────
test('deadline-risk: deterministic for same seed', () => {
  const bp = mkBoardWithDeadline(confirmedDeadline(25));
  const a = mkCtx(bp, { scope: 'home', seed: '42' });
  const b = mkCtx(bp, { scope: 'home', seed: '42' });
  estimateHandler.deadlineRisk(a);
  estimateHandler.deadlineRisk(b);
  assert.deepEqual(dataOf(a), dataOf(b));
});

test('deadline-risk: zero-write invariant (board byte-identical after read)', () => {
  const bp = mkBoardWithDeadline(confirmedDeadline(25));
  const before = readFileSync(bp, 'utf8');
  estimateHandler.deadlineRisk(mkCtx(bp, { scope: 'home', seed: '42' }));
  assert.equal(readFileSync(bp, 'utf8'), before, 'deadline-risk never writes the board');
});

test('deadline-risk: --effective-n only scales throughput reference (never the verdict)', () => {
  const bp = mkBoardWithDeadline(confirmedDeadline(25));
  const base = mkCtx(bp, { scope: 'home', seed: '42' });
  const n2 = mkCtx(bp, { scope: 'home', seed: '42', 'effective-n': '2' });
  estimateHandler.deadlineRisk(base);
  estimateHandler.deadlineRisk(n2);
  const db = dataOf(base);
  const dn = dataOf(n2);
  // verdict（rcpsp）不受 effective-n 影响。
  assert.equal(dn.on_time_probability, db.on_time_probability, 'verdict unchanged by effective-n');
  assert.equal(dn.risk_band, db.risk_band);
});

// ── forecast DDL 摘要块（D6·issue #149 验收项 8）──────────────────────────────────────────
//   forecast 在板有 asserted/confirmed DDL 时附 deadline_risk 摘要（复用 deadline-risk 单一 SSOT·不重算）。
//   三态：settled DDL → 摘要；无 DDL / none → null（诚实 n/a·不假绿）。
test('forecast: confirmed DDL → deadline_risk summary present (band/margin/probability)', () => {
  const bp = mkBoardWithDeadline(confirmedDeadline(500));
  const ctx = mkCtx(bp, { scope: 'home', seed: '42', runs: '2000' });
  const code = estimateHandler.forecast(ctx);
  assert.equal(code, EXIT.OK);
  const d = dataOf(ctx);
  assert.ok(d.deadline_risk != null, 'settled DDL → summary attached');
  assert.equal(d.deadline_risk.deadline_state, 'confirmed');
  for (const k of [
    'deadline',
    'time_remaining_hours',
    'risk_band',
    'strength',
    'on_time_probability',
    'margin',
    'confidence',
  ])
    assert.ok(k in d.deadline_risk, `missing deadline_risk.${k}`);
  assert.equal(d.deadline_risk.risk_band, 'on_track', 'loose DDL + confident corpus → on_track');
});

test('forecast: no deadline key → deadline_risk null (n/a·不假绿)', () => {
  const bp = mkBoardWithDeadline(null);
  const ctx = mkCtx(bp, { scope: 'home', seed: '42' });
  const code = estimateHandler.forecast(ctx);
  assert.equal(code, EXIT.OK);
  const d = dataOf(ctx);
  assert.equal(d.deadline_risk, null, 'no DDL → no summary (null, not green)');
});

test('forecast: state none (confirmed no-DDL) → deadline_risk null', () => {
  const bp = mkBoardWithDeadline({ state: 'none', rev: 2, updated_at: '2026-06-25T10:00:00Z' });
  const ctx = mkCtx(bp, { scope: 'home', seed: '42' });
  estimateHandler.forecast(ctx);
  assert.equal(dataOf(ctx).deadline_risk, null, 'confirmed no-DDL → no margin summary');
});

test('forecast: overdue DDL surfaces overdue band (consistent with endpoint)', () => {
  const bp = mkBoardWithDeadline(confirmedDeadline(-2));
  const ctx = mkCtx(bp, { scope: 'home', seed: '42' });
  estimateHandler.forecast(ctx);
  const d = dataOf(ctx);
  assert.equal(d.deadline_risk.risk_band, 'overdue');
  assert.equal(d.deadline_risk.strength, 'strong');
  assert.ok(d.deadline_risk.time_remaining_hours < 0);
});

test('forecast DDL summary margin === deadline-risk endpoint margin (single SSOT)', () => {
  const bp = mkBoardWithDeadline(confirmedDeadline(25));
  const fc = mkCtx(bp, { scope: 'home', seed: '42' });
  const ep = mkCtx(bp, { scope: 'home', seed: '42' });
  estimateHandler.forecast(fc);
  estimateHandler.deadlineRisk(ep);
  assert.deepEqual(
    dataOf(fc).deadline_risk.margin,
    dataOf(ep).margin,
    'forecast reuses the endpoint verdict — margins byte-identical',
  );
});
