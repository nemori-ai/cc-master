import { createHash, randomUUID } from 'node:crypto';
import * as fsPromises from 'node:fs/promises';
import { platform, uptime } from 'node:os';
import { join } from 'node:path';
import {
  deriveQuotaHeadroom,
  evaluateLiveQuotaAdmission,
  evaluateQuotaReservationTransition,
} from '@ccm/engine';

type Data = Record<string, unknown>;
type FilePort = Pick<
  typeof fsPromises,
  'mkdir' | 'open' | 'readFile' | 'readdir' | 'rename' | 'unlink' | 'stat'
>;

interface StoreOptions {
  home: string;
  filesystem?: Record<PropertyKey, unknown>;
  now?: () => Date;
}

interface AggregationState {
  schema: 'ccm/quota-reservation-snapshot/v1';
  aggregation_key: string;
  sequence: number;
  reservations: Data[];
  active_reserved_pct: number;
}

interface LoadedAggregation {
  state: AggregationState;
  snapshotRef: string;
  durableEventCount: number;
  replayedEventCount: number;
  snapshotRebuilt: boolean;
}

interface ManagedLock {
  ref: string;
  release: () => Promise<void>;
}

interface ReservationAuthority {
  sourceKey: string;
  observation: Data;
  capacityByAggregation: Record<string, number>;
  authorityDigest: string;
}

interface ValidatedSourceProfile {
  revision: string;
  freshTtlSec: number;
  hardTtlSec: number;
  maxClockSkewSec: number;
}

interface ValidatedAuthorityObservation {
  provider: string;
  providerRule: string;
  hardWindowName: string;
  hardWindowDuration: number;
  policy: Data;
  effects: Data;
  sourceProfile: ValidatedSourceProfile;
}

interface ObservationFreshness {
  state: 'fresh' | 'soft-stale' | 'hard-stale' | 'unknown' | 'conflict';
  error?: string;
  ageSec?: number;
  profileRevision?: string;
}

interface FoundReservation {
  kind: 'single' | 'transaction';
  aggregationKeys: string[];
  reservation: Data;
  reservations: Data[];
  transactionRef?: string;
  transaction?: Data;
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function object(value: unknown): Data {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Data)
    : {};
}

function numeric(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function nonempty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function positive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function nonnegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function percentage(value: unknown): value is number {
  return nonnegative(value) && value <= 100;
}

function positivePercentage(value: unknown): value is number {
  return positive(value) && value <= 100;
}

function validatedSourceProfile(observation: Readonly<Data>): ValidatedSourceProfile | undefined {
  const sourceProfile = object(observation.source_profile);
  const freshTtlSec = numeric(sourceProfile.fresh_ttl_sec);
  const hardTtlSec = numeric(sourceProfile.hard_ttl_sec);
  const maxClockSkewSec = numeric(sourceProfile.max_clock_skew_sec);
  if (
    sourceProfile.schema !== 'ccm/quota-source-profile/v1' ||
    !nonempty(sourceProfile.revision) ||
    !positive(freshTtlSec) ||
    !positive(hardTtlSec) ||
    freshTtlSec > hardTtlSec ||
    !nonnegative(maxClockSkewSec) ||
    !Number.isFinite(Date.parse(String(observation.observed_at ?? ''))) ||
    !Number.isFinite(Date.parse(String(observation.valid_until ?? '')))
  ) {
    return undefined;
  }
  return {
    revision: sourceProfile.revision,
    freshTtlSec,
    hardTtlSec,
    maxClockSkewSec,
  };
}

function validatedAuthorityObservation(
  observation: Readonly<Data>,
): ValidatedAuthorityObservation | undefined {
  const hardWindow = object(observation.hard_window);
  const policy = object(observation.policy);
  const effects = object(observation.effects);
  const sourceProfile = validatedSourceProfile(observation);
  const provider = String(observation.provider ?? '');
  const providerRule = String(observation.provider_rule_revision ?? '');
  const hardWindowName = String(hardWindow.name ?? '');
  const hardWindowDuration = numeric(hardWindow.duration_sec);
  const policyRevision = String(policy.revision ?? '');
  if (
    observation.schema !== 'ccm/quota-authority-observation/v1' ||
    !nonempty(observation.source_revision) ||
    !nonempty(observation.account_id) ||
    !nonempty(observation.pool_id) ||
    !nonempty(observation.identity_fingerprint) ||
    !nonempty(provider) ||
    !nonempty(providerRule) ||
    !nonempty(hardWindowName) ||
    !positive(hardWindowDuration) ||
    !nonempty(policyRevision) ||
    policy.decision !== 'allow' ||
    !positivePercentage(policy.hard_ceiling_used_pct) ||
    effects.decision !== 'allow' ||
    effects.effect !== 'read-only' ||
    !sourceProfile ||
    (provider === 'codex' &&
      (providerRule !== 'ccm/codex-7d-pacing/v1' ||
        policyRevision !== 'ccm/codex-7d-pacing/v1' ||
        hardWindowName !== 'seven_day' ||
        hardWindowDuration !== 604_800))
  ) {
    return undefined;
  }
  return {
    provider,
    providerRule,
    hardWindowName,
    hardWindowDuration,
    policy,
    effects,
    sourceProfile,
  };
}

function observationFreshness(
  observation: Readonly<Data>,
  sourceProfile: ValidatedSourceProfile,
  checkedAtMs: number,
  buckets: readonly Readonly<Data>[] = [],
): ObservationFreshness {
  if (observation.observation_status === 'conflict') {
    return { state: 'conflict', error: 'QUOTA_OBSERVATION_CONFLICT' };
  }
  const observedAtMs = Date.parse(String(observation.observed_at));
  const validUntilMs = Date.parse(String(observation.valid_until));
  const { freshTtlSec, hardTtlSec, maxClockSkewSec, revision } = sourceProfile;
  const resetTimes = buckets
    .map((bucket) => bucket.resets_at)
    .filter((value) => value !== undefined)
    .map((value) => Date.parse(String(value)));
  if (
    !Number.isFinite(checkedAtMs) ||
    !Number.isFinite(observedAtMs) ||
    !Number.isFinite(validUntilMs) ||
    validUntilMs < observedAtMs ||
    resetTimes.some((value) => !Number.isFinite(value)) ||
    checkedAtMs + maxClockSkewSec * 1_000 < observedAtMs
  ) {
    return { state: 'unknown', error: 'QUOTA_SOURCE_SCHEMA_UNSUPPORTED' };
  }
  const ageSec = Math.max(0, (checkedAtMs - observedAtMs) / 1_000);
  const hardExpiryMs = Math.min(
    observedAtMs + hardTtlSec * 1_000,
    validUntilMs,
    ...(resetTimes.length > 0 ? resetTimes : [Number.POSITIVE_INFINITY]),
  );
  if (checkedAtMs > hardExpiryMs) {
    return {
      state: 'hard-stale',
      error: 'QUOTA_HARD_STALE',
      ageSec,
      profileRevision: revision,
    };
  }
  if (ageSec > freshTtlSec) {
    return {
      state: 'soft-stale',
      error: 'QUOTA_SOFT_STALE',
      ageSec,
      profileRevision: revision,
    };
  }
  return { state: 'fresh', ageSec, profileRevision: revision };
}

function validAuthorityBucket(
  bucket: Readonly<Data>,
  windowName: string,
  windowDuration: number,
): boolean {
  const used = bucket.used_pct;
  const margin = bucket.safety_margin_pct;
  const projected = bucket.projected_p80_pct;
  return (
    nonempty(bucket.id) &&
    nonempty(bucket.aggregation_key) &&
    bucket.window === windowName &&
    numeric(bucket.duration_sec) === windowDuration &&
    ['fresh', 'soft-stale', 'hard-stale', 'unknown'].includes(String(bucket.freshness)) &&
    percentage(used) &&
    percentage(margin) &&
    percentage(projected) &&
    numeric(used) + numeric(margin) <= 100
  );
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value as Data)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function digest(value: unknown): string {
  return `sha256:${hash(canonical(value))}`;
}

function quotaAuthorityDigest(input: {
  sourceKey: string;
  observation: Readonly<Data>;
  validated: ValidatedAuthorityObservation;
  aggregationKeys: string[];
  capacityByAggregation: Record<string, number>;
}): string {
  const { sourceKey, observation, validated, aggregationKeys, capacityByAggregation } = input;
  return digest({
    source_key: sourceKey,
    source_revision: observation.source_revision,
    provider: validated.provider,
    provider_rule_revision: validated.providerRule,
    policy_revision: validated.policy.revision,
    hard_window: object(observation.hard_window),
    account_id: observation.account_id,
    pool_id: observation.pool_id,
    identity_fingerprint: observation.identity_fingerprint,
    aggregation_keys: aggregationKeys,
    capacity_pct: capacityByAggregation,
    observation_digest: digest(observation),
    source_profile_revision: validated.sourceProfile.revision,
  });
}

const PROCESS_START_IDENTITY = `${process.pid}:${Math.round(
  Date.now() - process.uptime() * 1_000,
)}`;
const FALLBACK_BOOT_ID = `${platform()}:boot-epoch:${Math.round(Date.now() / 1_000 - uptime())}`;

function linuxProcessStartIdentity(stat: string): string | undefined {
  // `/proc/<pid>/stat` field 2 is parenthesized and may itself contain spaces.  Field 22
  // (`starttime`) is therefore index 19 only after the final `)` delimiter.
  const commandEnd = stat.lastIndexOf(')');
  if (commandEnd < 0) return undefined;
  const fieldsAfterCommand = stat
    .slice(commandEnd + 1)
    .trim()
    .split(/\s+/);
  return nonempty(fieldsAfterCommand[19]) ? fieldsAfterCommand[19] : undefined;
}

function active(reservation: Data): boolean {
  return ['held', 'committed', 'release_pending', 'orphaned'].includes(String(reservation.state));
}

function stableReservationBinding(reservation: Data): Data {
  return {
    id: reservation.id,
    key: reservation.key,
    hash: reservation.hash,
    amount_pct: reservation.amount_pct,
    checked_at: reservation.checked_at,
    expires_at: reservation.expires_at,
    source_revision: reservation.source_revision,
    attempt_id: reservation.attempt_id,
    candidate_id: reservation.candidate_id,
    account_id: reservation.account_id,
    pool_id: reservation.pool_id,
    identity_fingerprint: reservation.identity_fingerprint,
    authority_source_key: reservation.authority_source_key,
    authority_digest: reservation.authority_digest,
  };
}

function terminalState(state: unknown): state is 'expired' | 'released' {
  return state === 'expired' || state === 'released';
}

function terminalReplay(reservation: Data): Data {
  return {
    action: 'idempotent-existing',
    reservation_id: reservation.id,
    state: reservation.state,
    capacity_counted_pct: 0,
    automatic_spawn_limit: 0,
    new_reservation_count: 0,
    ...(reservation.event_ref ? { event_ref: reservation.event_ref } : {}),
    ...(reservation.transaction_id ? { transaction_id: reservation.transaction_id } : {}),
  };
}

function transitionProofConflict(reservation: Data, request: Readonly<Data>): Data | undefined {
  const inputs = [
    ['terminal_proof_digest', 'terminal_evidence', 'RESERVATION_TERMINAL_PROOF_CONFLICT'],
    ['audit_proof_digest', 'audit', 'RESERVATION_AUDIT_CONFLICT'],
  ] as const;
  for (const [storedField, requestField, error] of inputs) {
    const proof = object(request[requestField]);
    if (
      nonempty(reservation[storedField]) &&
      Object.keys(proof).length > 0 &&
      reservation[storedField] !== digest(proof)
    ) {
      return {
        action: 'rejected',
        error,
        reservation_id: reservation.id,
        state: reservation.state,
        capacity_counted_pct: active(reservation) ? numeric(reservation.amount_pct) : 0,
        automatic_spawn_limit: 0,
        new_reservation_count: 0,
        spawn_count: 0,
      };
    }
  }
  return undefined;
}

function bindTransitionProof(reservation: Data, request: Readonly<Data>, action: unknown): Data {
  const next = { ...reservation };
  if (action === 'release-pending') {
    const proof = object(request.terminal_evidence);
    if (Object.keys(proof).length > 0) next.terminal_proof_digest = digest(proof);
  }
  if (action === 'released') {
    const proof = object(request.audit);
    if (Object.keys(proof).length > 0) next.audit_proof_digest = digest(proof);
  }
  return next;
}

function emptyState(aggregationKey: string): AggregationState {
  return {
    schema: 'ccm/quota-reservation-snapshot/v1',
    aggregation_key: aggregationKey,
    sequence: 0,
    reservations: [],
    active_reserved_pct: 0,
  };
}

function conflict(message: string, cause?: unknown): Error {
  const error = new Error(`RESERVATION_STORE_CONFLICT: ${message}`, cause ? { cause } : undefined);
  error.name = 'ReservationStoreConflict';
  return error;
}

function isCode(cause: unknown, code: string): boolean {
  return object(cause).code === code;
}

async function exists(fs: FilePort, path: string): Promise<boolean> {
  try {
    await fs.stat(path);
    return true;
  } catch (cause) {
    if (isCode(cause, 'ENOENT')) return false;
    throw cause;
  }
}

async function readJson(fs: FilePort, path: string): Promise<Data | undefined> {
  try {
    return JSON.parse(await fs.readFile(path, 'utf8')) as Data;
  } catch (cause) {
    if (isCode(cause, 'ENOENT')) return undefined;
    throw cause;
  }
}

async function syncDirectory(fs: FilePort, directory: string): Promise<'durable' | 'unsupported'> {
  const handle = await fs.open(directory, 'r');
  try {
    await handle.sync();
    return 'durable';
  } catch (cause) {
    if (isCode(cause, 'EINVAL') || isCode(cause, 'ENOTSUP')) return 'unsupported';
    throw cause;
  } finally {
    await handle.close();
  }
}

async function atomicPublish(
  fs: FilePort,
  finalPath: string,
  value: unknown,
): Promise<'durable' | 'unsupported'> {
  const directory = finalPath.slice(0, finalPath.lastIndexOf('/'));
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const temp = join(directory, `.${randomUUID()}.tmp`);
  let renamed = false;
  const handle = await fs.open(temp, 'wx', 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value)}\n`, 'utf8');
    await handle.sync();
    await handle.close();
    await fs.rename(temp, finalPath);
    renamed = true;
    return await syncDirectory(fs, directory);
  } catch (cause) {
    try {
      await handle.close();
    } catch {
      // The original durability failure is authoritative.
    }
    if (!renamed) {
      try {
        await fs.unlink(temp);
      } catch {
        // A same-directory temp has no authority and may be cleaned on a later open.
      }
    }
    throw cause;
  }
}

async function publishEvent(
  fs: FilePort,
  eventRef: string,
  event: Data,
): Promise<'durable' | 'unsupported'> {
  const directory = eventRef.slice(0, eventRef.lastIndexOf('/'));
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const handle = await fs.open(eventRef, 'wx', 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(event)}\n`, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  return syncDirectory(fs, directory);
}

