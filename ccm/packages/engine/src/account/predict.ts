// account/predict.ts — inactive 号用量预测（@ccm/engine·LOADBAL §2 可观测性 / 状态估计层）。
//
// 设计 SSOT：design_docs/plans/2026-06-29-loadbal-account-namespace-design.md §2。
//
// LOADBAL 要在 inactive 期决定「切哪个号」（喂 select 的失衡比较 + WHEN ③ 失衡触发的池分布），
//   必须先估出**每个号此刻的 used%**。但 inactive 号没人在用、registry 里只有它**切出那刻**的快照——
//   故按窗口分两套口径：
//
//   · **active 号**：用 API 权威值（live signal），**绝不预测**。它正在被消费、唯一真相在账户 API。
//   · **inactive 号**：用切出快照**保守预测**——「冻结在切出 used_pct、到 resets_at 归零」
//     （号 inactive 无人用 → 用量不增长，确定性）。这正是 select.recoveredWindow 的二值恢复语义，本模块复用它、
//     不另起一份（SSOT）。
//
// **关键自愈（self-heal）**：预测只在 inactive 期间用来「决定切哪个」；一旦真切回某号、立刻有 API 权威值
//   （传 live signal）覆盖预测——ground truth 自动纠偏。预测误差有界、每次激活即自愈。故本模块不追求 inactive
//   预测精确，只追求**保守不乐观**（宁可高估 used% 也不低估·别把一个其实已耗尽的号当满血切进去）。
//
// **绝不硬编码任何重置规则**（design §2 recon：5h 多半定点重置、7d murky·官方「7 天」vs 社区实测 72h 未硬确认）——
//   只用快照里 API 给的 resets_at。inactive「冻结→归零」哪怕对滑动窗口也只**偏悲观（安全）**：真实滑动窗会随
//   时间衰减 used%，冻结则不衰减 → 我们高估 used% → 保守。
//
// token-blind（HARD）：本模块只读 used_pct（%）/ resets_at（ISO）/ active / switchable / email —— 与 select 同口径，
//   **绝不碰任何 token 值**。live signal 也只携带 used%（账户权威）+ reset 时刻，不含凭证。
//
// 红线1（ADR-006）：node/JS only，纯算术 + 复用 select 的二值恢复，零第三方依赖、不碰 fs（registry 由调用方传入）。

import type { AccountEntry, Registry } from './registry.js';
import { nowIso } from './registry.js';
import { isStrictIso, recoveredWindow, tokenExpired } from './select.js';

// 一个窗口的预测结果（5h 或 7d）。
export interface PredictedWindow {
  usedPct: number; // 预测 / 权威 used%（0-100）
  resetsAt: string | undefined; // 该窗口 reset 时刻（来自快照 / live·绝不硬编码推算）
  // 预测来源口径：account-live（active 号 API 权威·不预测）/ switch-out-frozen（切出快照冻结·高信任）/
  //   observed-frozen（录号观测快照冻结·弱信号）/ fresh（无历史·视满血）。
  source: 'account-live' | 'switch-out-frozen' | 'observed-frozen' | 'fresh';
  authoritative: boolean; // true = API 权威（active+live）；false = inactive 保守预测
}

// 一个号两窗口的预测（不含 email·predictPoolUsage 负责贴 email）。
export interface AccountPrediction {
  active: boolean;
  fiveHour: PredictedWindow;
  sevenDay: PredictedWindow;
}

// active 号的 API 权威信号（账户级·只携带 used% + reset·token-blind）。任一窗口 pct 缺 → 该窗口降级回预测。
export interface LiveSignal {
  fiveHourPct?: number | null;
  sevenDayPct?: number | null;
  fiveHourResetsAt?: string | null;
  sevenDayResetsAt?: string | null;
}

export interface PredictOptions {
  now?: string; // 注入 now（纯函数·便于测试）；缺 → nowIso()
  live?: LiveSignal | null; // 该号的 API 权威信号（active 号传入即触发自愈·覆盖预测）
}

function isNum(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}
function clampPct(x: number): number {
  return x < 0 ? 0 : x > 100 ? 100 : x;
}

// 从一个窗口快照（last_switch_out / last_observed_quota 的 5h|7d 子结构）做「冻结→归零」预测。
//   复用 select.recoveredWindow（now≥resets_at → 满血 0；否则保守用切出 used_pct）。
function frozenWindow(
  win: unknown,
  now: string,
  source: 'switch-out-frozen' | 'observed-frozen',
): PredictedWindow {
  const r = recoveredWindow((win as never) ?? null, now);
  return { usedPct: r.usedPct, resetsAt: r.resetsAt, source, authoritative: false };
}

