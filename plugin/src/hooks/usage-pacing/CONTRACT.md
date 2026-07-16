# usage-pacing CONTRACT

Host-neutral business-rule SSOT for the `usage-pacing` hook (HOOKPAR-DEC).

## 触发意图

Provide an origin-local cached pacing floor when machine-wide refresh/monitor delivery is absent.
The hook consumes ccm's provider-owned verdict and never claims it observed other harnesses. It
remains Stop-time (plus Claude Code PostToolBatch) cached delivery, not a provider collector.

## 业务规则

### Machine-wide migration rules（contract frozen；production RED）

- `rule-usage-pacing-origin-local-floor`: the hook may consume only its origin-local cached
  `ccm usage advise`; it performs zero live provider/network/credential effects and never labels that
  result machine-wide. Machine-wide production belongs to explicit `quota refresh --machine-wide` or
  a user-enabled monitor quota-source mode.
- `rule-usage-pacing-machine-wide-dedup`: when ccm reports the same target
  `scope_digest+decision_revision` already covered by machine-wide fan-out, direct injection and a
  second coordination notification are both silent. If not covered, the floor may surface only the
  explicit local target/revision, never an inferred remote provider.
- `rule-usage-pacing-signal-scope`: quota is provider account/subscription/pool capacity shared across
  harness sessions; session is only a current-login collection surface and notification destination. Cursor IDE
  and Cursor Agent both require real `billing_period` signal collection. Equal collector-proven quota-scope digest
  means one capacity view, never additive; missing identity/payer/pool diagnostics do not block a fresh signal.
- `rule-usage-pacing-cursor-agent-query-surface`: the formal Cursor Agent current-login query path is
  `ccm usage show --harness cursor-agent --accounts current --json` plus
  `ccm usage advise --harness cursor-agent --json`. Show preserves
  `current.billing_period.{used_percentage,resets_at}`; advise preserves
  `window_billing_period_pct`, `billing_period_resets_at`, and observation `as_of`. Billing-cycle reset provenance
  remains present for healthy/hold and non-stop throttle verdicts; `nearest_reset` may remain an action-only wakeup hint.
- `rule-usage-pacing-codex-7d-only`: Codex ignores every 5h field for
  decision/revision/throttle/switch/stop/reset/wakeup/notification and never performs account switch. Only 7d is a hard ceiling;
  rolling-24h velocity is advisory. This does not remove provider-owned Claude 5h/7d semantics.
- `rule-usage-pacing-no-automatic-switch`: Codex and Cursor automatically switch zero accounts. A
  machine-wide quota posture or delta never invokes `ccm account switch` and never turns account mutation
  into a fallback for exhausted quota.

These rules are executable RED and are not added to PARITY anchors before runtime migration.

- `rule-usage-pacing-verdict-source`: `ccm usage advise --json` is the only source of truth for the
  pacing verdict. Claude Code consumes its provider-owned 5h/7d set; Codex consumes its 7d-only set
  (`hold`/`throttle`/`stop_7d`) and ignores historical 5h/switch values; Cursor consumes the billing-period set
  (`hold`/`throttle`/`stop_billing_period`). The hook never re-derives quota math locally.
- `rule-usage-pacing-hold-silent`: verdict `hold` emits nothing.
- `rule-usage-pacing-throttle`: verdict `throttle` emits an advisory to slow down (reduce WIP, defer
  non-critical work, consider a cheaper model tier). Cursor copy cites `billing_period` pct only —
  never 5h/7d/switch.
- `rule-usage-pacing-switch`: Claude Code may signal an explicitly policy-gated account rotation.
  Codex/Cursor never execute account switch and are defensive silent if this legacy verdict appears.
- `rule-usage-pacing-stop-5h`/`rule-usage-pacing-stop-7d`: Claude Code can surface its provider-owned
  5h/7d gates. Codex only surfaces `stop_7d`; `stop_5h` is defensive silent. Cursor uses neither.
- `rule-usage-pacing-stop-billing-period`: Cursor-only — billing-cycle hard gate; pause dispatch
  until `nearest_reset` (billing cycle end). Never switch.
- `rule-usage-pacing-strength-mapping`: each verdict maps to an ADR-018 advisory strength — prefer
  `data.strength` when ccm returns one, otherwise fall back to a fixed table:
  Claude `{stop_7d: strong, stop_5h: strong, throttle: strong, switch: weak}`;
  Codex `{stop_7d: strong, throttle: strong}`;
  Cursor `{throttle: strong, stop_billing_period: strong}`.
- `rule-usage-pacing-arming-gate`: dormant until the session is armed against a matching active
  board.
- `rule-usage-pacing-stop-reentry-guard`: on a Stop-reentry (`stop_hook_active:true`) the hook is
  silent — it must not re-fire pacing advisories on the host's own Stop-block re-entry loop.
