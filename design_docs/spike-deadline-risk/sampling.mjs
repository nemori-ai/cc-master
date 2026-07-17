// sampling.mjs — log-normal 采样（Box-Muller）。
//
// 从 ccm/packages/engine/src/estimate/sampling.ts 逐字移植（零算法改动·TS→ESM .mjs）。
// 软件工期右偏 heavy-tail → log-normal 比 normal 贴工期。所有采样取 prng:()=>number 参数（sfc32），
// 绝不内部 Math.random()。

export function sampleNormal(prng) {
  let u1 = prng();
  if (u1 <= 0) u1 = Number.MIN_VALUE;
  const u2 = prng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

export function sampleLogNormalFromLogParams(prng, mu, sigma) {
  return Math.exp(mu + sigma * sampleNormal(prng));
}

// 原空间 (mean, cv) → log 空间 (mu, sigma)：sigma²=ln(1+cv²)；mu=ln(mean)−sigma²/2。
export function logNormalParamsFromMeanCv(mean, cv) {
  const m = mean > 0 ? mean : 1e-9;
  const c = cv > 0 ? cv : 1e-9;
  const sigma2 = Math.log(1 + c * c);
  const sigma = Math.sqrt(sigma2);
  const mu = Math.log(m) - sigma2 / 2;
  return { mu, sigma };
}

// 一次任务时长抽样（>0·原空间·log-normal）。mean≤0 → 0（无时长任务·不污染 MC）。
export function sampleTaskDuration(prng, mean, cv) {
  if (!(mean > 0)) return 0;
  const { mu, sigma } = logNormalParamsFromMeanCv(mean, cv);
  return sampleLogNormalFromLogParams(prng, mu, sigma);
}
