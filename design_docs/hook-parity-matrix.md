# Hook Parity Matrix

**GENERATED — do not hand-edit.** Source of truth: each hook's
`plugin/src/hooks/<hook>/CONTRACT.md` "降级行为" section. Regenerate with
`bash scripts/gen-hook-parity-matrix.sh` after editing a CONTRACT.md (checked by
`bash scripts/gen-hook-parity-matrix.sh --check`, wired into `run-tests.sh`).

| hook | claude-code | codex | contract |
| --- | --- | --- | --- |
| board-guard | implemented | implemented | [CONTRACT.md](../plugin/src/hooks/board-guard/CONTRACT.md) |
| board-lint | implemented | implemented | [CONTRACT.md](../plugin/src/hooks/board-lint/CONTRACT.md) |
| bootstrap-board | implemented | implemented-minimal-fresh | [CONTRACT.md](../plugin/src/hooks/bootstrap-board/CONTRACT.md) |
| identity-nudge | implemented | implemented-stop-system-message | [CONTRACT.md](../plugin/src/hooks/identity-nudge/CONTRACT.md) |
| reinject | implemented | implemented | [CONTRACT.md](../plugin/src/hooks/reinject/CONTRACT.md) |
| usage-pacing | implemented | implemented-stop-advisory | [CONTRACT.md](../plugin/src/hooks/usage-pacing/CONTRACT.md) |
| verify-board | implemented | implemented-blocking | [CONTRACT.md](../plugin/src/hooks/verify-board/CONTRACT.md) |

## Declared divergences by kind

`kind` values (per AGENTS.md-referenced HOOKPAR taxonomy, design_docs/plans/2026-07-07-hook-parity-system.md §3.5):
`event-unavailable` (no equivalent trigger point) · `protocol-capability-gap` (event exists, host
semantics differ, intentional adaptation) · `host-convention-divergence` (pure implementation drift —
must carry a `tracked_by`, treated as backlog, not an acceptable permanent state).

### board-guard

| rule | kind | affected hosts | tracked by |
| --- | --- | --- | --- |
| board-guard-apply-patch | host-convention-divergence | claude-code | n/a — legitimate host-tool-surface difference, not a bug |
| board-guard-bash-fallback-false-positive | host-convention-divergence | codex | adrs/ADR-028-hook-parity-contract-and-normalization.md (fixed, this PR) |
| board-guard-directive-tag-protocol | host-convention-divergence | codex | adrs/ADR-028-hook-parity-contract-and-normalization.md (fixed, this PR) |

### board-lint

| rule | kind | affected hosts | tracked by |
| --- | --- | --- | --- |
| board-lint-apply-patch-surface | host-convention-divergence | claude-code | n/a |

### bootstrap-board

| rule | kind | affected hosts | tracked by |
| --- | --- | --- | --- |
| bootstrap-slash-command-expansion | protocol-capability-gap | codex | adrs/ADR-028-hook-parity-contract-and-normalization.md |
| bootstrap-ccm-hard-precheck-missing-on-codex | host-convention-divergence | codex | backlog — not in HOOKPAR-DEC's four-item fix scope (FUSE / rollup / board-guard fallback / ADR-018 tags); needs its own follow-up to port ADR-021's fail-loud precheck to Codex bootstrap |

### identity-nudge

| rule | kind | affected hosts | tracked by |
| --- | --- | --- | --- |
| identity-nudge-envelope | protocol-capability-gap | codex | n/a — declared launcher-level envelope conversion, not a business-logic gap |
| identity-nudge-tag-protocol-missing-on-codex | host-convention-divergence | codex | adrs/ADR-028-hook-parity-contract-and-normalization.md (fixed, this PR) |

### reinject

| rule | kind | affected hosts | tracked by |
| --- | --- | --- | --- |
| reinject-subagent-dispatch-discovery-hint | host-convention-divergence | claude-code | n/a — legitimate host-capability difference, not a bug |

### usage-pacing

| rule | kind | affected hosts | tracked by |
| --- | --- | --- | --- |
| usage-pacing-mechanical-switch | protocol-capability-gap | codex | n/a — declared in _hosts/codex/strategy.yaml usage_pacing.behavior; intentional until Codex gains account-pool switching |
| usage-pacing-post-tool-batch-sampling | event-unavailable | codex | _hosts/codex/strategy.yaml posttool_batch.future_probe |
| usage-pacing-account-switch-ambient | protocol-capability-gap | codex | n/a — downstream of usage-pacing-mechanical-switch |
| usage-pacing-tag-protocol-missing-on-codex | host-convention-divergence | codex | adrs/ADR-028-hook-parity-contract-and-normalization.md (fixed, this PR) |

### verify-board

| rule | kind | affected hosts | tracked by |
| --- | --- | --- | --- |
| verify-board-fingerprint-dedup | protocol-capability-gap | codex | n/a — intentional protocol adaptation, not tracked as a bug |
| verify-board-fuse-missing-on-codex | host-convention-divergence | codex | adrs/ADR-028-hook-parity-contract-and-normalization.md (fixed, this PR) |
| verify-board-rollup-missing-on-codex | host-convention-divergence | codex | adrs/ADR-028-hook-parity-contract-and-normalization.md (fixed, this PR) |
| verify-board-tag-protocol-missing-on-codex | host-convention-divergence | codex | adrs/ADR-028-hook-parity-contract-and-normalization.md (fixed, this PR) |