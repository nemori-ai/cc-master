import type { UsageSignal, WindowSignal } from '@ccm/engine';
import {
  canonicalJson,
  deriveQuotaHeadroom,
  evaluateQuotaObservation,
  sha256Hex,
} from '@ccm/engine';
import {
  deliverCoordinationNotification,
  listCurrentCoordinationSubscriptions,
} from './handlers/coordination.js';
import { knownHarnessAdapters } from './harnesses/registry.js';
import type { CurrentUsageReading, Env } from './harnesses/types.js';
import { projectMachineWideQuotaNotifications } from './machine-wide-quota-notification.js';

type Data = Record<string, any>;

interface MachineQuotaTarget {
  harnessId: string;
  surfaceId: string;
  providerId: string;
  payerScope: string;
  poolRef: string;
  bucketId: string;
  windowName: 'five_hour' | 'seven_day' | 'billing_period';
  durationSec: number;
  policyRevision: string;
  hardCeiling: number;
  warningLine: number;
  collectorId: string;
  defaultCollectorHarness: string | null;
}

export interface MachineQuotaCollection {
  status: 'refreshed' | 'unknown' | 'unsupported' | 'error';
  signal?: UsageSignal | null;
  source?: string;
  reason?: string;
}

export interface MachineQuotaCollectorBoundary {
  collect(
    target: Readonly<Data>,
    env: Env,
  ): MachineQuotaCollection | Promise<MachineQuotaCollection>;
}

export interface MachineQuotaStore {
  readObservation(sourceKey: string): Promise<Data | undefined>;
  refreshObservation(request: Readonly<Data>, collect: () => Promise<Data>): Promise<Data>;
  readMachineProjection(): Promise<Data | undefined>;
  publishMachineProjection(projection: Readonly<Data>): Promise<Data>;
}

const TARGETS: readonly MachineQuotaTarget[] = Object.freeze([
  {
    harnessId: 'codex',
    surfaceId: 'codex-cli',
    providerId: 'codex',
    payerScope: 'subscription',
    poolRef: 'pool:opaque-codex-current',
    bucketId: 'seven-day-global',
    windowName: 'seven_day',
    durationSec: 604_800,
    policyRevision: 'ccm/codex-7d-pacing/v1',
    hardCeiling: 85,
    warningLine: 80,
    collectorId: 'codex-app-server',
    defaultCollectorHarness: 'codex',
  },
  {
    harnessId: 'claude-code',
    surfaceId: 'claude-cli',
    providerId: 'anthropic',
    payerScope: 'subscription',
    poolRef: 'pool:opaque-claude-current',
    bucketId: 'five-hour-global',
    windowName: 'five_hour',
    durationSec: 18_000,
    policyRevision: 'ccm/claude-5h-pacing/v1',
    hardCeiling: 90,
    warningLine: 80,
    collectorId: 'claude-statusline-sidecar',
    defaultCollectorHarness: 'claude-code',
  },
  {
    harnessId: 'claude-code',
    surfaceId: 'claude-cli',
    providerId: 'anthropic',
    payerScope: 'subscription',
    poolRef: 'pool:opaque-claude-current',
    bucketId: 'seven-day-global',
    windowName: 'seven_day',
    durationSec: 604_800,
    policyRevision: 'ccm/claude-7d-pacing/v1',
    hardCeiling: 85,
    warningLine: 80,
    collectorId: 'claude-statusline-sidecar',
    defaultCollectorHarness: 'claude-code',
  },
  {
    harnessId: 'cursor',
    surfaceId: 'cursor-ide-plugin',
    providerId: 'cursor',
    payerScope: 'subscription',
    poolRef: 'pool:opaque-cursor-ide-current',
    bucketId: 'billing-period-ide',
    windowName: 'billing_period',
    durationSec: 2_592_000,
    policyRevision: 'ccm/cursor-billing-period/v1',
    hardCeiling: 85,
    warningLine: 80,
    collectorId: 'cursor-dashboard',
    defaultCollectorHarness: 'cursor',
  },
  {
    harnessId: 'cursor',
    surfaceId: 'cursor-agent-cli',
    providerId: 'cursor',
    payerScope: 'subscription',
    poolRef: 'pool:opaque-cursor-agent-current',
    bucketId: 'billing-period-agent',
    windowName: 'billing_period',
    durationSec: 2_592_000,
    policyRevision: 'ccm/cursor-agent-billing-period/v1',
    hardCeiling: 85,
    warningLine: 80,
    collectorId: 'cursor-agent-quota',
    // Cursor Agent auth/quota is an independent surface. The IDE dashboard must never be inherited.
    defaultCollectorHarness: null,
  },
]);

