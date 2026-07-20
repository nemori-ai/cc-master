// usage-reading.ts — UsageReading domain service（配额侧当前用量读取的**单一权威入口**·DDD 收敛）。
//
// DDD 分层（本模块是 domain service，坐在 application handler 与 infrastructure adapter 之间）：
//   · Domain      —— `UsageSignal`（@ccm/engine 的纯值对象）+ 本模块的 `UsageReading` 规范值对象。
//   · Infrastructure —— 每个 harness 的 `HarnessAdapter.readCurrentUsage[ForSurface]`（读 statusline
//     sidecar / codex app-server / cursor dashboard / kimi /usages 各一套·**per-harness 各异**·不强统一）。
//   · Application  —— usage / quota / coordination / router collect / account 各 handler，**只经本服务读**，
//     不再各自散调 adapter / wrapper / machine-wide cache。
//
// 命门：每个 harness 全局统一自己那一套 usage 读策略（读哪个源、怎么归一），各命令空间**复用同一入口**——
//   本服务是那个入口。它封装：① harness 解析（env/flag）② cursor-agent 的 machine-wide cache-first + surface
//   偏好 ③ 规范值对象组装（含 harness 身份 + usageSource + 诚实降级字段）。真动作 / verdict 归上层（红线3）。
//
// 硬不变式：usage 是 provider read-only query——本服务绝不写 board/account/provider、绝不碰 token。
//   信号不可得 = 返回 signal:null + 诚实 unavailableReason/refreshHint（非抛错·由 handler 决定 exit 0 降级）。
//   红线1 / ADR-006：node/JS only·零 npm 依赖·纯 stdlib。

import type { UsageSignal } from '@ccm/engine';
import * as discover from './discover.js';
import { knownHarnessAdapters, resolveHarnessAdapter } from './harnesses/registry.js';
import type {
  CurrentQuotaAuthorityRefs,
  CurrentUsageReading,
  Env,
  HarnessUsageSource,
  UsageRefreshHint,
  UsageSignalSource,
} from './harnesses/types.js';
import { readMachineWideQuotaStatusCached } from './machine-wide-quota.js';

/**
 * Canonical usage-reading value object every command space consumes. It supersets the per-harness
 * adapter return (`CurrentUsageReading`) with resolved harness identity + the harness usage-source
 * descriptor, so a single read answers "which harness, what signal, how fresh, how to recover".
 */
export interface UsageReading {
  signal: UsageSignal | null;
  source: UsageSignalSource;
  unavailableReason: string;
  // Actionable recovery hint when the signal is unavailable due to a manually-refreshable short-lived
  // credential (kimi-code). null for persistent-credential harnesses / cursor cache staleness.
  refreshHint: UsageRefreshHint | null;
  harnessId: string;
  harnessLabel: string;
  // Per-harness quota-source descriptor (kind / pollable / quotaModel) — coordination pacing reads it.
  usageSource: HarnessUsageSource;
  // Owner-only authenticated scope refs (machine-wide collect path); never expose to agent payloads.
  authority?: CurrentQuotaAuthorityRefs;
  authSource?: string;
  quotaScopeFingerprint?: string | null;
}

export interface AmbientUsageRequest {
  env: Env;
  harnessFlag?: string;
  homeFlag?: string;
}

export interface SurfaceUsageRequest {
  env: Env;
  harnessId: string;
  surfaceId: string;
}

// cursorAgentRequested — 显式请求 cursor-agent headless worker surface（与裸 `--harness cursor` 区分：
//   后者由 adapter.readCurrentUsage 自己在 agent/IDE surface 间择优）。
export function cursorAgentRequested(harnessFlag?: string): boolean {
  const requested = String(harnessFlag ?? '')
    .trim()
    .toLowerCase()
    .replaceAll('_', '-');
  return requested === 'cursor-agent' || requested === 'cursor-agent-cli';
}

// toUsageReading — 把一个 per-harness adapter 的 CurrentUsageReading 补齐成规范 UsageReading（贴上 harness
//   身份 + usageSource·统一诚实字段的 null 默认）。这是 infrastructure→domain 值对象的唯一归一点。
function toUsageReading(
  harnessId: string,
  harnessLabel: string,
  usageSource: HarnessUsageSource,
  reading: CurrentUsageReading,
): UsageReading {
  return {
    signal: reading.signal,
    source: reading.source,
    unavailableReason: reading.unavailableReason,
    refreshHint: reading.refreshHint ?? null,
    harnessId,
    harnessLabel,
    usageSource,
    ...(reading.authority ? { authority: reading.authority } : {}),
    ...(reading.authSource !== undefined ? { authSource: reading.authSource } : {}),
    ...(reading.quotaScopeFingerprint !== undefined
      ? { quotaScopeFingerprint: reading.quotaScopeFingerprint }
      : {}),
  };
}

