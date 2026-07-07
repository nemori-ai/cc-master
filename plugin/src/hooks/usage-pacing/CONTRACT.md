# usage-pacing CONTRACT

Host-neutral business-rule SSOT for the `usage-pacing` hook (HOOKPAR-DEC).

## 触发意图

Consume `ccm usage advise`'s single-sided verdict (ADR-024) and turn it into an agent-facing pacing
signal at Stop time (and, on Claude Code, at mid-turn PostToolBatch sampling points), so the
orchestrator paces dispatch against the 5h/7d quota corridor without having to run its own advisory
math.

## 业务规则

- `rule-usage-pacing-verdict-source`: `ccm usage advise --json` is the only source of truth for the
  pacing verdict (`hold`/`throttle`/`switch`/`stop_5h`/`stop_7d`). The hook never re-derives quota
  math locally.
- `rule-usage-pacing-hold-silent`: verdict `hold` emits nothing.
- `rule-usage-pacing-throttle`: verdict `throttle` emits an advisory to slow down (reduce WIP, defer
  non-critical work, consider a cheaper model tier).
- `rule-usage-pacing-switch`: verdict `switch` signals the quota/account should be rotated.
- `rule-usage-pacing-stop-5h`/`rule-usage-pacing-stop-7d`: signal the 5h or 7d gate is hit — pause
  new dispatch (7d additionally means surface the decision to the user).
- `rule-usage-pacing-strength-mapping`: each verdict maps to an ADR-018 advisory strength — prefer
  `data.strength` when ccm returns one, otherwise fall back to a fixed table:
  `{stop_7d: strong, stop_5h: strong, throttle: strong, switch: weak}`.
- `rule-usage-pacing-arming-gate`: dormant until the session is armed against a matching active
  board.
- `rule-usage-pacing-stop-reentry-guard`: on a Stop-reentry (`stop_hook_active:true`) the hook is
  silent — it must not re-fire pacing advisories on the host's own Stop-block re-entry loop.

## 注入 taxonomy

- All pacing output is **advisory** (never a hard gate — pacing is a lever the orchestrator weighs,
  not a system block), with strength per `rule-usage-pacing-strength-mapping`.

## 武装语义

`arm:'boards'` (Claude Code) / inline `isArmed` (Codex) — narrow-waist only (`owner.active` /
`owner.session_id`). Never writes board content directly (account switching, where implemented,
goes through `ccm account switch`, a process-boundary call, not a board write).

## PARITY anchors

```yaml
- rule: rule-usage-pacing-tag-protocol
  required_hosts: [claude-code, codex]
```

## 降级行为

```yaml
- rule: usage-pacing-mechanical-switch
  kind: protocol-capability-gap
  affected_hosts: [codex]
  reason: >
    Claude Code's usage-pacing.js mechanically calls `ccm account switch` on verdict `switch` (an
    LBHOOK — the hook itself executes the account rotation, not just advises it). Codex account-pool
    switching is not implemented in this adapter.
  compensating_mechanism: >
    Codex treats `switch` as advisory-only: it reports the recommended switch candidate and tells
    the agent to treat it as a signal to throttle or ask the user, since it cannot execute the
    switch itself.
  tracked_by: "n/a — declared in _hosts/codex/strategy.yaml usage_pacing.behavior; intentional until Codex gains account-pool switching"

- rule: usage-pacing-post-tool-batch-sampling
  kind: event-unavailable
  affected_hosts: [codex]
  reason: >
    Claude Code's usage-pacing.js also samples mid-turn via the PostToolBatch event (a Claude-only
    grouped-tool-batch boundary) so pacing pressure can be surfaced before the turn ends, not only at
    Stop. Codex has no verified equivalent event (see posttool-batch CONTRACT.md).
  compensating_mechanism: "none — Codex pacing is Stop-only."
  tracked_by: "_hosts/codex/strategy.yaml posttool_batch.future_probe"

- rule: usage-pacing-account-switch-ambient
  kind: protocol-capability-gap
  affected_hosts: [codex]
  reason: >
    Claude Code additionally reads `board.runtime.last_account_switch` and emits an
    `<ambient source="usage-pacing">` note when it detects a switch happened (mechanical or manual)
    that has not yet been surfaced this session. This depends on the mechanical-switch machinery
    above, which Codex does not have.
  compensating_mechanism: "none — not applicable without mechanical switching."
  tracked_by: "n/a — downstream of usage-pacing-mechanical-switch"

- rule: usage-pacing-tag-protocol-missing-on-codex
  kind: host-convention-divergence
  affected_hosts: [codex]
  reason: >
    Prior to HOOKPAR-DEC, Codex usage-pacing-core.js emitted a bare `{kind:'system', message}` with
    no ADR-018 tag wrapper — the agent had no machine-readable strength signal for a pacing message
    whose stakes vary a lot by verdict (switch is low-stakes/reversible, stop_5h/stop_7d/throttle are
    high-stakes).
  compensating_mechanism: >
    Fixed in this round — codex usage-pacing-core.js now wraps the message in a local
    `advisory('usage-pacing', strength, body)` helper using the same
    rule-usage-pacing-strength-mapping table as claude-code usage-pacing.js.
  tracked_by: "adrs/ADR-028-hook-parity-contract-and-normalization.md (fixed, this PR)"
```
