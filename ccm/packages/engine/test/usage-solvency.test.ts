// usage-solvency.test.ts — 配额%-计成本轴（偿付力维·ADR-015 延伸·plan §4）：
//   pctBurnRate（Δused%/Δtime）/ pctRunway（剩余走廊÷burn）/ tokenWeightedShares（token 辅助 sizing）
//   + pctCostToCompleteMonteCarlo（throughput-MC 在配额%增量上算·seeded 确定性）。
//   纯函数（信号注入·不碰 fs）。property/invariant + 两法覆盖 + 降级。

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  pctBurnRate,
  pctCostToCompleteMonteCarlo,
  pctRunway,
  tokenWeightedShares,
  WINDOW_5H_SEC,
  WINDOW_7D_SEC,
} from '../dist/index.mjs';

const NOW_SEC = Math.floor(Date.parse('2026-06-25T13:00:00Z') / 1000);

// ── pctBurnRate ────────────────────────────────────────────────────────────────────
test('pctBurnRate: window constants are 5h/7d in seconds', () => {
  assert.equal(WINDOW_5H_SEC, 18000);
  assert.equal(WINDOW_7D_SEC, 604800);
});

test('pctBurnRate: finite-diff slope (Δused%/Δhour) from two increasing samples', () => {
  // +20% over 2h → 10%/h. 2 samples → medium confidence.
  const r = pctBurnRate([
    { atSec: NOW_SEC - 7200, usedPct: 30 },
    { atSec: NOW_SEC, usedPct: 50 },
  ]);
  assert.equal(r.method, 'finite-diff');
  assert.equal(r.burn_pct_per_hour, 10);
  assert.equal(r.confidence, 'medium');
});

test('pctBurnRate: ≥3 samples → high confidence; uses most recent increasing pair', () => {
  // 最近一对 (40→55 over 1h) = 15%/h；更早的对不影响。
  const r = pctBurnRate([
    { atSec: NOW_SEC - 7200, usedPct: 20 },
    { atSec: NOW_SEC - 3600, usedPct: 40 },
    { atSec: NOW_SEC, usedPct: 55 },
  ]);
  assert.equal(r.method, 'finite-diff');
  assert.equal(r.burn_pct_per_hour, 15);
  assert.equal(r.confidence, 'high');
});

test('pctBurnRate: skips reset (decreasing) pair, falls back to window-elapsed', () => {
  // 单调下降（跨 reset）→ 无 finite-diff 对；给 windowStartSec → window-elapsed。
  const r = pctBurnRate(
    [
      { atSec: NOW_SEC - 600, usedPct: 90 }, // reset 前
      { atSec: NOW_SEC, usedPct: 5 }, // reset 后（下降）
    ],
    { windowStartSec: NOW_SEC - 3600 }, // 窗口 1h 前起
  );
  // 最新样本 used=5% over 1h elapsed → 5%/h（window-elapsed·非 finite-diff）。
  assert.equal(r.method, 'window-elapsed');
  assert.equal(r.burn_pct_per_hour, 5);
  assert.equal(r.confidence, 'low');
});

test('pctBurnRate: single snapshot + windowStart → window-elapsed average rate', () => {
  // used=60% 且窗口起点在 3h 前 → 20%/h。
  const r = pctBurnRate([{ atSec: NOW_SEC, usedPct: 60 }], {
    windowStartSec: NOW_SEC - 3 * 3600,
  });
  assert.equal(r.method, 'window-elapsed');
  assert.equal(r.burn_pct_per_hour, 20);
});

test('pctBurnRate: no samples / no windowStart → none, null', () => {
  assert.equal(pctBurnRate([]).burn_pct_per_hour, null);
  assert.equal(pctBurnRate([]).method, 'none');
  // 单样本但无 windowStart → 无法 window-elapsed。
  assert.equal(pctBurnRate([{ atSec: NOW_SEC, usedPct: 50 }]).burn_pct_per_hour, null);
  assert.equal(pctBurnRate(null).method, 'none');
});

