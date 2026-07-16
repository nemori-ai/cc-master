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
