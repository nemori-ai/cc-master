// knn.ts — k-NN 案例推理（线性扫·ADR-015 §2.4 / plan §3/§7）。
//
// 「类似过去任务花了多久 / 烧多少 token」——找历史里**最像**待估任务的 k 个案例，加权平均它们的
//   实测当预测。小数据最优（plan §11：k-NN/EWMA+Bayesian 小数据最优）；N<500 线性扫够，无需 KD-tree。
//
// 距离把多层收缩的直觉编进权重（plan §4「k-NN 距离把 repo-match + recency 编进权重」）：
//   · 类别特征（repo/type/executor/tier/model）不匹配 → 加距离惩罚（repo 失配惩罚最重）。
//   · 数值特征（depsCount、estimateHours）→ 归一化欧氏。
//   · recency → 近的案例额外加权（远的衰减）。
//
// 红线1：node/JS only，零 npm dep。确定性：纯算术 + 稳定排序（按距离·距离同则按 taskId 字典序）。

import type { DoneRecord } from '../usage/history-loader.js';
import { recencyWeight } from '../usage/history-loader.js';

// 待估任务的特征（与 DoneRecord 同构的查询侧）。
export interface QueryCase {
  repo?: string;
  type?: string;
  executor?: string;
  tier?: string;
  model?: string;
  depsCount?: number;
  estimateHours?: number | null;
}

export interface KnnOptions {
  k?: number; // 邻居数（默认 5）
  nowMs?: number;
  halfLifeDays?: number; // recency 权重半衰期（默认 30）
  // 类别失配惩罚（加在距离上·repo 最重）。
  repoPenalty?: number;
  typePenalty?: number;
  executorPenalty?: number;
  tierPenalty?: number;
  modelPenalty?: number;
}

const DEFAULTS = {
  k: 5,
  halfLifeDays: 30,
  repoPenalty: 2.0,
  typePenalty: 1.5,
  executorPenalty: 0.6,
  tierPenalty: 0.4,
  modelPenalty: 0.4,
};

// caseDistance(query, rec, opts) → 标量距离（越小越像）。类别惩罚 + 归一化数值差。
function caseDistance(query: QueryCase, rec: DoneRecord, opts: Required<KnnOptions>): number {
  let d = 0;
  const cmp = (qv: string | undefined, rv: string, pen: number) => {
    if (qv !== undefined && qv !== '' && qv !== rv) d += pen;
  };
  cmp(query.repo, rec.repo, opts.repoPenalty);
  cmp(query.type, rec.type, opts.typePenalty);
  cmp(query.executor, rec.executor, opts.executorPenalty);
  cmp(query.tier, rec.tier, opts.tierPenalty);
  cmp(query.model, rec.model, opts.modelPenalty);
  // 数值差（depsCount·log estimate）——log 空间避免大估值主导。
  if (query.depsCount !== undefined) {
    d += Math.abs(query.depsCount - rec.depsCount) * 0.1;
  }
  if (
    query.estimateHours != null &&
    query.estimateHours > 0 &&
    rec.estimateHours != null &&
    rec.estimateHours > 0
  ) {
    d += Math.abs(Math.log(query.estimateHours) - Math.log(rec.estimateHours)) * 0.5;
  }
  return d;
}

export interface KnnNeighbor {
  record: DoneRecord;
  distance: number;
  weight: number; // 综合权重（距离核 × recency）
}
export interface KnnResult {
  predictedHours: number | null; // 加权平均实测工期（无可用邻居 → null）
  predictedTokens: number | null; // 加权平均 token(in+out)（缺 token 的邻居不计 → 可能 null）
  neighbors: KnnNeighbor[];
  confidence: 'high' | 'medium' | 'low';
  history_n: number;
}

// knnPredict(query, records, opts) → k-NN 预测（工期 + token·加权平均）。
//   距离核 weight = 1/(1+distance)，再乘 recency 权重。confidence：邻居足且近 → high；否则降。
export function knnPredict(
  query: QueryCase,
  records: DoneRecord[],
  opts: KnnOptions = {},
): KnnResult {
  const o: Required<KnnOptions> = {
    ...DEFAULTS,
    nowMs: opts.nowMs ?? Date.now(),
    ...opts,
  } as Required<KnnOptions>;
  const k = o.k;
  // 只考虑有实测工期的案例（k-NN 要预测工期）。
  const candidates = records.filter((r) => r.actualHours != null && r.actualHours > 0);
  if (candidates.length === 0) {
    return {
      predictedHours: null,
      predictedTokens: null,
      neighbors: [],
      confidence: 'low',
      history_n: 0,
    };
  }
  const scored = candidates
    .map((rec) => ({ rec, distance: caseDistance(query, rec, o) }))
    .sort((a, b) => a.distance - b.distance || a.rec.taskId.localeCompare(b.rec.taskId));

  const top = scored.slice(0, Math.min(k, scored.length));
  const neighbors: KnnNeighbor[] = top.map(({ rec, distance }) => ({
    record: rec,
    distance,
    weight: (1 / (1 + distance)) * recencyWeight(rec, o.nowMs, o.halfLifeDays),
  }));

  // 加权平均工期。
  let wsum = 0;
  let hsum = 0;
  for (const nb of neighbors) {
    if (nb.record.actualHours == null) continue;
    wsum += nb.weight;
    hsum += nb.weight * nb.record.actualHours;
  }
  const predictedHours = wsum > 0 ? hsum / wsum : null;

  // 加权平均 token（只计有 token 的邻居·缺则不计）。
  let twsum = 0;
  let tsum = 0;
  for (const nb of neighbors) {
    const tin = nb.record.tokensIn;
    const tout = nb.record.tokensOut;
    if (tin == null && tout == null) continue;
    twsum += nb.weight;
    tsum += nb.weight * ((tin ?? 0) + (tout ?? 0));
  }
  const predictedTokens = twsum > 0 ? tsum / twsum : null;

  // confidence：邻居数 + 最近邻距离共同决定。
  const nearest = neighbors[0]?.distance ?? Infinity;
  let confidence: 'high' | 'medium' | 'low' = 'low';
  if (neighbors.length >= k && nearest < 1.0) confidence = 'high';
  else if (neighbors.length >= 3 && nearest < 2.5) confidence = 'medium';

  return { predictedHours, predictedTokens, neighbors, confidence, history_n: candidates.length };
}
