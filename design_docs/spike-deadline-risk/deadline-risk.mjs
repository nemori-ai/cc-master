// deadline-risk.mjs — 顶层 deadline-risk 计算（契约 §4.3 schema 的参考实现·喂 D3B endpoint）。
//
// 单一 verdict SSOT：准时概率 / 分位 margin / risk band / strength / 通道 + disagreement / 诚实字段 /
//   top drivers。hook 只搬运、绝不重算（契约红线3）。
//
// ★通道诚实性（codex 异构审查修正·triage design_docs/2026-07-16-ddl-review-triage.md 修正①）：
//   · on_time_probability **只能来自 RCPSP-in-trial 通道**（真调度当前 DAG + 吃 wip_limit 资源竞争）。
//   · throughput-MC **不是** resource-aware（历史日完成率采样×effective-n·不调度 DAG/不吃 wip）——降为
//     **heuristic 参考通道**（channels.throughput_reference），其输出**绝不**映射 green/on_track。
//   · precedence-only 只作**显式标注的 optimistic bound**（无资源闸·系统性乐观）。
//   · RCPSP 不可用（含环/空/超 latency 预算降档到 0 trials）→ on_time_probability=null + band=unknown，
//     **绝不退回 throughput 冒充 resource-aware**。
//
// ★校准诚实性（修正②）：band 阈值为 **explicitly uncalibrated 的保守起点**（无真实 DDL+交付结果 labeled
//   语料·经验校准不可行·见报告 §校准）。合成图集只验「调度器正确性」（scheduler correctness）≠ 经验校准。

import { precedenceOnlyMc, rcpspInTrialMc, throughputMc } from './channels.mjs';

// 默认 band 阈值（**explicitly uncalibrated·保守起点**·待 labeled snapshot 语料到位后校准固化）。
export const DEFAULT_BANDS = {
  on_track: 0.90,   // P_rcpsp(on time) >= 0.90
  watch: 0.65,      // 0.65 <= P < 0.90
  at_risk: 0.40,    // 0.40 <= P < 0.65
  // P < 0.40 → likely_late
  disagreement_gap: 0.25, // |P_precedence − P_rcpsp| 超此 → 禁无条件 on_track（降 watch）
  min_coverage: 30,       // coverage_pct 低于此 → 置信降级
  min_history: 4,         // history_n 低于此 → 置信降级
};

