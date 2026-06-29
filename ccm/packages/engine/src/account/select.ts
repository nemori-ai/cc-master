// account/select.ts — 选号调度算法（@ccm/engine·Phase 1 纯逻辑移植）。
//
// 源：cc-master 插件 skills/account-management/scripts/select-account.js（node 库 + CLI）。本文件是它的
//   **纯逻辑** TS 移植——逐条保住选号打分语义。**只移植纯算法，不移植 runCli（process.argv/exit/读文件/打印）**
//   那部分（CLI handler 归后续阶段·Phase 1 不接 CLI）。
//
// 给定此刻 now，从 registry 里所有**非 active 且 token 未过期**的号中，按「预计可用配额」选一个最优切入号。
//   安全命门：完全不碰 token——只读 accounts.json 的非密调度元信息（used_pct/resets_at/到期时刻）。
//
// 默认拍点：过 reset = 满血；未过 reset = 保守用原 used_pct；评分 W5*avail5h + W7*avail7d（W7=0.6/W5=0.4）；
//   7d≥85% 硬闸；无历史新号视满血最优先；临近到期降权；全员逼顶返回 NONE_ALL_EXHAUSTED；source 信任分级。

import type { AccountEntry, Registry, WindowSnapshot } from './registry.js';
import { ISO_UTC_RE, nowIso } from './registry.js';

// ── 可调常量（顶部常量 + env 覆写，便于调旋钮而不改逻辑）──────────────────────────────────────────
// 读 env 数字覆写：缺 / 非法数 → 用默认（fail-safe，绝不因坏 env 崩）。
//   TS-port 注 ①：导出 envNum 便于单测验证 env-读取机制（原 JS 未导出·良性增量·见交付报告）。
//   TS-port 注 ②：这些常量在 module-load 时被求值（与原 JS 同口径·env 覆写在 module load 那刻固化）；
//     但本模块会被打进 webview 的 IIFE barrel，而 IIFE 在**裸浏览器 realm**（无 `process` 全局）加载——
//     故必须 `typeof process` 守，否则 module-load 即抛 ReferenceError（webview 永不调选号·默认值足够）。
export function envNum(name: string, dflt: number): number {
  const v = typeof process !== 'undefined' && process.env ? process.env[name] : undefined;
  if (v == null || v === '') return dflt;
  const n = Number(v);
  return Number.isFinite(n) ? n : dflt;
}

// 7d 硬总闸：7d 估算 used% ≥ 此 → 该号视作几乎不可用。默认 85，对齐 usage-pacing 85% 闸。
export const SEVEN_DAY_HARD_GATE = envNum('CCM_SELECT_7D_HARD_GATE', 85);

// 评分权重：avail = 100 - used_pct（剩余额度）。7d 加权更重（跨窗口总闸）。
export const W5 = envNum('CCM_SELECT_W5', 0.4);
export const W7 = envNum('CCM_SELECT_W7', 0.6);

// token 临近到期降权：距到期 ≤ EXPIRY_WARN_DAYS 天 → 减 EXPIRY_PENALTY 分（不归零、不排除）。
export const EXPIRY_WARN_DAYS = envNum('CCM_SELECT_EXPIRY_WARN_DAYS', 14);
export const EXPIRY_PENALTY = envNum('CCM_SELECT_EXPIRY_PENALTY', 40);

// local-derived-approx 来源快照信任折扣：reset 反推可能失真，对它的评分乘信任系数。account 来源 = 1.0。
export const LOCAL_APPROX_TRUST = envNum('CCM_SELECT_LOCAL_APPROX_TRUST', 0.85);

// last_observed_quota 信任折扣（弱信号兜底）：录号那刻 session 当前号的配额视角，比真正切出快照弱。默认 0.7。
export const OBSERVED_QUOTA_TRUST = envNum('CCM_SELECT_OBSERVED_QUOTA_TRUST', 0.7);

// 无历史新号视满血基准分（按当前权重算，保证「满血」始终是评分上界，即便用户调了权重）。
function freshFullScore(): number {
  return W5 * 100 + W7 * 100;
}

// 「全员逼顶 / 不可用」地板。7d 硬闸号被赋 SCORE_UNUSABLE（极低），地板取略高于它。
const SCORE_UNUSABLE = -1; // 7d 硬闸命中的号的分（确保排在所有正常号之后）。
const SCORE_UNUSABLE_FLOOR = envNum('CCM_SELECT_UNUSABLE_FLOOR', 0); // 最优分 ≤ 0 = 全员不可用。

