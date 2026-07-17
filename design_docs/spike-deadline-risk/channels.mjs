// channels.mjs — 三通道 Monte Carlo（deadline-risk 的算法心脏·D3A spike 载重）。
//
// 通道 A  precedence-only MC     —— 从 mc-scheduler.ts estimateDagMonteCarlo 移植 + 补经验 CDF/on-time。
// 通道 B  RCPSP-in-trial MC      —— **新算法**：每 trial 内跑 serial SGS 注 wip_limit 资源约束（契约 §6.1 B）。
// 通道 C  throughput MC          —— 从 mc-scheduler.ts throughputMonteCarlo 移植 + 补经验 CDF/on-time。
//
// 引擎缺口补齐（契约 §4.3 载重）：现有 MC 只回分位、算完 makespanSamples 就丢。本文件把「样本」升为一等，
//   暴露 `empiricalCdfAtOrBefore(sorted, target)` → 出 `on_time_probability = P(finish <= DDL)`。
//   D3B 移植：给 estimateDagMonteCarlo/throughputMonteCarlo 加可选 `target` 直接返回 on_time_probability，
//   或导出 empiricalCdfAtOrBefore helper 供两通道复用（推荐后者·最小·seeded·确定性·零算法重写）。
//
// 确定性：入口收 seed，每通道 new Sfc32(派生 seed)；Float64Array.sort() V8 确定。绝不 Math.random()。

import { analyzeGraph } from './graph.mjs';
import { Sfc32 } from './prng.mjs';
import { sampleTaskDuration } from './sampling.mjs';

// ── 分位 + 经验 CDF（契约要求的 helper）─────────────────────────────────────────────────────────
export function quantileFromSorted(sorted, p) {
  const n = sorted.length;
  if (n === 0) return NaN;
  if (n === 1) return sorted[0];
  const idx = (p < 0 ? 0 : p > 1 ? 1 : p) * (n - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  const frac = idx - lo;
  return sorted[lo] * (1 - frac) + sorted[hi] * frac;
}

// empiricalCdfAtOrBefore(sortedSamples, target) → ≤ target 的样本占比 ∈ [0,1]（经验 CDF·on-time 概率）。
//   二分找「第一个 > target 的下标」= ≤ target 的计数。sorted 必须升序。空/NaN target → NaN（诚实降级）。
export function empiricalCdfAtOrBefore(sortedSamples, target) {
  const n = sortedSamples.length;
  if (n === 0 || !Number.isFinite(target)) return NaN;
  // 二分：找 > target 的第一个位置（upper_bound）。
  let lo = 0, hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sortedSamples[mid] <= target) lo = mid + 1;
    else hi = mid;
  }
  return lo / n; // lo = ≤target 的数量
}

// ── 二叉最小堆（RCPSP-in-trial 的 ready 队列 + 资源槽）────────────────────────────────────────────
class MinHeap {
  constructor(lessThan) { this.a = []; this.lt = lessThan; }
  get size() { return this.a.length; }
  push(x) {
    const a = this.a; a.push(x);
    let i = a.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (this.lt(a[i], a[p])) { [a[i], a[p]] = [a[p], a[i]]; i = p; } else break; }
  }
  pop() {
    const a = this.a; const top = a[0]; const last = a.pop();
    if (a.length) { a[0] = last; let i = 0; const n = a.length;
      for (;;) { let s = i; const l = 2 * i + 1, r = 2 * i + 2;
        if (l < n && this.lt(a[l], a[s])) s = l;
        if (r < n && this.lt(a[r], a[s])) s = r;
        if (s === i) break; [a[i], a[s]] = [a[s], a[i]]; i = s; } }
    return top;
  }
  peek() { return this.a[0]; }
}

