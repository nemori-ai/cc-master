import { canonicalJson, sha256Hex } from '@ccm/engine';
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
    harness_id: string;
    surface_id: string;
    provider_id: string;
    identity_fingerprint: string;
    payer_scope: string;
    pool_id: string;
    unit: string;
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

function deriveState(
  input: RawMachineQuotaPostureInput,
  observation: Data | undefined,
): {
  state: MachineQuotaState;
  freshness: string;
  reasonCodes: string[];
} {
  if (!observation) {
    return {
      state: 'unknown',
      freshness: 'unknown',
      reasonCodes: ['QUOTA_REQUIRED_WINDOW_UNKNOWN'],
    };
  }
  const sourceSchema = String(observation.source?.schema ?? '');
  const profile = input.source_profiles.find(
    (candidate) => candidate.source_schema === sourceSchema,
  );
  const checkedMs = Date.parse(input.checked_at);
  const observedMs = Date.parse(String(observation.observed_at ?? ''));
  const ageSec = (checkedMs - observedMs) / 1000;
  const freshness =
    profile && Number.isFinite(ageSec) && ageSec >= -profile.max_clock_skew_sec
      ? ageSec <= profile.fresh_ttl_sec + profile.max_clock_skew_sec
        ? 'fresh'
        : ageSec <= profile.hard_ttl_sec + profile.max_clock_skew_sec
          ? 'soft-stale'
          : 'hard-stale'
      : 'unknown';
  if (freshness !== 'fresh') {
    return freshness === 'soft-stale' || freshness === 'hard-stale'
      ? { state: 'stale', freshness, reasonCodes: ['QUOTA_STALE'] }
      : { state: 'unknown', freshness, reasonCodes: ['QUOTA_REQUIRED_WINDOW_UNKNOWN'] };
  }
  const bucketId = String(observation.source_key?.bucket_id ?? '');
  const usedRaw = Number(observation.value?.used);
  const limit = Number(observation.value?.limit);
  const used = limit > 0 ? (usedRaw / limit) * 100 : Number.NaN;
  const ceiling = Number(input.policy.hard_ceiling_used_pct[bucketId]);
  const margin = Number(input.requirement.safety_margin[bucketId] ?? 0);
  if (!Number.isFinite(used) || !Number.isFinite(ceiling)) {
    return { state: 'unknown', freshness, reasonCodes: ['QUOTA_REQUIRED_WINDOW_UNKNOWN'] };
  }
  if (used >= ceiling) {
    return { state: 'exhausted', freshness, reasonCodes: ['QUOTA_HARD_CEILING_REACHED'] };
  }
  if (used + margin >= ceiling) {
    return { state: 'tight', freshness, reasonCodes: ['QUOTA_SAFETY_MARGIN_REACHED'] };
  }
  return { state: 'healthy', freshness, reasonCodes: [] };
}

/**
 * Pure authority-to-posture seam used by production composition and contract fixtures. Only the
 * explicitly required bucket participates, so retired Codex five-hour observations cannot affect
 * 7d scope, reset, state, or revision.
 */
export function projectMachineQuotaPosture(input: RawMachineQuotaPostureInput): Data {
  const observation = requiredObservation(input);
  const bucketId = String(
    observation?.source_key?.bucket_id ?? input.requirement.required_bucket_ids[0] ?? 'unknown',
  );
  const window = observation?.source_key?.window ?? {
    kind: 'unknown',
    name: 'unknown',
    duration_sec: 0,
  };
  const authority: MachineQuotaAuthority = {
    harness_id: input.authority.harness_id,
    surface_id: input.authority.surface_id,
    provider_id: input.authority.provider_id,
    identity_fingerprint: input.authority.identity_fingerprint,
    payer_scope: input.authority.payer_scope,
    pool_id: input.authority.pool_id,
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
