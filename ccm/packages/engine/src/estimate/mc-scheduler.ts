// mc-scheduler.ts — 双通道 Monte Carlo 调度（ADR-015 §2.4 / plan §3/§7）。
//
// OR 层核心，复用 board-graph-core 的拓扑 / 邻接（不重写图算法·plan §2 不变式 3）：
//
//   ① 估算-DAG-MC（结构感知）：topo order 循环外算一次，循环内 forward pass × N（log-normal 采样每节点
//      时长）→ makespan 分布 P50/P80/P95 + 敏感度三件套：
//        · CI  Criticality Index：节点落在该 trial 关键路径上的频率（被卡住起跑的 binding 链）。
//        · CRI Cruciality Index：节点时长与项目 makespan 的 Pearson 相关（plan「CI/CRI/SSI」）。
//        · SSI Schedule Sensitivity Index：CI × (σ_node/σ_project)（Vanhoucke 2010）。
//   ② 吞吐-MC（#NoEstimates·Vacanti·plan §3）：对历史吞吐（任务/天）采样「清空 backlog 要几天」——
//      **不依赖 per-task 估值**（估值缺/早期板 coverage<50% 时它主导）。
//   ①②并存：偏差 > 20% 出 consistency warning（plan §3）。
//
// 红线1：node/JS only，零 npm dep，纯 stdlib + Float64Array。
// 确定性（plan §7）：入口收 seed，每次 new Sfc32(seed)；Float64Array.sort() V8 确定。绝不 Math.random()。

import type { BoardLike } from '../board-graph-core.js';
import { analyzeGraph } from '../board-graph-core.js';
import type { DoneRecord } from '../usage/history-loader.js';
import type { Interval } from './conformal.js';
import { Sfc32 } from './prng.js';
import { sampleTaskDuration } from './sampling.js';

// 每节点 MC 入参：点估均值（小时·校准后）+ cv（离散度·来自 dispersion）。
export interface NodeMcParam {
  meanHours: number; // ≤0 → 视为 0 时长（不占工期·如已完成节点）
  cv: number; // 变异系数（>0）
}

export interface ForecastOptions {
  seed?: number;
  runs?: number; // trials（默认 2000·plan headline）
  nowMs?: number;
  defaultCv?: number; // 缺参数节点的兜底 cv（默认 0.4）
  defaultMeanHours?: number; // 缺参数节点的兜底均值（默认 1·unit 降级）
}

export interface SensitivityEntry {
  id: string;
  criticality: number; // CI ∈ [0,1]
  cruciality: number; // CRI ∈ [-1,1]
  sensitivity: number; // SSI ∈ [0,1]
}

export interface EstimateMcResult {
  makespan: Interval; // {p50,p80,p95}（小时·5% 硬墙）
  mean: number;
  criticality_index: SensitivityEntry[]; // 按 CI 降序
  runs: number;
  seed: number;
  node_count: number;
  source: 'estimate-dag-mc';
}

// pearson(x, y) → Pearson 相关系数（两 Float64Array 等长）。任一方差 0 → 0（无相关）。
function pearson(x: Float64Array, y: Float64Array): number {
  const n = x.length;
  if (n < 2) return 0;
  let mx = 0;
  let my = 0;
  for (let i = 0; i < n; i++) {
    mx += x[i] as number;
    my += y[i] as number;
  }
  mx /= n;
  my /= n;
  let cov = 0;
  let vx = 0;
  let vy = 0;
  for (let i = 0; i < n; i++) {
    const dx = (x[i] as number) - mx;
    const dy = (y[i] as number) - my;
    cov += dx * dy;
    vx += dx * dx;
    vy += dy * dy;
  }
  if (vx <= 0 || vy <= 0) return 0;
  return cov / Math.sqrt(vx * vy);
}

function stddev(arr: Float64Array): number {
  const n = arr.length;
  if (n < 2) return 0;
  let m = 0;
  for (let i = 0; i < n; i++) m += arr[i] as number;
  m /= n;
  let v = 0;
  for (let i = 0; i < n; i++) {
    const d = (arr[i] as number) - m;
    v += d * d;
  }
  return Math.sqrt(v / (n - 1));
}

