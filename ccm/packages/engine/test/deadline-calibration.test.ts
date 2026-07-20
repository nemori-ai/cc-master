// deadline-calibration.test.ts — deadline 经验校准框架自证（issue #168·labeled snapshot + backtest 脚手架）。
//   ★验的是「脚手架本身能跑 + 诚实闸对合成/不足数据 fail-closed」，**不是**验校准结果（无真实语料）。
//   覆盖：snapshot 采集 build / label 真值表 resolveLabel / deriveTerminalOutcome / reconcile 回填 /
//         JSONL store roundtrip / backtest 度量数学 / 诚实闸（synthetic→不可校准）/ sweep / 合成数据生成。

import assert from 'node:assert/strict';
import { appendFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  appendDeadlineSnapshot,
  assessProvenance,
  backtestDeadlineBands,
  bandsSignature,
  buildDeadlineSnapshot,
  defaultThresholdGrid,
  deriveTerminalOutcome,
  loadDeadlineSnapshots,
  MIN_OBSERVED_FOR_CALIBRATION,
  makeSyntheticSnapshots,
  reconcileSnapshotLabels,
  resolveLabel,
  snapshotId,
  snapshotStorePath,
  sweepDeadlineBands,
  writeDeadlineSnapshots,
} from '../dist/index.mjs';

// 一个最小 DeadlineRiskResult stub（buildDeadlineSnapshot 只读其字段·无需真 computeDeadlineRisk）。
function riskStub(over = {}) {
  return {
    deadline: '2026-03-01T00:00:00Z',
    deadline_state: 'confirmed',
    as_of: '2026-02-01T00:00:00Z',
    time_remaining_hours: 100,
    on_time_probability: 0.72,
    on_time_probability_source: 'rcpsp-in-trial',
    forecast: null,
    margin: null,
    risk_band: 'watch',
    strength: 'weak',
    channels: {
      precedence_only: null,
      resource_aware: {
        on_time_probability: 0.72,
        source: 'rcpsp-in-trial',
        wip: 4,
        runs: 2000,
        makespan_p50_h: 1,
        makespan_p80_h: 2,
        makespan_p95_h: 3,
      },
      throughput_reference: null,
    },
    channel_disagreement: null,
    coverage_pct: 100,
    confidence: 'high',
    history_n: 40,
    scope: 'home',
    calibration_status: 'uncalibrated-conservative',
    top_drivers: [],
    runs: 2000,
    rcpsp_runs: 2000,
    seed: 42,
    source: 'calibrated',
    notes: [],
    ...over,
  };
}

// ── ① 采集：buildDeadlineSnapshot 定格预测 band + 保留校准诚实标注 ────────────────────────────────
test('buildDeadlineSnapshot: 定格 predicted_band + 保留 calibration_status（诚实·label 待定）', () => {
  const risk = riskStub();
  const snap = buildDeadlineSnapshot(risk, { boardId: 'b1', capturedAtMs: 1000 });
  assert.equal(snap.schema, 'ccm.deadline-snapshot.v1');
  assert.equal(snap.snapshot_id, snapshotId('b1', 1000));
  assert.equal(snap.predicted_band, 'watch'); // 预测被定格
  assert.equal(snap.on_time_probability, 0.72);
  assert.equal(snap.calibration_status_at_capture, 'uncalibrated-conservative'); // 诚实链
  assert.equal(snap.provenance, 'observed'); // 默认真实采集
  assert.equal(snap.label, 'unknown'); // 终态未知
  assert.equal(snap.resolved_at_ms, null);
});

test('buildDeadlineSnapshot: provenance 可显式标 synthetic', () => {
  const snap = buildDeadlineSnapshot(riskStub(), {
    boardId: 'b1',
    capturedAtMs: 1,
    provenance: 'synthetic',
  });
  assert.equal(snap.provenance, 'synthetic');
});

