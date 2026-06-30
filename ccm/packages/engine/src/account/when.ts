// account/when.ts — 换号 WHEN 触发判定（@ccm/engine·LOADBAL §3.2「现在该不该切」）。
//
// 设计 SSOT：design_docs/plans/2026-06-29-loadbal-account-namespace-design.md §3.2。
//
// **铁律**（design §3）：切号有真实成本（prefix cache 服务端失效 → 重算 → **反增用量**）。故「何时切（频率）」
//   与「切哪个（均衡·select.ts）」**彻底解耦**——本模块只答「现在该不该切」，绝不算「切哪个」（那归 select）。
//
// 三触发（OR）：
//   ① **5h 水位**（forced·不切就 wall）：active 号 5h ≥ 阈值 **或** runway 说撑不到（will-exhaust-before-reset）。
//   ② **7d 水位**（forced·安全）：active 号 7d ≥ 阈值（防烧穿当前号 7d 这条不可逆边界）。
//   ③ **7d 失衡**（proactive·门控严）：active 号 7d **显著**高于池中最优可切号（gain = active7d − poolBest7d ≥ 阈值，
//      默认 15%·**非 1%**），**额外过** `min_switch_interval` 滞回 + 「收益 > 缓存成本」门。
//
// 频率门控为何严（design §3）：①② 高用量时主导（每几小时一次、天然不频繁）；③ 低用量时兜底（按显著失衡切、
//   不每 1% 切）——15% 阈值同时解「每 1% 切太频繁」(被阈值挡) + 「低用量慢性抽干」(被 ③ 兜住)。
//   「收益 > 缓存成本」门：gain ≥ 阈值即「失衡显著到值回切号的缓存代价」(阈值本身编码了这道门·切号 % 成本)；
//   再叠 min_switch_interval 滞回挡住高频抖动。**①② forced 绕过滞回**（wall 在即，刚切过也得再切）。
//
// **解耦纪律**：本模块出「该不该切 + 命中哪个触发」的 verdict，**不替 orchestrator / select 决策**——真正切到哪个号、
//   能不能切（池是否耗尽）由 select.ts 答；池若无可切入号，forced 触发仍 fire（时机对），但「切到哪」是 select 的 NONE_*。
//
// **active 号只信 API 权威值**（design §2）：本模块的 active 5h/7d 必须是账户权威（authoritative）信号——
//   evaluateSwitch 对非权威（无 live signal 的 active 预测·陈旧）的 active 窗口传 null，**绝不**用陈旧预测催 forced 切号。
//
// token-blind（HARD）：只进出 used%（%）/ epoch 秒时刻 / email——**绝不碰任何 token 值**。
// 红线1（ADR-006）：node/JS only，纯算术、零第三方依赖、不碰 fs（registry 由调用方传入）。
// 确定性：纯函数，无随机；now 由调用方注入。

import { type LiveSignal, type PredictPoolOptions, predictPoolUsage } from './predict.js';
import type { Registry } from './registry.js';
import { nowIso } from './registry.js';
import { envNum } from './select.js';

// ── 旋钮（CCM_SELECT_* 风格·env / opts 可调·design §3.2 参数旋钮）─────────────────────────────────────
// ① 5h 水位阈：active 5h used% ≥ 此 → forced 切（不切就撞 5h wall）。默认 85。
export const FIVE_HOUR_WATERMARK = envNum('CCM_SELECT_5H_WATERMARK', 85);
// ② 7d 水位阈：active 7d used% ≥ 此 → forced 切（安全·防烧穿当前号 7d）。默认 85·对齐 select 7d 硬闸 / pacing 7d 总闸。
export const SEVEN_DAY_WATERMARK = envNum('CCM_SELECT_7D_WATERMARK', 85);
// ③ 7d 失衡阈：gain = active7d − poolBest7d ≥ 此 → 失衡显著（**默认 15·非 1**）。兼作「收益>缓存成本」门。
export const IMBALANCE_THRESHOLD = envNum('CCM_SELECT_7D_IMBALANCE', 15);
// ③ 滞回：距上次切号 ≥ 此秒数才允许 ③ 触发（挡高频抖动·频率门控严）。默认 1800（30min）。①② forced 不受此限。
export const MIN_SWITCH_INTERVAL_SEC = envNum('CCM_SELECT_MIN_SWITCH_INTERVAL_SEC', 1800);

export type SwitchTrigger = 'five_hour_watermark' | 'seven_day_watermark' | 'seven_day_imbalance';

// shouldSwitch 的输入（纯结构·便于测试注入）。
export interface SwitchTriggerInput {
  activeFiveHourPct: number | null; // active 号 5h used%（账户权威·非权威/不可判传 null）
  activeSevenDayPct: number | null; // active 号 7d used%（账户权威·非权威/不可判传 null）
  runwayWillExhaust?: boolean; // 5h runway verdict = will-exhaust-before-reset（撑不到活干完）→ 触发 ①
  poolSevenDayPcts?: number[]; // 可切入候选的预测 7d used%（失衡 anchor·空 → ③ 不可判）
  lastSwitchAtSec?: number | null; // 上次切号时刻（epoch 秒·滞回；缺 → 不限滞回）
  nowSec?: number; // 当前 epoch 秒（默认 Date.now()/1000）
}

