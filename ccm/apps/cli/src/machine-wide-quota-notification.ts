import { canonicalJson, sha256Hex } from '@ccm/engine';

type Data = Record<string, any>;

export type MachineQuotaState = 'healthy' | 'tight' | 'exhausted' | 'stale' | 'unknown';
export type MachineQuotaEdge =
  | 'entered_tight'
  | 'entered_exhausted'
  | 'became_stale'
  | 'became_unknown'
  | 'recovered'
  | 'reset';

export interface MachineQuotaAuthority {
  harness_id: string;
  surface_id: string;
  provider_id: string;
  identity_fingerprint: string;
  payer_scope: string;
  pool_id: string;
  bucket_id: string;
  unit: string;
  window: Data;
  policy_revision: string;
  required_bucket_ids: string[];
  safety_margin: Data;
}

export interface MachineQuotaPostureInput {
  home_salt?: string;
  state?: MachineQuotaState;
  freshness?: string;
  reason_codes?: string[];
  reset_marker?: string | null;
  source?: Data;
  observation_revision?: string;
  revision?: string;
  observed_at?: string;
  valid_until?: string;
}

export interface MachineQuotaProjectionInput {
  previous?: Data[];
  decisions?: Data[];
  subscriptions?: Data[];
}

function digest(value: unknown): string {
  return `sha256:${sha256Hex(typeof value === 'string' ? value : canonicalJson(value))}`;
}

/**
 * Projects owner-only authority facts into an agent-safe, zero-candidate reservability posture.
 * Identity and pool values remain private; only home-salted correlation digests cross this seam.
 */
export function projectMachineQuotaPosture(
  authority: MachineQuotaAuthority,
  input: MachineQuotaPostureInput = {},
): Data {
  const homeSalt = input.home_salt ?? 'ccm-machine-quota-missing-home-salt';
  const target = {
    harness_id: authority.harness_id,
    surface_id: authority.surface_id,
    provider_id: authority.provider_id,
    identity_scope_digest: digest(
      `ccm/identity-scope/v1|${homeSalt}|${authority.identity_fingerprint}`,
    ),
    payer_scope: authority.payer_scope,
    pool_scope_digest: digest(`ccm/pool-scope/v1|${homeSalt}|${authority.pool_id}`),
    bucket_id: authority.bucket_id,
    unit: authority.unit,
    window: structuredClone(authority.window),
  };
  const projectedP80 = Object.fromEntries(
    authority.required_bucket_ids.map((bucketId) => [bucketId, 0]),
  );
  const policyDigest = digest({ policy_revision: authority.policy_revision });
  const requirementDigest = digest({
    required_bucket_ids: authority.required_bucket_ids,
    projected_p80: projectedP80,
    safety_margin: authority.safety_margin,
  });
  const scopeDigest = digest({
    target,
    policy_digest: policyDigest,
    requirement_digest: requirementDigest,
  });
  const state = input.state ?? 'healthy';
  const freshness =
    input.freshness ??
    (state === 'stale' ? 'hard-stale' : state === 'unknown' ? 'unknown' : 'fresh');
  const stableDecision = {
    target,
    policy_digest: policyDigest,
    requirement_digest: requirementDigest,
    posture: { projected_p80: projectedP80 },
    state,
    freshness,
    reason_codes:
      input.reason_codes ?? (state === 'healthy' ? [] : [`QUOTA_${state.toUpperCase()}`]),
    reset_marker: input.reset_marker ?? null,
    source: input.source ?? {
      collector_id: `${authority.provider_id}-unknown`,
      source_schema: 'ccm/quota-authority-observation/v1',
    },
  };
  return {
    schema: 'ccm/machine-quota-decision/v1',
    scope_digest: scopeDigest,
    ...stableDecision,
    observation_revision:
      input.observation_revision ?? digest(`obs|${scopeDigest}|${input.revision ?? state}`),
    decision_revision: digest(stableDecision),
    ...(input.observed_at ? { observed_at: input.observed_at } : {}),
    ...(input.valid_until ? { valid_until: input.valid_until } : {}),
  };
}

function edge(previous: Data | undefined, current: Data): MachineQuotaEdge | null {
  if (
    previous &&
    previous.reset_marker !== null &&
    previous.reset_marker !== undefined &&
    current.reset_marker !== null &&
    current.reset_marker !== undefined &&
    previous.reset_marker !== current.reset_marker
  ) {
    return 'reset';
  }
  if (previous?.decision_revision === current.decision_revision) return null;
  const state = current.state as MachineQuotaState;
  if (state === previous?.state) return null;
  if (state === 'tight') return 'entered_tight';
  if (state === 'exhausted') return 'entered_exhausted';
  if (state === 'stale') return 'became_stale';
  if (state === 'unknown') return 'became_unknown';
  if (state === 'healthy' && previous) return 'recovered';
  return null;
}

