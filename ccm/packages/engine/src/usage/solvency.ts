// solvency.ts — 偿付力维度：配额%-计的成本轴原语（ADR-015 §2.6 延伸·plan §4「成本轴=配额% 维」）。
//
// 把「时间存量 + 成本流」双轴里的**成本流**侧（配额% 可再生流·5h/7d 滚动 refill）建成一组纯函数：
//   · pctBurnRate    —— Δused% / Δtime（账户权威信号增量·%/小时）。两法：finite-diff（≥2 时序样本）/
//                       window-elapsed（单快照 + 已知窗口起点 resets_at−windowSec）。
//   · pctRunway      —— 剩余走廊空间 ÷ %-burn → 距触顶 vs 距 reset 的时间（偿付力 headroom）。
//   · tokenWeightedShares —— 把一个总预算（如观测 burnPct / cost-to-complete 总量）按各单元相对 token 权重
//                       切分（token = 派活相对 sizing·**辅助·非账本**·plan §1.2/§4）。
//
// 设计纪律（plan §1.2）：**配额% 是权威单账本**（唯一真相·捕获全体消费含 master 前台 + cache 经济），
//   token 仅作 sizing 辅助——故这里 burn/runway 全在配额% 上算，token 只在 tokenWeightedShares 当相对权重。
//   **单-orchestrator 范围**：不数 M、不做多-orchestrator 争用 fair-share（留 COORD·plan §3/§6 开放 Q1/Q2）。
//
// 红线1 / ADR-006：node/JS only，零 npm dep，纯算术（**不碰 fs**——used%/resets_at 由调用方注入·读 sidecar
//   是 CLI handler 的事，同 pacing.ts 的「读/算分离」）。
// 红线3：出测量/预测数据，**不替 orchestrator 决策**（真动作归 SKILL A·plan §2 不变式 2）。
// 确定性：纯函数，无随机、无时钟（now 由调用方注入）。

// 配额窗口长度（秒）——window-elapsed burn-rate 用「窗口起点 = resets_at − windowSec」反推已逝时间。
export const WINDOW_5H_SEC = 5 * 3600; // 18000
export const WINDOW_7D_SEC = 7 * 24 * 3600; // 604800

// ── %-burn-rate（Δused% / Δtime·账户权威增量）────────────────────────────────────────────────────────
// 一条 used% 观测（账户权威·某时刻该窗口已用%）。
export interface BurnSample {
  atSec: number; // 观测时刻（epoch 秒）
  usedPct: number; // 该时刻已用%（账户权威）
}
export interface BurnRateOptions {
  // 单快照 window-elapsed 法的窗口起点（epoch 秒·= resets_at − windowSec）。
  //   缺 → 无法 window-elapsed（只能 finite-diff·两样本以上）。
  windowStartSec?: number | null;
}
export interface BurnRateResult {
  burn_pct_per_hour: number | null; // %/小时（不可算 → null）
  method: 'finite-diff' | 'window-elapsed' | 'none';
  samples_used: number;
  confidence: 'high' | 'medium' | 'low';
}

// pctBurnRate(samples, opts) → %-burn-rate。
//   优先 finite-diff（最近一对「时间严格递增且 used% 非递减〔同窗未跨 reset〕」相邻样本的斜率·最贴近瞬时）；
//   否则降级 window-elapsed（最新样本 used% ÷ 窗口已逝小时数·从窗口起点起的平均速率·粗）。
export function pctBurnRate(
  samples: BurnSample[] | null | undefined,
  opts: BurnRateOptions = {},
): BurnRateResult {
  const valid = (Array.isArray(samples) ? samples : [])
    .filter(
      (s): s is BurnSample =>
        !!s &&
        typeof s.atSec === 'number' &&
        Number.isFinite(s.atSec) &&
        typeof s.usedPct === 'number' &&
        Number.isFinite(s.usedPct),
    )
    .slice()
    .sort((a, b) => a.atSec - b.atSec);

  // ① finite-diff：从最近往回找第一对 dt>0 且 dp≥0（同窗·未 reset 回血）的相邻样本。
  for (let i = valid.length - 1; i >= 1; i--) {
    const cur = valid[i] as BurnSample;
    const prev = valid[i - 1] as BurnSample;
    const dt = cur.atSec - prev.atSec;
    const dp = cur.usedPct - prev.usedPct;
    if (dt > 0 && dp >= 0) {
      return {
        burn_pct_per_hour: round4(dp / (dt / 3600)),
        method: 'finite-diff',
        samples_used: valid.length,
        confidence: valid.length >= 3 ? 'high' : 'medium',
      };
    }
  }

  // ② window-elapsed：单快照 + 已知窗口起点 → used% / 窗口已逝小时数（平均速率·confidence low）。
  const latest = valid.length > 0 ? (valid[valid.length - 1] as BurnSample) : null;
  const wStart = opts.windowStartSec;
  if (latest && typeof wStart === 'number' && Number.isFinite(wStart) && latest.atSec > wStart) {
    const elapsedH = (latest.atSec - wStart) / 3600;
    if (elapsedH > 0) {
      return {
        burn_pct_per_hour: round4(latest.usedPct / elapsedH),
        method: 'window-elapsed',
        samples_used: valid.length,
        confidence: 'low',
      };
    }
  }

  return {
    burn_pct_per_hour: null,
    method: 'none',
    samples_used: valid.length,
    confidence: 'low',
  };
}

