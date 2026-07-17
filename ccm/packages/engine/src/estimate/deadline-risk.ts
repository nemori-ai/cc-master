// deadline-risk.ts — 交付 DDL 风险 verdict（issue #149 契约 §4.3·`ccm estimate deadline-risk` 单一 SSOT）。
//
// 单一 verdict SSOT：准时概率 / 分位 margin / 六态 risk band / strength / 三通道 + disagreement / 诚实字段 /
//   top drivers。hook 只搬运、绝不重算（契约红线3）。
//
// ★通道诚实性（codex 异构审查修正①·D3A spike 验证）：
//   · on_time_probability **只能来自 RCPSP-in-trial 通道**（真调度当前 DAG + 吃 wip_limit 资源竞争）。
//   · throughput-MC **不是** resource-aware（历史日完成率采样·不调度 DAG/不吃 wip）——降为 heuristic 参考通道
//     （throughput_reference），其输出**绝不**映射 green/on_track。
//   · precedence-only 只作**显式标注的 optimistic bound**（无资源闸·系统性乐观）。
//   · RCPSP 不可用（含环/空/超 latency 预算降档到 0 trials）→ on_time_probability=null + band=unknown，
//     **绝不退回 throughput 冒充 resource-aware**。
//
// ★校准诚实性（修正②）：band 阈值为 **explicitly uncalibrated 的保守起点**（无真实 DDL+交付结果 labeled
//   语料·经验校准不可行）。合成图集只验「调度器正确性」≠ 经验校准。calibration_status 恒 'uncalibrated-conservative'。
//
// 红线1：node/JS only，零 npm dep，纯 stdlib + Float64Array。确定性：三通道共用同一 seed 派生（引擎内各自派生·避免共相）。

import type { BoardLike } from '../board-graph-core.js';
import { analyzeGraph } from '../board-graph-core.js';
import type { DoneRecord } from '../usage/history-loader.js';
import {
  type EstimateMcResult,
  empiricalCdfAtOrBefore,
  estimateDagMonteCarlo,
  type NodeMcParam,
  rcpspInTrialMc,
  throughputMonteCarlo,
} from './mc-scheduler.js';

export type DeadlineRiskBand =
  | 'on_track'
  | 'watch'
  | 'at_risk'
  | 'likely_late'
  | 'overdue'
  | 'unknown';

// 默认 band 阈值（**explicitly uncalibrated·保守起点**·待 labeled snapshot 语料到位后校准固化）。
//   偏敏感（延期代价 >> 多余 advisory·且 v1 advisory 不 block）——升级 at_risk 的门落在 pOnTime≈0.6-0.7 一带。
export const DEFAULT_BANDS = {
  on_track: 0.9, // P_rcpsp(on time) >= 0.90
  watch: 0.65, // 0.65 <= P < 0.90
  at_risk: 0.4, // 0.40 <= P < 0.65；P < 0.40 → likely_late
  disagreement_gap: 0.25, // |P_precedence − P_rcpsp| 超此 → 禁无条件 on_track（降 watch）
  min_coverage: 30, // coverage_pct 低于此 → 置信降级
  min_history: 4, // history_n 低于此 → 置信降级
};
export type DeadlineBands = typeof DEFAULT_BANDS;

export interface DeadlineTaskStatus {
  status?: string;
  blocked_on?: string;
}

export interface DeadlineRiskOptions {
  deadlineAtMs: number | null; // goal_contract.deadline.at 的 ms（state∈asserted/confirmed 时）
  deadlineState: 'pending' | 'asserted' | 'confirmed' | 'none';
  asOfMs: number;
  records?: DoneRecord[]; // throughput 参考通道历史语料
  calibParams: Map<string, NodeMcParam>; // 引擎 buildMcParams 出的每节点 {meanHours, cv}
  backlog?: number; // as-of 截断未完成任务数（throughput 参考 + overdue 完成判据）
  wip?: number; // scheduling.wip_limit（RCPSP 资源约束）
  runs?: number;
  seed?: number;
  effectiveN?: number; // 号池有效配额份数（只缩 throughput 参考·非 verdict）
  scope?: string;
  historyN?: number;
  coveragePct?: number;
  bands?: DeadlineBands;
  statusMap?: Map<string, DeadlineTaskStatus>; // id → {status, blocked_on}（top_drivers 的 blocked 类）
  rcpspRuns?: number | null; // latency 降档时实际用的 trials（< runs·null=用 runs）
  rcpspDisabled?: boolean; // 超预算彻底禁用 RCPSP → unknown（绝不退 throughput）
}

