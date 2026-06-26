// evm.ts — EVM + Earned Schedule（SPI(t)·ADR-015 §2.4 / plan §3/§7）。
//
// Earned Value Management：用 baseline（plan 承诺·board.baseline）当零时刻基准，监控实际进度 vs 计划。
//   核心三量：
//     · PV  Planned Value：到 as-of 时刻，baseline 计划**应完成**的工作量（小时）。
//     · EV  Earned Value：到 as-of 时刻，**实际已完成**任务的 baseline 计划工作量（按 baseline 估值计，
//           不按实测——EV 是「挣到的计划价值」）。
//     · AC  Actual Cost：实际花费（duration 实测小时 或 token·--ac-source）。
//   指标：CPI=EV/AC（成本效率）、SPI=EV/PV（进度效率·$ 口径）、EAC=BAC/CPI、ETC=EAC−AC、VAC=BAC−EAC。
//
// Earned Schedule（Lipke 2003·plan §3）：修 SPI($) 末期失灵（项目快完时 EV→PV 强制 SPI→1.0，丧失判别力）。
//   ES = 「EV 等于哪个时刻的 PV」的时间点（在 PV(t) 曲线上反查）；SPI(t)=ES/AT（AT=actual time elapsed）。
//   SPI(t) 全程保判别力（即便末期）。SV(t)=ES−AT；IEAC(t)=AT/SPI(t)（独立时间 EAC）。
//
// 红线1：node/JS only，零 npm dep。确定性：纯算术 + baseline 拓扑 CPM（复用 graph-core）。
// 诚实降级（plan §3）：无 baseline → warn + 不报 EVM；AC 缺 token → coverage_pct 标注。

import { analyzeGraph, estimateHours } from '../board-graph-core.js';
import type { TaskLike } from '../board-model.js';
import { ISO_UTC_RE } from '../board-model.js';

function parseTs(v: unknown): number | null {
  if (typeof v !== 'string' || !ISO_UTC_RE.test(v)) return null;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? ms : null;
}

// baseline 段形状（board-model FIELDS.board.baseline·plan §6）。
export interface Baseline {
  captured_at?: string;
  t0?: string;
  task_estimates?: Record<string, { value?: number; unit?: string }>;
  dag_snapshot?: Record<string, { deps?: string[] }>;
  bac_h?: number;
  history?: unknown[];
}

export interface EvmOptions {
  asOfMs?: number; // as-of 时刻（默认 now）
  acSource?: 'duration' | 'token'; // AC 口径（默认 duration）
}

export interface EvmResult {
  has_baseline: boolean;
  baseline_captured_at: string | null;
  as_of: string;
  pv: { value: number; unit: string };
  ev: { value: number; unit: string };
  ac: { value: number; unit: string; source: string; coverage_pct: number };
  spi: number | null; // SPI($)=EV/PV
  cpi: number | null; // CPI=EV/AC
  spi_t: number | null; // SPI(t)=ES/AT（Earned Schedule·保末期判别力）
  sv_t: number | null; // SV(t)=ES−AT（时间偏差·小时）
  es_hours: number | null; // Earned Schedule（小时·从 t0 算）
  at_hours: number | null; // Actual Time（as-of − t0·小时）
  eac: { value: number; unit: string } | null; // BAC/CPI
  ieac_t: { value: number; unit: string } | null; // AT/SPI(t)（独立时间 EAC）
  etc: { value: number; unit: string } | null;
  bac: { value: number; unit: string };
  vac: { value: number; unit: string } | null;
  confidence: 'high' | 'medium' | 'low';
  warnings: string[];
  source: 'evm-earned-schedule';
}

// baselineEstimateHours(baseline, id) → baseline 计划的该任务小时（task_estimates·只认 baseline 快照）。
//   折算口径归一到引擎 SSOT `estimateHours`（同包 board-graph-core·认 h/m/d/w(eek)·#bug-B）——
//   修旧内联换算只认 d/m 而把 w/week 当 1h 的口径分裂（baseline snapshot 用 estimateHours·week=168h，
//   这里却当 1h → BAC≠PV/EV 口径，SPI/CPI/EAC/VAC 全废）。estimateHours 返 null（缺/坏/未知单位）→ 0（保原降级语义）。
function baselineHours(baseline: Baseline, id: string): number {
  return estimateHours(baseline.task_estimates?.[id]) ?? 0;
}

