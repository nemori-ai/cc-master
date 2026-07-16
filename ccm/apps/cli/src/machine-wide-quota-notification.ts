import { canonicalJson, sha256Hex } from '@ccm/engine';

type Data = Record<string, any>;

export type MachineQuotaState = 'healthy' | 'tight' | 'exhausted' | 'unknown';
export type MachineQuotaEdge =
  | 'entered_tight'
  | 'entered_exhausted'
  | 'became_unknown'
  | 'recovered'
  | 'reset';

export interface MachineQuotaSignalScope {
  harness_id: string;
  surface_id: string;
  provider_id: string;
  window: Data;
  quota_scope_digest?: string | null;
  source?: Data;
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

/** Injectable production seam used by alternate supervisors and contract tests. */
export interface MachineWideQuotaNotificationBoundary {
  readPostures(input: { refresh: boolean }): Promise<Data[]> | Data[];
  listSubscriptions(): Promise<Data[]> | Data[];
  readCheckpoint(scopeDigest: string): Promise<Data | null>;
  publishCheckpoint(scopeDigest: string, decision: Data): Promise<void>;
  putInbox(notification: Data): Promise<void>;
}

function digest(value: unknown): string {
  return `sha256:${sha256Hex(typeof value === 'string' ? value : canonicalJson(value))}`;
}

/**
 * Projects trustworthy surface quota signals into an agent-safe machine-wide posture.
 * Optional identity and pool diagnostics remain private; only a home-salted capacity-correlation
 * digest crosses this seam when the collector can prove that two surfaces share one quota pool.
 */
export function projectMachineQuotaPosture(
  signal: MachineQuotaSignalScope,
  input: MachineQuotaPostureInput = {},
): Data {
  const target = {
    harness_id: signal.harness_id,
    surface_id: signal.surface_id,
    provider_id: signal.provider_id,
    window: structuredClone(signal.window),
  };
  const scopeDigest = digest(target);
  const requestedState = String(input.state ?? 'healthy');
  const state: MachineQuotaState = ['healthy', 'tight', 'exhausted', 'unknown'].includes(
    requestedState,
  )
    ? (requestedState as MachineQuotaState)
    : 'unknown';
  const freshness =
    input.freshness ??
    (requestedState === 'stale' ? 'hard-stale' : state === 'unknown' ? 'unknown' : 'fresh');
  const defaultReasons =
    state === 'healthy'
      ? []
      : state === 'unknown' && freshness === 'hard-stale'
        ? ['QUOTA_HARD_STALE']
        : state === 'unknown' && freshness === 'soft-stale'
          ? ['QUOTA_SIGNAL_STALE']
          : [`QUOTA_${state.toUpperCase()}`];
  const stableDecision = {
    target,
    quota_scope_digest: signal.quota_scope_digest ?? null,
    state,
    freshness,
    reason_codes: input.reason_codes ?? defaultReasons,
    reset_marker: input.reset_marker ?? null,
    source: input.source ??
      signal.source ?? {
        collector_id: `${signal.provider_id}-unknown`,
        source_schema: 'ccm/quota-observation/v1',
        auth_source: 'unknown',
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
      quota_scope_digest: decision.quota_scope_digest ?? null,
      source: structuredClone(decision.source),
      previous_state: previous?.state ?? null,
      current_state: decision.state,
      edge: transition,
      decision_revision: decision.decision_revision,
      observation_revision: decision.observation_revision,
      freshness: decision.freshness,
      reason_codes: Array.isArray(decision.reason_codes) ? [...decision.reason_codes] : [],
      reset_marker: decision.reset_marker ?? null,
      observed_at: decision.observed_at,
      valid_until: decision.valid_until,
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