function currentSubscription(subscription: Data): boolean {
  return (
    subscription.valid === true &&
    subscription.state === 'current' &&
    subscription.capability === 'coordination-inbox' &&
    typeof subscription.subscription_id === 'string' &&
    typeof subscription.session_id === 'string' &&
    typeof subscription.session_epoch === 'string' &&
    subscription.session_epoch === subscription.authoritative_epoch &&
    typeof subscription.origin === 'string'
  );
}

/** Pure, agent-safe transition projector. */
export function projectMachineWideQuotaNotifications(input: MachineQuotaProjectionInput): {
  schema: 'ccm/machine-quota-fanout/v1';
  deltas: Data[];
  notifications: Data[];
} {
  const previousByScope = new Map(
    (input.previous ?? []).map((decision) => [String(decision.scope_digest), decision]),
  );
  const subscriptions = (input.subscriptions ?? []).filter(currentSubscription);
  const deltas: Data[] = [];
  const notifications: Data[] = [];

  for (const decision of input.decisions ?? []) {
    const scopeDigest = String(decision.scope_digest ?? '');
    if (!scopeDigest) continue;
    const previous = previousByScope.get(scopeDigest);
    const transition = edge(previous, decision);
    if (!transition) continue;
    const deltaBase = {
      schema: 'ccm/machine-quota-decision-delta/v1',
      producer: 'machine-wide-quota-observer',
      scope_digest: scopeDigest,
      target: structuredClone(decision.target),
      policy_digest: decision.policy_digest,
      requirement_digest: decision.requirement_digest,
      previous_state: previous?.state ?? null,
      current_state: decision.state,
      edge: transition,
      decision_revision: decision.decision_revision,
      observation_revision: decision.observation_revision,
      freshness: decision.freshness,
      reason_codes: Array.isArray(decision.reason_codes) ? [...decision.reason_codes] : [],
      reset_marker: decision.reset_marker ?? null,
    };
    const deltaRevision = digest({
      scope_digest: scopeDigest,
      previous_state: previous?.state ?? null,
      current_state: decision.state,
      edge: transition,
      decision_revision: decision.decision_revision,
    });
    const payload = { ...deltaBase, delta_revision: deltaRevision };
    deltas.push(payload);
    for (const subscription of subscriptions) {
      notifications.push({
        id: `ntf-quota-${digest(`${subscription.subscription_id}|${deltaRevision}`).slice(7, 31)}`,
        kind: 'quota_state_change',
        strength: transition === 'recovered' || transition === 'reset' ? 'weak' : 'strong',
        summary: `${decision.target?.provider_id ?? 'provider'} quota ${transition.replaceAll('_', ' ')}`,
        destination: {
          subscription_id: subscription.subscription_id,
          board_id: subscription.board_id ?? subscription.subscription_id,
          session_id: subscription.session_id,
          session_epoch: subscription.session_epoch,
          origin: subscription.origin,
        },
        payload,
      });
    }
  }
  return { schema: 'ccm/machine-quota-fanout/v1', deltas, notifications };
}

/**
 * Per-scope crash-safe cycle: all current destinations must accept the deterministic notifications
 * before that scope's checkpoint may advance.
 */
export async function runMachineWideQuotaNotificationCycle(input: {
  decisions: Data[];
  subscriptions: Data[];
  checkpoint: {
    read(scopeDigest: string): Promise<Data | null>;
    publish(scopeDigest: string, decision: Data): Promise<void>;
  };
  inbox: { put(notification: Data): Promise<void> };
}): Promise<{ schema: 'ccm/machine-quota-fanout/v1'; notifications: Data[] }> {
  const delivered: Data[] = [];
  for (const decision of input.decisions) {
    const previous = await input.checkpoint.read(String(decision.scope_digest));
    const projected = projectMachineWideQuotaNotifications({
      previous: previous ? [previous] : [],
      decisions: [decision],
      subscriptions: input.subscriptions,
    });
    for (const notification of projected.notifications) {
      await input.inbox.put(notification);
      delivered.push(notification);
    }
    await input.checkpoint.publish(String(decision.scope_digest), structuredClone(decision));
  }
  return { schema: 'ccm/machine-quota-fanout/v1', notifications: delivered };
}
