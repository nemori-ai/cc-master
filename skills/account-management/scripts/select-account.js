'use strict';
// select-account.js — A2 account-management 关键路径 T2：选号调度算法（node 库 + CLI）。
//
// 给定此刻 now，从 registry 里所有**非 active 且 token 未过期**的号中，按「预计可用配额」
//   选一个最优切入号。「可用配额」= 综合 5h + 7d 两个窗口、按各自 reset 推算的「现在恢复了多少」。
//   设计依据：A2 account-management 设计稿 §B（选号调度算法·随仓库的设计文档，非随插件分发）。
//
// 落点（红线 1·ADR-006）：这是 **switch-account.sh 切号前调用的带外 node 逻辑**——**绝不进 hooks/**。
//   §B.7 落点定稿：选号只在带外脚本（switch/list），hook 注入只注「号池有 N 个可用备号」粗事实，
//   不在 hook 里跑完整选号。即便它进 hook，JSON.parse + 纯计算也满足红线 1（零 spawn）。
// 红线 2：accounts.json 与 board 正交——本文件只读 registry 非密元信息，绝不碰 board。
// 红线 5（ship-anywhere）：纯 node stdlib，零第三方依赖、零 spawn、零联网。
// 安全命门（HARD）：**完全不碰 token**——只读 accounts.json 的非密调度元信息（used_pct/resets_at/
//   vault 引用/到期时刻），绝不读 / 回显 / 返回任何 token 值。
//
// orchestrator 拍定的默认（设计稿 §G 待拍点已拍）：
//   - 不插值（§B.2/§G #4）：过 reset = 满血（avail 100%）；未过 reset = 保守用原 used_pct
//     （账户口径无 burn 无法插值）；resets_at 当 tiebreak（越近越优、更快彻底满血）。
//   - 评分 W5*avail5h + W7*avail7d，W7=0.6 / W5=0.4（7d 加权更重·§B.5）。
//   - 7d ≥85% 硬闸（§B.3，对齐 usage-pacing.js dispatchGate / cost-and-pacing.md）。
//   - 无历史新号（last_switch_out==null 且 last_observed_quota==null）= 视满血最优先（§B.6）。
//   - last_switch_out 缺但有 last_observed_quota（录号那刻 cc-usage 快照·优化①）= 用它当**弱信号兜底**
//     恢复依据，评分按 OBSERVED_QUOTA_TRUST 折扣（它反映录号那刻 session 当前号、未必本号），切出一次后被真实快照取代。
//   - token 临到期降权（§B.6）；全员逼顶返回 NONE_ALL_EXHAUSTED（让调用方 surface 用户）。
//   - source 信任分级（§B.7）：local-derived-approx 降信任（粗排 / 口径不可靠告警）。

const lib = require('./accounts-lib.js');
const { loadRegistry, ISO_UTC_RE, nowIso } = lib;

// ── 可调常量（顶部常量 + env 覆写，便于 dogfood 调旋钮而不改逻辑·设计稿 §B.5/§G #5）──────────────────
// 读 env 数字覆写：缺 / 非法数 → 用默认（fail-safe，绝不因坏 env 崩）。
function envNum(name, dflt) {
  const v = process.env[name];
  if (v == null || v === '') return dflt;
  const n = Number(v);
  return Number.isFinite(n) ? n : dflt;
}

// 7d 硬总闸：7d 估算 used% ≥ 此 → 该号视作几乎不可用（切进去马上又被 7d 卡）。
//   默认 85，对齐 usage-pacing.js dispatchGate / cost-and-pacing.md 85% 闸（§B.5）。
const SEVEN_DAY_HARD_GATE = envNum('CCM_SELECT_7D_HARD_GATE', 85);

// 评分权重：avail = 100 - used_pct（剩余额度）。7d 加权更重（跨窗口总闸，最易不知不觉逼顶）。
const W5 = envNum('CCM_SELECT_W5', 0.4); // 5h 短窗、恢复快，权重低些。
const W7 = envNum('CCM_SELECT_W7', 0.6); // 7d 跨窗口总闸，选号优先看它的余量。

