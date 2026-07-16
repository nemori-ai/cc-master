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
  // 升序 makespan 样本（deadline-risk 的 on_time_probability = P(finish ≤ DDL) 载重·喂 empiricalCdfAtOrBefore）。
  //   算完分位本就得到 sorted，一等暴露它，杜绝重算/重排（issue #149 契约 §4.3 引擎缺口）。含环/空图 → 空数组。
  makespanSamplesSorted: Float64Array;
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
      makespanSamplesSorted: new Float64Array(0),
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
    makespanSamplesSorted: sortedMakespan,
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

// empiricalCdfAtOrBefore(sortedSamples, target) → 升序样本里 ≤ target 的占比 ∈ [0,1]（经验 CDF·on-time 概率）。
//   二分找「第一个 > target 的下标」= ≤ target 的计数（upper_bound）。sortedSamples 必须升序。
//   空数组 / 非有限 target → NaN（诚实降级·调用方据此报 unknown·绝不假绿）。O(log n)。
//   deadline-risk 载重：P(finish ≤ DDL) = empiricalCdfAtOrBefore(makespanSamplesSorted, time_remaining)。
export function empiricalCdfAtOrBefore(sortedSamples: Float64Array, target: number): number {
  const n = sortedSamples.length;
  if (n === 0 || !Number.isFinite(target)) return NaN;
  let lo = 0;
  let hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((sortedSamples[mid] as number) <= target) lo = mid + 1;
    else hi = mid;
  }
  return lo / n; // lo = ≤target 的数量
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
  // 升序清空天数样本（deadline-risk heuristic 参考通道·on-time 概率 = P(days ≤ time_remaining/24)·喂 empiricalCdfAtOrBefore）。
  daysSamplesSorted: Float64Array;
  runs: number;
  seed: number;
  confidence: 'high' | 'medium' | 'low';
  source: 'throughput-mc';
}

// dailyThroughput(records) → done 任务按「完成日」分桶，回 first→last 完成日**整段**跨度的每日完成数
//   （含中间零产出的闲置日·#round9 P2#2）。**含闲置日**是关键：只回非空（高产）日会让 MC 把稀疏历史的
//   高产日当全部、漏采零产出日 → 吞吐高估 / ETA 低估（例：周一+周五各一完成应算 ~0.4 task/day·跨 5 日，
//   而非 ~1 task/day）。按 UTC 日推进（UTC 无 DST → 步长恒 86400000ms·边界稳定）。
export function dailyThroughput(records: DoneRecord[]): number[] {
  const byDay = new Map<string, number>();
  let minMs = Number.POSITIVE_INFINITY;
  let maxMs = Number.NEGATIVE_INFINITY;
  for (const r of records) {
    if (r.finishedAtMs == null) continue;
    const day = new Date(r.finishedAtMs).toISOString().slice(0, 10); // YYYY-MM-DD（UTC）
    byDay.set(day, (byDay.get(day) ?? 0) + 1);
    if (r.finishedAtMs < minMs) minMs = r.finishedAtMs;
    if (r.finishedAtMs > maxMs) maxMs = r.finishedAtMs;
  }
  if (byDay.size === 0) return []; // 无完成时戳 → 空（调用方据此降级 low confidence）。
  const DAY_MS = 86400000;
  const firstDayMs = Date.parse(`${new Date(minMs).toISOString().slice(0, 10)}T00:00:00Z`);
  const lastDayMs = Date.parse(`${new Date(maxMs).toISOString().slice(0, 10)}T00:00:00Z`);
  const out: number[] = [];
  for (let d = firstDayMs; d <= lastDayMs; d += DAY_MS) {
    const key = new Date(d).toISOString().slice(0, 10);
    out.push(byDay.get(key) ?? 0); // 闲置日 → 0（被 bootstrap 采样反映真实零产出节奏）。
  }
  return out;
}

