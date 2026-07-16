// selfcheck.mjs — 自验脚本（node design_docs/spike-deadline-risk/selfcheck.mjs 直接跑）。
//
// 单测式断言，无外部依赖、无 fs（除 board-io 的纯函数不触发）。验：
//   1. PRNG 确定性（同 seed 同序列）+ 均匀性粗检。
//   2. empiricalCdfAtOrBefore 单调 + 边界（0/1/NaN）。
//   3. 三通道 seeded 可复现（两次同 seed 结果逐位相等）。
//   4. 通道序：precedence on-time >= rcpsp on-time（乐观下界永不低于资源约束）。
//   5. RCPSP 堆化版 vs naive 版分布等价（同 seed·抽样一致性）。
//   6. deadline-risk 降级：无 DDL/含环 → unknown 不假绿。
//   7. band 单调：P 越低 band 越差。

import { Sfc32 } from './prng.mjs';
import { sampleTaskDuration } from './sampling.mjs';
import { analyzeGraph } from './graph.mjs';
import { precedenceOnlyMc, rcpspInTrialMc, rcpspInTrialMcNaive, throughputMc, empiricalCdfAtOrBefore, quantileFromSorted } from './channels.mjs';
import { computeDeadlineRisk, DEFAULT_BANDS } from './deadline-risk.mjs';

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; } else { fail++; console.log(`  ✗ FAIL: ${msg}`); } }
function approx(a, b, eps = 1e-9) { return Math.abs(a - b) <= eps; }

// ── 1. PRNG 确定性 + 均匀性 ──
{
  const g1 = new Sfc32(42), g2 = new Sfc32(42);
  let same = true;
  for (let i = 0; i < 1000; i++) if (g1.next() !== g2.next()) same = false;
  ok(same, 'PRNG 同 seed 同序列');
  const g3 = new Sfc32(43);
  ok(new Sfc32(42).next() !== g3.next(), 'PRNG 不同 seed 不同序列');
  const g = new Sfc32(7);
  let s = 0, n = 200000;
  for (let i = 0; i < n; i++) s += g.next();
  ok(approx(s / n, 0.5, 0.01), `PRNG 均匀性 mean≈0.5 (got ${(s / n).toFixed(4)})`);
}

// ── 2. empiricalCdfAtOrBefore ──
{
  const sorted = Float64Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  ok(approx(empiricalCdfAtOrBefore(sorted, 5), 0.5), `CDF@5=0.5 (got ${empiricalCdfAtOrBefore(sorted, 5)})`);
  ok(approx(empiricalCdfAtOrBefore(sorted, 0), 0), 'CDF@0=0');
  ok(approx(empiricalCdfAtOrBefore(sorted, 100), 1), 'CDF@100=1');
  ok(Number.isNaN(empiricalCdfAtOrBefore(sorted, NaN)), 'CDF@NaN=NaN');
  ok(Number.isNaN(empiricalCdfAtOrBefore(new Float64Array(0), 5)), 'CDF 空样本=NaN');
  // 单调：target 增 → CDF 不减。
  let mono = true, prev = -1;
  for (let x = 0; x <= 12; x += 0.5) { const c = empiricalCdfAtOrBefore(sorted, x); if (c < prev - 1e-12) mono = false; prev = c; }
  ok(mono, 'CDF 单调不减');
}

// ── 构造测试图（链 + 分叉·A→{B,C}→D）──
function makeBoard(n = 30, seed = 1) {
  const g = new Sfc32(seed);
  const tasks = [];
  for (let i = 0; i < n; i++) {
    const deps = [];
    // 每个节点随机连 0-2 个更早节点（DAG·只指前）。
    const k = i === 0 ? 0 : 1 + g.nextInt(Math.min(2, i));
    const cand = [];
    for (let j = 0; j < i; j++) cand.push(j);
    for (let d = 0; d < k && cand.length; d++) { const pick = g.nextInt(cand.length); deps.push(`T${cand[pick]}`); cand.splice(pick, 1); }
    tasks.push({ id: `T${i}`, status: 'ready', deps, estimate: { value: 1 + g.nextInt(8), unit: 'h' } });
  }
  return { tasks, scheduling: { wip_limit: 4 } };
}

function paramsFor(board, mean = 4, cv = 0.6) {
  const p = new Map();
  for (const t of board.tasks) p.set(t.id, { meanHours: mean, cv });
  return p;
}

// ── 3. 三通道 seeded 可复现 ──
{
  const b = makeBoard(40, 3);
  const p = paramsFor(b);
  const a1 = precedenceOnlyMc(b, p, { seed: 42, runs: 500 });
  const a2 = precedenceOnlyMc(b, p, { seed: 42, runs: 500 });
  ok(approx(a1.makespan.p50, a2.makespan.p50) && approx(a1.makespan.p95, a2.makespan.p95), 'precedence 可复现');
  const r1 = rcpspInTrialMc(b, p, { seed: 42, runs: 500, wip: 4 });
  const r2 = rcpspInTrialMc(b, p, { seed: 42, runs: 500, wip: 4 });
  ok(approx(r1.makespan.p50, r2.makespan.p50) && approx(r1.makespan.p95, r2.makespan.p95), 'rcpsp 可复现');
}

