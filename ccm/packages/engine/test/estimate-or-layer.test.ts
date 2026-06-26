// estimate-or-layer.test.ts — 双通道 MC / RCPSP / EVM+ES / SLE / CCPM（OR 层·ADR-015）。
//   喂 current/active-estimate-engine（9 节点 DAG + baseline + aging）+ edge（cycle / no-estimate）。
//   property/invariant + seeded golden + 降级路径。

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  computeEvm,
  cycleTimeSle,
  dailyThroughput,
  dualChannelConsistency,
  estimateDagMonteCarlo,
  estimateHours,
  extractDoneRecords,
  feverStatus,
  loadCorpus,
  rcpspSchedule,
  sizeProjectBuffer,
  throughputMonteCarlo,
  wipAging,
} from '../dist/index.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const BOARDS = join(HERE, 'fixtures', 'boards');
const HOME = join(BOARDS, 'home-corpus');
const NOW = Date.parse('2026-06-25T13:00:00Z');
const readBoard = (p: string) => JSON.parse(readFileSync(p, 'utf8'));
const ACTIVE = readBoard(join(BOARDS, 'current', 'active-estimate-engine.board.json'));

// 用 baseline estimate 构造每节点 MC 参数（mean=估值小时·cv=0.4）。
function paramsFromBoard(board: {
  tasks?: unknown[];
}): Map<string, { meanHours: number; cv: number }> {
  const m = new Map<string, { meanHours: number; cv: number }>();
  for (const t of (board.tasks ?? []) as Array<{ id?: string; estimate?: unknown }>) {
    if (typeof t.id !== 'string') continue;
    const est = estimateHours(t.estimate as never);
    m.set(t.id, { meanHours: est ?? 1, cv: 0.4 });
  }
  return m;
}

// ── 估算-DAG-MC（通道①·seeded·CI/CRI/SSI）─────────────────────────────────────────
test('estimateDagMonteCarlo: P50 ≤ P80 ≤ P95 (makespan monotone)', () => {
  const mc = estimateDagMonteCarlo(ACTIVE, paramsFromBoard(ACTIVE), { seed: 42, runs: 2000 });
  assert.ok(mc.makespan.p50 <= mc.makespan.p80 && mc.makespan.p80 <= mc.makespan.p95);
});

test('estimateDagMonteCarlo: deterministic for same seed', () => {
  const a = estimateDagMonteCarlo(ACTIVE, paramsFromBoard(ACTIVE), { seed: 42, runs: 1000 });
  const b = estimateDagMonteCarlo(ACTIVE, paramsFromBoard(ACTIVE), { seed: 42, runs: 1000 });
  assert.equal(a.makespan.p50, b.makespan.p50);
  assert.equal(a.makespan.p95, b.makespan.p95);
  assert.equal(a.mean, b.mean);
});

test('estimateDagMonteCarlo: different seed → different makespan', () => {
  const a = estimateDagMonteCarlo(ACTIVE, paramsFromBoard(ACTIVE), { seed: 42, runs: 1000 });
  const c = estimateDagMonteCarlo(ACTIVE, paramsFromBoard(ACTIVE), { seed: 99, runs: 1000 });
  assert.notEqual(a.makespan.p50, c.makespan.p50);
});

test('estimateDagMonteCarlo: makespan mean ≈ critical chain (C1→C2→C4→C6→C8→C9=20h)', () => {
  // 临界链 baseline 估值和 = 3+4+5+3+3+2 = 20h（README 文档值）。log-normal 右偏 → mean 略高于确定性和。
  const mc = estimateDagMonteCarlo(ACTIVE, paramsFromBoard(ACTIVE), { seed: 42, runs: 4000 });
  assert.ok(
    mc.mean >= 18 && mc.mean <= 24,
    `mean ${mc.mean} not near documented 20h critical chain`,
  );
});