// ── 时间比较（严格 ISO 字典序 == 时间序）──────────────────────────────────────────────────────────
export function isStrictIso(s: unknown): s is string {
  return typeof s === 'string' && ISO_UTC_RE.test(s);
}

// a 是否在 b **之后或同时**（a >= b，字典序）。两者都须严格 ISO，否则返回 null（不可比，调用处降级）。
export function isoGte(a: unknown, b: unknown): boolean | null {
  if (!isStrictIso(a) || !isStrictIso(b)) return null;
  return a >= b; // 定宽 + Z，字典序即时间序。
}

// 距某 ISO 时刻还有多少天（now → target，可负=已过）。非严格 ISO → 返回 null。
export function daysUntil(targetIso: unknown, nowIsoStr: unknown): number | null {
  if (!isStrictIso(targetIso) || !isStrictIso(nowIsoStr)) return null;
  const t = Date.parse(targetIso);
  const n = Date.parse(nowIsoStr);
  if (!Number.isFinite(t) || !Number.isFinite(n)) return null;
  return (t - n) / 86400000; // ms → days。
}

// ── 单窗口恢复度推算（二值版·不插值）──────────────────────────────────────────────────────────────
export interface RecoveredWindow {
  usedPct: number;
  resetsAt: string | undefined;
  source: string | undefined;
}
// 过 reset（now >= resets_at）→ 满血 used=0；未过 reset → 保守仍是切出时的 used_pct。
//   resets_at 非严格 ISO 时无法判过期 → 保守按「未过 reset」处理。
export function recoveredWindow(
  win: WindowSnapshot | null | undefined,
  nowIsoStr: string,
): RecoveredWindow {
  const w = win || {};
  const usedRaw = Number.isInteger(w.used_pct) ? (w.used_pct as number) : 100; // 缺 / 坏 → 保守当满载。
  const resetsAt = typeof w.resets_at === 'string' ? w.resets_at : undefined;
  const source = typeof w.source === 'string' ? w.source : undefined;
  const gte = isoGte(nowIsoStr, resetsAt); // now >= resets_at ?
  let usedPct: number;
  if (gte === true) {
    usedPct = 0; // 已过 reset → 满血。
  } else {
    // 未过 reset（gte===false）或 resets_at 不可比（gte===null）→ 保守用原 used_pct。
    usedPct = usedRaw;
  }
  return { usedPct, resetsAt, source };
}

// ── 单号可用度评分 ──────────────────────────────────────────────────────────────────────────────
export interface ScoreInfo {
  score: number;
  avail5h: number;
  avail7d: number;
  p5: number;
  p7: number;
  gated: boolean;
  sources: string[];
  earliestReset: string | null;
  trust: number;
}
export function accountScore(acct: AccountEntry, nowIsoStr: string): ScoreInfo {
  const lso = acct.last_switch_out || {};
  const r5 = recoveredWindow(lso['5h'], nowIsoStr);
  const r7 = recoveredWindow(lso['7d'], nowIsoStr);
  const p5 = r5.usedPct; // 现在 5h 已用 %。
  const p7 = r7.usedPct; // 现在 7d 已用 %。
  const avail5h = 100 - p5;
  const avail7d = 100 - p7;

  // 信任系数：任一窗口来源是 local-derived-approx → 整号评分打折（粗排 + 口径告警）。
  const sources = [r5.source, r7.source].filter((s): s is string => s != null);
  const hasLocalApprox = sources.some((s) => s === 'local-derived-approx');
  const trust = hasLocalApprox ? LOCAL_APPROX_TRUST : 1.0;

  // tiebreak 用的「最早 reset」：两窗口 resets_at 取严格 ISO 中字典序更小者（越近越优）。
  const earliestReset = earliestOf(r5.resetsAt, r7.resetsAt);

  // 7d 硬总闸：7d 已逼顶的号即便 5h 满血也几乎没用（切进去马上又被 7d 卡）。
  if (p7 >= SEVEN_DAY_HARD_GATE) {
    return {
      score: SCORE_UNUSABLE,
      avail5h,
      avail7d,
      p5,
      p7,
      gated: true,
      sources,
      earliestReset,
      trust,
    };
  }

  const base = W5 * avail5h + W7 * avail7d;
  return {
    score: base * trust,
    avail5h,
    avail7d,
    p5,
    p7,
    gated: false,
    sources,
    earliestReset,
    trust,
  };
}

