// estimate-ml-layer.test.ts — history-loader + calibration + conformal + k-NN（ML 层·ADR-015）。
//   喂 home-corpus fixtures（7 板·40 done·act/est=1.38 右偏）。property/invariant + seeded golden +
//   edge 降级（冷启动 / 单板薄语料 / 全缺 estimate）。

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  calibrate,
  calibratedEstimate,
  conformalInterval,
  dispersionCv,
  empiricalCoverage,
  extractDoneRecords,
  knnPredict,
  loadCorpus,
  poolLayers,
  quantilesOf,
  selectPoolLayer,
} from '../dist/index.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const BOARDS = join(HERE, 'fixtures', 'boards');
const HOME = join(BOARDS, 'home-corpus');
const NOW = Date.parse('2026-06-25T13:00:00Z');

const readBoard = (p: string) => JSON.parse(readFileSync(p, 'utf8'));

// ── history-loader：跨板抽取 + recency cap ──────────────────────────────────────────
test('loadCorpus: extracts 40 done records from 7-board home-corpus', () => {
  const corpus = loadCorpus(HOME, { nowMs: NOW, maxDaysAgo: 90 });
  assert.equal(corpus.length, 40, 'README documents 40 done tasks');
});

test('loadCorpus: every record carries source-honest annotations', () => {
  const corpus = loadCorpus(HOME, { nowMs: NOW });
  for (const r of corpus) {
    assert.equal(typeof r.repo, 'string');
    assert.equal(typeof r.type, 'string');
    assert.equal(typeof r.taskId, 'string');
    // ratio 只在 est+actual 皆有时存在（诚实·缺数据 → null）。
    if (r.ratio != null) {
      assert.ok(r.estimateHours != null && r.actualHours != null);
      assert.ok(r.ratio > 0);
    }
  }
});

test('loadCorpus: global act/est ≈ 1.38 (right-skew documented)', () => {
  const corpus = loadCorpus(HOME, { nowMs: NOW });
  const withRatio = corpus.filter((r) => r.ratio != null);
  const totEst = withRatio.reduce((s, r) => s + (r.estimateHours as number), 0);
  const totAct = withRatio.reduce((s, r) => s + (r.actualHours as number), 0);
  const global = totAct / totEst;
  assert.ok(Math.abs(global - 1.38) < 0.02, `global act/est ${global.toFixed(3)} ≠ ~1.38`);
});

test('loadHomeBoards: recency cutoff drops ancient boards', () => {
  // maxDaysAgo=14 from NOW → only the most recent boards (~1-2.5 weeks) survive.
  const corpus14 = loadCorpus(HOME, { nowMs: NOW, maxDaysAgo: 14 });
  const corpus90 = loadCorpus(HOME, { nowMs: NOW, maxDaysAgo: 90 });
  assert.ok(corpus14.length < corpus90.length, 'tighter recency window → fewer records');
});

test('loadHomeBoards: maxBoards cap respected', () => {
  const corpusCap2 = loadCorpus(HOME, { nowMs: NOW, maxBoards: 2, maxDaysAgo: 365 });
  const corpusAll = loadCorpus(HOME, { nowMs: NOW, maxBoards: 50, maxDaysAgo: 365 });
  assert.ok(corpusCap2.length < corpusAll.length, 'maxBoards=2 caps record count');
});

// ── 多层收缩桶（hierarchical partial pooling）──────────────────────────────────────
test('poolLayers: nesting is monotone (specific ⊆ broad)', () => {
  const corpus = loadCorpus(HOME, { nowMs: NOW });
  const layers = poolLayers(corpus, {
    repo: '/work/auth-service',
    type: 'development',
    executor: 'subagent',
    tier: 'mid',
  });
  // home 层 = 全集；每往具体走样本数不增。
  for (let i = 1; i < layers.length; i++) {
    assert.ok(
      (layers[i - 1] as { records: unknown[] }).records.length <=
        (layers[i] as { records: unknown[] }).records.length,
      'more specific layer ⊆ broader',
    );
  }
  assert.equal((layers[layers.length - 1] as { records: unknown[] }).records.length, corpus.length);
});

test('selectPoolLayer: degrades to broader layer + lower confidence when specific is thin', () => {
  const corpus = loadCorpus(HOME, { nowMs: NOW });
  // unknown repo → specific layers empty → degrade to type/home + low.
  const sel = selectPoolLayer(corpus, { repo: '/no/such/repo', type: 'development' }, 3);
  assert.ok(['type', 'home'].includes(sel.layer.level));
  assert.equal(sel.confidence, 'low');
});