test('estimateDagMonteCarlo: criticality index — critical-chain nodes near 1.0', () => {
  const mc = estimateDagMonteCarlo(ACTIVE, paramsFromBoard(ACTIVE), { seed: 42, runs: 4000 });
  const ciOf = (id: string) =>
    (mc.criticality_index.find((s) => s.id === id) as { criticality: number }).criticality;
  // C1, C8, C9 are on every path to the sink → CI ≈ 1.0.
  assert.ok(ciOf('C1') > 0.9, `C1 CI ${ciOf('C1')}`);
  assert.ok(ciOf('C9') > 0.9, `C9 CI ${ciOf('C9')}`);
  // CI ∈ [0,1].
  for (const s of mc.criticality_index) {
    assert.ok(s.criticality >= 0 && s.criticality <= 1);
    assert.ok(s.cruciality >= -1 && s.cruciality <= 1); // Pearson ∈ [-1,1]
    assert.ok(s.sensitivity >= 0);
  }
});

test('estimateDagMonteCarlo: seeded golden makespan (seed=42, runs=2000)', () => {
  const mc = estimateDagMonteCarlo(ACTIVE, paramsFromBoard(ACTIVE), { seed: 42, runs: 2000 });
  // golden snapshot（确定性·算法改即更新）。
  assert.ok(Math.abs(mc.makespan.p50 - 20.074) < 0.01, `p50 golden: ${mc.makespan.p50}`);
  assert.ok(Math.abs(mc.makespan.p95 - 26.211) < 0.01, `p95 golden: ${mc.makespan.p95}`);
});

test('estimateDagMonteCarlo: cycle fixture → node_count 0, makespan NaN (graceful, no throw)', () => {
  const cyc = readBoard(join(BOARDS, 'edge', 'intentional-error-cycle.board.json'));
  const mc = estimateDagMonteCarlo(cyc, new Map(), { seed: 42, runs: 100 });
  assert.equal(mc.node_count, 0);
  assert.ok(Number.isNaN(mc.makespan.p50));
});

// ── 吞吐-MC（通道②·#NoEstimates）──────────────────────────────────────────────────
test('throughputMonteCarlo: works on all-missing-estimate board (no per-task estimate needed)', () => {
  const board = readBoard(join(BOARDS, 'edge', 'all-missing-estimate.board.json'));
  const corpus = extractDoneRecords(board);
  const thr = throughputMonteCarlo(3, corpus, { seed: 42, runs: 2000 });
  assert.ok(thr.days.p50 > 0 && thr.days.p50 <= thr.days.p80 && thr.days.p80 <= thr.days.p95);
  assert.equal(thr.backlog, 3);
});

test('throughputMonteCarlo: deterministic + backlog 0 → 0 days', () => {
  const corpus = loadCorpus(HOME, { nowMs: NOW });
  const a = throughputMonteCarlo(5, corpus, { seed: 7, runs: 1000 });
  const b = throughputMonteCarlo(5, corpus, { seed: 7, runs: 1000 });
  assert.equal(a.days.p50, b.days.p50);
  const zero = throughputMonteCarlo(0, corpus, { seed: 7, runs: 100 });
  assert.equal(zero.days.p50, 0);
});

test('throughputMonteCarlo: no history → low confidence, NaN days', () => {
  const thr = throughputMonteCarlo(3, [], { seed: 1, runs: 100 });
  assert.equal(thr.confidence, 'low');
  assert.ok(Number.isNaN(thr.days.p50));
});

test('dailyThroughput: buckets done tasks by completion day', () => {
  const corpus = loadCorpus(HOME, { nowMs: NOW });
  const daily = dailyThroughput(corpus);
  assert.ok(daily.length > 0);
  assert.ok(daily.every((v) => v > 0));
});

// ── ①②consistency ─────────────────────────────────────────────────────────────────
test('dualChannelConsistency: emits deviation + warning flag', () => {
  const corpus = loadCorpus(HOME, { nowMs: NOW });
  const est = estimateDagMonteCarlo(ACTIVE, paramsFromBoard(ACTIVE), { seed: 42, runs: 2000 });
  const thr = throughputMonteCarlo(9, corpus, { seed: 42, runs: 2000 });
  const cons = dualChannelConsistency(est, thr);
  assert.equal(typeof cons.deviation, 'number');
  assert.equal(typeof cons.warning, 'boolean');
});