export type DeadlineDriver =
  | { id: string; criticality: number; sensitivity: number; reason: 'critical' | 'sensitive' }
  | { id: string; reason: 'blocked'; detail: string };

export interface DeadlineRiskResult {
  deadline: string | null;
  deadline_state: string;
  as_of: string;
  time_remaining_hours: number | null;
  on_time_probability: number | null;
  on_time_probability_source: 'rcpsp-in-trial' | 'unknown';
  forecast: { p50: string; p80: string; p95: string; basis: string } | null;
  margin: { p50_h: number; p80_h: number; p95_h: number; basis: string } | null;
  risk_band: DeadlineRiskBand;
  strength: 'weak' | 'strong';
  channels: {
    precedence_only: {
      role: 'optimistic-bound';
      on_time_probability: number;
      makespan_p50_h: number;
      makespan_p80_h: number;
      makespan_p95_h: number;
    } | null;
    resource_aware: {
      on_time_probability: number;
      source: 'rcpsp-in-trial';
      wip: number | null;
      runs: number;
      makespan_p50_h: number;
      makespan_p80_h: number;
      makespan_p95_h: number;
    } | null;
    throughput_reference: {
      kind: 'heuristic-reference';
      note: string;
      on_time_probability_heuristic: number;
      days_p50: number;
      days_p80: number;
      days_p95: number;
      confidence: 'high' | 'medium' | 'low';
    } | null;
  };
  channel_disagreement: number | null;
  coverage_pct: number;
  confidence: 'high' | 'medium' | 'low';
  history_n: number;
  scope: string;
  calibration_status: 'uncalibrated-conservative';
  top_drivers: DeadlineDriver[];
  runs: number;
  rcpsp_runs: number;
  seed: number;
  source: 'calibrated' | 'estimate';
  notes: string[];
}

function asOfISO(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}
function addHoursISO(nowMs: number, hours: number): string {
  return asOfISO(nowMs + hours * 3600000);
}
function round2(x: number): number {
  return Number.isFinite(x) ? Math.round(x * 100) / 100 : x;
}
function round3(x: number): number {
  return Number.isFinite(x) ? Math.round(x * 1000) / 1000 : x;
}

