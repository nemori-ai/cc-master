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

export interface MachineQuotaProjectionInput {
  previous?: Data[];
  decisions?: Data[];
  subscriptions?: Data[];
}

function digest(value: unknown): string {
  return `sha256:${sha256Hex(canonicalJson(value))}`;
}

function edge(previous: Data | undefined, current: Data): MachineQuotaEdge | null {
  if (previous?.decision_revision === current.decision_revision) return null;
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
    typeof subscription.origin === 'string'
  );
}

/**
 * Pure, agent-safe edge projector. Collection, persistence and board writes deliberately live at
 * separate seams so this function cannot acquire provider credentials or mutate quota authority.
 */
export function projectMachineWideQuotaNotifications(input: MachineQuotaProjectionInput): {
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
    const delta = {
      schema: 'ccm/machine-quota-decision-delta/v1',
      producer: 'machine-wide-quota-observer',
      scope_digest: scopeDigest,
      target: {
        harness_id: decision.target?.harness_id,
        surface_id: decision.target?.surface_id,
        provider_id: decision.target?.provider_id,
      },
      previous_state: previous?.state ?? null,
      current_state: decision.state,
      edge: transition,
      decision_revision: decision.decision_revision,
      observation_revision: decision.observation_revision,
      freshness: decision.freshness,
      reason_codes: Array.isArray(decision.reason_codes) ? [...decision.reason_codes] : [],
      policy_revision: decision.policy_revision,
      observed_at: decision.observed_at,
      valid_until: decision.valid_until,
      reset_marker: decision.reset_marker ?? null,
    };
    const deltaRevision = digest(delta);
    const payload = { ...delta, delta_revision: deltaRevision };
    deltas.push(payload);
    for (const subscription of subscriptions) {
      notifications.push({
        id: `quota-${digest(`${subscription.subscription_id}\0${deltaRevision}`).slice(7, 31)}`,
        kind: 'quota_state_change',
        strength: transition === 'recovered' || transition === 'reset' ? 'weak' : 'strong',
        summary: `${decision.target?.provider_id ?? 'provider'} quota ${transition.replaceAll('_', ' ')}`,
        destination: {
          subscription_id: subscription.subscription_id,
          session_id: subscription.session_id,
          session_epoch: subscription.session_epoch,
          origin: subscription.origin,
        },
        payload,
      });
    }
  }
  return { deltas, notifications };
}