// projectMachineCacheReading — 把一行 machine-wide cached reading（cursor-agent surface 的廉价缓存投影）
//   转成规范 UsageReading。缓存不可用 / 越界 / 已过期 → undefined（由 caller 回落 fresh adapter 读）。
//   语义与 usage show/advise 历史 cursor-agent 分支一致：只填 billing_period 窗口 + 收集器身份。
export function projectMachineCacheReading(
  reading: Record<string, unknown> | undefined,
): UsageReading | undefined {
  const record = (reading ?? {}) as Record<string, any>;
  const used = record.used_percentage;
  const resetMs = typeof record.resets_at === 'string' ? Date.parse(record.resets_at) : Number.NaN;
  const observedMs =
    typeof record.observed_at === 'string' ? Date.parse(record.observed_at) : Number.NaN;
  const validUntilMs =
    typeof record.valid_until === 'string' ? Date.parse(record.valid_until) : Number.NaN;
  if (
    typeof used !== 'number' ||
    !Number.isFinite(used) ||
    used < 0 ||
    used > 100 ||
    !Number.isFinite(resetMs) ||
    !Number.isFinite(observedMs) ||
    !Number.isFinite(validUntilMs) ||
    validUntilMs < Date.now()
  ) {
    return undefined;
  }
  return {
    signal: {
      five_hour: null,
      seven_day: null,
      billing_period: {
        used_percentage: used,
        resets_at: Math.floor(resetMs / 1000),
      },
      captured_at: Math.floor(observedMs / 1000),
    },
    source: String(record?.source?.collector_id ?? 'cursor-agent-dashboard'),
    unavailableReason: 'Cursor Agent machine-wide quota cache 不可用或已过期',
    refreshHint: null, // machine-quota cache staleness is not a user-refreshable credential state.
    harnessId: 'cursor',
    harnessLabel: 'Cursor Agent',
    usageSource: { kind: 'dashboard-api', pollable: true, quotaModel: 'billing-period' },
  };
}

// readCurrent — 当前 harness 的当前（激活号）用量读取（usage show/advise/burn-rate/runway·coordination
//   pacing·account 当前号都经此入口）。cursor-agent 先试 machine-wide cache 廉价投影，缺则回落 adapter fresh 读；
//   其余 harness 直接走各自 adapter.readCurrentUsage（per-harness 策略各异）。
export function readCurrent(req: AmbientUsageRequest): UsageReading {
  const { env, harnessFlag, homeFlag } = req;
  const wantsCursorAgent = cursorAgentRequested(harnessFlag);
  if (wantsCursorAgent) {
    const home = discover.resolveHome({ homeFlag, env });
    const status = readMachineWideQuotaStatusCached(home);
    const cached = Array.isArray(status.readings)
      ? status.readings.find(
          (candidate: Record<string, any>) => candidate?.target?.surface_id === 'cursor-agent-cli',
        )
      : undefined;
    const projected = projectMachineCacheReading(cached);
    if (projected) return projected;
  }
  const adapter = resolveHarnessAdapter({ env, harnessFlag });
  const reading =
    wantsCursorAgent && adapter.readCurrentUsageForSurface
      ? adapter.readCurrentUsageForSurface('cursor-agent-cli', env)
      : adapter.readCurrentUsage(env);
  return toUsageReading(adapter.id, adapter.displayName, adapter.usageSource(env), reading);
}

// readSurface — 指定 harness + surface 的定向读取（machine-wide collect / fresh 填充用·按 TARGETS 的
//   default_collector_harness 选 adapter，不走 ambient 解析）。harness 未知 → null（caller 判 not-installed）。
export function readSurface(req: SurfaceUsageRequest): UsageReading | null {
  const { env, harnessId, surfaceId } = req;
  const adapter = knownHarnessAdapters().find((candidate) => candidate.id === harnessId);
  if (!adapter) return null;
  const reading = adapter.readCurrentUsageForSurface
    ? adapter.readCurrentUsageForSurface(surfaceId, env)
    : adapter.readCurrentUsage(env);
  return toUsageReading(adapter.id, adapter.displayName, adapter.usageSource(env), reading);
}

// The domain service, grouped so consumers read through one authoritative object.
export const usageReading = {
  readCurrent,
  readSurface,
  projectMachineCacheReading,
  cursorAgentRequested,
} as const;
