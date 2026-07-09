import type { Notification, NotificationKind } from './inbox.js';
import type { PeerEntry } from './peers.js';
import { type PacingAdvice, pacingAdvice, pctOf, type UsageSignal } from '../usage/pacing.js';

export type QuotaModel = 'rolling-5h-7d' | 'billing-period' | 'primary-secondary';
export type PoolPressureBand = 'healthy' | 'warn' | 'critical' | 'exhausted';
export type PoolAllocationKind =
  | 'hold'
  | 'pacing_throttle'
  | 'pacing_yield'
  | 'pacing_claim'
  | 'pacing_switch'
  | 'pacing_stop';

// User-approved P4 calibration defaults. Keep all edge policy knobs beside the weights.
export const POOL_ARBITER_POLICY = {
  priorityWeights: { urgent: 8, high: 4, normal: 2, low: 1, trivial: 0.5 },
  warnUsedPct: 80,
  criticalUsedPct: 90,
  billingCriticalUsedPct: 85,
  hysteresisPct: 5,
  rowDeltaEpsilonPct: 2,
  notificationCooldownSec: 300,
  antiStarvationFloorPct: 1,
  notificationTtlSec: 4 * 60 * 60,
} as const;

export interface PoolPressure {
  headroom_pct: number;
  used_pct: number | null;
  nearest_reset: number | null;
  quota_model: QuotaModel;
  pollable: boolean;
  available: boolean;
  band: PoolPressureBand;
}

export interface PoolPressureOptions {
  nowSec?: number;
  quotaModel?: QuotaModel;
  pollable?: boolean;
  previousBand?: PoolPressureBand | null;
}

export interface AllocationPeer {
  board_file: string;
  goal: string;
  priority: string;
  session_id: string;
  current_burn_pct: number;
  weight: number;
}

export interface PoolAllocationRow {
  peer: AllocationPeer;
  kind: PoolAllocationKind;
  notification_kind: NotificationKind | null;
  strength: 'weak' | 'strong';
  target_headroom_pct: number;
  delta_headroom_pct: number;
  reason: string;
  dedup_key: string;
}

export interface PoolAllocation {
  mode: 'single-board' | 'pool';
  pressure: PoolPressure;
  base_advice: PacingAdvice;
  rows: PoolAllocationRow[];
  roster_signature: string;
  peer_count: number;
}

export interface AllocatePoolOptions {
  nowSec?: number;
  quotaModel?: QuotaModel;
  pollable?: boolean;
  effectiveN?: number;
  registry?: unknown;
  previousBand?: PoolPressureBand | null;
}

export interface ArbiterAppendDecision {
  append: boolean;
  reason: 'no-notification' | 'first' | 'dedup' | 'cooldown' | 'edge';
  latest_id: string | null;
}

