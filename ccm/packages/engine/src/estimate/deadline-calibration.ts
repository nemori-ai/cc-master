// deadline-calibration.ts — 交付 DDL 风险经验校准的**框架**（issue #168 follow-up·labeled snapshot + backtest）。
//
// ★为什么只是「框架」（诚实边界·血泪·别越界）：
//   deadline-risk 的 band 阈值（DEFAULT_BANDS）是 **explicitly uncalibrated 的保守起点**——真正的经验校准
//   需要「labeled snapshot 语料（某时刻的进度特征 + 该板最终是否 late）+ backtest」，而 **labeled 数据要靠
//   长期积累，不是一次性代码改动能造出来**。故本文件只搭三件事，绝不假装已完成校准：
//     ① 采集机制：把一次 deadline-risk verdict 的特征连同「预测的 band」落成结构化 snapshot（label 待定），
//        后续该板走到终态再把「实际 late/on_time」回填成 label。
//     ② backtest 脚手架：给定一组 labeled snapshot，回测 band 阈值的判别力（confusion / precision / recall /
//        Brier / 逐 band 实际 late 率 / reliability bins）+ 阈值网格搜索（未来出校准阈值的入口）。
//     ③ 诚实闸：**合成 / 数据不足的 snapshot 只能验「脚手架本身能跑」，绝不能拿去动阈值**——`usable_for_calibration`
//        仅在有足量 `observed`（真实编排采到的）labeled 数据且两类都在时才为 true；否则一律
//        `framework-validation-only`，band 保持 `uncalibrated-conservative`。
//
//   一句话：本框架能跑，但**在真实 labeled 数据积累到位之前，band 仍是 uncalibrated；校准待数据**。
//
// 红线1 / ADR-006：node/JS only，零 npm dep，纯 stdlib（fs + 内建 + 引擎自带 Sfc32）。
// 红线2：只读 board（deriveTerminalOutcome 只取派生特征）；snapshot store 是 home 级独立文件，**不碰 board**。
// 确定性：backtest / sweep 纯算术无随机；合成数据生成器用 seeded Sfc32（同 seed → 同数据集·可复现）。

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { TaskLike } from '../board-model.js';
import { readDeadline } from '../board-model.js';
import type { DeadlineRiskBand, DeadlineRiskResult } from './deadline-risk.js';
import { Sfc32 } from './prng.js';

// ── snapshot 数据模型 ────────────────────────────────────────────────────────────────────────────

export const SNAPSHOT_SCHEMA = 'ccm.deadline-snapshot.v1' as const;

// label：某板对其 DDL 的最终交付结果（回填在板走到终态之后）。
//   'unknown' = 尚不可判（无 DDL / 板仍在飞·未到 DDL 也未交付）——backtest 一律剔除，绝不当成任一类。
export type DeadlineLabel = 'on_time' | 'late' | 'unknown';

// 一条 snapshot 的证据来源（诚实轴·校准闸的命门）：
//   'observed'  = 真实编排过程中采集（可信语料·可参与校准）；
//   'synthetic' = 生成/构造的（只验脚手架·**绝不**参与校准）。
export type SnapshotProvenance = 'observed' | 'synthetic';

// 一条 labeled snapshot：捕获时的「特征 + 预测的 band」+ 后回填的「实际 label」。
//   特征侧字段直接取自 DeadlineRiskResult（预测发生的那一刻的完整上下文·供未来校准复盘为什么预测偏了）。
export interface DeadlineSnapshot {
  schema: typeof SNAPSHOT_SCHEMA;
  snapshot_id: string; // 确定性 id：`${board_id}@${captured_at_ms}`（同板同刻幂等·去重锚）
  board_id: string; // 板标识（board 文件名或 goal 派生·溯源）
  scope: string;
  provenance: SnapshotProvenance;
  captured_at_ms: number;

  // ── 特征侧（预测那一刻·取自 DeadlineRiskResult）──
  deadline_at_ms: number | null;
  deadline_state: string;
  time_remaining_hours: number | null;
  on_time_probability: number | null; // RCPSP-in-trial verdict 概率（唯一 verdict 源·可能 null）
  predicted_band: DeadlineRiskBand; // ★预测：本框架要校准的就是它准不准
  strength: 'weak' | 'strong';
  channel_disagreement: number | null;
  backlog: number;
  wip: number | null;
  coverage_pct: number;
  confidence: 'high' | 'medium' | 'low';
  history_n: number;
  // band 阈值的可追溯签名 + 捕获时 band 的校准状态（诚实链·校准前恒 'uncalibrated-conservative'）。
  bands_signature: string;
  calibration_status_at_capture: string;

