import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { UsageSignal, WindowSignal } from '@ccm/engine';
import { canonicalJson, sha256Hex } from '@ccm/engine';
import type { CurrentQuotaAuthorityRefs, Env } from './harnesses/types.js';
import { projectMachineWideQuotaNotifications } from './machine-wide-quota-notification.js';
import {
  projectMachineQuotaPosture,
  type RawMachineQuotaPostureInput,
} from './machine-wide-quota-posture.js';

type Data = Record<string, any>;

interface MachineQuotaTarget {
  harnessId: string;
  surfaceId: string;
  providerId: string;
  bucketId: string;
  windowName: 'five_hour' | 'seven_day' | 'billing_period';
  durationSec: number;
  collectorId: string;
  sourceSchema: string;
  authSource: string;
  defaultCollectorHarness: string | null;
}

export type MachineQuotaAuthorityRefs = CurrentQuotaAuthorityRefs;

export interface MachineQuotaCollection {
  status: 'refreshed' | 'unknown' | 'unsupported' | 'error';
  signal?: UsageSignal | null;
  source?: string;
  reason?: string;
  authority?: MachineQuotaAuthorityRefs;
  authSource?: string;
  quotaScopeFingerprint?: string | null;
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
  readAggregation(aggregationKey: string): Promise<Data>;
  readMachineProjection(): Promise<Data | undefined>;
  publishMachineProjection(projection: Readonly<Data>): Promise<Data>;
}