// computeEvm(board, baseline, opts) → EVM + Earned Schedule。
//   PV：用 baseline.dag_snapshot 跑 CPM（ES/EF·小时），到 as-of 时刻（AT=as-of−t0）累计「应完成」的计划值——
//       任务 EF ≤ AT → 全计；ES ≥ AT → 不计；横跨 → 按时间比例线性计（EV/PV 的标准做法）。
//   EV：board 里 status==='done' 的任务，累加其 baseline 计划小时（挣到的计划价值）。
//   AC：done 任务的实测（duration: finished−started·小时；token: observability tokens·折算）。
export function computeEvm(
  board: { tasks?: unknown },
  baseline: Baseline | null | undefined,
  opts: EvmOptions = {},
): EvmResult {
  const asOfMs = opts.asOfMs ?? Date.now();
  const acSource = opts.acSource ?? 'duration';
  const asOfISO = new Date(asOfMs).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const warnings: string[] = [];

  const tasks: TaskLike[] = Array.isArray(board.tasks) ? (board.tasks as TaskLike[]) : [];

  if (!baseline || typeof baseline !== 'object' || !baseline.task_estimates) {
    warnings.push('无 board.baseline——EVM 需要计划基线，先 `baseline snapshot`');
    return emptyEvm(asOfISO, acSource, warnings);
  }
  const t0 = parseTs(baseline.t0) ?? parseTs(baseline.captured_at);
  if (t0 == null) {
    warnings.push('baseline.t0 缺/非 ISO——无法定零时刻，EVM 降级');
    return emptyEvm(asOfISO, acSource, warnings);
  }
  const atHours = Math.max(0, (asOfMs - t0) / 3600000); // Actual Time elapsed

  // BAC：baseline.bac_h 优先；否则 sum(task_estimates)。
  const ids = Object.keys(baseline.task_estimates);
  let bacFromTasks = 0;
  for (const id of ids) bacFromTasks += baselineHours(baseline, id);
  const bac =
    typeof baseline.bac_h === 'number' && baseline.bac_h > 0 ? baseline.bac_h : bacFromTasks;

  // PV(t)：用 baseline.dag_snapshot 跑 CPM（小时·measured 不可得 → 用 baseline estimate 当 dur）。
  const snapshotBoard = {
    schema: 'cc-master/v2',
    tasks: ids.map((id) => ({
      id,
      status: 'ready',
      deps: baseline.dag_snapshot?.[id]?.deps ?? [],
      estimate: { value: baselineHours(baseline, id), unit: 'h' },
    })),
  };
  const g = analyzeGraph(snapshotBoard);
  const cp = g.criticalPath({ now: asOfMs });
  // PV at time AT：每节点 [ES, EF] 区间与 [0, AT] 的重叠比例 × 该节点计划小时。
  const pvAtTime = (limit: number): number => {
    let pv = 0;
    for (const id of ids) {
      const e = cp.schedule.get(id);
      if (!e) continue;
      const dur = e.dur;
      if (dur <= 0) continue;
      const overlap = Math.max(0, Math.min(e.ef, limit) - e.es);
      pv += (Math.min(overlap, dur) / dur) * baselineHours(baseline, id);
    }
    return pv;
  };
  const pv = pvAtTime(atHours);

  // EV：done 任务的 baseline 计划小时（挣到的计划价值）。
  //   backtest as-of 截断（同 PV 口径）：done 任务仅当 finished_at 缺失 **或** finished_at ≤ as-of 才计入
  //   EV/AC——一个「现在 done 但 finished_at > as-of」的任务在 as-of 时刻其实**尚未**完成，计入会虚报
  //   「进度发生在它真发生之前」。PV 已经 baseline.dag_snapshot CPM 截断到 as-of；EV/AC 须同口径
  //   （AC 的 duration/token 累计也只算 as-of 前完成的）。finished_at 缺失（无锚）→ 保守计入（保原降级语义）。
  let ev = 0;
  let ac = 0;
  let acCovered = 0;
  let acTotal = 0;
  for (const t of tasks) {
    const id = typeof t.id === 'string' ? t.id : '';
    if (!id || !(id in (baseline.task_estimates as object))) continue;
    if (t.status !== 'done') continue;
    const fin = parseTs(t.finished_at);
    if (fin != null && fin > asOfMs) continue; // as-of 之后才完成 → backtest 视作「尚未完成」，不计
    ev += baselineHours(baseline, id);
    acTotal += 1;
    if (acSource === 'duration') {
      const s = parseTs(t.started_at);
      const f = parseTs(t.finished_at);
      if (s != null && f != null && f > s) {
        ac += (f - s) / 3600000;
        acCovered += 1;
      }
    } else {
      const obs = (
        t.observability && typeof t.observability === 'object' ? t.observability : {}
      ) as { tokens?: { input?: number; output?: number } };
      const tok = obs.tokens;
      if (tok && (typeof tok.input === 'number' || typeof tok.output === 'number')) {
        ac += (tok.input ?? 0) + (tok.output ?? 0);
        acCovered += 1;
      }
    }
  }
  const coverage = acTotal > 0 ? Math.round((acCovered / acTotal) * 100) : 0;

  // Earned Schedule：ES = 「EV 等于哪个时刻的 PV」——在 PV(t) 上反查（单调递增·二分/扫描）。
  const es = earnedSchedule(ev, pvAtTime, atHours, cp.makespan ?? bac);
  const spi = pv > 0 ? ev / pv : null;
  const cpi = ac > 0 ? ev / ac : acSource === 'duration' && acTotal > 0 ? null : null;
  const spiT = atHours > 0 && es != null ? es / atHours : null;
  const svT = es != null ? es - atHours : null;
  const acUnit = acSource === 'token' ? 'tok' : 'h';

  // EAC=BAC/CPI（成本口径）；IEAC(t)=AT/SPI(t)（时间口径·plan §3）。
  const eac = cpi && cpi > 0 ? { value: bac / cpi, unit: acUnit } : null;
  const ieacT = spiT && spiT > 0 ? { value: atHours / spiT, unit: 'h' } : null;
  const etc = eac ? { value: Math.max(0, eac.value - ac), unit: acUnit } : null;
  // VAC=BAC−EAC 须同量纲。token AC 下 BAC 仍是小时、EAC 是 token（CPI=EV_hours/AC_tok → EAC 单位 token），
  //   缺同量纲 planned token budget 时 VAC 等于「小时减 token」量纲错乱——诚实置 null 而非给标 'tok' 的错数
  //   （advisory：宁可省略也不报错数·#round9 P2#1）。duration 口径 BAC/EAC 同为小时 → VAC 行为不变。
  const vac = eac && acSource !== 'token' ? { value: bac - eac.value, unit: acUnit } : null;
  if (acSource === 'token' && eac) {
    warnings.push(
      'AC 口径为 token 但无同量纲 planned token budget——VAC（=BAC−EAC）量纲不可比，已省略',
    );
  }

  if (coverage < 100 && acTotal > 0) {
    warnings.push(`AC 覆盖 ${coverage}%（部分 done 任务缺 ${acSource} 数据）——CPI/EAC 偏乐观`);
  }

  const confidence: 'high' | 'medium' | 'low' =
    coverage >= 80 && acTotal >= 3 ? 'high' : acTotal >= 1 ? 'medium' : 'low';

  return {
    has_baseline: true,
    baseline_captured_at: baseline.captured_at ?? null,
    as_of: asOfISO,
    pv: { value: round2(pv), unit: 'h' },
    ev: { value: round2(ev), unit: 'h' },
    ac: { value: round2(ac), unit: acUnit, source: acSource, coverage_pct: coverage },
    spi: spi != null ? round3(spi) : null,
    cpi: cpi != null ? round3(cpi) : null,
    spi_t: spiT != null ? round3(spiT) : null,
    sv_t: svT != null ? round2(svT) : null,
    es_hours: es != null ? round2(es) : null,
    at_hours: round2(atHours),
    eac: eac ? { value: round2(eac.value), unit: eac.unit } : null,
    ieac_t: ieacT ? { value: round2(ieacT.value), unit: ieacT.unit } : null,
    etc: etc ? { value: round2(etc.value), unit: etc.unit } : null,
    bac: { value: round2(bac), unit: 'h' },
    vac: vac ? { value: round2(vac.value), unit: vac.unit } : null,
    confidence,
    warnings,
    source: 'evm-earned-schedule',
  };
}