// token 临近到期降权（§B.6）：距到期 ≤ EXPIRY_WARN_DAYS 天 → 减 EXPIRY_PENALTY 分（不归零、不排除）。
const EXPIRY_WARN_DAYS = envNum('CCM_SELECT_EXPIRY_WARN_DAYS', 14);
const EXPIRY_PENALTY = envNum('CCM_SELECT_EXPIRY_PENALTY', 40); // 大幅降权但不彻底排除（它还能用、只是该提醒续期）。

// local-derived-approx 来源快照信任折扣（§B.7）：该来源 resets_at 是反推、可能失真到数量级（Finding #37），
//   对它的评分乘一个信任系数（粗排），并在 warnings 里告知口径不可靠。account 来源 = 1.0（权威）。
const LOCAL_APPROX_TRUST = envNum('CCM_SELECT_LOCAL_APPROX_TRUST', 0.85);

// last_observed_quota 信任折扣（优化①·弱信号兜底）：当一个号**没有** last_switch_out（从未由本工具切出）
//   但有 last_observed_quota（录号那刻 cc-usage 给的配额快照）时，用它当恢复度依据——但它是「录号那刻
//   **session 当前号**的配额视角」，cc-usage 未必反映被录号本身（仅当录的就是当前号才准），故比真正的
//   切出快照**弱**。对它的评分再乘一个折扣系数（叠加在 source 信任之上），并在 warnings 里如实告知。
//   默认 0.7（明显低于 LOCAL_APPROX_TRUST 0.85，体现「视角不一定对得上号」这一额外不确定性）。
const OBSERVED_QUOTA_TRUST = envNum('CCM_SELECT_OBSERVED_QUOTA_TRUST', 0.7);

// 无历史新号（last_switch_out==null）视满血基准分：avail_5h=100 + avail_7d=100 代入评分 = 100*(W5+W7)。
//   不写死 100——按当前权重算，保证「满血」始终是评分上界（即便用户调了权重）。
function freshFullScore() {
  return W5 * 100 + W7 * 100;
}

// 「全员逼顶 / 不可用」地板：最优号的（未折扣）评分 ≤ 此 → 返回 NONE_ALL_EXHAUSTED（别盲目切）。
//   7d 硬闸号被赋 SCORE_UNUSABLE（极低），地板取略高于它，使「全 7d 逼顶」必触发 NONE_ALL_EXHAUSTED。
const SCORE_UNUSABLE = -1; // 7d 硬闸命中的号的分（确保排在所有正常号之后）。
const SCORE_UNUSABLE_FLOOR = envNum('CCM_SELECT_UNUSABLE_FLOOR', 0); // 最优分 ≤ 0 = 全员不可用。

// ── 时间比较（严格 ISO 字典序 == 时间序·accounts-lib 的 ISO_UTC_RE）──────────────────────────────────
// 严格 ISO-8601 UTC 定宽（YYYY-MM-DDTHH:MM:SSZ）下字典序 == 时间序，纯字符串比较即判先后，无需 date 运算。
//   非严格 ISO 的时间戳（缺秒 / 无 Z / 带毫秒）= 字符序与时间序可能脱节，调用处必须先 isStrictIso 守。
function isStrictIso(s) {
  return typeof s === 'string' && ISO_UTC_RE.test(s);
}

// a 是否在 b **之后或同时**（a >= b，字典序）。两者都须严格 ISO，否则返回 null（不可比，调用处降级）。
function isoGte(a, b) {
  if (!isStrictIso(a) || !isStrictIso(b)) return null;
  return a >= b; // 定宽 + Z，字典序即时间序。
}

// 距某 ISO 时刻还有多少天（now → target，可负=已过）。只用于「临近到期」粗判，故 Date 解析即可
//   （这里需要时长差而非先后，无法靠纯字典序——但 ISO-8601 UTC 是 Date 可解析的标准格式，且仅用于
//   粗粒度「≤14 天」判断，毫秒级误差无影响）。非严格 ISO → 返回 null（不可算，调用处当「无到期信息」）。
function daysUntil(targetIso, nowIsoStr) {
  if (!isStrictIso(targetIso) || !isStrictIso(nowIsoStr)) return null;
  const t = Date.parse(targetIso);
  const n = Date.parse(nowIsoStr);
  if (!Number.isFinite(t) || !Number.isFinite(n)) return null;
  return (t - n) / 86400000; // ms → days。
}

