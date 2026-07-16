import { createHash } from 'node:crypto';

const edgeFor = (previous, current) => {
  if (current.reset_marker && current.reset_marker !== previous?.reset_marker) return 'reset';
  if (current.state === previous?.state && current.decision_revision === previous?.decision_revision) return null;
  if (current.state === 'tight' && previous?.state !== 'tight') return 'entered_tight';
  if (current.state === 'exhausted' && previous?.state !== 'exhausted') return 'entered_exhausted';
  if (current.state === 'stale' && previous?.state !== 'stale') return 'became_stale';
  if (current.state === 'unknown' && previous?.state !== 'unknown') return 'became_unknown';
  if (current.state === 'healthy' && previous && previous.state !== 'healthy') return 'recovered';
  return null;
};

const digest = (value) => `sha256:${createHash('sha256').update(value).digest('hex')}`;

export function projectMachineWideQuotaNotifications(input) {
  const notifications = [];
  for (const current of input.decisions) {
    const previous = input.previous.find((item) => item.scope_digest === current.scope_digest);
    const edge = edgeFor(previous, current);
    if (!edge) continue;
    const deltaRevision = digest(`${current.scope_digest}|${previous?.state || 'none'}|${current.state}|${edge}|${current.decision_revision}`);
    for (const subscription of input.subscriptions) {
      if (subscription.state !== 'current' || subscription.valid !== true) continue;
      const id = `ntf-quota-${digest(`${subscription.subscription_id}|${deltaRevision}`).slice(7, 23)}`;
      notifications.push({
        id,
        kind: 'quota_state_change',
        strength: ['recovered', 'reset'].includes(edge) ? 'weak' : 'strong',
        destination: { subscription_id: subscription.subscription_id, origin: subscription.origin },
        payload: {
          schema: 'ccm/machine-quota-decision-delta/v1',
          producer: 'machine-wide-quota-observer',
          delta_revision: deltaRevision,
          scope_digest: current.scope_digest,
          target: current.target,
          previous_state: previous?.state || null,
          current_state: current.state,
          edge,
          decision_revision: current.decision_revision,
          observation_revision: current.observation_revision,
          freshness: current.freshness,
          reason_codes: current.reason_codes,
          policy_revision: current.policy_revision,
          reset_marker: current.reset_marker || null
        }
      });
    }
  }
  return { schema: 'ccm/machine-quota-fanout/v1', notifications, checkpoint: structuredClone(input.decisions) };
}
