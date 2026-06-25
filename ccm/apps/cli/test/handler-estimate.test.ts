// handler-estimate.test.ts — estimate noun handler（handlers/estimate.ts）契约门（ADR-015 §2·plan §12）。
//
// estimate = 工作侧只读 advisory namespace（全 verb runRead·消费 @ccm/engine OR/ML 算法层）。三类断言
//   （plan §12.2）：
//   ① property/invariant（算法变了仍恒真）：P50≤P80≤P95、SPI/CPI ∈ 合理域、makespan≥0、source/confidence 齐全。
//   ② golden snapshot（seeded·确定性）：固定 --seed + --as-of → 期望数值快照。算法改动 → golden diff 是有意的。
//   ③ 降级 case：cold-start 空 home / 无 baseline / 全缺 estimate（throughput 主导）→ 退原估值 + low-confidence。
//
// 数据底座：engine fixtures（packages/engine/test/fixtures/boards·repo 资产·plan §12.1）——current 当前板、
//   home-corpus 跨板语料、edge 边界。--board + --home 指 fixture，--as-of 固定让 forecast ETA 也确定。
//
// 零写不变式：estimate 全 runRead·绝不落盘（fixture 板字节不变）。

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

const CURRENT = resolve(FIX, 'current/active-estimate-engine.board.json');
const BASELINE_BOARD = resolve(FIX, 'current/baseline-example.board.json');
const HOME_CORPUS = resolve(FIX, 'home-corpus');
const COLD_START = resolve(FIX, 'edge/cold-start-empty.board.json');
const EMPTY_HOME = resolve(FIX, 'edge'); // edge dir 当作「无对口语料」的近似 home（混杂边界板）

// 临时板工厂（构造「active 任务全缺 estimate」的 forecast 目标·edge/all-missing-estimate 是全 done 归档板
//   〔throughput 语料〕·非 active forecast 目标，故 coverage<50% 路径用 inline 活动板测）。
let TMPDIRS: string[] = [];
function mkInlineBoard(tasks: unknown[]): string {
  const root = mkdtempSync(join(tmpdir(), 'ccm-est-'));
  TMPDIRS.push(root);
  const home = join(root, '.claude', 'cc-master');
  mkdirSync(home, { recursive: true });
  const bp = join(home, 'inline.board.json');
  writeFileSync(
    bp,
    JSON.stringify({
      schema: 'cc-master/v2',
      meta: { template_version: 3 },
      goal: 'inline estimate test',
      owner: { active: true, session_id: 'sid-est' },
      git: { worktree: '/repo/wt', branch: 'feat' },
      scheduling: { wip_limit: 4 },
      tasks,
      log: [],
    }),
  );
  return bp;
}
// mkHomeWithCorpus(corpusTasks, targetTasks) → 写一个 home（语料板 + 目标板）并返回 { home, targetBoard }。
//   corpus 板是 done 归档板（喂 calibrate/conformal 的历史 ratio）；target 板是 active forecast/show 目标。
//   用于 #bug-A 回归：构造 ratio≈1.4 的语料 → 校准乘子 + conformal 残差都来自它。
function mkHomeWithCorpus(
  corpusTasks: unknown[],
  targetTasks: unknown[],
): { home: string; targetBoard: string } {
  const root = mkdtempSync(join(tmpdir(), 'ccm-corpus-'));
  TMPDIRS.push(root);
  const home = join(root, '.claude', 'cc-master');
  mkdirSync(home, { recursive: true });
  writeFileSync(
    join(home, 'corpus.board.json'),
    JSON.stringify({
      schema: 'cc-master/v2',
      meta: { created_at: '2026-06-20T00:00:00Z' },
      goal: 'corpus archive',
      owner: { active: false, session_id: 'sid-corpus', heartbeat: '2026-06-20T00:00:00Z' },
      git: { worktree: '/repo/corpus', branch: 'main' },
      tasks: corpusTasks,
      log: [],
    }),
  );
  const targetBoard = join(home, 'target.board.json');
  writeFileSync(
    targetBoard,
    JSON.stringify({
      schema: 'cc-master/v2',
      meta: { template_version: 3, created_at: '2026-06-25T00:00:00Z' },
      goal: 'target estimate',
      owner: { active: true, session_id: 'sid-target' },
      git: { worktree: '/repo/target', branch: 'feat' },
      scheduling: { wip_limit: 4 },
      tasks: targetTasks,
      log: [],
    }),
  );
  return { home, targetBoard };
}
afterEach(() => {
  for (const d of TMPDIRS) rmSync(d, { recursive: true, force: true });
  TMPDIRS = [];
});

