// sampling.ts — 概率分布采样（hand-roll Box-Muller·plan §7）。
//
// 为什么 log-normal：软件工期 / token 消耗是**右偏 heavy-tail**（planning fallacy + 偶发长尾），
//   log-normal 比 normal 贴工期（plan §3：「工期分布用 log-normal·heavy tail·比 normal 贴工期」）。
//   home-corpus 的 act/est 分布刻意做成右偏（全局 1.38·p90/p50 比远大于 1）正是为喂这个。
//
// 为什么 Box-Muller 而非 Ziggurat：N<10k trials × 50 节点 ≈ ms 级，Box-Muller 足够快，
//   Ziggurat 过度（plan §7：「hand-roll Box-Muller·Ziggurat 过度」）。
//
// 红线1 / ADR-006：node/JS only，零 npm dep，纯 stdlib。确定性：所有采样取一个 prng:()=>number
//   参数（来自 sfc32），绝不内部 Math.random()。

// 标准正态采样（Box-Muller·返回单值）。U1∈(0,1] 避免 log(0)。
//   每次调用消耗 prng 两个 draw（U1/U2），只取 Z0（丢 Z1·实现简洁 > 省一半 draw）。
export function sampleNormal(prng: () => number): number {
  let u1 = prng();
  // u1 不能为 0（log(0)=-∞）；命中边界 → 推到一个极小正数（概率近 0，保险起见处理）。
  if (u1 <= 0) u1 = Number.MIN_VALUE;
  const u2 = prng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

// log-normal 采样：给定底层正态的 (mu, sigma)，返回 exp(mu + sigma·Z)。
//   注意 mu/sigma 是 **log 空间**的参数（非原空间的均值/方差）。
export function sampleLogNormalFromLogParams(
  prng: () => number,
  mu: number,
  sigma: number,
): number {
  return Math.exp(mu + sigma * sampleNormal(prng));
}

// 从原空间的 (mean, cv) 推 log 空间参数。
//   cv = 变异系数（stddev/mean）；log-normal 的闭式：
//     sigma² = ln(1 + cv²)；mu = ln(mean) − sigma²/2。
//   这让调用方用直觉的「均值 + 离散度」描述任务时长分布，内部转 log 参数采样。
export interface LogNormalParams {
  mu: number;
  sigma: number;
}
export function logNormalParamsFromMeanCv(mean: number, cv: number): LogNormalParams {
  const m = mean > 0 ? mean : 1e-9;
  const c = cv > 0 ? cv : 1e-9;
  const sigma2 = Math.log(1 + c * c);
  const sigma = Math.sqrt(sigma2);
  const mu = Math.log(m) - sigma2 / 2;
  return { mu, sigma };
}

// sampleTaskDuration(prng, mean, cv) → 一次任务时长抽样（>0·原空间·log-normal 形）。
//   mean = 该任务的点估时长（小时·来自校准/估值），cv = 不确定性（默认调用方给）。
//   mean≤0 → 退化返回 0（无时长任务·不污染 MC）。
export function sampleTaskDuration(prng: () => number, mean: number, cv: number): number {
  if (!(mean > 0)) return 0;
  const { mu, sigma } = logNormalParamsFromMeanCv(mean, cv);
  return sampleLogNormalFromLogParams(prng, mu, sigma);
}