export function throughputMonteCarlo(
  backlog: number,
  records: DoneRecord[],
  opts: ForecastOptions = {},
): ThroughputMcResult {
  const seed = opts.seed ?? 42;
  const runs = Math.max(1, opts.runs ?? 2000);
  // 不再 filter 掉零产出日——闲置日（count=0）必须留在 bootstrap 池里，否则又退回「只采高产日」的高估
  //   （#round9 P2#2）。0-heavy 池的死循环风险由下方 `cap` 守。
  const daily = dailyThroughput(records);
  const m = Math.max(0, Math.floor(backlog));

  if (daily.length === 0 || m === 0) {
    return {
      days: { p50: m === 0 ? 0 : NaN, p80: m === 0 ? 0 : NaN, p95: m === 0 ? 0 : NaN },
      mean: m === 0 ? 0 : NaN,
      backlog: m,
      daily_throughput_samples: daily.length,
      daysSamplesSorted: new Float64Array(0),
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
    daysSamplesSorted: sorted,
    runs,
    seed,
    confidence,
    source: 'throughput-mc',
  };
}

// ── 通道 B：RCPSP-in-trial MC（资源约束调度·真吃 wip_limit·issue #149 契约 §6.1 B·deadline verdict 唯一源）──
// 每 trial 内跑 serial SGS（串行调度生成式）注 wip 资源约束 → resource-feasible finish 分布，回答「真实 WIP
//   并发下多久完成」——不同于 precedence-only（无资源闸·乐观下界）与 throughput（历史吞吐·不调度 DAG）。
//
// 性能（契约风险 top1·D3A latency spike 实测）：**必须堆化**（indeg-ready min-heap + slot min-heap·O(V log V)/
//   trial）。naive 逐 trial filter-ready（rcpsp.ts 的 O(V²) 结构）在 283 任务真实板 2000 trials 要 ~30s 爆预算；
//   堆化后同板仅 ~450ms。静态优先级（min-slack + LFT + id·来自确定性 CPM）循环外算一次。
//
// 资源槽语义 faithful to rcpsp.ts：slots.size < wip 开新槽，满则复用最早释放的槽（busy[] 逐字对应）。
// 确定性：独立 seed 派生（seed ^ 0x51ed270b·避免与通道①共相）；Float64Array.sort() V8 确定。

// 二叉最小堆（RCPSP-in-trial 的 ready 队列 + 资源槽·数值 payload·comparator 注入）。
class NumMinHeap {
  private a: number[] = [];
  private lt: (x: number, y: number) => boolean;
  constructor(lessThan: (x: number, y: number) => boolean) {
    this.lt = lessThan;
  }
  get size(): number {
    return this.a.length;
  }
  push(x: number): void {
    const a = this.a;
    a.push(x);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.lt(a[i] as number, a[p] as number)) {
        const tmp = a[i] as number;
        a[i] = a[p] as number;
        a[p] = tmp;
        i = p;
      } else break;
    }
  }
  pop(): number {
    const a = this.a;
    const top = a[0] as number;
    const last = a.pop() as number;
    if (a.length) {
      a[0] = last;
      let i = 0;
      const n = a.length;
      for (;;) {
        let s = i;
        const l = 2 * i + 1;
        const r = 2 * i + 2;
        if (l < n && this.lt(a[l] as number, a[s] as number)) s = l;
        if (r < n && this.lt(a[r] as number, a[s] as number)) s = r;
        if (s === i) break;
        const tmp = a[i] as number;
        a[i] = a[s] as number;
        a[s] = tmp;
        i = s;
      }
    }
    return top;
  }
}

export interface RcpspInTrialOptions extends ForecastOptions {
  wip?: number; // 资源上限 k（缺 / ≤0 → ∞·无资源闸）
}

export interface RcpspInTrialResult {
  makespan: Interval; // resource-feasible makespan {p50,p80,p95}（小时）
  mean: number;
  makespanSamplesSorted: Float64Array; // 升序·喂 empiricalCdfAtOrBefore 出 on_time_probability
  runs: number;
  seed: number;
  wip: number; // 资源上限（∞ = Infinity）
  node_count: number;
  cycle: boolean;
  source: 'rcpsp-in-trial-mc';
}

