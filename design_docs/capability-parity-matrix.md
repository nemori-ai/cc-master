# Capability Parity Matrix

**GENERATED — do not hand-edit.** Source of truth: each file in
`design_docs/harnesses/capabilities/*.md` "Declared divergence" section. Regenerate with
`bash scripts/gen-capability-parity-matrix.sh` (checked by `--check` in `run-tests.sh`).

See [ADR-031](../adrs/ADR-031-n-host-capability-parity.md) and
[capabilities/README.md](harnesses/capabilities/README.md).

| capability | claude-code | codex | cursor | card |
| --- | --- | --- | --- | --- |
| ccm-quota-account | implemented | partial; read-only provider candidate implemented, usage migration pending | partial | [ccm-quota-account.md](harnesses/capabilities/ccm-quota-account.md) |
| cross-harness-cached-context | implemented | implemented | implemented-track-b | [cross-harness-cached-context.md](harnesses/capabilities/cross-harness-cached-context.md) |
| goal-contract-lifecycle | planned | planned | planned-track-b | [goal-contract-lifecycle.md](harnesses/capabilities/goal-contract-lifecycle.md) |
| path-token-resolution | implemented | implemented | implemented | [path-token-resolution.md](harnesses/capabilities/path-token-resolution.md) |
| post-tool-batch-gate | implemented | unsupported | unsupported | [post-tool-batch-gate.md](harnesses/capabilities/post-tool-batch-gate.md) |
| role-substrate-reinject | implemented | implemented | implemented | [role-substrate-reinject.md](harnesses/capabilities/role-substrate-reinject.md) |
| stop-continuation-gate | implemented | implemented-blocking | implemented | [stop-continuation-gate.md](harnesses/capabilities/stop-continuation-gate.md) |
| usage-pacing-midflight | implemented | implemented-stop-advisory; runtime migration pending | implemented-stop-advisory | [usage-pacing-midflight.md](harnesses/capabilities/usage-pacing-midflight.md) |
| workflow-authoring | implemented | unsupported_stub | unsupported_stub | [workflow-authoring.md](harnesses/capabilities/workflow-authoring.md) |

## Declared divergences by kind

`kind`: `event-unavailable` · `protocol-capability-gap` · `host-convention-divergence`
(see ADR-028 / ADR-031).

### ccm-quota-account

| rule | kind | affected hosts | tracked by |
| --- | --- | --- | --- |
| ccm-external-statusline | protocol-capability-gap | codex, cursor | ccm-host-coupling-audit.md §Status Line |
| ccm-account-pool | protocol-capability-gap | codex, cursor | ccm/apps/cli/src/harnesses/codex.ts, ccm/apps/cli/src/harnesses/cursor.ts |

### cross-harness-cached-context

| rule | kind | affected hosts | tracked by |
| --- | --- | --- | --- |
| cross-harness-context-midturn-delta | event-unavailable | codex | plugin/src/hooks/orchestrator-context/CONTRACT.md |
| cross-harness-context-cursor-start | protocol-capability-gap | cursor | design_docs/harnesses/cursor.md D3/D4/D5 |

### goal-contract-lifecycle

| rule | kind | affected hosts | tracked by |
| --- | --- | --- | --- |
| goal-contract-dynamic-reinject-on-compaction | protocol-capability-gap | cursor | design_docs/harnesses/cursor.md |

### path-token-resolution

| rule | kind | affected hosts | tracked by |
| --- | --- | --- | --- |
| plugin-root-token-name | protocol-capability-gap | codex, cursor | design_docs/harnesses/codex.md, cursor.md D1 |
| skill-path-substitution | protocol-capability-gap | codex, cursor | compatibility-matrix.md Skill path token row |

### post-tool-batch-gate

| rule | kind | affected hosts | tracked by |
| --- | --- | --- | --- |
| post-tool-batch-boundary | event-unavailable | codex, cursor | plugin/src/hooks/_manifest/hooks.yaml posttool-batch.host_coverage |
| usage-pacing-midflight-sample | event-unavailable | codex, cursor | plugin/src/hooks/usage-pacing/CONTRACT.md |

### role-substrate-reinject

| rule | kind | affected hosts | tracked by |
| --- | --- | --- | --- |
| reinject-full-substrate-on-compact | protocol-capability-gap | cursor | design_docs/harnesses/capabilities/role-substrate-reinject.md + cursor.md D3,D4 (closed 2026-07-09) |
| reinject-subagent-dispatch-discovery-hint | host-convention-divergence | claude-code | plugin/src/hooks/reinject/CONTRACT.md |

### stop-continuation-gate

| rule | kind | affected hosts | tracked by |
| --- | --- | --- | --- |
| stop-hard-block-envelope | protocol-capability-gap | cursor | design_docs/harnesses/capabilities/stop-continuation-gate.md + cursor.md D6 |
| verify-board-fingerprint-dedup | protocol-capability-gap | codex, cursor | plugin/src/hooks/verify-board/CONTRACT.md |

### usage-pacing-midflight

| rule | kind | affected hosts | tracked by |
| --- | --- | --- | --- |
| usage-pacing-post-tool-batch-sampling | event-unavailable | codex, cursor | plugin/src/hooks/usage-pacing/CONTRACT.md |
| usage-pacing-mechanical-switch | protocol-capability-gap | codex, cursor | design_docs/harnesses/ccm-host-coupling-audit.md |
| usage-pacing-quota-signal-source | protocol-capability-gap | cursor | ccm/apps/cli/src/cursor-usage.ts + design_docs/harnesses/capabilities/ccm-quota-account.md |

### workflow-authoring

| rule | kind | affected hosts | tracked by |
| --- | --- | --- | --- |
| dynamic-workflow-tool | event-unavailable | codex, cursor | plugin/src/skills/authoring-workflows/adapters/codex/strategy.yaml + plugin/src/skills/authoring-workflows/adapters/cursor/strategy.yaml |