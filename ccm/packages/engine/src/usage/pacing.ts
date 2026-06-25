// pacing.ts — 双侧目标走廊 pacing 数学 SSOT（ADR-010 / ADR-015 §2.6 收口·plan §7）。
//
// 把散在 usage-pacing.js（hook）/ cc-usage.sh / cost-and-pacing.md 三处的走廊数学收口成一份纯函数引擎
//   （plan §8：usage-pacing.js hook 改为 shell 调 `ccm usage advise`·引擎成走廊数学 SSOT）。
//
// 双侧目标走廊（ADR-010）：5h reset 窗口的 used% 有个目标区间（默认 70–90%）——
//   · used% 太低 + 临近 reset + 7d 有余量 → accelerate（欠用侧·别让配额白白蒸发）。
//   · used% 太高 → throttle（临界侧·减速避免烧穿）。
//   · 区间内 → hold。
//   · 7d used% 达硬总闸（默认 85%）→ hard_stop（跨窗口加速硬总闸·ADR-010 §2.2：7d 是不可逆消耗边界，
//     暂停 dispatch、surface 用户）——**7d 总闸优先于 5h 一切判定**（别把 5h 余量烧成 7d 透支）。
//
// effective-N（号池·plan §5）：N 份可序列消费的配额 → 单账号该以 ~N 倍速烧，欠用判定线按 N 抬高
//   （effective_ceil = min(95, ceil × N)·封顶 95），把「N 倍速」直觉翻译成 used% 节奏。
//
// 红线1：node/JS only，零 npm dep，纯算术（**不碰 fs**——5h/7d used% 由调用方注入·读 sidecar 是 CLI handler 的事）。
// 红线3：出 verdict + 推荐 lever 类，**不替 orchestrator 决策**（真动作归 A·plan §2 不变式 2）。
// 确定性：纯函数，无随机、无时钟（now 由调用方注入）。

export type PacingVerdict = 'accelerate' | 'hold' | 'throttle' | 'hard_stop';

// 一个配额窗口的账户权威信号（来自 status-line sidecar·account-authoritative·Finding #37）。
export interface WindowSignal {
  used_percentage?: number | null; // 该窗口已用 %（账户权威·null/缺 → 不可判）
  resets_at?: number | null; // reset 的 epoch 秒（缺 → 不判临近 reset）
}
export interface UsageSignal {
  five_hour?: WindowSignal | null;
  seven_day?: WindowSignal | null;
  captured_at?: number | null; // sidecar 捕获时刻（epoch 秒·新鲜度闸用）
}

export interface PacingOptions {
  nowSec?: number; // 当前 epoch 秒（默认 Date.now()/1000）
  effectiveN?: number; // 号池有效配额份数（默认 1）
  corridorLow?: number; // 5h 走廊下界（欠用阈·默认 70）
  corridorHigh?: number; // 5h 走廊上界（临界阈·默认 90）
  sevenDayHardStop?: number; // 7d 硬总闸（默认 85）
  underuseRemainMin?: number; // 临近 reset 的剩余分钟阈（默认 60·只在欠用侧要求）
  sevenDayHeadroom?: number; // 加速需 7d 余量阈（默认 80）
  maxStaleMin?: number; // sidecar 新鲜度上限（分钟·默认 15·只欠用侧要求·见不对称论证）
}

export interface PacingAdvice {
  verdict: PacingVerdict;
  reason: string;
  levers: string[]; // 推荐 lever 类（不替决策·只给方向）
  hard_stop_7d: boolean;
  window_5h_pct: number | null;
  window_7d_pct: number | null;
  effective_n: number;
  available: boolean; // 账户信号是否可用（false → 调用方降级 / 标 approx）
  confidence: 'high' | 'medium' | 'low';
}

const DEFAULTS = {
  corridorLow: 70,
  corridorHigh: 90,
  sevenDayHardStop: 85,
  underuseRemainMin: 60,
  sevenDayHeadroom: 80,
  maxStaleMin: 15,
};

function pctOf(w: WindowSignal | null | undefined): number | null {
  return w && typeof w.used_percentage === 'number' ? w.used_percentage : null;
}