function asOfISO(ms) { return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z'); }
function addHoursISO(nowMs, hours) { return asOfISO(nowMs + hours * 3600000); }
function round2(x) { return Number.isFinite(x) ? Math.round(x * 100) / 100 : x; }
function round3(x) { return Number.isFinite(x) ? Math.round(x * 1000) / 1000 : x; }

// computeDeadlineRisk(board, opts) → §4.3 data 对象。
//   opts: { deadlineAtMs|null, deadlineState, asOfMs, records, calibParams(Map), backlog, wip,
//           runs, seed, effectiveN, scope, historyN, coveragePct, bands, statusMap,
//           rcpspRuns(可 <runs·latency 降档), rcpspDisabled(bool·超预算时强制 unknown) }
export function computeDeadlineRisk(board, opts) {
  const {
    deadlineAtMs = null, deadlineState = 'pending', asOfMs, records = [], calibParams,
    backlog = 0, wip = Infinity, runs = 2000, seed = 42, effectiveN = 1, scope = 'home',
    historyN = 0, coveragePct = 100, bands = DEFAULT_BANDS, statusMap = new Map(),
    rcpspRuns = null, rcpspDisabled = false,
  } = opts;

  const notes = [];
  const hasDdl = (deadlineState === 'asserted' || deadlineState === 'confirmed') && Number.isFinite(deadlineAtMs);
  const timeRemainingHours = hasDdl ? (deadlineAtMs - asOfMs) / 3600000 : null;

  // ── 无 DDL / 键缺失 → unknown（不 false-green）──
  if (!hasDdl) {
    notes.push(`deadline_state=${deadlineState}——无已确认/断言 DDL·风险 n/a（不假绿）`);
    return baseUnknown({ deadlineAtMs, deadlineState, asOfMs, scope, historyN, coveragePct, runs, seed, notes });
  }

  // ── 通道 A：precedence-only（乐观下界·显式标注·非承诺）──
  const est = precedenceOnlyMc(board, calibParams, { seed, runs, nowMs: asOfMs });
  // ── 通道 T：throughput（heuristic 参考·**非** resource-aware·÷effectiveN）──
  const thrRaw = throughputMc(backlog, records, { seed, runs, nowMs: asOfMs });
  const thr = scaleThroughput(thrRaw, effectiveN);
  // ── 通道 B：RCPSP-in-trial（**唯一** verdict 源·真调度 + wip 资源约束）──
  const rcpspN = rcpspRuns != null && rcpspRuns > 0 ? rcpspRuns : runs;
  const rcpsp = rcpspDisabled ? null : rcpspInTrialMc(board, calibParams, { seed, runs: rcpspN, wip, nowMs: asOfMs });

  // 含环 / 空图 → unknown。
  if (est.cycle || est.node_count === 0) {
    notes.push(est.cycle ? '任务图含环——无法 forward pass·风险 unknown' : '空图/无未完成任务·风险 n/a');
    return baseUnknown({ deadlineAtMs, deadlineState, asOfMs, scope, historyN, coveragePct, runs, seed, notes, timeRemainingHours });
  }

  const pPrecedence = est.onTime(timeRemainingHours);

  // ── verdict 概率：唯一来自 RCPSP-in-trial ──
  let onTimeProb = null;
  let resourceBlock = null;
  if (rcpspDisabled) {
    notes.push('RCPSP-in-trial 超 latency 预算被降档禁用——on_time_probability=unknown（绝不退 throughput 冒充 resource-aware）');
  } else if (rcpsp && rcpsp.node_count > 0 && Number.isFinite(rcpsp.makespan.p50)) {
    onTimeProb = rcpsp.onTime(timeRemainingHours);
    resourceBlock = {
      on_time_probability: round3(onTimeProb), source: 'rcpsp-in-trial', wip: Number.isFinite(wip) ? wip : null, runs: rcpspN,
      makespan_p50_h: round2(rcpsp.makespan.p50), makespan_p80_h: round2(rcpsp.makespan.p80), makespan_p95_h: round2(rcpsp.makespan.p95),
    };
  } else {
    notes.push('RCPSP-in-trial 无有效输出——on_time_probability=unknown');
  }

  // throughput 参考块（heuristic·永不映射 on_track·仅给人看的旁证）。
  const throughputRef = Number.isFinite(thr.days?.p50) ? {
    kind: 'heuristic-reference', note: '历史吞吐采样·非 DAG 资源调度·不作 verdict',
    on_time_probability_heuristic: round3(thr.onTime(timeRemainingHours / 24)),
    days_p50: round2(thr.days.p50), days_p80: round2(thr.days.p80), days_p95: round2(thr.days.p95),
    confidence: thr.confidence,
  } : null;

  // forecast ETA（precedence makespan 映射挂钟·**乐观下界口径**·须诚实标注 wall-clock 假设）+ margin。
  const forecast = Number.isFinite(est.makespan.p50) ? {
    p50: addHoursISO(asOfMs, est.makespan.p50), p80: addHoursISO(asOfMs, est.makespan.p80), p95: addHoursISO(asOfMs, est.makespan.p95),
    basis: 'precedence-only-optimistic',
  } : null;
  const margin = Number.isFinite(est.makespan.p50) ? {
    p50_h: round2(timeRemainingHours - est.makespan.p50),
    p80_h: round2(timeRemainingHours - est.makespan.p80),
    p95_h: round2(timeRemainingHours - est.makespan.p95),
    basis: 'precedence-only-optimistic',
  } : null;

  // 双通道分歧：|P_precedence − P_rcpsp|（资源竞争敏感度信号）。
  const channelDisagreement = onTimeProb != null && Number.isFinite(onTimeProb) && Number.isFinite(pPrecedence)
    ? round3(Math.abs(pPrecedence - onTimeProb)) : null;

  // confidence（coverage / history 弱 → 降级）。
  let confidence = 'high';
  if (coveragePct < bands.min_coverage || historyN < bands.min_history) confidence = 'low';
  else if (coveragePct < 60 || historyN < 10) confidence = 'medium';

  // ── overdue：now >= DDL 且未完成 ──
  const complete = backlog === 0;
  let riskBand, strength;
  if (timeRemainingHours <= 0 && !complete) {
    riskBand = 'overdue'; strength = 'strong';
    notes.push('已过 DDL 且未完成——overdue·须向用户报告并决策（延期/缩范围/分阶段/终止）');
  } else {
    const cls = classifyBand(onTimeProb, { channelDisagreement, confidence, bands });
    riskBand = cls.band; strength = cls.strength;
    for (const n of cls.notes) notes.push(n);
  }

  const topDrivers = buildTopDrivers(est, statusMap);

  const data = {
    deadline: asOfISO(deadlineAtMs), deadline_state: deadlineState, as_of: asOfISO(asOfMs),
    time_remaining_hours: round2(timeRemainingHours),
    on_time_probability: Number.isFinite(onTimeProb) ? round3(onTimeProb) : null,
    on_time_probability_source: onTimeProb != null ? 'rcpsp-in-trial' : 'unknown',
    forecast, margin,
    risk_band: riskBand, strength,
    channels: {
      precedence_only: {
        role: 'optimistic-bound',
        on_time_probability: round3(pPrecedence),
        makespan_p50_h: round2(est.makespan.p50), makespan_p80_h: round2(est.makespan.p80), makespan_p95_h: round2(est.makespan.p95),
      },
      resource_aware: resourceBlock,        // = rcpsp-in-trial（verdict 源）或 null
      throughput_reference: throughputRef,  // heuristic·非 verdict·绝不 on_track
    },
    channel_disagreement: channelDisagreement,
    coverage_pct: coveragePct, confidence, history_n: historyN, scope,
    calibration_status: 'uncalibrated-conservative', // 无 labeled 语料·阈值为保守起点（诚实）
    top_drivers: topDrivers,
    runs, rcpsp_runs: rcpspDisabled ? 0 : rcpspN, seed, source: historyN > 0 ? 'calibrated' : 'estimate',
    notes,
  };
  return data;
}

// classifyBand(P_rcpsp, ctx) → { band, strength, notes }。概率优先 + disagreement/confidence 守 false-green。
function classifyBand(P, { channelDisagreement, confidence, bands }) {
  const notes = [];
  if (!Number.isFinite(P)) return { band: 'unknown', strength: 'weak', notes: ['on_time_probability 不可算（RCPSP 不可用）——unknown（不假绿）'] };
  const severeDisagree = channelDisagreement != null && channelDisagreement > bands.disagreement_gap;
  let band;
  if (P >= bands.on_track) band = 'on_track';
  else if (P >= bands.watch) band = 'watch';
  else if (P >= bands.at_risk) band = 'at_risk';
  else band = 'likely_late';
  if (band === 'on_track' && severeDisagree) {
    band = 'watch';
    notes.push(`precedence↔rcpsp 分歧 ${channelDisagreement} > ${bands.disagreement_gap}（资源竞争敏感）——降 on_track→watch`);
  }
  if (band === 'on_track' && confidence === 'low') {
    band = 'unknown';
    notes.push('置信 low（coverage/history 弱）——on_track 降 unknown（不假绿）');
  }
  const strength = band === 'watch' ? 'weak' : (band === 'at_risk' || band === 'likely_late') ? 'strong' : 'weak';
  return { band, strength, notes };
}

function buildTopDrivers(est, statusMap) {
  const drivers = [];
  const bySsi = est.criticality_index.slice().sort((a, b) => b.sensitivity - a.sensitivity);
  const seen = new Set();
  for (const s of est.criticality_index.slice(0, 3)) {
    if (s.criticality <= 0) continue;
    drivers.push({ id: s.id, criticality: round3(s.criticality), sensitivity: round3(s.sensitivity), reason: 'critical' });
    seen.add(s.id);
  }
  for (const s of bySsi.slice(0, 3)) {
    if (seen.has(s.id) || s.sensitivity <= 0) continue;
    drivers.push({ id: s.id, criticality: round3(s.criticality), sensitivity: round3(s.sensitivity), reason: 'sensitive' });
    seen.add(s.id);
  }
  for (const [id, st] of statusMap) {
    if (seen.has(id)) continue;
    if (st.blocked_on === 'user') { drivers.push({ id, reason: 'blocked', detail: 'blocked_on:user' }); seen.add(id); }
    else if (st.status === 'blocked') { drivers.push({ id, reason: 'blocked', detail: 'status:blocked' }); seen.add(id); }
  }
  return drivers.slice(0, 8);
}

function scaleThroughput(thrRaw, effectiveN) {
  if (!thrRaw || !(effectiveN > 1) || !Number.isFinite(thrRaw.days?.p50)) return thrRaw;
  return {
    ...thrRaw,
    days: { p50: thrRaw.days.p50 / effectiveN, p80: thrRaw.days.p80 / effectiveN, p95: thrRaw.days.p95 / effectiveN },
    mean: thrRaw.mean / effectiveN,
    onTime: (targetDays) => thrRaw.onTime(targetDays * effectiveN),
  };
}

function baseUnknown(x) {
  return {
    deadline: x.deadlineAtMs != null ? asOfISO(x.deadlineAtMs) : null,
    deadline_state: x.deadlineState, as_of: asOfISO(x.asOfMs),
    time_remaining_hours: x.timeRemainingHours != null ? round2(x.timeRemainingHours) : null,
    on_time_probability: null, on_time_probability_source: 'unknown', forecast: null, margin: null,
    risk_band: 'unknown', strength: 'weak',
    channels: { precedence_only: null, resource_aware: null, throughput_reference: null },
    channel_disagreement: null, coverage_pct: x.coveragePct, confidence: 'low', history_n: x.historyN, scope: x.scope,
    calibration_status: 'uncalibrated-conservative',
    top_drivers: [], runs: x.runs, rcpsp_runs: 0, seed: x.seed, source: x.historyN > 0 ? 'calibrated' : 'estimate',
    notes: x.notes,
  };
}