// ── 通道 A：precedence-only MC（乐观下界·无资源闸·forward pass）────────────────────────────────────
// 返回：{ makespanSamplesSorted, on_time_probability(target), makespan{p50,p80,p95}, criticality_index, ... }。
export function precedenceOnlyMc(board, params, opts = {}) {
  const seed = opts.seed ?? 42;
  const runs = Math.max(1, opts.runs ?? 2000);
  const defaultCv = opts.defaultCv ?? 0.4;
  const defaultMean = opts.defaultMeanHours ?? 1;
  const g = analyzeGraph(board);
  const { order, cycle } = g.topoSort();
  const ids = order;
  const nodeCount = ids.length;

  if (cycle || nodeCount === 0) {
    return {
      channel: 'precedence-only', node_count: 0, cycle: !!cycle, runs, seed,
      makespanSamplesSorted: new Float64Array(0),
      makespan: { p50: NaN, p80: NaN, p95: NaN }, mean: NaN, criticality_index: [],
      onTime: () => NaN,
    };
  }

  const prng = new Sfc32(seed);
  const idx = new Map();
  for (let i = 0; i < ids.length; i++) idx.set(ids[i], i);
  const upstreamIdx = ids.map((id) => g.predecessors(id).map((p) => idx.get(p)).filter((x) => x !== undefined));
  const meanArr = new Float64Array(nodeCount);
  const cvArr = new Float64Array(nodeCount);
  for (let i = 0; i < nodeCount; i++) {
    const p = params.get(ids[i]);
    meanArr[i] = p ? p.meanHours : defaultMean;
    cvArr[i] = p && p.cv > 0 ? p.cv : defaultCv;
  }

  const makespanSamples = new Float64Array(runs);
  const durSamples = ids.map(() => new Float64Array(runs));
  const critCount = new Float64Array(nodeCount);
  const ef = new Float64Array(nodeCount);
  const es = new Float64Array(nodeCount);

  for (let t = 0; t < runs; t++) {
    let makespan = 0, sinkIdx = 0;
    for (let i = 0; i < nodeCount; i++) {
      const mean = meanArr[i];
      const dur = mean > 0 ? sampleTaskDuration(() => prng.next(), mean, cvArr[i]) : 0;
      durSamples[i][t] = dur;
      let start = 0;
      for (const u of upstreamIdx[i]) { const uef = ef[u]; if (uef > start) start = uef; }
      es[i] = start;
      const e = start + dur;
      ef[i] = e;
      if (e > makespan) { makespan = e; sinkIdx = i; }
    }
    makespanSamples[t] = makespan;
    // CI：sink 反向沿 binding 边。
    let cur = sinkIdx;
    const guard = new Set();
    const EPS = 1e-9;
    while (cur >= 0 && !guard.has(cur)) {
      guard.add(cur);
      critCount[cur] += 1;
      const myEs = es[cur];
      let pick = -1;
      for (const u of upstreamIdx[cur]) { if (Math.abs(ef[u] - myEs) < EPS) { pick = u; break; } }
      cur = pick;
    }
  }

  const sorted = Float64Array.from(makespanSamples); sorted.sort();
  const projStd = stddev(makespanSamples);
  let meanMakespan = 0; for (let t = 0; t < runs; t++) meanMakespan += makespanSamples[t]; meanMakespan /= runs;

  const sens = ids.map((id, i) => {
    const ci = critCount[i] / runs;
    const cri = pearson(durSamples[i], makespanSamples);
    const nodeStd = stddev(durSamples[i]);
    const ssi = projStd > 0 ? ci * (nodeStd / projStd) : 0;
    return { id, criticality: ci, cruciality: cri, sensitivity: ssi };
  });
  sens.sort((a, b) => b.criticality - a.criticality || a.id.localeCompare(b.id));

  return {
    channel: 'precedence-only', node_count: nodeCount, cycle: false, runs, seed,
    makespanSamplesSorted: sorted,
    makespan: { p50: quantileFromSorted(sorted, 0.5), p80: quantileFromSorted(sorted, 0.8), p95: quantileFromSorted(sorted, 0.95) },
    mean: meanMakespan,
    criticality_index: sens,
    onTime: (targetHours) => empiricalCdfAtOrBefore(sorted, targetHours),
  };
}

