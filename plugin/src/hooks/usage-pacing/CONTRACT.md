# usage-pacing CONTRACT

Host-neutral business-rule SSOT for the `usage-pacing` hook (HOOKPAR-DEC).

## 触发意图

Provide a per-origin cached fallback when durable machine-wide fan-out has not covered a local target.
Claude Code retains its provider-owned `ccm usage advise` path; Codex and Cursor read only
`ccm quota status --machine-wide --json` and filter to their own uncovered target rows. None is a
provider collector or a substitute for the machine-wide producer.

## 业务规则

### Machine-wide fallback rules（implemented with per-host divergence；PR #145 / #148）

- `rule-usage-pacing-origin-local-floor`: each hook surfaces only a fallback for its own origin target.
  Claude Code consumes its existing cached `ccm usage advise`; Codex/Cursor consume cached
  `ccm quota status --machine-wide --json` and then select only a matching harness row. Every path has
  zero live provider/network/credential effects. Machine-wide production belongs to explicit
  `quota refresh --machine-wide` or a user-enabled monitor quota-source mode.
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
- `rule-usage-pacing-agent-safe-target-line`: Codex/Cursor fallback copy contains only the validated
  harness/surface/provider/window, scope digests, state/freshness, source provenance, revision and reason
  codes. It never includes identity/account/credential/path/raw provider response.

Runtime migration is complete for the boundaries the hook actually owns. `origin-local-floor` is a
three-host anchor despite the declared source-path divergence. `machine-wide-dedup` and the agent-safe
target line are Codex/Cursor anchors because only those Stop fallbacks consume the machine-wide status;
Claude Code receives machine-wide summary/delta through orchestrator-context/coordination-inbox and keeps
its legacy usage-advice pacing path. Codex 7d-only is Codex-specific; no-automatic-switch is a Codex/Cursor
anchor. Signal collection/query and capacity non-additivity remain ccm producer contracts, not hook
implementation claims.

- `rule-usage-pacing-verdict-source`: Claude Code uses `ccm usage advise --json` as its provider-owned
  pacing verdict. Codex/Cursor use `ccm quota status --machine-wide --json` as their only fallback source
  and consume already-derived decisions; no adapter re-derives quota math locally.
- `rule-usage-pacing-hold-silent`: Claude verdict `hold` emits nothing. Codex/Cursor emit nothing when
  there is no non-healthy, uncovered, revision-new local decision.
- `rule-usage-pacing-throttle`: Claude verdict `throttle` emits an advisory to slow down. Codex/Cursor
  render the validated cached target decision; Cursor's window remains `billing-cycle/billing_period`,
  never 5h/7d/switch.
- `rule-usage-pacing-switch`: Claude Code may signal an explicitly policy-gated account rotation.
  Codex/Cursor never execute account switch and are defensive silent if this legacy verdict appears.
- `rule-usage-pacing-stop-5h`/`rule-usage-pacing-stop-7d`: Claude Code can surface its provider-owned
  5h/7d gates. Codex/Cursor no longer consume either legacy verdict in this hook; a validated local
  `exhausted` machine decision is rendered as a strong target-scoped advisory instead.
- `rule-usage-pacing-stop-billing-period`: Cursor no longer consumes a `stop_billing_period` verdict
  in this hook. Billing-cycle exhaustion arrives as a cached target decision; no account switch occurs.
- `rule-usage-pacing-strength-mapping`: Claude verdicts use ccm strength or the fixed fallback table
  `{stop_7d: strong, stop_5h: strong, throttle: strong, switch: weak}`. Codex/Cursor uncovered local
  fallback lines are strong advisories; durable inbox separately maps recovery/reset edges to weak.
- `rule-usage-pacing-arming-gate`: dormant until the session is armed against a matching active
  board.
- `rule-usage-pacing-stop-reentry-guard`: on a Stop-reentry (`stop_hook_active:true`) the hook is
  silent — it must not re-fire pacing advisories on the host's own Stop-block re-entry loop.