// 两个 ISO 取字典序更小（更早）的那个；非严格 ISO 的一方被忽略；都不严格 → null。
function earliestOf(a: string | undefined, b: string | undefined): string | null {
  const va = isStrictIso(a) ? a : null;
  const vb = isStrictIso(b) ? b : null;
  if (va == null) return vb;
  if (vb == null) return va;
  return va <= vb ? va : vb;
}

// ── 主选号流程 ──────────────────────────────────────────────────────────────────────────────────
export type SelectReason =
  | 'SELECTED'
  | 'NONE_NO_CANDIDATES'
  | 'NONE_ALL_EXHAUSTED'
  | 'NONE_EMPTY_REGISTRY';

export interface Candidate {
  email: string;
  score: number;
  scoreForExhaustionFloor?: number;
  avail5h: number | null;
  avail7d: number | null;
  p5: number | null;
  p7: number | null;
  fresh: boolean;
  observedFallback: boolean;
  gated: boolean;
  expired: boolean;
  active: boolean;
  notSwitchable?: boolean;
  expiringSoon: boolean;
  daysToExpiry: number | null;
  sources: string[];
  trust: number | null;
  earliestReset: string | null;
  excludedReason?: string;
}

export interface SelectResult {
  selected: string | null;
  reason: SelectReason;
  candidates: Candidate[];
  warnings: string[];
}

export interface SelectOptions {
  now?: string;
}

