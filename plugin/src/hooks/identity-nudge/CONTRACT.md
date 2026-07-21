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
- `rule-identity-nudge-goal-cadence`: independently of identity/critical-path cadence, a Goal Contract
  reminder fires when `board.runtime.last_goal_remind` is missing or older than the interval
  (default 2h, overridable) and its ccm write-back succeeds. It names the current revision,
  assurance, and compact goal, and reminds the orchestrator that “有用不等于相关”: continue only
  work traceable to the current goal/acceptance criteria; classify discoveries as in-scope,
  amendment, follow-up, or unrelated rather than silently expanding scope.
- `rule-identity-nudge-tag-protocol`: both reminders are wrapped as
  `<advisory strength="weak" source="identity-nudge"|"critpath-nudge">` — periodic, low-stakes,
  reasonably ignorable nudges, never a gate.

### deadline-risk periodic entry (issue #149·契约 §5)

The periodic-prompt table gains a fourth entry, `deadline-risk`, that fires only when the board's
`goal_contract.deadline` is settled (state ∈ {asserted, confirmed} with an `at`). All schedule-risk
algorithms / verdicts stay in the ccm engine — this entry is pure transport (red line 3). The
host-neutral core lives in `plugin/src/hooks/_shared/deadline-risk-core.js` and is shared by all three
host implementations (single source ⇒ agent-facing text is identical by construction, so no separate
injection-contract anchors are needed).

- `rule-deadline-risk-cadence-and-change-trigger`: bounded hybrid trigger — a periodic check whose base
  cadence (default 2h, overridable) self-shortens as `time_to_ddl` shrinks and when the last band was
  risky, PLUS a risk-input fingerprint change trigger (窄腰 `tasks[].{id,status,deps,blocked_on}` +
  `goal_contract.deadline.{at,rev}` + `scheduling.wip_limit/owner_wip_limit`), floored by a min-recheck
  interval. On a due check the hook spawns `ccm estimate deadline-risk --board <path> --json` and writes
  `runtime.last_deadline_risk_check` (ISO) + `runtime.last_deadline_risk_fingerprint` (string) back
  through `ccm board set-param`; injection only proceeds after the check write-back succeeds (never spam
  when `ccm` is unavailable).
- `rule-deadline-risk-notification-state-machine`: a hook-owned sidecar (not the board) tracks last
  notified band / on-time probability / notification fingerprint / notified-at / top driver. The hook
  (re)notifies only on first entry into risk, band worsening, a significant on-time-probability drop,
  a top-driver change, a long-unhandled reminder interval, or a recovery (band falling back). Same
  notification fingerprint + not reminder-due ⇒ suppressed (identical risk never spams). `unknown` band
  is never mapped to green and never notified (honest low-confidence silence).