- `rule-usage-pacing-dual-delivery`: Claude Code's legacy provider pacing path writes decision-grade
  verdicts through `ccm coordination notify` and falls back to direct output on notify failure.
  Codex/Cursor do not re-produce a machine-wide notification: the ccm fan-out is durable authority,
  while this hook directly surfaces only an uncovered local cached decision.

## 注入 taxonomy

- Direct pacing output is **advisory** (never a hard gate — pacing is a lever the orchestrator weighs,
  not a system block), with strength per `rule-usage-pacing-strength-mapping`. Durable machine-wide
  output is delivered through `coordination-inbox`; only Claude's legacy pacing producer still writes
  its own decision-grade notification here.

## 武装语义

`arm:'boards'` (Claude Code) / inline `isArmed` (Codex / Cursor) — narrow-waist only (`owner.active` /
`owner.session_id`). Never writes board content directly (account switching, where implemented,
goes through `ccm account switch`, a process-boundary call, not a board write).

## PARITY anchors

```yaml
- rule: rule-usage-pacing-origin-local-floor
  required_hosts: [claude-code, codex, cursor]
- rule: rule-usage-pacing-machine-wide-dedup
  required_hosts: [codex, cursor]
- rule: rule-usage-pacing-codex-7d-only
  required_hosts: [codex]
- rule: rule-usage-pacing-no-automatic-switch
  required_hosts: [codex, cursor]
- rule: rule-usage-pacing-agent-safe-target-line
  required_hosts: [codex, cursor]
- rule: rule-usage-pacing-tag-protocol
  required_hosts: [claude-code, codex, cursor]
- rule: rule-usage-pacing-dual-delivery
  required_hosts: [claude-code]
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
    Codex and Cursor reject legacy switch-shaped evidence rather than translating it into an account
    candidate or prompt. Their Stop fallback surfaces only `uncoveredChanges`: non-healthy,
    `fanout_covered:false`, revision-new cached decisions whose target harness matches the origin;
    an empty selection is silent and no legacy verdict enum is interpreted.
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
    The Cursor fallback consumes a cached machine decision rather than the legacy usage-advice
    verdict path; it must not fork Codex 5h/7d messaging.
  compensating_mechanism: >
    Cursor usage-pacing-core.js renders the validated target window/source/revision line only;
    billing_period remains in the window and 5h/7d/switch provenance is rejected.
  tracked_by: "ccm packages/engine usage/pacing.ts billing_period path; ADR-031 Track A"

- rule: usage-pacing-cursor-stop-envelope
  kind: host-convention-divergence
  affected_hosts: [cursor]
  reason: >
    Cursor `stop` only documents `followup_message`. Pacing advisories must reach the agent (product
    requirement); launcher maps kind:system to `{ followup_message }`.
  compensating_mechanism: >
    usage-pacing-core.js emits `kind:system` only when `uncoveredChanges` returns one or more validated
    local cached decisions; the launcher maps that Stop output per ENVELOPE.md. An empty selection and
    `stop_hook_active` re-entry are silent.
  tracked_by: "_hosts/cursor/ENVELOPE.md; plugin v0.17.2"

- rule: usage-pacing-kimi-no-channel
  kind: protocol-capability-gap
  affected_hosts: [kimi-code]
  reason: >
    ccm exposes Kimi's current-login rolling 5h/7d quota via `kimi-usages-api`, but kimi has no
    non-blocking Stop advisory channel (Stop only
    surfaces via permissionDecision="deny", which forces continuation — inappropriate for a pacing
    nudge). The hook is not registered on kimi.
  compensating_mechanism: >
    `ccm usage show/advise` and machine-wide quota reads remain available as explicit read-only
    surfaces. A UserPromptSubmit-time advisory (start-of-turn injection works) is the candidate hook
    delivery channel.
  tracked_by: design_docs/harnesses/capabilities/usage-pacing-midflight.md
```