// selectAccount(reg, nowIso?, opts?) → 结构化结果（纯函数，便于测试注入 now/registry）。
//   opts.now 优先于第二参 nowArg；都缺 → 用真实 nowIso()。
export function selectAccount(
  reg: Registry | null | undefined,
  nowArg?: string,
  opts?: SelectOptions,
): SelectResult {
  const o = opts || {};
  const now = o.now || nowArg || nowIso();
  const warnings: string[] = [];

  const registry = reg && typeof reg === 'object' ? reg : ({} as Registry);
  const accounts =
    registry.accounts && typeof registry.accounts === 'object' && !Array.isArray(registry.accounts)
      ? registry.accounts
      : {};

  const emails = Object.keys(accounts);
  if (emails.length === 0) {
    return { selected: null, reason: 'NONE_EMPTY_REGISTRY', candidates: [], warnings };
  }

  // 给每个号定位（active / token 过期 → 排除，标注但不计入可选）+ 评分。
  const ranked: Candidate[] = [];
  for (const email of emails) {
    const acct = accounts[email];
    if (!acct || typeof acct !== 'object') continue;

    // active 跳过：当前在用号不是切换目标。
    if (acct.active === true) {
      ranked.push(rowExcluded(email, acct, now, 'active'));
      continue;
    }

    // switchable:false 跳过（残缺号·无 refresh token·无重启换号切不进）。排除 + 标注。
    if (acct.switchable === false) {
      ranked.push(rowExcluded(email, acct, now, 'not_switchable'));
      warnings.push(
        `号 ${email} 标记为不可无重启换号（switchable:false·多半是只含 access token 的残缺号·无 refresh token）——已排除，请重跑 /cc-master:accounts --add ${email} 录完整 blob。`,
      );
      continue;
    }

    // token 已过期跳过（切进去认证失败，白切一次重启）。token_expires_at < now（字典序）。
    const expired = tokenExpired(acct, now);
    if (expired) {
      ranked.push(rowExcluded(email, acct, now, 'expired'));
      continue;
    }

    // 评分：有 last_switch_out（真切出快照·高信任）→ 按算法算；否则有 last_observed_quota（弱信号兜底）
    //   → 用它算、再叠加折扣；两者都无 = 无历史真·新号 → 视满血最优先。
    let scoreInfo: ScoreInfo;
    let fresh = false;
    let observedFallback = false;
    if (acct.last_switch_out != null) {
      scoreInfo = accountScore(acct, now);
    } else if (acct.last_observed_quota != null) {
      // 弱信号兜底：把 last_observed_quota 当恢复度依据喂进同一套 accountScore，再对结果乘 OBSERVED_QUOTA_TRUST
      //   折扣、把 trust 拉低，并 warn 告知。gated（7d 硬闸）号仍按硬闸处理（折扣不复活被硬闸的号）。
      observedFallback = true;
      const raw = accountScore({ last_switch_out: acct.last_observed_quota } as AccountEntry, now);
      scoreInfo = raw.gated
        ? raw
        : Object.assign({}, raw, {
            score: raw.score * OBSERVED_QUOTA_TRUST,
            trust: raw.trust * OBSERVED_QUOTA_TRUST,
          });
    } else {
      fresh = true;
      scoreInfo = {
        score: freshFullScore(),
        avail5h: 100,
        avail7d: 100,
        p5: 0,
        p7: 0,
        gated: false,
        sources: [],
        earliestReset: null,
        trust: 1.0,
      };
    }

    // 临近到期降权：距到期 ≤ EXPIRY_WARN_DAYS → 减分（不排除）+ warning。
    const d2e = daysUntil(acct.token_expires_at, now);
    const expiringSoon = d2e != null && d2e >= 0 && d2e <= EXPIRY_WARN_DAYS;
    let finalScore = scoreInfo.score;
    if (expiringSoon && !scoreInfo.gated) {
      finalScore = finalScore - EXPIRY_PENALTY;
      warnings.push(
        `号 ${email} 将在约 ${Math.floor(d2e as number)} 天后到期（≤${EXPIRY_WARN_DAYS} 天预警），已降权；建议尽快 /cc-master:accounts --refresh ${email}。`,
      );
    }

    // 弱信号兜底告警。
    if (observedFallback && !scoreInfo.gated) {
      warnings.push(
        `号 ${email} 无切出快照，改用 last_observed_quota（录号那刻 cc-usage 的配额，反映的是当时 session 当前号、未必是本号），评分已按弱信号折扣处理，仅作兜底粗排；切出一次后即被真实 last_switch_out 取代。`,
      );
    }

    // 快照口径不可靠告警：含 local-derived-approx 来源 → 提示选号精度受损。
    if (scoreInfo.trust < 1.0 && !observedFallback) {
      warnings.push(
        `号 ${email} 的切出快照来源含 local-derived-approx（reset 反推、口径不可靠·Finding #37），评分已按信任折扣处理，仅作粗排。`,
      );
    }

    ranked.push({
      email,
      score: finalScore,
      // 全员逼顶地板判定用的分（到期降权不该伪装成配额逼顶）：地板判的是**配额耗尽**，不是临近到期。
      //   故用**到期降权之前**的分（gated → SCORE_UNUSABLE；否则 = scoreInfo.score·配额分）。
      scoreForExhaustionFloor: scoreInfo.gated ? SCORE_UNUSABLE : scoreInfo.score,
      avail5h: scoreInfo.avail5h,
      avail7d: scoreInfo.avail7d,
      p5: scoreInfo.p5,
      p7: scoreInfo.p7,
      fresh,
      observedFallback,
      gated: scoreInfo.gated,
      expired: false,
      active: false,
      expiringSoon,
      daysToExpiry: d2e,
      sources: scoreInfo.sources,
      trust: scoreInfo.trust,
      earliestReset: scoreInfo.earliestReset,
    });
  }

  // 可选候选 = 未被排除（非 active、非 expired、非 not_switchable）**且非 7d 硬闸（gated）**的号。
  //   gated 必须从可选候选里彻底排除（硬闸是硬的）——它仍在 sorted 输出里供 --json 看见、标 gated。
  const candidates = ranked.filter((r) => !r.active && !r.expired && !r.notSwitchable && !r.gated);

  // 主排序：score 降序；tiebreak：score 相同则 earliestReset 更早者优。被排除项排到尾部、保留在 sorted。
  const sorted = ranked.slice().sort(cmpRows);

  if (candidates.length === 0) {
    // 无可切换号。区分退出语义：
    //   · NONE_ALL_EXHAUSTED：仅当**非 active 备号全是 7d 硬闸**（纯配额逼顶·可操作的只有等 reset）。
    //   · NONE_NO_CANDIDATES：其余一切（无备号 / 全 active / 或混合——有 gated 但也有 expired/not_switchable）。
    const nonActiveBackups = ranked.filter((r) => !r.active);
    const allGated = nonActiveBackups.length > 0 && nonActiveBackups.every((r) => r.gated);
    if (allGated) {
      warnings.push(
        '所有可切换备号都已 7d 逼顶（全部命中 7d 硬闸）——这是 blocked_on:"user" 决策：等 reset 还是别的，请用户拍板。',
      );
      return { selected: null, reason: 'NONE_ALL_EXHAUSTED', candidates: sorted, warnings };
    }
    // 混合排除或全 active / 无备号 → NONE_NO_CANDIDATES（可操作=修号池·非等 reset）。
    if (nonActiveBackups.some((r) => r.gated)) {
      warnings.push(
        '无可切入备号：部分号 7d 逼顶、另一些因 token 过期 / 残缺（switchable:false）被排除——可操作的是 --refresh 过期号 / --add 补录残缺号，未必只能等 reset。',
      );
    }
    return { selected: null, reason: 'NONE_NO_CANDIDATES', candidates: sorted, warnings };
  }

  // 在可选候选（已排除 gated）里排序取最优。
  const sortedCandidates = candidates.slice().sort(cmpRows);
  const best = sortedCandidates[0] as Candidate;

  // 全员逼顶 / 不可用：所有候选的配额分（到期降权之前）都 ≤ 地板 → NONE_ALL_EXHAUSTED。
  //   用 scoreForExhaustionFloor（配额分）而非 score（含到期降权）判地板；取候选里配额分的最大值判地板。
  const bestQuotaFloor = candidates.reduce(
    (m, r) => Math.max(m, r.scoreForExhaustionFloor ?? -Infinity),
    -Infinity,
  );
  if (bestQuotaFloor <= SCORE_UNUSABLE_FLOOR) {
    warnings.push(
      '所有可切换备号都已逼顶 / 不可用（候选配额评分全跌破地板）——这是 blocked_on:"user" 决策：等 reset 还是别的，请用户拍板。',
    );
    return { selected: null, reason: 'NONE_ALL_EXHAUSTED', candidates: sorted, warnings };
  }

  return { selected: best.email, reason: 'SELECTED', candidates: sorted, warnings };
}

