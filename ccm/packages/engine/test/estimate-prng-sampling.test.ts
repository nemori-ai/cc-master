// estimate-prng-sampling.test.ts — sfc32 PRNG + Box-Muller log-normal 采样（ADR-015 算法层）。
//   property/invariant + seeded golden。测 build 后 dist barrel（同既有测试风格·NodeNext `.js` 直跑解析不了）。

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  logNormalParamsFromMeanCv,
  makePrng,
  Sfc32,
  sampleNormal,
  sampleTaskDuration,
} from '../dist/index.mjs';

// ── PRNG determinism（同 seed → 同序列·绝不 Math.random）────────────────────────────
test('sfc32: same seed → identical sequence (determinism)', () => {
  const a = new Sfc32(42);
  const b = new Sfc32(42);
  for (let i = 0; i < 100; i++) assert.equal(a.next(), b.next());
});

test('sfc32: different seeds → different sequence', () => {
  const a = new Sfc32(42);
  const b = new Sfc32(43);
  let differs = false;
  for (let i = 0; i < 20; i++) {
    if (a.next() !== b.next()) differs = true;
  }
  assert.ok(differs, 'seed 42 and 43 must diverge');
});

test('sfc32: output in [0,1)', () => {
  const g = new Sfc32(7);
  for (let i = 0; i < 1000; i++) {
    const v = g.next();
    assert.ok(v >= 0 && v < 1, `value ${v} out of [0,1)`);
  }
});

test('sfc32: roughly uniform mean ≈ 0.5 (statistical sanity)', () => {
  const g = new Sfc32(123);
  let sum = 0;
  const n = 50000;
  for (let i = 0; i < n; i++) sum += g.next();
  const mean = sum / n;
  assert.ok(Math.abs(mean - 0.5) < 0.02, `mean ${mean} too far from 0.5`);
});

test('sfc32: nextInt(n) in [0,n)', () => {
  const g = new Sfc32(9);
  for (let i = 0; i < 1000; i++) {
    const v = g.nextInt(7);
    assert.ok(v >= 0 && v < 7 && Number.isInteger(v));
  }
});

// seeded golden：固定 seed 的前几个 draw（算法改 → golden diff 是有意的）。
test('sfc32: seeded golden (seed=42, first 3 draws)', () => {
  const g = new Sfc32(42);
  const draws = [g.next(), g.next(), g.next()];
  // golden snapshot（确定性·算法变即更新）。
  const expected = [0.5633560579735786, 0.2889618668705225, 0.0059162762481719255];
  for (let i = 0; i < 3; i++) {
    assert.ok(
      Math.abs((draws[i] as number) - (expected[i] as number)) < 1e-12,
      `draw[${i}]=${draws[i]} ≠ golden ${expected[i]}`,
    );
  }
});

// ── sampling：normal mean≈0 / log-normal 形 ────────────────────────────────────────
test('sampleNormal: mean ≈ 0, stddev ≈ 1', () => {
  const prng = makePrng(55);
  const n = 50000;
  let sum = 0;
  const vals: number[] = [];
  for (let i = 0; i < n; i++) {
    const z = sampleNormal(prng);
    vals.push(z);
    sum += z;
  }
  const mean = sum / n;
  let v = 0;
  for (const x of vals) v += (x - mean) * (x - mean);
  const sd = Math.sqrt(v / n);
  assert.ok(Math.abs(mean) < 0.03, `normal mean ${mean}`);
  assert.ok(Math.abs(sd - 1) < 0.03, `normal sd ${sd}`);
});

test('logNormalParamsFromMeanCv: recovers original-space mean in expectation', () => {
  const prng = makePrng(77);
  const mean = 5;
  const cv = 0.5;
  const { mu, sigma } = logNormalParamsFromMeanCv(mean, cv);
  // E[X] = exp(mu + sigma²/2) should ≈ mean.
  const analyticMean = Math.exp(mu + (sigma * sigma) / 2);
  assert.ok(Math.abs(analyticMean - mean) < 1e-9, `analytic mean ${analyticMean} ≠ ${mean}`);
  // empirical
  let s = 0;
  const n = 80000;
  for (let i = 0; i < n; i++) s += sampleTaskDuration(prng, mean, cv);
  const emp = s / n;
  assert.ok(Math.abs(emp - mean) / mean < 0.05, `empirical mean ${emp} far from ${mean}`);
});

test('sampleTaskDuration: always positive (log-normal); mean<=0 → 0', () => {
  const prng = makePrng(11);
  for (let i = 0; i < 1000; i++) {
    assert.ok(sampleTaskDuration(prng, 3, 0.4) > 0);
  }
  assert.equal(sampleTaskDuration(prng, 0, 0.4), 0);
  assert.equal(sampleTaskDuration(prng, -1, 0.4), 0);
});

test('sampleTaskDuration: right-skew (median < mean for log-normal)', () => {
  const prng = makePrng(33);
  const n = 40000;
  const vals: number[] = [];
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const x = sampleTaskDuration(prng, 5, 0.6);
    vals.push(x);
    sum += x;
  }
  vals.sort((a, b) => a - b);
  const median = vals[Math.floor(n / 2)] as number;
  const mean = sum / n;
  assert.ok(median < mean, `log-normal should be right-skewed: median ${median} < mean ${mean}`);
});
