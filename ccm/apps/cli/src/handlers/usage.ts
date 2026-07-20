// handlers/usage.ts — usage noun handler（show / advise / task-cost·ADR-015 §2.6·plan §5/§7）。
//
// usage = 配额侧只读 advisory namespace（charter ②控制 token 消耗速度 + ⑤资源下最大化效率）。
//   · show       → runRead：当前号 + 全备号 5h/7d used%/resets_at（备号=accounts.json registry 生命周期快照）。
//   · advise     → runRead：单侧 verdict（hold|throttle|switch|stop_5h|stop_7d|stop_billing_period）+ lever + switch_candidate。
//   · task-cost  → runRead：单/聚合任务 token（读 board observability·shell=N/A·coverage_pct·--group-by）。
//
// 硬不变式（plan §2 不变式 1·硬约束）：**usage 是 provider read-only query**，不改 board/account/provider。
//   Cursor Agent show/advise 复用既有 machine observation store 的 TTL/原子 cache；备号数据**只读** accounts.json，
//   绝不碰 token、绝不 import account-management 的 JS（进程/包边界·plan §5）。
//
// 诚实降级（plan §2 行 26/69）：账户信号不可得 = exit 0 + `data.available:false`（非 exit 1）；
//   无 registry / 文件不存在 → 天然单账号·effective_n=1（优雅降级·不报错）。诚实字段：source /
//   confidence / as_of / coverage_pct / snapshot_stale。
//
// 红线1 / ADR-006：node/JS only，零 npm 依赖、纯 stdlib（fs + path）。消费 `@ccm/engine` 的 pacing 数学。
// 红线3：usage 出 verdict / 数据，**不替 orchestrator 决策**（真动作归 SKILL A·plan §2 不变式 2）。
// 武装闸豁免：纯 handler 模块（无 hook 入口）。

import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  boardRepo,
  type DoneRecord,
  effectiveN,
  extractDoneRecords,
  loadCorpus,
  type PacingOptions,
  pacingAdvice,
  pctBurnRate,
  pctOf,
  pctRunway,
  tokenExpired,
  type UsagePoolSignal,
  WINDOW_5H_SEC,
  WINDOW_7D_SEC,
  type WindowSignal,
} from '@ccm/engine';
import * as discover from '../discover.js';
import type { UsageRefreshHint, UsageSignalSource } from '../harnesses/types.js';
import {
  type MachineQuotaStore,
  readOrRefreshMachineQuotaSurfaceReading,
} from '../machine-wide-quota.js';
import { createQuotaAdmissionStore } from '../quota-admission-store.js';
import { quotaFilesystemFromBoundary } from '../quota-production-effects.js';
import { type UsageReading, usageReading } from '../usage-reading.js';
import { type BoardArg, type Ctx, runRead } from './_common.js';

// 备号窗口快照（registry SwitchSnapshot 投影）。
interface WindowSnap {
  used_pct: number | null;
  resets_at: string | null;
}
interface BackupAccount {
  email: string;
  active: boolean;
  switchable: boolean; // registry 意图：未显式 switchable:false（**不含**过期判定·见 token_expired）
  token_expired: boolean; // token_expires_at 已过期（复用引擎 tokenExpired SSOT·过期号不可作 switch_candidate·bug1）
  as_of: string | null;
  five_hour: WindowSnap;
  seven_day: WindowSnap;
  snapshot_stale: boolean;
  source: 'registry-snapshot';
}

// resolveHomeDir(env, homeFlag) → cc-master home **根**（统一全局口径·收口到 discover.resolveHome SSOT：
//   --home > $CC_MASTER_HOME > $HOME/.cc_master；不再 per-repo CLAUDE_PROJECT_DIR）。task-cost --scope
//   跨板用。注：accounts.json 的 registryPath 另有自己的 home 解析（home 根·全局·有意不动），不走本函数。
function resolveHomeDir(env: Record<string, string | undefined>, homeFlag?: string): string {
  return discover.resolveHome({ homeFlag, env });
}

// ── accounts.json registry 解析（只读·绝不写）──────────────────────────────────────────────────────
//   home 解析口径同 estimate.ts 的 resolveHomeDir：--home flag 先于 CC_MASTER_HOME 先于默认
//   $HOME/.cc_master（multi-home/dev/test 下 --home 必须生效，否则 effective_n 错·选错号·P2）。
//   无文件 / 坏 JSON / 非对象 → null（天然单账号优雅降级·不抛）。
function registryPath(env: Record<string, string | undefined>, homeFlag?: string): string {
  const home = discover.resolveHome({ homeFlag, env });
  return path.join(home, 'accounts.json');
}

function readRegistry(
  env: Record<string, string | undefined>,
  homeFlag?: string,
): Record<string, unknown> | null {
  const p = registryPath(env, homeFlag);
  let raw: string;
  try {
    raw = fs.readFileSync(p, 'utf8');
  } catch {
    return null; // 文件不存在 → 单账号
  }
  try {
    const obj = JSON.parse(raw);
    const accounts =
      obj && typeof obj === 'object' ? (obj as { accounts?: unknown }).accounts : null;
    if (!accounts || typeof accounts !== 'object' || Array.isArray(accounts)) return null;
    return accounts as Record<string, unknown>;
  } catch {
    return null; // 坏 JSON → 单账号降级
  }
}