// estimateDagMonteCarlo(board, params, opts) → 通道①：结构感知 MC（forward pass·log-normal）。
//   params: id → {meanHours, cv}。缺 id 的节点用兜底（unit 降级）。坏图（含环 / 空）→ 退化空结果（不抛）。
export function estimateDagMonteCarlo(
  board: BoardLike,
  params: Map<string, NodeMcParam>,
  opts: ForecastOptions = {},
): EstimateMcResult {
  const seed = opts.seed ?? 42;
  const runs = Math.max(1, opts.runs ?? 2000);
  const defaultCv = opts.defaultCv ?? 0.4;
  const defaultMean = opts.defaultMeanHours ?? 1;

  const g = analyzeGraph(board);
  const { order, cycle } = g.topoSort();
  const ids = order; // 拓扑序（循环外算一次·plan §7）
  const nodeCount = ids.length;

  // 含环 / 空图 → 无法 forward pass，退化空结果（诚实降级·调用方据 node_count=0 报错）。
  if (cycle || nodeCount === 0) {
    return {
      makespan: { p50: NaN, p80: NaN, p95: NaN },
      mean: NaN,
      criticality_index: [],
      runs,
      seed,
      node_count: 0,
      source: 'estimate-dag-mc',
    };
  }

  const prng = new Sfc32(seed);
  const idx = new Map<string, number>();
  for (let i = 0; i < ids.length; i++) idx.set(ids[i] as string, i);
  // 预取每节点的上游（拓扑序下标·forward pass 用）+ 参数。
  const upstreamIdx: number[][] = ids.map((id) =>
    g
      .predecessors(id)
      .map((p) => idx.get(p))
      .filter((x): x is number => x !== undefined),
  );
  const meanArr = new Float64Array(nodeCount);
  const cvArr = new Float64Array(nodeCount);
  for (let i = 0; i < nodeCount; i++) {
    const p = params.get(ids[i] as string);
    meanArr[i] = p ? p.meanHours : defaultMean;
    cvArr[i] = p && p.cv > 0 ? p.cv : defaultCv;
  }

  const makespanSamples = new Float64Array(runs);
  // 每节点时长样本（算 CRI/SSI 的 Pearson 用·node × runs）。
  const durSamples: Float64Array[] = ids.map(() => new Float64Array(runs));
  const critCount = new Float64Array(nodeCount); // CI 计数

  const ef = new Float64Array(nodeCount); // 本 trial 各节点 EF
  const es = new Float64Array(nodeCount);

  for (let t = 0; t < runs; t++) {
    // forward pass（拓扑序·ES = max(EF of preds)·EF = ES + dur）。
    let makespan = 0;
    let sinkIdx = 0;
    for (let i = 0; i < nodeCount; i++) {
      const mean = meanArr[i] as number;
      const dur = mean > 0 ? sampleTaskDuration(() => prng.next(), mean, cvArr[i] as number) : 0;
      (durSamples[i] as Float64Array)[t] = dur;
      let start = 0;
      const ups = upstreamIdx[i] as number[];
      for (const u of ups) {
        const uef = ef[u] as number;
        if (uef > start) start = uef;
      }
      es[i] = start;
      const e = start + dur;
      ef[i] = e;
      if (e > makespan) {
        makespan = e;
        sinkIdx = i;
      }
    }
    makespanSamples[t] = makespan;
    // CI：从 sink 反向沿 binding 边（EF(pred)==ES(self)）走关键路径，沿途节点 +1。
    let cur: number = sinkIdx;
    const guard = new Set<number>();
    const EPS = 1e-9;
    while (cur >= 0 && !guard.has(cur)) {
      guard.add(cur);
      critCount[cur] = (critCount[cur] as number) + 1;
      const myEs = es[cur] as number;
      let pick = -1;
      for (const u of upstreamIdx[cur] as number[]) {
        if (Math.abs((ef[u] as number) - myEs) < EPS) {
          pick = u;
          break;
        }
      }
      cur = pick;
    }
  }

  // 敏感度三件套。
  const sortedMakespan = Float64Array.from(makespanSamples);
  sortedMakespan.sort();
  const projStd = stddev(makespanSamples);
  let meanMakespan = 0;
  for (let t = 0; t < runs; t++) meanMakespan += makespanSamples[t] as number;
  meanMakespan /= runs;

  const sens: SensitivityEntry[] = ids.map((id, i) => {
    const ci = (critCount[i] as number) / runs;
    const cri = pearson(durSamples[i] as Float64Array, makespanSamples);
    const nodeStd = stddev(durSamples[i] as Float64Array);
    const ssi = projStd > 0 ? ci * (nodeStd / projStd) : 0;
    return { id, criticality: ci, cruciality: cri, sensitivity: ssi };
  });
  sens.sort((a, b) => b.criticality - a.criticality || a.id.localeCompare(b.id));

  return {
    makespan: {
      p50: quantileFromSorted(sortedMakespan, 0.5),
      p80: quantileFromSorted(sortedMakespan, 0.8),
      p95: quantileFromSorted(sortedMakespan, 0.95), // 5% 硬墙
    },
    mean: meanMakespan,
    criticality_index: sens,
    runs,
    seed,
    node_count: nodeCount,
    source: 'estimate-dag-mc',
  };
}

