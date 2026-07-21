import { canonicalJson, evaluateQuotaObservation, pacingAdvice, sha256Hex } from '@ccm/engine';
import {
  type MachineQuotaSignalScope,
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
    quota_scope_digest?: string | null;
    unit: string;
    bucket_id?: string;
    window?: Data;
    source: {
      collector_id: string;
      source_schema: string;
      auth_source: string;
    };
  };
  observations: Data[];
  source_profiles: Array<{
    schema: 'ccm/quota-source-profile/v1';
    source_schema: string;
    fresh_ttl_sec: number;
    hard_ttl_sec: number;
    max_clock_skew_sec: number;
  }>;
}

function digest(value: unknown): string {
  return `sha256:${sha256Hex(canonicalJson(value))}`;
}

function requiredObservation(input: RawMachineQuotaPostureInput): Data | undefined {
  return input.observations.find(
    (observation) =>
      String(observation?.source_key?.bucket_id ?? '') === String(input.authority.bucket_id ?? ''),
  );
}

function object(value: unknown): Data {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Data)
    : {};
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
      reasonCodes: [input.authority.reason_code || 'QUOTA_SIGNAL_UNKNOWN'],
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
    required_bucket_ids: [String(input.authority.bucket_id ?? '')],
    checked_at: input.checked_at,
    profile,
    observations: engineObservations,
  });
  const freshness = String(evaluation.freshness ?? 'unknown');
  if (freshness !== 'fresh') {
    return {
      state: 'unknown',
      freshness,
      reasonCodes: [
        freshness === 'soft-stale'
          ? 'QUOTA_SIGNAL_STALE'
          : String(evaluation.blocking_error ?? 'QUOTA_REQUIRED_WINDOW_UNKNOWN'),
      ],
    };
  }
  const value = object(observation.value);
  const usedRaw = Number(value.used);
  const limit = Number(value.limit);
  const used = limit > 0 ? (usedRaw / limit) * 100 : Number.NaN;
  if (!Number.isFinite(used) || used < 0 || used > 100) {
    return { state: 'unknown', freshness, reasonCodes: ['QUOTA_REQUIRED_WINDOW_UNKNOWN'] };
  }
  const resetMs = value.resets_at ? Date.parse(String(value.resets_at)) : Number.NaN;
  const windowSignal = {
    used_percentage: used,
    ...(Number.isFinite(resetMs) ? { resets_at: Math.floor(resetMs / 1000) } : {}),
  };
  const name = String(window.name ?? '');
  const signal = {
    five_hour: name === 'five_hour' ? windowSignal : null,
    seven_day: name === 'seven_day' ? windowSignal : null,
    billing_period: name.startsWith('billing_period') ? windowSignal : null,
  };
  const checkedAtMs = Date.parse(input.checked_at);
  const advice = pacingAdvice(signal, {
    nowSec: Number.isFinite(checkedAtMs) ? Math.floor(checkedAtMs / 1000) : undefined,
  });
  if (!advice.available) {
    return { state: 'unknown', freshness, reasonCodes: ['QUOTA_REQUIRED_WINDOW_UNKNOWN'] };
  }
  if (advice.verdict === 'hold') return { state: 'healthy', freshness, reasonCodes: [] };
  if (advice.verdict === 'throttle' || advice.verdict === 'switch') {
    return { state: 'tight', freshness, reasonCodes: ['QUOTA_TIGHT'] };
  }
  return { state: 'exhausted', freshness, reasonCodes: ['QUOTA_EXHAUSTED'] };
}

/**
 * Pure authority-to-posture seam used by production composition and contract fixtures. Only the
 * explicitly required bucket participates, so retired Codex five-hour observations cannot affect
 * 7d scope, reset, state, or revision.
 */
export function projectMachineQuotaPosture(input: RawMachineQuotaPostureInput): Data {
  const observation = requiredObservation(input);
  const bucketId = String(
    observation?.source_key?.bucket_id ?? input.authority.bucket_id ?? 'unknown',
  );
  const window = observation?.source_key?.window ??
    input.authority.window ?? {
      kind: 'unknown',
      name: 'unknown',
      duration_sec: 0,
    };
  const signal: MachineQuotaSignalScope = {
    harness_id: input.authority.harness_id,
    surface_id: input.authority.surface_id,
    provider_id: input.authority.provider_id,
    window,
    quota_scope_digest: input.authority.quota_scope_digest ?? null,
    source: structuredClone(input.authority.source),
  };
  const posture = deriveState(input, observation);
  return projectAgentSafePosture(signal, {
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
      collector_id: String(observation?.source?.collector ?? input.authority.source.collector_id),
      source_schema: String(observation?.source?.schema ?? input.authority.source.source_schema),
      auth_source: String(observation?.source?.auth_source ?? input.authority.source.auth_source),
    },
    observed_at: observation?.observed_at,
    valid_until: observation?.valid_until,
  });
}
