// calibration.ts — EWMA 分层校准 + Bayesian shrinkage（≅ Reference-Class Forecasting·ADR-015 §2.4 / plan §3/§7）。
//
// 把「估值 → 实测」的系统性偏差（home-corpus act/est=1.38·planning fallacy 右偏）学成一个**校准乘子**：
//   raw estimate × multiplier ≈ 实测。这是 RCF（Flyvbjerg/Kahneman）的轻量统计落地——用一个参照类
//   （同 repo+type+executor+tier 的历史）的 act/est 分布纠正单点乐观估值。
//
// 两件事：
//   ① EWMA（指数加权移动平均）：近的历史 ratio 权重大（recency·模型/代码库会漂）。
//   ② Bayesian shrinkage：样本少时把参照类均值**向先验（1.0·无偏）收缩**，解冷启动——
//      N 小 → 收向 1.0（不敢大改估值）；N 大 → 信参照类。shrunk = (N·sampleMean + k·prior)/(N+k)。
//
// 红线1：node/JS only，零 npm dep。确定性：纯算术，无随机。
// 诚实概率化（plan §2.6）：输出带 confidence（high/medium/low）+ source + history_n；样本不足 → 退 1.0 + low。

import type { DoneRecord, PoolQuery } from '../usage/history-loader.js';
import { recencyWeight, selectPoolLayer } from '../usage/history-loader.js';

export interface CalibrationResult {
  multiplier: number; // 校准乘子（raw estimate × 此 ≈ 实测）；无数据 → 1.0
  confidence: 'high' | 'medium' | 'low';
  history_n: number; // 参照类样本数
  source: 'calibrated' | 'shrunk-to-prior' | 'no-history';
  level: string; // 命中的收缩层（repo+type+executor+tier / … / home）
  raw_mean: number | null; // 参照类的 EWMA 加权 ratio 均值（收缩前·调试用）
}

export interface CalibrationOptions {
  nowMs?: number;
  halfLifeDays?: number; // EWMA recency 半衰期（默认 30 天）
  prior?: number; // Bayesian 先验均值（默认 1.0·无偏）
  priorStrength?: number; // 收缩强度 k（等效先验样本数·默认 3）
  minN?: number; // 选层最小样本数（默认 3）
}

// hasUsableRatio(r) → 该记录能否贡献一个有效 ratio（est+actual 皆有且 ratio>0）。
//   层选择「够用」判定与 EWMA 加权都以此为准——数「可用 ratio 样本」而非原始记录数（SSOT·codex round-8 P2）。
//   type predicate：过门后把 r.ratio 收窄为 number（供 ewmaWeightedRatio 直接用，无需再判 null）。
function hasUsableRatio(r: DoneRecord): r is DoneRecord & { ratio: number } {
  return r.ratio != null && r.ratio > 0;
}

// ewmaWeightedRatio(records, nowMs, halfLifeDays) → { mean, n }。
//   按 recency 权重对各 record.ratio 加权平均（只计有 ratio 的记录）。无有效记录 → { mean:null, n:0 }。
function ewmaWeightedRatio(
  records: DoneRecord[],
  nowMs: number,
  halfLifeDays: number,
): { mean: number | null; n: number } {
  let wsum = 0;
  let vsum = 0;
  let n = 0;
  for (const r of records) {
    if (!hasUsableRatio(r)) continue;
    const w = recencyWeight(r, nowMs, halfLifeDays);
    wsum += w;
    vsum += w * r.ratio;
    n += 1;
  }
  if (n === 0 || wsum === 0) return { mean: null, n: 0 };
  return { mean: vsum / wsum, n };
}

// calibrate(records, query, opts) → 一个参照类的校准乘子（含收缩 + 诚实标注）。
//   流程：① 选 N≥minN 的最具体收缩层 → ② 该层 EWMA 加权 ratio 均值 → ③ 向 prior Bayesian 收缩。
export function calibrate(
  records: DoneRecord[],
  query: PoolQuery,
  opts: CalibrationOptions = {},
): CalibrationResult {
  const nowMs = opts.nowMs ?? Date.now();
  const halfLifeDays = opts.halfLifeDays ?? 30;
  const prior = opts.prior ?? 1.0;
  const k = opts.priorStrength ?? 3;
  const minN = opts.minN ?? 3;

  // 选层按「可用 ratio 样本数」判够用：最具体层记录虽多但 ratio 全缺时下沉到更宽层（codex round-8 P2）。
  const { layer, confidence } = selectPoolLayer(records, query, minN, hasUsableRatio);
  const { mean, n } = ewmaWeightedRatio(layer.records, nowMs, halfLifeDays);

  if (mean == null || n === 0) {
    // 参照类无可用 ratio → 退无偏先验 + no-history。
    return {
      multiplier: prior,
      confidence: 'low',
      history_n: 0,
      source: 'no-history',
      level: layer.level,
      raw_mean: null,
    };
  }

  // Bayesian shrinkage：shrunk = (n·sampleMean + k·prior)/(n+k)。n 大 → 信样本；n 小 → 收向 prior。
  const multiplier = (n * mean + k * prior) / (n + k);
  // source：n 远超 k → 真校准；n 与 k 同量级 → 仍明显被先验收缩。
  const source: CalibrationResult['source'] = n >= 2 * k ? 'calibrated' : 'shrunk-to-prior';
  return {
    multiplier,
    confidence,
    history_n: n,
    source,
    level: layer.level,
    raw_mean: mean,
  };
}

// calibratedEstimate(rawHours, cal) → 校准后的点估时长（rawHours × multiplier）。
//   rawHours 缺/坏（null）→ null（调用方降级 throughput / unit）。
export function calibratedEstimate(rawHours: number | null, cal: CalibrationResult): number | null {
  if (rawHours == null || !(rawHours > 0)) return null;
  return rawHours * cal.multiplier;
}

// dispersionCv(records, query, opts) → 参照类 ratio 的变异系数（stddev/mean·喂 sampling 的 cv）。
//   反映该参照类历史的离散度（右偏越重 cv 越大 → MC 区间越宽·诚实）。样本<2 → 默认 cv（调用方给 fallback）。
export function dispersionCv(
  records: DoneRecord[],
  query: PoolQuery,
  opts: CalibrationOptions = {},
  fallbackCv = 0.4,
): number {
  const minN = opts.minN ?? 3;
  // 同 calibrate：按可用 ratio 样本数选层，最具体层 ratio 全缺时下沉更宽层（codex round-8 P2）。
  const { layer } = selectPoolLayer(records, query, minN, hasUsableRatio);
  const ratios = layer.records.map((r) => r.ratio).filter((x): x is number => x != null && x > 0);
  if (ratios.length < 2) return fallbackCv;
  const mean = ratios.reduce((s, v) => s + v, 0) / ratios.length;
  if (!(mean > 0)) return fallbackCv;
  const variance = ratios.reduce((s, v) => s + (v - mean) * (v - mean), 0) / (ratios.length - 1);
  const cv = Math.sqrt(variance) / mean;
  return cv > 0 ? cv : fallbackCv;
}