// computeDeadlineRisk(board, opts) → §4.3 data 对象。三通道 MC + band 判定 + 诚实降级（绝不假绿）。
export function computeDeadlineRisk(
  board: BoardLike,
  opts: DeadlineRiskOptions,
): DeadlineRiskResult {
  const {
    deadlineAtMs = null,
    deadlineState = 'pending',
    asOfMs,
    records = [],
    calibParams,
    backlog = 0,
    wip = Number.POSITIVE_INFINITY,
    runs = 2000,
    seed = 42,
    effectiveN = 1,
    scope = 'home',
    historyN = 0,
    coveragePct = 100,
    bands = DEFAULT_BANDS,
    statusMap = new Map<string, DeadlineTaskStatus>(),
    rcpspRuns = null,
    rcpspDisabled = false,
  } = opts;

  const notes: string[] = [];
  const hasDdl =
    (deadlineState === 'asserted' || deadlineState === 'confirmed') &&
    Number.isFinite(deadlineAtMs);
  const timeRemainingHours = hasDdl ? ((deadlineAtMs as number) - asOfMs) / 3600000 : null;

  // ── 无 DDL / 键缺失 / none → unknown（不 false-green）──
  if (!hasDdl) {
    notes.push(`deadline_state=${deadlineState}——无已确认/断言 DDL·风险 n/a（不假绿）`);
    return baseUnknown({
      deadlineAtMs,
      deadlineState,
      asOfMs,
      scope,
      historyN,
      coveragePct,
      runs,
      seed,
      notes,
      timeRemainingHours: null,
    });
  }
  const trh = timeRemainingHours as number;

  // ── 通道 A：precedence-only（乐观下界·显式标注·非承诺）──
  const est = estimateDagMonteCarlo(board, calibParams, { seed, runs, nowMs: asOfMs });
  // ── 通道 T：throughput（heuristic 参考·**非** resource-aware·÷effectiveN）──
  const thr = throughputMonteCarlo(backlog, records, { seed, runs, nowMs: asOfMs });
  // ── 通道 B：RCPSP-in-trial（**唯一** verdict 源·真调度 + wip 资源约束）──
  const rcpspN = rcpspRuns != null && rcpspRuns > 0 ? rcpspRuns : runs;
  const rcpsp = rcpspDisabled
    ? null
    : rcpspInTrialMc(board, calibParams, { seed, runs: rcpspN, wip, nowMs: asOfMs });

  // 含环 / 空图 → unknown。estimateDagMonteCarlo 把二者都塌成 node_count=0（不单列 cycle）——
  //   再 topoSort 一次拿 cycle 布尔仅为诚实措辞（廉价·仅在 degenerate 路径）。
  if (est.node_count === 0) {
    const cyclic = analyzeGraph(board).topoSort().cycle != null;
    notes.push(
      cyclic ? '任务图含环——无法 forward pass·风险 unknown' : '空图/无未完成任务·风险 n/a',
    );
    return baseUnknown({
      deadlineAtMs,
      deadlineState,
      asOfMs,
      scope,
      historyN,
      coveragePct,
      runs,
      seed,
      notes,
      timeRemainingHours: trh,
    });
  }

  const pPrecedence = empiricalCdfAtOrBefore(est.makespanSamplesSorted, trh);

  // ── verdict 概率：唯一来自 RCPSP-in-trial ──
  let onTimeProb: number | null = null;
  let resourceBlock: DeadlineRiskResult['channels']['resource_aware'] = null;
  if (rcpspDisabled) {
    notes.push(
      'RCPSP-in-trial 超 latency 预算被降档禁用——on_time_probability=unknown（绝不退 throughput 冒充 resource-aware）',
    );
  } else if (rcpsp && rcpsp.node_count > 0 && Number.isFinite(rcpsp.makespan.p50)) {
    onTimeProb = empiricalCdfAtOrBefore(rcpsp.makespanSamplesSorted, trh);
    resourceBlock = {
      on_time_probability: round3(onTimeProb),
      source: 'rcpsp-in-trial',
      wip: Number.isFinite(rcpsp.wip) ? rcpsp.wip : null,
      runs: rcpspN,
      makespan_p50_h: round2(rcpsp.makespan.p50),
      makespan_p80_h: round2(rcpsp.makespan.p80),
      makespan_p95_h: round2(rcpsp.makespan.p95),
    };
  } else {
    notes.push('RCPSP-in-trial 无有效输出——on_time_probability=unknown');
  }

  // throughput 参考块（heuristic·永不映射 on_track·仅给人看的旁证·÷effectiveN 缩放）。
  const thrOnTime = scaledThroughputOnTime(thr.daysSamplesSorted, trh / 24, effectiveN);
  const throughputRef = Number.isFinite(thr.days.p50)
    ? {
        kind: 'heuristic-reference' as const,
        note: '历史吞吐采样·非 DAG 资源调度·不作 verdict',
        on_time_probability_heuristic: round3(thrOnTime),
        days_p50: round2(thr.days.p50 / effectiveN),
        days_p80: round2(thr.days.p80 / effectiveN),
        days_p95: round2(thr.days.p95 / effectiveN),
        confidence: thr.confidence,
      }
    : null;

  // forecast ETA（precedence makespan 映射挂钟·**乐观下界口径**·须诚实标注 wall-clock 假设）+ margin。
  const forecast = Number.isFinite(est.makespan.p50)
    ? {
        p50: addHoursISO(asOfMs, est.makespan.p50),
        p80: addHoursISO(asOfMs, est.makespan.p80),
        p95: addHoursISO(asOfMs, est.makespan.p95),
        basis: 'precedence-only-optimistic',
      }
    : null;
  const margin = Number.isFinite(est.makespan.p50)
    ? {
        p50_h: round2(trh - est.makespan.p50),
        p80_h: round2(trh - est.makespan.p80),
        p95_h: round2(trh - est.makespan.p95),
        basis: 'precedence-only-optimistic',
      }
    : null;

  // 双通道分歧：|P_precedence − P_rcpsp|（资源竞争敏感度信号）。
  const channelDisagreement =
    onTimeProb != null && Number.isFinite(onTimeProb) && Number.isFinite(pPrecedence)
      ? round3(Math.abs(pPrecedence - onTimeProb))
      : null;

  // confidence（coverage / history 弱 → 降级）。
  let confidence: 'high' | 'medium' | 'low' = 'high';
  if (coveragePct < bands.min_coverage || historyN < bands.min_history) confidence = 'low';
  else if (coveragePct < 60 || historyN < 10) confidence = 'medium';

  // ── band 判定：先短路完成态，再 overdue，最后 classify ──
  //   完成态（backlog=0）= 全部任务已完成 → 已交付，无未来 late risk。即便 as_of 已过 DDL 也不该报「要迟到」：
  //   MC makespan 反映的是整张 DAG 从零跑完的时长（非「剩余工作」），completed board 的 onTimeProb 会被压成 0，
  //   若落 classifyBand 会被误判成 likely_late。复用 on_track 表完成态（保持 band 闭集不膨胀·消费方零改动·
  //   hook bandRank/RISK_BANDS 天然识别），strength=weak（已交付·无需强推），note 显式说明「全部任务已完成」。
  const complete = backlog === 0;
  let riskBand: DeadlineRiskBand;
  let strength: 'weak' | 'strong';
  if (complete) {
    riskBand = 'on_track';
    strength = 'weak';
    notes.push('全部任务已完成（backlog=0）——已交付，无 late risk（复用 on_track 表完成态·非「要迟到」）');
  } else if (trh <= 0) {
    // now >= DDL 且未完成 → overdue。
    riskBand = 'overdue';
    strength = 'strong';
    notes.push('已过 DDL 且未完成——overdue·须向用户报告并决策（延期/缩范围/分阶段/终止）');
  } else {
    const cls = classifyBand(onTimeProb, { channelDisagreement, confidence, bands });
    riskBand = cls.band;
    strength = cls.strength;
    for (const n of cls.notes) notes.push(n);
  }

  const topDrivers = buildTopDrivers(est, statusMap);

  return {
    deadline: asOfISO(deadlineAtMs as number),
    deadline_state: deadlineState,
    as_of: asOfISO(asOfMs),
    time_remaining_hours: round2(trh),
    on_time_probability:
      onTimeProb != null && Number.isFinite(onTimeProb) ? round3(onTimeProb) : null,
    on_time_probability_source: onTimeProb != null ? 'rcpsp-in-trial' : 'unknown',
    forecast,
    margin,
    risk_band: riskBand,
    strength,
    channels: {
      precedence_only: {
        role: 'optimistic-bound',
        on_time_probability: round3(pPrecedence),
        makespan_p50_h: round2(est.makespan.p50),
        makespan_p80_h: round2(est.makespan.p80),
        makespan_p95_h: round2(est.makespan.p95),
      },
      resource_aware: resourceBlock, // = rcpsp-in-trial（verdict 源）或 null
      throughput_reference: throughputRef, // heuristic·非 verdict·绝不 on_track
    },
    channel_disagreement: channelDisagreement,
    coverage_pct: coveragePct,
    confidence,
    history_n: historyN,
    scope,
    calibration_status: 'uncalibrated-conservative', // 无 labeled 语料·阈值为保守起点（诚实）
    top_drivers: topDrivers,
    runs,
    rcpsp_runs: rcpspDisabled ? 0 : rcpspN,
    seed,
    source: historyN > 0 ? 'calibrated' : 'estimate',
    notes,
  };
}