// pacingAdvice(signal, opts) → 双侧走廊 verdict（纯函数·收口 usage-pacing.js 数学）。
//   优先级：① 7d 硬总闸（hard_stop·压一切）→ ② 5h 临界（throttle）→ ③ 5h 欠用（accelerate·多闸 AND）→ ④ hold。
export function pacingAdvice(
  signal: UsageSignal | null | undefined,
  opts: PacingOptions = {},
): PacingAdvice {
  const o = { ...DEFAULTS, ...opts };
  const nowSec = opts.nowSec ?? Math.floor(Date.now() / 1000);
  const n =
    Number.isInteger(o.effectiveN) && (o.effectiveN as number) >= 1 ? (o.effectiveN as number) : 1;

  const p5 = pctOf(signal?.five_hour);
  const p7 = pctOf(signal?.seven_day);

  // 账户信号完全不可用（两窗口都无 used%）→ available:false（调用方降级本地反推·标 approx）。
  if (p5 === null && p7 === null) {
    return {
      verdict: 'hold',
      reason: '账户权威信号不可用（5h/7d used% 均缺）——降级，pacing 不可判',
      levers: [],
      hard_stop_7d: false,
      window_5h_pct: null,
      window_7d_pct: null,
      effective_n: n,
      available: false,
      confidence: 'low',
    };
  }

  // ── ① 7d 硬总闸（最高优先·压一切·ADR-010 §2.2）──
  if (p7 !== null && p7 >= o.sevenDayHardStop) {
    return {
      verdict: 'hard_stop',
      reason: `7d 配额硬总闸：7d 已用 ${p7}%（≥${o.sevenDayHardStop}%）——跨窗口不可逆消耗边界，暂停 dispatch 新节点、把「是否续耗 7d」作 blocked_on:user surface 给用户`,
      levers: [
        'pause_dispatch',
        'surface_user',
        ...(n > 1 ? ['switch_account_user_decision'] : []),
      ],
      hard_stop_7d: true,
      window_5h_pct: p5,
      window_7d_pct: p7,
      effective_n: n,
      available: true,
      confidence: 'high',
    };
  }

  // ── ② 5h 临界（throttle·used% 超走廊上界）──
  if (p5 !== null && p5 >= o.corridorHigh) {
    const sevenDayKnownHeadroom = p7 !== null && p7 < o.sevenDayHeadroom;
    // n>1 且 7d 确认有余量 → 5h 烧满是「切下一份配额」信号，不是减速（ADR-010 欠用/切号侧）。
    if (n > 1 && sevenDayKnownHeadroom) {
      return {
        verdict: 'accelerate',
        reason: `5h 已用 ${p5}%（≥${o.corridorHigh}%）但你有 ${n} 份可序列消费配额且 7d 仅 ${p7}%——当前 5h 烧满是切到下一份配额的触发信号，不是减速信号`,
        levers: ['switch_account', 'continue_dispatch'],
        hard_stop_7d: false,
        window_5h_pct: p5,
        window_7d_pct: p7,
        effective_n: n,
        available: true,
        confidence: 'high',
      };
    }
    return {
      verdict: 'throttle',
      reason: `5h 已用 ${p5}%（≥${o.corridorHigh}% 走廊上界）——减速避免烧穿当前窗口`,
      levers: ['downgrade_model', 'reduce_parallelism', 'defer_high_float'],
      hard_stop_7d: false,
      window_5h_pct: p5,
      window_7d_pct: p7,
      effective_n: n,
      available: true,
      confidence: 'high',
    };
  }

  // ── ③ 5h 欠用（accelerate·多闸 AND·保守·缺一即 hold）──
  // 欠用判定线按 effective-N 抬高（封顶 95）：n 份配额并行 → 同一剩余时间该烧得更多。
  const underuseCeil = Math.min(95, o.corridorLow * n);
  const f5 = signal?.five_hour;
  if (p5 !== null && p5 < underuseCeil) {
    // 闸 a：临近 reset（resets_at 有效且剩余 ≤ underuseRemainMin）。
    const resetsAt = f5 && typeof f5.resets_at === 'number' ? f5.resets_at : null;
    const remainMin = resetsAt != null ? (resetsAt - nowSec) / 60 : null;
    const nearReset = remainMin != null && remainMin > 0 && remainMin <= o.underuseRemainMin;
    // 闸 b：7d 有余量（7d 缺失 → 保守不加速）。
    const sevenDayOk = p7 !== null && p7 < o.sevenDayHeadroom;
    // 闸 c：sidecar 新鲜（captured_at 距今 ≤ maxStaleMin·只欠用侧要求·stale-low p5 误催加速危险方向）。
    const fresh =
      typeof signal?.captured_at === 'number' && nowSec - signal.captured_at <= o.maxStaleMin * 60;
    if (nearReset && sevenDayOk && fresh) {
      return {
        verdict: 'accelerate',
        reason: `5h 仅用 ${p5}%（欠用阈 ${underuseCeil}%）、约 ${Math.round(remainMin as number)}min 后 reset、7d 总闸有余量（${p7}%）——配额将随 reset 蒸发，可加速充分利用`,
        levers: ['upgrade_model_critical_path', 'increase_parallelism', 'pull_forward_ready'],
        hard_stop_7d: false,
        window_5h_pct: p5,
        window_7d_pct: p7,
        effective_n: n,
        available: true,
        confidence: 'medium',
      };
    }
  }

  // ── ④ 走廊内 / 加速闸未全过 → hold ──
  return {
    verdict: 'hold',
    reason:
      p5 !== null
        ? `5h 用量 ${p5}% 在走廊内（${o.corridorLow}–${o.corridorHigh}%）或加速前置条件未全满足——保持当前节奏`
        : '仅 7d 信号可用且有余量——保持当前节奏',
    levers: [],
    hard_stop_7d: false,
    window_5h_pct: p5,
    window_7d_pct: p7,
    effective_n: n,
    available: true,
    confidence: p5 !== null ? 'high' : 'medium',
  };
}

// ── effective-N（号池·plan §5：非 active 且 token 未过期的可切入备号数 + 1）─────────────────────────
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
    const exp = parseExp(entry.token_expires_at);
    if (exp !== null && exp < nowMs) continue; // token 过期 → 不可切入
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