// pickLatestSnapshot(entry) → 该账号「最新一份」配额快照（last_observed_quota / last_switch_out /
//   switch_history[] 里 at 最大的那条·plan §5）。无任何快照 → null。
function pickLatestSnapshot(entry: Record<string, unknown>): Record<string, unknown> | null {
  const cands: Array<Record<string, unknown>> = [];
  for (const key of ['last_observed_quota', 'last_switch_out']) {
    const s = entry[key];
    if (s && typeof s === 'object' && !Array.isArray(s)) cands.push(s as Record<string, unknown>);
  }
  if (Array.isArray(entry.switch_history)) {
    for (const s of entry.switch_history) {
      if (s && typeof s === 'object' && !Array.isArray(s)) cands.push(s as Record<string, unknown>);
    }
  }
  if (cands.length === 0) return null;
  // 取 at（ISO）最大的那条；缺 at 的排最后。
  let best: Record<string, unknown> | null = null;
  let bestMs = -Infinity;
  for (const s of cands) {
    const ms = typeof s.at === 'string' ? Date.parse(s.at) : Number.NaN;
    const v = Number.isFinite(ms) ? ms : -Infinity;
    if (v >= bestMs) {
      bestMs = v;
      best = s;
    }
  }
  return best;
}

// snapWindow(snap, key) → 从快照里取一个窗口（"5h" / "7d"）的 {used_pct, resets_at}。
function snapWindow(snap: Record<string, unknown> | null, key: '5h' | '7d'): WindowSnap {
  const w =
    snap && snap[key] && typeof snap[key] === 'object'
      ? (snap[key] as Record<string, unknown>)
      : null;
  const usedPct = w && typeof w.used_pct === 'number' ? w.used_pct : null;
  const resetsAt = w && typeof w.resets_at === 'string' ? w.resets_at : null;
  return { used_pct: usedPct, resets_at: resetsAt };
}

// staleByAge(asOf, nowMs) → 快照是否过期（as_of 距今 > 7 天·或对应窗口都已过 reset）。
//   保守阈：备号快照是生命周期投影（非实时），>7d 视作 stale（弱信号）。
function staleByAge(asOf: string | null, nowMs: number): boolean {
  if (!asOf) return true;
  const ms = Date.parse(asOf);
  if (!Number.isFinite(ms)) return true;
  const ageDays = (nowMs - ms) / 86400000;
  return ageDays > 7;
}

// readBackups(env, nowMs) → 全部账号的备号快照视图（含 active 号本身·plan §5）。
//   registry 缺失 → null（单账号·available:false）。
function readBackups(
  env: Record<string, string | undefined>,
  nowMs: number,
  homeFlag?: string,
): { accounts: BackupAccount[]; raw: Record<string, unknown> } | null {
  const accounts = readRegistry(env, homeFlag);
  if (!accounts) return null;
  const out: BackupAccount[] = [];
  for (const [email, rawEntry] of Object.entries(accounts)) {
    if (!rawEntry || typeof rawEntry !== 'object' || Array.isArray(rawEntry)) continue;
    const entry = rawEntry as Record<string, unknown>;
    const snap = pickLatestSnapshot(entry);
    const asOf = snap && typeof snap.at === 'string' ? snap.at : null;
    out.push({
      email,
      active: entry.active === true,
      switchable: entry.switchable !== false,
      // token_expired：复用引擎 tokenExpired（effectiveN 同款 SSOT 谓词·token_expires_at < now → 过期）。
      //   过期 token → 不可作 switch_candidate（advise）/ show 标记（bug1·sweep #2/#3）。
      token_expired: tokenExpired(
        (entry.token_expires_at ?? null) as string | number | null,
        nowMs,
      ),
      as_of: asOf,
      five_hour: snapWindow(snap, '5h'),
      seven_day: snapWindow(snap, '7d'),
      snapshot_stale: staleByAge(asOf, nowMs),
      source: 'registry-snapshot',
    });
  }
  // active 号排首，其余按 email 稳定排序。
  out.sort((a, b) => (a.active === b.active ? a.email.localeCompare(b.email) : a.active ? -1 : 1));
  return { accounts: out, raw: accounts };
}

// The reading value object is owned by the UsageReading domain service (usage-reading.ts); this
//   handler consumes it as-is. `CurrentUsageSignalReading` stays as a local alias to keep the many
//   render/recovery call sites unchanged while the single authoritative shape lives in one place.
type CurrentUsageSignalReading = UsageReading;

// ── unavailable recovery hint rendering helpers (shared across show / advise / burn-rate / runway) ──
//   Surface the actionable remedy so users/agents see "run X, then recheck" instead of a bare unknown.
function recoveryLine(reading: CurrentUsageSignalReading): string | null {
  const hint = reading.refreshHint;
  return hint?.recoverable && hint.remedy ? `  → ${hint.remedy}` : null;
}
function recoveryHintForJson(reading: CurrentUsageSignalReading): UsageRefreshHint | null {
  return reading.refreshHint ?? null;
}

