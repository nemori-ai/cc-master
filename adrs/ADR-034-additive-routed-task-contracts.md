# ADR-034 — Additive routed-task contracts with dedicated writers

> Status: **Accepted**
> Date: 2026-07-10
> Scope: `@ccm/engine` board contract activation and invariants; ccm task/board mutation commands; future host-native and cross-CLI attempt producers
> Source: user-approved cross-harness A–F direction and C1/S0 implementation plan
> Co-signed: user (owner)

---

## 1. Context

Cross-harness orchestration needs planning, candidate, selection, and attempt evidence. Putting provider/model into `executor` would conflate who executes with how a route is realized and would break existing closed-enum consumers. Leaving the evidence as freely replaceable JSON would let an agent fabricate a running route through `--set-json` or `--force`, bypassing the atomic handle-claim boundary. Making the fields mandatory on every existing board would turn an additive feature into a destructive schema migration.

## 2. Decision

We keep `cc-master/v2`, the narrow waist, and the existing `executor` enum. We add hook-blind `task.planning` and `task.routing` flexible fields, activated conditionally by exact entries in `board.meta.contracts`.

Field tier and writer policy are separate axes. Planning and routing are flexible for schema evolution, but whole-object/selection writes are dedicated and attempt history is append-only. Generic setters reject those roots and any ancestor replacement that could erase a dedicated subtree. A dedicated bind mutation is the only path that can atomically record selection, freeze its qualification/rationale snapshot into an attempt, append that running attempt with a non-empty opaque handle claim, project `task.handle`, and enter `in_flight`; `--force` cannot bypass it. Qualification evidence is an exact set: every required predicate appears once, only once, and passes; unknown, duplicate, or contradictory rows fail closed. A C1 handle claim is not real/live/durable proof—trusted native lease/supervisor attestation is a later gate.

Boards without activation remain legacy. Activation is explicit and preflighted; it never guesses or rewrites user data. Historical terminal tasks are grandfathered under an activation epoch rather than forced to invent past route evidence. Provider/model identity stays in route candidates, never in `executor`, and the engine contains no brand preference. Once an active/staged routed task is `subagent`, its executor is frozen; any contract-board task entering `subagent` must already satisfy planning/routing/estimate preparation, and executor cannot change while a contract-related task is `in_flight`. Candidate eligibility is a set contract across planning requirements, effect floor, permission denies, account-mutation prohibition, and passing evidence—not a collection of unrelated present fields.

The executable contract is [`../design_docs/2026-07-10-cross-harness-contract-spine.md`](../design_docs/2026-07-10-cross-harness-contract-spine.md).

## 3. Consequences

### 3.1 Positive

- Old boards and hooks keep the same narrow-waist protocol.
- Host-native, same-harness CLI, and other-harness CLI attempts share one audit shape.
- A running route claim cannot be assembled piecemeal or through a generic escape hatch; real-handle attestation remains explicit deferred work.
- Later provider/supervisor slices can bind real handles without owning board state rules.

### 3.2 Negative

- ccm gains dedicated verbs and conditional validation paths.
- Migration requires explicit backfill before activation rather than automatic guessing.
- `--force` is intentionally no longer universal for this safety boundary.

### 3.3 Neutral

- This ADR does not authorize dispatch, account mutation, credential access, quota reservation, or provider process creation.
- Attempt terminal/finish/reconcile semantics remain for later slices.

## 4. Alternatives considered

### 4.1 Add provider/model executors

Rejected: it conflates scheduling mechanism with target route, expands a stable closed enum, and cannot represent host-native versus same-harness CLI correctly.

### 4.2 Make routing load-bearing or bump board v3

Rejected: hooks do not need these fields. Expanding the narrow waist or schema version would impose migration risk without a hook consumer.

### 4.3 Store all route state outside the board immediately

Rejected for C1: it creates a second truth source before a durable supervisor/run ledger exists. Later run journals may hold large evidence while the board retains a small projection.

### 4.4 Keep flexible generic setters

Rejected: lint plus `--force` cannot prove append-only history or atomic handle binding. Construction authority must live in dedicated mutations.

## 5. Supersession conditions

Revisit only if production evidence shows that board attempt summaries cannot remain bounded, or host-native and CLI attempts have irreducibly different lifecycle invariants. Even then, the narrow waist and terminal-not-done rule remain unless separately superseded.

## 6. Related

- [ADR-003](ADR-003-board-narrow-waist.md)
- [ADR-013](ADR-013-board-v2-data-model-and-cli.md)
- [ADR-014](ADR-014-cli-decoupling-as-independent-product.md)
- [ADR-025](ADR-025-board-write-guard-single-path.md)
- [Cross-harness capability model](../design_docs/cross-harness-orchestration-capability-model.md)