// classifyBand(P_rcpsp, ctx) → { band, strength, notes }。概率优先 + disagreement/confidence 守 false-green。
function classifyBand(
  P: number | null,
  {
    channelDisagreement,
    confidence,
    bands,
  }: { channelDisagreement: number | null; confidence: string; bands: DeadlineBands },
): { band: DeadlineRiskBand; strength: 'weak' | 'strong'; notes: string[] } {
  const notes: string[] = [];
  if (P == null || !Number.isFinite(P))
    return {
      band: 'unknown',
      strength: 'weak',
      notes: ['on_time_probability 不可算（RCPSP 不可用）——unknown（不假绿）'],
    };
  const severeDisagree =
    channelDisagreement != null && channelDisagreement > bands.disagreement_gap;
  let band: DeadlineRiskBand;
  if (P >= bands.on_track) band = 'on_track';
  else if (P >= bands.watch) band = 'watch';
  else if (P >= bands.at_risk) band = 'at_risk';
  else band = 'likely_late';
  if (band === 'on_track' && severeDisagree) {
    band = 'watch';
    notes.push(
      `precedence↔rcpsp 分歧 ${channelDisagreement} > ${bands.disagreement_gap}（资源竞争敏感）——降 on_track→watch`,
    );
  }
  if (band === 'on_track' && confidence === 'low') {
    band = 'unknown';
    notes.push('置信 low（coverage/history 弱）——on_track 降 unknown（不假绿）');
  }
  const strength: 'weak' | 'strong' =
    band === 'at_risk' || band === 'likely_late' ? 'strong' : 'weak';
  return { band, strength, notes };
}