// ── ② label 真值表：resolveLabel ────────────────────────────────────────────────────────────────
test('resolveLabel: 交付于 DDL 前 → on_time', () => {
  const r = resolveLabel({
    board_id: 'b',
    deadline_at_ms: 1000,
    delivered: true,
    actual_finish_ms: 900,
    observed_at_ms: 950,
  });
  assert.equal(r.label, 'on_time');
});
test('resolveLabel: 交付晚于 DDL → late', () => {
  const r = resolveLabel({
    board_id: 'b',
    deadline_at_ms: 1000,
    delivered: true,
    actual_finish_ms: 1100,
    observed_at_ms: 1100,
  });
  assert.equal(r.label, 'late');
});
test('resolveLabel: 未交付且已过 DDL → late', () => {
  const r = resolveLabel({
    board_id: 'b',
    deadline_at_ms: 1000,
    delivered: false,
    actual_finish_ms: null,
    observed_at_ms: 1200,
  });
  assert.equal(r.label, 'late');
});
test('resolveLabel: 未交付且未到 DDL → unknown（仍在飞·不能 label）', () => {
  const r = resolveLabel({
    board_id: 'b',
    deadline_at_ms: 1000,
    delivered: false,
    actual_finish_ms: null,
    observed_at_ms: 500,
  });
  assert.equal(r.label, 'unknown');
});
test('resolveLabel: 无 DDL → unknown（无可校准目标）', () => {
  const r = resolveLabel({
    board_id: 'b',
    deadline_at_ms: null,
    delivered: true,
    actual_finish_ms: 900,
    observed_at_ms: 950,
  });
  assert.equal(r.label, 'unknown');
});

// ── ③ deriveTerminalOutcome（默认近似·从 board 派生）────────────────────────────────────────────
test('deriveTerminalOutcome: 全部 done → delivered + 取 max finished_at', () => {
  const board = {
    goal: 'ship it',
    goal_contract: { deadline: { state: 'confirmed', at: '2026-03-01T00:00:00Z' } },
    tasks: [
      { id: 't1', status: 'done', finished_at: '2026-02-01T00:00:00Z' },
      { id: 't2', status: 'done', finished_at: '2026-02-05T00:00:00Z' },
      { id: 't3', status: 'cancelled' }, // cancelled 不计入交付判据
    ],
  };
  const o = deriveTerminalOutcome(board, Date.parse('2026-02-10T00:00:00Z'));
  assert.equal(o.delivered, true);
  assert.equal(o.actual_finish_ms, Date.parse('2026-02-05T00:00:00Z'));
  assert.equal(o.deadline_at_ms, Date.parse('2026-03-01T00:00:00Z'));
});
test('deriveTerminalOutcome: 有未完成任务 → 未交付', () => {
  const board = {
    goal: 'x',
    tasks: [
      { id: 't1', status: 'done' },
      { id: 't2', status: 'ready' },
    ],
  };
  const o = deriveTerminalOutcome(board, 999);
  assert.equal(o.delivered, false);
  assert.equal(o.actual_finish_ms, null);
});

// ── ④ reconcile 回填 label ──────────────────────────────────────────────────────────────────────
test('reconcileSnapshotLabels: 用终态 outcome 回填 unknown snapshot 的 label', () => {
  const snap = buildDeadlineSnapshot(riskStub(), { boardId: 'bX', capturedAtMs: 5 });
  assert.equal(snap.label, 'unknown');
  const outcome = {
    board_id: 'bX',
    deadline_at_ms: 1000,
    delivered: false,
    actual_finish_ms: null,
    observed_at_ms: 2000,
  };
  const [filled] = reconcileSnapshotLabels([snap], [outcome], 3000);
  assert.equal(filled.label, 'late');
  assert.equal(filled.resolved_at_ms, 3000);
  assert.equal(filled.resolution_basis, 'deadline-passed-undelivered');
});
test('reconcileSnapshotLabels: 已 label 的不回退', () => {
  const snap = {
    ...buildDeadlineSnapshot(riskStub(), { boardId: 'bX', capturedAtMs: 5 }),
    label: 'on_time',
  };
  const outcome = {
    board_id: 'bX',
    deadline_at_ms: 1000,
    delivered: false,
    actual_finish_ms: null,
    observed_at_ms: 2000,
  };
  const [same] = reconcileSnapshotLabels([snap], [outcome], 3000);
  assert.equal(same.label, 'on_time'); // 终态单调·不回退
});

