// deadline-risk-endpoint.test.ts — 交付 DDL 风险 verdict 引擎层（issue #149 契约 §4.3·D3B）。
//   ① empiricalCdfAtOrBefore（on-time 概率载重·二分经验 CDF）。
//   ② rcpspInTrialMc（资源约束 MC·堆化 serial SGS·wip-monotone·seeded·cycle 降级）。
//   ③ computeDeadlineRisk（六态 band·on_time_probability 只来自 RCPSP·throughput 绝不做 verdict·诚实降级）。
//   数据底座：engine fixtures 的 9 节点 DAG（active-estimate-engine·wip=4）+ 合成 DDL。

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { computeDeadlineRisk, empiricalCdfAtOrBefore, rcpspInTrialMc } from '../dist/index.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const BOARDS = join(HERE, 'fixtures', 'boards');
const readBoard = (p: string) => JSON.parse(readFileSync(p, 'utf8'));
const ACTIVE = readBoard(join(BOARDS, 'current', 'active-estimate-engine.board.json'));
const CYCLE = readBoard(join(BOARDS, 'edge', 'intentional-error-cycle.board.json'));
const NOW = Date.parse('2026-06-25T12:00:00Z');

function paramsFromBoard(board: {
  tasks?: unknown[];
}): Map<string, { meanHours: number; cv: number }> {
  const m = new Map<string, { meanHours: number; cv: number }>();
  for (const t of (board.tasks ?? []) as Array<{ id?: string; estimate?: { value?: number } }>) {
    if (typeof t.id !== 'string') continue;
    m.set(t.id, { meanHours: t.estimate?.value ?? 1, cv: 0.4 });
  }
  return m;
}
const PARAMS = paramsFromBoard(ACTIVE);

// computeDeadlineRisk 的公共入参（band 测试只改 deadlineAtMs / deadlineState / historyN）。
function risk(over: Record<string, unknown>) {
  return computeDeadlineRisk(ACTIVE, {
    deadlineAtMs: NOW + 100 * 3600000,
    deadlineState: 'confirmed',
    asOfMs: NOW,
    records: [],
    calibParams: PARAMS,
    backlog: 6,
    wip: 4,
    runs: 2000,
    seed: 42,
    historyN: 40,
    coveragePct: 100,
    ...over,
  });
}
// 内部 rcpsp 通道的分位（band 目标从同 seed/runs/wip 派生·robust）。
const RCPSP4 = rcpspInTrialMc(ACTIVE, PARAMS, { seed: 42, runs: 2000, wip: 4, nowMs: NOW });

// ── ① empiricalCdfAtOrBefore ────────────────────────────────────────────────────────────
test('empiricalCdfAtOrBefore: monotone non-decreasing in target, bounded [0,1]', () => {
  const sorted = Float64Array.from([1, 2, 3, 4, 5]);
  sorted.sort();
  assert.equal(empiricalCdfAtOrBefore(sorted, 0), 0);
  assert.equal(empiricalCdfAtOrBefore(sorted, 3), 3 / 5); // ≤3 → {1,2,3}
  assert.equal(empiricalCdfAtOrBefore(sorted, 5), 1);
  assert.equal(empiricalCdfAtOrBefore(sorted, 100), 1);
  // 单调：target↑ → cdf 不降。
  let prev = -1;
  for (let t = -1; t <= 6; t += 0.5) {
    const v = empiricalCdfAtOrBefore(sorted, t);
    assert.ok(v >= prev && v <= 1, `cdf monotone at ${t}`);
    prev = v;
  }
});

test('empiricalCdfAtOrBefore: empty samples / non-finite target → NaN (honest degrade)', () => {
  assert.ok(Number.isNaN(empiricalCdfAtOrBefore(new Float64Array(0), 5)));
  assert.ok(Number.isNaN(empiricalCdfAtOrBefore(Float64Array.from([1, 2]), Number.NaN)));
  assert.ok(
    Number.isNaN(empiricalCdfAtOrBefore(Float64Array.from([1, 2]), Number.POSITIVE_INFINITY)),
  );
});