test('pctBurnRate: does not mutate input + ignores NaN samples', () => {
  const input = [
    { atSec: NOW_SEC, usedPct: 50 },
    { atSec: NOW_SEC - 3600, usedPct: 40 },
    { atSec: Number.NaN, usedPct: 99 },
  ];
  const snapshot = JSON.stringify(input);
  const r = pctBurnRate(input);
  assert.equal(JSON.stringify(input), snapshot, 'input array order/content unchanged');
  // 40→50 over 1h = 10%/h（NaN 样本被剔除·samples_used=2）。
  assert.equal(r.burn_pct_per_hour, 10);
  assert.equal(r.samples_used, 2);
});

// ── pctRunway ──────────────────────────────────────────────────────────────────────
test('pctRunway: ample — slow burn, reset before ceiling', () => {
  // used=70, ceiling 90 → remaining 20; burn 2%/h → 10h to ceiling; reset in 1h → reset first → ample.
  const r = pctRunway({
    usedPct: 70,
    burnPctPerHour: 2,
    ceilingPct: 90,
    resetsAtSec: NOW_SEC + 3600,
    nowSec: NOW_SEC,
  });
  assert.equal(r.remaining_corridor_pct, 20);
  assert.equal(r.hours_to_ceiling, 10);
  assert.equal(r.hours_to_reset, 1);
  assert.equal(r.verdict, 'ample');
});

test('pctRunway: will-exhaust-before-reset — fast burn hits ceiling first', () => {
  // used=70, ceiling 90 → remaining 20; burn 40%/h → 0.5h to ceiling; reset in 3h → ceiling first.
  const r = pctRunway({
    usedPct: 70,
    burnPctPerHour: 40,
    ceilingPct: 90,
    resetsAtSec: NOW_SEC + 3 * 3600,
    nowSec: NOW_SEC,
  });
  assert.equal(r.hours_to_ceiling, 0.5);
  assert.equal(r.hours_to_reset, 3);
  assert.equal(r.verdict, 'will-exhaust-before-reset');
});

test('pctRunway: used at/over ceiling → remaining 0 → will-exhaust', () => {
  const r = pctRunway({ usedPct: 95, burnPctPerHour: 5, ceilingPct: 90, nowSec: NOW_SEC });
  assert.equal(r.remaining_corridor_pct, 0);
  assert.equal(r.verdict, 'will-exhaust-before-reset');
});

test('pctRunway: burn unknown → unknown verdict, null hours_to_ceiling', () => {
  const r = pctRunway({
    usedPct: 50,
    burnPctPerHour: null,
    ceilingPct: 90,
    resetsAtSec: NOW_SEC + 3600,
    nowSec: NOW_SEC,
  });
  assert.equal(r.hours_to_ceiling, null);
  assert.equal(r.verdict, 'unknown');
  assert.equal(r.remaining_corridor_pct, 40);
});

test('pctRunway: zero burn + headroom → ample (never exhausts)', () => {
  const r = pctRunway({ usedPct: 50, burnPctPerHour: 0, ceilingPct: 90, nowSec: NOW_SEC });
  assert.equal(r.hours_to_ceiling, null);
  assert.equal(r.verdict, 'ample');
});

test('pctRunway: 7d window ceiling default override (85 hard stop)', () => {
  const r = pctRunway({ usedPct: 80, burnPctPerHour: 1, ceilingPct: 85, nowSec: NOW_SEC });
  assert.equal(r.ceiling_pct, 85);
  assert.equal(r.remaining_corridor_pct, 5);
});

// ── tokenWeightedShares ──────────────────────────────────────────────────────────────
test('tokenWeightedShares: proportional split sums to total', () => {
  const shares = tokenWeightedShares([1, 3], 100);
  assert.equal(shares.length, 2);
  assert.equal(shares[0], 25);
  assert.equal(shares[1], 75);
  assert.ok(Math.abs(shares[0] + shares[1] - 100) < 1e-9);
});