const TARGETS: readonly MachineQuotaTarget[] = Object.freeze([
  {
    harnessId: 'codex',
    surfaceId: 'codex-cli',
    providerId: 'codex',
    bucketId: 'seven-day-global',
    windowName: 'seven_day',
    durationSec: 604_800,
    collectorId: 'codex-app-server',
    sourceSchema: 'codex/account-rate-limits/v1',
    authSource: 'codex-cli-current-login',
    defaultCollectorHarness: 'codex',
  },
  {
    harnessId: 'claude-code',
    surfaceId: 'claude-cli',
    providerId: 'anthropic',
    bucketId: 'five-hour-global',
    windowName: 'five_hour',
    durationSec: 18_000,
    collectorId: 'claude-statusline-sidecar',
    sourceSchema: 'claude-code/rate-limits/v1',
    authSource: 'claude-cli-current-login',
    defaultCollectorHarness: 'claude-code',
  },
  {
    harnessId: 'claude-code',
    surfaceId: 'claude-cli',
    providerId: 'anthropic',
    bucketId: 'seven-day-global',
    windowName: 'seven_day',
    durationSec: 604_800,
    collectorId: 'claude-statusline-sidecar',
    sourceSchema: 'claude-code/rate-limits/v1',
    authSource: 'claude-cli-current-login',
    defaultCollectorHarness: 'claude-code',
  },
  {
    harnessId: 'claude-code',
    surfaceId: 'claude-fable-5-cli',
    providerId: 'anthropic',
    bucketId: 'seven-day-fable-global',
    windowName: 'seven_day',
    durationSec: 604_800,
    collectorId: 'claude-statusline-sidecar',
    sourceSchema: 'claude-code/rate-limits/v1',
    authSource: 'claude-cli-current-login',
    defaultCollectorHarness: 'claude-code',
  },
  {
    harnessId: 'cursor',
    surfaceId: 'cursor-ide-plugin',
    providerId: 'cursor',
    bucketId: 'billing-period-global',
    windowName: 'billing_period',
    durationSec: 2_592_000,
    collectorId: 'cursor-dashboard',
    sourceSchema: 'cursor/GetCurrentPeriodUsage/v1',
    authSource: 'cursor-ide-current-login',
    defaultCollectorHarness: 'cursor',
  },
  {
    harnessId: 'cursor',
    surfaceId: 'cursor-agent-cli',
    providerId: 'cursor',
    bucketId: 'billing-period-global',
    windowName: 'billing_period',
    durationSec: 2_592_000,
    collectorId: 'cursor-agent-dashboard',
    sourceSchema: 'cursor/GetCurrentPeriodUsage/v1',
    authSource: 'cursor-agent-current-login',
    // The Agent owns its credential discovery, while both surfaces may observe one subscription pool.
    defaultCollectorHarness: 'cursor',
  },
  {
    harnessId: 'kimi-code',
    surfaceId: 'kimi-cli',
    providerId: 'moonshot',
    bucketId: 'five-hour-global',
    windowName: 'five_hour',
    durationSec: 18_000,
    collectorId: 'kimi-usages-api',
    sourceSchema: 'kimi-code/usages/v1',
    authSource: 'kimi-code-current-login',
    defaultCollectorHarness: 'kimi-code',
  },
  {
    harnessId: 'kimi-code',
    surfaceId: 'kimi-cli',
    providerId: 'moonshot',
    bucketId: 'seven-day-global',
    windowName: 'seven_day',
    durationSec: 604_800,
    collectorId: 'kimi-usages-api',
    sourceSchema: 'kimi-code/usages/v1',
    authSource: 'kimi-code-current-login',
    defaultCollectorHarness: 'kimi-code',
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

function object(value: unknown): Data {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Data)
    : {};
}

function nonempty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function percentage(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100;
}

function validatedAuthorityRefs(
  target: MachineQuotaTarget,
  collection: MachineQuotaCollection,
): MachineQuotaAuthorityRefs | null {
  const authority = collection.authority;
  if (
    authority?.schema !== 'ccm/machine-quota-collector-authority/v1' ||
    !nonempty(authority.account_key) ||
    !nonempty(authority.identity_fingerprint) ||
    !nonempty(authority.payer_scope) ||
    !nonempty(authority.pool_id) ||
    !nonempty(authority.aggregation_key) ||
    !nonempty(authority.policy?.revision) ||
    !percentage(authority.policy?.hard_ceiling_used_pct) ||
    authority.policy.hard_ceiling_used_pct === 0 ||
    !nonempty(authority.requirement?.revision) ||
    !Array.isArray(authority.requirement.required_bucket_ids) ||
    authority.requirement.required_bucket_ids.length !== 1 ||
    authority.requirement.required_bucket_ids[0] !== target.bucketId ||
    !percentage(authority.requirement.safety_margin?.[target.bucketId])
  ) {
    return null;
  }
  return structuredClone(authority);
}

/** Provider adapter normalization only; all posture math lives in machine-wide-quota-posture. */
function normalizeCollectedAuthorityObservation(
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
  const authority = validatedAuthorityRefs(target, collection);
  const quotaScopeFingerprint = nonempty(collection.quotaScopeFingerprint)
    ? collection.quotaScopeFingerprint
    : null;
  const aggregationKey =
    authority?.aggregation_key ??
    (quotaScopeFingerprint
      ? `${target.providerId}|${quotaScopeFingerprint}|${target.windowName}`
      : `${sourceKey(target)}|unscoped`);
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
    auth_source: collection.authSource ?? target.authSource,
    quota_scope_fingerprint: quotaScopeFingerprint,
    authority: authority
      ? {
          account_key: authority.account_key,
          identity_fingerprint: authority.identity_fingerprint,
          payer_scope: authority.payer_scope,
          pool_id: authority.pool_id,
          aggregation_key: authority.aggregation_key,
          policy: authority.policy,
          requirement: authority.requirement,
        }
      : null,
  };
  return {
    schema: 'ccm/quota-authority-observation/v1',
    source_key: sourceKey(target),
    source_revision: digest(semantic),
    observation_status: usable ? 'ok' : collection.status,
    provider: target.providerId,
    provider_rule_revision: authority?.policy.revision ?? 'ccm/usage-pacing/v1',
    ...(authority
      ? {
          account_id: authority.account_key,
          pool_id: authority.pool_id,
          identity_fingerprint: authority.identity_fingerprint,
        }
      : {}),
    machine_scope: {
      harness_id: target.harnessId,
      surface_id: target.surfaceId,
      provider_id: target.providerId,
      payer_scope: authority?.payer_scope ?? null,
      authority_available: authority !== null,
      quota_scope_fingerprint: quotaScopeFingerprint,
    },
    authentication_source: collection.authSource ?? target.authSource,
    observed_at: observedAt,
    valid_until: validUntil,
    hard_window: { name: target.windowName, duration_sec: target.durationSec },
    ...(authority
      ? {
          policy: { ...authority.policy, decision: usable ? 'allow' : 'deny' },
          requirement: structuredClone(authority.requirement),
        }
      : {}),
    effects: {
      decision: usable ? 'allow' : 'deny',
      effect: 'read-only',
    },
    source_profile: {
      schema: 'ccm/quota-source-profile/v1',
      revision: 'ccm/machine-wide-source-profile/v1',
      fresh_ttl_sec: 300,
      hard_ttl_sec: 900,
      max_clock_skew_sec: 30,
    },
    buckets: usable
      ? [
          {
            id: target.bucketId,
            bucket_id: target.bucketId,
            aggregation_key: aggregationKey,
            window: target.windowName,
            duration_sec: target.durationSec,
            freshness: 'fresh',
            used_pct: used,
            ...(authority
              ? {
                  safety_margin_pct: authority.requirement.safety_margin[target.bucketId],
                  projected_p80_pct: 0,
                }
              : {}),
            observed_at: observedAt,
            valid_until: validUntil,
            ...(resetAt ? { resets_at: resetAt } : {}),
          },
        ]
      : [],
  };
}

function unavailablePostureInput(
  target: MachineQuotaTarget,
  now: Date,
  homeSalt: string,
  reasonCode = 'QUOTA_SIGNAL_UNKNOWN',
): RawMachineQuotaPostureInput {
  return {
    schema: 'ccm/machine-quota-posture-input/v1',
    home_scope_salt: homeSalt,
    checked_at: now.toISOString(),
    authority: {
      available: false,
      reason_code: reasonCode,
      harness_id: target.harnessId,
      surface_id: target.surfaceId,
      provider_id: target.providerId,
      identity_fingerprint: null,
      payer_scope: null,
      pool_id: null,
      quota_scope_digest: null,
      unit: 'percent',
      bucket_id: target.bucketId,
      window: collectionTarget(target).window,
      source: {
        collector_id: target.collectorId,
        source_schema: target.sourceSchema,
        auth_source: target.authSource,
      },
    },
    observations: [],
    source_profiles: [],
  };
}

function postureInputFromObservation(
  target: MachineQuotaTarget,
  observation: Data | undefined,
  now: Date,
  homeSalt: string,
): RawMachineQuotaPostureInput {
  const scope = object(observation?.machine_scope);
  const buckets = Array.isArray(observation?.buckets) ? observation.buckets.map(object) : [];
  const bucket = buckets.find(
    (candidate) =>
      candidate.bucket_id === target.bucketId &&
      candidate.window === target.windowName &&
      candidate.duration_sec === target.durationSec,
  );
  const signalAvailable =
    observation?.schema === 'ccm/quota-authority-observation/v1' &&
    observation.observation_status === 'ok' &&
    scope.harness_id === target.harnessId &&
    scope.surface_id === target.surfaceId &&
    scope.provider_id === target.providerId &&
    observation.provider === target.providerId &&
    bucket !== undefined &&
    nonempty(bucket.aggregation_key);
  if (!signalAvailable) {
    return unavailablePostureInput(target, now, homeSalt);
  }
  const quotaScopeFingerprint = nonempty(scope.quota_scope_fingerprint)
    ? String(scope.quota_scope_fingerprint)
    : nonempty(observation.identity_fingerprint)
      ? String(observation.identity_fingerprint)
      : null;
  const quotaScopeDigest = quotaScopeFingerprint
    ? digest(`ccm/quota-scope/v1|${homeSalt}|${quotaScopeFingerprint}`)
    : nonempty(observation.pool_id)
      ? digest(`ccm/quota-scope/v1|${homeSalt}|${String(observation.pool_id)}`)
      : null;
  return {
    schema: 'ccm/machine-quota-posture-input/v1',
    home_scope_salt: homeSalt,
    checked_at: now.toISOString(),
    authority: {
      available: true,
      harness_id: target.harnessId,
      surface_id: target.surfaceId,
      provider_id: target.providerId,
      ...(nonempty(observation.account_id) ? { account_key: String(observation.account_id) } : {}),
      identity_fingerprint: quotaScopeFingerprint,
      payer_scope: nonempty(scope.payer_scope) ? String(scope.payer_scope) : null,
      pool_id: nonempty(observation.pool_id) ? String(observation.pool_id) : quotaScopeFingerprint,
      quota_scope_digest: quotaScopeDigest,
      unit: 'percent',
      bucket_id: target.bucketId,
      window: collectionTarget(target).window,
      source: {
        collector_id: target.collectorId,
        source_schema: target.sourceSchema,
        auth_source: String(observation.authentication_source ?? target.authSource),
      },
    },
    observations: [
      {
        schema: 'ccm/quota-observation/v1',
        observation_id: String(observation.source_revision),
        revision: String(observation.source_revision),
        source_key: {
          harness: target.harnessId,
          surface_id: target.surfaceId,
          provider: target.providerId,
          identity_fingerprint: quotaScopeFingerprint ?? '',
          payer_scope: nonempty(scope.payer_scope) ? String(scope.payer_scope) : 'unknown',
          pool_id: nonempty(observation.pool_id)
            ? String(observation.pool_id)
            : (quotaScopeFingerprint ?? ''),
          bucket_id: target.bucketId,
          aggregation_key: String(bucket.aggregation_key),
          unit: 'percent',
          window: collectionTarget(target).window,
        },
        value: {
          used: bucket.used_pct,
          limit: 100,
          ...(bucket.resets_at ? { resets_at: bucket.resets_at } : {}),
        },
        source: {
          collector: target.collectorId,
          schema: target.sourceSchema,
          raw_revision: String(observation.source_revision),
          auth_source: String(observation.authentication_source ?? target.authSource),
        },
        observed_at: observation.observed_at,
        valid_until: observation.valid_until,
      },
    ],
    source_profiles: [
      {
        schema: 'ccm/quota-source-profile/v1',
        source_schema: target.sourceSchema,
        fresh_ttl_sec: Number(object(observation.source_profile).fresh_ttl_sec),
        hard_ttl_sec: Number(object(observation.source_profile).hard_ttl_sec),
        max_clock_skew_sec: Number(object(observation.source_profile).max_clock_skew_sec),
      },
    ],
  };
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
      if (!homeSalt) {
        return projectMachineQuotaPosture(
          unavailablePostureInput(target, now, 'uninitialized-machine-quota'),
        );
      }
      return projectMachineQuotaPosture(
        postureInputFromObservation(target, observation, now, homeSalt),
      );
    }),
  );
}