export interface SwitchTriggerOptions {
  fiveHourWatermark?: number;
  sevenDayWatermark?: number;
  imbalanceThreshold?: number;
  minSwitchIntervalSec?: number;
  nowSec?: number;
}

export interface SwitchDecision {
  shouldSwitch: boolean;
  triggers: SwitchTrigger[]; // 命中的触发（OR·可多个）
  forced: boolean; // ① 或 ② 命中 = forced（绕过滞回）
  reason: string;
  imbalanceGain: number | null; // active7d − poolBest7d（不可算 → null）
  poolBestSevenDay: number | null; // 池中最优可切号预测 7d（min·失衡 anchor）
  poolMedianSevenDay: number | null; // 池中位预测 7d（观测用）
  secondsSinceLastSwitch: number | null;
  hysteresisBlocked: boolean; // ③ 失衡达标但被 min_switch_interval 挡下（未切）
}

function isNum(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}
function num(v: number | undefined, dflt: number): number {
  return Number.isFinite(v) ? (v as number) : dflt;
}
function median(xs: number[]): number {
  const s = xs.slice().sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
}
function round2(x: number): number {
  return Number.isFinite(x) ? Math.round(x * 100) / 100 : x;
}

// shouldSwitch(input, opts?) → WHEN verdict（纯函数·三触发 OR + ③ 滞回 / 收益门）。
export function shouldSwitch(
  input: SwitchTriggerInput,
  opts: SwitchTriggerOptions = {},
): SwitchDecision {
  const fiveWM = num(opts.fiveHourWatermark, FIVE_HOUR_WATERMARK);
  const sevenWM = num(opts.sevenDayWatermark, SEVEN_DAY_WATERMARK);
  const imbThresh = num(opts.imbalanceThreshold, IMBALANCE_THRESHOLD);
  const minInterval = num(opts.minSwitchIntervalSec, MIN_SWITCH_INTERVAL_SEC);
  const nowSec = opts.nowSec ?? input.nowSec ?? Math.floor(Date.now() / 1000);

  const p5 = isNum(input.activeFiveHourPct) ? input.activeFiveHourPct : null;
  const p7 = isNum(input.activeSevenDayPct) ? input.activeSevenDayPct : null;

  const triggers: SwitchTrigger[] = [];

  // ── ① 5h 水位（forced）：active 5h ≥ 阈 或 runway 撑不到 ──
  if ((p5 !== null && p5 >= fiveWM) || input.runwayWillExhaust === true) {
    triggers.push('five_hour_watermark');
  }
  // ── ② 7d 水位（forced·安全）：active 7d ≥ 阈 ──
  if (p7 !== null && p7 >= sevenWM) {
    triggers.push('seven_day_watermark');
  }
  const forced = triggers.length > 0;

  // ── ③ 7d 失衡（proactive·滞回 + 收益门）──
  const pool = (Array.isArray(input.poolSevenDayPcts) ? input.poolSevenDayPcts : []).filter(isNum);
  const poolBest = pool.length ? Math.min(...pool) : null; // 最优可切号 = 7d 最低（headroom 最多）
  const poolMedian = pool.length ? round2(median(pool)) : null;
  const gain = p7 !== null && poolBest !== null ? round2(p7 - poolBest) : null;
  const elapsed = isNum(input.lastSwitchAtSec) ? nowSec - (input.lastSwitchAtSec as number) : null;

  let hysteresisBlocked = false;
  if (gain !== null && gain >= imbThresh && pool.length > 0) {
    // 收益>缓存成本门已由 gain≥imbThresh 编码；再过 min_switch_interval 滞回（①② forced 不受此限·见上）。
    if (forced || elapsed === null || elapsed >= minInterval) {
      triggers.push('seven_day_imbalance');
    } else {
      hysteresisBlocked = true; // 失衡达标但刚切过 → 挡下（频率门控）
    }
  }

  const decided = triggers.length > 0;
  const reason = buildReason({
    decided,
    forced,
    triggers,
    p5,
    p7,
    fiveWM,
    sevenWM,
    gain,
    imbThresh,
    poolBest,
    runway: input.runwayWillExhaust === true,
    hysteresisBlocked,
    elapsed,
    minInterval,
  });

  return {
    shouldSwitch: decided,
    triggers,
    forced,
    reason,
    imbalanceGain: gain,
    poolBestSevenDay: poolBest,
    poolMedianSevenDay: poolMedian,
    secondsSinceLastSwitch: elapsed,
    hysteresisBlocked,
  };
}