test('tokenWeightedShares: empty weights → []', () => {
  assert.deepEqual(tokenWeightedShares([], 100), []);
  assert.deepEqual(tokenWeightedShares(null, 100), []);
});

test('tokenWeightedShares: zero-sum weights → equal split (no signal)', () => {
  const shares = tokenWeightedShares([0, 0, 0], 90);
  assert.deepEqual(shares, [30, 30, 30]);
});

test('tokenWeightedShares: negative/NaN weights treated as 0', () => {
  // [-5, NaN, 10] → [0,0,10] → all to 3rd.
  const shares = tokenWeightedShares([-5, Number.NaN, 10], 100);
  assert.equal(shares[0], 0);
  assert.equal(shares[1], 0);
  assert.equal(shares[2], 100);
});

// ── pctCostToCompleteMonteCarlo（throughput-MC 在配额%增量上算）──────────────────────
test('pctCostToCompleteMonteCarlo: P50 ≤ P80 ≤ P95 (monotone) + sums per-unit %', () => {
  const pool = [1, 2, 3, 4, 5]; // 每单位工作的 %-增量样本
  const mc = pctCostToCompleteMonteCarlo(4, pool, { seed: 42, runs: 4000 });
  assert.ok(mc.pct.p50 <= mc.pct.p80 && mc.pct.p80 <= mc.pct.p95);
  assert.equal(mc.backlog, 4);
  assert.equal(mc.per_unit_samples, 5);
  // mean ≈ backlog × pool-mean (4 × 3 = 12)。
  assert.ok(Math.abs(mc.mean - 12) < 0.6, `mean ${mc.mean} ≈ 12`);
});

test('pctCostToCompleteMonteCarlo: deterministic for same seed', () => {
  const pool = [0.5, 1, 1.5, 2];
  const a = pctCostToCompleteMonteCarlo(6, pool, { seed: 7, runs: 2000 });
  const b = pctCostToCompleteMonteCarlo(6, pool, { seed: 7, runs: 2000 });
  assert.equal(a.pct.p50, b.pct.p50);
  assert.equal(a.pct.p95, b.pct.p95);
  assert.equal(a.mean, b.mean);
});

test('pctCostToCompleteMonteCarlo: different seed → different distribution', () => {
  // 离散 bootstrap 的分位可能跨 seed 偶合（小池整数和）——比连续 mean（2000 次平均·几乎不会相等）。
  const pool = [0.5, 1, 1.5, 2, 3, 4];
  const a = pctCostToCompleteMonteCarlo(6, pool, { seed: 42, runs: 2000 });
  const c = pctCostToCompleteMonteCarlo(6, pool, { seed: 99, runs: 2000 });
  assert.notEqual(a.mean, c.mean);
});

test('pctCostToCompleteMonteCarlo: backlog 0 → 0% (nothing left to spend)', () => {
  const mc = pctCostToCompleteMonteCarlo(0, [1, 2, 3], { seed: 1, runs: 100 });
  assert.equal(mc.pct.p50, 0);
  assert.equal(mc.mean, 0);
});

test('pctCostToCompleteMonteCarlo: empty pool → NaN, low confidence (cold-start degrade)', () => {
  const mc = pctCostToCompleteMonteCarlo(3, [], { seed: 1, runs: 100 });
  assert.ok(Number.isNaN(mc.pct.p50));
  assert.equal(mc.confidence, 'low');
  assert.equal(mc.per_unit_samples, 0);
});

test('pctCostToCompleteMonteCarlo: negative/NaN %-samples filtered; ≥10 → high confidence', () => {
  const pool = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, -1, Number.NaN];
  const mc = pctCostToCompleteMonteCarlo(2, pool, { seed: 42, runs: 1000 });
  assert.equal(mc.per_unit_samples, 10, 'negative + NaN filtered out');
  assert.equal(mc.confidence, 'high');
});