// ── ⑤ store JSONL roundtrip（唯一碰 fs 的一段）────────────────────────────────────────────────────
test('store: append → load roundtrip + 坏行跳过', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ddl-calib-'));
  try {
    const s1 = buildDeadlineSnapshot(riskStub(), { boardId: 'a', capturedAtMs: 1 });
    const s2 = buildDeadlineSnapshot(riskStub({ risk_band: 'at_risk' }), {
      boardId: 'b',
      capturedAtMs: 2,
    });
    appendDeadlineSnapshot(dir, s1);
    appendDeadlineSnapshot(dir, s2);
    const loaded = loadDeadlineSnapshots(dir);
    assert.equal(loaded.length, 2);
    assert.equal(loaded[0].board_id, 'a');
    assert.equal(loaded[1].predicted_band, 'at_risk');
    // 追加一坏行·仍只 load 到 2 条有效。
    appendFileSync(snapshotStorePath(dir), 'not-json\n');
    assert.equal(loadDeadlineSnapshots(dir).length, 2);
    // rewrite（label 回填后落盘）。
    writeDeadlineSnapshots(dir, [{ ...s1, label: 'late' }]);
    const after = loadDeadlineSnapshots(dir);
    assert.equal(after.length, 1);
    assert.equal(after[0].label, 'late');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test('store: 文件缺失 → 空数组（冷启动·不抛）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ddl-calib-empty-'));
  try {
    assert.deepEqual(loadDeadlineSnapshots(dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── ⑥ backtest 度量数学（合成数据·验脚手架能跑）───────────────────────────────────────────────────
test('backtestDeadlineBands: confusion 求和 = 分类样本 + 度量在 [0,1]', () => {
  const snaps = makeSyntheticSnapshots({ n: 200, seed: 7 });
  const bt = backtestDeadlineBands(snaps);
  const { tp, fp, tn, fn } = bt.metrics.confusion;
  assert.equal(tp + fp + tn + fn, bt.metrics.n_labeled - bt.metrics.n_band_unknown);
  for (const k of ['precision', 'recall', 'f1', 'accuracy', 'specificity']) {
    const v = bt.metrics[k];
    if (v != null) assert.ok(v >= 0 && v <= 1, `${k} in [0,1]: ${v}`);
  }
  assert.ok(bt.metrics.brier != null && bt.metrics.brier >= 0 && bt.metrics.brier <= 1);
  // reliability bins 覆盖 [0,1] 且 n 求和 = 有 prob 的 labeled 数。
  assert.equal(bt.metrics.reliability.length, 5);
  // by_band late_rate 存在且单调性可读（合成真相 prob↑→on_time·非硬断言，只验字段成形）。
  assert.ok(bt.metrics.by_band.length >= 1);
  for (const row of bt.metrics.by_band) {
    assert.ok(row.late_rate == null || (row.late_rate >= 0 && row.late_rate <= 1));
  }
});

test('backtestDeadlineBands: 合成真相下 predicted late 率随 band 恶化上升（脚手架有判别力）', () => {
  // 低 noise → 合成信号清晰·on_track 的实际 late 率应低于 likely_late。
  const snaps = makeSyntheticSnapshots({ n: 400, seed: 3, noise: 0.05 });
  const bt = backtestDeadlineBands(snaps);
  const rate = new Map(bt.metrics.by_band.map((r) => [r.band, r.late_rate]));
  const onTrack = rate.get('on_track');
  const likelyLate = rate.get('likely_late');
  if (onTrack != null && likelyLate != null) {
    assert.ok(
      onTrack < likelyLate,
      `on_track late_rate(${onTrack}) < likely_late late_rate(${likelyLate})`,
    );
  }
});

// ── ⑦ 诚实闸（命门）：合成/不足数据一律 framework-validation-only ──────────────────────────────────
test('诚实闸: 全 synthetic → usable_for_calibration=false + framework-validation-only', () => {
  const snaps = makeSyntheticSnapshots({ n: 200, seed: 1 }); // provenance 全 synthetic
  const bt = backtestDeadlineBands(snaps);
  assert.equal(bt.data_provenance, 'synthetic');
  assert.equal(bt.usable_for_calibration, false); // ★绝不拿合成数据校准
  assert.equal(bt.calibration_status, 'framework-validation-only');
  assert.ok(bt.notes.some((n) => n.includes('synthetic')));
  assert.ok(bt.notes.some((n) => n.includes('uncalibrated-conservative')));
});

test('诚实闸: 空语料 → provenance=empty + 不可校准', () => {
  const bt = backtestDeadlineBands([]);
  assert.equal(bt.data_provenance, 'empty');
  assert.equal(bt.usable_for_calibration, false);
  assert.equal(bt.metrics.n_total, 0);
});

test('诚实闸: observed 但样本不足 MIN_OBSERVED → 不可校准', () => {
  // 造 5 条 observed labeled（< MIN_OBSERVED_FOR_CALIBRATION）。
  const snaps = makeSyntheticSnapshots({ n: 5, seed: 2 }).map((s, i) => ({
    ...s,
    provenance: 'observed',
    label: i % 2 === 0 ? 'late' : 'on_time',
  }));
  const bt = backtestDeadlineBands(snaps);
  assert.equal(bt.data_provenance, 'observed');
  assert.ok(bt.n_observed_labeled < MIN_OBSERVED_FOR_CALIBRATION);
  assert.equal(bt.usable_for_calibration, false);
});

test('诚实闸 CAN open: 足量 observed labeled + 两类齐 → candidate-calibrated（证明闸非恒假）', () => {
  // 构造 40 条 observed labeled·两类都有——验闸逻辑本身能开（生产无此数据·这是机制自证）。
  const base = makeSyntheticSnapshots({ n: 40, seed: 9, noise: 0.05 });
  const snaps = base.map((s, i) => ({
    ...s,
    provenance: 'observed',
    label: i < 20 ? 'late' : 'on_time', // 强制两类各 20
  }));
  const bt = backtestDeadlineBands(snaps);
  assert.equal(bt.data_provenance, 'observed');
  assert.ok(bt.n_observed_labeled >= MIN_OBSERVED_FOR_CALIBRATION);
  assert.equal(bt.usable_for_calibration, true);
  assert.equal(bt.calibration_status, 'candidate-calibrated');
  assert.ok(bt.notes.some((n) => n.includes('holdout') || n.includes('人审')));
});

// ── ⑧ sweep 阈值网格搜索（脚手架能搜·仍受诚实闸约束）─────────────────────────────────────────────
test('sweepDeadlineBands: 跑完网格出 best·合成数据下仍 usable=false', () => {
  const snaps = makeSyntheticSnapshots({ n: 300, seed: 5 });
  const sweep = sweepDeadlineBands(snaps);
  assert.ok(sweep.candidates.length > 1);
  assert.ok(sweep.best != null);
  // 候选按 objective 降序。
  for (let i = 1; i < sweep.candidates.length; i++) {
    assert.ok(sweep.candidates[i - 1].objective >= sweep.candidates[i].objective);
  }
  // best.bands 有序 on_track > watch > at_risk。
  assert.ok(sweep.best.bands.on_track > sweep.best.bands.watch);
  assert.ok(sweep.best.bands.watch > sweep.best.bands.at_risk);
  // ★诚实闸：合成数据 → 绝不当校准阈值。
  assert.equal(sweep.usable_for_calibration, false);
  assert.equal(sweep.calibration_status, 'framework-validation-only');
  assert.ok(sweep.notes.some((n) => n.includes('绝不') || n.includes('uncalibrated')));
});

test('defaultThresholdGrid: 全部候选保持 on_track > watch > at_risk 有序', () => {
  for (const b of defaultThresholdGrid()) {
    assert.ok(b.on_track > b.watch && b.watch > b.at_risk);
  }
});

// ── ⑨ 合成数据生成器确定性 + provenance ───────────────────────────────────────────────────────────
test('makeSyntheticSnapshots: 确定性（同 seed 同数据）+ provenance 恒 synthetic', () => {
  const a = makeSyntheticSnapshots({ n: 50, seed: 11 });
  const b = makeSyntheticSnapshots({ n: 50, seed: 11 });
  assert.deepEqual(a, b); // seeded 可复现
  assert.ok(a.every((s) => s.provenance === 'synthetic'));
  assert.equal(assessProvenance(a), 'synthetic');
});

test('bandsSignature: 阈值变 → 签名变（可追溯采集时用的阈值）', () => {
  const s1 = bandsSignature({ on_track: 0.9, watch: 0.65, at_risk: 0.4 });
  const s2 = bandsSignature({ on_track: 0.85, watch: 0.65, at_risk: 0.4 });
  assert.notEqual(s1, s2);
});