  // ── 结果侧（终态回填）──
  label: DeadlineLabel;
  resolved_at_ms: number | null;
  actual_finish_ms: number | null; // 板实际全部交付的时戳（未交付 → null）
  resolution_basis: string; // label 怎么判出来的（审计）
}

// snapshotId(boardId, capturedAtMs) → 确定性 snapshot id（同板同刻幂等·去重锚）。
export function snapshotId(boardId: string, capturedAtMs: number): string {
  return `${boardId}@${capturedAtMs}`;
}

// bandsSignature(bands) → band 阈值的紧凑签名（可追溯「这条 snapshot 的 band 是哪套阈值判的」）。
//   校准前后阈值不同→签名不同→backtest 能区分「用旧阈值采的 snapshot」，避免混采污染。
export function bandsSignature(bands: {
  on_track: number;
  watch: number;
  at_risk: number;
}): string {
  return `on_track=${bands.on_track};watch=${bands.watch};at_risk=${bands.at_risk}`;
}

// buildDeadlineSnapshot(risk, meta) → 从一次 deadline-risk verdict 造一条 **未 label** 的 snapshot（纯函数）。
//   这是采集机制的核心：`ccm estimate deadline-risk` 算出 DeadlineRiskResult 后，把它连同预测的 band 定格。
//   label 恒 'unknown'（终态未知）——后续经 reconcileSnapshotLabels 回填。provenance 默认 'observed'
//   （真实编排采集）；合成/构造场景显式传 'synthetic'。
export function buildDeadlineSnapshot(
  risk: DeadlineRiskResult,
  meta: {
    boardId: string;
    capturedAtMs: number;
    scope?: string;
    provenance?: SnapshotProvenance;
    bandsSig?: string;
  },
): DeadlineSnapshot {
  const boardId = meta.boardId || 'unknown';
  const capturedAtMs = meta.capturedAtMs;
  return {
    schema: SNAPSHOT_SCHEMA,
    snapshot_id: snapshotId(boardId, capturedAtMs),
    board_id: boardId,
    scope: meta.scope ?? risk.scope,
    provenance: meta.provenance ?? 'observed',
    captured_at_ms: capturedAtMs,
    deadline_at_ms: risk.deadline != null ? Date.parse(risk.deadline) : null,
    deadline_state: risk.deadline_state,
    time_remaining_hours: risk.time_remaining_hours,
    on_time_probability: risk.on_time_probability,
    predicted_band: risk.risk_band,
    strength: risk.strength,
    channel_disagreement: risk.channel_disagreement,
    backlog: extractBacklog(risk),
    wip: risk.channels.resource_aware?.wip ?? null,
    coverage_pct: risk.coverage_pct,
    confidence: risk.confidence,
    history_n: risk.history_n,
    bands_signature: meta.bandsSig ?? 'uncalibrated-conservative-default',
    calibration_status_at_capture: risk.calibration_status,
    label: 'unknown',
    resolved_at_ms: null,
    actual_finish_ms: null,
    resolution_basis: 'pending',
  };
}

// extractBacklog(risk) — DeadlineRiskResult 未直接携带 backlog，用 throughput 参考块无则退 -1（未知·诚实）。
//   backlog 是采集期望字段（供未来 feature），当前从可得字段尽力还原；采集器可覆写（见 CLI 埋点建议）。
function extractBacklog(_risk: DeadlineRiskResult): number {
  return -1; // 未直接可得——采集埋点侧应显式补（buildDeadlineSnapshot 后覆写 .backlog）；-1 = 未采到
}

// ── label 判定（终态回填）─────────────────────────────────────────────────────────────────────────

// 一块板走到「可判 label」时的终态摘要（label 判定的唯一输入·纯数据·可注入）。
//   刻意与「overdue / trulyDone 谓词」解耦：这些 canonical 谓词归 deadline schema 侧，本框架**不重实现**，
//   只接一个已算好的 outcome（deriveTerminalOutcome 给一个明确文档化的默认近似·调用方可换真谓词）。
export interface TerminalBoardOutcome {
  board_id: string;
  deadline_at_ms: number | null;
  delivered: boolean; // 板是否已完整交付（全部真实任务达成）
  actual_finish_ms: number | null; // 完整交付的时戳（未交付 → null）
  observed_at_ms: number; // 观察到该终态的时戳（如归档时刻）——未交付时判 late 的时间锚
}