function digest(value: unknown): string {
  return `sha256:${sha256Hex(canonicalJson(value))}`;
}

function strictIso(epochSec: number): string {
  return new Date(epochSec * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function targetScope(target: MachineQuotaTarget): Data {
  return {
    harness_id: target.harnessId,
    surface_id: target.surfaceId,
    provider_id: target.providerId,
    payer_scope: target.payerScope,
    pool_ref: target.poolRef,
    bucket_id: target.bucketId,
    window: {
      kind: target.windowName === 'billing_period' ? 'billing-cycle' : 'rolling',
      name: target.windowName,
      duration_sec: target.durationSec,
    },
  };
}

function scopeDigest(target: MachineQuotaTarget): string {
  return digest(targetScope(target));
}

function sourceKey(target: MachineQuotaTarget): string {
  return `machine-wide/${target.harnessId}/${target.surfaceId}/${target.windowName}`;
}

function signalWindow(
  signal: UsageSignal | null | undefined,
  name: MachineQuotaTarget['windowName'],
): WindowSignal | null {
  return signal?.[name] ?? null;
}

function buildObservation(
  target: MachineQuotaTarget,
  collection: MachineQuotaCollection,
  now: Date,
): Data {
  const nowSec = Math.floor(now.getTime() / 1000);
  const window = signalWindow(collection.signal, target.windowName);
  const used = window?.used_percentage;
  const capturedAt = collection.signal?.captured_at;
  const observedSec =
    typeof capturedAt === 'number' && Number.isFinite(capturedAt) ? Math.floor(capturedAt) : nowSec;
  const observedAt = strictIso(observedSec);
  const validUntil = strictIso(observedSec + 300);
  const resetAt =
    typeof window?.resets_at === 'number' && Number.isFinite(window.resets_at)
      ? strictIso(Math.floor(window.resets_at))
      : undefined;
  const usable =
    collection.status === 'refreshed' &&
    typeof used === 'number' &&
    Number.isFinite(used) &&
    used >= 0 &&
    used <= 100;
  const semantic = {
    target: targetScope(target),
    status: usable ? 'ok' : collection.status,
    used_pct: usable ? used : null,
    reset_marker: resetAt ?? null,
    source: collection.source ?? target.collectorId,
  };
  const aggregationKey = `${target.providerId}/${target.surfaceId}/${target.bucketId}`;
  return {
    schema: 'ccm/quota-authority-observation/v1',
    source_key: sourceKey(target),
    source_revision: digest(semantic),
    observation_status: usable ? 'ok' : collection.status,
    provider: target.providerId,
    provider_rule_revision: target.policyRevision,
    account_id: `opaque:${target.providerId}:current`,
    pool_id: target.poolRef,
    identity_fingerprint: digest(`${target.providerId}\0${target.surfaceId}\0current`),
    observed_at: observedAt,
    valid_until: validUntil,
    hard_window: { name: target.windowName, duration_sec: target.durationSec },
    policy: {
      revision: target.policyRevision,
      decision: 'allow',
      hard_ceiling_used_pct: target.hardCeiling,
    },
    effects: { decision: 'allow', effect: 'read-only' },
    source_profile: {
      schema: 'ccm/quota-source-profile/v1',
      revision: 'ccm/machine-wide-source-profile/v1',
      fresh_ttl_sec: 300,
      hard_ttl_sec: 900,
      max_clock_skew_sec: 30,
    },
    buckets: [
      {
        id: target.bucketId,
        bucket_id: target.bucketId,
        aggregation_key: aggregationKey,
        window: target.windowName,
        duration_sec: target.durationSec,
        freshness: usable ? 'fresh' : 'unknown',
        used_pct: usable ? used : 0,
        safety_margin_pct: target.hardCeiling - target.warningLine,
        projected_p80_pct: 0,
        observed_at: observedAt,
        valid_until: validUntil,
        ...(resetAt ? { resets_at: resetAt } : {}),
      },
    ],
  };
}

function missingDecision(target: MachineQuotaTarget): Data {
  const scope = targetScope(target);
  const base = {
    schema: 'ccm/machine-quota-decision/v1',
    scope_digest: scopeDigest(target),
    target: scope,
    observation_revision: digest(`missing:${sourceKey(target)}`),
    state: 'unknown',
    freshness: 'unknown',
    reason_codes: ['QUOTA_REQUIRED_WINDOW_UNKNOWN'],
    policy_revision: target.policyRevision,
    reset_marker: null,
    source: {
      collector_id: target.collectorId,
      source_schema: 'ccm/quota-authority-observation/v1',
    },
  };
  return { ...base, decision_revision: digest(base) };
}

function projectDecision(
  target: MachineQuotaTarget,
  observation: Data | undefined,
  now: Date,
): Data {
  if (!observation) return missingDecision(target);
  const bucket = Array.isArray(observation.buckets) ? observation.buckets[0] : undefined;
  const observationEvaluation = evaluateQuotaObservation({
    provider: target.providerId,
    provider_window_rule: { name: target.windowName, duration_sec: target.durationSec },
    required_bucket_ids: [target.bucketId],
    checked_at: now.toISOString(),
    profile: observation.source_profile,
    observations: [
      {
        ...(bucket ?? {}),
        revision: observation.source_revision,
        observation_id: observation.source_revision,
      },
    ],
  });
  const freshness = String(observationEvaluation.freshness ?? 'unknown');
  const aggregationKey = String(bucket?.aggregation_key ?? '');
  const headroom = deriveQuotaHeadroom({
    policy: observation.policy,
    buckets: observation.buckets,
    required_aggregation_key: aggregationKey,
  });
  const rawState = String(headroom.state ?? 'unknown');
  const state =
    freshness === 'soft-stale' || freshness === 'hard-stale'
      ? 'stale'
      : freshness !== 'fresh' || rawState === 'unknown'
        ? 'unknown'
        : rawState === 'ample'
          ? 'healthy'
          : rawState;
  const reasonCodes =
    state === 'healthy'
      ? []
      : state === 'stale'
        ? [String(observationEvaluation.blocking_error ?? 'QUOTA_STALE')]
        : state === 'unknown'
          ? [String(observationEvaluation.blocking_error ?? 'QUOTA_REQUIRED_WINDOW_UNKNOWN')]
          : Array.isArray(headroom.blocking_reasons)
            ? headroom.blocking_reasons.map(String)
            : [`QUOTA_${state.toUpperCase()}`];
  const decisionSemantic = {
    scope_digest: scopeDigest(target),
    state,
    freshness,
    reason_codes: reasonCodes,
    policy_revision: target.policyRevision,
    reset_marker: bucket?.resets_at ?? null,
    source: { collector_id: target.collectorId, source_schema: String(observation.schema) },
  };
  return {
    schema: 'ccm/machine-quota-decision/v1',
    scope_digest: scopeDigest(target),
    target: targetScope(target),
    observation_revision: digest(observation.source_revision ?? observation),
    decision_revision: digest(decisionSemantic),
    state,
    freshness,
    reason_codes: reasonCodes,
    policy_revision: target.policyRevision,
    observed_at: observation.observed_at,
    valid_until: observation.valid_until,
    reset_marker: bucket?.resets_at ?? null,
    source: decisionSemantic.source,
  };
}

function defaultCollectors(): MachineQuotaCollectorBoundary {
  return {
    collect(targetData, env): MachineQuotaCollection {
      const target = TARGETS.find(
        (candidate) =>
          candidate.surfaceId === targetData.surface_id &&
          candidate.windowName === targetData.window_name,
      );
      if (!target?.defaultCollectorHarness) {
        return { status: 'unsupported', reason: 'surface-owned quota collector is unavailable' };
      }
      const adapter = knownHarnessAdapters().find(
        (item) => item.id === target.defaultCollectorHarness,
      );
      if (!adapter || !adapter.inspectInstallation(env).installed) {
        return { status: 'unknown', reason: 'harness is not installed' };
      }
      try {
        const reading: CurrentUsageReading = adapter.readCurrentUsage(env);
        return reading.signal
          ? { status: 'refreshed', signal: reading.signal, source: reading.source }
          : {
              status: 'unknown',
              signal: null,
              source: reading.source,
              reason: reading.unavailableReason,
            };
      } catch (error) {
        return { status: 'error', reason: error instanceof Error ? error.message : String(error) };
      }
    },
  };
}

async function decisionsFromStore(store: MachineQuotaStore, now: Date): Promise<Data[]> {
  return Promise.all(
    TARGETS.map(async (target) =>
      projectDecision(target, await store.readObservation(sourceKey(target)), now),
    ),
  );
}

function checkpointDecisions(projection: Data | undefined): Data[] {
  return Array.isArray(projection?.decisions) ? projection.decisions : [];
}

export async function readMachineWideQuotaStatus(
  store: MachineQuotaStore,
  now = new Date(),
): Promise<Data> {
  const decisions = await decisionsFromStore(store, now);
  const checkpoint = checkpointDecisions(await store.readMachineProjection());
  const covered = new Map(
    checkpoint.map((decision) => [decision.scope_digest, decision.decision_revision]),
  );
  const summaryDecisions = decisions
    .map((decision) => ({
      scope_digest: decision.scope_digest,
      target: {
        harness_id: decision.target.harness_id,
        surface_id: decision.target.surface_id,
        provider_id: decision.target.provider_id,
      },
      state: decision.state,
      freshness: decision.freshness,
      reason_codes: decision.reason_codes,
      decision_revision: decision.decision_revision,
      observation_revision: decision.observation_revision,
      fanout_covered: covered.get(decision.scope_digest) === decision.decision_revision,
    }))
    .sort((left, right) => String(left.scope_digest).localeCompare(String(right.scope_digest)));
  return {
    schema: 'ccm/machine-quota-status/v1',
    summary: { schema: 'ccm/machine-quota-summary/v1', decisions: summaryDecisions },
  };
}

export async function refreshMachineWideQuota(input: {
  home: string;
  env: Env;
  store: MachineQuotaStore;
  collectors?: MachineQuotaCollectorBoundary;
  now?: Date;
}): Promise<Data> {
  const now = input.now ?? new Date();
  const collectors = input.collectors ?? defaultCollectors();
  const scopes: Data[] = [];
  for (const target of TARGETS) {
    let collection: MachineQuotaCollection;
    try {
      collection = await collectors.collect(
        { ...targetScope(target), window_name: target.windowName },
        input.env,
      );
    } catch (error) {
      collection = {
        status: 'error',
        reason: error instanceof Error ? error.message : String(error),
      };
    }
    const observation = buildObservation(target, collection, now);
    try {
      await input.store.refreshObservation(
        { source_key: sourceKey(target), force: true },
        async () => observation,
      );
      scopes.push({
        scope_digest: scopeDigest(target),
        target: targetScope(target),
        status: collection.status,
        ...(collection.reason ? { reason: collection.reason } : {}),
      });
    } catch (error) {
      scopes.push({
        scope_digest: scopeDigest(target),
        target: targetScope(target),
        status: 'error',
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const decisions = await decisionsFromStore(input.store, now);
  const previousProjection = await input.store.readMachineProjection();
  const destinations = listCurrentCoordinationSubscriptions(input.home);
  const projected = projectMachineWideQuotaNotifications({
    previous: checkpointDecisions(previousProjection),
    decisions,
    subscriptions: destinations.map((destination) => ({ ...destination, valid: true })),
  });
  const deliveries = projected.notifications.map((notification) => {
    const destination = destinations.find(
      (candidate) => candidate.subscription_id === notification.destination.subscription_id,
    );
    if (!destination) {
      return { status: 'invalid', subscription_id: notification.destination.subscription_id };
    }
    return deliverCoordinationNotification(
      input.home,
      destination,
      {
        id: notification.id,
        kind: 'quota_state_change',
        summary: notification.summary,
        strength: notification.strength,
        payload: notification.payload,
      },
      now.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    );
  });
  const fanoutComplete = deliveries.every((delivery) =>
    ['delivered', 'deduped', 'invalid'].includes(delivery.status),
  );
  if (fanoutComplete) {
    await input.store.publishMachineProjection({
      schema: 'ccm/machine-quota-projection/v1',
      decisions,
    });
  }
  return {
    schema: 'ccm/machine-quota-refresh/v1',
    scopes,
    deltas: projected.deltas,
    deliveries,
    fanout_complete: fanoutComplete,
    checkpoint_advanced: fanoutComplete,
  };
}