// ── RCPSP（list-scheduling min-slack + LFT）────────────────────────────────────────
test('rcpsp: WIP-monotone makespan (wip1 ≥ wip2 ≥ wip∞)', () => {
  const durs = new Map<string, number>();
  for (const [id, e] of Object.entries(
    ACTIVE.baseline.task_estimates as Record<string, { value: number }>,
  )) {
    durs.set(id, e.value);
  }
  const r1 = rcpspSchedule(ACTIVE, { wip: 1, durations: durs, nowMs: NOW });
  const r2 = rcpspSchedule(ACTIVE, { wip: 2, durations: durs, nowMs: NOW });
  const rInf = rcpspSchedule(ACTIVE, { wip: 99, durations: durs, nowMs: NOW });
  assert.ok(r1.makespan >= r2.makespan, `wip1 ${r1.makespan} < wip2 ${r2.makespan}`);
  assert.ok(r2.makespan >= rInf.makespan, `wip2 ${r2.makespan} < winf ${rInf.makespan}`);
});

test('rcpsp: wip=1 makespan == sum of all durations (fully serial)', () => {
  const durs = new Map<string, number>();
  let sum = 0;
  for (const [id, e] of Object.entries(
    ACTIVE.baseline.task_estimates as Record<string, { value: number }>,
  )) {
    durs.set(id, e.value);
    sum += e.value;
  }
  const r1 = rcpspSchedule(ACTIVE, { wip: 1, durations: durs, nowMs: NOW });
  assert.equal(r1.makespan, sum);
});

test('rcpsp: wip=∞ makespan == CPM critical path (≥ critical chain)', () => {
  const durs = new Map<string, number>();
  for (const [id, e] of Object.entries(
    ACTIVE.baseline.task_estimates as Record<string, { value: number }>,
  )) {
    durs.set(id, e.value);
  }
  const rInf = rcpspSchedule(ACTIVE, { wip: 99, durations: durs, nowMs: NOW });
  // critical chain C1→C2→C4→C6→C8→C9 = 20h.
  assert.equal(rInf.makespan, 20);
  assert.ok(rInf.makespan >= 20, 'makespan ≥ critical chain');
});

test('rcpsp: dispatch_order covers all tasks, respects deps', () => {
  const durs = new Map<string, number>();
  for (const [id, e] of Object.entries(
    ACTIVE.baseline.task_estimates as Record<string, { value: number }>,
  )) {
    durs.set(id, e.value);
  }
  const r = rcpspSchedule(ACTIVE, { wip: 2, durations: durs, nowMs: NOW });
  assert.equal(r.dispatch_order.length, 9);
  const pos = new Map(r.dispatch_order.map((id, i) => [id, i]));
  // C1 must precede C2 (C2 deps C1).
  assert.ok((pos.get('C1') as number) < (pos.get('C2') as number));
  assert.ok((pos.get('C8') as number) < (pos.get('C9') as number));
});

test('rcpsp: cycle fixture → empty order, weight_source cycle (graceful)', () => {
  const cyc = readBoard(join(BOARDS, 'edge', 'intentional-error-cycle.board.json'));
  const r = rcpspSchedule(cyc, { wip: 2 });
  assert.equal(r.dispatch_order.length, 0);
  assert.equal(r.weight_source, 'cycle');
});

// ── EVM + Earned Schedule ──────────────────────────────────────────────────────────
test('evm: produces PV/EV/AC + SPI/CPI in sane domain', () => {
  const evm = computeEvm(ACTIVE, ACTIVE.baseline, { asOfMs: NOW, acSource: 'duration' });
  assert.ok(evm.has_baseline);
  assert.ok((evm.pv.value as number) > 0);
  assert.ok((evm.ev.value as number) >= 0);
  assert.ok((evm.ac.value as number) >= 0);
  // SPI/CPI 在合理域（>0·此板进度落后 → <1）。
  assert.ok((evm.spi as number) > 0 && (evm.spi as number) < 3);
  assert.ok((evm.cpi as number) > 0 && (evm.cpi as number) < 3);
});

