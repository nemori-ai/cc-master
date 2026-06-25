// ccpm.ts — CCPM fever chart / buffer_health（Critical Chain·ADR-015 §2.4 / plan §3/§7）。
//
// Critical Chain Project Management：不给每个任务塞安全余量，而是把余量**聚合**成一个项目缓冲
//   （project buffer）放在临界链末端。fever chart 监控「缓冲消耗 % vs 链完成 %」——
//     · buffer 消耗远快于进度 → 红区（项目缓冲快烧光、要干预）。
//     · 同步 → 黄区；buffer 消耗慢于进度 → 绿区（健康）。
//
// project_buffer = f · sqrt(Σ 临界链各任务 σ²)（plan §3/§7·f=0.5）——平方根法（SSQ buffer sizing·
//   比 50% cut-and-paste 法更省·CCPM 共识）。σ 来自任务时长不确定性（cv × mean）。
//
// 红线1：node/JS only，零 npm dep。确定性：纯算术（sqrt + 比例）。

export interface BufferInput {
  // 临界链各任务的 (mean, sigma)——sigma 通常 = cv × mean（来自 calibration.dispersionCv × 校准均值）。
  chainTasks: Array<{ id: string; mean: number; sigma: number }>;
  f?: number; // buffer 因子（默认 0.5·CCPM 共识）
}

export interface FeverInput {
  bufferSize: number; // project_buffer（小时·sizeProjectBuffer 的输出）
  bufferConsumed: number; // 已消耗的 buffer（小时·实际超出计划的部分）
  chainProgress: number; // 临界链完成度 [0,1]
}

export type BufferZone = 'green' | 'yellow' | 'red';

export interface ProjectBuffer {
  buffer_size: number; // f·sqrt(Σσ²)
  chain_mean_total: number; // 临界链均值总和（裸链长·小时）
  source: 'ccpm-ssq';
}

// sizeProjectBuffer(input) → 平方根法的项目缓冲（plan §3：f·sqrt(Σσ²)·f=0.5）。空链 → 0。
export function sizeProjectBuffer(input: BufferInput): ProjectBuffer {
  const f = input.f ?? 0.5;
  let sumSq = 0;
  let meanTotal = 0;
  for (const t of input.chainTasks) {
    const s = t.sigma > 0 ? t.sigma : 0;
    sumSq += s * s;
    meanTotal += t.mean > 0 ? t.mean : 0;
  }
  return {
    buffer_size: f * Math.sqrt(sumSq),
    chain_mean_total: meanTotal,
    source: 'ccpm-ssq',
  };
}

export interface FeverResult {
  buffer_consumed_pct: number; // 缓冲消耗 % [0,1+]
  chain_progress_pct: number; // 链完成 % [0,1]
  zone: BufferZone;
  buffer_health: number; // (progress − consumption)·>0 健康（消耗慢于进度）·<0 透支
  source: 'ccpm-fever';
}

// feverStatus(input) → fever chart 的绿/黄/红区判定（plan §3：绿/黄/红 buffer_health）。
//   经典 fever 三区按 (chainProgress, bufferConsumed%) 的相图分区——这里用线性近似的两条对角阈值：
//     消耗 % ≤ progress%·(2/3) → green；≤ progress%·(4/3)+1/3 → yellow；否则 red。
//   buffer_health = chainProgress − bufferConsumed%（>0 = 进度领先消耗 = 健康）。
export function feverStatus(input: FeverInput): FeverResult {
  const size = input.bufferSize > 0 ? input.bufferSize : 0;
  const consumedPct = size > 0 ? Math.max(0, input.bufferConsumed) / size : 0;
  const progress = Math.max(0, Math.min(1, input.chainProgress));

  // fever 相图的两条对角边界（标准 fever chart 的 OK / Watch / Act 分界的线性近似）。
  const greenCeil = progress * (2 / 3);
  const yellowCeil = progress * (4 / 3) + 1 / 3;
  let zone: BufferZone;
  if (consumedPct <= greenCeil) zone = 'green';
  else if (consumedPct <= yellowCeil) zone = 'yellow';
  else zone = 'red';

  return {
    buffer_consumed_pct: Math.round(consumedPct * 1000) / 1000,
    chain_progress_pct: Math.round(progress * 1000) / 1000,
    zone,
    buffer_health: Math.round((progress - consumedPct) * 1000) / 1000,
    source: 'ccpm-fever',
  };
}