async function acquireManagedLock(
  fs: FilePort,
  root: string,
  options: { waitForManaged: boolean },
): Promise<ManagedLock | undefined> {
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  const ref = join(root, 'lock');
  const deadline = Date.now() + 10_000;
  const linuxBootId =
    platform() === 'linux'
      ? await fs
          .readFile('/proc/sys/kernel/random/boot_id', 'utf8')
          .then((value) => (nonempty(value.trim()) ? value.trim() : undefined))
          .catch(() => undefined)
      : undefined;
  const currentBootId = linuxBootId ?? FALLBACK_BOOT_ID;
  const linuxProcessStart =
    platform() === 'linux'
      ? await fs
          .readFile(`/proc/${process.pid}/stat`, 'utf8')
          .then(linuxProcessStartIdentity)
          .catch(() => undefined)
      : undefined;
  const currentProcessStart = linuxProcessStart ?? PROCESS_START_IDENTITY;
  for (;;) {
    try {
      // The lock itself is an append-only ownership record, not an atomic-replace payload.  `ax`
      // keeps exclusive creation while making the distinct durability protocols observable.
      const handle = await fs.open(ref, 'ax', 0o600);
      await handle.writeFile(
        `${JSON.stringify({
          schema: 'ccm/quota-lock/v1',
          managed_by: 'ccm-quota-store',
          pid: process.pid,
          boot_id: currentBootId,
          boot_id_source: linuxBootId ? 'linux-proc' : 'os-uptime-best-effort',
          process_start_identity: currentProcessStart,
          process_start_identity_source: linuxProcessStart
            ? 'linux-proc'
            : 'process-uptime-best-effort',
          owner_nonce: randomUUID(),
          acquired_at: new Date().toISOString(),
        })}\n`,
        'utf8',
      );
      await handle.sync();
      await handle.close();
      return {
        ref,
        release: async () => {
          try {
            await fs.unlink(ref);
          } catch (cause) {
            if (!isCode(cause, 'ENOENT')) throw cause;
          }
        },
      };
    } catch (cause) {
      if (!isCode(cause, 'EEXIST')) throw cause;
      const owner = await readJson(fs, ref).catch(() => undefined);
      // Another process can observe EEXIST in the tiny interval between exclusive create and the
      // owner record write.  An unreadable record gets a bounded retry; a complete foreign record
      // remains fail-closed and is never reclaimed from PID/mtime guesses.
      if (owner && owner.managed_by !== 'ccm-quota-store') return undefined;
      if (
        owner &&
        nonempty(owner.boot_id) &&
        nonempty(owner.process_start_identity) &&
        typeof owner.pid === 'number'
      ) {
        let stale =
          nonempty(linuxBootId) &&
          owner.boot_id_source === 'linux-proc' &&
          owner.boot_id !== linuxBootId;
        if (
          !stale &&
          platform() === 'linux' &&
          owner.boot_id_source === 'linux-proc' &&
          owner.boot_id === linuxBootId &&
          owner.process_start_identity_source === 'linux-proc'
        ) {
          const observedStart = await fs
            .readFile(`/proc/${owner.pid}/stat`, 'utf8')
            .then((value) => linuxProcessStartIdentity(value) ?? '')
            .catch((readCause) => (isCode(readCause, 'ENOENT') ? '__dead__' : ''));
          stale =
            observedStart === '__dead__' ||
            (nonempty(observedStart) && observedStart !== owner.process_start_identity);
        }
        if (stale) {
          await atomicPublish(fs, join(root, `lock-recovery-${randomUUID()}.json`), {
            schema: 'ccm/quota-lock-recovery/v1',
            prior_owner_nonce: owner.owner_nonce,
            prior_boot_id: owner.boot_id,
            prior_process_start_identity: owner.process_start_identity,
            recovered_at: new Date().toISOString(),
          });
          await fs.unlink(ref).catch((unlinkCause) => {
            if (!isCode(unlinkCause, 'ENOENT')) throw unlinkCause;
          });
          continue;
        }
      }
      if (!options.waitForManaged) return undefined;
      if (Date.now() >= deadline) return undefined;
      await new Promise<void>((resolve) => setTimeout(resolve, 8));
    }
  }
}