test('evm: Earned Schedule SPI(t) present + SV(t) = ES − AT', () => {
  const evm = computeEvm(ACTIVE, ACTIVE.baseline, { asOfMs: NOW });
  assert.ok(evm.spi_t != null, 'SPI(t) must be computed (Earned Schedule)');
  assert.ok(evm.es_hours != null && evm.at_hours != null);
  // SV(t) = ES − AT.
  assert.ok(
    Math.abs((evm.sv_t as number) - ((evm.es_hours as number) - (evm.at_hours as number))) < 0.05,
  );
});

test('evm: EAC = BAC/CPI, VAC = BAC − EAC consistency', () => {
  const evm = computeEvm(ACTIVE, ACTIVE.baseline, { asOfMs: NOW });
  const eac = (evm.eac as { value: number }).value;
  const cpi = evm.cpi as number;
  const bac = evm.bac.value as number;
  assert.ok(Math.abs(eac - bac / cpi) < 0.05, `EAC ${eac} ≠ BAC/CPI ${bac / cpi}`);
  const vac = (evm.vac as { value: number }).value;
  assert.ok(Math.abs(vac - (bac - eac)) < 0.05);
});

test('evm: no baseline → warning + has_baseline false (graceful)', () => {
  const evm = computeEvm(ACTIVE, null, { asOfMs: NOW });
  assert.equal(evm.has_baseline, false);
  assert.ok(evm.warnings.length > 0);
  assert.equal(evm.spi, null);
});

test('evm: token AC source → coverage_pct reflects telemetry presence', () => {
  const evm = computeEvm(ACTIVE, ACTIVE.baseline, { asOfMs: NOW, acSource: 'token' });
  assert.equal(evm.ac.source, 'token');
  assert.ok((evm.ac.coverage_pct as number) >= 0 && (evm.ac.coverage_pct as number) <= 100);
});

test('evm: baselineHours recognizes week unit — BAC same scale as PV/EV (#bug-B)', () => {
  // baselineHours 旧内联换算只认 d/m·把 w/week 当 1h（fall-through mult=1）→ week 任务 BAC 用 168h（snapshot
  //   口径·estimateHours）而 PV/EV 用 1h → SPI/CPI/EAC/VAC 全废。修复：baselineHours 改用 estimateHours SSOT
  //   （w=168h）→ 三换算点（mutations baseline / board-graph / evm）口径归一。
  // SSOT 自洽：baselineHours(1w) 等于 estimateHours(1w) = 168（baselineHours 私有·经 BAC 间接验证）。
  assert.equal(estimateHours({ value: 1, unit: 'w' }), 168, 'estimateHours(1w) SSOT = 168');
  assert.equal(estimateHours({ value: 1, unit: 'week' }), 168);

  const baseline = {
    t0: '2026-06-01T00:00:00Z',
    captured_at: '2026-06-01T00:00:00Z',
    task_estimates: {
      W1: { value: 1, unit: 'w' }, // 168h
      H1: { value: 2, unit: 'h' }, // 2h
    },
    dag_snapshot: { W1: { deps: [] }, H1: { deps: ['W1'] } },
  };
  const board = {
    schema: 'cc-master/v2',
    tasks: [
      // W1 done：跨 168h（与 baseline week 估值一致）→ EV 应计 168h。
      {
        id: 'W1',
        status: 'done',
        started_at: '2026-06-01T00:00:00Z',
        finished_at: '2026-06-08T00:00:00Z',
      },
      { id: 'H1', status: 'ready' },
    ],
  };
  const evm = computeEvm(board, baseline, {
    asOfMs: Date.parse('2026-06-10T00:00:00Z'),
    acSource: 'duration',
  });
  // BAC = baselineHours(W1=168) + baselineHours(H1=2) = 170（week 不再被当 1h → BAC=3 的旧 bug 不复现）。
  assert.equal(evm.bac.value, 170, `BAC ${evm.bac.value} must be 168+2 (week=168h), not 1+2=3`);
  // EV = W1 done 的 baseline 计划小时 = 168（同口径·非 1）。
  assert.equal(evm.ev.value, 168, `EV ${evm.ev.value} must be 168 (week=168h), not 1`);
  // PV 走到 as-of 应覆盖全 baseline（W1 早已 EF ≤ AT）→ 与 BAC 同尺度（PV≈170·非 ~3）。
  assert.ok(evm.pv.value > 100, `PV ${evm.pv.value} same week scale as BAC (not 1h-scale)`);
  // SPI/CPI 同口径 → 落合理域（W1 168h 计划、实测正好 168h → CPI≈1·SPI≈1·非 NaN/废）。
  assert.ok((evm.spi as number) > 0.5 && (evm.spi as number) < 2, `SPI ${evm.spi} sane`);
  assert.ok((evm.cpi as number) > 0.5 && (evm.cpi as number) < 2, `CPI ${evm.cpi} sane`);
});