function buildReason(c: {
  decided: boolean;
  forced: boolean;
  triggers: SwitchTrigger[];
  p5: number | null;
  p7: number | null;
  fiveWM: number;
  sevenWM: number;
  gain: number | null;
  imbThresh: number;
  poolBest: number | null;
  runway: boolean;
  hysteresisBlocked: boolean;
  elapsed: number | null;
  minInterval: number;
}): string {
  if (!c.decided) {
    if (c.hysteresisBlocked) {
      return `不切：7d 失衡达标（gain ${c.gain}% ≥ ${c.imbThresh}%）但距上次切号仅 ${c.elapsed}s（< ${c.minInterval}s 滞回）——频率门控挡下，避免缓存抖动反增用量。`;
    }
    return `不切：5h ${c.p5 ?? 'n/a'}% < ${c.fiveWM}% 且 7d ${c.p7 ?? 'n/a'}% < ${c.sevenWM}% 且无显著 7d 失衡（gain ${c.gain ?? 'n/a'}% < ${c.imbThresh}%）——当前节奏无须切号。`;
  }
  const parts: string[] = [];
  if (c.triggers.includes('five_hour_watermark')) {
    parts.push(
      c.runway && !(c.p5 !== null && c.p5 >= c.fiveWM)
        ? `5h runway 撑不到（will-exhaust-before-reset）`
        : `5h 已用 ${c.p5}%（≥${c.fiveWM}%·forced·不切就 wall）`,
    );
  }
  if (c.triggers.includes('seven_day_watermark')) {
    parts.push(`7d 已用 ${c.p7}%（≥${c.sevenWM}%·forced·安全·防烧穿）`);
  }
  if (c.triggers.includes('seven_day_imbalance')) {
    parts.push(
      `7d 显著失衡（active ${c.p7}% − 池最优 ${c.poolBest}% = gain ${c.gain}% ≥ ${c.imbThresh}%·已过滞回）`,
    );
  }
  return `该切：${parts.join('；')}。（切到哪个号由 select 决定·本判定只答时机）`;
}

// ── evaluateSwitch：把 predict（§2）与 shouldSwitch（§3.2）接起来的便捷入口 ──────────────────────────
//   从 registry 推出 active 号权威水位 + 可切入候选的预测 7d 分布，喂 shouldSwitch。**active 水位只取权威值**：
//   active 号窗口非 authoritative（无 live signal·只有陈旧切出预测）→ 传 null，绝不用陈旧预测催 forced 切号（design §2）。
export interface EvaluateSwitchOptions
  extends SwitchTriggerOptions,
    Omit<PredictPoolOptions, 'now'> {
  now?: string; // ISO（默认 nowIso()）；与 nowSec 二选一·都缺则用真实时钟
  runwayWillExhaust?: boolean; // 5h runway verdict（调用方从 usage/solvency 算好传入）
  lastSwitchAtSec?: number | null;
  live?: LiveSignal | null; // 当前 active 号的 API 权威信号（强烈建议传·否则 active 水位不可判 → 不 forced）
}

export interface EvaluateSwitchResult extends SwitchDecision {
  activeEmail: string | null;
  poolCandidates: number; // 可切入候选数
  activeAuthoritative: boolean; // active 水位是否取到了权威值（false → forced 触发被压抑·只可能 ③）
}

export function evaluateSwitch(
  reg: Registry | null | undefined,
  opts: EvaluateSwitchOptions = {},
): EvaluateSwitchResult {
  const now = opts.now || nowIso();
  let nowSec: number;
  if (isNum(opts.nowSec)) {
    nowSec = opts.nowSec as number;
  } else {
    const parsed = Math.floor(Date.parse(now) / 1000);
    nowSec = Number.isFinite(parsed) ? parsed : Math.floor(Date.now() / 1000);
  }

  const preds = predictPoolUsage(reg, {
    now,
    live: opts.live,
    liveByEmail: opts.liveByEmail,
  });
  const active = preds.find((p) => p.active) || null;
  const candidates = preds.filter((p) => p.switchable);

  // active 水位只信权威（authoritative）值——非权威（陈旧预测）传 null，不催 forced 切号（design §2）。
  const fiveAuth = !!active && active.fiveHour.authoritative;
  const sevenAuth = !!active && active.sevenDay.authoritative;
  const activeFive = fiveAuth ? (active as NonNullable<typeof active>).fiveHour.usedPct : null;
  const activeSeven = sevenAuth ? (active as NonNullable<typeof active>).sevenDay.usedPct : null;

  const decision = shouldSwitch(
    {
      activeFiveHourPct: activeFive,
      activeSevenDayPct: activeSeven,
      runwayWillExhaust: opts.runwayWillExhaust,
      poolSevenDayPcts: candidates.map((c) => c.sevenDay.usedPct),
      lastSwitchAtSec: opts.lastSwitchAtSec,
      nowSec,
    },
    opts,
  );

  return {
    ...decision,
    activeEmail: active ? active.email : null,
    poolCandidates: candidates.length,
    activeAuthoritative: fiveAuth || sevenAuth,
  };
}