// ── 通道 B：RCPSP-in-trial MC（**新**·每 trial serial SGS 注 wip 资源约束）────────────────────────────
// 结构：静态优先级（min-slack + LFT + id·来自确定性 CPM·循环外算一次）→ 每 trial 采样时长跑 serial SGS
//   （k 机器槽模型·堆化 O(V log V)/trial）→ resource-feasible finish 分布。
// 性能：优先级排序 + 拓扑 + CPM 在循环外只算一次；每 trial 用 indeg-ready-heap + slot-heap，杜绝 O(V²) filter。
export function rcpspInTrialMc(board, params, opts = {}) {
  const seed = opts.seed ?? 42;
  const runs = Math.max(1, opts.runs ?? 2000);
  const defaultCv = opts.defaultCv ?? 0.4;
  const defaultMean = opts.defaultMeanHours ?? 1;
  const wip = opts.wip != null && opts.wip > 0 ? opts.wip : Infinity;
  const g = analyzeGraph(board);
  const { order, cycle } = g.topoSort();
  const nodeCount = order.length;

  if (cycle || nodeCount === 0) {
    return {
      channel: 'rcpsp-in-trial', node_count: 0, cycle: !!cycle, runs, seed, wip,
      makespanSamplesSorted: new Float64Array(0),
      makespan: { p50: NaN, p80: NaN, p95: NaN }, mean: NaN,
      onTime: () => NaN,
    };
  }

  // 索引化。
  const idx = new Map();
  for (let i = 0; i < nodeCount; i++) idx.set(order[i], i);
  const predIdx = order.map((id) => g.predecessors(id).map((p) => idx.get(p)).filter((x) => x !== undefined));
  const succIdx = order.map(() => []);
  for (let i = 0; i < nodeCount; i++) for (const p of predIdx[i]) succIdx[p].push(i);
  const indeg0 = new Int32Array(nodeCount);
  for (let i = 0; i < nodeCount; i++) indeg0[i] = predIdx[i].length;

  // 静态优先级：min-slack → LFT → id（来自确定性 CPM·循环外一次）。
  const cp = g.criticalPath({ now: opts.nowMs ?? Date.now() });
  const slackOf = (i) => cp.schedule.get(order[i])?.float ?? 0;
  const lftOf = (i) => cp.schedule.get(order[i])?.lf ?? Infinity;
  const prioOrder = Array.from({ length: nodeCount }, (_, i) => i);
  prioOrder.sort((a, b) => (slackOf(a) - slackOf(b)) || (lftOf(a) - lftOf(b)) || order[a].localeCompare(order[b]));
  const prioRank = new Int32Array(nodeCount);
  for (let r = 0; r < nodeCount; r++) prioRank[prioOrder[r]] = r;

  const meanArr = new Float64Array(nodeCount);
  const cvArr = new Float64Array(nodeCount);
  for (let i = 0; i < nodeCount; i++) {
    const p = params.get(order[i]);
    meanArr[i] = p ? p.meanHours : defaultMean;
    cvArr[i] = p && p.cv > 0 ? p.cv : defaultCv;
  }

  const makespanSamples = new Float64Array(runs);
  const prng = new Sfc32(seed ^ 0x51ed270b); // 独立 seed 派生·避免与通道 A 共相
  const durTrial = new Float64Array(nodeCount);
  const finish = new Float64Array(nodeCount);
  const indeg = new Int32Array(nodeCount);

  for (let t = 0; t < runs; t++) {
    for (let i = 0; i < nodeCount; i++) {
      const m = meanArr[i];
      durTrial[i] = m > 0 ? sampleTaskDuration(() => prng.next(), m, cvArr[i]) : 0;
      indeg[i] = indeg0[i];
      finish[i] = 0;
    }
    // ready 堆：按 prioRank 升序（min = 最高优先级）。
    const ready = new MinHeap((x, y) => prioRank[x] < prioRank[y]);
    for (let i = 0; i < nodeCount; i++) if (indeg[i] === 0) ready.push(i);
    // 资源槽：min-heap of freeAt；size<wip 开新槽，满则复用最早释放（faithful to rcpsp.ts busy[] 语义）。
    const slots = new MinHeap((x, y) => x < y);
    let makespan = 0;
    let placed = 0;
    while (ready.size > 0) {
      const i = ready.pop();
      let rt = 0;
      for (const p of predIdx[i]) { const f = finish[p]; if (f > rt) rt = f; }
      let start;
      if (slots.size < wip) { start = rt; slots.push(start + durTrial[i]); }
      else { const slotFree = slots.pop(); start = rt > slotFree ? rt : slotFree; slots.push(start + durTrial[i]); }
      const fin = start + durTrial[i];
      finish[i] = fin;
      if (fin > makespan) makespan = fin;
      placed++;
      for (const s of succIdx[i]) { if (--indeg[s] === 0) ready.push(s); }
    }
    makespanSamples[t] = makespan;
  }

  const sorted = Float64Array.from(makespanSamples); sorted.sort();
  let mean = 0; for (let t = 0; t < runs; t++) mean += makespanSamples[t]; mean /= runs;

  return {
    channel: 'rcpsp-in-trial', node_count: nodeCount, cycle: false, runs, seed, wip,
    makespanSamplesSorted: sorted,
    makespan: { p50: quantileFromSorted(sorted, 0.5), p80: quantileFromSorted(sorted, 0.8), p95: quantileFromSorted(sorted, 0.95) },
    mean,
    onTime: (targetHours) => empiricalCdfAtOrBefore(sorted, targetHours),
  };
}

