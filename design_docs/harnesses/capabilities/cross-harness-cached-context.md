# cross-harness-cached-context

## Intent（host-neutral）

Deliver one ccm-owned, cached-only machine/route context to a master orchestrator on Claude Code,
Codex, or Cursor without allowing the origin adapter to probe providers or recompute routing.

## Acceptance（可测等价类）

1. The same frozen board and machine revisions produce identical authority, candidate facts/order,
   policy, CLI eligibility/reasons, and route judgment after normalizing origin-descriptive fields
   and the origin-local native equivalence class. Native eligibility may differ only by the
   mechanical `host-native-origin-mismatch` rule; all-native input selects the matching native
   candidate for each origin.
2. The complete ambient payload is sanitized, exact-schema validated at the origin boundary, and at
   most 4096 UTF-8 bytes; correctly hashed unknown fields and private-shaped nested values are
   rejected without disclosure.
3. Missing/corrupt/stale/unknown cache is explicit or silent, RC0, and never causes a live probe.
4. Delta events emit only when the ccm delivery hash changes; routine telemetry does not create a
   new Cursor round.

## Host mechanisms

| host | status | mechanism | notes |
| --- | --- | --- | --- |
| claude-code | implemented | SessionStart + hash-deduped PostToolBatch additional context | Track A |
| codex | implemented | verified SessionStart context/system-message substrate | Track A; no PostToolBatch substitute |
| cursor | implemented-track-b | verified postToolUse.additional_context + hash dedupe | no dynamic SessionStart because D4 is a confirmed bug |

## Declared divergence

```yaml
- rule: cross-harness-context-midturn-delta
  kind: event-unavailable
  affected_hosts: [codex]
  reason: Codex has no verified PostToolBatch-equivalent event.
  compensating_mechanism: New ccm truth is delivered on the next SessionStart or through the durable coordination inbox; per-tool events are not used to fake a batch boundary.
  tracked_by: plugin/src/hooks/orchestrator-context/CONTRACT.md

- rule: cross-harness-context-cursor-start
  kind: protocol-capability-gap
  affected_hosts: [cursor]
  reason: Cursor 3.10.20 sessionStart.additional_context is a staff-confirmed drop bug and does not re-fire after compaction.
  compensating_mechanism: Static alwaysApply role substrate remains present; dynamic cached context is delivered through verified postToolUse.additional_context on first tool and later hash changes, with an on-demand ccm read as the pre-tool floor.
  tracked_by: design_docs/harnesses/cursor.md D3/D4/D5
```

## Linked surfaces

- Hook: [`plugin/src/hooks/orchestrator-context/CONTRACT.md`](../../../plugin/src/hooks/orchestrator-context/CONTRACT.md)
- ccm contract: [`design_docs/cross-harness-origin-context-delivery-spec.md`](../../cross-harness-origin-context-delivery-spec.md)
- Raw cached route contract: [`design_docs/cross-harness-shadow-routing-spec.md`](../../cross-harness-shadow-routing-spec.md)

## Probe deps

Claude Code and Codex SessionStart context are already verified in their tracked host facts. Cursor
uses D5 PASS (`postToolUse.additional_context`) and explicitly excludes D4 FAIL
(`sessionStart.additional_context`).
