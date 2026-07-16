import { knownGood } from './known-good.mjs';

const withProject = (projectNotifications) => ({ ...knownGood, projectNotifications });

export const counterfeits = {
  'origin-local-only': withProject((input) => {
    const out = knownGood.projectNotifications(input);
    out.notifications = out.notifications.filter(
      (item) => item.destination.origin === item.payload.target.harness_id,
    );
    return out;
  }),
  'kind-collapse': withProject((input) => {
    const out = knownGood.projectNotifications(input);
    out.notifications = out.notifications.filter(
      (item, index, all) =>
        index ===
        all.findIndex(
          (candidate) =>
            candidate.destination.origin === item.destination.origin &&
            candidate.kind === item.kind,
        ),
    );
    return out;
  }),
  'duplicate-on-retry': withProject((input) => {
    const out = knownGood.projectNotifications(input);
    out.notifications = [
      ...out.notifications,
      ...structuredClone(out.notifications).map((item) => ({ ...item, id: `${item.id}-2` })),
    ];
    return out;
  }),
  'codex-five-hour-sensitive': withProject((input) => {
    if (input.legacy_five_hour_pct === undefined) return knownGood.projectNotifications(input);
    const forged = structuredClone(input);
    forged.decisions = forged.decisions.map((item) =>
      item.target.provider_id === 'codex'
        ? {
            ...item,
            state: 'tight',
            decision_revision: `${item.decision_revision}-legacy-five-hour`,
          }
        : item,
    );
    return knownGood.projectNotifications(forged);
  }),
  'secret-leak': withProject((input) => {
    const out = knownGood.projectNotifications(input);
    for (const item of out.notifications) item.payload.raw_account = 'sk-secret-counterfeit';
    return out;
  }),
  'scope-collapse': {
    ...knownGood,
    projectPosture(authority, input) {
      const decision = knownGood.projectPosture(authority, input);
      decision.scope_digest = `sha256:${(authority.provider_id === 'cursor' ? 'c' : 'd').repeat(64)}`;
      return decision;
    },
  },
  'shared-pool-split': {
    ...knownGood,
    projectPosture(signal, input) {
      const decision = knownGood.projectPosture(signal, input);
      if (signal.provider_id === 'cursor') {
        decision.quota_scope_digest = `sha256:${(
          signal.surface_id === 'cursor-ide-plugin' ? 'e' : 'f'
        ).repeat(64)}`;
      }
      return decision;
    },
  },
  'shared-pool-additive': {
    ...knownGood,
    aggregateCapacityViews(decisions) {
      const result = knownGood.aggregateCapacityViews(decisions);
      result.known_capacities = decisions
        .filter((decision) => decision.quota_scope_digest)
        .map((decision) => ({
          quota_scope_digest: decision.quota_scope_digest,
          scope_digests: [decision.scope_digest],
          capacity_units: 1,
        }));
      return result;
    },
  },
  'null-scope-additive': {
    ...knownGood,
    aggregateCapacityViews(decisions) {
      const result = knownGood.aggregateCapacityViews(decisions);
      result.known_capacities.push(
        ...decisions
          .filter((decision) => !decision.quota_scope_digest)
          .map((decision) => ({
            quota_scope_digest: null,
            scope_digests: [decision.scope_digest],
            capacity_units: 1,
          })),
      );
      result.unresolved_scope_digests = [];
      result.unresolved_capacity_units = 0;
      return result;
    },
  },
  'checkpoint-early': {
    ...knownGood,
    async runCycle(input) {
      for (const current of input.decisions) {
        await input.checkpoint.publish(current.scope_digest, structuredClone(current));
      }
      return knownGood.runCycle(input);
    },
  },
};