type TestCtx = Ctx & { outBuf: string[]; errBuf: string[] };
function mkCtx(
  boardPath: string,
  {
    home = HOME_CORPUS,
    values = {},
    positionals = [],
    json = true,
  }: {
    home?: string;
    values?: Record<string, unknown>;
    positionals?: string[];
    json?: boolean;
  } = {},
): TestCtx {
  const outBuf: string[] = [];
  const errBuf: string[] = [];
  return {
    values: { board: boardPath, home, ...values },
    positionals,
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
    env: { CC_MASTER_HOME: home },
    out: (s: string) => outBuf.push(s),
    err: (s: string) => errBuf.push(s),
    isTTY: true,
    outBuf,
    errBuf,
  };
}
function dataOf(ctx: TestCtx): any {
  return JSON.parse(ctx.outBuf.join('')).data;
}

// ══ estimate forecast ════════════════════════════════════════════════════════════════════════════

test('forecast: P50 ≤ P80 ≤ P95 monotonic (5% 硬墙·property)', () => {
  const ctx = mkCtx(CURRENT, { values: { scope: 'home', seed: '42', runs: '2000' } });
  const code = estimateHandler.forecast(ctx);
  assert.equal(code, EXIT.OK);
  const d = dataOf(ctx);
  const m = d.makespan;
  assert.ok(m.p50.value <= m.p80.value, `p50 ${m.p50.value} ≤ p80 ${m.p80.value}`);
  assert.ok(m.p80.value <= m.p95.value, `p80 ${m.p80.value} ≤ p95 ${m.p95.value}`);
  // 5% 硬墙：makespan p95 是有限值（非 Infinity·非 100% 概念），ETA 字段是 ISO 串。
  assert.ok(Number.isFinite(m.p95.value));
  assert.match(d.forecast.p95, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
});

test('forecast: seeded golden snapshot (deterministic·seed 42·runs 2000)', () => {
  const ctx = mkCtx(CURRENT, {
    values: { scope: 'home', seed: '42', runs: '2000', 'as-of': '2026-06-25T12:00:00Z' },
  });
  estimateHandler.forecast(ctx);
  const d = dataOf(ctx);
  // golden：算法改动 → 这些值会变（有意·需 review 更新·plan §12.2）。
  assert.deepEqual(d.makespan, {
    p50: { value: 16.16, unit: 'h' },
    p80: { value: 19.39, unit: 'h' },
    p95: { value: 23.72, unit: 'h' },
  });
  assert.deepEqual(d.throughput_days, { p50: 4, p80: 4, p95: 5 });
  assert.equal(d.coverage_pct, 83);
  assert.equal(d.history_n, 40);
  assert.equal(d.seed, 42);
  assert.equal(d.runs, 2000);
  assert.equal(d.source, 'calibrated');
  // consistency warning 真触发（估值 vs 吞吐偏差 > 20%）。
  assert.equal(d.consistency.warning, true);
  // 敏感度三件套齐全 + 按 CI 降序。
  assert.ok(d.criticality_index.length > 0);
  for (const s of d.criticality_index) {
    assert.ok('criticality' in s && 'cruciality' in s && 'sensitivity' in s);
  }
});

test('forecast same seed reproduces, different seed differs (determinism)', () => {
  const a = mkCtx(CURRENT, {
    values: { scope: 'home', seed: '7', runs: '1000', 'as-of': '2026-06-25T12:00:00Z' },
  });
  const b = mkCtx(CURRENT, {
    values: { scope: 'home', seed: '7', runs: '1000', 'as-of': '2026-06-25T12:00:00Z' },
  });
  const c = mkCtx(CURRENT, {
    values: { scope: 'home', seed: '99', runs: '1000', 'as-of': '2026-06-25T12:00:00Z' },
  });
  estimateHandler.forecast(a);
  estimateHandler.forecast(b);
  estimateHandler.forecast(c);
  assert.deepEqual(dataOf(a).makespan, dataOf(b).makespan, 'same seed → identical');
  assert.notDeepEqual(dataOf(a).makespan, dataOf(c).makespan, 'different seed → different');
});

test('forecast --mode throughput skips estimate channel', () => {
  const ctx = mkCtx(CURRENT, { values: { mode: 'throughput', scope: 'home', seed: '42' } });
  estimateHandler.forecast(ctx);
  const d = dataOf(ctx);
  assert.equal(d.makespan, null, 'no estimate-DAG makespan in throughput mode');
  assert.ok(d.throughput_days, 'throughput days present');
  assert.equal(d.criticality_index.length, 0);
});

test('forecast degrades when active tasks all miss estimate (coverage<50%·unit fallback note)', () => {
  // 全 active 任务无 estimate → coverage 0% → 吞吐通道主导 + unit-time fallback note。
  const bp = mkInlineBoard([
    { id: 'M1', status: 'ready', deps: [], type: 'development', executor: 'subagent' },
    { id: 'M2', status: 'ready', deps: ['M1'], type: 'development', executor: 'subagent' },
  ]);
  const ctx = mkCtx(bp, { home: EMPTY_HOME, values: { scope: 'this-board', seed: '42' } });
  const code = estimateHandler.forecast(ctx);
  assert.equal(code, EXIT.OK);
  const d = dataOf(ctx);
  assert.ok(d.coverage_pct < 50, `coverage ${d.coverage_pct} should be <50`);
  assert.ok(
    d.notes.some((n: string) => n.includes('coverage') || n.includes('unit-time')),
    'has degradation note',
  );
});

test('forecast cold-start (empty corpus) still produces estimate-channel makespan, low confidence', () => {
  const ctx = mkCtx(COLD_START, { home: EMPTY_HOME, values: { scope: 'this-board', seed: '42' } });
  const code = estimateHandler.forecast(ctx);
  assert.equal(code, EXIT.OK);
  const d = dataOf(ctx);
  // this-board scope + cold board has 0 done tasks → no history → low confidence + source estimate.
  assert.equal(d.confidence, 'low');
  assert.equal(d.source, 'estimate');
});

// ══ estimate show ════════════════════════════════════════════════════════════════════════════════

test('show <id>: calibrated estimate + conformal interval (golden·monotone)', () => {
  const ctx = mkCtx(CURRENT, {
    positionals: ['C6'],
    values: { scope: 'home', 'as-of': '2026-06-25T12:00:00Z' },
  });
  const code = estimateHandler.show(ctx);
  assert.equal(code, EXIT.OK);
  const d = dataOf(ctx);
  const row = d.tasks[0];
  assert.equal(row.id, 'C6');
  assert.equal(row.raw_estimate_h, 3);
  // golden calibration（home-corpus·type-level 收缩）。
  assert.equal(row.calibration.multiplier, 1.287);
  assert.equal(row.calibrated_h, 3.86);
  // conformal 区间单调（5% 硬墙）。
  assert.ok(row.interval.p50 <= row.interval.p80);
  assert.ok(row.interval.p80 <= row.interval.p95);
  assert.equal(row.coverage_basis, 'mondrian-group');
  assert.equal(row.confidence, 'high');
});

test('show: conformal interval feeds RAW estimate, not calibrated (no double-calibration·#bug-A)', () => {
  // 历史语料：8 个 done dev/subagent 任务·est=10h actual=14h → ratio=1.4（乐观因子）。
  //   calibrate 学到乘子（Bayesian 向 1.0 收缩·<1.4）；conformal 残差分位 = 1.4。
  // 目标任务：raw=10h。
  //   修复后（喂 rawHours）：interval p50 = 10 × ratio_p50(1.4) ≈ 14（乐观因子作用一次）。
  //   bug（喂 calibrated）：p50 ≈ calibrated × 1.4 ≈ 18+（乐观因子被乘第二次·codex 的 10→19.6 例）。
  const corpus = Array.from({ length: 8 }, (_, i) => ({
    id: `D${i}`,
    status: 'done',
    type: 'development',
    executor: 'subagent',
    estimate: { value: 10, unit: 'h' },
    started_at: '2026-06-20T00:00:00Z',
    finished_at: '2026-06-20T14:00:00Z', // actual=14h → ratio=1.4
  }));
  const { home, targetBoard } = mkHomeWithCorpus(corpus, [
    {
      id: 'T1',
      status: 'ready',
      deps: [],
      type: 'development',
      executor: 'subagent',
      estimate: { value: 10, unit: 'h' },
    },
  ]);
  const ctx = mkCtx(targetBoard, {
    home,
    positionals: ['T1'],
    values: { scope: 'home', 'as-of': '2026-06-25T12:00:00Z' },
  });
  const code = estimateHandler.show(ctx);
  assert.equal(code, EXIT.OK);
  const row = dataOf(ctx).tasks[0];
  assert.equal(row.raw_estimate_h, 10);
  // calibration 乘子学到 ~1.4 方向（Bayesian 收缩 → calibrated 落在 10~14·点估仍报 calibrated）。
  assert.ok(
    row.calibrated_h > 10 && row.calibrated_h < 15,
    `calibrated ${row.calibrated_h} ∈ (10,15)`,
  );
  assert.equal(row.coverage_basis, 'mondrian-group');
  // ★核心断言：p50 ≈ raw × 1.4 ≈ 14（乐观因子一次），而非 raw × 1.4 × 1.4 ≈ 19.6（双重 calibration·bug）。
  assert.ok(
    Math.abs(row.interval.p50 - 14) < 0.5,
    `p50 ${row.interval.p50} should ≈ 14 (raw×1.4·once), NOT ~19.6 (double-applied)`,
  );
  // 区间整体不应被乐观因子乘两次：p95 远低于「双重 calibration」会产生的 ~27（10×1.4×1.4×1.4 量级）。
  assert.ok(
    row.interval.p95 < 18,
    `p95 ${row.interval.p95} should not be inflated by double-calibration`,
  );
  // 单调性（5% 硬墙）仍成立。
  assert.ok(row.interval.p50 <= row.interval.p80 && row.interval.p80 <= row.interval.p95);
});

test('show: task with no estimate → no-history (degrade, retain null)', () => {
  // C7 在 fixture 无 estimate 字段？实际有；用 cold-start 板的 ready 任务（有 estimate 但无 home 语料）。
  const ctx = mkCtx(COLD_START, {
    home: EMPTY_HOME,
    positionals: ['G1'],
    values: { scope: 'this-board' },
  });
  estimateHandler.show(ctx);
  const d = dataOf(ctx);
  const row = d.tasks[0];
  // no home corpus → multiplier 退 1.0（no-history shrink）。
  assert.ok(row.calibration.source === 'no-history' || row.calibration.history_n === 0);
});

// ══ estimate evm ═════════════════════════════════════════════════════════════════════════════════

test('evm: consumes baseline → PV/EV/AC + SPI/CPI in domain (golden)', () => {
  const ctx = mkCtx(CURRENT, { values: { 'as-of': '2026-06-25T12:00:00Z' } });
  const code = estimateHandler.evm(ctx);
  assert.equal(code, EXIT.OK);
  const d = dataOf(ctx);
  assert.equal(d.has_baseline, true);
  // golden EVM numbers (baseline bac_h=29, 3 done tasks C1/C2/C3 → EV=10h).
  assert.deepEqual(d.pv, { value: 29, unit: 'h' });
  assert.deepEqual(d.ev, { value: 10, unit: 'h' });
  assert.equal(d.ac.value, 13.5);
  assert.equal(d.ac.coverage_pct, 100);
  assert.equal(d.spi, 0.345);
  assert.equal(d.cpi, 0.741);
  // SPI(t) / Earned Schedule 字段存在且在域内。
  assert.ok(d.spi_t > 0 && d.spi_t < 2);
  assert.equal(d.source, 'evm-earned-schedule');
});

test('evm: no baseline → graceful warn (has_baseline:false, exit 0)', () => {
  const ctx = mkCtx(COLD_START, { home: EMPTY_HOME, values: { 'as-of': '2026-06-25T12:00:00Z' } });
  const code = estimateHandler.evm(ctx);
  assert.equal(code, EXIT.OK);
  const d = dataOf(ctx);
  assert.equal(d.has_baseline, false);
  assert.ok(d.warnings.length > 0, 'has degradation warning');
});

test('evm --ac-source token uses token AC unit', () => {
  const ctx = mkCtx(CURRENT, { values: { 'ac-source': 'token', 'as-of': '2026-06-25T12:00:00Z' } });
  estimateHandler.evm(ctx);
  const d = dataOf(ctx);
  assert.equal(d.ac.source, 'token');
  assert.equal(d.ac.unit, 'tok');
});

// ══ estimate velocity ════════════════════════════════════════════════════════════════════════════

test('velocity: SLE quantiles monotone + history_n (golden)', () => {
  const ctx = mkCtx(CURRENT, { values: { scope: 'home', 'as-of': '2026-06-25T12:00:00Z' } });
  const code = estimateHandler.velocity(ctx);
  assert.equal(code, EXIT.OK);
  const d = dataOf(ctx);
  assert.ok(d.sle.p50 <= d.sle.p85, `SLE p50 ${d.sle.p50} ≤ p85 ${d.sle.p85}`);
  assert.ok(d.sle.p85 <= d.sle.p95, `SLE p85 ${d.sle.p85} ≤ p95 ${d.sle.p95}`);
  // golden SLE（home-corpus cycle-time 分位）。
  assert.deepEqual(d.sle, {
    p50: 2.58,
    p85: 5.6,
    p95: 9.18,
    unit: 'h',
    confidence: 'high',
    history_n: 40,
  });
  assert.equal(d.confidence, 'high');
});

test('velocity cold-start → no-history source, low confidence', () => {
  const ctx = mkCtx(COLD_START, { home: EMPTY_HOME, values: { scope: 'this-board' } });
  estimateHandler.velocity(ctx);
  const d = dataOf(ctx);
  assert.equal(d.source, 'no-history');
  assert.equal(d.confidence, 'low');
});

// ══ estimate risk ════════════════════════════════════════════════════════════════════════════════

test('risk: CI/CRI/SSI + WIP-aging SLE + CCPM buffer_health (golden)', () => {
  const ctx = mkCtx(CURRENT, {
    values: { scope: 'home', seed: '42', 'as-of': '2026-06-25T12:00:00Z' },
  });
  const code = estimateHandler.risk(ctx);
  assert.equal(code, EXIT.OK);
  const d = dataOf(ctx);
  // 敏感度三件套（CI∈[0,1], SSI∈[0,1], CRI∈[-1,1]）。
  for (const s of d.criticality_index) {
    assert.ok(s.criticality >= 0 && s.criticality <= 1, `CI ${s.criticality} ∈ [0,1]`);
    assert.ok(s.sensitivity >= 0 && s.sensitivity <= 1, `SSI ${s.sensitivity} ∈ [0,1]`);
    assert.ok(s.cruciality >= -1 && s.cruciality <= 1, `CRI ${s.cruciality} ∈ [-1,1]`);
  }
  // WIP-aging：C5 critical（age 远超 SLE_P95）, C4 at_risk（age 介于 P85/P95·golden 取决于 as-of）。
  const c5 = d.wip_aging.find((a: { id: string }) => a.id === 'C5');
  assert.ok(c5, 'C5 in-flight should appear aged');
  assert.equal(c5.status, 'critical');
  // CCPM buffer_health 三区之一 + zone 字段。
  assert.ok(['green', 'yellow', 'red'].includes(d.ccpm.zone));
  assert.ok(typeof d.ccpm.buffer_health === 'number');
});

test('risk cold-start → empty/low (no crash)', () => {
  const ctx = mkCtx(COLD_START, { home: EMPTY_HOME, values: { scope: 'this-board', seed: '42' } });
  const code = estimateHandler.risk(ctx);
  assert.equal(code, EXIT.OK);
  const d = dataOf(ctx);
  assert.equal(d.source, 'estimate');
  assert.equal(d.confidence, 'low');
});

// ══ backtest hook（--as-of 回放·plan §12.2/§12.3）═══════════════════════════════════════════════

test('backtest: --as-of in the past changes EVM AT (Actual Time elapsed)', () => {
  const early = mkCtx(CURRENT, { values: { 'as-of': '2026-06-22T12:00:00Z' } });
  const late = mkCtx(CURRENT, { values: { 'as-of': '2026-06-25T12:00:00Z' } });
  estimateHandler.evm(early);
  estimateHandler.evm(late);
  const de = dataOf(early);
  const dl = dataOf(late);
  assert.ok(de.at_hours < dl.at_hours, 'earlier as-of → less elapsed time');
});

// ══ 零写不变式（estimate 纯只读·绝不落盘）═══════════════════════════════════════════════════════

test('estimate handlers never write the board (zero-write invariant)', () => {
  const before = readFileSync(CURRENT, 'utf8');
  estimateHandler.forecast(mkCtx(CURRENT, { values: { scope: 'home', seed: '42' } }));
  estimateHandler.evm(mkCtx(CURRENT, { values: {} }));
  estimateHandler.velocity(mkCtx(CURRENT, { values: { scope: 'home' } }));
  estimateHandler.risk(mkCtx(CURRENT, { values: { scope: 'home', seed: '42' } }));
  estimateHandler.show(mkCtx(CURRENT, { positionals: ['C6'], values: { scope: 'home' } }));
  assert.equal(
    readFileSync(CURRENT, 'utf8'),
    before,
    'fixture board byte-identical after estimate reads',
  );
});

// ══ baseline-example 板交叉验证（evm on the dedicated baseline fixture）════════════════════════════

test('evm on baseline-example fixture: SPI/CPI computed (baseline bac_h=12)', () => {
  const ctx = mkCtx(BASELINE_BOARD, { values: { 'as-of': '2026-06-25T12:00:00Z' } });
  estimateHandler.evm(ctx);
  const d = dataOf(ctx);
  assert.equal(d.has_baseline, true);
  assert.equal(d.bac.value, 12);
  assert.ok(d.pv.value >= 0 && d.pv.value <= 12);
});