// ── 单窗口恢复度推算（§B.2，二值版·不插值）──────────────────────────────────────────────────────────
// 用切出快照 { used_pct, resets_at } + now 推算「现在的 used_pct」：
//   过 reset（now >= resets_at）→ 窗口刷新满血，used = 0；
//   未过 reset → 配额还没恢复，保守仍是切出时的 used_pct（账户口径无 burn 无法插值·§G #4 已拍）。
// 返回 { usedPct, resetsAt, source }，resets_at 非严格 ISO 时无法判过期 → 保守按「未过 reset」处理。
function recoveredWindow(win, nowIsoStr) {
  const w = win || {};
  const usedRaw = Number.isInteger(w.used_pct) ? w.used_pct : 100; // 缺 / 坏 used_pct → 保守当满载（最不优）。
  const resetsAt = w.resets_at;
  const source = w.source; // 'account' | 'local-derived-approx' | undefined。
  const gte = isoGte(nowIsoStr, resetsAt); // now >= resets_at ?
  let usedPct;
  if (gte === true) {
    usedPct = 0; // 已过 reset → 满血。
  } else {
    // 未过 reset（gte===false）或 resets_at 不可比（gte===null）→ 保守用原 used_pct（不假设恢复）。
    usedPct = usedRaw;
  }
  return { usedPct, resetsAt, source };
}

// ── 单号可用度评分（§B.3）──────────────────────────────────────────────────────────────────────────
// 返回 { score, avail5h, avail7d, p5, p7, gated, sources, earliestReset, trust }。
//   gated=true 表示 7d 硬闸命中（score=SCORE_UNUSABLE）。trust<1 表示快照含 local-derived-approx 来源。
function accountScore(acct, nowIsoStr) {
  const lso = acct.last_switch_out || {};
  const r5 = recoveredWindow(lso['5h'], nowIsoStr);
  const r7 = recoveredWindow(lso['7d'], nowIsoStr);
  const p5 = r5.usedPct; // 现在 5h 已用 %。
  const p7 = r7.usedPct; // 现在 7d 已用 %。
  const avail5h = 100 - p5;
  const avail7d = 100 - p7;

  // 信任系数（§B.7）：任一窗口来源是 local-derived-approx → 整号评分打折（粗排 + 口径告警）。
  const sources = [r5.source, r7.source].filter((s) => s != null);
  const hasLocalApprox = sources.some((s) => s === 'local-derived-approx');
  const trust = hasLocalApprox ? LOCAL_APPROX_TRUST : 1.0;

  // tiebreak 用的「最早 reset」：两窗口 resets_at 取严格 ISO 中字典序更小者（越近越优）。
  const earliestReset = earliestOf(r5.resetsAt, r7.resetsAt);

  // 7d 硬总闸：7d 已逼顶的号即便 5h 满血也几乎没用（切进去马上又被 7d 卡）。
  if (p7 >= SEVEN_DAY_HARD_GATE) {
    return { score: SCORE_UNUSABLE, avail5h, avail7d, p5, p7, gated: true, sources, earliestReset, trust };
  }

  const base = W5 * avail5h + W7 * avail7d;
  return { score: base * trust, avail5h, avail7d, p5, p7, gated: false, sources, earliestReset, trust };
}

// 两个 ISO 取字典序更小（更早）的那个；非严格 ISO 的一方被忽略；都不严格 → null。
function earliestOf(a, b) {
  const va = isStrictIso(a) ? a : null;
  const vb = isStrictIso(b) ? b : null;
  if (va == null) return vb;
  if (vb == null) return va;
  return va <= vb ? va : vb;
}

