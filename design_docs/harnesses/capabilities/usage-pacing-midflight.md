# usage-pacing-midflight

## Intent（host-neutral）

During long orchestration runs, surface **quota / pacing advisories** so the orchestrator can
throttle or accelerate against 5h/7d windows (ADR-010 corridor). Mid-flight sampling at tool-batch
boundaries reduces noise; stop-side pacing catches end-of-turn decisions; optional autonomous
account switch is policy-gated (ADR-016).

## Acceptance（可测等价类）

1. When quota signal is available, `usage-pacing` emits ADR-018 tagged advisory on configured
   events (stop and/or batch).
2. When signal unavailable, hook degrades silently (no false precision).
3. Account switch suggestion only when host supports account pool + board policy allows.

## Host mechanisms

| host | status | mechanism | notes |
| --- | --- | --- | --- |
| claude-code | implemented | PostToolBatch sample + Stop; statusline sidecar; LBHOOK autoswitch | Full |
| codex | implemented-stop-advisory | Stop-only; codex-app-server usage signal; account switch NI | See usage-pacing CONTRACT |
| cursor | planned | **Stop-only** (same as Codex); `readCurrentUsage` unavailable until signal source found | Track B |

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
  reason: No verified Cursor IDE quota sidecar equivalent to Claude statusline capture.
  compensating_mechanism: readCurrentUsage unavailable; hook skips pacing math or emits weak
    "signal unavailable" ambient once per cooldown.
  tracked_by: design_docs/harnesses/capabilities/ccm-quota-account.md
```

## Linked surfaces

- Hook: [`plugin/src/hooks/usage-pacing/CONTRACT.md`](../../../plugin/src/hooks/usage-pacing/CONTRACT.md)
- Skill: `pacing-and-estimation` (consumer layer)
- ccm: `usage advise`, `account switch`

## Probe deps

cursor.md: quota signal discovery (future); no blocker for Stop-only stub.