function usageAgentSummary(
  reading: CurrentUsageSignalReading,
  current: {
    available: boolean;
    five_hour: WindowSignal | null;
    seven_day: WindowSignal | null;
    fable_seven_day: WindowSignal | null;
    billing_period: WindowSignal | null;
    pools: UsagePoolSignal[];
  },
): string {
  const prefix = reading.harnessId;
  if (current.available) {
    const facts = [
      current.five_hour?.used_percentage != null
        ? `5h=${fmtPct(current.five_hour.used_percentage)}`
        : null,
      current.seven_day?.used_percentage != null
        ? `7d=${fmtPct(current.seven_day.used_percentage)}`
        : null,
      current.fable_seven_day?.used_percentage != null
        ? `fable_7d=${fmtPct(current.fable_seven_day.used_percentage)}`
        : null,
      current.billing_period?.used_percentage != null
        ? `billing_period=${fmtPct(current.billing_period.used_percentage)}`
        : null,
      ...current.pools
        .filter((pool) => pool.used_percentage != null)
        .map((pool) => `${pool.id}=${fmtPct(pool.used_percentage)}`),
    ].filter((fact): fact is string => fact !== null);
    return `${prefix}: available${facts.length ? ` · ${facts.join(' ')}` : ''}`;
  }
  const hint = reading.refreshHint;
  const reason = hint?.reason || reading.unavailableReason || '用量信号不可用';
  if (hint?.agent_authorized && hint.command) {
    return `${prefix}: UNAVAILABLE (${reason}) · 你被授权运行 \`${hint.command}\` 刷新后重查 · 见 refresh_hint`;
  }
  if (hint?.command) {
    return `${prefix}: UNAVAILABLE (${reason}) · 需要用户运行 \`${hint.command}\` 后重查 · 见 refresh_hint`;
  }
  return `${prefix}: UNAVAILABLE (${reason}) · 等待或 surface 用户 · 不可自刷${hint ? ' · 见 refresh_hint' : ''}`;
}

// cursorAgentRequested — delegate to the domain service so the surface-selection predicate has one
//   definition (show/advise use it to decide the async shared-store path).
const cursorAgentRequested = usageReading.cursorAgentRequested;

// readCurrentUsageSignal — thin handler-side alias onto the UsageReading domain service's ambient read.
//   Every usage render path (show/advise/burn-rate/runway) reads through here → through the one service,
//   which owns harness resolution + the cursor-agent cache-first strategy (no adapter access in-handler).
function readCurrentUsageSignal(
  env: Record<string, string | undefined>,
  harnessFlag?: string,
  homeFlag?: string,
): CurrentUsageSignalReading {
  return usageReading.readCurrent({ env, harnessFlag, homeFlag });
}

// readSharedCurrentUsageSignal — cursor-agent live shared-store read (refreshes the authoritative
//   observation store once, so adjacent commands share a live read). Non-cursor-agent / no collectors
//   fall straight back to the domain service. Projection + fallback reuse the same service helper so
//   the machine-cache reading shape stays single-sourced.
async function readSharedCurrentUsageSignal(
  ctx: Ctx,
  harnessFlag?: string,
  homeFlag?: string,
): Promise<CurrentUsageSignalReading> {
  if (!cursorAgentRequested(harnessFlag) || !ctx.machineQuotaCollectors) {
    return readCurrentUsageSignal(ctx.env, harnessFlag, homeFlag);
  }
  const home = resolveHomeDir(ctx.env, homeFlag);
  const store = createQuotaAdmissionStore({
    home,
    ...(ctx.quotaEffects ? { filesystem: quotaFilesystemFromBoundary(ctx.quotaEffects) } : {}),
  }) as MachineQuotaStore;
  const reading = await readOrRefreshMachineQuotaSurfaceReading({
    surfaceId: 'cursor-agent-cli',
    env: ctx.env,
    store,
    collectors: ctx.machineQuotaCollectors,
  });
  return (
    usageReading.projectMachineCacheReading(reading) ?? {
      signal: null,
      source: 'unavailable',
      unavailableReason: 'Cursor Agent machine-wide quota cache 不可用或已过期',
      refreshHint: null,
      harnessId: 'cursor',
      harnessLabel: 'Cursor Agent',
      usageSource: { kind: 'dashboard-api', pollable: true, quotaModel: 'billing-period' },
    }
  );
}

// effectiveNFromRegistry(env, nowMs, homeFlag) → 号池有效配额份数（复用引擎 effectiveN 纯函数）。无 registry → 1。
function effectiveNFromRegistry(
  env: Record<string, string | undefined>,
  nowMs: number,
  homeFlag?: string,
): number {
  const accounts = readRegistry(env, homeFlag);
  if (!accounts) return 1;
  return effectiveN(accounts as never, nowMs).effective_n;
}

// asOfSec(ctx) → --as-of（ISO-8601 UTC）解析为 epoch 秒，否则 Date.now()/1000（backtest 用·仿 estimate nowMsOf）。
function asOfSec(ctx: Ctx): number {
  const asOf = ctx.values['as-of'];
  if (typeof asOf === 'string' && asOf) {
    const ms = Date.parse(asOf);
    if (Number.isFinite(ms)) return Math.floor(ms / 1000);
  }
  return Math.floor(Date.now() / 1000);
}