// 排序比较器：score 降序；相同则 earliestReset 字典序升序（更早=更优）；再相同则 email 字典序稳定。
function cmpRows(a: Candidate, b: Candidate): number {
  if (b.score !== a.score) return b.score - a.score;
  // tiebreak：恢复度相同则 resets_at 更早者优。null reset 排在有 reset 之后（无信息=不抢 tiebreak）。
  const ar = a.earliestReset;
  const br = b.earliestReset;
  if (ar != null && br != null && ar !== br) return ar < br ? -1 : 1;
  if (ar == null && br != null) return 1;
  if (ar != null && br == null) return -1;
  // 最终稳定：email 字典序。
  return a.email < b.email ? -1 : a.email > b.email ? 1 : 0;
}

// 被排除的候选行（active / expired / not_switchable）：score 极低，标注排除原因，仍出现在 candidates 排名里。
function rowExcluded(email: string, acct: AccountEntry, now: string, why: string): Candidate {
  const d2e = daysUntil(acct.token_expires_at, now);
  return {
    email,
    score: -Infinity, // 排除项排到最尾。
    avail5h: null,
    avail7d: null,
    p5: null,
    p7: null,
    fresh: false,
    observedFallback: false,
    gated: false,
    expired: why === 'expired',
    active: why === 'active',
    notSwitchable: why === 'not_switchable', // 残缺号（无 refresh token）——candidates 过滤器据此排除。
    expiringSoon: false,
    daysToExpiry: d2e,
    sources: [],
    trust: null,
    earliestReset: null,
    excludedReason: why,
  };
}

// token 是否已过期：token_expires_at < now（严格 ISO 字典序）。缺 / 非严格 ISO → 当「未过期」（保守不误排）。
//   注：这与 usage/pacing.ts 的同名 tokenExpired 语义不同——本函数是**严格 ISO 字典序**比较（账号选号口径），
//   pacing 那个是 Date.parse 毫秒比较。两者刻意分居各自模块（本模块经 account 命名空间导出，无 barrel 撞名）。
export function tokenExpired(acct: AccountEntry, nowIsoStr: string): boolean {
  const exp = acct.token_expires_at;
  if (!isStrictIso(exp) || !isStrictIso(nowIsoStr)) return false;
  return exp < nowIsoStr; // 定宽 ISO 字典序 == 时间序。
}