function checkpointDecisions(projection: Data | undefined): Data[] {
  return Array.isArray(projection?.decisions) ? projection.decisions : [];
}

function safeQuotaReading(target: MachineQuotaTarget, observation: Data | undefined): Data {
  const bucket = Array.isArray(observation?.buckets)
    ? observation.buckets
        .map(object)
        .find(
          (candidate) =>
            candidate.bucket_id === target.bucketId &&
            candidate.window === target.windowName &&
            candidate.duration_sec === target.durationSec,
        )
    : undefined;
  return {
    target: collectionTarget(target),
    used_percentage: percentage(bucket?.used_pct) ? bucket.used_pct : null,
    resets_at: nonempty(bucket?.resets_at) ? bucket.resets_at : null,
    observed_at: nonempty(observation?.observed_at) ? observation.observed_at : null,
    valid_until: nonempty(observation?.valid_until) ? observation.valid_until : null,
    source: {
      collector_id: target.collectorId,
      source_schema: target.sourceSchema,
      auth_source: nonempty(observation?.authentication_source)
        ? observation.authentication_source
        : target.authSource,
    },
  };
}

async function safeReadingsFromStore(store: MachineQuotaStore): Promise<Data[]> {
  return Promise.all(
    TARGETS.map(async (target) =>
      safeQuotaReading(target, await store.readObservation(sourceKey(target))),
    ),
  );
}

