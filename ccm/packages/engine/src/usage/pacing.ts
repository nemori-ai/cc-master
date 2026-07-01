// pacing.ts — 单侧（减速）+ 换号 + 停 pacing 数学 SSOT（ADR-024·supersede ADR-010 §2.1/2.3/2.4）。
//
// **方法论反转（ADR-024）**：ADR-010 的「双侧目标走廊」（欠用侧加速 + 临界侧减速）被 supersede 为
//   **单侧（减速）+ 换号 + 停**——砍掉 underuse 加速侧。理由（本仓 pressure baseline·2/2 capable-model 均 Hold）：
//   在多号池世界，单窗口「欠用」不是真稀缺（一条 `ccm account switch` 就有满血新窗），加速提示既非必要护栏、
//   又诱导 agent 制造 busywork 去「填满」一个本可蒸发的窗口——而「不制造 busywork」已由 SKILL A 承重。故：
//     · 欠用 → **不再加速**（删欠用段）。真有活就自然烧、无活就随它蒸发（有号池则换号消费下一份配额）。
//     · 配额临界 + 有可切入备号 → **switch**（换到下一份配额，非减速）。
//     · 配额临界 + 全池到警告线（无健康逃逸）→ **throttle**（减速·5h 弱 / 7d 强 strength）。
//     · 全池 5h/7d 都撞墙（select NONE_ALL_EXHAUSTED = 权威锚·换号尝试即探针）→ **stop**（分 stop_5h 短停 /
//       stop_7d 长停·吐 nearest reset 供 agent arm wakeup）。
//   **7d 单号逼顶 → switch（非停）·全池才停**（ADR-024 §2.2·原则 ④）——一个号的 7d 逼顶只是「换掉它」的信号，
//     只有整池都撞墙才停。这修了旧 pacing 单号 7d → hard_stop 的过刹车 bug。
//
// 池感知（ADR-024·原则 ①⑥）：verdict 不再只看 active 号 sidecar——传入 registry 时用 predictPoolUsage（备号
//   冻结投影·predict.ts 已建·复用）+ selectAccount（选号/全池耗尽判定）算出「能不能换 / 换给谁 / 是否全池撞墙」。
//   **全池聚合只在引擎**（红线2/3）：CLI handler 只读 accounts.json 传进来，聚合判定在此。
//
// 红线1：node/JS only，零 npm dep，纯算术 + 复用 predict/select 纯函数（**不碰 fs**——used% 由调用方注入·
//   读 sidecar / accounts.json 是 CLI handler 的事）。
// 红线3：出 verdict + 推荐 lever 类 + switch_candidate/nearest_reset，**不替 orchestrator 决策**（真动作归 A）。
// 确定性：纯函数，无随机、无时钟（now 由调用方注入）。

import { predictPoolUsage } from '../account/predict.js';
import type { Registry } from '../account/registry.js';
import { selectAccount } from '../account/select.js';

export type PacingVerdict = 'hold' | 'throttle' | 'switch' | 'stop_5h' | 'stop_7d';

// 一个配额窗口的账户权威信号（来自 status-line sidecar·account-authoritative·Finding #37）。
export interface WindowSignal {
  used_percentage?: number | null; // 该窗口已用 %（账户权威·null/缺 → 不可判）
  resets_at?: number | null; // reset 的 epoch 秒（缺 → 不判临近 reset / nearest）
}
export interface UsageSignal {
  five_hour?: WindowSignal | null;
  seven_day?: WindowSignal | null;
  captured_at?: number | null; // sidecar 捕获时刻（epoch 秒·保留字段·当前无欠用新鲜度闸）
}

export interface PacingOptions {
  nowSec?: number; // 当前 epoch 秒（默认 Date.now()/1000）
  nowIso?: string; // 当前 ISO（喂 predict/select·默认由 nowSec 派生）
  effectiveN?: number; // 号池有效配额份数（默认 1·由 CLI 从 registry 算好传入）
  registry?: Registry | null; // 号池 registry（池感知·predictPoolUsage + selectAccount 的输入）
  corridorHigh?: number; // 5h 临界阈（默认 90·≥此 = 5h critical）
  sevenDayHardStop?: number; // 7d 临界阈（默认 85·≥此 = 7d critical·对齐 select 7d 硬闸）
  warnLine?: number; // 警告线（默认 80·pre-critical 减速触发 + 备号「健康逃逸」判据）
}

