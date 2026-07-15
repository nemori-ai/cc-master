# Cross-harness notification subscription transport authority map v1

Status: **non-normative authority map**

This document is a navigation and ownership map only. It deliberately contains no executable CLI
shape, response schema, provenance field list, or independent failure semantics. Changes to the
capability go to the canonical owners below first; this file is updated only when ownership or links
move.

## Canonical ownership

| Concern | Canonical owner | Canonical rules |
| --- | --- | --- |
| Cross-surface intent, acceptance, and Claude Code/Codex/Cursor capability status | [`cross-harness-notification-subscription`](harnesses/capabilities/cross-harness-notification-subscription.md) | Card sections `Intent`, `Acceptance`, `Host mechanisms` |
| ARM-time subscription registration, response validation, and registration-failure ARM behavior | [`bootstrap-board/CONTRACT.md`](../plugin/src/hooks/bootstrap-board/CONTRACT.md) | `rule-bootstrap-subscription-register`; `rule-bootstrap-subscription-registration-response`; `rule-bootstrap-subscription-registration-failure` |
| Exact current binding, epoch-bounded delivery, fail-closed selection, seven-field provenance, and read-only effects | [`coordination-inbox/CONTRACT.md`](../plugin/src/hooks/coordination-inbox/CONTRACT.md) | `rule-coordination-inbox-current-subscription`; `rule-coordination-inbox-bounded-list`; `rule-coordination-inbox-subscription-fail-closed`; `rule-coordination-inbox-delivery-provenance`; `rule-coordination-inbox-read-only` |
| Hook-wide event availability | [`hooks.yaml`](../plugin/src/hooks/_manifest/hooks.yaml) | `host_coverage` for `bootstrap-board` and `coordination-inbox` |

## Stage and derivation

The Capability Card currently records all three hosts as `target`. The generated
[`capability-parity-matrix.md`](capability-parity-matrix.md) is a read-only projection of that table.
Hook manifest coverage is intentionally not a capability completion claim: an installed Stop hook
may still lack the target exact-subscription behavior.

The executable schema binding is
[`xh-c3-subscription-phip-ssot-v1/manifest.json`](../tests/hooks/fixtures/xh-c3-subscription-phip-ssot-v1/manifest.json).
It is a non-normative test oracle that points back to the three canonical owners and rejects authority
duplication or drift; it does not define product behavior itself.

## Out of scope

Monitor lifecycle, provider-source policy, account switching, worker dispatch, and notification
production remain separate capabilities/contracts. This map adds no runtime implementation and makes
no `implemented*` claim.