/**
 * Capacity accounting is conservative: only equal, collector-proven non-null digests collapse to
 * one unit. A missing digest means relationship unknown, never an independently additive unit.
 */
export function aggregateMachineQuotaCapacityViews(decisions: Data[]): Data {
  const known = new Map<string, string[]>();
  const unresolved: string[] = [];
  for (const decision of decisions) {
    const scopeDigest = nonempty(decision?.scope_digest) ? decision.scope_digest : null;
    if (!scopeDigest) continue;
    const quotaScopeDigest = nonempty(decision?.quota_scope_digest)
      ? decision.quota_scope_digest
      : null;
    if (!quotaScopeDigest) {
      unresolved.push(scopeDigest);
      continue;
    }
    const members = known.get(quotaScopeDigest) ?? [];
    members.push(scopeDigest);
    known.set(quotaScopeDigest, members);
  }
  return {
    schema: 'ccm/machine-quota-capacity-views/v1',
    known_capacities: [...known.entries()]
      .map(([quotaScopeDigest, scopeDigests]) => ({
        quota_scope_digest: quotaScopeDigest,
        capacity_units: 1,
        scope_digests: [...new Set(scopeDigests)].sort(),
      }))
      .sort((left, right) => left.quota_scope_digest.localeCompare(right.quota_scope_digest)),
    unresolved_scope_digests: [...new Set(unresolved)].sort(),
    unresolved_capacity_units: null,
  };
}