// resolveLabel(outcome) → 该板对其 DDL 的最终 label（纯函数·真值表）。
//   · 无 DDL → unknown（无可校准的目标）。
//   · 已交付 且 交付时戳 ≤ DDL → on_time。
//   · 已交付 但 交付时戳 > DDL → late（交付晚于 DDL）。
//   · 未交付 且 观察时刻 ≥ DDL → late（DDL 已过仍未交付）。
//   · 未交付 且 观察时刻 < DDL → unknown（仍在飞·未到终态·还不能 label）。
export function resolveLabel(outcome: TerminalBoardOutcome): {
  label: DeadlineLabel;
  actual_finish_ms: number | null;
  basis: string;
} {
  const { deadline_at_ms, delivered, actual_finish_ms, observed_at_ms } = outcome;
  if (deadline_at_ms == null || !Number.isFinite(deadline_at_ms)) {
    return { label: 'unknown', actual_finish_ms: null, basis: 'no-deadline' };
  }
  if (delivered) {
    if (actual_finish_ms != null && Number.isFinite(actual_finish_ms)) {
      const onTime = actual_finish_ms <= deadline_at_ms;
      return {
        label: onTime ? 'on_time' : 'late',
        actual_finish_ms,
        basis: onTime ? 'delivered-before-deadline' : 'delivered-after-deadline',
      };
    }
    // 已交付但无交付时戳 → 无法判先后 → unknown（诚实·不猜）。
    return { label: 'unknown', actual_finish_ms: null, basis: 'delivered-no-finish-timestamp' };
  }
  // 未交付。
  if (observed_at_ms >= deadline_at_ms) {
    return { label: 'late', actual_finish_ms: null, basis: 'deadline-passed-undelivered' };
  }
  return { label: 'unknown', actual_finish_ms: null, basis: 'in-flight-not-terminal' };
}

// deriveTerminalOutcome(board, observedAtMs) → 从 board 对象算一个**默认近似** TerminalBoardOutcome（纯函数）。
//   ★局限（文档化·诚实）：完整交付判据用 `status==='done'`（全部非 cancelled 任务 done = delivered），
//   交付时戳取全部 done 任务 finished_at 的最大值。这是**近似**——canonical 的 delivered/overdue/trulyDone
//   谓词归 deadline schema 侧（含 verified/artifact 语义·ADR-026），本框架不重实现；需要严格判据时调用方
//   自行构造 TerminalBoardOutcome 注入 resolveLabel（本 deriver 只作冷启动便利默认）。
export function deriveTerminalOutcome(board: unknown, observedAtMs: number): TerminalBoardOutcome {
  const dl = readDeadline(board);
  const b = board as { tasks?: unknown; goal?: unknown } | null;
  const tasks: TaskLike[] =
    b && typeof b === 'object' && Array.isArray(b.tasks) ? (b.tasks as TaskLike[]) : [];
  const boardId = typeof b?.goal === 'string' ? b.goal.slice(0, 24) : 'unknown';

  let considered = 0;
  let done = 0;
  let maxFinish: number | null = null;
  for (const t of tasks) {
    if (!t || typeof t !== 'object') continue;
    const status = typeof t.status === 'string' ? t.status : '';
    if (status === 'cancelled') continue; // 取消的任务不计入交付判据
    considered += 1;
    if (status === 'done') {
      done += 1;
      const fin = parseTsMs(t.finished_at);
      if (fin != null && (maxFinish == null || fin > maxFinish)) maxFinish = fin;
    }
  }
  const delivered = considered > 0 && done === considered;
  return {
    board_id: boardId,
    deadline_at_ms: dl.at_ms,
    delivered,
    actual_finish_ms: delivered ? maxFinish : null,
    observed_at_ms: observedAtMs,
  };
}

function parseTsMs(v: unknown): number | null {
  if (typeof v !== 'string') return null;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? ms : null;
}

// reconcileSnapshotLabels(snaps, outcomes) → 用一批终态 outcome 回填 snapshot 的 label（纯函数）。
//   outcomes 按 board_id 索引；每条仍 'unknown' 的 snapshot，若其板已有终态 outcome 则重判 label。
//   已 label（非 unknown）的 snapshot 不动（label 是单调终态·不回退）。返回**新数组**（不原地改）。
export function reconcileSnapshotLabels(
  snaps: DeadlineSnapshot[],
  outcomes: TerminalBoardOutcome[],
  resolvedAtMs: number,
): DeadlineSnapshot[] {
  const byBoard = new Map<string, TerminalBoardOutcome>();
  for (const o of outcomes) byBoard.set(o.board_id, o);
  return snaps.map((s) => {
    if (s.label !== 'unknown') return s; // 终态已定·不回退
    const outcome = byBoard.get(s.board_id);
    if (!outcome) return s;
    const r = resolveLabel(outcome);
    if (r.label === 'unknown') return s; // 板仍未到可判态
    return {
      ...s,
      label: r.label,
      resolved_at_ms: resolvedAtMs,
      actual_finish_ms: r.actual_finish_ms,
      resolution_basis: r.basis,
    };
  });
}