export function createQuotaAdmissionStore(options: StoreOptions) {
  const fs = (options.filesystem ?? fsPromises) as unknown as FilePort;
  const currentTime = options.now ?? (() => new Date());
  const quotaRoot = join(options.home, 'quota', 'v1');
  const observationRoot = join(quotaRoot, 'observations');
  const reservationRoot = join(quotaRoot, 'reservations');
  const transactionRoot = join(quotaRoot, 'transactions');
  const reservationIdentityLockRoot = join(quotaRoot, 'reservation-identities');
  const reservationKeyRoot = join(quotaRoot, 'reservation-keys');

  const observationPath = (sourceKey: string): string =>
    join(observationRoot, hash(sourceKey), 'current.json');
  const aggregationPath = (aggregationKey: string): string =>
    join(reservationRoot, hash(aggregationKey));
  const transactionPath = (key: string): string => join(transactionRoot, hash(key), 'current.json');
  const reservationKeyPath = (key: string): string =>
    join(reservationKeyRoot, hash(key), 'current.json');

  const assertObservationSourceIdentity = (
    value: Readonly<Data>,
    directory: string,
    explicitSourceKey?: string,
  ): void => {
    if (!nonempty(value.source_key)) return;
    if (
      hash(value.source_key) !== directory ||
      (explicitSourceKey !== undefined && value.source_key !== explicitSourceKey)
    ) {
      throw conflict(`observation directory identity mismatch ${directory}`);
    }
  };

  const listObservationAuthorities = async (): Promise<
    Array<{ sourceKey: string; value: Data }>
  > => {
    let directories: string[] = [];
    try {
      directories = await fs.readdir(observationRoot);
    } catch (cause) {
      if (isCode(cause, 'ENOENT')) return [];
      throw cause;
    }
    const values: Array<{ sourceKey: string; value: Data }> = [];
    for (const directory of directories.sort()) {
      const value = await readJson(fs, join(observationRoot, directory, 'current.json'));
      if (!value) continue;
      assertObservationSourceIdentity(value, directory);
      values.push({ sourceKey: directory, value });
    }
    return values;
  };

  const resolveReservationAuthority = async (
    request: Readonly<Data>,
    aggregationKeys: string[],
    checkedAtMs: number,
  ): Promise<{ authority?: ReservationAuthority; error?: string }> => {
    const explicitSourceKey = nonempty(request.source_key) ? request.source_key : undefined;
    const authorities = explicitSourceKey
      ? await readObservation(explicitSourceKey).then((value) =>
          value ? [{ sourceKey: hash(explicitSourceKey), value }] : [],
        )
      : await listObservationAuthorities();
    const matching: ReservationAuthority[] = [];
    let bindingMismatch = false;
    let freshnessError: string | undefined;
    for (const entry of authorities) {
      const observation = entry.value;
      if (observation.observation_status === 'conflict') {
        freshnessError = 'QUOTA_OBSERVATION_CONFLICT';
        continue;
      }
      const validated = validatedAuthorityObservation(observation);
      if (!validated) continue;
      const { hardWindowName, hardWindowDuration, policy } = validated;
      const sameBinding =
        observation.source_revision === request.source_revision &&
        observation.account_id === request.account_id &&
        observation.pool_id === request.pool_id &&
        observation.identity_fingerprint === request.identity_fingerprint;
      if (!sameBinding) {
        bindingMismatch = true;
        continue;
      }
      const buckets = Array.isArray(observation.buckets) ? observation.buckets.map(object) : [];
      const requiredBuckets = aggregationKeys.map((aggregationKey) =>
        buckets.filter(
          (bucket) =>
            bucket.aggregation_key === aggregationKey &&
            bucket.window === hardWindowName &&
            numeric(bucket.duration_sec) === hardWindowDuration,
        ),
      );
      if (requiredBuckets.some((rows) => rows.length !== 1)) continue;
      const requiredRows = requiredBuckets.flat();
      const freshness = observationFreshness(
        observation,
        validated.sourceProfile,
        checkedAtMs,
        requiredRows,
      );
      if (freshness.state !== 'fresh') {
        freshnessError = freshness.error ?? 'QUOTA_REQUIRED_WINDOW_UNKNOWN';
        continue;
      }
      const capacityByAggregation: Record<string, number> = {};
      let valid = true;
      for (const [index, rows] of requiredBuckets.entries()) {
        const bucket = rows[0] as Data;
        const used = bucket.used_pct;
        const margin = bucket.safety_margin_pct ?? 0;
        if (
          !validAuthorityBucket(bucket, hardWindowName, hardWindowDuration) ||
          freshness.state !== 'fresh'
        ) {
          valid = false;
          break;
        }
        const remaining = numeric(policy.hard_ceiling_used_pct) - numeric(used) - numeric(margin);
        capacityByAggregation[aggregationKeys[index] as string] = remaining > 0 ? remaining : 0;
      }
      if (!valid) continue;
      matching.push({
        sourceKey: entry.sourceKey,
        observation,
        capacityByAggregation,
        authorityDigest: quotaAuthorityDigest({
          sourceKey: entry.sourceKey,
          observation,
          validated,
          aggregationKeys,
          capacityByAggregation,
        }),
      });
    }
    if (matching.length === 0) {
      return {
        error: bindingMismatch ? 'RESERVATION_AUTHORITY_MISMATCH' : 'QUOTA_AUTHORITY_MISSING',
        ...(freshnessError && !bindingMismatch ? { error: freshnessError } : {}),
      };
    }
    const unique = new Map(matching.map((entry) => [entry.authorityDigest, entry]));
    if (unique.size !== 1) return { error: 'QUOTA_AUTHORITY_CONFLICT' };
    return { authority: [...unique.values()][0] };
  };

  const canonicalReservationRequestHash = (
    request: Readonly<Data>,
    aggregationKeys: string[],
    authority: ReservationAuthority,
  ): string =>
    digest({
      schema: 'ccm/quota-reservation-request/v1',
      key: request.key,
      aggregation_keys: aggregationKeys,
      amount_pct:
        aggregationKeys.length === 1
          ? request.amount_pct
          : Object.fromEntries(
              aggregationKeys.map((key) => [key, object(request.amount_pct)[key]]),
            ),
      state: 'held',
      checked_at: request.checked_at,
      expires_at: request.expires_at,
      source_revision: authority.observation.source_revision,
      authority_digest: authority.authorityDigest,
      attempt_id: request.attempt_id,
      candidate_id: request.candidate_id,
      account_id: authority.observation.account_id,
      pool_id: authority.observation.pool_id,
      identity_fingerprint: authority.observation.identity_fingerprint,
    });

  const committedTransactions = async (): Promise<
    Array<{ transaction: Data; eventRef: string }>
  > => {
    let directories: string[] = [];
    try {
      directories = await fs.readdir(transactionRoot);
    } catch (cause) {
      if (isCode(cause, 'ENOENT')) return [];
      throw cause;
    }
    const transactions: Array<{ transaction: Data; eventRef: string }> = [];
    for (const directory of directories.sort()) {
      const eventRef = join(transactionRoot, directory, 'current.json');
      const transaction = await readJson(fs, eventRef);
      if (!transaction || transaction.state !== 'committed') continue;
      if (
        transaction.schema !== 'ccm/quota-reservation-transaction/v1' ||
        !nonempty(transaction.transaction_id) ||
        !nonempty(transaction.key) ||
        !nonempty(transaction.hash)
      ) {
        throw conflict(`transaction schema or binding invalid ${directory}`);
      }
      if (hash(String(transaction.key ?? '')) !== directory) {
        throw conflict(`transaction directory identity mismatch ${directory}`);
      }
      const entries = Array.isArray(transaction.legs) ? transaction.legs.map(object) : [];
      if (entries.length < 2)
        throw conflict(`committed transaction has incomplete legs ${directory}`);
      const aggregationKeys = Array.isArray(transaction.aggregation_keys)
        ? transaction.aggregation_keys.map(String)
        : [];
      if (
        new Set(aggregationKeys).size !== aggregationKeys.length ||
        canonical([...aggregationKeys].sort()) !==
          canonical(entries.map((leg) => String(leg.aggregation_key)).sort())
      ) {
        throw conflict(`transaction aggregation identity mismatch ${directory}`);
      }
      const reservationIds = new Set<string>();
      const legBindings = new Set<string>();
      for (const leg of entries) {
        const reservation = object(leg.reservation);
        if (
          !nonempty(reservation.id) ||
          reservation.key !== transaction.key ||
          reservation.hash !== transaction.hash
        ) {
          throw conflict(`transaction leg identity mismatch ${directory}`);
        }
        reservationIds.add(reservation.id);
        legBindings.add(
          canonical({
            id: reservation.id,
            key: reservation.key,
            hash: reservation.hash,
            state: reservation.state,
            checked_at: reservation.checked_at,
            expires_at: reservation.expires_at,
            source_revision: reservation.source_revision,
            attempt_id: reservation.attempt_id,
            candidate_id: reservation.candidate_id,
            account_id: reservation.account_id,
            pool_id: reservation.pool_id,
            identity_fingerprint: reservation.identity_fingerprint,
            authority_source_key: reservation.authority_source_key,
            authority_digest: reservation.authority_digest,
          }),
        );
      }
      if (reservationIds.size !== 1)
        throw conflict(`transaction reservation id split ${directory}`);
      if (legBindings.size !== 1)
        throw conflict(`transaction reservation binding split ${directory}`);
      const orderedAggregationKeys = [...aggregationKeys].sort();
      const reservationByAggregation = new Map(
        entries.map((leg) => [String(leg.aggregation_key), object(leg.reservation)]),
      );
      const representative = object(entries[0]?.reservation);
      const expectedRequestHash = digest({
        schema: 'ccm/quota-reservation-request/v1',
        key: transaction.key,
        aggregation_keys: orderedAggregationKeys,
        amount_pct: Object.fromEntries(
          orderedAggregationKeys.map((aggregationKey) => [
            aggregationKey,
            reservationByAggregation.get(aggregationKey)?.amount_pct,
          ]),
        ),
        state: 'held',
        checked_at: representative.checked_at,
        expires_at: representative.expires_at,
        source_revision: representative.source_revision,
        authority_digest: representative.authority_digest,
        attempt_id: representative.attempt_id,
        candidate_id: representative.candidate_id,
        account_id: representative.account_id,
        pool_id: representative.pool_id,
        identity_fingerprint: representative.identity_fingerprint,
      });
      if (transaction.hash !== expectedRequestHash) {
        throw conflict(`transaction request hash mismatch ${directory}`);
      }
      const expectedTransactionId = `qtxn-${hash(
        `${String(transaction.key)}\0${expectedRequestHash}`,
      ).slice(0, 32)}`;
      if (transaction.transaction_id !== expectedTransactionId) {
        throw conflict(`transaction id mismatch ${directory}`);
      }
      transactions.push({ transaction, eventRef });
    }
    return transactions;
  };

  const committedTransactionLegs = async (
    aggregationKey: string,
  ): Promise<Array<{ reservation: Data; eventRef: string }>> => {
    const legs: Array<{ reservation: Data; eventRef: string }> = [];
    for (const { transaction, eventRef } of await committedTransactions()) {
      const entries = (transaction.legs as unknown[]).map(object);
      for (const leg of entries) {
        if (leg.aggregation_key !== aggregationKey) continue;
        legs.push({
          reservation: {
            ...object(leg.reservation),
            transaction_id: transaction.transaction_id,
          },
          eventRef,
        });
      }
    }
    return legs;
  };

  const readObservation = async (sourceKey: string): Promise<Data | undefined> => {
    const value = await readJson(fs, observationPath(sourceKey));
    if (value) assertObservationSourceIdentity(value, hash(sourceKey), sourceKey);
    return value;
  };

  const readObservationAuthority = async (directory: string): Promise<Data | undefined> => {
    const value = await readJson(fs, join(observationRoot, directory, 'current.json'));
    if (value) assertObservationSourceIdentity(value, directory);
    return value;
  };

  const publishObservation = async (request: Readonly<Data>): Promise<Data> => {
    const sourceKey = String(request.source_key ?? '');
    if (!sourceKey) throw new Error('source_key is required');
    const observation = object(request.observation);
    assertObservationSourceIdentity(observation, hash(sourceKey), sourceKey);
    const snapshotRef = observationPath(sourceKey);
    const directorySync = await atomicPublish(fs, snapshotRef, observation);
    return { ...observation, snapshot_ref: snapshotRef, directory_sync: directorySync };
  };

  const refreshObservation = async (
    request: Readonly<Data>,
    collect: () => Promise<Data>,
  ): Promise<Data> => {
    const sourceKey = String(request.source_key ?? '');
    if (!sourceKey) throw new Error('source_key is required');
    const root = join(observationRoot, hash(sourceKey));
    const lock = await acquireManagedLock(fs, root, { waitForManaged: true });
    if (!lock) throw new Error('QUOTA_LOCK_BUSY');
    try {
      const current = await readObservation(sourceKey);
      if (current) {
        const sourceProfile = validatedSourceProfile(current);
        const freshness: ObservationFreshness = sourceProfile
          ? observationFreshness(current, sourceProfile, currentTime().getTime())
          : { state: 'unknown' };
        if (freshness.state === 'fresh') {
          return {
            ...current,
            freshness: freshness.state,
            age_sec: freshness.ageSec,
            source_profile_revision: freshness.profileRevision,
            snapshot_ref: observationPath(sourceKey),
          };
        }
      }
      const observation = await collect();
      return await publishObservation({ source_key: sourceKey, observation });
    } finally {
      await lock.release();
    }
  };

  const loadAggregation = async (
    aggregationKey: string,
    rebuild = true,
  ): Promise<LoadedAggregation> => {
    const root = aggregationPath(aggregationKey);
    const eventRoot = join(root, 'events');
    const snapshotRef = join(root, 'snapshot.json');
    let names: string[] = [];
    try {
      names = (await fs.readdir(eventRoot)).filter((name) => name.endsWith('.json')).sort();
    } catch (cause) {
      if (!isCode(cause, 'ENOENT')) throw cause;
    }
    const state = emptyState(aggregationKey);
    const seen = new Set<number>();
    for (const [index, name] of names.entries()) {
      const match = /^(\d+)-.+\.json$/.exec(name);
      if (!match?.[1]) throw conflict(`invalid event filename ${name}`);
      const sequence = Number(match[1]);
      if (!Number.isSafeInteger(sequence) || sequence !== index + 1 || seen.has(sequence)) {
        throw conflict(`non-continuous or duplicate event sequence ${sequence}`);
      }
      seen.add(sequence);
      let event: Data;
      try {
        event = JSON.parse(await fs.readFile(join(eventRoot, name), 'utf8')) as Data;
      } catch (cause) {
        throw conflict(`invalid authoritative event ${name}`, cause);
      }
      if (event.sequence !== sequence || event.aggregation_key !== aggregationKey) {
        throw conflict(`event identity mismatch ${name}`);
      }
      const reservation = object(event.reservation);
      const reservationId = String(event.reservation_id ?? reservation.id ?? '');
      if (!reservationId || reservationId !== String(reservation.id ?? reservationId)) {
        throw conflict(`reservation identity mismatch ${name}`);
      }
      const existingIndex = state.reservations.findIndex((row) => row.id === reservationId);
      const projected = { ...reservation, id: reservationId, event_ref: join(eventRoot, name) };
      if (existingIndex >= 0) {
        if (
          canonical(stableReservationBinding(state.reservations[existingIndex] as Data)) !==
          canonical(stableReservationBinding(projected))
        ) {
          throw conflict(`reservation id binding mismatch ${reservationId}`);
        }
        state.reservations[existingIndex] = projected;
      } else state.reservations.push(projected);
      state.sequence = sequence;
    }
    const transactionLegs = await committedTransactionLegs(aggregationKey);
    for (const leg of transactionLegs) {
      const existingIndex = state.reservations.findIndex((row) => row.id === leg.reservation.id);
      const projected = { ...leg.reservation, event_ref: leg.eventRef };
      if (existingIndex >= 0) {
        if (canonical(state.reservations[existingIndex]) !== canonical(projected)) {
          throw conflict(`reservation conflicts with committed transaction ${leg.reservation.id}`);
        }
      } else {
        state.reservations.push(projected);
      }
    }
    state.active_reserved_pct = state.reservations
      .filter(active)
      .reduce((sum, row) => sum + numeric(row.amount_pct), 0);

    let snapshot: Data | undefined;
    try {
      snapshot = await readJson(fs, snapshotRef);
    } catch {
      snapshot = undefined;
    }
    const snapshotValid =
      snapshot?.schema === state.schema &&
      snapshot.aggregation_key === aggregationKey &&
      snapshot.sequence === state.sequence &&
      Array.isArray(snapshot.reservations) &&
      canonical(snapshot.reservations) === canonical(state.reservations);
    const authoritativeCount = names.length + transactionLegs.length;
    const snapshotRebuilt = authoritativeCount > 0 && !snapshotValid;
    if (snapshotRebuilt && rebuild) await atomicPublish(fs, snapshotRef, state);
    return {
      state,
      snapshotRef,
      durableEventCount: authoritativeCount,
      replayedEventCount: snapshotRebuilt ? authoritativeCount : 0,
      snapshotRebuilt,
    };
  };

  const inspectAggregation = async (aggregationKey: string): Promise<Data> => {
    const loaded = await loadAggregation(aggregationKey);
    return {
      ...loaded.state,
      snapshot_ref: loaded.snapshotRef,
      durable_event_count: loaded.durableEventCount,
      replayed_event_count: loaded.replayedEventCount,
      snapshot_rebuilt: loaded.snapshotRebuilt,
      oversubscribed: false,
      release_count: 0,
      spawn_count: 0,
    };
  };

  const validateReserveRequest = (
    request: Readonly<Data>,
    aggregationKeys: string[],
  ): string | undefined => {
    if (request.schema !== 'ccm/quota-reservation-request/v1') return 'schema';
    const allowedFields = new Set([
      'schema',
      'source_key',
      'aggregation_key',
      'aggregation_keys',
      'capacity_pct',
      'id',
      'key',
      'hash',
      'amount_pct',
      'state',
      'checked_at',
      'expires_at',
      'source_revision',
      'attempt_id',
      'candidate_id',
      'account_id',
      'pool_id',
      'identity_fingerprint',
    ]);
    const unknownField = Object.keys(request).find((field) => !allowedFields.has(field));
    if (unknownField) return `unknown:${unknownField}`;
    const hasSingle = Object.hasOwn(request, 'aggregation_key');
    const hasMulti = Object.hasOwn(request, 'aggregation_keys');
    if (hasSingle === hasMulti) return 'aggregation_key_shape';
    if (
      aggregationKeys.length === 0 ||
      aggregationKeys.some((key) => !nonempty(key)) ||
      new Set(aggregationKeys).size !== aggregationKeys.length
    ) {
      return 'aggregation_keys';
    }
    for (const field of [
      'id',
      'key',
      'source_revision',
      'attempt_id',
      'candidate_id',
      'account_id',
      'pool_id',
      'identity_fingerprint',
    ]) {
      if (!nonempty(request[field])) return field;
    }
    if (request.state !== 'held') return 'state';
    if (!Number.isFinite(Date.parse(String(request.checked_at ?? '')))) return 'checked_at';
    if (!Number.isFinite(Date.parse(String(request.expires_at ?? '')))) return 'expires_at';
    if (aggregationKeys.length === 1) {
      if (!positivePercentage(request.amount_pct)) return 'amount_pct';
      if (!positivePercentage(request.capacity_pct)) return 'capacity_pct';
      return undefined;
    }
    const amounts = object(request.amount_pct);
    const capacities = object(request.capacity_pct);
    for (const key of aggregationKeys) {
      if (!positivePercentage(amounts[key])) return `amount_pct:${key}`;
      if (!positivePercentage(capacities[key])) return `capacity_pct:${key}`;
    }
    return undefined;
  };

  const reserve = async (request: Readonly<Data>): Promise<Data> => {
    const operationNow = currentTime();
    const checkedAtMs = operationNow.getTime();
    const aggregationKeys = Array.isArray(request.aggregation_keys)
      ? request.aggregation_keys.map((key) => (typeof key === 'string' ? key : '')).sort()
      : [String(request.aggregation_key ?? '')];
    const invalidField = validateReserveRequest(request, aggregationKeys);
    if (invalidField) {
      return {
        action: 'rejected',
        error: 'RESERVATION_INVALID_REQUEST',
        invalid_field: invalidField,
        new_reservation_count: 0,
        spawn_count: 0,
      };
    }
    if (Date.parse(String(request.expires_at)) <= checkedAtMs) {
      return {
        action: 'rejected',
        error: 'RESERVATION_EXPIRED',
        new_reservation_count: 0,
        spawn_count: 0,
      };
    }
    const key = String(request.key);
    const idempotencyLock = await acquireManagedLock(fs, join(reservationKeyRoot, hash(key)), {
      waitForManaged: true,
    });
    if (!idempotencyLock) return { action: 'rejected', error: 'QUOTA_LOCK_BUSY', spawn_count: 0 };
    const identityLock = await acquireManagedLock(
      fs,
      join(reservationIdentityLockRoot, hash(String(request.id))),
      { waitForManaged: true },
    );
    if (!identityLock) {
      await idempotencyLock.release();
      return { action: 'rejected', error: 'QUOTA_LOCK_BUSY', spawn_count: 0 };
    }
    const locks: ManagedLock[] = [];
    try {
      for (const aggregationKey of aggregationKeys) {
        const lock = await acquireManagedLock(fs, aggregationPath(aggregationKey), {
          waitForManaged: true,
        });
        if (!lock) {
          return { action: 'rejected', error: 'QUOTA_LOCK_BUSY', spawn_count: 0 };
        }
        locks.push(lock);
      }

      const loaded = await Promise.all(aggregationKeys.map((key) => loadAggregation(key, false)));
      const authorityResult = await resolveReservationAuthority(
        request,
        aggregationKeys,
        checkedAtMs,
      );
      if (!authorityResult.authority) {
        return {
          action: 'rejected',
          error: authorityResult.error,
          new_reservation_count: 0,
          spawn_count: 0,
        };
      }
      const authority = authorityResult.authority;
      const callerCapacities = object(request.capacity_pct);
      const capacityMatchesAuthority = aggregationKeys.every((aggregationKey) => {
        const callerCapacity =
          aggregationKeys.length === 1 ? request.capacity_pct : callerCapacities[aggregationKey];
        return (
          positivePercentage(callerCapacity) &&
          callerCapacity === authority.capacityByAggregation[aggregationKey]
        );
      });
      if (!capacityMatchesAuthority) {
        return {
          action: 'rejected',
          error: 'RESERVATION_AUTHORITY_MISMATCH',
          invalid_field: 'capacity_pct',
          new_reservation_count: 0,
          spawn_count: 0,
        };
      }
      const requestHash = canonicalReservationRequestHash(request, aggregationKeys, authority);
      const existingById = await findReservation(String(request.id));
      const existingByKey = await findReservationByKey(key);
      if (existingByKey) {
        if (existingById && existingById.reservation.id !== existingByKey.reservation.id) {
          return {
            action: 'rejected',
            error: 'RESERVATION_ID_CONFLICT',
            new_reservation_count: 0,
            spawn_count: 0,
          };
        }
        const sameAuthority =
          existingByKey.reservation.hash === requestHash &&
          canonical(existingByKey.aggregationKeys) === canonical(aggregationKeys);
        if (!sameAuthority) {
          return {
            action: 'rejected',
            error: 'RESERVATION_IDEMPOTENCY_CONFLICT',
            new_reservation_count: 0,
            spawn_count: 0,
          };
        }
        const keyIndex = await ensureReservationKeyIndex(key, existingByKey);
        const repaired =
          existingByKey.kind === 'transaction'
            ? await Promise.all(
                aggregationKeys.map((aggregationKey) => loadAggregation(aggregationKey, true)),
              )
            : undefined;
        return {
          action: 'idempotent-existing',
          reservation_id: existingByKey.reservation.id,
          state: existingByKey.reservation.state,
          request_hash: requestHash,
          active_reserved_pct:
            repaired?.[0]?.state.active_reserved_pct ?? loaded[0]?.state.active_reserved_pct,
          new_reservation_count: 0,
          event_ref: existingByKey.reservation.event_ref,
          key_index_ref: keyIndex.ref,
          ...(keyIndex.directorySync ? { key_index_directory_sync: keyIndex.directorySync } : {}),
          ...(existingByKey.kind === 'transaction'
            ? {
                repaired_aggregation_keys: aggregationKeys,
                transaction_id: existingByKey.transaction?.transaction_id,
              }
            : {}),
        };
      }
      if (await readJson(fs, reservationKeyPath(key))) {
        throw conflict(`idempotency key index has no durable authority ${key}`);
      }
      if (existingById) {
        return {
          action: 'rejected',
          error: 'RESERVATION_ID_CONFLICT',
          new_reservation_count: 0,
          spawn_count: 0,
        };
      }
      const duplicates = loaded.map((aggregation) =>
        aggregation.state.reservations.find((row) => row.key === key),
      );
      if (duplicates.some(Boolean)) {
        if (
          duplicates.some((duplicate) => !duplicate) ||
          duplicates.some((duplicate) => duplicate?.hash !== requestHash) ||
          new Set(duplicates.map((duplicate) => duplicate?.id)).size !== 1
        ) {
          return {
            action: 'rejected',
            error: duplicates.some((duplicate) => duplicate?.hash !== requestHash)
              ? 'RESERVATION_IDEMPOTENCY_CONFLICT'
              : 'RESERVATION_TRANSACTION_INCOMPLETE',
            new_reservation_count: 0,
            spawn_count: 0,
          };
        }
        const duplicate = duplicates[0] as Data;
        const repaired =
          aggregationKeys.length > 1
            ? await Promise.all(
                aggregationKeys.map((aggregationKey) => loadAggregation(aggregationKey, true)),
              )
            : undefined;
        return {
          action: 'idempotent-existing',
          reservation_id: duplicate.id,
          state: duplicate.state,
          request_hash: requestHash,
          active_reserved_pct:
            repaired?.[0]?.state.active_reserved_pct ?? loaded[0]?.state.active_reserved_pct,
          new_reservation_count: 0,
          event_ref: duplicate.event_ref,
          snapshot_ref: loaded[0]?.snapshotRef,
          ...(aggregationKeys.length > 1
            ? {
                repaired_aggregation_keys: aggregationKeys,
                transaction_id: duplicate.transaction_id,
              }
            : {}),
        };
      }

      const amounts = object(request.amount_pct);
      for (const [index, aggregationKey] of aggregationKeys.entries()) {
        const aggregation = loaded[index] as LoadedAggregation;
        const capacity = numeric(authority.capacityByAggregation[aggregationKey]);
        const amount =
          aggregationKeys.length === 1
            ? numeric(request.amount_pct)
            : numeric(amounts[aggregationKey]);
        if (aggregation.state.active_reserved_pct + amount > capacity) {
          return {
            action: 'rejected',
            error: 'RESERVATION_CAPACITY_CONFLICT',
            new_reservation_count: 0,
            spawn_count: 0,
          };
        }
      }

      if (aggregationKeys.length > 1) {
        const reservationId = String(request.id);
        const transactionId = `qtxn-${hash(`${key}\0${requestHash}`).slice(0, 32)}`;
        const legs = aggregationKeys.map((aggregationKey) => ({
          aggregation_key: aggregationKey,
          reservation: {
            id: reservationId,
            key,
            hash: requestHash,
            amount_pct: numeric(amounts[aggregationKey]),
            state: 'held',
            checked_at: request.checked_at,
            expires_at: request.expires_at,
            source_revision: request.source_revision,
            attempt_id: request.attempt_id,
            candidate_id: request.candidate_id,
            account_id: request.account_id,
            pool_id: request.pool_id,
            identity_fingerprint: request.identity_fingerprint,
            authority_source_key: authority.sourceKey,
            authority_digest: authority.authorityDigest,
          },
        }));
        const journalRef = transactionPath(key);
        const existing = await readJson(fs, journalRef);
        if (existing?.state === 'committed') {
          return {
            action: 'rejected',
            error: 'RESERVATION_TRANSACTION_INCOMPLETE',
            new_reservation_count: 0,
            spawn_count: 0,
          };
        }
        const prepared = {
          schema: 'ccm/quota-reservation-transaction/v1',
          transaction_id: transactionId,
          state: 'preparing',
          key,
          hash: requestHash,
          aggregation_keys: aggregationKeys,
          legs,
        };
        await atomicPublish(fs, journalRef, prepared);
        const transactionDirectorySync = await atomicPublish(fs, journalRef, {
          ...prepared,
          state: 'committed',
          committed_at: operationNow.toISOString(),
        });
        const receipts: Data[] = [];
        for (const aggregationKey of aggregationKeys) {
          const repaired = await loadAggregation(aggregationKey, true);
          const leg = repaired.state.reservations.find((row) => row.id === reservationId) as Data;
          receipts.push({
            action: 'created',
            reservation_id: reservationId,
            state: leg.state,
            active_reserved_pct: repaired.state.active_reserved_pct,
            new_reservation_count: 1,
            request_hash: requestHash,
            event_ref: leg.event_ref,
            snapshot_ref: repaired.snapshotRef,
          });
        }
        const createdAuthority = await findReservationByKey(key);
        if (!createdAuthority)
          throw conflict(`created transaction is not globally addressable ${key}`);
        const keyIndex = await ensureReservationKeyIndex(key, createdAuthority);
        return {
          action: 'created',
          reservations: receipts,
          reservation_id: reservationId,
          transaction_id: transactionId,
          transaction_ref: journalRef,
          transaction_directory_sync: transactionDirectorySync,
          new_reservation_count: 1,
          request_hash: requestHash,
          key_index_ref: keyIndex.ref,
          ...(keyIndex.directorySync ? { key_index_directory_sync: keyIndex.directorySync } : {}),
        };
      }

      const receipts: Data[] = [];
      for (const [index, aggregationKey] of aggregationKeys.entries()) {
        const aggregation = loaded[index] as LoadedAggregation;
        const root = aggregationPath(aggregationKey);
        const sequence = aggregation.state.sequence + 1;
        const reservationId = String(request.id ?? `qres-${randomUUID()}`);
        const amount =
          aggregationKeys.length === 1
            ? numeric(request.amount_pct)
            : numeric(amounts[aggregationKey]);
        const eventRef = join(
          root,
          'events',
          `${String(sequence).padStart(20, '0')}-${randomUUID()}.json`,
        );
        const reservation: Data = {
          id: reservationId,
          key,
          hash: requestHash,
          amount_pct: amount,
          state: 'held',
          checked_at: request.checked_at,
          expires_at: request.expires_at,
          source_revision: request.source_revision,
          attempt_id: request.attempt_id,
          candidate_id: request.candidate_id,
          account_id: request.account_id,
          pool_id: request.pool_id,
          identity_fingerprint: request.identity_fingerprint,
          authority_source_key: authority.sourceKey,
          authority_digest: authority.authorityDigest,
        };
        const event: Data = {
          schema: 'ccm/quota-reservation-event/v1',
          sequence,
          event_id: randomUUID(),
          aggregation_key: aggregationKey,
          reservation_id: reservationId,
          action: 'created',
          reservation,
        };
        const eventDirectorySync = await publishEvent(fs, eventRef, event);
        aggregation.state.sequence = sequence;
        aggregation.state.reservations.push({ ...reservation, event_ref: eventRef });
        aggregation.state.active_reserved_pct += amount;
        const snapshotDirectorySync = await atomicPublish(
          fs,
          aggregation.snapshotRef,
          aggregation.state,
        );
        receipts.push({
          action: 'created',
          reservation_id: reservationId,
          state: reservation.state,
          active_reserved_pct: aggregation.state.active_reserved_pct,
          new_reservation_count: 1,
          request_hash: requestHash,
          event_ref: eventRef,
          snapshot_ref: aggregation.snapshotRef,
          event_directory_sync: eventDirectorySync,
          snapshot_directory_sync: snapshotDirectorySync,
        });
      }
      const createdAuthority = await findReservationByKey(key);
      if (!createdAuthority)
        throw conflict(`created reservation is not globally addressable ${key}`);
      const keyIndex = await ensureReservationKeyIndex(key, createdAuthority);
      return {
        ...(receipts[0] as Data),
        key_index_ref: keyIndex.ref,
        ...(keyIndex.directorySync ? { key_index_directory_sync: keyIndex.directorySync } : {}),
      };
    } finally {
      for (const lock of locks.reverse()) await lock.release();
      await identityLock.release();
      await idempotencyLock.release();
    }
  };

  const reservationAuthorities = async (): Promise<FoundReservation[]> => {
    const authorities: FoundReservation[] = [];
    for (const { transaction, eventRef } of await committedTransactions()) {
      const legs = (transaction.legs as unknown[]).map(object);
      const reservations = legs.map((leg) => ({
        ...object(leg.reservation),
        transaction_id: transaction.transaction_id,
        event_ref: eventRef,
      }));
      authorities.push({
        kind: 'transaction',
        aggregationKeys: legs.map((leg) => String(leg.aggregation_key)).sort(),
        reservation: reservations[0] as Data,
        reservations,
        transactionRef: eventRef,
        transaction,
      });
    }

    let directories: string[] = [];
    try {
      directories = await fs.readdir(reservationRoot);
    } catch (cause) {
      if (isCode(cause, 'ENOENT')) return authorities;
      throw cause;
    }
    for (const directory of directories.sort()) {
      let snapshot: Data | undefined;
      let snapshotUnreadable = false;
      try {
        snapshot = await readJson(fs, join(reservationRoot, directory, 'snapshot.json'));
      } catch {
        snapshotUnreadable = true;
      }
      let aggregationKey = String(snapshot?.aggregation_key ?? '');
      if (!aggregationKey) {
        const eventRoot = join(reservationRoot, directory, 'events');
        let names: string[] = [];
        try {
          names = (await fs.readdir(eventRoot)).filter((name) => name.endsWith('.json')).sort();
        } catch (cause) {
          if (!isCode(cause, 'ENOENT')) throw cause;
        }
        if (names.length === 0) {
          if (snapshotUnreadable || snapshot !== undefined) {
            throw conflict(`aggregation identity unavailable ${directory}`);
          }
          continue;
        }
        const firstEventName = names[0] as string;
        let firstEvent: Data | undefined;
        try {
          firstEvent = await readJson(fs, join(eventRoot, firstEventName));
        } catch (cause) {
          throw conflict(`invalid authoritative event ${firstEventName}`, cause);
        }
        aggregationKey = String(firstEvent?.aggregation_key ?? '');
        if (!aggregationKey) {
          throw conflict(`authoritative event identity missing ${firstEventName}`);
        }
      }
      if (hash(aggregationKey) !== directory) {
        throw conflict(`aggregation directory identity mismatch ${directory}`);
      }
      const loaded = await loadAggregation(aggregationKey, false);
      for (const reservation of loaded.state.reservations) {
        if (reservation.transaction_id !== undefined) continue;
        authorities.push({
          kind: 'single',
          aggregationKeys: [aggregationKey],
          reservation,
          reservations: [reservation],
        });
      }
    }
    return authorities;
  };

  const findReservation = async (reservationId: string): Promise<FoundReservation | undefined> => {
    const matches = (await reservationAuthorities()).filter(
      (authority) => authority.reservation.id === reservationId,
    );
    if (matches.length > 1) {
      throw conflict(`reservation id has multiple authorities ${reservationId}`);
    }
    return matches[0];
  };

  const findReservationByKey = async (key: string): Promise<FoundReservation | undefined> => {
    const matches = (await reservationAuthorities()).filter(
      (authority) => authority.reservation.key === key,
    );
    if (matches.length > 1) {
      throw conflict(`idempotency key has multiple authorities ${key}`);
    }
    return matches[0];
  };

  const ensureReservationKeyIndex = async (
    key: string,
    authority: FoundReservation,
  ): Promise<{ ref: string; directorySync?: 'durable' | 'unsupported' }> => {
    const ref = reservationKeyPath(key);
    const expected = {
      schema: 'ccm/quota-reservation-key-index/v1',
      key,
      reservation_id: authority.reservation.id,
      request_hash: authority.reservation.hash,
      aggregation_keys: authority.aggregationKeys,
      authority_kind: authority.kind,
      authority_ref:
        authority.kind === 'transaction'
          ? authority.transactionRef
          : join(aggregationPath(authority.aggregationKeys[0] as string), 'events'),
    };
    const existing = await readJson(fs, ref);
    if (existing) {
      if (canonical(existing) !== canonical(expected)) {
        throw conflict(`idempotency key index mismatch ${key}`);
      }
      return { ref };
    }
    return { ref, directorySync: await atomicPublish(fs, ref, expected) };
  };

  const validateTicket = (ticket: Data, aggregationKey: string, reservation: Data): boolean => {
    const required = [
      'ticket_id',
      'reservation_id',
      'reservation_request_hash',
      'reservation_expires_at',
      'attempt_id',
      'run_ref',
      'account_id',
      'pool_id',
      'identity_fingerprint',
      'aggregation_key',
      'live_source_revision',
      'runtime_sha256',
      'launch_idempotency_key',
      'launch_nonce',
      'issued_at',
      'committed_at',
      'launch_by',
    ];
    const allowed = new Set(['schema', ...required]);
    return (
      ticket.schema === 'ccm/quota-admission-ticket/v1' &&
      Object.keys(ticket).every((field) => allowed.has(field)) &&
      required.every((field) => nonempty(ticket[field])) &&
      Number.isFinite(Date.parse(String(ticket.issued_at))) &&
      Number.isFinite(Date.parse(String(ticket.committed_at))) &&
      Number.isFinite(Date.parse(String(ticket.launch_by))) &&
      Number.isFinite(Date.parse(String(ticket.reservation_expires_at))) &&
      Date.parse(String(ticket.committed_at)) >= Date.parse(String(ticket.issued_at)) &&
      Date.parse(String(ticket.launch_by)) > Date.parse(String(ticket.issued_at)) &&
      Date.parse(String(ticket.launch_by)) >= Date.parse(String(ticket.committed_at)) &&
      Date.parse(String(ticket.launch_by)) <= Date.parse(String(reservation.expires_at)) &&
      ticket.reservation_id === reservation.id &&
      ticket.reservation_request_hash === reservation.hash &&
      ticket.reservation_expires_at === reservation.expires_at &&
      ticket.attempt_id === reservation.attempt_id &&
      ticket.account_id === reservation.account_id &&
      ticket.pool_id === reservation.pool_id &&
      ticket.identity_fingerprint === reservation.identity_fingerprint &&
      ticket.aggregation_key === aggregationKey &&
      ticket.live_source_revision === reservation.source_revision
    );
  };

  const commitReservation = async (request: Readonly<Data>): Promise<Data> => {
    const operationNow = currentTime();
    if (
      Object.keys(request).some(
        (field) => !['reservation_id', 'checked_at', 'ticket'].includes(field),
      ) ||
      !nonempty(request.reservation_id) ||
      !Number.isFinite(Date.parse(String(request.checked_at ?? '')))
    ) {
      return { action: 'rejected', error: 'ADMISSION_COMMIT_INVALID', spawn_count: 0 };
    }
    const reservationId = String(request.reservation_id ?? '');
    const found = await findReservation(reservationId);
    if (!found) return { action: 'rejected', error: 'RESERVATION_NOT_FOUND', spawn_count: 0 };
    if (found.kind === 'transaction') {
      return { action: 'rejected', error: 'RESERVATION_COMMIT_UNSUPPORTED', spawn_count: 0 };
    }
    const aggregationKey = found.aggregationKeys[0] as string;
    const lock = await acquireManagedLock(fs, aggregationPath(aggregationKey), {
      waitForManaged: true,
    });
    if (!lock) return { action: 'rejected', error: 'QUOTA_LOCK_BUSY', spawn_count: 0 };
    try {
      const loaded = await loadAggregation(aggregationKey, false);
      const currentIndex = loaded.state.reservations.findIndex((row) => row.id === reservationId);
      const current = loaded.state.reservations[currentIndex];
      if (!current || current.transaction_id !== undefined) {
        return { action: 'rejected', error: 'RESERVATION_COMMIT_UNSUPPORTED', spawn_count: 0 };
      }
      if (Date.parse(String(current.expires_at)) <= operationNow.getTime()) {
        return { action: 'rejected', error: 'RESERVATION_EXPIRED', spawn_count: 0 };
      }
      const observation = nonempty(current.authority_source_key)
        ? await readObservationAuthority(current.authority_source_key)
        : undefined;
      const validatedObservation = observation
        ? validatedAuthorityObservation(observation)
        : undefined;
      if (!observation || !validatedObservation) {
        return { action: 'rejected', error: 'QUOTA_AUTHORITY_MISSING', spawn_count: 0 };
      }
      const authorityBuckets = Array.isArray(observation.buckets)
        ? observation.buckets.map(object)
        : [];
      const requiredBuckets = authorityBuckets.filter(
        (bucket) =>
          bucket.aggregation_key === aggregationKey &&
          bucket.window === validatedObservation.hardWindowName &&
          numeric(bucket.duration_sec) === validatedObservation.hardWindowDuration,
      );
      if (
        requiredBuckets.length !== 1 ||
        !validAuthorityBucket(
          requiredBuckets[0] as Data,
          validatedObservation.hardWindowName,
          validatedObservation.hardWindowDuration,
        )
      ) {
        return { action: 'rejected', error: 'QUOTA_REQUIRED_WINDOW_UNKNOWN', spawn_count: 0 };
      }
      const freshness = observationFreshness(
        observation,
        validatedObservation.sourceProfile,
        operationNow.getTime(),
        requiredBuckets,
      );
      if (freshness.state !== 'fresh') {
        return {
          action: 'rejected',
          error: freshness.error ?? 'QUOTA_REQUIRED_WINDOW_UNKNOWN',
          spawn_count: 0,
        };
      }
      const requiredBucket = requiredBuckets[0] as Data;
      const remainingCapacity =
        numeric(validatedObservation.policy.hard_ceiling_used_pct) -
        numeric(requiredBucket.used_pct) -
        numeric(requiredBucket.safety_margin_pct);
      const currentAuthorityDigest = quotaAuthorityDigest({
        sourceKey: String(current.authority_source_key),
        observation,
        validated: validatedObservation,
        aggregationKeys: [aggregationKey],
        capacityByAggregation: {
          [aggregationKey]: remainingCapacity > 0 ? remainingCapacity : 0,
        },
      });
      if (
        current.source_revision !== observation.source_revision ||
        current.account_id !== observation.account_id ||
        current.pool_id !== observation.pool_id ||
        current.identity_fingerprint !== observation.identity_fingerprint ||
        current.authority_digest !== currentAuthorityDigest
      ) {
        return {
          action: 'rejected',
          error: 'ADMISSION_COMMIT_MISSING_OR_INVALID',
          spawn_count: 0,
        };
      }
      const requestedTicket = object(request.ticket);
      const allowedTicketRequestFields = new Set([
        'schema',
        'ticket_id',
        'reservation_id',
        'reservation_request_hash',
        'reservation_expires_at',
        'attempt_id',
        'run_ref',
        'account_id',
        'pool_id',
        'identity_fingerprint',
        'aggregation_key',
        'live_source_revision',
        'runtime_sha256',
        'launch_idempotency_key',
        'launch_nonce',
        'issued_at',
        'launch_by',
      ]);
      if (Object.keys(requestedTicket).some((field) => !allowedTicketRequestFields.has(field))) {
        return { action: 'rejected', error: 'ADMISSION_TICKET_INVALID', spawn_count: 0 };
      }
      const committedAt = operationNow.toISOString();
      const ticket: Data = { ...requestedTicket, committed_at: committedAt };
      if (!validateTicket(ticket, aggregationKey, current)) {
        return { action: 'rejected', error: 'ADMISSION_TICKET_INVALID', spawn_count: 0 };
      }
      const ticketDigest = digest(ticket);
      const ticketRequestDigest = digest(requestedTicket);
      if (current.state === 'committed') {
        return current.ticket_request_digest === ticketRequestDigest
          ? {
              action: 'idempotent-existing',
              reservation_id: current.id,
              state: current.state,
              ticket_digest: current.ticket_digest,
              run_lineage: current.run_lineage,
            }
          : { action: 'rejected', error: 'ADMISSION_TICKET_CONFLICT', spawn_count: 0 };
      }
      if (current.state !== 'held') {
        return { action: 'rejected', error: 'RESERVATION_INVALID_TRANSITION', spawn_count: 0 };
      }
      const runLineage = {
        attempt_id: ticket.attempt_id,
        ticket_id: ticket.ticket_id,
        run_ref: ticket.run_ref,
        account_id: ticket.account_id,
        pool_id: ticket.pool_id,
        identity_fingerprint: ticket.identity_fingerprint,
        aggregation_key: aggregationKey,
        source_revision: ticket.live_source_revision,
        reservation_expires_at: current.expires_at,
        ticket_launch_by: ticket.launch_by,
        committed_at: committedAt,
        transition: 'held->committed',
      };
      const reservation: Data = {
        ...current,
        state: 'committed',
        ticket,
        ticket_digest: ticketDigest,
        ticket_request_digest: ticketRequestDigest,
        run_lineage: runLineage,
      };
      delete reservation.event_ref;
      const sequence = loaded.state.sequence + 1;
      const eventRef = join(
        aggregationPath(aggregationKey),
        'events',
        `${String(sequence).padStart(20, '0')}-${randomUUID()}.json`,
      );
      const eventDirectorySync = await publishEvent(fs, eventRef, {
        schema: 'ccm/quota-reservation-event/v1',
        sequence,
        event_id: randomUUID(),
        aggregation_key: aggregationKey,
        reservation_id: current.id,
        action: 'committed',
        reservation,
      });
      loaded.state.sequence = sequence;
      loaded.state.reservations[currentIndex] = { ...reservation, event_ref: eventRef };
      const snapshotDirectorySync = await atomicPublish(fs, loaded.snapshotRef, loaded.state);
      return {
        action: 'committed',
        reservation_id: current.id,
        state: 'committed',
        ticket_digest: ticketDigest,
        run_lineage: runLineage,
        event_ref: eventRef,
        snapshot_ref: loaded.snapshotRef,
        event_directory_sync: eventDirectorySync,
        snapshot_directory_sync: snapshotDirectorySync,
      };
    } finally {
      await lock.release();
    }
  };

  const rejectPreflight = (reason: string): Data => ({
    decision: 'reject',
    automatic_spawn_limit: 0,
    blocking_reasons: [reason],
    reservation_action: 'retain-orphaned',
    claim_count: 0,
    spawn_count: 0,
  });

  const preflight = async (request: Readonly<Data>): Promise<Data> => {
    const operationNow = currentTime();
    const sourceKey = String(request.source_key ?? '');
    const reservationId = String(request.reservation_id ?? '');
    if (!sourceKey || !reservationId || !Number.isFinite(Date.parse(String(request.checked_at)))) {
      return rejectPreflight('QUOTA_PREFLIGHT_REFERENCE_INVALID');
    }
    const observation = await readObservation(sourceKey);
    if (!observation) return rejectPreflight('QUOTA_REQUIRED_WINDOW_UNKNOWN');
    if (observation.observation_status === 'conflict') {
      return { ...rejectPreflight('QUOTA_OBSERVATION_CONFLICT'), circuit: 'open' };
    }
    const rawPolicy = object(observation.policy);
    const rawEffects = object(observation.effects);
    const validated = validatedAuthorityObservation(observation);
    if (!validated) {
      return rejectPreflight(
        rawPolicy.decision === 'deny'
          ? 'QUOTA_POLICY_DENIED'
          : rawEffects.decision === 'deny'
            ? 'QUOTA_EFFECT_DENIED'
            : 'QUOTA_PROVIDER_RULE_INVALID',
      );
    }
    const { policy, effects, hardWindowName, hardWindowDuration, provider } = validated;
    const allBuckets = Array.isArray(observation.buckets) ? observation.buckets.map(object) : [];
    const hardWindowBuckets = allBuckets.filter(
      (bucket) =>
        bucket.window === hardWindowName && numeric(bucket.duration_sec) === hardWindowDuration,
    );
    if (hardWindowBuckets.length === 0) return rejectPreflight('QUOTA_REQUIRED_WINDOW_UNKNOWN');
    if (
      hardWindowBuckets.some(
        (bucket) => !validAuthorityBucket(bucket, hardWindowName, hardWindowDuration),
      )
    ) {
      return rejectPreflight('QUOTA_REQUIRED_WINDOW_UNKNOWN');
    }
    const freshness = observationFreshness(
      observation,
      validated.sourceProfile,
      operationNow.getTime(),
      hardWindowBuckets,
    );
    if (freshness.state !== 'fresh') {
      return rejectPreflight(freshness.error ?? 'QUOTA_REQUIRED_WINDOW_UNKNOWN');
    }
    const found = await findReservation(reservationId);
    if (!found) return rejectPreflight('QUOTA_REQUIRED_WINDOW_UNKNOWN');
    if (found.kind === 'transaction') {
      return rejectPreflight('ADMISSION_COMMIT_MISSING_OR_INVALID');
    }
    const aggregationKey = found.aggregationKeys[0] as string;
    const requiredBuckets = hardWindowBuckets.filter(
      (bucket) => bucket.aggregation_key === aggregationKey,
    );
    if (requiredBuckets.length !== 1) {
      return rejectPreflight('QUOTA_AGGREGATION_MISMATCH');
    }
    const buckets: Data[] = [];
    for (const bucket of requiredBuckets) {
      const requiredAggregationKey = String(bucket.aggregation_key ?? '');
      const aggregation = await inspectAggregation(requiredAggregationKey);
      buckets.push({
        ...bucket,
        freshness: freshness.state,
        active_reserved_pct: aggregation.active_reserved_pct,
      });
    }
    const headroom = deriveQuotaHeadroom({ policy, buckets }) as Data;
    const current = found.reservation;
    const ticket = object(current.ticket);
    const ticketDigest = digest(ticket);
    if (
      Date.parse(String(current.expires_at)) <= operationNow.getTime() ||
      Date.parse(String(ticket.launch_by)) <= operationNow.getTime()
    ) {
      return rejectPreflight('ADMISSION_TICKET_EXPIRED');
    }
    if (
      current.state !== 'committed' ||
      current.source_revision !== observation.source_revision ||
      current.account_id !== observation.account_id ||
      current.pool_id !== observation.pool_id ||
      current.identity_fingerprint !== observation.identity_fingerprint ||
      !validateTicket(ticket, aggregationKey, current) ||
      current.ticket_digest !== ticketDigest
    ) {
      return rejectPreflight('ADMISSION_COMMIT_MISSING_OR_INVALID');
    }
    const live = {
      state: headroom.state,
      freshness: freshness.state,
      identity: observation.identity,
      aggregation_key: aggregationKey,
      source_revision: observation.source_revision,
    };
    const decision = evaluateLiveQuotaAdmission({
      checked_at: operationNow.toISOString(),
      preflight: live,
      live,
      policy,
      effects,
      rolling24h: object(observation.rolling24h),
      reservation: current,
      ticket,
    });
    return {
      ...decision,
      claim_count: decision.claim_count ?? 0,
      spawn_count: 0,
      hard_window: hardWindowName,
      provider_rule_revision: observation.provider_rule_revision,
      source_revision: observation.source_revision,
      ignored_windows:
        provider === 'codex' && allBuckets.some((bucket) => bucket.window === 'five_hour')
          ? ['five_hour']
          : [],
    };
  };

  const auditReservation = async (request: Readonly<Data>): Promise<Data> => {
    const reservationId = String(request.reservation_id ?? '');
    const identityLock = await acquireManagedLock(
      fs,
      join(reservationIdentityLockRoot, hash(reservationId)),
      { waitForManaged: true },
    );
    if (!identityLock) return { action: 'rejected', error: 'QUOTA_LOCK_BUSY', spawn_count: 0 };
    let initial: FoundReservation | undefined;
    try {
      initial = await findReservation(reservationId);
    } catch (cause) {
      await identityLock.release();
      throw cause;
    }
    if (!initial) {
      await identityLock.release();
      return { action: 'rejected', error: 'RESERVATION_NOT_FOUND', spawn_count: 0 };
    }
    const locks: ManagedLock[] = [];
    for (const aggregationKey of initial.aggregationKeys) {
      let lock: ManagedLock | undefined;
      try {
        lock = await acquireManagedLock(fs, aggregationPath(aggregationKey), {
          waitForManaged: true,
        });
      } catch (cause) {
        for (const held of locks.reverse()) await held.release();
        await identityLock.release();
        throw cause;
      }
      if (!lock) {
        for (const held of locks.reverse()) await held.release();
        await identityLock.release();
        return { action: 'rejected', error: 'QUOTA_LOCK_BUSY', spawn_count: 0 };
      }
      locks.push(lock);
    }
    try {
      const found = await findReservation(reservationId);
      if (!found || canonical(found.aggregationKeys) !== canonical(initial.aggregationKeys)) {
        throw conflict(`reservation authority changed during audit ${reservationId}`);
      }
      if (found.kind === 'transaction') {
        const transactionRef = found.transactionRef as string;
        const transaction = (await readJson(fs, transactionRef)) as Data | undefined;
        if (!transaction || transaction.state !== 'committed') {
          throw conflict(`transaction authority missing during audit ${reservationId}`);
        }
        const legs = (transaction.legs as unknown[]).map(object);
        const states = new Set(legs.map((leg) => String(object(leg.reservation).state)));
        if (states.size !== 1)
          throw conflict(`transaction state split during audit ${reservationId}`);
        const current: Data = {
          ...object(legs[0]?.reservation),
          transaction_id: transaction.transaction_id,
          event_ref: transactionRef,
        };
        // The committed transaction is the authority; snapshots are disposable projections.
        // Repair them before any idempotent/terminal return so a retry after a post-commit
        // projection crash cannot leave stale capacity visible indefinitely.
        for (const aggregationKey of found.aggregationKeys) {
          await loadAggregation(aggregationKey, true);
        }
        const proofConflict = transitionProofConflict(current, request);
        if (proofConflict) return proofConflict;
        if (terminalState(current.state)) return terminalReplay(current);
        const transition = evaluateQuotaReservationTransition({
          now: request.now,
          reservation: current,
          launch_evidence: request.launch_evidence,
          terminal_evidence: request.terminal_evidence,
          audit: request.audit,
        });
        const nextState = transition.state;
        if (typeof nextState !== 'string' || nextState === current.state) return transition;
        const nextLegs = legs.map((leg) => ({
          ...leg,
          reservation: bindTransitionProof(
            { ...object(leg.reservation), state: nextState },
            request,
            transition.action,
          ),
        }));
        const directorySync = await atomicPublish(fs, transactionRef, {
          ...transaction,
          legs: nextLegs,
          transition_sequence: numeric(transaction.transition_sequence) + 1,
          last_transition: transition.action,
          transitioned_at: new Date().toISOString(),
        });
        for (const aggregationKey of found.aggregationKeys) {
          await loadAggregation(aggregationKey, true);
        }
        return {
          ...transition,
          reservation_id: reservationId,
          transaction_id: transaction.transaction_id,
          transaction_ref: transactionRef,
          affected_aggregation_keys: found.aggregationKeys,
          transaction_directory_sync: directorySync,
        };
      }

      const aggregationKey = found.aggregationKeys[0] as string;
      const loaded = await loadAggregation(aggregationKey, true);
      const currentIndex = loaded.state.reservations.findIndex(
        (row) => row.id === request.reservation_id,
      );
      if (currentIndex < 0) {
        return { action: 'rejected', error: 'RESERVATION_NOT_FOUND', spawn_count: 0 };
      }
      const current = loaded.state.reservations[currentIndex] as Data;
      const proofConflict = transitionProofConflict(current, request);
      if (proofConflict) return proofConflict;
      if (terminalState(current.state)) return terminalReplay(current);
      const transition = evaluateQuotaReservationTransition({
        now: request.now,
        reservation: current,
        launch_evidence: request.launch_evidence,
        terminal_evidence: request.terminal_evidence,
        audit: request.audit,
      });
      const nextState = transition.state;
      if (typeof nextState !== 'string' || nextState === current.state) return transition;

      const sequence = loaded.state.sequence + 1;
      const eventRef = join(
        aggregationPath(aggregationKey),
        'events',
        `${String(sequence).padStart(20, '0')}-${randomUUID()}.json`,
      );
      const reservation = bindTransitionProof(
        { ...current, state: nextState },
        request,
        transition.action,
      );
      delete reservation.event_ref;
      const eventDirectorySync = await publishEvent(fs, eventRef, {
        schema: 'ccm/quota-reservation-event/v1',
        sequence,
        event_id: randomUUID(),
        aggregation_key: aggregationKey,
        reservation_id: current.id,
        action: transition.action,
        reservation,
      });
      loaded.state.sequence = sequence;
      loaded.state.reservations[currentIndex] = { ...reservation, event_ref: eventRef };
      loaded.state.active_reserved_pct = loaded.state.reservations
        .filter(active)
        .reduce((sum, row) => sum + numeric(row.amount_pct), 0);
      const snapshotDirectorySync = await atomicPublish(fs, loaded.snapshotRef, loaded.state);
      return {
        ...transition,
        event_ref: eventRef,
        snapshot_ref: loaded.snapshotRef,
        event_directory_sync: eventDirectorySync,
        snapshot_directory_sync: snapshotDirectorySync,
      };
    } finally {
      for (const lock of locks.reverse()) await lock.release();
      await identityLock.release();
    }
  };

  const status = async (): Promise<Data> => {
    const available = await exists(fs, observationRoot);
    return { schema: 'ccm/quota-status/v1', available };
  };

  return {
    refreshObservation,
    publishObservation,
    readObservation,
    reserve,
    commitReservation,
    preflight,
    inspectAggregation,
    auditReservation,
    status,
  };
}
