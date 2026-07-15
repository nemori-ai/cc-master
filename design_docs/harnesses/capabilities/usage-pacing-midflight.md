# usage-pacing-midflight

## Intent（host-neutral）

During long orchestration runs, surface **provider-scoped quota / pacing advisories** so the
orchestrator can pace against the window contract that actually belongs to that provider: Claude
5h/7d, Codex 7d hard ceiling plus rolling-24h advisory, or Cursor billing period. Mid-flight sampling
at tool-batch boundaries reduces noise; stop-side pacing catches end-of-turn decisions; autonomous
account switch exists only on an explicitly supported and policy-gated host (ADR-016).

## Acceptance（可测等价类）

1. When quota signal is available, `usage-pacing` emits ADR-018 tagged advisory on configured
   events (stop and/or batch).
2. When signal unavailable, hook degrades silently (no false precision).
3. Account switch suggestion only when host supports account pool + board policy allows.

## Host mechanisms

| host | status | mechanism | notes |
| --- | --- | --- | --- |
| claude-code | implemented | PostToolBatch sample + Stop; statusline sidecar; LBHOOK autoswitch | Full |
| codex | implemented-stop-advisory; runtime migration pending | consumer guidance: 7d-only hard ceiling + rolling-24h advisory, never 5h pacing; current hook/engine normalization remains separately tracked; account switch NI | usage-pacing CONTRACT + Codex provider contract v1 |
| cursor | implemented-stop-advisory | **Stop-only**; `ccm usage advise` via `billing_period` (never 5h/7d/switch); signal = Cursor dashboard API | Track B + `cursor-usage.ts` |

## Declared divergence

```yaml
- rule: usage-pacing-post-tool-batch-sampling
  kind: event-unavailable
  affected_hosts: [codex, cursor]
  reason: No PostToolBatch on these hosts.
  compensating_mechanism: Stop-only pacing injection; omit midflight sample segment.
  tracked_by: plugin/src/hooks/usage-pacing/CONTRACT.md

- rule: usage-pacing-mechanical-switch
  kind: protocol-capability-gap
  affected_hosts: [codex, cursor]
  reason: No Claude OAuth account pool / keychain switch backend on Codex or Cursor.
  compensating_mechanism: ccm account commands return NotImplemented; pacing omits switch lever.
  tracked_by: design_docs/harnesses/ccm-host-coupling-audit.md

- rule: usage-pacing-quota-signal-source
  kind: protocol-capability-gap
  affected_hosts: [cursor]
  reason: >
    Cursor has no 5h/7d rolling windows and no statusline sidecar; quota is a ~30d subscription
    billing cycle exposed via undocumented dashboard RPC GetCurrentPeriodUsage (Bearer from
    state.vscdb). Autoswitch is impossible (single login).
  compensating_mechanism: >
    ccm maps planUsage.totalPercentUsed → UsageSignal.billing_period; pacingAdvice emits
    hold/throttle/stop_billing_period only (never switch). Fail-open when token/API unavailable.
  tracked_by: ccm/apps/cli/src/cursor-usage.ts + design_docs/harnesses/capabilities/ccm-quota-account.md
```

## Linked surfaces

- Hook: [`plugin/src/hooks/usage-pacing/CONTRACT.md`](../../../plugin/src/hooks/usage-pacing/CONTRACT.md)
- Skill: `pacing-and-estimation` (consumer layer)
- ccm: `usage advise`, `account switch`

## Probe deps

Closed by current implementation: `cursor-usage.ts` reads dashboard `GetCurrentPeriodUsage` and maps
it to a billing-period-only signal. API/token failure remains an intentional fail-open path.

Codex target clarification (2026-07-13, consumer guidance aligned 2026-07-15): the host-neutral
intent remains multi-host, but Codex no longer consumes a 5h pacing dimension. Its historical/extra
5h fields are ignored provenance and cannot cause throttle/switch/stop_5h/reset/wakeup; only the 7d
hard ceiling gates, while rolling-24h velocity is advisory. This guidance alignment does not claim
the current hook/engine normalization migration is already complete. The provider contract source is
[`../../2026-07-13-codex-candidate-provider-driver-contract-v1.md`](../../2026-07-13-codex-candidate-provider-driver-contract-v1.md).