// ── calibration（EWMA + Bayesian shrinkage ≅ RCF）─────────────────────────────────
test('calibrate: multiplier > 1 for optimistic-biased corpus (act/est=1.38)', () => {
  const corpus = loadCorpus(HOME, { nowMs: NOW });
  const cal = calibrate(corpus, { type: 'development' }, { nowMs: NOW });
  assert.ok(cal.multiplier > 1, `corpus is optimistic → multiplier ${cal.multiplier} should be >1`);
  assert.ok(cal.multiplier < 2, 'but bounded (shrinkage)');
  assert.equal(typeof cal.confidence, 'string');
  assert.ok(['high', 'medium', 'low'].includes(cal.confidence));
});

test('calibrate: specific layer (repo+type+executor+tier) when N≥3 → high confidence', () => {
  const corpus = loadCorpus(HOME, { nowMs: NOW });
  const cal = calibrate(
    corpus,
    { repo: '/work/auth-service', type: 'development', executor: 'subagent', tier: 'mid' },
    { nowMs: NOW },
  );
  assert.equal(cal.level, 'repo+type+executor+tier');
  assert.equal(cal.confidence, 'high');
  // N=5 with default priorStrength k=3 → 5 < 2k=6 → still meaningfully shrunk-to-prior (honest).
  assert.ok(['calibrated', 'shrunk-to-prior'].includes(cal.source));
  assert.equal(cal.history_n, 5);
});

test('calibrate: empty corpus → shrinks to prior 1.0 + no-history', () => {
  const cal = calibrate([], { type: 'development' }, { nowMs: NOW });
  assert.equal(cal.multiplier, 1.0);
  assert.equal(cal.source, 'no-history');
  assert.equal(cal.confidence, 'low');
  assert.equal(cal.history_n, 0);
});

test('calibrate: Bayesian shrinkage pulls small-N toward prior', () => {
  const corpus = loadCorpus(HOME, { nowMs: NOW });
  // strong prior (k=100) should pull multiplier near 1.0 even with biased data.
  const shrunk = calibrate(corpus, { type: 'development' }, { nowMs: NOW, priorStrength: 100 });
  const weak = calibrate(corpus, { type: 'development' }, { nowMs: NOW, priorStrength: 1 });
  assert.ok(
    Math.abs(shrunk.multiplier - 1.0) < Math.abs(weak.multiplier - 1.0),
    'stronger prior → closer to 1.0',
  );
});

test('calibratedEstimate: applies multiplier; null in → null out', () => {
  const corpus = loadCorpus(HOME, { nowMs: NOW });
  const cal = calibrate(corpus, { type: 'development' }, { nowMs: NOW });
  const adj = calibratedEstimate(4, cal);
  assert.ok(adj != null && adj > 4, 'optimistic-corrected estimate > raw');
  assert.equal(calibratedEstimate(null, cal), null);
});

test('calibrate: seeded golden (development layer, NOW)', () => {
  const corpus = loadCorpus(HOME, { nowMs: NOW });
  const cal = calibrate(corpus, { type: 'development' }, { nowMs: NOW });
  // golden snapshot（确定性·算法改即更新）。
  assert.ok(Math.abs(cal.multiplier - 1.2867) < 1e-3, `multiplier golden: ${cal.multiplier}`);
  assert.equal(cal.history_n, 23);
});

// ── conformal（split + Mondrian）+ coverage property ───────────────────────────────
test('conformal: P50 ≤ P80 ≤ P95 (monotone interval)', () => {
  const corpus = loadCorpus(HOME, { nowMs: NOW });
  const c = conformalInterval(4, corpus, { dim: 'type', group: { type: 'development' } });
  assert.ok(c.p50 <= c.p80 && c.p80 <= c.p95, `interval not monotone: ${JSON.stringify(c)}`);
});

test('conformal: Mondrian group basis when group has enough samples', () => {
  const corpus = loadCorpus(HOME, { nowMs: NOW });
  const c = conformalInterval(4, corpus, { dim: 'type', group: { type: 'development' } });
  assert.equal(c.coverage_basis, 'mondrian-group');
  assert.equal(c.confidence, 'high');
});

test('conformal: empty corpus → interval collapses to point + no-history', () => {
  const c = conformalInterval(4, [], { group: { type: 'development' } });
  assert.equal(c.p50, 4);
  assert.equal(c.p95, 4);
  assert.equal(c.coverage_basis, 'no-history');
  assert.equal(c.confidence, 'low');
});

