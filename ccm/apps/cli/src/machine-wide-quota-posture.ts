import {
  canonicalJson,
  deriveQuotaHeadroom,
  evaluateQuotaObservation,
  sha256Hex,
} from '@ccm/engine';
import {
  type MachineQuotaAuthority,
  type MachineQuotaState,
  projectMachineQuotaPosture as projectAgentSafePosture,
} from './machine-wide-quota-notification.js';

type Data = Record<string, any>;

export interface RawMachineQuotaPostureInput {
  schema: 'ccm/machine-quota-posture-input/v1';
  home_scope_salt: string;
  checked_at: string;
  authority: {
    available?: boolean;
    reason_code?: string;
    harness_id: string;
    surface_id: string;
    provider_id: string;
    account_key?: string;
    identity_fingerprint: string | null;
    payer_scope: string | null;
    pool_id: string | null;
    unit: string;
    bucket_id?: string;
    window?: Data;
  };
  observations: Data[];
  source_profiles: Array<{
    schema: 'ccm/quota-source-profile/v1';
    source_schema: string;
    fresh_ttl_sec: number;
    hard_ttl_sec: number;
    max_clock_skew_sec: number;
  }>;
  active_reservations: Data[];
  policy: {
    revision: string;
    hard_ceiling_used_pct: Record<string, number>;
  };
  requirement: {
    revision: string;
    required_bucket_ids: string[];
    safety_margin: Record<string, number>;
  };
}

function digest(value: unknown): string {
  return `sha256:${sha256Hex(canonicalJson(value))}`;
}

function requiredObservation(input: RawMachineQuotaPostureInput): Data | undefined {
  const required = new Set(input.requirement.required_bucket_ids);
  return input.observations.find((observation) =>
    required.has(String(observation?.source_key?.bucket_id ?? '')),
  );
}

function object(value: unknown): Data {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Data)
    : {};
}

function percentage(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100;
}

function activeReservedPct(input: RawMachineQuotaPostureInput, aggregationKey: string): number {
  const snapshots = input.active_reservations.filter(
    (candidate) =>
      candidate?.aggregation_key === aggregationKey && candidate?.active_reserved_pct !== undefined,
  );
  if (snapshots.length > 1) return Number.NaN;
  if (snapshots.length === 1) {
    const active = snapshots[0]?.active_reserved_pct;
    return percentage(active) ? active : Number.NaN;
  }
  let total = 0;
  for (const reservation of input.active_reservations) {
    if (
      reservation?.aggregation_key !== aggregationKey ||
      !['held', 'committed', 'release_pending', 'orphaned'].includes(String(reservation?.state))
    ) {
      continue;
    }
    if (!percentage(reservation?.amount_pct)) return Number.NaN;
    total += reservation.amount_pct;
  }
  return percentage(total) ? total : Number.NaN;
}