// rcpspInTrialMc(board, params, opts) → 资源约束 MC。含环 / 空图 → 退化空结果（node_count=0·NaN 分位·不抛）。
export function rcpspInTrialMc(
  board: BoardLike,
  params: Map<string, NodeMcParam>,
  opts: RcpspInTrialOptions = {},
): RcpspInTrialResult {
  const seed = opts.seed ?? 42;
  const runs = Math.max(1, opts.runs ?? 2000);
  const defaultCv = opts.defaultCv ?? 0.4;
  const defaultMean = opts.defaultMeanHours ?? 1;
  const wip = opts.wip != null && opts.wip > 0 ? opts.wip : Number.POSITIVE_INFINITY;
  const g = analyzeGraph(board);
  const { order, cycle } = g.topoSort();
  const nodeCount = order.length;

  if (cycle || nodeCount === 0) {
    return {
      makespan: { p50: NaN, p80: NaN, p95: NaN },
      mean: NaN,
      makespanSamplesSorted: new Float64Array(0),
      runs,
      seed,
      wip,
      node_count: 0,
      cycle: !!cycle,
      source: 'rcpsp-in-trial-mc',
    };
  }

  // 索引化（拓扑序·pred/succ 下标邻接·入度）。
  const idx = new Map<string, number>();
  for (let i = 0; i < nodeCount; i++) idx.set(order[i] as string, i);
  const predIdx: number[][] = order.map((id) =>
    g
      .predecessors(id)
      .map((p) => idx.get(p))
      .filter((x): x is number => x !== undefined),
  );
  const succIdx: number[][] = order.map(() => []);
  for (let i = 0; i < nodeCount; i++)
    for (const p of predIdx[i] as number[]) (succIdx[p] as number[]).push(i);
  const indeg0 = new Int32Array(nodeCount);
  for (let i = 0; i < nodeCount; i++) indeg0[i] = (predIdx[i] as number[]).length;

  // 静态优先级：min-slack → LFT → id（来自确定性 CPM·循环外只算一次·faithful to rcpsp.ts 口径）。
  const cp = g.criticalPath({ now: opts.nowMs ?? Date.now() });
  const slackOf = (i: number): number => cp.schedule.get(order[i] as string)?.float ?? 0;
  const lftOf = (i: number): number =>
    cp.schedule.get(order[i] as string)?.lf ?? Number.POSITIVE_INFINITY;
  const prioOrder = Array.from({ length: nodeCount }, (_, i) => i);
  prioOrder.sort(
    (a, b) =>
      slackOf(a) - slackOf(b) ||
      lftOf(a) - lftOf(b) ||
      (order[a] as string).localeCompare(order[b] as string),
  );
  const prioRank = new Int32Array(nodeCount);
  for (let r = 0; r < nodeCount; r++) prioRank[prioOrder[r] as number] = r;

  const meanArr = new Float64Array(nodeCount);
  const cvArr = new Float64Array(nodeCount);
  for (let i = 0; i < nodeCount; i++) {
    const p = params.get(order[i] as string);
    meanArr[i] = p ? p.meanHours : defaultMean;
    cvArr[i] = p && p.cv > 0 ? p.cv : defaultCv;
  }

  const makespanSamples = new Float64Array(runs);
  const prng = new Sfc32(seed ^ 0x51ed270b); // 独立 seed 派生·避免与通道①共相
  const durTrial = new Float64Array(nodeCount);
  const finish = new Float64Array(nodeCount);
  const indeg = new Int32Array(nodeCount);

  for (let t = 0; t < runs; t++) {
    for (let i = 0; i < nodeCount; i++) {
      const m = meanArr[i] as number;
      durTrial[i] = m > 0 ? sampleTaskDuration(() => prng.next(), m, cvArr[i] as number) : 0;
      indeg[i] = indeg0[i] as number;
      finish[i] = 0;
    }
    // ready 堆：按 prioRank 升序（min = 最高优先级）。
    const ready = new NumMinHeap((x, y) => (prioRank[x] as number) < (prioRank[y] as number));
    for (let i = 0; i < nodeCount; i++) if (indeg[i] === 0) ready.push(i);
    // 资源槽：min-heap of freeAt；size<wip 开新槽，满则复用最早释放（faithful to rcpsp.ts busy[] 语义）。
    const slots = new NumMinHeap((x, y) => x < y);
    let makespan = 0;
    while (ready.size > 0) {
      const i = ready.pop();
      let rt = 0;
      for (const p of predIdx[i] as number[]) {
        const f = finish[p] as number;
        if (f > rt) rt = f;
      }
      let start: number;
      if (slots.size < wip) {
        start = rt;
        slots.push(start + (durTrial[i] as number));
      } else {
        const slotFree = slots.pop();
        start = rt > slotFree ? rt : slotFree;
        slots.push(start + (durTrial[i] as number));
      }
      const fin = start + (durTrial[i] as number);
      finish[i] = fin;
      if (fin > makespan) makespan = fin;
      for (const s of succIdx[i] as number[]) {
        indeg[s] = (indeg[s] as number) - 1;
        if (indeg[s] === 0) ready.push(s);
      }
    }
    makespanSamples[t] = makespan;
  }

  const sorted = Float64Array.from(makespanSamples);
  sorted.sort();
  let mean = 0;
  for (let t = 0; t < runs; t++) mean += makespanSamples[t] as number;
  mean /= runs;

  return {
    makespan: {
      p50: quantileFromSorted(sorted, 0.5),
      p80: quantileFromSorted(sorted, 0.8),
      p95: quantileFromSorted(sorted, 0.95),
    },
    mean,
    makespanSamplesSorted: sorted,
    runs,
    seed,
    wip,
    node_count: nodeCount,
    cycle: false,
    source: 'rcpsp-in-trial-mc',
  };
}