// 参考基线：naive RCPSP-in-trial（逐 trial filter 重算 ready 集·mirrors rcpsp.ts 的 O(V²) 结构）。
//   只为 latency-bench 量化「契约风险 top1 的朴素实现代价」对比堆化版；生产不用。
export function rcpspInTrialMcNaive(board, params, opts = {}) {
  const seed = opts.seed ?? 42;
  const runs = Math.max(1, opts.runs ?? 2000);
  const defaultCv = opts.defaultCv ?? 0.4;
  const defaultMean = opts.defaultMeanHours ?? 1;
  const wip = opts.wip != null && opts.wip > 0 ? opts.wip : Infinity;
  const g = analyzeGraph(board);
  const { order, cycle } = g.topoSort();
  const total = order.length;
  if (cycle || total === 0) return { makespanSamplesSorted: new Float64Array(0), makespan: { p50: NaN, p80: NaN, p95: NaN } };
  const cp = g.criticalPath({ now: opts.nowMs ?? Date.now() });
  const slackOf = (id) => cp.schedule.get(id)?.float ?? 0;
  const lftOf = (id) => cp.schedule.get(id)?.lf ?? Infinity;
  const preds = new Map();
  for (const id of order) preds.set(id, g.predecessors(id));
  const meanOf = new Map(), cvOf = new Map();
  for (const id of order) { const p = params.get(id); meanOf.set(id, p ? p.meanHours : defaultMean); cvOf.set(id, p && p.cv > 0 ? p.cv : defaultCv); }
  const prng = new Sfc32(seed ^ 0x51ed270b);
  const makespanSamples = new Float64Array(runs);
  for (let t = 0; t < runs; t++) {
    const durOf = new Map();
    for (const id of order) { const m = meanOf.get(id); durOf.set(id, m > 0 ? sampleTaskDuration(() => prng.next(), m, cvOf.get(id)) : 0); }
    const finish = new Map(), scheduled = new Set();
    const busy = [];
    let safety = total * (Number.isFinite(wip) ? 2 : 1) + total + 5;
    while (scheduled.size < total && safety-- > 0) {
      const ready = order.filter((id) => !scheduled.has(id) && preds.get(id).every((p) => scheduled.has(p)));
      if (ready.length === 0) break;
      ready.sort((a, b) => slackOf(a) - slackOf(b) || lftOf(a) - lftOf(b) || a.localeCompare(b));
      const id = ready[0];
      let rt = 0; for (const p of preds.get(id)) rt = Math.max(rt, finish.get(p) ?? 0);
      let startTime;
      if (busy.length < wip) { startTime = rt; busy.push(rt + durOf.get(id)); }
      else { let mi = 0; for (let i = 1; i < busy.length; i++) if (busy[i] < busy[mi]) mi = i; startTime = Math.max(rt, busy[mi]); busy[mi] = startTime + durOf.get(id); }
      finish.set(id, startTime + durOf.get(id));
      scheduled.add(id);
    }
    let mk = 0; for (const f of finish.values()) if (f > mk) mk = f;
    makespanSamples[t] = mk;
  }
  const sorted = Float64Array.from(makespanSamples); sorted.sort();
  return { makespanSamplesSorted: sorted, makespan: { p50: quantileFromSorted(sorted, 0.5), p80: quantileFromSorted(sorted, 0.8), p95: quantileFromSorted(sorted, 0.95) } };
}