// ── ② rcpspInTrialMc ────────────────────────────────────────────────────────────────────
test('rcpspInTrialMc: P50 ≤ P80 ≤ P95 monotone + exposes sorted samples', () => {
  assert.ok(RCPSP4.makespan.p50 <= RCPSP4.makespan.p80);
  assert.ok(RCPSP4.makespan.p80 <= RCPSP4.makespan.p95);
  assert.equal(RCPSP4.makespanSamplesSorted.length, 2000);
  assert.equal(RCPSP4.source, 'rcpsp-in-trial-mc');
  assert.equal(RCPSP4.node_count, 9);
  // sorted 升序。
  for (let i = 1; i < RCPSP4.makespanSamplesSorted.length; i++)
    assert.ok(RCPSP4.makespanSamplesSorted[i] >= RCPSP4.makespanSamplesSorted[i - 1]);
});

test('rcpspInTrialMc: WIP-monotone makespan (wip1 ≥ wip∞·资源约束只延后)', () => {
  const tight = rcpspInTrialMc(ACTIVE, PARAMS, { seed: 42, runs: 2000, wip: 1, nowMs: NOW });
  const loose = rcpspInTrialMc(ACTIVE, PARAMS, { seed: 42, runs: 2000, wip: 99, nowMs: NOW });
  assert.ok(
    tight.makespan.p50 >= loose.makespan.p50,
    `wip1 p50 ${tight.makespan.p50} ≥ wip∞ ${loose.makespan.p50}`,
  );
});

test('rcpspInTrialMc: deterministic for same seed, differs for different seed', () => {
  const a = rcpspInTrialMc(ACTIVE, PARAMS, { seed: 42, runs: 1000, wip: 4, nowMs: NOW });
  const b = rcpspInTrialMc(ACTIVE, PARAMS, { seed: 42, runs: 1000, wip: 4, nowMs: NOW });
  const c = rcpspInTrialMc(ACTIVE, PARAMS, { seed: 99, runs: 1000, wip: 4, nowMs: NOW });
  assert.deepEqual(a.makespan, b.makespan);
  assert.notDeepEqual(a.makespan, c.makespan);
});

test('rcpspInTrialMc: cycle fixture → node_count 0, NaN makespan (graceful, no throw)', () => {
  const r = rcpspInTrialMc(CYCLE, new Map(), { seed: 42, runs: 100, wip: 4 });
  assert.equal(r.node_count, 0);
  assert.equal(r.cycle, true);
  assert.ok(Number.isNaN(r.makespan.p50));
  assert.equal(r.makespanSamplesSorted.length, 0);
});

// ── ③ computeDeadlineRisk：六态 band ─────────────────────────────────────────────────────
test('deadline-risk band: on_track (loose DDL·confident·P≥0.90)', () => {
  const d = risk({ deadlineAtMs: NOW + 100 * 3600000 });
  assert.equal(d.risk_band, 'on_track');
  assert.equal(d.strength, 'weak');
  assert.ok((d.on_time_probability ?? 0) >= 0.9);
  assert.equal(d.on_time_probability_source, 'rcpsp-in-trial');
});

test('deadline-risk band: watch (DDL≈rcpsp p80·0.65≤P<0.90)', () => {
  const d = risk({ deadlineAtMs: NOW + RCPSP4.makespan.p80 * 3600000 });
  assert.equal(d.risk_band, 'watch');
  assert.ok((d.on_time_probability ?? 0) >= 0.65 && (d.on_time_probability ?? 0) < 0.9);
});

test('deadline-risk band: at_risk (DDL≈rcpsp p50·0.40≤P<0.65·strong)', () => {
  const d = risk({ deadlineAtMs: NOW + RCPSP4.makespan.p50 * 3600000 });
  assert.equal(d.risk_band, 'at_risk');
  assert.equal(d.strength, 'strong');
  assert.ok((d.on_time_probability ?? 0) >= 0.4 && (d.on_time_probability ?? 0) < 0.65);
});

test('deadline-risk band: likely_late (tight DDL·P<0.40·strong)', () => {
  const d = risk({ deadlineAtMs: NOW + 8 * 3600000 });
  assert.equal(d.risk_band, 'likely_late');
  assert.equal(d.strength, 'strong');
  assert.ok((d.on_time_probability ?? 1) < 0.4);
});