export interface PacingAdvice {
  verdict: PacingVerdict;
  reason: string;
  levers: string[]; // 推荐 lever 类（不替决策·只给方向）
  strength: 'weak' | 'strong'; // ADR-018 力度（hook 直接消费·5h→weak / 7d→strong / switch→weak / stop→strong）
  window_5h_pct: number | null;
  window_7d_pct: number | null;
  effective_n: number;
  switch_candidate: string | null; // verdict=switch 时的目标切入号 email（select 选出·全池探针）
  stop_dimension: '5h' | '7d' | null; // verdict=stop_* 时撞的是哪个窗口
  nearest_reset: number | null; // stop 时最近一个 reset 的 epoch 秒（供 agent arm wakeup）
  available: boolean; // 账户信号是否可用（false → 调用方降级 / hook 静默）
  confidence: 'high' | 'medium' | 'low';
}

const DEFAULTS = {
  corridorHigh: 90,
  sevenDayHardStop: 85,
  warnLine: 80,
};

// pctOf(w, nowSec) → 该窗口的可判 used%（账户权威），否则 null。
//   过期闸：窗口 `resets_at != null && resets_at < nowSec` ⟹ 该 reset 周期已过、used% 已 stale（陈旧 sidecar
//   跨了 reset 边界）⟹ 视为**不可判**（返 null·该窗口不参与任何 verdict gating）。**窗口可判 used% 的 SSOT
//   谓词**（CLI handler `usage show` 复用同一口径判 current 窗口是否过期·避免 sibling 漂移）。
export function pctOf(w: WindowSignal | null | undefined, nowSec: number): number | null {
  if (!w || typeof w.used_percentage !== 'number') return null;
  if (typeof w.resets_at === 'number' && w.resets_at < nowSec) return null; // 已过期 → used% stale → 不可判
  return w.used_percentage;
}

// nearestFutureReset — 从一组 epoch 秒时刻里取最近一个 > now 的（stop verdict 吐给 agent arm wakeup）。
function nearestFutureReset(
  candidates: Array<number | null | undefined>,
  nowSec: number,
): number | null {
  let best: number | null = null;
  for (const c of candidates) {
    if (typeof c === 'number' && Number.isFinite(c) && c > nowSec) {
      if (best === null || c < best) best = c;
    }
  }
  return best;
}

