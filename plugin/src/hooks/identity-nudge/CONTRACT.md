# identity-nudge CONTRACT

Host-neutral business-rule SSOT for the `identity-nudge` hook (HOOKPAR-DEC).

## 触发意图

Long-horizon orchestration sessions can drift from the "conductor never plays an instrument"
posture over many turns. `identity-nudge` is a periodic Stop-time reminder (identity role +
critical-path status) that re-grounds the agent without gating anything.

## 业务规则

- `rule-identity-nudge-single-board-gate`: dormant unless exactly one matching active board exists
  for the current session (ambiguous-board sessions get no nudge rather than a guess).
- `rule-identity-nudge-identity-cadence`: the identity reminder text fires only when
  `board.runtime.last_identity_remind` is missing or older than the interval (default 6h,
  overridable), and only after the timestamp write-back through `ccm board set-param` succeeds
  (never spam when `ccm` is unavailable).
- `rule-identity-nudge-critpath-cadence`: the critical-path reminder fires on the same due/write-back
  pattern (default 2h interval) using `ccm board critical-path` + `ccm estimate evm` to report
  done/total critical-chain progress and an on-track/behind-schedule clause when a baseline exists.
- `rule-identity-nudge-tag-protocol`: both reminders are wrapped as
  `<advisory strength="weak" source="identity-nudge"|"critpath-nudge">` — periodic, low-stakes,
  reasonably ignorable nudges, never a gate.

## 注入 taxonomy

- Both reminders are **advisory, weak** — background grounding, not action-forcing.

## 武装语义

Single-active-board gate (stricter than the general `arm:'boards'` multi-board pattern — see
`rule-identity-nudge-single-board-gate`). Writes only `runtime.last_identity_remind` /
`runtime.last_critpath_remind` through the `ccm board set-param` whitelisted-key path (ADR-020) —
never touches the narrow waist.

## PARITY anchors

```yaml
- rule: rule-identity-nudge-tag-protocol
  required_hosts: [claude-code, codex]
```

## 降级行为

```yaml
- rule: identity-nudge-envelope
  kind: protocol-capability-gap
  affected_hosts: [codex]
  reason: >
    Claude Code emits both reminders as `additionalContext` on the Stop hookSpecificOutput envelope;
    Codex has no verified additionalContext-on-Stop envelope, so the launcher converts to a Stop
    `systemMessage` instead.
  compensating_mechanism: "Codex launcher's emitHostResult() maps kind:'system' to systemMessage on Stop; content and cadence math are unchanged."
  tracked_by: "n/a — declared launcher-level envelope conversion, not a business-logic gap"

- rule: identity-nudge-tag-protocol-missing-on-codex
  kind: host-convention-divergence
  affected_hosts: [codex]
  reason: >
    Prior to HOOKPAR-DEC, Codex identity-nudge-core.js emitted the two reminder texts unwrapped
    (no ADR-018 advisory tag), even though claude-code identity-nudge.js has always wrapped them.
  compensating_mechanism: >
    Fixed in this round — codex identity-nudge-core.js now wraps both reminders in a local
    `advisory(source, 'weak', body)` helper matching claude-code's wrapper output shape byte-for-byte.
  tracked_by: "adrs/ADR-028-hook-parity-contract-and-normalization.md (fixed, this PR)"
```