// earnedSchedule(ev, pvFn, atHours, horizon) → ES 时刻（PV(ES)=EV）。pvFn 单调递增 → 线性扫描 + 插值。
function earnedSchedule(
  ev: number,
  pvFn: (t: number) => number,
  atHours: number,
  horizon: number,
): number | null {
  if (ev <= 0) return 0;
  const maxT = Math.max(horizon, atHours, 1);
  const steps = 200;
  let prevT = 0;
  let prevPv = pvFn(0);
  for (let i = 1; i <= steps; i++) {
    const t = (maxT * i) / steps;
    const pv = pvFn(t);
    if (pv >= ev) {
      // 在 [prevT, t] 间线性插值 PV=EV 的时刻。
      const denom = pv - prevPv;
      const frac = denom > 0 ? (ev - prevPv) / denom : 0;
      return prevT + frac * (t - prevT);
    }
    prevT = t;
    prevPv = pv;
  }
  return maxT; // EV 超过总 PV（罕见）→ 封顶
}

function emptyEvm(asOfISO: string, acSource: string, warnings: string[]): EvmResult {
  return {
    has_baseline: false,
    baseline_captured_at: null,
    as_of: asOfISO,
    pv: { value: 0, unit: 'h' },
    ev: { value: 0, unit: 'h' },
    ac: { value: 0, unit: acSource === 'token' ? 'tok' : 'h', source: acSource, coverage_pct: 0 },
    spi: null,
    cpi: null,
    spi_t: null,
    sv_t: null,
    es_hours: null,
    at_hours: null,
    eac: null,
    ieac_t: null,
    etc: null,
    bac: { value: 0, unit: 'h' },
    vac: null,
    confidence: 'low',
    warnings,
    source: 'evm-earned-schedule',
  };
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}
function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}