function buildTopDrivers(
  est: EstimateMcResult,
  statusMap: Map<string, DeadlineTaskStatus>,
): DeadlineDriver[] {
  const drivers: DeadlineDriver[] = [];
  const bySsi = est.criticality_index.slice().sort((a, b) => b.sensitivity - a.sensitivity);
  const seen = new Set<string>();
  for (const s of est.criticality_index.slice(0, 3)) {
    if (s.criticality <= 0) continue;
    drivers.push({
      id: s.id,
      criticality: round3(s.criticality),
      sensitivity: round3(s.sensitivity),
      reason: 'critical',
    });
    seen.add(s.id);
  }
  for (const s of bySsi.slice(0, 3)) {
    if (seen.has(s.id) || s.sensitivity <= 0) continue;
    drivers.push({
      id: s.id,
      criticality: round3(s.criticality),
      sensitivity: round3(s.sensitivity),
      reason: 'sensitive',
    });
    seen.add(s.id);
  }
  for (const [id, st] of statusMap) {
    if (seen.has(id)) continue;
    if (st.blocked_on === 'user') {
      drivers.push({ id, reason: 'blocked', detail: 'blocked_on:user' });
      seen.add(id);
    } else if (st.status === 'blocked') {
      drivers.push({ id, reason: 'blocked', detail: 'status:blocked' });
      seen.add(id);
    }
  }
  return drivers.slice(0, 8);
}

// scaledThroughputOnTime(sortedDays, targetDays, effectiveN) → 号池 N 路并行缩放后的 heuristic on-time。
//   days ÷ N 等价于在原样本上把 target 放大 N 倍（P(days/N ≤ target) = P(days ≤ target·N)）。
function scaledThroughputOnTime(
  sortedDays: Float64Array,
  targetDays: number,
  effectiveN: number,
): number {
  const n = effectiveN > 1 ? effectiveN : 1;
  return empiricalCdfAtOrBefore(sortedDays, targetDays * n);
}

function baseUnknown(x: {
  deadlineAtMs: number | null;
  deadlineState: string;
  asOfMs: number;
  scope: string;
  historyN: number;
  coveragePct: number;
  runs: number;
  seed: number;
  notes: string[];
  timeRemainingHours: number | null;
}): DeadlineRiskResult {
  return {
    deadline: x.deadlineAtMs != null ? asOfISO(x.deadlineAtMs) : null,
    deadline_state: x.deadlineState,
    as_of: asOfISO(x.asOfMs),
    time_remaining_hours: x.timeRemainingHours != null ? round2(x.timeRemainingHours) : null,
    on_time_probability: null,
    on_time_probability_source: 'unknown',
    forecast: null,
    margin: null,
    risk_band: 'unknown',
    strength: 'weak',
    channels: { precedence_only: null, resource_aware: null, throughput_reference: null },
    channel_disagreement: null,
    coverage_pct: x.coveragePct,
    confidence: 'low',
    history_n: x.historyN,
    scope: x.scope,
    calibration_status: 'uncalibrated-conservative',
    top_drivers: [],
    runs: x.runs,
    rcpsp_runs: 0,
    seed: x.seed,
    source: x.historyN > 0 ? 'calibrated' : 'estimate',
    notes: x.notes,
  };
}
