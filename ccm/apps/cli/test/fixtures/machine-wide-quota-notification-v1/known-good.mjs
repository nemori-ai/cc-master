import { createHash } from 'node:crypto';

const digest = (value) =>
  `sha256:${createHash('sha256').update(typeof value === 'string' ? value : canonical(value)).digest('hex')}`;

const canonical = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
};

export function projectMachineQuotaPosture(authority, input = {}) {
  const homeSalt = input.home_salt || 'fixture-home-salt';
  const target = {
    harness_id: authority.harness_id,
    surface_id: authority.surface_id,
    provider_id: authority.provider_id,
    identity_scope_digest: digest(`ccm/identity-scope/v1|${homeSalt}|${authority.identity_fingerprint}`),
    payer_scope: authority.payer_scope,
    pool_scope_digest: digest(`ccm/pool-scope/v1|${homeSalt}|${authority.pool_id}`),
    bucket_id: authority.bucket_id,
    unit: authority.unit,
    window: structuredClone(authority.window),
  };
  const projectedP80 = Object.fromEntries(authority.required_bucket_ids.map((id) => [id, 0]));
  const policyDigest = digest({ policy_revision: authority.policy_revision });
  const requirementDigest = digest({
    required_bucket_ids: authority.required_bucket_ids,
    projected_p80: projectedP80,
    safety_margin: authority.safety_margin,
  });
  const scopeDigest = digest({ target, policy_digest: policyDigest, requirement_digest: requirementDigest });
  const state = input.state || 'healthy';
  const freshness = input.freshness || (state === 'stale' ? 'hard-stale' : state === 'unknown' ? 'unknown' : 'fresh');
  const stableDecision = {
    target,
    policy_digest: policyDigest,
    requirement_digest: requirementDigest,
    posture: { projected_p80: projectedP80 },
    state,
    freshness,
    reason_codes: input.reason_codes || (state === 'healthy' ? [] : [`QUOTA_${state.toUpperCase()}`]),
    reset_marker: input.reset_marker || null,
    source: input.source || { collector_id: `${authority.provider_id}-fixture`, source_schema: 'fixture/v1' },
  };
  return {
    schema: 'ccm/machine-quota-decision/v1',
    scope_digest: scopeDigest,
    ...stableDecision,
    observation_revision: input.observation_revision || digest(`obs|${scopeDigest}|${input.revision || state}`),
    decision_revision: digest(stableDecision),
  };
}

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

const isCurrent = (subscription) =>
  subscription.state === 'current' &&
  subscription.valid === true &&
  subscription.capability === 'coordination-inbox' &&
  subscription.session_epoch === subscription.authoritative_epoch;

export function projectMachineWideQuotaNotifications(input) {
  const notifications = [];
  for (const current of input.decisions) {
    const previous = input.previous.find((item) => item.scope_digest === current.scope_digest);
    const edge = edgeFor(previous, current);
    if (!edge) continue;
    const deltaRevision = digest({
      scope_digest: current.scope_digest,
      previous_state: previous?.state || null,
      current_state: current.state,
      edge,
      decision_revision: current.decision_revision,
    });
    for (const subscription of input.subscriptions.filter(isCurrent)) {
      const id = `ntf-quota-${digest(`${subscription.subscription_id}|${deltaRevision}`).slice(7, 31)}`;
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
          target: structuredClone(current.target),
          policy_digest: current.policy_digest,
          requirement_digest: current.requirement_digest,
          previous_state: previous?.state || null,
          current_state: current.state,
          edge,
          decision_revision: current.decision_revision,
          observation_revision: current.observation_revision,
          freshness: current.freshness,
          reason_codes: structuredClone(current.reason_codes),
          reset_marker: current.reset_marker || null,
        },
      });
    }
  }
  return { schema: 'ccm/machine-quota-fanout/v1', notifications };
}

export async function runMachineWideQuotaNotificationCycle(input) {
  const delivered = [];
  for (const current of input.decisions) {
    const previous = await input.checkpoint.read(current.scope_digest);
    const projected = projectMachineWideQuotaNotifications({
      previous: previous ? [previous] : [],
      decisions: [current],
      subscriptions: input.subscriptions,
    });
    for (const notification of projected.notifications) {
      await input.inbox.put(notification);
      delivered.push(notification);
    }
    await input.checkpoint.publish(current.scope_digest, structuredClone(current));
  }
  return { schema: 'ccm/machine-quota-fanout/v1', notifications: delivered };
}

export const knownGood = {
  projectPosture: projectMachineQuotaPosture,
  projectNotifications: projectMachineWideQuotaNotifications,
  runCycle: runMachineWideQuotaNotificationCycle,
};
