# coordination-inbox CONTRACT

Host-neutral business-rule SSOT for the `coordination-inbox` hook (HOOKPAR-DEC).

## 触发意图

Surface durable, unconsumed `coordination.inbox` notifications to the orchestrator at Stop time.
The hook is a read-only delivery surface: producers write notifications through `ccm coordination
notify` / `arbitrate`, and the agent consumes them explicitly with `ccm coordination inbox ack`.

## XH C3 exact-subscription authority（Track B target）

This hook CONTRACT is the only authority for current-subscription resolution, epoch-bounded list,
delivery fail-closed semantics, the seven-field delivery provenance set, and inbox read-only effects.
The cross-surface Capability Card owns intent/status; derived design docs only map these rule ids.

<!-- XH-C3-INBOX-AUTHORITY:BEGIN -->
```json
{
  "schema": "cc-master/xh-c3-inbox-authority/v1",
  "capability_id": "cross-harness-notification-subscription",
  "owns": [
    "current-subscription-resolution",
    "bounded-inbox-list",
    "delivery-fail-closed",
    "notification-delivery-provenance",
    "inbox-read-only-effects"
  ],
  "rule_ids": [
    "rule-coordination-inbox-current-subscription",
    "rule-coordination-inbox-bounded-list",
    "rule-coordination-inbox-subscription-fail-closed",
    "rule-coordination-inbox-delivery-provenance",
    "rule-coordination-inbox-read-only"
  ],
  "current": {
    "command": ["coordination", "subscription", "current"],
    "required_selectors": ["--board", "--origin", "--session-id", "--capability"],
    "fixed_values": {"--capability": "coordination-inbox"},
    "terminal_flags": ["--json", "--no-input"],
    "required_non_empty_response_fields": ["subscription_id", "session_epoch"],
    "exact_echo_response_fields": ["session_id", "origin", "capability"],
    "required_state": "current"
  },
  "list": {
    "command": ["coordination", "inbox", "list"],
    "required_selectors": ["--current-subscription", "--board", "--origin", "--session-id", "--session-epoch", "--capability", "--unconsumed"],
    "fixed_values": {"--capability": "coordination-inbox"},
    "terminal_flags": ["--json", "--no-input"],
    "exact_echo_response_fields": ["subscription_id", "session_id", "session_epoch", "origin", "capability"]
  },
  "fail_closed": {
    "observations": ["registration-failure", "no-current", "stale-epoch", "expired-epoch", "identity-mismatch", "epoch-mismatch"],
    "effects": ["silent-rc0", "no-list-before-exact-current", "no-weaker-retry", "no-unbound-fallback"]
  },
  "provenance": {
    "required_non_empty_fields": ["subscription_id", "session_id", "session_epoch", "origin", "capability", "source_policy_revision", "consent_provenance_ref"],
    "exact_match_fields": ["subscription_id", "session_id", "session_epoch", "origin", "capability"],
    "surface_audit_fields": ["source_policy_revision", "consent_provenance_ref"],
    "invalid_effect": "suppress-item"
  },
  "read_only": {
    "allowed_commands": ["coordination subscription current", "coordination inbox list"],
    "forbidden_effect_classes": ["ack", "coordination-write", "board-write", "provider-network", "credential", "account", "monitor-service"]
  }
}
```
<!-- XH-C3-INBOX-AUTHORITY:END -->

## 业务规则

- `rule-coordination-inbox-current-subscription`: for every armed host event, resolve exactly one
  current binding using the canonical `current` command above. The absolute lexical board path,
  normalized origin, exact native session id, and capability are mandatory. Only exact echoed
  identity, non-empty ccm-issued ids, and `state:"current"` authorize the next step.
- `rule-coordination-inbox-bounded-list`: after successful current resolution, list only with the
  complete canonical selector set above, including the exact current session id and returned epoch.
  The response must echo all five binding fields exactly; no selector may be dropped on retry.
- `rule-coordination-inbox-subscription-fail-closed`: registration failure, no current binding,
  stale/expired epoch, or any identity/epoch mismatch is silent RC0 toward the harness. It performs no
  list before exact current resolution and never falls back to an old epoch, another active session,
  newest/first subscription, board-only lookup, or legacy unbound inbox item.
- `rule-coordination-inbox-delivery-provenance`: a surfaced item contains every non-empty field in
  the canonical seven-field set. The five binding fields exactly match the current response; the two
  audit fields are retained in the host-native context. Missing, empty, or mismatched provenance
  suppresses that item without suppressing independently valid items.
- `rule-coordination-inbox-read-only`: the hook may invoke only the canonical current resolution and
  bounded list commands. It never acknowledges or writes notifications/boards/policy, and never owns
  provider/network, credential, account, or monitor/service effects.
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

The XH C3 rules above are a Track B `target`, not current implementation anchors. Their required
three-host set and stage live only in the Capability Card until executable host evidence promotes
them; adding them to this implemented-anchor block early would falsely claim runtime coverage.

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
    Cursor Stop advisories use `followup_message`, not Claude Code's `additionalContext` and not
    Codex `systemMessage`.
  compensating_mechanism: "Cursor coordination-inbox-core.js emits kind:'system'; launcher maps it to {followup_message}. Read/list/tag/suppression semantics are unchanged."
  tracked_by: "n/a — declared launcher-level envelope conversion; ADR-031 Track A"
```