test('conformal: empirical coverage ≈ nominal 0.95 (LOO)', () => {
  const corpus = loadCorpus(HOME, { nowMs: NOW });
  const { coverage, n } = empiricalCoverage(corpus, 0.95);
  assert.equal(n, 40);
  // LOO 95% conformal 覆盖率应 ≈ 0.95（采样误差内·此语料 0.925）。
  assert.ok(coverage >= 0.85 && coverage <= 1.0, `coverage ${coverage} far from nominal 0.95`);
});

test('quantilesOf: p95 is the 5% hard wall (never 100%)', () => {
  // p95 永远是 0.95 分位，绝不取 max（5% 硬墙·ADR-015 §2.6）。
  const vals = Array.from({ length: 100 }, (_, i) => i + 1); // 1..100
  const q = quantilesOf(vals);
  assert.ok(q.p95 < 100, `p95 ${q.p95} must be below the max (5% hard wall)`);
  assert.ok(q.p95 >= 90 && q.p95 <= 96);
});

test('dispersionCv: wider for high-variance corpus, positive', () => {
  const corpus = loadCorpus(HOME, { nowMs: NOW });
  const cv = dispersionCv(corpus, { type: 'development' }, { nowMs: NOW });
  assert.ok(cv > 0, 'cv must be positive');
  assert.ok(cv < 2, 'cv bounded for this corpus');
});

// ── k-NN 案例推理 ─────────────────────────────────────────────────────────────────
test('knn: predicts hours + tokens for similar dev task', () => {
  const corpus = loadCorpus(HOME, { nowMs: NOW });
  const r = knnPredict(
    {
      repo: '/work/auth-service',
      type: 'development',
      executor: 'subagent',
      tier: 'mid',
      estimateHours: 4,
    },
    corpus,
    { nowMs: NOW, k: 5 },
  );
  assert.ok(r.predictedHours != null && r.predictedHours > 0);
  assert.ok(r.predictedTokens != null && r.predictedTokens > 0);
  assert.equal(r.neighbors.length, 5);
  // neighbors sorted by distance ascending.
  for (let i = 1; i < r.neighbors.length; i++) {
    assert.ok(
      (r.neighbors[i] as { distance: number }).distance >=
        (r.neighbors[i - 1] as { distance: number }).distance,
    );
  }
});

test('knn: empty corpus → null prediction + low confidence', () => {
  const r = knnPredict({ type: 'development' }, [], {});
  assert.equal(r.predictedHours, null);
  assert.equal(r.confidence, 'low');
  assert.equal(r.history_n, 0);
});

test('knn: deterministic (stable tie-break by id)', () => {
  const corpus = loadCorpus(HOME, { nowMs: NOW });
  const q = { type: 'development', executor: 'subagent', estimateHours: 4 };
  const a = knnPredict(q, corpus, { nowMs: NOW, k: 5 });
  const b = knnPredict(q, corpus, { nowMs: NOW, k: 5 });
  assert.equal(a.predictedHours, b.predictedHours);
  assert.deepEqual(
    a.neighbors.map((n) => (n as { record: { taskId: string } }).record.taskId),
    b.neighbors.map((n) => (n as { record: { taskId: string } }).record.taskId),
  );
});

// ── edge：单板薄语料 / 全缺 estimate / 冷启动 ────────────────────────────────────────
test('edge: single-board thin corpus (2 done) → all layers degrade, low confidence', () => {
  const board = readBoard(join(BOARDS, 'edge', 'single-board-thin-corpus.board.json'));
  const corpus = extractDoneRecords(board);
  assert.equal(corpus.length, 2);
  const cal = calibrate(corpus, { type: 'development' }, { nowMs: NOW });
  // type=development has only 1 done here (S2 is doc-alignment) → < minN → degrade.
  assert.ok(['low', 'medium'].includes(cal.confidence));
});

test('edge: all-missing-estimate → records have null estimate/ratio (calibrate → no-history)', () => {
  const board = readBoard(join(BOARDS, 'edge', 'all-missing-estimate.board.json'));
  const corpus = extractDoneRecords(board);
  assert.equal(corpus.length, 5);
  for (const r of corpus) {
    assert.equal(r.estimateHours, null);
    assert.equal(r.ratio, null);
  }
  // no ratio anywhere → calibration falls to prior.
  const cal = calibrate(corpus, { type: 'development' }, { nowMs: NOW });
  assert.equal(cal.source, 'no-history');
  assert.equal(cal.multiplier, 1.0);
});

test('edge: cold-start empty home → loadCorpus returns []', () => {
  const corpus = loadCorpus(join(BOARDS, 'no-such-dir-cold-start'), { nowMs: NOW });
  assert.deepEqual(corpus, []);
});