test('evm: backtest --as-of excludes done tasks finished after as-of from EV/AC (round5 bug2)', () => {
  // 板：A done@06-03（as-of 之前·应计），B done@06-08（as-of 之后·backtest 须排除·当时尚未完成）。
  //   PV 已按 dag_snapshot CPM 截断到 as-of；EV/AC 须同口径——否则虚报「进度发生在它真发生之前」。
  const baseline = {
    t0: '2026-06-01T00:00:00Z',
    captured_at: '2026-06-01T00:00:00Z',
    task_estimates: {
      A: { value: 10, unit: 'h' },
      B: { value: 10, unit: 'h' },
    },
    dag_snapshot: { A: { deps: [] }, B: { deps: ['A'] } },
  };
  const board = {
    schema: 'cc-master/v2',
    tasks: [
      // A：as-of(06-05) 之前完成 → 计入 EV/AC（duration 2h）。
      {
        id: 'A',
        status: 'done',
        started_at: '2026-06-03T00:00:00Z',
        finished_at: '2026-06-03T02:00:00Z',
      },
      // B：现在 done 但 finished_at=06-08 > as-of → backtest 视作尚未完成，**不计** EV/AC。
      {
        id: 'B',
        status: 'done',
        started_at: '2026-06-07T00:00:00Z',
        finished_at: '2026-06-08T04:00:00Z',
      },
    ],
  };
  const AS_OF = Date.parse('2026-06-05T00:00:00Z');
  const NOW_FULL = Date.parse('2026-06-10T00:00:00Z');

  const back = computeEvm(board, baseline, { asOfMs: AS_OF, acSource: 'duration' });
  const full = computeEvm(board, baseline, { asOfMs: NOW_FULL, acSource: 'duration' });

  // ★核心：backtest EV 只含 A（10h），全量 EV 含 A+B（20h）→ backtest EV < 全量 EV。
  assert.equal(
    back.ev.value,
    10,
    `backtest EV ${back.ev.value} must count only A (done before as-of)`,
  );
  assert.equal(full.ev.value, 20, `full EV ${full.ev.value} must count A+B`);
  assert.ok(back.ev.value < full.ev.value, 'backtest EV < full EV (B excluded)');
  // AC 同口径：backtest 只算 A 的 duration（06-03T00→T02=2h），全量算 A(2h)+B(06-07T00→06-08T04=28h)=30h。
  assert.equal(back.ac.value, 2, `backtest AC ${back.ac.value} must be A duration only`);
  assert.equal(full.ac.value, 30, `full AC ${full.ac.value} = A(2h)+B(28h)`);
  assert.ok(back.ac.value < full.ac.value, 'backtest AC < full AC (B duration excluded)');
});

test('evm: control — as-of=now counts all done tasks (no spurious exclusion·round5 bug2)', () => {
  // 控制组：as-of 在所有 finished_at 之后 → 全计（确认 as-of 截断不误伤正常路径）。
  const baseline = {
    t0: '2026-06-01T00:00:00Z',
    captured_at: '2026-06-01T00:00:00Z',
    task_estimates: { A: { value: 10, unit: 'h' }, B: { value: 10, unit: 'h' } },
    dag_snapshot: { A: { deps: [] }, B: { deps: ['A'] } },
  };
  const board = {
    schema: 'cc-master/v2',
    tasks: [
      {
        id: 'A',
        status: 'done',
        started_at: '2026-06-03T00:00:00Z',
        finished_at: '2026-06-03T02:00:00Z',
      },
      {
        id: 'B',
        status: 'done',
        started_at: '2026-06-07T00:00:00Z',
        finished_at: '2026-06-08T04:00:00Z',
      },
    ],
  };
  const evm = computeEvm(board, baseline, {
    asOfMs: Date.parse('2026-06-10T00:00:00Z'),
    acSource: 'duration',
  });
  assert.equal(evm.ev.value, 20, 'all done tasks counted when as-of is after all finishes');
  assert.equal(evm.ac.value, 30, 'all durations counted (A 2h + B 28h)');
});