- `rule-usage-pacing-dual-delivery`: routine output stays direct (`hold` silent; weak/light throttle
  direct). Decision-grade output first writes a durable notification with
  `ccm coordination notify` (`throttle` strong → `pacing_throttle`, stop verdicts →
  `pacing_stop`, switch/user-action verdicts → `pacing_switch`). If the notify call fails, the hook
  falls back to the direct advisory so a transient ccm write failure does not lose the pacing signal.
  P3 still uses `ccm usage advise` as the verdict source; P4 replaces this producer path with the
  pool-aware arbiter (`ccm coordination arbitrate`) while keeping the same delivery split.

## 注入 taxonomy

- Direct pacing output is **advisory** (never a hard gate — pacing is a lever the orchestrator weighs,
  not a system block), with strength per `rule-usage-pacing-strength-mapping`. Decision-grade durable
  output is delivered through `coordination-inbox`, whose own contract decides advisory vs directive
  wrapping from notification kind.

## 武装语义

`arm:'boards'` (Claude Code) / inline `isArmed` (Codex / Cursor) — narrow-waist only (`owner.active` /
`owner.session_id`). Never writes board content directly (account switching, where implemented,
goes through `ccm account switch`, a process-boundary call, not a board write).

## PARITY anchors

```yaml
- rule: rule-usage-pacing-tag-protocol
  required_hosts: [claude-code, codex, cursor]
- rule: rule-usage-pacing-dual-delivery
  required_hosts: [claude-code, codex, cursor]
```

## 降级行为

```yaml
- rule: usage-pacing-mechanical-switch
  kind: protocol-capability-gap
  affected_hosts: [codex, cursor]
  reason: >
    Claude Code's usage-pacing.js mechanically calls `ccm account switch` on verdict `switch` (an
    LBHOOK — the hook itself executes the account rotation, not just advises it). Codex account-pool
    switching is not implemented in this adapter. Cursor has no account-pool switch surface and its
    billing_period pacing path never emits `switch`.
  compensating_mechanism: >
    Codex and Cursor discard legacy `switch` without direct output or coordination notification;
    it is not translated into an account candidate or user prompt. Cursor also stays silent on
    `stop_5h`/`stop_7d` (defensive) and only
    surfaces hold/throttle/stop_billing_period.
  tracked_by: "n/a — declared in _hosts/codex/strategy.yaml usage_pacing.behavior; Cursor billing_period path intentional"

- rule: usage-pacing-post-tool-batch-sampling
  kind: event-unavailable
  affected_hosts: [codex, cursor]
  reason: >
    Claude Code's usage-pacing.js also samples mid-turn via the PostToolBatch event (a Claude-only
    grouped-tool-batch boundary) so pacing pressure can be surfaced before the turn ends, not only at
    Stop. Codex and Cursor have no verified equivalent event (see posttool-batch CONTRACT.md).
  compensating_mechanism: "none — Codex/Cursor pacing is Stop-only."
  tracked_by: "_hosts/codex/strategy.yaml posttool_batch.future_probe; _hosts/cursor/strategy.yaml unsupported_events"

- rule: usage-pacing-account-switch-ambient
  kind: protocol-capability-gap
  affected_hosts: [codex, cursor]
  reason: >
    Claude Code additionally reads `board.runtime.last_account_switch` and emits an
    `<ambient source="usage-pacing">` note when it detects a switch happened (mechanical or manual)
    that has not yet been surfaced this session. This depends on the mechanical-switch machinery
    above, which Codex/Cursor do not have.
  compensating_mechanism: "none — not applicable without mechanical switching."
  tracked_by: "n/a — downstream of usage-pacing-mechanical-switch"

- rule: usage-pacing-billing-period-cursor
  kind: host-convention-divergence
  affected_hosts: [cursor]
  reason: >
    Cursor subscription quota is a ~30d billing cycle, not Claude/Codex 5h/7d rolling windows.
    ccm usage advise already emits Cursor-specific verdicts (throttle/stop_billing_period with
    window_billing_period_pct); the Cursor hook must not fork Codex 5h/7d messaging.
  compensating_mechanism: >
    Cursor usage-pacing-core.js messageFor handles hold/throttle/stop_billing_period only; agent
    copy cites billing_period pct / nearest_reset and never mentions 5h/7d/switch.
  tracked_by: "ccm packages/engine usage/pacing.ts billing_period path; ADR-031 Track A"

- rule: usage-pacing-cursor-stop-envelope
  kind: host-convention-divergence
  affected_hosts: [cursor]
  reason: >
    Cursor `stop` only documents `followup_message`. Pacing advisories must reach the agent (product
    requirement); launcher maps kind:system to `{ followup_message }`.
  compensating_mechanism: >
    usage-pacing-core.js emits kind:system on throttle/stop_billing_period; launcher maps stop
    notifications per ENVELOPE.md. hold verdict stays silent; stop_hook_active guard unchanged.
  tracked_by: "_hosts/cursor/ENVELOPE.md; plugin v0.17.2"

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
