import { projectMachineWideQuotaNotifications as good } from './known-good.mjs';

export const counterfeits = {
  'origin-local-only'(input) {
    const out = good(input);
    out.notifications = out.notifications.filter((item) => item.destination.origin === item.payload.target.harness_id);
    return out;
  },
  'kind-collapse'(input) {
    const out = good(input);
    out.notifications = out.notifications.filter((item, index, all) =>
      index === all.findIndex((candidate) => candidate.destination.origin === item.destination.origin && candidate.kind === item.kind));
    return out;
  },
  'duplicate-on-retry'(input) {
    const out = good(input);
    out.notifications = [...out.notifications, ...structuredClone(out.notifications).map((item) => ({...item, id: `${item.id}-2`}))];
    return out;
  },
  'codex-five-hour-sensitive'(input) {
    const out = good(input);
    if (input.legacy_five_hour_pct === undefined) return out;
    const current = input.decisions.find((item) => item.target.provider_id === 'codex');
    if (!current) return out;
    const forged = structuredClone(input);
    forged.decisions = forged.decisions.map((item) => item.scope_digest === current.scope_digest ? {...item, state:'tight', decision_revision:`${item.decision_revision}-5h`} : item);
    return good(forged);
  },
  'secret-leak'(input) {
    const out = good(input);
    for (const item of out.notifications) item.payload.raw_account = 'sk-secret-counterfeit';
    return out;
  }
};