test('deadline-risk band: overdue (now ≥ DDL, backlog>0·hard·strong·P=0)', () => {
  const d = risk({ deadlineAtMs: NOW - 3600000, backlog: 6, deadlineKind: 'hard' });
  assert.equal(d.risk_band, 'overdue');
  assert.equal(d.strength, 'strong');
  assert.equal(d.time_remaining_hours, -1);
  assert.ok(d.notes.some((n) => n.includes('须向用户报告')));
});

test('deadline-risk band: soft overdue → weak advisory (issue #169·不升 strong)', () => {
  const d = risk({ deadlineAtMs: NOW - 3600000, backlog: 6, deadlineKind: 'soft' });
  assert.equal(d.risk_band, 'overdue');
  assert.equal(d.strength, 'weak');
  assert.ok(d.notes.some((n) => n.includes('advisory')));
});

test('deadline-risk band: completed board past DDL is NOT likely_late/overdue (backlog=0·已交付·weak)', () => {
  // 全部任务已完成（backlog=0）+ as_of 已过 DDL：工作全做完，不该报「要迟到」/overdue。
  // 未修复前：complete 落 classifyBand，completed 的 onTimeProb=0 → 误判 likely_late。
  const d = risk({ deadlineAtMs: NOW - 50 * 3600000, backlog: 0 });
  assert.notEqual(d.risk_band, 'likely_late');
  assert.notEqual(d.risk_band, 'overdue');
  assert.equal(d.risk_band, 'on_track'); // 复用 on_track 表完成态
  assert.equal(d.strength, 'weak'); // 已交付·无需强推
  assert.equal(d.time_remaining_hours, -50);
  assert.ok(d.notes.some((n) => n.includes('全部任务已完成')));
});

test('deadline-risk band: unknown when no DDL (state pending·null·不假绿)', () => {
  const d = risk({ deadlineAtMs: null, deadlineState: 'pending' });
  assert.equal(d.risk_band, 'unknown');
  assert.equal(d.on_time_probability, null);
  assert.equal(d.on_time_probability_source, 'unknown');
  assert.equal(d.channels.resource_aware, null);
  assert.equal(d.time_remaining_hours, null);
});

test('deadline-risk band: unknown when state none (confirmed no-DDL·不假绿)', () => {
  const d = risk({ deadlineAtMs: null, deadlineState: 'none' });
  assert.equal(d.risk_band, 'unknown');
  assert.equal(d.on_time_probability, null);
});

// ── ③b 诚实降级 ─────────────────────────────────────────────────────────────────────────
test('deadline-risk degrade: low confidence downgrades on_track→unknown (historyN<4·不假绿)', () => {
  // 与 on_track case 同宽 DDL（P=1.0），但 historyN=0 → confidence low → on_track 降 unknown。
  const d = risk({ deadlineAtMs: NOW + 100 * 3600000, historyN: 0, records: [] });
  assert.equal(d.confidence, 'low');
  assert.equal(d.risk_band, 'unknown');
  assert.ok(d.notes.some((n) => n.includes('置信') || n.includes('unknown')));
});

test('deadline-risk degrade: rcpspDisabled → on_time_probability null + unknown + 绝不退 throughput', () => {
  const d = risk({ deadlineAtMs: NOW + 100 * 3600000, rcpspDisabled: true });
  assert.equal(d.on_time_probability, null);
  assert.equal(d.on_time_probability_source, 'unknown');
  assert.equal(d.risk_band, 'unknown');
  assert.equal(d.channels.resource_aware, null);
  assert.equal(d.rcpsp_runs, 0);
  assert.ok(d.notes.some((n) => n.includes('throughput')));
});

test('deadline-risk degrade: cycle graph → unknown (无法 forward pass)', () => {
  const d = computeDeadlineRisk(CYCLE, {
    deadlineAtMs: NOW + 100 * 3600000,
    deadlineState: 'confirmed',
    asOfMs: NOW,
    records: [],
    calibParams: new Map(),
    backlog: 3,
    wip: 4,
    runs: 500,
    seed: 42,
    historyN: 40,
    coveragePct: 100,
  });
  assert.equal(d.risk_band, 'unknown');
  assert.equal(d.on_time_probability, null);
  assert.ok(d.notes.some((n) => n.includes('环')));
});