function machineQuotaStatus(
  decisions: Data[],
  projection: Data | undefined,
  readings: Data[],
): Data {
  const checkpoint = checkpointDecisions(projection);
  const covered = new Map(
    checkpoint.map((decision) => [decision.scope_digest, decision.decision_revision]),
  );
  const summaryDecisions = decisions
    .map((decision) => ({
      scope_digest: decision.scope_digest,
      target: { ...decision.target },
      quota_scope_digest: decision.quota_scope_digest ?? null,
      state: decision.state,
      freshness: decision.freshness,
      reason_codes: decision.reason_codes,
      source: structuredClone(decision.source),
      decision_revision: decision.decision_revision,
      observation_revision: decision.observation_revision,
      fanout_covered: covered.get(decision.scope_digest) === decision.decision_revision,
    }))
    .sort((left, right) => String(left.scope_digest).localeCompare(String(right.scope_digest)));
  return {
    schema: 'ccm/machine-quota-status/v1',
    summary: { schema: 'ccm/machine-quota-summary/v1', decisions: summaryDecisions },
    readings,
    capacity_views: aggregateMachineQuotaCapacityViews(summaryDecisions),
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
  return machineQuotaStatus(decisions, projection, await safeReadingsFromStore(store));
}

/**
 * On-demand machine-wide fill for `quota status --machine-wide --refresh`: the explicit live seam a
 * user/agent can pull without a monitor daemon. It collects every target through the same per-harness
 * collector (the UsageReading strategy), persists the observations, and initializes the owner-only
 * home salt if absent — so a subsequent cached `quota status` reads real used% AND lit-up decisions
 * instead of a permanent all-unknown. Unlike refreshMachineWideQuota this performs NO subscriber
 * fan-out, so it works in production where no coordination boundary is wired. Per-target collect is
 * best-effort: a collector throw persists an honest error/unknown observation, never a fabricated
 * value. Writes only the machine-local quota cache (never board/account/provider/token).
 */
export async function refreshMachineWideQuotaObservations(input: {
  env: Env;
  store: MachineQuotaStore;
  collectors: MachineQuotaCollectorBoundary;
  now?: Date;
}): Promise<Data> {
  const now = input.now ?? new Date();
  // Establish the owner-only durable home salt if missing, so decisions can correlate scope.
  const previous = await input.store.readMachineProjection();
  const homeSalt =
    typeof previous?.home_salt === 'string' && previous.home_salt.length > 0
      ? previous.home_salt
      : randomUUID();
  if (homeSalt !== previous?.home_salt) {
    await input.store.publishMachineProjection({
      schema: 'ccm/machine-quota-projection/v1',
      home_salt: homeSalt,
      decisions: Array.isArray(previous?.decisions) ? previous.decisions : [],
    });
  }
  for (const target of TARGETS) {
    let collection: MachineQuotaCollection;
    try {
      collection = await input.collectors.collect(
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
    const observation = normalizeCollectedAuthorityObservation(target, collection, now);
    try {
      await input.store.refreshObservation(
        { source_key: sourceKey(target), force: true },
        async () => observation,
      );
    } catch {
      // best-effort per target: one surface's persist failure must not abort the whole fill.
    }
  }
  return readMachineWideQuotaStatus(input.store, now);
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
  const readings: Data[] = [];
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
        candidate.provider === target.providerId
      ) {
        observation = candidate;
      }
    }
    readings.push(safeQuotaReading(target, observation));
    return projectMachineQuotaPosture(
      homeSalt
        ? postureInputFromObservation(target, observation, now, homeSalt)
        : unavailablePostureInput(target, now, 'uninitialized-machine-quota'),
    );
  });
  return machineQuotaStatus(decisions, projection, readings);
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
      quota_scope_digest: decision.quota_scope_digest ?? null,
      state: decision.state,
      freshness: decision.freshness,
      reason_codes: structuredClone(decision.reason_codes),
      source: structuredClone(decision.source),
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

