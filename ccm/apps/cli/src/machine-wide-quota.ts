import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { UsageSignal, WindowSignal } from '@ccm/engine';
import {
  canonicalJson,
  deriveQuotaHeadroom,
  evaluateQuotaObservation,
  sha256Hex,
} from '@ccm/engine';
import type { Env } from './harnesses/types.js';
import {
  type MachineQuotaState,
  projectMachineQuotaPosture,
  projectMachineWideQuotaNotifications,
} from './machine-wide-quota-notification.js';

type Data = Record<string, any>;

interface MachineQuotaTarget {
  harnessId: string;
  surfaceId: string;
  providerId: string;
  payerScope: string;
  poolId: string;
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

export interface MachineQuotaCoordinationBoundary {
  listSubscriptions(home: string): Data[];
  deliverNotification(home: string, destination: Data, notification: Data, now: string): Data;
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
    poolId: 'pool:opaque-codex-current',
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
    poolId: 'pool:opaque-claude-current',
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
    poolId: 'pool:opaque-claude-current',
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
    poolId: 'pool:opaque-cursor-current',
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
    poolId: 'pool:opaque-cursor-current',
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

function collectionTarget(target: MachineQuotaTarget): Data {
  return {
    harness_id: target.harnessId,
    surface_id: target.surfaceId,
    provider_id: target.providerId,
    payer_scope: target.payerScope,
    bucket_id: target.bucketId,
    unit: 'percent',
    window: {
      kind: target.windowName === 'billing_period' ? 'billing-cycle' : 'rolling',
      name: target.windowName,
      duration_sec: target.durationSec,
    },
  };
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
    target: collectionTarget(target),
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
    pool_id: target.poolId,
    // Cursor IDE and Agent may share one authenticated identity while remaining distinct surfaces.
    identity_fingerprint: digest(`${target.providerId}\0current`),
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

function projectDecision(
  target: MachineQuotaTarget,
  observation: Data | undefined,
  now: Date,
  homeSalt: string,
): Data {
  const authority = {
    harness_id: target.harnessId,
    surface_id: target.surfaceId,
    provider_id: target.providerId,
    identity_fingerprint: String(
      observation?.identity_fingerprint ?? digest(`missing-identity:${target.providerId}`),
    ),
    payer_scope: target.payerScope,
    pool_id: String(observation?.pool_id ?? target.poolId),
    bucket_id: target.bucketId,
    unit: 'percent',
    window: collectionTarget(target).window,
    policy_revision: target.policyRevision,
    required_bucket_ids: [target.bucketId],
    safety_margin: { [target.bucketId]: target.hardCeiling - target.warningLine },
  };
  if (!observation) {
    return projectMachineQuotaPosture(authority, {
      home_salt: homeSalt,
      state: 'unknown',
      freshness: 'unknown',
      reason_codes: ['QUOTA_REQUIRED_WINDOW_UNKNOWN'],
      observation_revision: digest(`missing:${sourceKey(target)}`),
      source: {
        collector_id: target.collectorId,
        source_schema: 'ccm/quota-authority-observation/v1',
      },
    });
  }
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
  const state: MachineQuotaState =
    freshness === 'soft-stale' || freshness === 'hard-stale'
      ? 'stale'
      : freshness !== 'fresh' || rawState === 'unknown'
        ? 'unknown'
        : rawState === 'ample'
          ? 'healthy'
          : (rawState as MachineQuotaState);
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
  return projectMachineQuotaPosture(authority, {
    home_salt: homeSalt,
    state,
    freshness,
    reason_codes: reasonCodes,
    observation_revision: digest(observation.source_revision ?? observation),
    reset_marker: bucket?.resets_at ?? null,
    source: { collector_id: target.collectorId, source_schema: String(observation.schema) },
    observed_at: observation.observed_at,
    valid_until: observation.valid_until,
  });
}

async function decisionsFromStore(
  store: MachineQuotaStore,
  now: Date,
  homeSalt: string | null,
): Promise<Data[]> {
  return Promise.all(
    TARGETS.map(async (target) => {
      // Before the owner-only home salt exists, never correlate a real cached identity with a
      // process-global fallback. The sentinel posture remains unknown until explicit refresh.
      const observation = homeSalt ? await store.readObservation(sourceKey(target)) : undefined;
      return projectDecision(target, observation, now, homeSalt ?? 'uninitialized-machine-quota');
    }),
  );
}

function checkpointDecisions(projection: Data | undefined): Data[] {
  return Array.isArray(projection?.decisions) ? projection.decisions : [];
}

function machineQuotaStatus(decisions: Data[], projection: Data | undefined): Data {
  const checkpoint = checkpointDecisions(projection);
  const covered = new Map(
    checkpoint.map((decision) => [decision.scope_digest, decision.decision_revision]),
  );
  const summaryDecisions = decisions
    .map((decision) => ({
      scope_digest: decision.scope_digest,
      target: { ...decision.target },
      policy_digest: decision.policy_digest,
      requirement_digest: decision.requirement_digest,
      posture: decision.posture,
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

export async function readMachineWideQuotaStatus(
  store: MachineQuotaStore,
  now = new Date(),
): Promise<Data> {
  const projection = await store.readMachineProjection();
  const homeSalt =
    typeof projection?.home_salt === 'string' && projection.home_salt.length > 0
      ? projection.home_salt
      : null;
  const decisions = await decisionsFromStore(store, now, homeSalt);
  return machineQuotaStatus(decisions, projection);
}

function readCachedJson(path: string): Data | undefined {
  try {
    const value: unknown = JSON.parse(readFileSync(path, 'utf8'));
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Data)
      : undefined;
  } catch {
    return undefined;
  }
}

/** Synchronous cached-only reader for the existing synchronous orchestrator-context command. */
export function readMachineWideQuotaStatusCached(home: string, now = new Date()): Data {
  const quotaRoot = join(home, 'quota', 'v1');
  const projection = readCachedJson(join(quotaRoot, 'machine-wide', 'projection.json'));
  const homeSalt =
    typeof projection?.home_salt === 'string' && projection.home_salt.length > 0
      ? projection.home_salt
      : null;
  const decisions = TARGETS.map((target) => {
    let observation: Data | undefined;
    if (homeSalt) {
      const sourceDigest = createHash('sha256').update(sourceKey(target)).digest('hex');
      const candidate = readCachedJson(
        join(quotaRoot, 'observations', sourceDigest, 'current.json'),
      );
      // Keep the synchronous cache reader narrower than authority publication. Invalid or
      // mismatched owner-only rows become unknown and cannot contribute arbitrary public fields.
      if (
        candidate?.schema === 'ccm/quota-authority-observation/v1' &&
        candidate.source_key === sourceKey(target) &&
        candidate.provider === target.providerId &&
        candidate.provider_rule_revision === target.policyRevision
      ) {
        observation = candidate;
      }
    }
    return projectDecision(target, observation, now, homeSalt ?? 'uninitialized-machine-quota');
  });
  return machineQuotaStatus(decisions, projection);
}

export function projectMachineQuotaContextSummary(status: Data): Data | undefined {
  if (
    status.schema !== 'ccm/machine-quota-status/v1' ||
    !Array.isArray(status.summary?.decisions)
  ) {
    return undefined;
  }
  return {
    schema: 'ccm/machine-quota-summary/v1',
    decisions: status.summary.decisions.map((decision: Data) => ({
      scope_digest: decision.scope_digest,
      target: structuredClone(decision.target),
      policy_digest: decision.policy_digest,
      requirement_digest: decision.requirement_digest,
      state: decision.state,
      freshness: decision.freshness,
      reason_codes: structuredClone(decision.reason_codes),
      decision_revision: decision.decision_revision,
      observation_revision: decision.observation_revision,
      fanout_covered: decision.fanout_covered,
    })),
  };
}

export function readMachineWideQuotaContextSummaryCached(
  home: string,
  now = new Date(),
): Data | undefined {
  const projection = readCachedJson(join(home, 'quota', 'v1', 'machine-wide', 'projection.json'));
  if (typeof projection?.home_salt !== 'string' || projection.home_salt.length === 0)
    return undefined;
  return projectMachineQuotaContextSummary(readMachineWideQuotaStatusCached(home, now));
}

export async function refreshMachineWideQuota(input: {
  home: string;
  env: Env;
  store: MachineQuotaStore;
  collectors: MachineQuotaCollectorBoundary;
  coordination: MachineQuotaCoordinationBoundary;
  now?: Date;
}): Promise<Data> {
  const now = input.now ?? new Date();
  const collectors = input.collectors;
  let previousProjection = await input.store.readMachineProjection();
  let homeSalt =
    typeof previousProjection?.home_salt === 'string' && previousProjection.home_salt.length > 0
      ? previousProjection.home_salt
      : null;
  if (!homeSalt) {
    homeSalt = randomUUID();
    // Salt initialization is durable owner-only metadata, not a decision checkpoint. Persist it
    // before fan-out so an interrupted first cycle retains deterministic scope and inbox ids.
    await input.store.publishMachineProjection({
      schema: 'ccm/machine-quota-projection/v1',
      home_salt: homeSalt,
      decisions: [],
    });
    previousProjection = {
      schema: 'ccm/machine-quota-projection/v1',
      home_salt: homeSalt,
      decisions: [],
    };
  }
  const scopes: Data[] = [];
  for (const target of TARGETS) {
    let collection: MachineQuotaCollection;
    try {
      collection = await collectors.collect(
        {
          ...collectionTarget(target),
          window_name: target.windowName,
          default_collector_harness: target.defaultCollectorHarness,
          collector_id: target.collectorId,
        },
        input.env,
      );
    } catch (error) {
      collection = {
        status: 'error',
        reason: error instanceof Error ? error.message : String(error),
      };
    }
    const observation = buildObservation(target, collection, now);
    const projected = projectDecision(target, observation, now, homeSalt);
    try {
      await input.store.refreshObservation(
        { source_key: sourceKey(target), force: true },
        async () => observation,
      );
      scopes.push({
        scope_digest: projected.scope_digest,
        target: projected.target,
        status: collection.status,
        ...(collection.reason ? { reason: collection.reason } : {}),
      });
    } catch (error) {
      scopes.push({
        scope_digest: projected.scope_digest,
        target: projected.target,
        status: 'error',
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const decisions = await decisionsFromStore(input.store, now, homeSalt);
  const destinations = input.coordination.listSubscriptions(input.home);
  const projected = projectMachineWideQuotaNotifications({
    previous: checkpointDecisions(previousProjection),
    decisions,
    subscriptions: destinations.map((destination) => ({
      ...destination,
      authoritative_epoch: destination.session_epoch,
      valid: true,
    })),
  });
  const deliveries = projected.notifications.map((notification) => {
    const destination = destinations.find(
      (candidate) => candidate.subscription_id === notification.destination.subscription_id,
    );
    if (!destination) {
      return { status: 'invalid', subscription_id: notification.destination.subscription_id };
    }
    return input.coordination.deliverNotification(
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
      home_salt: homeSalt,
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
