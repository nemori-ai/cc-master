# orchestrator-context CONTRACT

Host-neutral business-rule SSOT for cached cross-harness origin delivery.

## 触发意图

Surface one ccm-owned cached machine/route context to an armed master without allowing a host hook
to refresh facts, choose a route, or authorize dispatch.

## 业务规则

### Machine-wide quota target rule（contract frozen；production RED）

- `rule-orchestrator-context-machine-quota-summary`: an optional cached machine quota summary is
  ccm-owned and contains only ordered agent-safe
  `target/state/freshness/reason_codes/decision_revision/observation_revision` rows from
  `ccm/machine-quota-decision/v1`. The hook validates the same canonical hash/redaction/4096-byte
  boundary, performs zero live refresh/provider/network/credential effects, and never infers quota
  between Cursor IDE and Cursor Agent CLI. Missing/uninstalled/unauthenticated/unsupported is absent
  or unknown, never healthy.

This target rule is executable RED and intentionally is not a PARITY anchor until the shared payload
and all three adapters land. Mid-turn decision edges belong to the durable coordination inbox rather
than repeated full summaries.

- `rule-orchestrator-context-ccm-owned`: every host consumes
  `ccm/origin-context-delivery/v1`; adapters do not recompute candidate eligibility, order, reason,
  freshness, or selection. Frozen candidate facts and CLI judgments remain identical; an
  origin-local `host-native` candidate may differ only through the ccm-owned
  `host-native-origin-mismatch` rule and the corresponding native selection equivalence class.
- `rule-orchestrator-context-cached-only`: invoke only `ccm orchestrator context --cached-only
  --agent-visible`; never invoke collector, provider, reservation, attempt, account, or board-write
  commands.
- `rule-orchestrator-context-bounded-redacted`: emit only ccm's ambient `content` after checking its
  exact allowlisted outer/inner schema, nested value domains, hash, and byte count; unknown nested
  fields, duplicate-key/non-canonical JSON, or private-shaped values fail open with empty stdout.
  Validation rebuilds the canonical payload and never emits raw bytes that differ from the validated
  representation. A selected route must agree with the referenced candidate and with the delivery's
  available/fresh/enabled, auth/model/runtime/quota/qualification facts; adapters only reject a
  contradiction and never rerank policy. Complete agent-visible content is <=4096 bytes and contains
  no ref/path, credential, identity, balance, argv/env, transcript, or provider raw response.
- `rule-orchestrator-context-dedup`: hook-owned sidecar suppresses an unchanged delivery hash on
  delta events. The sidecar is disposable and never authoritative.
- `rule-orchestrator-context-fail-open`: no/ambiguous active board, cache/ccm failure, malformed
  output, or local timeout returns RC0 with empty stdout or ccm's bounded unknown delivery; no live
  fallback exists.
- `rule-orchestrator-context-shadow-only`: delivered authority always says shadow-only and
  `dispatch_enabled:false`; this disables only automatic/shadow route activation, not an explicit
  caller-selected `ccm worker` raw wrapper. Host injection still cannot authorize a worker.
- `rule-orchestrator-context-cursor-surfaces`: when ccm publishes the optional
  `ccm/cursor-surface-context/v1` cache block, every host accepts only the canonical ordered
  `cursor-ide-plugin` / `cursor-agent-cli` pair, verifies the four-state derivation, preserves
  surface-local installed/authentication/role-eligibility provenance, and emits the same block unchanged. Missing
  inventory remains absent; adapters never probe or infer it. The two descriptors remain
  `host-native` versus `cli-headless`, so this context cannot collapse later native and CLI
  attempts or authorize run-control.

## 注入 taxonomy

`ambient source="orchestrator-context"` — cached machine/route background facts. It is not a task,
permission, or dispatch directive.

## 武装语义

The core accepts exactly one active, regular, non-symlink board whose resolved path remains under the
resolved home `boards/` directory and matches the current session. Zero or multiple matches are
silent. Claude Code discovers through the same narrow-waist predicate; Codex/Cursor consume the
launcher-provided, containment-checked board and revalidate it.

## PARITY anchors

```yaml
- rule: rule-orchestrator-context-ccm-owned
  required_hosts: [claude-code, codex, cursor]
- rule: rule-orchestrator-context-cached-only
  required_hosts: [claude-code, codex, cursor]
- rule: rule-orchestrator-context-bounded-redacted
  required_hosts: [claude-code, codex, cursor]
- rule: rule-orchestrator-context-dedup
  required_hosts: [claude-code, codex, cursor]
- rule: rule-orchestrator-context-fail-open
  required_hosts: [claude-code, codex, cursor]
- rule: rule-orchestrator-context-shadow-only
  required_hosts: [claude-code, codex, cursor]
- rule: rule-orchestrator-context-cursor-surfaces
  required_hosts: [claude-code, codex, cursor]
```

## 降级行为

```yaml
- rule: orchestrator-context-codex-midturn
  kind: event-unavailable
  affected_hosts: [codex]
  reason: Codex has no verified PostToolBatch-equivalent event and per-tool PostToolUse is not a batch boundary.
  compensating_mechanism: Deliver at SessionStart; later decision-grade changes use the durable inbox or next SessionStart.
  tracked_by: design_docs/harnesses/capabilities/cross-harness-cached-context.md

- rule: orchestrator-context-cursor-start
  kind: protocol-capability-gap
  affected_hosts: [cursor]
  reason: Cursor sessionStart.additional_context is a confirmed drop bug and sessionStart does not re-fire after compact.
  compensating_mechanism: Keep static alwaysApply role substrate and deliver dynamic cached context on verified postToolUse.additional_context with hash dedupe.
  tracked_by: design_docs/harnesses/capabilities/cross-harness-cached-context.md
```