// ── 通道 C：throughput MC（#NoEstimates·从 mc-scheduler.ts 移植 + 补经验 CDF/on-time）──────────────────
// dailyThroughput(records) → done 按完成日分桶·回 first→last **整段**每日完成数（含闲置日=0·防高估）。
export function dailyThroughput(records) {
  const byDay = new Map();
  let minMs = Infinity, maxMs = -Infinity;
  for (const r of records) {
    if (r.finishedAtMs == null) continue;
    const day = new Date(r.finishedAtMs).toISOString().slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + 1);
    if (r.finishedAtMs < minMs) minMs = r.finishedAtMs;
    if (r.finishedAtMs > maxMs) maxMs = r.finishedAtMs;
  }
  if (byDay.size === 0) return [];
  const DAY_MS = 86400000;
  const firstDayMs = Date.parse(`${new Date(minMs).toISOString().slice(0, 10)}T00:00:00Z`);
  const lastDayMs = Date.parse(`${new Date(maxMs).toISOString().slice(0, 10)}T00:00:00Z`);
  const out = [];
  for (let d = firstDayMs; d <= lastDayMs; d += DAY_MS) {
    const key = new Date(d).toISOString().slice(0, 10);
    out.push(byDay.get(key) ?? 0);
  }
  return out;
}

export function throughputMc(backlog, records, opts = {}) {
  const seed = opts.seed ?? 42;
  const runs = Math.max(1, opts.runs ?? 2000);
  const daily = dailyThroughput(records);
  const m = Math.max(0, Math.floor(backlog));
  if (daily.length === 0 || m === 0) {
    return {
      channel: 'throughput', backlog: m, daily_throughput_samples: daily.length, runs, seed,
      daysSamplesSorted: new Float64Array(0),
      days: { p50: m === 0 ? 0 : NaN, p80: m === 0 ? 0 : NaN, p95: m === 0 ? 0 : NaN }, mean: m === 0 ? 0 : NaN,
      confidence: 'low', onTime: () => (m === 0 ? 1 : NaN),
    };
  }
  const prng = new Sfc32(seed ^ 0x9e3779b9);
  const daysSamples = new Float64Array(runs);
  for (let t = 0; t < runs; t++) {
    let remaining = m, days = 0;
    const cap = m * 1000 + 1000;
    while (remaining > 0 && days < cap) { remaining -= daily[prng.nextInt(daily.length)]; days += 1; }
    daysSamples[t] = days;
  }
  const sorted = Float64Array.from(daysSamples); sorted.sort();
  let mean = 0; for (let t = 0; t < runs; t++) mean += daysSamples[t]; mean /= runs;
  const confidence = daily.length >= 10 ? 'high' : daily.length >= 4 ? 'medium' : 'low';
  return {
    channel: 'throughput', backlog: m, daily_throughput_samples: daily.length, runs, seed,
    daysSamplesSorted: sorted,
    days: { p50: quantileFromSorted(sorted, 0.5), p80: quantileFromSorted(sorted, 0.8), p95: quantileFromSorted(sorted, 0.95) },
    mean, confidence,
    onTime: (targetDays) => empiricalCdfAtOrBefore(sorted, targetDays),
  };
}

// ── 统计 helpers（从 mc-scheduler.ts 移植）───────────────────────────────────────────────────────
function pearson(x, y) {
  const n = x.length;
  if (n < 2) return 0;
  let mx = 0, my = 0;
  for (let i = 0; i < n; i++) { mx += x[i]; my += y[i]; }
  mx /= n; my /= n;
  let cov = 0, vx = 0, vy = 0;
  for (let i = 0; i < n; i++) { const dx = x[i] - mx, dy = y[i] - my; cov += dx * dy; vx += dx * dx; vy += dy * dy; }
  if (vx <= 0 || vy <= 0) return 0;
  return cov / Math.sqrt(vx * vy);
}
function stddev(arr) {
  const n = arr.length;
  if (n < 2) return 0;
  let m = 0; for (let i = 0; i < n; i++) m += arr[i]; m /= n;
  let v = 0; for (let i = 0; i < n; i++) { const d = arr[i] - m; v += d * d; }
  return Math.sqrt(v / (n - 1));
}