// ── %-cost-to-complete MC（偿付力·plan §4：复用吞吐-MC bootstrap 结构·改在「配额% 增量」上算）──────────
// 不在 **task 计数** 上算（那是吞吐-MC 的天数维），而在「每单位工作的配额% 增量」上 bootstrap：从历史
//   per-unit %-cost 样本里有放回采样 backlog 次并求和 → 清空剩余工作的**总配额%** 分布 P50/P80/P95。
//   per-unit %-cost 由调用方（handler）从「观测 burn-rate × 历史任务工期」派生（duration-grounded %-增量·
//   plan §4「每单位工作的 %-消耗·throughput 式」；token sizing 可在 handler 侧细化权重）——引擎只做 MC 结构，
//   **agnostic 于样本来源**（同 throughputMonteCarlo 吃 daily-throughput 池一样吃 %-增量池·literal 复用）。
// 配额% 是权威账本（plan §1.2）：此处算的是会真正耗尽的预算量，非 token 货币。
export interface PctCostMcResult {
  pct: Interval; // 清空 backlog 的总配额% {p50,p80,p95}（5% 硬墙·p95=0.95 分位·绝不 100%）
  mean: number;
  backlog: number; // 待清空任务数
  per_unit_samples: number; // bootstrap 池的 %-增量样本量
  runs: number;
  seed: number;
  confidence: 'high' | 'medium' | 'low';
  source: 'pct-cost-mc';
}

// pctCostToCompleteMonteCarlo(backlog, perUnitPctSamples, opts) → 总 %-cost-to-complete 分布。
//   空池 / backlog=0 → 降级（backlog=0 → 0%；池空 → NaN·confidence low）。seeded 确定性（Sfc32·独立 seed 派生）。
export function pctCostToCompleteMonteCarlo(
  backlog: number,
  perUnitPctSamples: number[],
  opts: ForecastOptions = {},
): PctCostMcResult {
  const seed = opts.seed ?? 42;
  const runs = Math.max(1, opts.runs ?? 2000);
  // 只取有限且 ≥0 的 %-增量样本（负 / NaN 噪声剔除；与吞吐池保留闲置日不同——% 增量无「闲置日」语义）。
  const pool = (Array.isArray(perUnitPctSamples) ? perUnitPctSamples : []).filter(
    (x) => Number.isFinite(x) && x >= 0,
  );
  const m = Math.max(0, Math.floor(backlog));

  if (pool.length === 0 || m === 0) {
    return {
      pct: { p50: m === 0 ? 0 : NaN, p80: m === 0 ? 0 : NaN, p95: m === 0 ? 0 : NaN },
      mean: m === 0 ? 0 : NaN,
      backlog: m,
      per_unit_samples: pool.length,
      runs,
      seed,
      confidence: 'low',
      source: 'pct-cost-mc',
    };
  }

  const prng = new Sfc32(seed ^ 0x85ebca6b); // 与通道①②不同 seed 派生·避免共相
  const samples = new Float64Array(runs);
  for (let t = 0; t < runs; t++) {
    let total = 0;
    for (let i = 0; i < m; i++) total += pool[prng.nextInt(pool.length)] as number;
    samples[t] = total;
  }
  const sorted = Float64Array.from(samples);
  sorted.sort();
  let mean = 0;
  for (let t = 0; t < runs; t++) mean += samples[t] as number;
  mean /= runs;

  const confidence: 'high' | 'medium' | 'low' =
    pool.length >= 10 ? 'high' : pool.length >= 4 ? 'medium' : 'low';

  return {
    pct: {
      p50: quantileFromSorted(sorted, 0.5),
      p80: quantileFromSorted(sorted, 0.8),
      p95: quantileFromSorted(sorted, 0.95), // 5% 硬墙
    },
    mean,
    backlog: m,
    per_unit_samples: pool.length,
    runs,
    seed,
    confidence,
    source: 'pct-cost-mc',
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