// ── 主选号流程（§B.4）──────────────────────────────────────────────────────────────────────────────
// selectAccount(reg, nowIso?, opts?) → 结构化结果（纯函数，便于测试注入 now/registry）：
//   {
//     selected: email | null,
//     reason:   'SELECTED' | 'NONE_NO_CANDIDATES' | 'NONE_ALL_EXHAUSTED' | 'NONE_EMPTY_REGISTRY',
//     candidates: [{ email, score, avail5h, avail7d, p5, p7, fresh, gated, expired, expiringSoon, daysToExpiry, sources, trust }...],  // 评分降序排名（含被排除项标注）
//     warnings: [ ... ],  // 如「该号 X 天后到期」/「全员逼顶」/「快照口径不可靠」
//   }
// opts.now 优先于第二参 nowIso（两种传 now 方式都支持，便于测试）；都缺 → 用真实 nowIso()。
function selectAccount(reg, nowArg, opts) {
  const o = opts || {};
  const now = o.now || nowArg || nowIso();
  const warnings = [];

  const registry = reg && typeof reg === 'object' ? reg : {};
  const accounts = (registry.accounts && typeof registry.accounts === 'object' && !Array.isArray(registry.accounts))
    ? registry.accounts
    : {};

  const emails = Object.keys(accounts);
  if (emails.length === 0) {
    return { selected: null, reason: 'NONE_EMPTY_REGISTRY', candidates: [], warnings };
  }

  // 给每个号定位（active / token 过期 → 排除，标注但不计入可选）+ 评分。
  const ranked = [];
  for (const email of emails) {
    const acct = accounts[email];
    if (!acct || typeof acct !== 'object') continue;

    // active 跳过：当前在用号不是切换目标。
    if (acct.active === true) {
      ranked.push(rowExcluded(email, acct, now, 'active'));
      continue;
    }

    // switchable:false 跳过（身份补全重构 P2）：残缺号（无 refreshToken·只 access token）被 account-add fallback
    //   标 switchable:false——无重启换号切不进（缺 refresh token 无法主动续期·8h 后失效），白切一次。排除 + 标注，
    //   别静默把不可切的号当可切。缺省（未设 switchable）= 视作可切（不破既有完整号）。
    if (acct.switchable === false) {
      ranked.push(rowExcluded(email, acct, now, 'not_switchable'));
      warnings.push(`号 ${email} 标记为不可无重启换号（switchable:false·多半是只含 access token 的残缺号·无 refresh token）——已排除，请重跑 /cc-master:accounts --add ${email} 录完整 blob。`);
      continue;
    }

    // token 已过期跳过（切进去认证失败，白切一次重启）。token_expires_at < now（字典序）。
    const expired = tokenExpired(acct, now);
    if (expired) {
      ranked.push(rowExcluded(email, acct, now, 'expired'));
      continue;
    }

    // 评分：有 last_switch_out（真切出快照·高信任）→ 按 §B.3 算；
    //   否则有 last_observed_quota（录号那刻观察快照·弱信号兜底·优化①）→ 用它算、再叠加折扣；
    //   两者都无 = 无历史真·新号 → 视满血最优先（§B.6）。
    let scoreInfo;
    let fresh = false;
    let observedFallback = false;
    if (acct.last_switch_out != null) {
      scoreInfo = accountScore(acct, now);
    } else if (acct.last_observed_quota != null) {
      // 弱信号兜底：把 last_observed_quota 当恢复度依据喂进同一套 accountScore（它读 .last_switch_out），
      //   再对结果乘 OBSERVED_QUOTA_TRUST 折扣、把 trust 拉低（叠加在 source 信任之上），并 warn 告知。
      //   gated（7d 硬闸）号仍按硬闸处理（折扣只动正常分，不复活被硬闸的号）。
      observedFallback = true;
      const raw = accountScore({ last_switch_out: acct.last_observed_quota }, now);
      scoreInfo = raw.gated
        ? raw
        : Object.assign({}, raw, {
            score: raw.score * OBSERVED_QUOTA_TRUST,
            trust: raw.trust * OBSERVED_QUOTA_TRUST,
          });
    } else {
      fresh = true;
      scoreInfo = {
        score: freshFullScore(), avail5h: 100, avail7d: 100, p5: 0, p7: 0,
        gated: false, sources: [], earliestReset: null, trust: 1.0,
      };
    }

    // 临近到期降权（§B.6）：距到期 ≤ EXPIRY_WARN_DAYS → 减分（不排除）+ warning。
    const d2e = daysUntil(acct.token_expires_at, now);
    const expiringSoon = d2e != null && d2e >= 0 && d2e <= EXPIRY_WARN_DAYS;
    let finalScore = scoreInfo.score;
    if (expiringSoon && !scoreInfo.gated) {
      finalScore = finalScore - EXPIRY_PENALTY;
      warnings.push(`号 ${email} 将在约 ${Math.floor(d2e)} 天后到期（≤${EXPIRY_WARN_DAYS} 天预警），已降权；建议尽快 /cc-master:accounts --refresh ${email}。`);
    }

    // 弱信号兜底告警（优化①）：用 last_observed_quota 顶替缺失的 last_switch_out → 提示这是录号那刻
    //   session 当前号的配额视角（未必反映被录号本身），已按信任折扣处理，仅作粗排兜底。
    if (observedFallback && !scoreInfo.gated) {
      warnings.push(`号 ${email} 无切出快照，改用 last_observed_quota（录号那刻 cc-usage 的配额，反映的是当时 session 当前号、未必是本号），评分已按弱信号折扣处理，仅作兜底粗排；切出一次后即被真实 last_switch_out 取代。`);
    }

    // 快照口径不可靠告警（§B.7）：含 local-derived-approx 来源 → 提示选号精度受损。
    if (scoreInfo.trust < 1.0 && !observedFallback) {
      warnings.push(`号 ${email} 的切出快照来源含 local-derived-approx（reset 反推、口径不可靠·Finding #37），评分已按信任折扣处理，仅作粗排。`);
    }

    ranked.push({
      email,
      score: finalScore,
      scoreUngated: scoreInfo.gated ? SCORE_UNUSABLE : finalScore, // 全员逼顶地板判定用「含到期降权后的分」。
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

  // 可选候选 = 未被排除（非 active、非 expired、非 not_switchable）的号。
  const candidates = ranked.filter((r) => !r.active && !r.expired && !r.notSwitchable);

  // 主排序：score 降序；tiebreak：score 相同则 earliestReset 更早者优（更快彻底满血·§B.4）。
  //   被排除项（active/expired）排到尾部、保留在 candidates 输出里供调用方完整看见排名。
  const sorted = ranked.slice().sort(cmpRows);

  if (candidates.length === 0) {
    // 无可切换号（全 active / 全过期）→ 保持现状（单账号场景的天然行为·§B.6）。
    return { selected: null, reason: 'NONE_NO_CANDIDATES', candidates: sorted, warnings };
  }

  // 在可选候选里排序取最优。
  const sortedCandidates = candidates.slice().sort(cmpRows);
  const best = sortedCandidates[0];

  // 全员逼顶 / 不可用：最优号的分 ≤ 地板 → NONE_ALL_EXHAUSTED（别盲目切进一个一样满的号·§B.6）。
  //   gated（7d 硬闸）号的 score=SCORE_UNUSABLE（-1）已 ≤ 地板（0），故「全 7d 逼顶」必命中此分支。
  if (best.score <= SCORE_UNUSABLE_FLOOR) {
    warnings.push('所有可切换备号都已逼顶 / 不可用（最优号评分跌破地板）——这是 blocked_on:"user" 决策：等 reset 还是别的，请用户拍板。');
    return { selected: null, reason: 'NONE_ALL_EXHAUSTED', candidates: sorted, warnings };
  }

  return { selected: best.email, reason: 'SELECTED', candidates: sorted, warnings };
}

// 排序比较器：score 降序；相同则 earliestReset 字典序升序（更早=更优）；再相同则 email 字典序稳定。
function cmpRows(a, b) {
  if (b.score !== a.score) return b.score - a.score;
  // tiebreak：恢复度相同则 resets_at 更早者优。null reset（无快照/新号）排在有 reset 之后（无信息=不抢 tiebreak）。
  const ar = a.earliestReset;
  const br = b.earliestReset;
  if (ar != null && br != null && ar !== br) return ar < br ? -1 : 1;
  if (ar == null && br != null) return 1;
  if (ar != null && br == null) return -1;
  // 最终稳定：email 字典序。
  return a.email < b.email ? -1 : (a.email > b.email ? 1 : 0);
}

// 被排除的候选行（active / expired / not_switchable）：score 极低，标注排除原因，仍出现在 candidates 排名里。
function rowExcluded(email, acct, now, why) {
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
    notSwitchable: why === 'not_switchable', // 残缺号（无 refresh token·P2）——candidates 过滤器据此排除。
    expiringSoon: false,
    daysToExpiry: d2e,
    sources: [],
    trust: null,
    earliestReset: null,
    excludedReason: why,
  };
}

// token 是否已过期：token_expires_at < now（严格 ISO 字典序）。缺 / 非严格 ISO → 当「未过期」（保守不误排，
//   宁可切进去由认证现场失败，也不因坏时间戳误杀一个可能可用的号）。
function tokenExpired(acct, nowIsoStr) {
  const exp = acct.token_expires_at;
  if (!isStrictIso(exp) || !isStrictIso(nowIsoStr)) return false;
  return exp < nowIsoStr; // 定宽 ISO 字典序 == 时间序。
}

// ── CLI 入口（node select-account.js）──────────────────────────────────────────────────────────────
// 读默认 registry（defaultRegistryPath，或 --registry <path> 覆写）→ 选号 → 打印结果。
//   默认（无 flag）只打印选中 email 到 stdout（供 T4 switch-account.sh `email=$(node select-account.js)` 取用），
//   选不出（NONE_*）→ stdout 空、退出码非 0、reason+warnings 走 stderr（供脚本判分支 + surface 用户）。
//   --json：打印完整结构化结果到 stdout（调试 / list 用）。
//   绝不打印任何 token（本算法本就不碰 token）。
function runCli(argv) {
  const args = argv.slice(2);
  let registryPath = null;
  let asJson = false;
  let nowOverride = null; // --now <iso>（测试 / 复现用，绝不用真实时间打印 nondeterministic）。
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--json') asJson = true;
    else if (a === '--registry') registryPath = args[++i];
    else if (a === '--now') nowOverride = args[++i];
    else if (a === '--help' || a === '-h') {
      process.stdout.write(
        'select-account.js — A2 选号调度（带外，绝不碰 token）。\n' +
        '用法: node select-account.js [--registry <accounts.json>] [--json] [--now <ISO>]\n' +
        '  默认: 打印选中 email（选不出 → 空 stdout + 非 0 退出码 + reason 走 stderr）。\n' +
        '  --json: 打印完整结构化结果（selected/reason/candidates/warnings）。\n',
      );
      return 0;
    }
  }

  // 读 registry——坏 JSON / IO 错时 loadRegistry 抛；CLI 捕获 → 降级「无号池」（fail-safe·§B.6）。
  let reg;
  try {
    reg = loadRegistry(registryPath || undefined);
  } catch (e) {
    // registry 不存在 / 坏 JSON → 选号不可用，降级单账号（绝不崩·对齐脚本「缺失即优雅降级」纪律）。
    process.stderr.write(`select-account: registry 不可用，降级无号池（${e && e.message ? e.message : e}）。\n`);
    if (asJson) {
      process.stdout.write(JSON.stringify({ selected: null, reason: 'NONE_EMPTY_REGISTRY', candidates: [], warnings: [String(e && e.message ? e.message : e)] }, null, 2) + '\n');
    }
    return 1;
  }

  const result = selectAccount(reg, nowOverride || undefined);

  if (asJson) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } else if (result.selected) {
    process.stdout.write(result.selected + '\n');
  }

  if (!result.selected) {
    // 选不出：reason + warnings 走 stderr（供 switch-account.sh 判分支 + surface 用户）。
    process.stderr.write(`select-account: ${result.reason}\n`);
    for (const w of result.warnings) process.stderr.write(`  - ${w}\n`);
    return result.reason === 'NONE_ALL_EXHAUSTED' ? 3 : 1; // 3 = 全员逼顶（调用方区别对待·surface 用户）。
  }
  // 选中：把 warnings（如临近到期）也走 stderr，不污染 stdout 的纯 email。
  for (const w of result.warnings) process.stderr.write(`  ! ${w}\n`);
  return 0;
}

// ── 导出（库）+ CLI 自驱 ─────────────────────────────────────────────────────────────────────────────
module.exports = {
  selectAccount,
  // 内部函数导出便于单测细粒度断言。
  recoveredWindow,
  accountScore,
  tokenExpired,
  daysUntil,
  isStrictIso,
  // 常量快照（测试 / 调用方复用；注意它们在 module load 时按当时 env 固化）。
  SEVEN_DAY_HARD_GATE,
  W5,
  W7,
  EXPIRY_WARN_DAYS,
  EXPIRY_PENALTY,
  LOCAL_APPROX_TRUST,
  OBSERVED_QUOTA_TRUST,
};

// 作为 CLI 直接跑（node select-account.js）时自驱；被 require 时不跑（库形态）。
if (require.main === module) {
  process.exit(runCli(process.argv));
}