// 单窗口 inactive 预测：优先切出快照（高信任）→ 退录号观测快照（弱信号）→ 无历史视满血（fresh）。
function predictWindow(acct: AccountEntry, key: '5h' | '7d', now: string): PredictedWindow {
  const lso = acct.last_switch_out;
  if (lso != null && typeof lso === 'object') {
    return frozenWindow(lso[key], now, 'switch-out-frozen');
  }
  const loq = acct.last_observed_quota;
  if (loq != null && typeof loq === 'object') {
    return frozenWindow(loq[key], now, 'observed-frozen');
  }
  // 无任何历史快照 → 视满血（与 select 的 fresh 口径一致·新号最优先）。
  return { usedPct: 0, resetsAt: undefined, source: 'fresh', authoritative: false };
}

// live 权威窗口：pct 是有效数 → 账户权威（不预测·自愈）；否则降级回该窗口的 inactive 预测。
function liveOrPredict(
  livePct: number | null | undefined,
  liveResetsAt: string | null | undefined,
  acct: AccountEntry,
  key: '5h' | '7d',
  now: string,
): PredictedWindow {
  if (isNum(livePct)) {
    return {
      usedPct: clampPct(livePct),
      resetsAt: isStrictIso(liveResetsAt) ? liveResetsAt : undefined,
      source: 'account-live',
      authoritative: true,
    };
  }
  return predictWindow(acct, key, now);
}

// predictAccountUsage(acct, opts?) → 一个号两窗口的预测。
//   规则：**ground truth（live API 权威信号）一旦给到就赢，绝不预测**（自愈点）；没 live → 切出快照「冻结→归零」预测。
//   设计的「active 号用权威 / inactive 号预测」由上层 predictPoolUsage 落地——它**默认只把 live 喂给 active 号**
//   （ground truth 唯一来源就是你正登录在用的那个号），inactive 号无 live → 自然走预测。本函数不绑死 active flag：
//   liveByEmail 显式注入是有意的逃生口（caller 断言「这是该号的 ground truth」·如测试 / 未来多权威源），honor 它更对。
export function predictAccountUsage(
  acct: AccountEntry | null | undefined,
  opts?: PredictOptions,
): AccountPrediction {
  const now = opts?.now || nowIso();
  const a = acct && typeof acct === 'object' ? acct : ({} as AccountEntry);
  const active = a.active === true;
  const live = opts?.live;
  const haveLive = !!live && (isNum(live.fiveHourPct) || isNum(live.sevenDayPct));

  if (haveLive) {
    // 自愈点：一旦有 API 权威值，直接用 ground truth，绝不预测（live 缺的那个窗口在 liveOrPredict 里降级回预测）。
    return {
      active,
      fiveHour: liveOrPredict(live.fiveHourPct, live.fiveHourResetsAt, a, '5h', now),
      sevenDay: liveOrPredict(live.sevenDayPct, live.sevenDayResetsAt, a, '7d', now),
    };
  }
  // 无 live（典型 inactive 号，或 active 但没拿到权威 → 保守降级）：切出快照冻结→归零预测。
  return {
    active,
    fiveHour: predictWindow(a, '5h', now),
    sevenDay: predictWindow(a, '7d', now),
  };
}

// 池内一个号的预测（贴上 email + 可切入判定，喂 WHEN 失衡触发 / select 失衡比较）。
export interface PooledPrediction extends AccountPrediction {
  email: string;
  switchable: boolean; // 非 active 且未显式 switchable:false 且 token 未过期（与 select 候选口径一致）
  expired: boolean;
}

export interface PredictPoolOptions {
  now?: string;
  live?: LiveSignal | null; // 当前 active 号的 API 权威信号（按 active 自动匹配）
  liveByEmail?: Record<string, LiveSignal> | null; // 可选·按 email 显式提供多个权威信号（优先于 live）
}

// predictPoolUsage(reg, opts?) → registry 内每个号的预测数组。
//   active 号若有 live signal → 权威；其余 inactive 号 → 冻结预测。switchable 标注与 select 候选口径对齐
//   （active / switchable:false / token 过期 → 不可切入），便于 WHEN ③ 只在「可切入候选」上算失衡。
export function predictPoolUsage(
  reg: Registry | null | undefined,
  opts?: PredictPoolOptions,
): PooledPrediction[] {
  const now = opts?.now || nowIso();
  const registry = reg && typeof reg === 'object' ? reg : ({} as Registry);
  const accounts =
    registry.accounts && typeof registry.accounts === 'object' && !Array.isArray(registry.accounts)
      ? registry.accounts
      : {};

  const out: PooledPrediction[] = [];
  for (const email of Object.keys(accounts)) {
    const acct = accounts[email];
    if (!acct || typeof acct !== 'object') continue;
    const live =
      (opts?.liveByEmail && opts.liveByEmail[email]) ||
      (acct.active === true ? opts?.live : undefined) ||
      undefined;
    const pred = predictAccountUsage(acct, { now, live });
    const expired = tokenExpired(acct, now);
    const switchable = acct.active !== true && acct.switchable !== false && !expired;
    out.push({ email, ...pred, switchable, expired });
  }
  return out;
}