// asOfISOFromSec(sec) → 严格 ISO-8601 UTC（去毫秒）。
function asOfISOFromSec(sec: number): string {
  return new Date(sec * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

// ── 偿付力：配额%-burn-rate / runway（账户权威·window-elapsed）─────────────────────────────────────
// 一个窗口的 burn-rate 视图（show/advise 之外的成本流维·plan §4·ADR-015 延伸）。
export interface WindowBurnView {
  used_pct: number | null; // 当前已用%（过期/缺 → null·复用 pctOf SSOT）
  resets_at: number | null; // 该窗口 reset 时刻（epoch 秒·透传）
  burn_pct_per_hour: number | null; // %/小时（window-elapsed·不可算 → null）
  method: string; // finite-diff | window-elapsed | none
  confidence: 'high' | 'medium' | 'low';
  source: UsageSignalSource;
  unavailable_reason: string | null;
  harness: string;
}

// accountBurnRate(env, nowSec, windowSec, win) → 当前账户某窗口的 %-burn-rate（window-elapsed·账户权威）。
//   **单一 SSOT**：usage burn-rate/runway handler 与 estimate cost-to-complete 都复用它（estimate 消费 usage
//   融合·plan §5），不让窗口数学在两处漂移。读当前 harness 的账户用量信号 → pctOf 取非过期 used% →
//   pctBurnRate(window-elapsed，窗口起点 = resets_at − windowSec)。used% 不可判 → 全 null（降级·标 available:false）。
export function accountBurnRate(
  env: Record<string, string | undefined>,
  nowSec: number,
  windowSec: number,
  win: 'five_hour' | 'seven_day' = 'five_hour',
  harnessFlag?: string,
): WindowBurnView {
  const reading = readCurrentUsageSignal(env, harnessFlag);
  const usage = reading.signal;
  const w = (win === 'five_hour' ? usage?.five_hour : usage?.seven_day) ?? null;
  const used = pctOf(w, nowSec); // 过期/缺 → null
  const resetsAt = w && typeof w.resets_at === 'number' ? w.resets_at : null;
  if (used == null) {
    return {
      used_pct: null,
      resets_at: resetsAt,
      burn_pct_per_hour: null,
      method: 'none',
      confidence: 'low',
      source: reading.source,
      unavailable_reason: reading.unavailableReason,
      harness: reading.harnessLabel,
    };
  }
  const windowStartSec = resetsAt != null ? resetsAt - windowSec : null;
  const atSec = usage && typeof usage.captured_at === 'number' ? usage.captured_at : nowSec;
  const br = pctBurnRate([{ atSec, usedPct: used }], { windowStartSec });
  return {
    used_pct: used,
    resets_at: resetsAt,
    burn_pct_per_hour: br.burn_pct_per_hour,
    method: br.method,
    confidence: br.confidence,
    source: reading.source,
    unavailable_reason: null,
    harness: reading.harnessLabel,
  };
}

// ── usage show ──────────────────────────────────────────────────────────────
//   当前号 + 全备号 5h/7d used%/resets_at（备号=registry 生命周期快照·标 as_of/snapshot_stale）。
//   --accounts all|current（默认 all）；信号不可得 = exit 0 + available:false。
export function show(ctx: Ctx): number | Promise<number> {
  const homeFlag = ctx.values.home as string | undefined;
  const harnessFlag = ctx.values.harness as string | undefined;
  if (cursorAgentRequested(harnessFlag)) {
    return readSharedCurrentUsageSignal(ctx, harnessFlag, homeFlag).then((currentUsage) =>
      renderShow(ctx, currentUsage),
    );
  }
  return renderShow(ctx);
}

function renderShow(ctx: Ctx, currentUsageOverride?: CurrentUsageSignalReading): number {
  return runRead(ctx, {
    // usage show 不需要 active board（号池是用户级·跨板）——自定义 resolve 兜空板，避免无板时 exit 5。
    resolve: () => ({ boardPath: '', board: {} }),
    render: (_b, c) => {
      const nowMs = Date.now();
      const nowSec = Math.floor(nowMs / 1000);
      const accountsScope = (c.values.accounts as string) || 'all';
      const homeFlag = c.values.home as string | undefined;
      const harnessFlag = c.values.harness as string | undefined;
      const currentUsage =
        currentUsageOverride ?? readCurrentUsageSignal(c.env, harnessFlag, homeFlag);
      const sidecar = currentUsage.signal;
      const backups = readBackups(c.env, nowMs, homeFlag);
      // --effective-n 覆写优先；否则从 registry 算（与 advise 一致·#audit：show 此前广告了 --effective-n 但忽略）。
      const enFlag = c.values['effective-n'];
      const en =
        typeof enFlag === 'string' && Number.isInteger(Number(enFlag)) && Number(enFlag) >= 1
          ? Number(enFlag)
          : effectiveNFromRegistry(c.env, nowMs, homeFlag);

      // current 窗口过期闸（codex round-4 #bug1）：show 与 advise(pacingAdvice) 口径一致——
      //   复用引擎 `pctOf`（同一 SSOT 谓词：`resets_at < now` 的窗口 used% 视 stale → null），
      //   绝不「sidecar 存在就 available:true」无脑放行陈旧数据。`available` 反映「≥1 个非过期窗口
      //   有有效 used%」（两窗都过期/缺 → available:false）。下游 cc-usage.sh / switch-account.sh 据此判可用。
      //   每窗口投影成 {used_percentage（过期→null）, resets_at（原样保留·透明）}；5h/7d 各自独立判（同 pctOf 逐窗）。
      const projectWindow = (
        w: WindowSignal | null | undefined,
      ): { used_percentage: number | null; resets_at: number | null } | null => {
        if (!w) return null;
        const fresh = pctOf(w, nowSec); // 非过期且有效 → 数值；过期/缺 → null
        return { used_percentage: fresh, resets_at: w.resets_at ?? null };
      };
      const cur5h = sidecar ? projectWindow(sidecar.five_hour) : null;
      const cur7d = sidecar ? projectWindow(sidecar.seven_day) : null;
      const curFable7d = sidecar ? projectWindow(sidecar.fable_seven_day) : null;
      const curBilling = sidecar ? projectWindow(sidecar.billing_period) : null;
      const curPools = sidecar?.pools
        ? sidecar.pools.map((pool) => ({
            id: pool.id,
            label: pool.label,
            kind: pool.kind,
            ...projectWindow(pool),
          }))
        : [];
      // 至少一个非过期窗口有有效 used% → 账户口径可用。
      const currentAvailable =
        sidecar != null &&
        ((cur5h?.used_percentage ?? null) !== null ||
          (cur7d?.used_percentage ?? null) !== null ||
          (curFable7d?.used_percentage ?? null) !== null ||
          (curBilling?.used_percentage ?? null) !== null ||
          curPools.some((pool) => (pool.used_percentage ?? null) !== null));
      const current = sidecar
        ? {
            source: currentUsage.source,
            available: currentAvailable,
            five_hour: cur5h,
            seven_day: cur7d,
            fable_seven_day: curFable7d,
            billing_period: curBilling,
            pools: curPools,
            captured_at: sidecar.captured_at ?? null,
          }
        : {
            source: currentUsage.source,
            available: false,
            five_hour: null,
            seven_day: null,
            fable_seven_day: null,
            billing_period: null,
            pools: [],
            captured_at: null,
          };

      const accountList =
        backups == null
          ? []
          : accountsScope === 'current'
            ? backups.accounts.filter((a) => a.active)
            : backups.accounts;

      const data = {
        // available 反映**当前账户信号**（= current.available·≥1 个非过期窗口有有效 used%）——**不**被 registry
        //   备号快照单独点亮（round7 #P3）：备号快照是生命周期投影（陈旧·非实时配额），若 registry 存在就把顶层
        //   available 翻 true，调用方会把过期备号快照误当「当前」可用配额信号。registry 存在性已由 `registry_present`
        //   + `accounts` 独立暴露（保持不变）；available 只回答「当前号配额信号现在可用吗」这一问题。
        available: current.available,
        accounts_scope: accountsScope,
        effective_n: en,
        agent_summary: usageAgentSummary(currentUsage, current),
        current,
        accounts: accountList,
        registry_present: backups != null,
        as_of:
          current.captured_at != null
            ? new Date(current.captured_at * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z')
            : null,
        source: backups != null ? 'registry-snapshot' : currentUsage.source,
        confidence: current.available ? 'high' : backups != null ? 'medium' : 'low',
        // Actionable recovery hint when the current account signal is unavailable (e.g. kimi token
        //   expired → which kimi command self-refreshes it + how to recheck). null when available or
        //   not user-recoverable. Surfaced top-level so it's visible, not buried.
        refresh_hint: current.available ? null : recoveryHintForJson(currentUsage),
      };

      if (c.flags.json) return JSON.stringify({ ok: true, data });

      const lines: string[] = [];
      lines.push(`usage show（effective_n=${en}·accounts=${accountsScope}）`);
      if (current.available) {
        const p5 = current.five_hour?.used_percentage;
        const p7 = current.seven_day?.used_percentage;
        const pFable7d = current.fable_seven_day?.used_percentage;
        const billing = current.billing_period?.used_percentage;
        const label =
          currentUsage.source === 'codex-app-server' ? 'Codex app-server' : 'account 权威';
        const fablePart = pFable7d != null ? ` fable_7d=${fmtPct(pFable7d)}` : '';
        lines.push(
          `  current（${label}）: 5h=${fmtPct(p5)} 7d=${fmtPct(p7)}${fablePart}${billing != null ? ` billing_period=${fmtPct(billing)}` : ''}`,
        );
      } else {
        lines.push(
          `  current: 账户权威信号不可用（${currentUsage.unavailableReason}·available:false·降级）`,
        );
        const recovery = recoveryLine(currentUsage);
        if (recovery) lines.push(recovery);
      }
      if (backups == null) {
        lines.push('  备号: 无 accounts.json registry（单账号·effective_n=1）');
      } else if (accountList.length === 0) {
        lines.push('  备号: registry 存在但无可列账号');
      } else {
        for (const a of accountList) {
          // 备号可切性 = switchable!==false **且** token 未过期（与 advise switch_candidate / effectiveN 同口径·bug1）。
          //   过期 token 的备号标 [backup·token过期] 而非 [backup]——别让用户以为它可切（sweep #3）。
          const tag = a.active
            ? '[active]'
            : !a.switchable
              ? '[backup·不可切]'
              : a.token_expired
                ? '[backup·token过期]'
                : '[backup]';
          const stale = a.snapshot_stale ? '·stale' : '';
          lines.push(
            `  ${tag} ${a.email}: 5h=${fmtPct(a.five_hour.used_pct)} 7d=${fmtPct(a.seven_day.used_pct)} (as_of=${a.as_of ?? 'N/A'}${stale}·registry-snapshot)`,
          );
        }
      }
      return `${lines.join('\n')}\n`;
    },
  });
}

function fmtPct(p: number | null | undefined): string {
  return typeof p === 'number' ? `${p}%` : 'N/A';
}

// ── usage advise ──────────────────────────────────────────────────────────────
//   单侧 verdict + 推荐 lever + switch_candidate（收口 usage-pacing 数学·引擎 pacingAdvice）。
export function advise(ctx: Ctx): number | Promise<number> {
  const homeFlag = ctx.values.home as string | undefined;
  const harnessFlag = ctx.values.harness as string | undefined;
  if (cursorAgentRequested(harnessFlag)) {
    return readSharedCurrentUsageSignal(ctx, harnessFlag, homeFlag).then((currentUsage) =>
      renderAdvice(ctx, currentUsage),
    );
  }
  return renderAdvice(ctx);
}

function renderAdvice(ctx: Ctx, currentUsageOverride?: CurrentUsageSignalReading): number {
  return runRead(ctx, {
    resolve: () => ({ boardPath: '', board: {} }),
    render: (_b, c) => {
      const nowMs = Date.now();
      const nowSec = Math.floor(nowMs / 1000);
      const homeFlag = c.values.home as string | undefined;
      const harnessFlag = c.values.harness as string | undefined;
      const currentUsage =
        currentUsageOverride ?? readCurrentUsageSignal(c.env, harnessFlag, homeFlag);
      const sidecar = currentUsage.signal;
      // --effective-n 覆写优先；否则从 registry 算。
      const enFlag = c.values['effective-n'];
      const accountsMap = readRegistry(c.env, homeFlag);
      const en =
        typeof enFlag === 'string' && Number.isInteger(Number(enFlag)) && Number(enFlag) >= 1
          ? Number(enFlag)
          : accountsMap
            ? effectiveN(accountsMap as never, nowMs).effective_n
            : 1;

      // 池感知 verdict（ADR-024）：把 registry 传进引擎，pacingAdvice 用 predictPoolUsage + selectAccount
      //   算 switch/stop（全池聚合只在引擎·红线2/3）。switch_candidate / nearest_reset / stop_dimension /
      //   strength 都由引擎返回，handler 只透传（不再本地重算 candidate——收口到引擎 select SSOT）。
      const opts: PacingOptions = {
        nowSec,
        effectiveN: en,
        registry: accountsMap ? ({ accounts: accountsMap } as never) : null,
      };
      const advice = pacingAdvice(sidecar, opts);

      const data = {
        verdict: advice.verdict,
        reason: advice.reason,
        levers: advice.levers,
        strength: advice.strength,
        stop_dimension: advice.stop_dimension,
        nearest_reset: advice.nearest_reset,
        window_5h_pct: advice.window_5h_pct,
        window_7d_pct: advice.window_7d_pct,
        window_billing_period_pct: advice.window_billing_period_pct,
        billing_period_resets_at: sidecar?.billing_period?.resets_at ?? null,
        effective_n: advice.effective_n,
        switch_candidate: advice.switch_candidate,
        confidence: advice.confidence,
        source: advice.available ? currentUsage.source : 'local-derived-approx',
        as_of:
          sidecar && typeof sidecar.captured_at === 'number'
            ? new Date(sidecar.captured_at * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z')
            : null,
        available: advice.available,
        // Actionable recovery hint when the account signal is unavailable (mirrors show·top-level·
        //   e.g. kimi token expired → `kimi -p 'hi'` self-refresh + recheck). null when available.
        refresh_hint: advice.available ? null : recoveryHintForJson(currentUsage),
      };

      if (c.flags.json) return JSON.stringify({ ok: true, data });
      const bpPart =
        data.window_billing_period_pct != null
          ? ` billing_period=${fmtPct(data.window_billing_period_pct)}`
          : '';
      const lines = [
        `usage advise: ${data.verdict}（effective_n=${data.effective_n}·strength=${data.strength}·confidence=${data.confidence}）`,
        `  reason: ${data.reason}`,
        `  5h=${fmtPct(data.window_5h_pct)} 7d=${fmtPct(data.window_7d_pct)}${bpPart}${data.stop_dimension ? `·stop=${data.stop_dimension}` : ''}`,
      ];
      if (data.levers.length) lines.push(`  levers: ${data.levers.join(', ')}`);
      if (data.switch_candidate) lines.push(`  switch_candidate: ${data.switch_candidate}`);
      if (data.nearest_reset)
        lines.push(`  nearest_reset: ${asOfISOFromSec(data.nearest_reset)}（arm wakeup）`);
      if (!data.available) {
        lines.push('  （账户权威信号不可用·source=local-derived-approx·pacing 降级）');
        const recovery = recoveryLine(currentUsage);
        if (recovery) lines.push(recovery);
      }
      return `${lines.join('\n')}\n`;
    },
  });
}

// ── usage burn-rate ──────────────────────────────────────────────────────────────
//   配额%-burn-rate（Δused%/Δtime·账户权威·window-elapsed）——成本流维（plan §4）。5h + 7d 各一个。
//   信号不可得 = exit 0 + available:false（诚实降级·非 exit 1）。--as-of 支持（backtest·影响窗口已逝时间）。
export function burnRate(ctx: Ctx): number {
  return runRead(ctx, {
    // 配额信号是用户级（跨板）——兜空板避免无板 exit 5（同 show/advise）。
    resolve: () => ({ boardPath: '', board: {} }),
    render: (_b, c) => {
      const nowSec = asOfSec(c);
      const harnessFlag = c.values.harness as string | undefined;
      const fiveHour = accountBurnRate(c.env, nowSec, WINDOW_5H_SEC, 'five_hour', harnessFlag);
      const sevenDay = accountBurnRate(c.env, nowSec, WINDOW_7D_SEC, 'seven_day', harnessFlag);
      const available = fiveHour.used_pct != null || sevenDay.used_pct != null;
      const currentUsage = readCurrentUsageSignal(c.env, harnessFlag);
      const capturedAt = currentUsage.signal?.captured_at ?? null;
      const confidence: 'high' | 'medium' | 'low' =
        fiveHour.used_pct != null
          ? fiveHour.confidence
          : sevenDay.used_pct != null
            ? sevenDay.confidence
            : 'low';

      const data = {
        available,
        five_hour: fiveHour,
        seven_day: sevenDay,
        source: available ? currentUsage.source : 'local-derived-approx',
        as_of:
          typeof capturedAt === 'number'
            ? asOfISOFromSec(capturedAt)
            : available
              ? asOfISOFromSec(nowSec)
              : null,
        confidence,
        refresh_hint: available ? null : recoveryHintForJson(currentUsage),
      };

      if (c.flags.json) return JSON.stringify({ ok: true, data });
      const lines = [`usage burn-rate（账户权威·%/h·confidence=${confidence}）`];
      const fmtBurn = (v: WindowBurnView): string =>
        v.burn_pct_per_hour != null
          ? `${v.burn_pct_per_hour}%/h（used=${fmtPct(v.used_pct)}·${v.method}）`
          : `N/A（used=${fmtPct(v.used_pct)}）`;
      lines.push(`  5h: ${fmtBurn(fiveHour)}`);
      lines.push(`  7d: ${fmtBurn(sevenDay)}`);
      if (!available) {
        lines.push(
          `  （账户权威信号不可用·${currentUsage.unavailableReason}·available:false·降级）`,
        );
        const recovery = recoveryLine(currentUsage);
        if (recovery) lines.push(recovery);
      }
      return `${lines.join('\n')}\n`;
    },
  });
}

// ── usage runway ──────────────────────────────────────────────────────────────
//   配额% runway：剩余走廊空间 ÷ burn → 距触顶 vs 距 reset（偿付力 headroom·plan §4）。
//   5h 走廊上界 90（临界阈·pacing DEFAULTS）；7d 用 85（硬总闸）。--as-of 支持。信号缺 → available:false 降级。
export function runway(ctx: Ctx): number {
  return runRead(ctx, {
    resolve: () => ({ boardPath: '', board: {} }),
    render: (_b, c) => {
      const nowSec = asOfSec(c);
      const perWindow = (view: WindowBurnView, ceiling: number) => {
        if (view.used_pct == null) {
          return {
            used_pct: null,
            burn_pct_per_hour: null,
            remaining_corridor_pct: null,
            hours_to_ceiling: null,
            hours_to_reset: null,
            verdict: 'unknown' as const,
            ceiling_pct: ceiling,
          };
        }
        const rw = pctRunway({
          usedPct: view.used_pct,
          burnPctPerHour: view.burn_pct_per_hour,
          ceilingPct: ceiling,
          resetsAtSec: view.resets_at,
          nowSec,
        });
        return { used_pct: view.used_pct, ...rw };
      };

      const harnessFlag = c.values.harness as string | undefined;
      const fiveView = accountBurnRate(c.env, nowSec, WINDOW_5H_SEC, 'five_hour', harnessFlag);
      const sevenView = accountBurnRate(c.env, nowSec, WINDOW_7D_SEC, 'seven_day', harnessFlag);
      const fiveHour = perWindow(fiveView, 90);
      const sevenDay = perWindow(sevenView, 85);
      const available = fiveView.used_pct != null || sevenView.used_pct != null;
      const currentUsage = readCurrentUsageSignal(c.env, harnessFlag);
      const capturedAt = currentUsage.signal?.captured_at ?? null;

      const data = {
        available,
        five_hour: fiveHour,
        seven_day: sevenDay,
        source: available ? currentUsage.source : 'local-derived-approx',
        as_of:
          typeof capturedAt === 'number'
            ? asOfISOFromSec(capturedAt)
            : available
              ? asOfISOFromSec(nowSec)
              : null,
        confidence: available ? (fiveView.used_pct != null ? fiveView.confidence : 'low') : 'low',
        refresh_hint: available ? null : recoveryHintForJson(currentUsage),
      };

      if (c.flags.json) return JSON.stringify({ ok: true, data });
      const lines = [`usage runway（剩余走廊 ÷ burn → 距触顶 vs 距 reset）`];
      const fmtRw = (r: ReturnType<typeof perWindow>): string =>
        r.used_pct == null
          ? `N/A（账户信号不可用）`
          : `remaining=${fmtPct(r.remaining_corridor_pct)}（上界 ${r.ceiling_pct}%）·to_ceiling=${fmtH(r.hours_to_ceiling)}·to_reset=${fmtH(r.hours_to_reset)}·${r.verdict}`;
      lines.push(`  5h: ${fmtRw(fiveHour)}`);
      lines.push(`  7d: ${fmtRw(sevenDay)}`);
      if (!available) {
        lines.push(
          `  （账户权威信号不可用·${currentUsage.unavailableReason}·available:false·降级）`,
        );
        const recovery = recoveryLine(currentUsage);
        if (recovery) lines.push(recovery);
      }
      return `${lines.join('\n')}\n`;
    },
  });
}

// fmtH(h) → "Nh" 或 N/A（runway 时间用·小时）。
function fmtH(h: number | null | undefined): string {
  return typeof h === 'number' && Number.isFinite(h) ? `${h}h` : 'N/A';
}

// ── usage task-cost ──────────────────────────────────────────────────────────────
//   单/聚合任务 token（读 board observability·shell=N/A·coverage_pct·--group-by）。
//   单任务：[<task-id>] positional；聚合：--group-by task|executor|type|tier。
export function taskCost(ctx: Ctx): number {
  return runRead(ctx, {
    render: (board, c) => {
      const b = board as BoardArg;
      const records = extractDoneRecords(b);
      const taskId = c.positionals[0];
      const groupBy = (c.values['group-by'] as string) || 'task';
      // --scope（#audit：此前广告了 home|this-repo|this-board 但忽略·永远读本板）。
      //   默认 this-board（registry 文档口径·读本板全 tasks 含非 done → 能标 N/A）；
      //   home / this-repo → 跨板读归档 done 任务的 observability token（DoneRecord 载 tokensIn/Out）。
      const scope = (c.values.scope as string) || 'this-board';
      const homeFlag = c.values.home as string | undefined;

      type CostRow = {
        id: string;
        executor: string;
        type: string;
        tier: string;
        tokens_in: number | null;
        tokens_out: number | null;
        total: number | null;
        na: boolean;
      };

      let rows: CostRow[];
      if (scope === 'home' || scope === 'this-repo') {
        // 跨板：从 home 语料抽 DoneRecord（已含 tokensIn/Out·executor/type/tier）；this-repo 过滤同 repo。
        let corpus: DoneRecord[] = [];
        try {
          // board 集中在 <home>/boards/（loadCorpus 读给定目录·layout-agnostic）。
          corpus = loadCorpus(discover.boardsDir(resolveHomeDir(c.env, homeFlag)));
        } catch {
          corpus = [];
        }
        if (scope === 'this-repo') {
          const repo = boardRepo(b);
          corpus = corpus.filter((r) => r.repo === repo);
        }
        rows = corpus.map((r) => {
          const total =
            r.tokensIn == null && r.tokensOut == null
              ? null
              : (r.tokensIn ?? 0) + (r.tokensOut ?? 0);
          return {
            id: r.taskId,
            executor: r.executor,
            type: r.type,
            tier: r.tier,
            tokens_in: r.tokensIn,
            tokens_out: r.tokensOut,
            total,
            na: total == null,
          };
        });
      } else {
        // this-board（默认）：全 board 任务（含非 done·读 observability·shell/无 token=N/A）——用 raw tasks 才能标 N/A vs 缺。
        const tasks: Array<Record<string, unknown>> = Array.isArray(b?.tasks)
          ? (b.tasks as Array<Record<string, unknown>>)
          : [];
        // 提取每任务 token（input+output·缺/shell → null）。
        rows = tasks.map((t) => {
          const id = typeof t.id === 'string' ? t.id : '';
          const executor = typeof t.executor === 'string' ? t.executor : '';
          const type = typeof t.type === 'string' ? t.type : '';
          const tier = typeof t.tier === 'string' ? t.tier : '';
          const obs =
            t.observability && typeof t.observability === 'object'
              ? (t.observability as { tokens?: { input?: unknown; output?: unknown } })
              : null;
          const tok = obs?.tokens && typeof obs.tokens === 'object' ? obs.tokens : null;
          const tin = tok && typeof tok.input === 'number' ? tok.input : null;
          const tout = tok && typeof tok.output === 'number' ? tok.output : null;
          const total = tin == null && tout == null ? null : (tin ?? 0) + (tout ?? 0);
          // executor=shell（历史枚举·v2 已无，但旧板可能有）/ 无 token → N/A（诚实标注）。
          const isNA = total == null;
          return { id, executor, type, tier, tokens_in: tin, tokens_out: tout, total, na: isNA };
        });
      }

      const covered = rows.filter((r) => !r.na).length;
      const coveragePct = rows.length > 0 ? Math.round((covered / rows.length) * 100) : 0;

      // 单任务模式。
      if (taskId) {
        const row = rows.find((r) => r.id === taskId);
        const data = {
          task: taskId,
          scope,
          found: !!row,
          tokens: row ? { input: row.tokens_in, output: row.tokens_out, total: row.total } : null,
          na: row ? row.na : true,
          source: 'observability' as const,
          confidence: row && !row.na ? 'high' : 'low',
        };
        if (c.flags.json) return JSON.stringify({ ok: true, data });
        if (!row) return `usage task-cost ${taskId}: 任务不存在\n`;
        return row.na
          ? `usage task-cost ${taskId}: N/A（无 observability token·shell 任务或未遥测）\n`
          : `usage task-cost ${taskId}: total=${row.total} (in=${row.tokens_in}, out=${row.tokens_out})·source=observability\n`;
      }

      // 聚合模式（--group-by）。
      const groups = new Map<string, { sum: number; n: number; na: number }>();
      const keyOf = (r: (typeof rows)[number]): string => {
        if (groupBy === 'executor') return r.executor || '(none)';
        if (groupBy === 'type') return r.type || '(none)';
        if (groupBy === 'tier') return r.tier || '(none)';
        return r.id;
      };
      for (const r of rows) {
        const k = keyOf(r);
        const g = groups.get(k) || { sum: 0, n: 0, na: 0 };
        g.n += 1;
        if (r.na) g.na += 1;
        else g.sum += r.total as number;
        groups.set(k, g);
      }
      const grouped = [...groups.entries()]
        .map(([key, g]) => ({ key, total: g.sum, n: g.n, na_count: g.na }))
        .sort((a, b) => b.total - a.total || a.key.localeCompare(b.key));

      const data = {
        group_by: groupBy,
        scope,
        groups: grouped,
        total: grouped.reduce((s, g) => s + g.total, 0),
        coverage_pct: coveragePct,
        history_n: scope === 'this-board' ? records.length : rows.length,
        source: 'observability' as const,
        confidence: coveragePct >= 50 ? 'medium' : 'low',
      };
      if (c.flags.json) return JSON.stringify({ ok: true, data });
      const lines = [
        `usage task-cost（group-by=${groupBy}·coverage_pct=${coveragePct}%·total=${data.total} tok）`,
      ];
      for (const g of grouped) {
        const naTag = g.na_count > 0 ? `·${g.na_count} N/A` : '';
        lines.push(`  ${g.key}: ${g.total} tok (${g.n} tasks${naTag})`);
      }
      if (coveragePct < 50)
        lines.push('  （coverage<50%·token 遥测稀疏·聚合仅供参考·confidence=low）');
      return `${lines.join('\n')}\n`;
    },
  });
}