// 已排序 Float64Array 取分位（复用 conformal 的口径，避免重复 new 数组）。
function quantileFromSorted(sorted: Float64Array, p: number): number {
  const n = sorted.length;
  if (n === 0) return NaN;
  if (n === 1) return sorted[0] as number;
  const idx = (p < 0 ? 0 : p > 1 ? 1 : p) * (n - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  const frac = idx - lo;
  return (sorted[lo] as number) * (1 - frac) + (sorted[hi] as number) * frac;
}

// ── 通道②：吞吐-MC（#NoEstimates·Vacanti·plan §3）────────────────────────────────────────────────
// 不依赖 per-task 估值，对历史**吞吐**（每个 done 任务的完成节奏）采样「清空 M 个 backlog 任务要几天」。
// 做法：从历史 done 任务的「天吞吐」样本（按 finishedAt 分桶到天 → 每天完成几个）里 bootstrap 采样，
//   累加到清空 backlog M 为止的天数，× runs 得分布。历史吞吐不足 → 退化（confidence low）。
export interface ThroughputMcResult {
  days: Interval; // 清空 backlog 的天数 {p50,p80,p95}
  mean: number;
  backlog: number; // 待清空任务数
  daily_throughput_samples: number; // 用于 bootstrap 的天数样本量
  runs: number;
  seed: number;
  confidence: 'high' | 'medium' | 'low';
  source: 'throughput-mc';
}

// dailyThroughput(records) → 每个有完成时戳的 done 任务按「完成日」分桶 → 每天完成数数组（仅非空日）。
export function dailyThroughput(records: DoneRecord[]): number[] {
  const byDay = new Map<string, number>();
  for (const r of records) {
    if (r.finishedAtMs == null) continue;
    const day = new Date(r.finishedAtMs).toISOString().slice(0, 10); // YYYY-MM-DD（UTC）
    byDay.set(day, (byDay.get(day) ?? 0) + 1);
  }
  return [...byDay.values()];
}

export function throughputMonteCarlo(
  backlog: number,
  records: DoneRecord[],
  opts: ForecastOptions = {},
): ThroughputMcResult {
  const seed = opts.seed ?? 42;
  const runs = Math.max(1, opts.runs ?? 2000);
  const daily = dailyThroughput(records).filter((v) => v > 0);
  const m = Math.max(0, Math.floor(backlog));

  if (daily.length === 0 || m === 0) {
    return {
      days: { p50: m === 0 ? 0 : NaN, p80: m === 0 ? 0 : NaN, p95: m === 0 ? 0 : NaN },
      mean: m === 0 ? 0 : NaN,
      backlog: m,
      daily_throughput_samples: daily.length,
      runs,
      seed,
      confidence: 'low',
      source: 'throughput-mc',
    };
  }

  const prng = new Sfc32(seed ^ 0x9e3779b9); // 与通道①不同 seed 派生·避免共相
  const daysSamples = new Float64Array(runs);
  for (let t = 0; t < runs; t++) {
    let remaining = m;
    let days = 0;
    // 安全上限防 0-heavy 吞吐死循环（最多 backlog × 当 daily=全 0.x 时的保护）。
    const cap = m * 1000 + 1000;
    while (remaining > 0 && days < cap) {
      const tp = daily[prng.nextInt(daily.length)] as number; // bootstrap 一天的吞吐
      remaining -= tp;
      days += 1;
    }
    daysSamples[t] = days;
  }
  const sorted = Float64Array.from(daysSamples);
  sorted.sort();
  let mean = 0;
  for (let t = 0; t < runs; t++) mean += daysSamples[t] as number;
  mean /= runs;

  const confidence: 'high' | 'medium' | 'low' =
    daily.length >= 10 ? 'high' : daily.length >= 4 ? 'medium' : 'low';

  return {
    days: {
      p50: quantileFromSorted(sorted, 0.5),
      p80: quantileFromSorted(sorted, 0.8),
      p95: quantileFromSorted(sorted, 0.95),
    },
    mean,
    backlog: m,
    daily_throughput_samples: daily.length,
    runs,
    seed,
    confidence,
    source: 'throughput-mc',
  };
}

// ── ①②consistency 比对（plan §3：偏差 > 20% 出 consistency warning）──────────────────────────────
// 两通道度量不同（小时 vs 天）——比对前先把通道① makespan 折算成「天」（assume 工作日小时数·默认 8h/天）。
export interface ConsistencyResult {
  estimate_days_p50: number; // 通道① makespan.p50 / hoursPerDay
  throughput_days_p50: number; // 通道② days.p50
  deviation: number; // |a-b| / max(a,b)
  warning: boolean; // deviation > threshold
  note: string;
}
export function dualChannelConsistency(
  est: EstimateMcResult,
  thr: ThroughputMcResult,
  hoursPerDay = 8,
  threshold = 0.2,
): ConsistencyResult {
  const a = Number.isFinite(est.makespan.p50) ? est.makespan.p50 / hoursPerDay : NaN;
  const b = thr.days.p50;
  if (!Number.isFinite(a) || !Number.isFinite(b) || (a === 0 && b === 0)) {
    return {
      estimate_days_p50: a,
      throughput_days_p50: b,
      deviation: NaN,
      warning: false,
      note: '一通道无有效输出（冷启动 / 含环 / 无估值）——无法 consistency 比对',
    };
  }
  const dev = Math.abs(a - b) / Math.max(a, b, 1e-9);
  return {
    estimate_days_p50: a,
    throughput_days_p50: b,
    deviation: dev,
    warning: dev > threshold,
    note:
      dev > threshold
        ? `两通道偏差 ${(dev * 100).toFixed(0)}% > ${(threshold * 100).toFixed(0)}%——估值与历史吞吐不一致，建议复核估值或 coverage`
        : '两通道一致',
  };
}