// ── ③c 通道诚实性 ───────────────────────────────────────────────────────────────────────
test('deadline-risk: on_time_probability ONLY from rcpsp-in-trial, never throughput', () => {
  // 构造 throughput heuristic P=0 的世界（backlog 巨大·历史吞吐稀疏）但 rcpsp P 高——verdict 必来自 rcpsp。
  const sparse = [
    {
      boardFile: 'x',
      repo: 'r',
      taskId: 'a',
      type: 'feature',
      executor: 'sub-agent',
      model: 's',
      tier: 't',
      estimateHours: 1,
      actualHours: 1,
      ratio: 1,
      depsCount: 0,
      tokensIn: null,
      tokensOut: null,
      finishedAtMs: Date.parse('2026-06-01T10:00:00Z'),
      boardTimeMs: null,
    },
    {
      boardFile: 'x',
      repo: 'r',
      taskId: 'b',
      type: 'feature',
      executor: 'sub-agent',
      model: 's',
      tier: 't',
      estimateHours: 1,
      actualHours: 1,
      ratio: 1,
      depsCount: 0,
      tokensIn: null,
      tokensOut: null,
      finishedAtMs: Date.parse('2026-06-20T10:00:00Z'),
      boardTimeMs: null,
    },
  ];
  const d = computeDeadlineRisk(ACTIVE, {
    deadlineAtMs: NOW + 100 * 3600000,
    deadlineState: 'confirmed',
    asOfMs: NOW,
    records: sparse,
    calibParams: PARAMS,
    backlog: 999, // 巨大 backlog → throughput heuristic 清不完 → P_heur≈0
    wip: 4,
    runs: 2000,
    seed: 42,
    historyN: 40,
    coveragePct: 100,
  });
  // rcpsp 说来得及（loose DDL）→ verdict on_track（不被 throughput 的 0 拖成 late）。
  assert.equal(d.on_time_probability_source, 'rcpsp-in-trial');
  assert.ok((d.on_time_probability ?? 0) >= 0.9, 'verdict from rcpsp, not throughput');
  assert.equal(d.risk_band, 'on_track');
  // throughput_reference 存在但只作 heuristic 参考（绝不映射 on_track）。
  if (d.channels.throughput_reference) {
    assert.equal(d.channels.throughput_reference.kind, 'heuristic-reference');
  }
});

test('deadline-risk: precedence P ≥ rcpsp P at same DDL (optimistic bound ≥ resource-aware)', () => {
  const d = risk({ deadlineAtMs: NOW + RCPSP4.makespan.p50 * 3600000 });
  const precP = d.channels.precedence_only?.on_time_probability ?? 0;
  const rcpspP = d.channels.resource_aware?.on_time_probability ?? 0;
  assert.ok(precP >= rcpspP - 1e-9, `precedence ${precP} ≥ rcpsp ${rcpspP}`);
  assert.equal(d.channels.precedence_only?.role, 'optimistic-bound');
});

// ── ③d schema 稳定性 + 确定性 ────────────────────────────────────────────────────────────
test('deadline-risk: schema has all §4.3 required keys + calibration_status honest', () => {
  const d = risk({});
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
  assert.equal(d.calibration_status, 'uncalibrated-conservative');
  assert.ok(
    'precedence_only' in d.channels &&
      'resource_aware' in d.channels &&
      'throughput_reference' in d.channels,
  );
  // forecast / margin basis 诚实标 wall-clock 乐观口径。
  assert.equal(d.forecast?.basis, 'precedence-only-optimistic');
  assert.equal(d.margin?.basis, 'precedence-only-optimistic');
});

test('deadline-risk: deterministic for same seed (identical verdict)', () => {
  const a = risk({ deadlineAtMs: NOW + 25 * 3600000 });
  const b = risk({ deadlineAtMs: NOW + 25 * 3600000 });
  assert.deepEqual(a, b);
});

test('deadline-risk: top_drivers surfaces critical + user-blocked tasks', () => {
  const statusMap = new Map<string, { status?: string; blocked_on?: string }>([
    ['C9', { status: 'blocked', blocked_on: 'user' }],
  ]);
  const d = risk({ deadlineAtMs: NOW + 25 * 3600000, statusMap });
  assert.ok(Array.isArray(d.top_drivers));
  // 至少含 critical 类（临界链节点 CI>0）。
  assert.ok(d.top_drivers.some((x) => x.reason === 'critical'));
});
