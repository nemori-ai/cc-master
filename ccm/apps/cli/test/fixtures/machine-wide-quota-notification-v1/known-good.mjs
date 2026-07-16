import { createHash } from 'node:crypto';

const digest = (value) =>
  `sha256:${createHash('sha256')
    .update(typeof value === 'string' ? value : canonical(value))
    .digest('hex')}`;

const canonical = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
};

export function projectMachineQuotaPosture(signal, input = {}) {
  const target = {
    harness_id: signal.harness_id,
    surface_id: signal.surface_id,
    provider_id: signal.provider_id,
    window: structuredClone(signal.window),
  };
  const scopeDigest = digest(target);
  const state = input.state || 'healthy';
  const freshness = input.freshness || (state === 'unknown' ? 'unknown' : 'fresh');
  const stableDecision = {
    target,
    quota_scope_digest: signal.quota_scope_digest || null,
    state,
    freshness,
    reason_codes:
      input.reason_codes || (state === 'healthy' ? [] : [`QUOTA_${state.toUpperCase()}`]),
    reset_marker: input.reset_marker || null,
    source: structuredClone(input.source || signal.source),
  };
  return {
    schema: 'ccm/machine-quota-decision/v1',
    scope_digest: scopeDigest,
    ...stableDecision,
    observed_at: input.observed_at || signal.observed_at,
    valid_until: input.valid_until || signal.valid_until,
    observation_revision:
      input.observation_revision ||
      digest({
        scope_digest: scopeDigest,
        used_percentage: input.used_percentage ?? signal.used_percentage,
        reset_marker: input.reset_marker || null,
        source: stableDecision.source,
      }),
    decision_revision: digest(stableDecision),
  };
}

const edgeFor = (previous, current) => {
  if (previous && current.reset_marker && current.reset_marker !== previous.reset_marker)
    return 'reset';
  if (
    current.state === previous?.state &&
    current.decision_revision === previous?.decision_revision
  )
    return null;
  if (current.state === 'tight' && previous?.state !== 'tight') return 'entered_tight';
  if (current.state === 'exhausted' && previous?.state !== 'exhausted') return 'entered_exhausted';
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
        destination: {
          subscription_id: subscription.subscription_id,
          board_id: subscription.board_id,
          session_id: subscription.session_id,
          session_epoch: subscription.session_epoch,
          origin: subscription.origin,
        },
        payload: {
          schema: 'ccm/machine-quota-decision-delta/v1',
          producer: 'machine-wide-quota-observer',
          delta_revision: deltaRevision,
          scope_digest: current.scope_digest,
          target: structuredClone(current.target),
          quota_scope_digest: current.quota_scope_digest || null,
          previous_state: previous?.state || null,
          current_state: current.state,
          edge,
          decision_revision: current.decision_revision,
          observation_revision: current.observation_revision,
          freshness: current.freshness,
          reason_codes: structuredClone(current.reason_codes),
          source: structuredClone(current.source),
          observed_at: current.observed_at,
          valid_until: current.valid_until,
          reset_marker: current.reset_marker || null,
        },
      });
    }
  }
  return { schema: 'ccm/machine-quota-fanout/v1', notifications };
}

export function aggregateMachineQuotaCapacityViews(decisions) {
  const known = new Map();
  const unresolved = [];
  for (const decision of decisions) {
    const quotaScopeDigest = decision.quota_scope_digest || null;
    if (!quotaScopeDigest) {
      unresolved.push(decision.scope_digest);
      continue;
    }
    const views = known.get(quotaScopeDigest) || [];
    views.push(decision.scope_digest);
    known.set(quotaScopeDigest, views);
  }
  return {
    schema: 'ccm/machine-quota-capacity-views/v1',
    known_capacities: [...known.entries()]
      .map(([quota_scope_digest, scope_digests]) => ({
        quota_scope_digest,
        scope_digests: [...scope_digests].sort(),
        capacity_units: 1,
      }))
      .sort((left, right) => left.quota_scope_digest.localeCompare(right.quota_scope_digest)),
    unresolved_scope_digests: unresolved.sort(),
    unresolved_capacity_units: null,
  };
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
  aggregateCapacityViews: aggregateMachineQuotaCapacityViews,
  runCycle: runMachineWideQuotaNotificationCycle,
};