// ── %-runway（剩余走廊 ÷ burn → 距触顶 vs 距 reset）────────────────────────────────────────────────────
export interface RunwayOptions {
  usedPct: number; // 当前已用%
  burnPctPerHour: number | null; // 来自 pctBurnRate（null → 不可投影触顶）
  ceilingPct?: number; // 走廊上界（默认 90·5h 临界阈；7d 传 85 硬总闸）
  resetsAtSec?: number | null; // 该窗口 reset 时刻（epoch 秒·算 hours_to_reset）
  nowSec?: number; // 当前 epoch 秒（默认 Date.now()/1000）
}
export interface RunwayResult {
  remaining_corridor_pct: number | null; // max(0, ceiling − used)
  hours_to_ceiling: number | null; // remaining ÷ burn（burn≤0/未知 → null）
  hours_to_reset: number | null; // (resets_at − now)/3600（纯时间）
  // ample = reset 先于触顶（窗口会先回血）；will-exhaust-before-reset = 触顶先于 reset（偿付力吃紧）；unknown = 数据不足。
  verdict: 'ample' | 'will-exhaust-before-reset' | 'unknown';
  ceiling_pct: number;
  burn_pct_per_hour: number | null;
}

// pctRunway(opts) → 偿付力 runway。verdict 回答「会不会在窗口 reset 前烧到走廊上界」。
export function pctRunway(opts: RunwayOptions): RunwayResult {
  const ceiling = typeof opts.ceilingPct === 'number' ? opts.ceilingPct : 90;
  const used = opts.usedPct;
  const burn = opts.burnPctPerHour;
  const nowSec = opts.nowSec ?? Math.floor(Date.now() / 1000);

  const usedValid = typeof used === 'number' && Number.isFinite(used);
  const remaining = usedValid ? Math.max(0, round2(ceiling - used)) : null;

  // hours_to_reset：纯时间（resets_at 在未来 → 正值；已过 → 0）。
  let hoursToReset: number | null = null;
  if (typeof opts.resetsAtSec === 'number' && Number.isFinite(opts.resetsAtSec)) {
    const dh = (opts.resetsAtSec - nowSec) / 3600;
    hoursToReset = dh > 0 ? round2(dh) : 0;
  }

  // hours_to_ceiling：remaining ÷ burn（burn≤0 或未知 → 不可投影 → null）。
  const burnValid = typeof burn === 'number' && Number.isFinite(burn);
  let hoursToCeiling: number | null = null;
  if (remaining != null && burnValid && (burn as number) > 0) {
    hoursToCeiling = round2(remaining / (burn as number));
  }

  // verdict：是否在 reset 前触顶。
  let verdict: RunwayResult['verdict'] = 'unknown';
  if (remaining != null && remaining === 0) {
    verdict = 'will-exhaust-before-reset'; // 已在/超走廊上界
  } else if (hoursToCeiling != null && hoursToReset != null) {
    verdict = hoursToCeiling < hoursToReset ? 'will-exhaust-before-reset' : 'ample';
  } else if (remaining != null && remaining > 0 && burnValid && (burn as number) <= 0) {
    verdict = 'ample'; // 不烧 → 永不触顶
  }

  return {
    remaining_corridor_pct: remaining,
    hours_to_ceiling: hoursToCeiling,
    hours_to_reset: hoursToReset,
    verdict,
    ceiling_pct: ceiling,
    burn_pct_per_hour: burnValid ? (burn as number) : null,
  };
}

// ── token 辅助 sizing（相对权重切分·非账本·plan §1.2/§4）────────────────────────────────────────────
// tokenWeightedShares(weights, total) → 把 total 按各单元相对权重切分（每单元 = total × w_i/Σw）。
//   token = 「派出去的活多重」的相对量计（辅助）：重活分得多。Σw≤0 / 空权重 → 均分兜底（无信号不偏袒）。
//   负 / 非有限权重当 0。**token 不是预算账本**——只在已有一个配额%总量后做相对切分（plan 红线：% 才是账本）。
export function tokenWeightedShares(weights: number[] | null | undefined, total: number): number[] {
  const w = (Array.isArray(weights) ? weights : []).map((x) =>
    Number.isFinite(x) && x > 0 ? x : 0,
  );
  const n = w.length;
  if (n === 0) return [];
  const sum = w.reduce((a, b) => a + b, 0);
  if (!(sum > 0)) return w.map(() => total / n); // 无权重信号 → 均分
  return w.map((x) => (total * x) / sum);
}

// ── helpers ──────────────────────────────────────────────────────────────────
function round2(x: number): number {
  return Number.isFinite(x) ? Math.round(x * 100) / 100 : x;
}
function round4(x: number): number {
  return Number.isFinite(x) ? Math.round(x * 10000) / 10000 : x;
}