- `rule-deadline-risk-single-delivery-self-ack`: single delivery path (codex triage #6) — the Stop
  injection is the delivery; the hook additionally appends a durable `deadline_risk` coordination
  notification and immediately self-acks it (`ccm coordination inbox ack <id>`), so the durable record
  is audit / cross-session only and is never re-surfaced by `coordination-inbox`.
- `rule-deadline-risk-critpath-dedup`: when a settled DDL exists the `critpath` entry drops its
  on-track/behind schedule clause (and skips its `ccm estimate evm` call), reporting only X/Y — the
  schedule verdict belongs to the deadline-risk entry (one `deadline-risk` call replaces the DDL-scenario
  `evm` call; no duplicated compute or duplicated schedule notification).
- `rule-deadline-risk-tag-protocol`: the deadline-risk reminder is wrapped as
  `<advisory source="deadline-risk" strength="weak|strong">` — `watch` ⇒ weak, `at_risk`/`likely_late`/
  `overdue` ⇒ strong (the engine emits the ADR-018 strength; the hook fills it directly), recovery ⇒
  weak. Never a Stop block, never mutates the board goal.
- `rule-deadline-risk-fail-safe`: `ccm` absent / spawn failure / lock timeout / malformed JSON / no
  settled DDL ⇒ silent degrade (feature off — no error, no block, no board mutation, no fabricated
  verdict); retried on the next Stop per freshness.

## 注入 taxonomy

- The identity / critical-path / goal reminders are **advisory, weak** — background grounding, not
  action-forcing.
- The deadline-risk reminder is **advisory**, strength emitted by the ccm engine (`watch` weak;
  `at_risk`/`likely_late`/`overdue` strong; recovery weak). Default never blocks Stop (issue #149: an
  `overdue` → directive escalation would need a separate pressure-baseline argument; v1 stays advisory).

## 武装语义

Single-active-board gate (stricter than the general `arm:'boards'` multi-board pattern — see
`rule-identity-nudge-single-board-gate`). Writes only `runtime.last_identity_remind` /
`runtime.last_critpath_remind` / `runtime.last_goal_remind` / `runtime.last_deadline_risk_check` (ISO) /
`runtime.last_deadline_risk_fingerprint` (string) through the `ccm board set-param` whitelisted-key path
(ADR-020) — never touches the narrow waist. The deadline-risk notification-dedup state lives in a
hook-owned sidecar (not the board). Only `goal_contract.deadline` (👁, read-only) and 窄腰
`tasks[].{id,status,deps}` are read for arming / fingerprinting.

## PARITY anchors

```yaml
- rule: rule-identity-nudge-tag-protocol
  required_hosts: [claude-code, codex, cursor]
- rule: rule-identity-nudge-goal-cadence
  required_hosts: [claude-code, codex, cursor]
- rule: rule-deadline-risk-cadence-and-change-trigger
  required_hosts: [claude-code, codex, cursor]
- rule: rule-deadline-risk-notification-state-machine
  required_hosts: [claude-code, codex, cursor]
- rule: rule-deadline-risk-single-delivery-self-ack
  required_hosts: [claude-code, codex, cursor]
- rule: rule-deadline-risk-critpath-dedup
  required_hosts: [claude-code, codex, cursor]
- rule: rule-deadline-risk-tag-protocol
  required_hosts: [claude-code, codex, cursor]
- rule: rule-deadline-risk-fail-safe
  required_hosts: [claude-code, codex, cursor]
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

- rule: identity-nudge-cursor-envelope
  kind: host-convention-divergence
  affected_hosts: [cursor]
  reason: >
    Cursor `stop` only documents `followup_message` (not inject-only `additional_context`). Stop
    advisories must use `followup_message`, which auto-continues the agent (product requirement:
    notifications must reach the agent).
  compensating_mechanism: >
    Cursor identity-nudge-core.js emits kind:'system'; launcher maps all stop notifications to
    `{ followup_message }`. Cadence math and advisory tags match Codex/Claude Code. Throttled by
    periodic intervals and verify-board `loop_limit`.
  tracked_by: "_hosts/cursor/ENVELOPE.md; plugin v0.17.2"

- rule: identity-nudge-kimi-no-advisory-channel
  kind: protocol-capability-gap
  affected_hosts: [kimi-code]
  reason: >
    identity-nudge is a Stop-time advisory (periodic identity / critical-path reminder), but kimi has
    no non-blocking Stop advisory channel. Not registered on kimi.
  compensating_mechanism: >
    Role identity is re-primed via the manifest sessionStart.skill substrate (re-injected after
    compaction natively). Periodic mid-flight identity nudges have no kimi channel; a UserPromptSubmit
    delivery is the candidate follow-up.
  tracked_by: design_docs/2026-07-16-kimi-code-adapter-design.md §3

- rule: deadline-risk-shared-core
  kind: host-convention-divergence
  affected_hosts: [claude-code, codex, cursor]
  reason: >
    The deadline-risk periodic entry's business logic (cadence, change trigger, notification state
    machine, durable self-ack, critpath dedup) is host-neutral and lives once in
    plugin/src/hooks/_shared/deadline-risk-core.js. Each host's identity-nudge implementation requires
    it and only differs in the reminder envelope (Claude Code additionalContext / Codex systemMessage /
    Cursor followup_message), matching the existing identity/critpath envelope divergence above.
  compensating_mechanism: >
    Single shared core ⇒ band → strength mapping, fingerprint dedup, and agent-facing text are identical
    by construction across the three hosts; each host wraps the returned { text, strength } with its own
    local advisory() and the launcher maps kind:'system' to the host-native Stop envelope. Cursor's
    followup_message auto-continues the agent (product requirement: the notification must reach the
    agent), throttled by the periodic cadence + notification-fingerprint dedup + verify-board loop_limit.
  tracked_by: "design_docs/2026-07-16-ddl-design-contract.md §5.3; issue #149"

- rule: deadline-risk-kimi-code
  kind: protocol-capability-gap
  affected_hosts: [kimi-code]
  reason: >
    kimi-code has no identity-nudge hook — it exposes no non-blocking Stop advisory channel (mirroring
    identity-nudge-kimi-no-advisory-channel above). The deadline-risk periodic engine lives inside
    identity-nudge, so on kimi-code it has no landing point and the periodic deadline-risk advisory
    cannot be delivered.
  compensating_mechanism: >
    Out-of-scope for v1 — declared here explicitly rather than silently omitted. Deadline pressure still
    surfaces on kimi-code through the non-periodic channels that are wired: bootstrap `--ddl` records the
    deadline (strong advisory on ARM) and verify-board accepts the `deadline_pending` goal-check verdict
    (no false Stop hard-block). A periodic mid-flight deadline nudge would need a kimi non-blocking
    advisory channel (a UserPromptSubmit delivery is the candidate follow-up), tracked with the
    identity-nudge gap.
  tracked_by: "design_docs/2026-07-16-ddl-design-contract.md §5.3 (kimi-code conditional); issue #149"
```