// ── 4. 通道序：precedence makespan <= rcpsp makespan（资源约束只会延后）→ on-time A >= B ──
{
  const b = makeBoard(50, 5);
  const p = paramsFor(b, 5, 0.5);
  const a = precedenceOnlyMc(b, p, { seed: 42, runs: 1000 });
  const r = rcpspInTrialMc(b, p, { seed: 42, runs: 1000, wip: 2 }); // 紧资源
  ok(a.makespan.p50 <= r.makespan.p50 + 1e-6, `precedence p50 (${a.makespan.p50.toFixed(1)}) <= rcpsp p50 (${r.makespan.p50.toFixed(1)})`);
  ok(a.makespan.p95 <= r.makespan.p95 + 1e-6, `precedence p95 (${a.makespan.p95.toFixed(1)}) <= rcpsp p95 (${r.makespan.p95.toFixed(1)})`);
  const target = r.makespan.p50; // 在某个 target 上 A 的 on-time 应 >= B
  ok(a.onTime(target) >= r.onTime(target) - 1e-9, `on-time: precedence (${a.onTime(target).toFixed(3)}) >= rcpsp (${r.onTime(target).toFixed(3)})`);
}

// ── 5. rcpsp 堆化 vs naive 分布等价（同 seed 同抽样·允许微小分位插值差）──
{
  const b = makeBoard(30, 9);
  const p = paramsFor(b, 4, 0.7);
  const fast = rcpspInTrialMc(b, p, { seed: 42, runs: 800, wip: 3 });
  const naive = rcpspInTrialMcNaive(b, p, { seed: 42, runs: 800, wip: 3 });
  const rel = Math.abs(fast.makespan.p50 - naive.makespan.p50) / Math.max(naive.makespan.p50, 1e-9);
  ok(rel < 0.05, `rcpsp fast≈naive p50 (fast=${fast.makespan.p50.toFixed(1)} naive=${naive.makespan.p50.toFixed(1)} rel=${(rel * 100).toFixed(1)}%)`);
}

// ── 6. deadline-risk 降级：无 DDL / 含环 → unknown ──
{
  const b = makeBoard(20, 2);
  const p = paramsFor(b);
  const noDdl = computeDeadlineRisk(b, { deadlineAtMs: null, deadlineState: 'pending', asOfMs: Date.now(), calibParams: p, backlog: 20, records: [], historyN: 0, coveragePct: 100 });
  ok(noDdl.risk_band === 'unknown' && noDdl.on_time_probability === null, 'no-DDL → unknown, on_time null');
  const cyc = { tasks: [{ id: 'A', status: 'ready', deps: ['B'] }, { id: 'B', status: 'ready', deps: ['A'] }] };
  const cycP = new Map([['A', { meanHours: 4, cv: 0.5 }], ['B', { meanHours: 4, cv: 0.5 }]]);
  const cycR = computeDeadlineRisk(cyc, { deadlineAtMs: Date.now() + 100 * 3600000, deadlineState: 'confirmed', asOfMs: Date.now(), calibParams: cycP, backlog: 2, records: [], historyN: 20, coveragePct: 100 });
  ok(cycR.risk_band === 'unknown', 'cycle → unknown');
}

// ── 7. band 单调：DDL 越紧（P 越低）→ band 越差 ──
{
  const b = makeBoard(40, 4);
  const p = paramsFor(b, 5, 0.6);
  const asOf = Date.now();
  const est = precedenceOnlyMc(b, p, { seed: 42, runs: 2000 });
  const order = ['on_track', 'watch', 'at_risk', 'likely_late', 'unknown'];
  const rank = (bd) => order.indexOf(bd);
  // 宽松 DDL（p95+50%）→ 紧 DDL（p50×0.5）
  const looseH = est.makespan.p95 * 1.5, tightH = est.makespan.p50 * 0.5;
  const loose = computeDeadlineRisk(b, { deadlineAtMs: asOf + looseH * 3600000, deadlineState: 'confirmed', asOfMs: asOf, calibParams: p, backlog: 40, records: synthRecords(200), historyN: 200, coveragePct: 100, wip: 4 });
  const tight = computeDeadlineRisk(b, { deadlineAtMs: asOf + tightH * 3600000, deadlineState: 'confirmed', asOfMs: asOf, calibParams: p, backlog: 40, records: synthRecords(200), historyN: 200, coveragePct: 100, wip: 4 });
  ok(rank(loose.risk_band) <= rank(tight.risk_band), `band 单调 loose(${loose.risk_band}) <= tight(${tight.risk_band})`);
  ok(loose.on_time_probability >= tight.on_time_probability - 1e-9, `on-time 单调 loose(${loose.on_time_probability}) >= tight(${tight.on_time_probability})`);
}

// 合成 done 记录（喂 throughput·分布到最近 N 天）。
function synthRecords(n) {
  const g = new Sfc32(11);
  const now = Date.now();
  const recs = [];
  for (let i = 0; i < n; i++) {
    const daysAgo = g.nextInt(30);
    recs.push({ finishedAtMs: now - daysAgo * 86400000, actualHours: 1 + g.next() * 6, estimateHours: 2, ratio: 1, taskId: `d${i}`, repo: 'x', type: '' });
  }
  return recs;
}

console.log(`\nselfcheck: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