// isoToSec — 严格 ISO → epoch 秒（predict.ts 的 resetsAt 是 ISO 字符串）；非法 → null。
function isoToSec(iso: string | undefined): number | null {
  if (typeof iso !== 'string' || !iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

const DEGRADED: PacingAdvice = {
  verdict: 'hold',
  reason: '账户权威信号不可用（5h/7d used% 均缺/过期）——降级，pacing 不可判',
  levers: [],
  strength: 'weak',
  window_5h_pct: null,
  window_7d_pct: null,
  effective_n: 1,
  switch_candidate: null,
  stop_dimension: null,
  nearest_reset: null,
  available: false,
  confidence: 'low',
};

// pacingAdvice(signal, opts) → 池感知 verdict（纯函数）。
//   优先级：① 7d 临界（switch 换掉 / 全池则 stop_7d）→ ② 5h 临界（switch 健康逃逸 / 全池则 stop_5h / 备号warm则
//   throttle）→ ③ 全池到警告线无健康逃逸（throttle）→ ④ hold。**砍掉 accelerate 欠用侧（ADR-024）。**
export function pacingAdvice(
  signal: UsageSignal | null | undefined,
  opts: PacingOptions = {},
): PacingAdvice {
  const o = { ...DEFAULTS, ...opts };
  const nowSec = opts.nowSec ?? Math.floor(Date.now() / 1000);
  const nowIso = opts.nowIso ?? new Date(nowSec * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const n =
    Number.isInteger(o.effectiveN) && (o.effectiveN as number) >= 1 ? (o.effectiveN as number) : 1;

  const p5 = pctOf(signal?.five_hour, nowSec);
  const p7 = pctOf(signal?.seven_day, nowSec);

  // 账户信号完全不可用（两窗口都无 used%）→ available:false（调用方降级 / hook 静默）。
  if (p5 === null && p7 === null) return { ...DEGRADED, effective_n: n };

  // ── 池感知：predictPoolUsage（备号冻结投影）+ selectAccount（选号 / 全池耗尽判定）───────────────────
  const registry = opts.registry ?? null;
  const live = {
    fiveHourPct: signal?.five_hour?.used_percentage ?? null,
    sevenDayPct: signal?.seven_day?.used_percentage ?? null,
    fiveHourResetsAt: null,
    sevenDayResetsAt: null,
  };
  const preds = registry ? predictPoolUsage(registry, { now: nowIso, live }) : [];
  const sel = registry
    ? selectAccount(registry, nowIso)
    : ({
        selected: null,
        reason: 'NONE_EMPTY_REGISTRY',
        candidates: [],
        warnings: [],
      } as ReturnType<typeof selectAccount>);
  const candidate = sel.reason === 'SELECTED' ? sel.selected : null;
  // 全池耗尽（换号探针·权威锚）：select 在「非 active 备号全命中硬闸（5h 或 7d 逼顶·无双窗口健康号）」时返 NONE_ALL_EXHAUSTED。
  const poolExhausted = sel.reason === 'NONE_ALL_EXHAUSTED';
  // 健康逃逸：选出的切入号预测 used%（max(5h,7d)）低于警告线 → 换号真能救。
  const best = candidate ? sel.candidates.find((c) => c.email === candidate) : undefined;
  const bestUsed =
    best && (best.p5 !== null || best.p7 !== null)
      ? Math.max(best.p5 ?? 0, best.p7 ?? 0)
      : candidate
        ? 0 // fresh 新号（无历史）视满血 → 健康
        : null;
  const healthyEscape = candidate !== null && bestUsed !== null && bestUsed < o.warnLine;

  // nearest reset 池（active 信号 + 备号投影的两窗口 reset）。
  const pool5hResets = [
    signal?.five_hour?.resets_at,
    ...preds.map((p) => isoToSec(p.fiveHour.resetsAt)),
  ];
  const pool7dResets = [
    signal?.seven_day?.resets_at,
    ...preds.map((p) => isoToSec(p.sevenDay.resetsAt)),
  ];

  const echo = {
    window_5h_pct: p5,
    window_7d_pct: p7,
    effective_n: n,
    available: true,
  };

  const active7dCrit = p7 !== null && p7 >= o.sevenDayHardStop;
  const active5hCrit = p5 !== null && p5 >= o.corridorHigh;

  // ── ① 7d 临界（最高优先）：换掉这个 7d 逼顶的号 / 全池则 stop_7d ──
  if (active7dCrit) {
    if (candidate && !poolExhausted) {
      return {
        ...echo,
        verdict: 'switch',
        reason: `active 号 7d 已用 ${p7}%（≥${o.sevenDayHardStop}%·逼顶）但池中有可切入备号 ${candidate}（7d 有余量）——换到下一份配额，非减速（7d 单号逼顶 → switch·全池才停）`,
        levers: ['switch_account'],
        strength: 'strong',
        switch_candidate: candidate,
        stop_dimension: null,
        nearest_reset: null,
        confidence: 'high',
      };
    }
    return {
      ...echo,
      verdict: 'stop_7d',
      reason: `active 号 7d 已用 ${p7}%（≥${o.sevenDayHardStop}%）且全池 7d 都撞墙 / 无可切入备号——跨窗口不可逆消耗边界，暂停 dispatch、把「是否续耗 7d」作 blocked_on:user surface 给用户；arm wakeup 到最近 7d reset`,
      levers: ['pause_dispatch', 'surface_user', 'arm_wakeup'],
      strength: 'strong',
      switch_candidate: null,
      stop_dimension: '7d',
      nearest_reset: nearestFutureReset(pool7dResets, nowSec),
      confidence: 'high',
    };
  }

  // ── ② 5h 临界：健康逃逸 → switch / 备号也 warm → throttle / 全池撞墙 → stop_5h ──
  if (active5hCrit) {
    if (healthyEscape && !poolExhausted) {
      return {
        ...echo,
        verdict: 'switch',
        reason: `active 号 5h 已用 ${p5}%（≥${o.corridorHigh}%）且池中有满血可切入备号 ${candidate}——当前 5h 烧满是切到下一份配额的触发信号，不是减速信号`,
        levers: ['switch_account'],
        strength: 'weak',
        switch_candidate: candidate,
        stop_dimension: null,
        nearest_reset: null,
        confidence: 'high',
      };
    }
    if (candidate && !poolExhausted) {
      // 有备号但也 warm（≥警告线）：换号只买一点点 → 减速更实在。
      return {
        ...echo,
        verdict: 'throttle',
        reason: `active 号 5h 已用 ${p5}%（≥${o.corridorHigh}%）且池中备号也接近警告线（换号收益有限）——减速避免烧穿`,
        levers: ['downgrade_model', 'reduce_parallelism', 'defer_high_float'],
        strength: 'weak',
        switch_candidate: candidate,
        stop_dimension: null,
        nearest_reset: null,
        confidence: 'high',
      };
    }
    return {
      ...echo,
      verdict: 'stop_5h',
      reason: `active 号 5h 已用 ${p5}%（≥${o.corridorHigh}%）且全池 5h 撞墙 / 无可切入备号——短停，arm wakeup 到最近 5h reset（窗口刷新即可续）`,
      levers: ['pause_dispatch', 'arm_wakeup'],
      strength: 'strong',
      switch_candidate: null,
      stop_dimension: '5h',
      nearest_reset: nearestFutureReset(pool5hResets, nowSec),
      confidence: 'high',
    };
  }

  // ── ③ 全池到警告线（无健康逃逸）：pre-critical 减速（5h 弱 / 7d 强 strength）──
  const activeWarn = (p5 !== null && p5 >= o.warnLine) || (p7 !== null && p7 >= o.warnLine);
  if (activeWarn && !healthyEscape) {
    const sevenDriven = p7 !== null && p7 >= o.warnLine;
    return {
      ...echo,
      verdict: 'throttle',
      reason: sevenDriven
        ? `7d 已用 ${p7}%（≥${o.warnLine}% 警告线）且无健康可切入备号——减速（7d 跨窗口·strong）`
        : `5h 已用 ${p5}%（≥${o.warnLine}% 警告线）且无健康可切入备号——减速（5h·weak）`,
      levers: ['downgrade_model', 'reduce_parallelism', 'defer_high_float'],
      strength: sevenDriven ? 'strong' : 'weak',
      switch_candidate: null,
      stop_dimension: null,
      nearest_reset: null,
      confidence: 'high',
    };
  }

  // ── ④ hold（警告线内 / 有健康逃逸兜底）──
  return {
    ...echo,
    verdict: 'hold',
    reason:
      p5 !== null
        ? `5h 用量 ${p5}% 在警告线内（<${o.warnLine}%）或有健康可切入备号——保持当前节奏`
        : '仅 7d 信号可用且有余量——保持当前节奏',
    levers: [],
    strength: 'weak',
    switch_candidate: candidate, // hold 时若有健康备号也 echo（agent 知道 lever 可用）
    stop_dimension: null,
    nearest_reset: null,
    confidence: p5 !== null ? 'high' : 'medium',
  };
}

// ── effective-N（号池·非 active 且 token 未过期的可切入备号数 + 1）─────────────────────────────────
// 纯函数版（收口 usage-pacing.js poolStatus 的「算」部分·读 accounts.json 是 CLI handler 的「读」部分）。
export interface PoolAccount {
  active?: boolean;
  switchable?: boolean;
  token_expires_at?: string | number | null;
}
export interface PoolStatus {
  backups: number; // 非 active 的号数
  switchable: number; // 可切入（未显式 switchable:false 且 token 未过期）
  effective_n: number; // switchable + 1
}

// tokenExpired(token_expires_at, nowMs) → token 是否已过期（**号池可切入判据的单一 SSOT**）。
//   过期 ⟺ token_expires_at 可解析为时戳 **且** < nowMs。无/坏 → null 时戳 → 视作「未知过期」按未过期处理
//   （保守·不因缺锚就排除一个号）。effectiveN（份数）与 usage handler 的 switchable/candidate 投影都复用它。
export function tokenExpired(v: string | number | null | undefined, nowMs: number): boolean {
  const exp = parseExp(v);
  return exp !== null && exp < nowMs;
}

// effectiveN(accounts, nowMs) → 号池有效配额份数（纯函数·accounts = registry 的 accounts map）。
//   null/空 → effective_n=1（单账号·与 usage-pacing.js 降级一致）。
export function effectiveN(
  accounts: Record<string, PoolAccount> | null | undefined,
  nowMs: number,
): PoolStatus {
  if (!accounts || typeof accounts !== 'object')
    return { backups: 0, switchable: 0, effective_n: 1 };
  let backups = 0;
  let switchable = 0;
  for (const entry of Object.values(accounts)) {
    if (!entry || typeof entry !== 'object') continue;
    if (entry.active === true) continue; // 当前在用号不算备号
    backups += 1;
    if (entry.switchable === false) continue; // 显式残缺号 → 不计 switchable
    if (tokenExpired(entry.token_expires_at, nowMs)) continue; // token 过期 → 不可切入（SSOT 谓词）
    switchable += 1;
  }
  return { backups, switchable, effective_n: switchable + 1 };
}

function parseExp(v: string | number | null | undefined): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v) {
    const ms = Date.parse(v);
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}