// ── SLE + WIP-aging ────────────────────────────────────────────────────────────────
test('sle: cycle-time quantiles monotone P50 ≤ P85 ≤ P95', () => {
  const corpus = loadCorpus(HOME, { nowMs: NOW });
  const sle = cycleTimeSle(corpus);
  assert.ok(sle.p50 <= sle.p85 && sle.p85 <= sle.p95);
  assert.equal(sle.history_n, 40);
  assert.equal(sle.confidence, 'high');
});

test('sle: empty corpus → NaN quantiles, low confidence', () => {
  const sle = cycleTimeSle([]);
  assert.ok(Number.isNaN(sle.p85));
  assert.equal(sle.confidence, 'low');
});

test('wipAging: C5 (age≈47h) flagged at_risk/critical vs SLE; C4 (age≈4h) ok', () => {
  const corpus = loadCorpus(HOME, { nowMs: NOW });
  const sle = cycleTimeSle(corpus); // p85≈5.6h, p95≈9.2h
  const aging = wipAging(ACTIVE, sle, NOW);
  const c5 = aging.find((a) => a.id === 'C5') as { status: string; age_hours: number };
  const c4 = aging.find((a) => a.id === 'C4') as { status: string; age_hours: number };
  assert.ok(c5, 'C5 is in_flight → must appear');
  assert.ok(c5.age_hours > 40, `C5 age ${c5.age_hours} (started 2026-06-23T14:00)`);
  assert.equal(c5.status, 'critical', 'C5 age >> SLE_P95 → critical');
  assert.ok(c4, 'C4 is in_flight');
  assert.equal(c4.status, 'ok', `C4 age ${c4.age_hours} within SLE → ok`);
});

test('wipAging: no SLE history (NaN) → all ok (no false alarm)', () => {
  const aging = wipAging(ACTIVE, cycleTimeSle([]), NOW);
  for (const a of aging) assert.equal(a.status, 'ok');
});

// ── CCPM fever / buffer ────────────────────────────────────────────────────────────
test('ccpm: project buffer = f·sqrt(Σσ²)', () => {
  const buf = sizeProjectBuffer({
    chainTasks: [
      { id: 'a', mean: 3, sigma: 1.2 },
      { id: 'b', mean: 4, sigma: 1.6 },
    ],
    f: 0.5,
  });
  // sqrt(1.2² + 1.6²) = sqrt(1.44+2.56)=sqrt(4)=2 ; ×0.5 = 1.0
  assert.ok(Math.abs(buf.buffer_size - 1.0) < 1e-9, `buffer ${buf.buffer_size}`);
  assert.equal(buf.chain_mean_total, 7);
});

test('ccpm: empty chain → 0 buffer', () => {
  const buf = sizeProjectBuffer({ chainTasks: [] });
  assert.equal(buf.buffer_size, 0);
});

test('ccpm: fever zones — green (slow consume) / red (fast consume)', () => {
  const green = feverStatus({ bufferSize: 10, bufferConsumed: 1, chainProgress: 0.5 });
  assert.equal(green.zone, 'green');
  assert.ok(green.buffer_health > 0, 'progress leads consumption → healthy');
  const red = feverStatus({ bufferSize: 10, bufferConsumed: 9, chainProgress: 0.2 });
  assert.equal(red.zone, 'red');
  assert.ok(red.buffer_health < 0, 'consumption outruns progress → unhealthy');
});

test('ccpm: buffer_health = progress − consumption%', () => {
  const f = feverStatus({ bufferSize: 10, bufferConsumed: 3, chainProgress: 0.6 });
  // consumed% = 0.3, progress = 0.6 → health = 0.3.
  assert.ok(Math.abs(f.buffer_health - 0.3) < 1e-9);
});