function deriveState(
  input: RawMachineQuotaPostureInput,
  observation: Data | undefined,
): {
  state: MachineQuotaState;
  freshness: string;
  reasonCodes: string[];
} {
  if (input.authority.available === false) {
    return {
      state: 'unknown',
      freshness: 'unknown',
      reasonCodes: [input.authority.reason_code || 'QUOTA_IDENTITY_AUTHORITY_UNKNOWN'],
    };
  }
  if (!observation) {
    return {
      state: 'unknown',
      freshness: 'unknown',
      reasonCodes: ['QUOTA_REQUIRED_WINDOW_UNKNOWN'],
    };
  }
  const source = object(observation.source);
  const sourceKey = object(observation.source_key);
  const window = object(sourceKey.window);
  const sourceSchema = String(source.schema ?? '');
  const profile = input.source_profiles.find(
    (candidate) => candidate.source_schema === sourceSchema,
  );
  const engineObservations = input.observations.map((candidate) => {
    const candidateSourceKey = object(candidate.source_key);
    const candidateWindow = object(candidateSourceKey.window);
    const value = object(candidate.value);
    const limit = Number(value.limit);
    const used = Number(value.used);
    return {
      id: candidate.observation_id,
      observation_id: candidate.observation_id,
      revision: candidate.revision,
      bucket_id: candidateSourceKey.bucket_id,
      aggregation_key: candidateSourceKey.aggregation_key,
      window: candidateWindow.name,
      duration_sec: candidateWindow.duration_sec,
      used_pct: limit > 0 ? (used / limit) * 100 : Number.NaN,
      observed_at: candidate.observed_at,
      valid_until: candidate.valid_until,
      ...(value.resets_at ? { resets_at: value.resets_at } : {}),
    };
  });
  const evaluation = evaluateQuotaObservation({
    provider: input.authority.provider_id,
    provider_window_rule: { name: window.name, duration_sec: window.duration_sec },
    required_bucket_ids: input.requirement.required_bucket_ids,
    checked_at: input.checked_at,
    profile,
    observations: engineObservations,
  });
  const freshness = String(evaluation.freshness ?? 'unknown');
  if (freshness !== 'fresh') {
    return freshness === 'soft-stale' || freshness === 'hard-stale'
      ? {
          state: 'stale',
          freshness,
          reasonCodes: [String(evaluation.blocking_error ?? 'QUOTA_STALE')],
        }
      : {
          state: 'unknown',
          freshness,
          reasonCodes: [String(evaluation.blocking_error ?? 'QUOTA_REQUIRED_WINDOW_UNKNOWN')],
        };
  }
  const bucketId = String(sourceKey.bucket_id ?? '');
  const aggregationKey = String(sourceKey.aggregation_key ?? '');
  const value = object(observation.value);
  const usedRaw = Number(value.used);
  const limit = Number(value.limit);
  const used = limit > 0 ? (usedRaw / limit) * 100 : Number.NaN;
  const ceiling = Number(input.policy.hard_ceiling_used_pct[bucketId]);
  const margin = Number(input.requirement.safety_margin[bucketId] ?? 0);
  const active = activeReservedPct(input, aggregationKey);
  if (
    !percentage(used) ||
    !percentage(ceiling) ||
    ceiling === 0 ||
    !percentage(margin) ||
    !percentage(active) ||
    !aggregationKey
  ) {
    return { state: 'unknown', freshness, reasonCodes: ['QUOTA_REQUIRED_WINDOW_UNKNOWN'] };
  }
  const headroom = deriveQuotaHeadroom({
    policy: { hard_ceiling_used_pct: ceiling },
    required_aggregation_key: aggregationKey,
    buckets: [
      {
        id: bucketId,
        aggregation_key: aggregationKey,
        freshness,
        used_pct: used,
        active_reserved_pct: active,
        safety_margin_pct: margin,
        projected_p80_pct: 0,
      },
    ],
  });
  const state = String(headroom.state ?? 'unknown');
  if (state === 'ample') return { state: 'healthy', freshness, reasonCodes: [] };
  if (state === 'tight' || state === 'exhausted') {
    return {
      state,
      freshness,
      reasonCodes: Array.isArray(headroom.blocking_reasons)
        ? headroom.blocking_reasons.map(String)
        : [`QUOTA_${state.toUpperCase()}`],
    };
  }
  return { state: 'unknown', freshness, reasonCodes: ['QUOTA_REQUIRED_WINDOW_UNKNOWN'] };
}

/**
 * Pure authority-to-posture seam used by production composition and contract fixtures. Only the
 * explicitly required bucket participates, so retired Codex five-hour observations cannot affect
 * 7d scope, reset, state, or revision.
 */
export function projectMachineQuotaPosture(input: RawMachineQuotaPostureInput): Data {
  const observation = requiredObservation(input);
  const bucketId = String(
    observation?.source_key?.bucket_id ??
      input.authority.bucket_id ??
      input.requirement.required_bucket_ids[0] ??
      'unknown',
  );
  const window = observation?.source_key?.window ??
    input.authority.window ?? {
      kind: 'unknown',
      name: 'unknown',
      duration_sec: 0,
    };
  const identityFingerprint =
    typeof input.authority.identity_fingerprint === 'string' &&
    input.authority.identity_fingerprint.length > 0
      ? input.authority.identity_fingerprint
      : `ccm/identity-unavailable/v1/${input.authority.harness_id}/${input.authority.surface_id}`;
  const poolId =
    typeof input.authority.pool_id === 'string' && input.authority.pool_id.length > 0
      ? input.authority.pool_id
      : `ccm/pool-unavailable/v1/${input.authority.harness_id}/${input.authority.surface_id}`;
  const authority: MachineQuotaAuthority = {
    harness_id: input.authority.harness_id,
    surface_id: input.authority.surface_id,
    provider_id: input.authority.provider_id,
    identity_fingerprint: identityFingerprint,
    payer_scope: input.authority.payer_scope || 'unknown',
    pool_id: poolId,
    bucket_id: bucketId,
    unit: input.authority.unit,
    window,
    policy_revision: input.policy.revision,
    required_bucket_ids: [...input.requirement.required_bucket_ids],
    safety_margin: structuredClone(input.requirement.safety_margin),
  };
  const posture = deriveState(input, observation);
  return projectAgentSafePosture(authority, {
    home_salt: input.home_scope_salt,
    state: posture.state,
    freshness: posture.freshness,
    reason_codes: posture.reasonCodes,
    reset_marker: observation?.value?.resets_at ?? null,
    observation_revision: digest({
      revision: observation?.revision ?? null,
      bucket_id: bucketId,
      value: observation?.value ?? null,
      source_raw_revision: observation?.source?.raw_revision ?? null,
    }),
    source: {
      collector_id: String(
        observation?.source?.collector ?? `${input.authority.provider_id}-quota-authority`,
      ),
      source_schema: String(observation?.source?.schema ?? 'ccm/quota-observation/v1'),
    },
    observed_at: observation?.observed_at,
    valid_until: observation?.valid_until,
  });
}