function clampPct(n: number): number {
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0;
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function nearestFutureReset(candidates: Array<number | null | undefined>, nowSec: number): number | null {
  let best: number | null = null;
  for (const c of candidates) {
    if (typeof c !== 'number' || !Number.isFinite(c) || c <= nowSec) continue;
    if (best === null || c < best) best = c;
  }
  return best;
}
function rawBand(usedPct: number | null, quotaModel: QuotaModel): PoolPressureBand {
  if (usedPct === null) return 'healthy';
  if (usedPct >= 100) return 'exhausted';
  const critical =
    quotaModel === 'billing-period'
      ? POOL_ARBITER_POLICY.billingCriticalUsedPct
      : POOL_ARBITER_POLICY.criticalUsedPct;
  if (usedPct >= critical) return 'critical';
  if (usedPct >= POOL_ARBITER_POLICY.warnUsedPct) return 'warn';
  return 'healthy';
}
function bandWithHysteresis(
  usedPct: number | null,
  quotaModel: QuotaModel,
  previousBand: PoolPressureBand | null | undefined,
): PoolPressureBand {
  if (usedPct === null || !previousBand) return rawBand(usedPct, quotaModel);
  const criticalEnter =
    quotaModel === 'billing-period'
      ? POOL_ARBITER_POLICY.billingCriticalUsedPct
      : POOL_ARBITER_POLICY.criticalUsedPct;
  const criticalExit = criticalEnter - POOL_ARBITER_POLICY.hysteresisPct;
  const warnExit = POOL_ARBITER_POLICY.warnUsedPct - POOL_ARBITER_POLICY.hysteresisPct;
  if (previousBand === 'exhausted') return usedPct >= 100 ? 'exhausted' : rawBand(usedPct, quotaModel);
  if (previousBand === 'critical' && usedPct >= criticalExit) return 'critical';
  if (previousBand === 'warn' && usedPct >= warnExit && usedPct < criticalEnter) return 'warn';
  return rawBand(usedPct, quotaModel);
}

export function poolPressureFromUsage(
  signal: UsageSignal | null | undefined,
  opts: PoolPressureOptions = {},
): PoolPressure {
  const nowSec = opts.nowSec ?? Math.floor(Date.now() / 1000);
  const quotaModel = opts.quotaModel ?? 'rolling-5h-7d';
  const windows =
    quotaModel === 'billing-period' ? [signal?.billing_period] : [signal?.five_hour, signal?.seven_day];
  const pcts = windows.map((w) => pctOf(w, nowSec)).filter((pct): pct is number => typeof pct === 'number');
  const usedPct = pcts.length > 0 ? Math.max(...pcts) : null;
  const available = usedPct !== null;
  return {
    headroom_pct: available ? round2(100 - clampPct(usedPct)) : 100,
    used_pct: usedPct,
    nearest_reset: nearestFutureReset(windows.map((w) => w?.resets_at), nowSec),
    quota_model: quotaModel,
    pollable: opts.pollable !== false && available,
    available,
    band: bandWithHysteresis(usedPct, quotaModel, opts.previousBand),
  };
}

function priorityWeight(priority: string): number {
  const weights = POOL_ARBITER_POLICY.priorityWeights;
  if (priority === 'urgent') return weights.urgent;
  if (priority === 'high') return weights.high;
  if (priority === 'low') return weights.low;
  if (priority === 'trivial') return weights.trivial;
  return weights.normal;
}
function peerBurn(peer: PeerEntry): number {
  const burn = peer.current?.burn_contribution;
  return typeof burn === 'number' && Number.isFinite(burn) ? clampPct(burn) : 0;
}
function rosterSignature(peers: PeerEntry[]): string {
  return peers.map((p) => `${p.board_file}:${p.priority}:${priorityWeight(p.priority)}`).sort().join('|');
}
function mapPacingVerdict(advice: PacingAdvice): { kind: PoolAllocationKind; notificationKind: NotificationKind | null } {
  if (advice.verdict === 'hold') return { kind: 'hold', notificationKind: null };
  if (advice.verdict === 'throttle') return { kind: 'pacing_throttle', notificationKind: 'pacing_throttle' };
  if (advice.verdict === 'switch') return { kind: 'pacing_switch', notificationKind: 'pacing_switch' };
  return { kind: 'pacing_stop', notificationKind: 'pacing_stop' };
}
function rowDedupKey(peer: AllocationPeer, kind: PoolAllocationKind, pressure: PoolPressure, rosterSig: string, target: number): string {
  return ['pool-arbiter', peer.board_file, kind, pressure.quota_model, pressure.band, rosterSig, round2(target)].join('|');
}

export function allocatePool(
  signal: UsageSignal | null | undefined,
  peers: readonly PeerEntry[],
  opts: AllocatePoolOptions = {},
): PoolAllocation {
  const nowSec = opts.nowSec ?? Math.floor(Date.now() / 1000);
  const pressure = poolPressureFromUsage(signal, {
    nowSec,
    quotaModel: opts.quotaModel,
    pollable: opts.pollable,
    previousBand: opts.previousBand,
  });
  const baseAdvice = pacingAdvice(signal, { nowSec, effectiveN: opts.effectiveN, registry: opts.registry as never });
  const rosterSig = rosterSignature([...peers]);

  if (peers.length <= 1) {
    const peer = peers[0];
    const mapped = mapPacingVerdict(baseAdvice);
    const allocationPeer: AllocationPeer = {
      board_file: peer?.board_file ?? '',
      goal: peer?.goal ?? '',
      priority: peer?.priority ?? 'normal',
      session_id: peer?.session_id ?? '',
      current_burn_pct: peer ? peerBurn(peer) : 0,
      weight: peer ? priorityWeight(peer.priority) : POOL_ARBITER_POLICY.priorityWeights.normal,
    };
    return {
      mode: 'single-board',
      pressure,
      base_advice: baseAdvice,
      rows: [{
        peer: allocationPeer,
        kind: mapped.kind,
        notification_kind: mapped.notificationKind,
        strength: baseAdvice.strength,
        target_headroom_pct: pressure.headroom_pct,
        delta_headroom_pct: 0,
        reason: baseAdvice.reason,
        dedup_key: rowDedupKey(allocationPeer, mapped.kind, pressure, rosterSig, pressure.headroom_pct),
      }],
      roster_signature: rosterSig,
      peer_count: peers.length,
    };
  }

  const enriched = peers.map((peer) => ({ peer, weight: priorityWeight(peer.priority), burn: peerBurn(peer) }));
  const weightSum = enriched.reduce((sum, p) => sum + p.weight, 0) || 1;
  const targets = enriched.map((p) =>
    round2(Math.max(POOL_ARBITER_POLICY.antiStarvationFloorPct, (pressure.headroom_pct * p.weight) / weightSum)),
  );
  const deltas = enriched.map((p, i) => round2((targets[i] ?? 0) - p.burn));
  const hasOver = deltas.some((d) => d < -POOL_ARBITER_POLICY.rowDeltaEpsilonPct);
  const hasUnder = deltas.some((d) => d > POOL_ARBITER_POLICY.rowDeltaEpsilonPct);
  const baseMapped = mapPacingVerdict(baseAdvice);

  const rows = enriched.map((entry, i): PoolAllocationRow => {
    const target = targets[i] ?? 0;
    const delta = deltas[i] ?? 0;
    const allocationPeer: AllocationPeer = {
      board_file: entry.peer.board_file,
      goal: entry.peer.goal,
      priority: entry.peer.priority,
      session_id: entry.peer.session_id,
      current_burn_pct: entry.burn,
      weight: entry.weight,
    };
    let kind: PoolAllocationKind = 'hold';
    let notificationKind: NotificationKind | null = null;
    let strength: 'weak' | 'strong' = pressure.band === 'critical' ? 'strong' : 'weak';
    let reason = `当前 burn≈${entry.burn}% 接近目标份额 ${target}%（delta=${delta}%）——保持节奏`;
    if (baseMapped.kind === 'pacing_stop') {
      kind = 'pacing_stop';
      notificationKind = 'pacing_stop';
      strength = 'strong';
      reason = baseAdvice.reason;
    } else if (baseMapped.kind === 'pacing_switch' && delta < -POOL_ARBITER_POLICY.rowDeltaEpsilonPct) {
      kind = 'pacing_switch';
      notificationKind = 'pacing_switch';
      strength = baseAdvice.strength;
      reason = `${baseAdvice.reason}；本板 burn≈${entry.burn}% 高于目标 ${target}%（delta=${delta}%），优先切换/让出当前池压力`;
    } else if ((pressure.band === 'warn' || pressure.band === 'critical') && delta < -POOL_ARBITER_POLICY.rowDeltaEpsilonPct) {
      kind = hasUnder ? 'pacing_yield' : 'pacing_throttle';
      notificationKind = kind;
      reason = hasUnder
        ? `池压力 ${pressure.band}，本板 burn≈${entry.burn}% 高于加权目标 ${target}%（超 ${round2(-delta)}% headroom）——让路给欠额高价值 peer`
        : `池压力 ${pressure.band}，本板 burn≈${entry.burn}% 高于加权目标 ${target}%（超 ${round2(-delta)}% headroom）——减速避免池耗尽`;
    } else if (hasOver && hasUnder && delta > POOL_ARBITER_POLICY.rowDeltaEpsilonPct) {
      kind = 'pacing_claim';
      notificationKind = 'pacing_claim';
      strength = 'weak';
      reason = `本板 burn≈${entry.burn}% 低于加权目标 ${target}%（可认领 ${delta}% headroom），且同池存在超额 peer——可接住让出的配额`;
    }
    return {
      peer: allocationPeer,
      kind,
      notification_kind: notificationKind,
      strength,
      target_headroom_pct: target,
      delta_headroom_pct: delta,
      reason,
      dedup_key: rowDedupKey(allocationPeer, kind, pressure, rosterSig, target),
    };
  });
  return { mode: 'pool', pressure, base_advice: baseAdvice, rows, roster_signature: rosterSig, peer_count: peers.length };
}

function parseMs(iso: unknown): number | null {
  if (typeof iso !== 'string') return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}
function latestArbiterNotification(items: readonly Notification[]): Notification | null {
  let latest: Notification | null = null;
  let latestMs = -Infinity;
  for (const item of items) {
    if (item.payload?.producer !== 'coordination-arbiter') continue;
    const ms = parseMs(item.created_at) ?? -Infinity;
    if (ms > latestMs || (ms === latestMs && latest && item.id.localeCompare(latest.id) > 0)) {
      latest = item;
      latestMs = ms;
    }
  }
  return latest;
}
export function shouldAppendAllocationNotification(
  row: PoolAllocationRow,
  allocation: PoolAllocation,
  existing: readonly Notification[],
  nowMs: number,
): ArbiterAppendDecision {
  if (!row.notification_kind) return { append: false, reason: 'no-notification', latest_id: null };
  const latest = latestArbiterNotification(existing);
  if (!latest) return { append: true, reason: 'first', latest_id: null };
  if (latest.status === 'unconsumed' && latest.payload?.dedup_key === row.dedup_key) {
    return { append: false, reason: 'dedup', latest_id: latest.id };
  }
  const latestMs = parseMs(latest.created_at);
  if (latestMs !== null && nowMs - latestMs < POOL_ARBITER_POLICY.notificationCooldownSec * 1000) {
    return { append: false, reason: 'cooldown', latest_id: latest.id };
  }
  const prevTarget = typeof latest.payload?.target_headroom_pct === 'number' ? latest.payload.target_headroom_pct : null;
  const edge =
    latest.payload?.pressure_band !== allocation.pressure.band ||
    latest.payload?.roster_signature !== allocation.roster_signature ||
    latest.kind !== row.notification_kind ||
    prevTarget === null ||
    Math.abs(row.target_headroom_pct - prevTarget) > POOL_ARBITER_POLICY.rowDeltaEpsilonPct;
  return edge
    ? { append: true, reason: 'edge', latest_id: latest.id }
    : { append: false, reason: 'dedup', latest_id: latest.id };
}
