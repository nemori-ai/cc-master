// conformal.ts — 诚实区间（split conformal + Mondrian 分组·ADR-015 §2.4 / plan §3/§7）。
//
// 给点估配一个**有覆盖保证**的区间，而非假精确点估。conformal prediction（Vovk 2003 Mondrian·
//   Angelopoulos & Bates 2022）：用一组「校准残差」的经验分位当区间半径——名义 95% 区间 ≈ 真覆盖 95%，
//   **无分布假设**（不假设 normal/log-normal）。这是 plan §2.6「诚实概率化 + 5% 硬墙」的统计骨架。
//
// Mondrian 分组（plan §3）：不混一个全局阈值，而是**按 type/executor 各取 α-分位**——条件覆盖更诚实
//   （development 任务的不确定性 ≠ design 任务的）。组内样本不足 → 退全局组 + 标低置信。
//
// 5% 硬墙（plan §2.6）：p95 = 95% 分位，**绝不算到 100%**（真上限是 session hard-stop·不是预测能给的）。
//
// 红线1：node/JS only，零 npm dep。确定性：纯排序 + 索引取分位（Float64Array.sort V8 确定·plan §7）。

import type { DoneRecord } from '../usage/history-loader.js';

// 经验分位（type-7 线性插值·numpy 默认口径）。sorted = 升序 Float64Array；p∈[0,1]。
//   空数组 → NaN（调用方据此降级）。
export function empiricalQuantile(sorted: Float64Array, p: number): number {
  const n = sorted.length;
  if (n === 0) return NaN;
  if (n === 1) return sorted[0] as number;
  const clamped = p < 0 ? 0 : p > 1 ? 1 : p;
  const idx = clamped * (n - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  const frac = idx - lo;
  return (sorted[lo] as number) * (1 - frac) + (sorted[hi] as number) * frac;
}

// 诚实区间三件套（5% 硬墙·p95 永远是上界·绝不 100%）。
export interface Interval {
  p50: number;
  p80: number;
  p95: number;
}

// quantilesOf(values) → 从一组样本直接取 {p50,p80,p95}（经验分位）。空 → 全 NaN。
export function quantilesOf(values: number[]): Interval {
  const arr = Float64Array.from(values.filter((v) => Number.isFinite(v)));
  arr.sort();
  return {
    p50: empiricalQuantile(arr, 0.5),
    p80: empiricalQuantile(arr, 0.8),
    p95: empiricalQuantile(arr, 0.95), // 5% 硬墙：永远 0.95，绝不 1.0
  };
}

// conformalGroupKey(record, dim) → Mondrian 分组键（按 type / executor / type+executor）。
export type MondrianDim = 'type' | 'executor' | 'type+executor';
export function conformalGroupKey(
  rec: { type?: string; executor?: string },
  dim: MondrianDim,
): string {
  if (dim === 'type') return rec.type ?? '';
  if (dim === 'executor') return rec.executor ?? '';
  return `${rec.type ?? ''}|${rec.executor ?? ''}`;
}

// calibrationResiduals(records) → 校准集的「相对残差」= actual/estimate 的 ratio（>0）。
//   conformal 用 ratio 当 nonconformity score——预测时把点估 × ratio 分位得区间（乘性·适配右偏工期）。
function relativeResiduals(records: DoneRecord[]): number[] {
  const out: number[] = [];
  for (const r of records) {
    if (r.ratio != null && r.ratio > 0) out.push(r.ratio);
  }
  return out;
}

// conformalInterval(pointEstimate, records, opts) → 乘性 conformal 区间（点估 × ratio 分位）。
//   组内（Mondrian）样本 ≥ minGroupN → 用组残差；否则退全局残差 + 标低置信（plan §3 降级）。
//   p50/p80/p95 = 点估 × ratio 的 {0.5, 0.8, 0.95} 分位（5% 硬墙）。无任何残差 → 退点估本身（区间塌成点）+ no-history。
export interface ConformalOptions {
  dim?: MondrianDim; // Mondrian 维度（默认 type）
  group?: { type?: string; executor?: string }; // 待预测任务的分组特征
  minGroupN?: number; // 组内最小样本（默认 5）
}
export interface ConformalResult extends Interval {
  confidence: 'high' | 'medium' | 'low';
  coverage_basis: 'mondrian-group' | 'global' | 'no-history';
  history_n: number;
  group_key: string;
}
export function conformalInterval(
  pointEstimate: number,
  records: DoneRecord[],
  opts: ConformalOptions = {},
): ConformalResult {
  const dim = opts.dim ?? 'type';
  const minGroupN = opts.minGroupN ?? 5;
  const groupKey = opts.group ? conformalGroupKey(opts.group, dim) : '';

  const globalRes = relativeResiduals(records);
  let res = globalRes;
  let basis: ConformalResult['coverage_basis'] = 'global';
  let confidence: ConformalResult['confidence'] = 'medium';

  if (groupKey) {
    const groupRecords = records.filter((r) => conformalGroupKey(r, dim) === groupKey);
    const groupRes = relativeResiduals(groupRecords);
    if (groupRes.length >= minGroupN) {
      res = groupRes;
      basis = 'mondrian-group';
      confidence = 'high';
    } else {
      confidence = 'low'; // 组内不足 → 退全局 + 低置信（条件覆盖弱）
    }
  }

  if (res.length === 0) {
    // 全无残差 → 区间塌成点估本身（诚实：无历史不假精确）。
    return {
      p50: pointEstimate,
      p80: pointEstimate,
      p95: pointEstimate,
      confidence: 'low',
      coverage_basis: 'no-history',
      history_n: 0,
      group_key: groupKey,
    };
  }
  if (basis === 'global' && res.length < minGroupN) confidence = 'low';

  const q = quantilesOf(res);
  return {
    p50: pointEstimate * q.p50,
    p80: pointEstimate * q.p80,
    p95: pointEstimate * q.p95, // 5% 硬墙
    confidence,
    coverage_basis: basis,
    history_n: res.length,
    group_key: groupKey,
  };
}

// empiricalCoverage(records, opts) → 用 LOO（留一）估算名义 95% 区间的真覆盖率（喂 property 测试）。
//   对每条有 ratio 的记录，用**其余记录**的残差 0.95 分位当上界，看该记录 ratio 是否 ≤ 上界，统计命中比例。
//   返回 { coverage, n }；理想 ≈ 0.95（±采样误差）。这是「conformal 覆盖率 ≈ 名义」property 断言的算子。
export function empiricalCoverage(
  records: DoneRecord[],
  nominal = 0.95,
): { coverage: number; n: number } {
  const withRatio = records.filter((r) => r.ratio != null && r.ratio > 0) as Array<
    DoneRecord & { ratio: number }
  >;
  const n = withRatio.length;
  if (n < 2) return { coverage: NaN, n };
  let hit = 0;
  for (let i = 0; i < n; i++) {
    const rest: number[] = [];
    for (let j = 0; j < n; j++) {
      const rec = withRatio[j];
      if (j !== i && rec) rest.push(rec.ratio);
    }
    const arr = Float64Array.from(rest);
    arr.sort();
    const upper = empiricalQuantile(arr, nominal);
    const target = withRatio[i] as { ratio: number };
    if (target.ratio <= upper) hit += 1;
  }
  return { coverage: hit / n, n };
}
