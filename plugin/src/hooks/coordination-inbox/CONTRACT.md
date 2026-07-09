# coordination-inbox CONTRACT

Host-neutral business-rule SSOT for the `coordination-inbox` hook (HOOKPAR-DEC).

## 触发意图

Surface durable, unconsumed `coordination.inbox` notifications to the orchestrator at Stop time.
The hook is a read-only delivery surface: producers write notifications through `ccm coordination
notify` / `arbitrate`, and the agent consumes them explicitly with `ccm coordination inbox ack`.

## 业务规则

- `rule-coordination-inbox-read-only`: the hook only calls
  `ccm coordination inbox list --unconsumed --json`; it never calls `ack`, never flips notification
  state, and never edits board files.
- `rule-coordination-inbox-tag-protocol`: unconsumed notifications are wrapped with ADR-018 tags using
  `source="coordination-inbox"`. `pacing_stop` and `hitl_turn` are directives because they carry a
  hard dispatch / human-attention boundary; other kinds are advisory with the notification's
  `strength` (`weak` by default when missing or invalid).
- `rule-coordination-inbox-ack-instruction`: every surfaced batch includes the instruction that the
  agent should run `ccm coordination inbox ack <id>` after reading and acting on the notification.
- `rule-coordination-inbox-repeat-suppression`: repeated delivery is suppressed by a hook-owned
  sidecar keyed by board path and unconsumed notification ids. New ids surface immediately; unchanged
  ids surface again only after the cooldown. The sidecar is outside the board and is not authoritative.
- `rule-coordination-inbox-arming-gate`: dormant until the session is armed against a matching active
  board.

## 注入 taxonomy

- `pacing_stop` / `hitl_turn` → **directive**: the agent must stop dispatching or route human attention
  before continuing, while still making the actual board / ack updates through ccm.
- `pacing_throttle` / `pacing_yield` / `pacing_claim` / `pacing_switch` /
  `artifact_serialize` → **advisory** with the stored notification strength.

## 武装语义

`arm:'boards'` (Claude Code) / launcher-provided active-board discovery (Codex / Cursor) — narrow-waist
only (`owner.active` / `owner.session_id`). The hook never writes board content; it writes only its
own repeat-suppression sidecar under the cc-master home.

## PARITY anchors

```yaml
- rule: rule-coordination-inbox-read-only
  required_hosts: [claude-code, codex, cursor]
- rule: rule-coordination-inbox-tag-protocol
  required_hosts: [claude-code, codex, cursor]
- rule: rule-coordination-inbox-repeat-suppression
  required_hosts: [claude-code, codex, cursor]
```

## 降级行为

```yaml
- rule: coordination-inbox-envelope-codex
  kind: protocol-capability-gap
  affected_hosts: [codex]
  reason: >
    Claude Code emits `additionalContext` on Stop; Codex Stop additionalContext is not verified, so
    the Codex launcher maps core `kind:"system"` to Stop `systemMessage`.
  compensating_mechanism: "Codex coordination-inbox-core.js emits kind:'system'; launcher maps it to systemMessage. Read/list/tag/suppression semantics are unchanged."
  tracked_by: "n/a — declared launcher-level envelope conversion, not a business-logic gap"

- rule: coordination-inbox-envelope-cursor
  kind: host-convention-divergence
  affected_hosts: [cursor]
  reason: >
    Cursor Stop advisories use `additional_context`, not Claude Code's `additionalContext` and not
    Codex `systemMessage`.
  compensating_mechanism: "Cursor coordination-inbox-core.js emits kind:'system'; launcher maps it to {additional_context}. Read/list/tag/suppression semantics are unchanged."
  tracked_by: "n/a — declared launcher-level envelope conversion; ADR-031 Track A"
```