/**
 * Reuse the authoritative observation store for user-facing provider queries. The store owns the
 * source lock, fresh-TTL recheck, and atomic publication, so adjacent commands share one live read.
 */
export async function readOrRefreshMachineQuotaSurfaceReading(input: {
  surfaceId: string;
  env: Env;
  store: MachineQuotaStore;
  collectors: MachineQuotaCollectorBoundary;
  now?: Date;
}): Promise<Data> {
  const target = TARGETS.find((candidate) => candidate.surfaceId === input.surfaceId);
  if (!target) throw new Error(`unsupported machine quota surface: ${input.surfaceId}`);
  const now = input.now ?? new Date();
  const observation = await input.store.refreshObservation(
    { source_key: sourceKey(target), force: false },
    async () => {
      let collection: MachineQuotaCollection;
      try {
        collection = await input.collectors.collect(
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
      return normalizeCollectedAuthorityObservation(target, collection, now);
    },
  );
  return safeQuotaReading(target, observation);
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
  const scopeResults: Data[] = [];
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
    const observation = normalizeCollectedAuthorityObservation(target, collection, now);
    try {
      await input.store.refreshObservation(
        { source_key: sourceKey(target), force: true },
        async () => observation,
      );
      scopeResults.push({
        source_key: sourceKey(target),
        status: collection.status,
        ...(collection.reason ? { reason: collection.reason } : {}),
      });
    } catch (error) {
      scopeResults.push({
        source_key: sourceKey(target),
        status: 'error',
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const decisions = await decisionsFromStore(input.store, now, homeSalt);
  const decisionsBySource = new Map(
    TARGETS.map((target, index) => [sourceKey(target), decisions[index] as Data]),
  );
  const scopes = scopeResults.map((result) => {
    const decision = decisionsBySource.get(String(result.source_key));
    return {
      scope_digest: decision?.scope_digest,
      target: decision?.target,
      status: result.status,
      ...(result.reason ? { reason: result.reason } : {}),
    };
  });
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