// ── snapshot store（home 级 JSONL·唯一碰 fs 的一段·采集机制的落盘侧）───────────────────────────────
//   与 history-loader 同纪律：读/写 fs 与算法分离；坏行跳过绝不抛；store 是独立文件不碰 board。

export const SNAPSHOT_STORE_SUBDIR = 'calibration';
export const SNAPSHOT_STORE_FILE = 'deadline-snapshots.jsonl';

// snapshotStorePath(homeDir) → `<home>/calibration/deadline-snapshots.jsonl`。
export function snapshotStorePath(homeDir: string): string {
  return path.join(homeDir, SNAPSHOT_STORE_SUBDIR, SNAPSHOT_STORE_FILE);
}

// appendDeadlineSnapshot(homeDir, snap) → 追加一条 snapshot（JSONL 一行·采集）。必要时建目录。best-effort。
export function appendDeadlineSnapshot(homeDir: string, snap: DeadlineSnapshot): void {
  const file = snapshotStorePath(homeDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(snap)}\n`, 'utf8');
}

// loadDeadlineSnapshots(homeDir) → 读全部 snapshot（坏行/坏 schema 跳过·绝不抛·文件缺 → 空）。
export function loadDeadlineSnapshots(homeDir: string): DeadlineSnapshot[] {
  const file = snapshotStorePath(homeDir);
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return []; // 文件不存在 → 冷启动·空语料
  }
  const out: DeadlineSnapshot[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let obj: unknown;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      continue; // 坏行跳过
    }
    if (isSnapshot(obj)) out.push(obj);
  }
  return out;
}

// writeDeadlineSnapshots(homeDir, snaps) → 整文件重写（label 回填后落盘·两阶段采集的第二阶段）。
export function writeDeadlineSnapshots(homeDir: string, snaps: DeadlineSnapshot[]): void {
  const file = snapshotStorePath(homeDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const body = snaps.map((s) => JSON.stringify(s)).join('\n');
  fs.writeFileSync(file, snaps.length ? `${body}\n` : '', 'utf8');
}

// isSnapshot(o) → 最小结构守卫（schema tag + 关键字段类型对）。宽松：只挡明显坏行，字段缺省交由消费方降级。
function isSnapshot(o: unknown): o is DeadlineSnapshot {
  if (!o || typeof o !== 'object') return false;
  const s = o as Record<string, unknown>;
  return (
    s.schema === SNAPSHOT_SCHEMA &&
    typeof s.snapshot_id === 'string' &&
    typeof s.predicted_band === 'string' &&
    (s.label === 'on_time' || s.label === 'late' || s.label === 'unknown') &&
    (s.provenance === 'observed' || s.provenance === 'synthetic')
  );
}

// ── backtest 脚手架（纯函数·给定 labeled 语料回测 band 阈值判别力）──────────────────────────────────

export const BACKTEST_SCHEMA = 'ccm.deadline-backtest.v1' as const;

// 校准可用的最低 observed labeled 样本数（诚实闸·mirror deadline-risk 的 min_coverage=30）。
//   低于此 → 无论数字多好看都判 framework-validation-only（样本不足的「校准」是自欺）。
export const MIN_OBSERVED_FOR_CALIBRATION = 30;

// 哪些预测 band 记为「预测会 late」（二分类的正类）。默认 = at_risk 及更差。
export const DEFAULT_LATE_BANDS: readonly DeadlineRiskBand[] = [
  'at_risk',
  'likely_late',
  'overdue',
];

// 回测用的阈值三元组（作用在 on_time_probability 上·与 deadline-risk DEFAULT_BANDS 同轴·用于 sweep 搜索）。
export interface BacktestBands {
  on_track: number;
  watch: number;
  at_risk: number;
}

export interface ReliabilityBin {
  bin_lo: number;
  bin_hi: number;
  n: number;
  predicted_on_time_mean: number | null; // 该桶预测 on_time_probability 均值
  empirical_on_time_rate: number | null; // 该桶实际 on_time 比例（校准好则二者接近）
}

export interface BacktestMetrics {
  n_total: number;
  n_labeled: number; // label ∈ {on_time, late}
  n_unknown: number; // 剔除（无 DDL / 在飞）
  n_band_unknown: number; // predicted_band==='unknown'·无预测·不入二分类
  // 二分类（预测 late vs 实际 late）：
  confusion: { tp: number; fp: number; tn: number; fn: number };
  precision: number | null; // 预测 late 中真 late 占比
  recall: number | null; // 真 late 中被预测出的占比
  f1: number | null;
  accuracy: number | null;
  specificity: number | null; // 真 on_time 中被预测 on_time 的占比
  // 概率打分（用 on_time_probability·仅 label≠unknown 且 prob 有）：
  brier: number | null; // mean (p_late − actual_late)^2·越低越准
  n_scored: number;
  // reliability bins（预测概率分桶 vs 实际 on_time 率）：
  reliability: ReliabilityBin[];
  // 逐预测 band 的实际 late 率（★核心校准诊断：校准好则 on_track→overdue late 率单调升）：
  by_band: Array<{ band: DeadlineRiskBand; n: number; late: number; late_rate: number | null }>;
}

export interface BacktestResult {
  schema: typeof BACKTEST_SCHEMA;
  metrics: BacktestMetrics;
  bands: BacktestBands | null; // 若 opts 传了阈值（sweep 用）；纯 by-band 回测则 null
  data_provenance: 'observed' | 'synthetic' | 'mixed' | 'empty';
  n_observed_labeled: number;
  // ★诚实闸：只有足量 observed labeled + 两类都在时才 true。
  usable_for_calibration: boolean;
  calibration_status: 'framework-validation-only' | 'candidate-calibrated';
  notes: string[];
}

export interface BacktestOptions {
  bands?: BacktestBands; // 传了则按此阈值从 on_time_probability 重判 band（sweep 用）；否则用 snapshot 里已存的 predicted_band
  lateBands?: readonly DeadlineRiskBand[]; // 哪些 band 记为正类（默认 DEFAULT_LATE_BANDS）
  reliabilityBins?: number; // reliability 桶数（默认 5）
}

// classifyByBands(prob, bands) → 从 on_time_probability 按阈值重判 band（sweep 场景·纯上界口径）。
//   不复算 disagreement/confidence 降级（那是 deadline-risk 的 verdict 逻辑）——sweep 只搜概率阈值的判别力。
function classifyByBands(prob: number | null, bands: BacktestBands): DeadlineRiskBand {
  if (prob == null || !Number.isFinite(prob)) return 'unknown';
  if (prob >= bands.on_track) return 'on_track';
  if (prob >= bands.watch) return 'watch';
  if (prob >= bands.at_risk) return 'at_risk';
  return 'likely_late';
}

// backtestDeadlineBands(snaps, opts) → 回测 band 阈值判别力（纯函数·脚手架核心）。
//   ★这就是 issue #168 的 backtest：给定 labeled snapshot，量「预测 band」对「实际 late」的判别力。
//   合成/不足数据只验脚手架能跑（usable_for_calibration=false·framework-validation-only）；真校准待 observed 语料。
export function backtestDeadlineBands(
  snaps: DeadlineSnapshot[],
  opts: BacktestOptions = {},
): BacktestResult {
  const lateBands = new Set(opts.lateBands ?? DEFAULT_LATE_BANDS);
  const binCount = opts.reliabilityBins ?? 5;
  const notes: string[] = [];

  // 每条 snapshot 的「预测 band」：opts.bands 传了则从概率重判（sweep），否则用采集时存的 predicted_band。
  const predictedBandOf = (s: DeadlineSnapshot): DeadlineRiskBand =>
    opts.bands ? classifyByBands(s.on_time_probability, opts.bands) : s.predicted_band;

  const nTotal = snaps.length;
  const labeled = snaps.filter((s) => s.label === 'on_time' || s.label === 'late');
  const nUnknown = nTotal - labeled.length;

  // 二分类：仅 predicted_band ≠ unknown 的 labeled snapshot（unknown band = 无预测·不入分类）。
  let tp = 0;
  let fp = 0;
  let tn = 0;
  let fn = 0;
  let nBandUnknown = 0;
  const bandAgg = new Map<DeadlineRiskBand, { n: number; late: number }>();
  for (const s of labeled) {
    const band = predictedBandOf(s);
    const bucket = bandAgg.get(band) ?? { n: 0, late: 0 };
    bucket.n += 1;
    if (s.label === 'late') bucket.late += 1;
    bandAgg.set(band, bucket);
    if (band === 'unknown') {
      nBandUnknown += 1;
      continue;
    }
    const predLate = lateBands.has(band);
    const actualLate = s.label === 'late';
    if (predLate && actualLate) tp += 1;
    else if (predLate && !actualLate) fp += 1;
    else if (!predLate && !actualLate) tn += 1;
    else fn += 1;
  }

  const precision = tp + fp > 0 ? tp / (tp + fp) : null;
  const recall = tp + fn > 0 ? tp / (tp + fn) : null;
  const specificity = tn + fp > 0 ? tn / (tn + fp) : null;
  const f1 =
    precision != null && recall != null && precision + recall > 0
      ? (2 * precision * recall) / (precision + recall)
      : null;
  const classified = tp + fp + tn + fn;
  const accuracy = classified > 0 ? (tp + tn) / classified : null;

  // Brier（p_late = 1 − on_time_probability·仅 prob 有的 labeled）。
  let brierSum = 0;
  let nScored = 0;
  for (const s of labeled) {
    if (s.on_time_probability == null || !Number.isFinite(s.on_time_probability)) continue;
    const pLate = 1 - s.on_time_probability;
    const actualLate = s.label === 'late' ? 1 : 0;
    brierSum += (pLate - actualLate) * (pLate - actualLate);
    nScored += 1;
  }
  const brier = nScored > 0 ? round4(brierSum / nScored) : null;

  const reliability = buildReliabilityBins(labeled, binCount);
  const by_band = buildByBand(bandAgg);

  const metrics: BacktestMetrics = {
    n_total: nTotal,
    n_labeled: labeled.length,
    n_unknown: nUnknown,
    n_band_unknown: nBandUnknown,
    confusion: { tp, fp, tn, fn },
    precision: round4(precision),
    recall: round4(recall),
    f1: round4(f1),
    accuracy: round4(accuracy),
    specificity: round4(specificity),
    brier,
    n_scored: nScored,
    reliability,
    by_band,
  };

  // ── 诚实闸 ──
  const observedLabeled = labeled.filter((s) => s.provenance === 'observed');
  const nObservedLabeled = observedLabeled.length;
  const hasBothClasses =
    observedLabeled.some((s) => s.label === 'late') &&
    observedLabeled.some((s) => s.label === 'on_time');
  const provenance = assessProvenance(snaps);
  const usable = nObservedLabeled >= MIN_OBSERVED_FOR_CALIBRATION && hasBothClasses;

  if (nTotal === 0) {
    notes.push('空语料——脚手架空跑（无 snapshot·无从校准）。');
  }
  if (!usable) {
    if (provenance === 'synthetic') {
      notes.push(
        '数据全为 synthetic——本回测**只验脚手架本身能跑**，绝不能拿去动 band 阈值；band 仍 uncalibrated-conservative。',
      );
    } else if (nObservedLabeled < MIN_OBSERVED_FOR_CALIBRATION) {
      notes.push(
        `observed labeled 样本 ${nObservedLabeled} < ${MIN_OBSERVED_FOR_CALIBRATION}——数据不足·不足以校准（校准待数据积累）。`,
      );
    } else if (!hasBothClasses) {
      notes.push(
        'observed labeled 只有单类（全 late 或全 on_time）——无法校准判别阈值（需两类都有）。',
      );
    }
    notes.push(
      '结论：band 保持 uncalibrated-conservative；真实经验校准待 observed labeled 语料到位。',
    );
  } else {
    notes.push(
      `observed labeled 样本 ${nObservedLabeled}（两类齐）——脚手架可产候选阈值；仍须人审 + holdout 验证再固化（勿直接生产）。`,
    );
  }

  return {
    schema: BACKTEST_SCHEMA,
    metrics,
    bands: opts.bands ?? null,
    data_provenance: provenance,
    n_observed_labeled: nObservedLabeled,
    usable_for_calibration: usable,
    calibration_status: usable ? 'candidate-calibrated' : 'framework-validation-only',
    notes,
  };
}

function buildReliabilityBins(labeled: DeadlineSnapshot[], binCount: number): ReliabilityBin[] {
  const n = binCount > 0 ? binCount : 5;
  const bins: ReliabilityBin[] = [];
  for (let i = 0; i < n; i++) {
    const lo = i / n;
    const hi = (i + 1) / n;
    let count = 0;
    let probSum = 0;
    let onTime = 0;
    for (const s of labeled) {
      const p = s.on_time_probability;
      if (p == null || !Number.isFinite(p)) continue;
      // 末桶闭右含 1.0；其余左闭右开。
      const inBin = i === n - 1 ? p >= lo && p <= hi : p >= lo && p < hi;
      if (!inBin) continue;
      count += 1;
      probSum += p;
      if (s.label === 'on_time') onTime += 1;
    }
    bins.push({
      bin_lo: round4(lo) as number,
      bin_hi: round4(hi) as number,
      n: count,
      predicted_on_time_mean: count > 0 ? round4(probSum / count) : null,
      empirical_on_time_rate: count > 0 ? round4(onTime / count) : null,
    });
  }
  return bins;
}

function buildByBand(
  bandAgg: Map<DeadlineRiskBand, { n: number; late: number }>,
): BacktestMetrics['by_band'] {
  const order: DeadlineRiskBand[] = [
    'on_track',
    'watch',
    'at_risk',
    'likely_late',
    'overdue',
    'unknown',
  ];
  const out: BacktestMetrics['by_band'] = [];
  for (const band of order) {
    const agg = bandAgg.get(band);
    if (!agg || agg.n === 0) continue;
    out.push({
      band,
      n: agg.n,
      late: agg.late,
      late_rate: round4(agg.late / agg.n),
    });
  }
  return out;
}

// assessProvenance(snaps) → 语料的证据来源画像（empty / observed / synthetic / mixed）。
export function assessProvenance(
  snaps: DeadlineSnapshot[],
): 'observed' | 'synthetic' | 'mixed' | 'empty' {
  if (snaps.length === 0) return 'empty';
  let obs = 0;
  let syn = 0;
  for (const s of snaps) {
    if (s.provenance === 'observed') obs += 1;
    else syn += 1;
  }
  if (obs > 0 && syn > 0) return 'mixed';
  return obs > 0 ? 'observed' : 'synthetic';
}

// ── 阈值网格搜索（未来出校准阈值的入口·同样受诚实闸约束）──────────────────────────────────────────

export const SWEEP_SCHEMA = 'ccm.deadline-sweep.v1' as const;

export interface SweepCandidate {
  bands: BacktestBands;
  f1: number | null;
  youden_j: number | null; // recall + specificity − 1（阈值搜索常用目标·抗类别不平衡）
  precision: number | null;
  recall: number | null;
  accuracy: number | null;
  objective: number; // 排序用目标值（默认 Youden's J·null 视作 −Infinity）
}

export interface SweepResult {
  schema: typeof SWEEP_SCHEMA;
  candidates: SweepCandidate[];
  best: SweepCandidate | null;
  objective_name: 'youden_j' | 'f1';
  data_provenance: 'observed' | 'synthetic' | 'mixed' | 'empty';
  n_observed_labeled: number;
  usable_for_calibration: boolean;
  calibration_status: 'framework-validation-only' | 'candidate-calibrated';
  notes: string[];
}

export interface SweepOptions {
  grid?: BacktestBands[]; // 候选阈值集（缺省用 defaultThresholdGrid）
  objective?: 'youden_j' | 'f1';
  lateBands?: readonly DeadlineRiskBand[];
}

// defaultThresholdGrid() → 一组默认候选阈值（保持 on_track > watch > at_risk 有序·纯演示网格）。
export function defaultThresholdGrid(): BacktestBands[] {
  const grid: BacktestBands[] = [];
  const onTrackVals = [0.8, 0.85, 0.9, 0.95];
  const watchVals = [0.5, 0.6, 0.65, 0.7];
  const atRiskVals = [0.3, 0.4, 0.5];
  for (const on_track of onTrackVals) {
    for (const watch of watchVals) {
      for (const at_risk of atRiskVals) {
        if (on_track > watch && watch > at_risk) grid.push({ on_track, watch, at_risk });
      }
    }
  }
  return grid;
}

// sweepDeadlineBands(snaps, opts) → 在阈值网格上回测取最优候选（纯函数·未来校准的搜索脚手架）。
//   ★诚实闸同 backtest：合成/不足数据下 best 只是「脚手架能搜」的演示，`usable_for_calibration=false`，
//   绝不能把 best.bands 当已校准阈值上生产。
export function sweepDeadlineBands(
  snaps: DeadlineSnapshot[],
  opts: SweepOptions = {},
): SweepResult {
  const grid = opts.grid ?? defaultThresholdGrid();
  const objectiveName = opts.objective ?? 'youden_j';
  const candidates: SweepCandidate[] = [];
  for (const bands of grid) {
    const bt = backtestDeadlineBands(snaps, { bands, lateBands: opts.lateBands });
    const m = bt.metrics;
    const youdenJ =
      m.recall != null && m.specificity != null ? round4(m.recall + m.specificity - 1) : null;
    const objRaw = objectiveName === 'f1' ? m.f1 : youdenJ;
    candidates.push({
      bands,
      f1: m.f1,
      youden_j: youdenJ,
      precision: m.precision,
      recall: m.recall,
      accuracy: m.accuracy,
      objective: objRaw ?? Number.NEGATIVE_INFINITY,
    });
  }
  candidates.sort((a, b) => b.objective - a.objective);
  const best =
    candidates.length && candidates[0] && Number.isFinite(candidates[0].objective)
      ? candidates[0]
      : null;

  // 诚实闸（复用 backtest 的判定·对整语料一次）。
  const gate = backtestDeadlineBands(snaps, { lateBands: opts.lateBands });
  const notes: string[] = [];
  if (!gate.usable_for_calibration) {
    notes.push(
      '阈值搜索已跑，但语料不足以校准（synthetic / observed 不够 / 单类）——best 仅证明「脚手架能搜」，' +
        '**绝不**作为已校准阈值上生产；band 仍 uncalibrated-conservative。校准待 observed labeled 语料。',
    );
  } else {
    notes.push(
      'observed labeled 足量·脚手架产出候选阈值——仍须 holdout / predict-then-validate 防过拟合 + 人审再固化。',
    );
  }

  return {
    schema: SWEEP_SCHEMA,
    candidates,
    best,
    objective_name: objectiveName,
    data_provenance: gate.data_provenance,
    n_observed_labeled: gate.n_observed_labeled,
    usable_for_calibration: gate.usable_for_calibration,
    calibration_status: gate.calibration_status,
    notes,
  };
}

// ── 合成数据生成器（**只**验脚手架·provenance 恒 synthetic·永不参与校准）─────────────────────────────

export interface SyntheticOptions {
  n?: number; // snapshot 条数（默认 40）
  seed?: number; // 确定性种子（默认 42）
  // 合成的「真相」：on_time_probability 越高越可能实际 on_time——用来验脚手架能分辨判别力（非真实世界）。
  noise?: number; // label 翻转噪声 [0,1]（默认 0.1）
}

// makeSyntheticSnapshots(opts) → 一组确定性合成 labeled snapshot（seeded·provenance='synthetic'）。
//   ★仅供框架自检 / 演示脚手架能跑——**不是**真实语料，backtest 会因 provenance 判它 framework-validation-only。
export function makeSyntheticSnapshots(opts: SyntheticOptions = {}): DeadlineSnapshot[] {
  const n = opts.n ?? 40;
  const seed = opts.seed ?? 42;
  const noise = opts.noise ?? 0.1;
  const rng = new Sfc32(seed);
  const out: DeadlineSnapshot[] = [];
  const t0 = Date.parse('2026-01-01T00:00:00Z');
  for (let i = 0; i < n; i++) {
    const prob = rng.next(); // [0,1) 合成 on_time_probability
    // 合成真相：prob 高 → 更可能 on_time；叠加 noise 翻转（验脚手架对判别力敏感·非真实）。
    const flip = rng.next() < noise;
    const baseOnTime = rng.next() < prob;
    const onTime = flip ? !baseOnTime : baseOnTime;
    const band: DeadlineRiskBand =
      prob >= 0.9 ? 'on_track' : prob >= 0.65 ? 'watch' : prob >= 0.4 ? 'at_risk' : 'likely_late';
    const captured = t0 + i * 3600000;
    const ddl = captured + 100 * 3600000;
    out.push({
      schema: SNAPSHOT_SCHEMA,
      snapshot_id: snapshotId(`synthetic-board-${i}`, captured),
      board_id: `synthetic-board-${i}`,
      scope: 'synthetic',
      provenance: 'synthetic',
      captured_at_ms: captured,
      deadline_at_ms: ddl,
      deadline_state: 'confirmed',
      time_remaining_hours: 100,
      on_time_probability: round4(prob) as number,
      predicted_band: band,
      strength: band === 'at_risk' || band === 'likely_late' ? 'strong' : 'weak',
      channel_disagreement: null,
      backlog: 5,
      wip: 4,
      coverage_pct: 100,
      confidence: 'high',
      history_n: 40,
      bands_signature: bandsSignature({ on_track: 0.9, watch: 0.65, at_risk: 0.4 }),
      calibration_status_at_capture: 'uncalibrated-conservative',
      label: onTime ? 'on_time' : 'late',
      resolved_at_ms: ddl,
      actual_finish_ms: onTime ? ddl - 3600000 : null,
      resolution_basis: 'synthetic-ground-truth',
    });
  }
  return out;
}

// round4(x) → 4 位小数（null/非有限透传·度量可读且稳定）。
function round4(x: number | null): number | null {
  if (x == null || !Number.isFinite(x)) return x;
  return Math.round(x * 10000) / 10000;
}
