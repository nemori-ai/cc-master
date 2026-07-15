# ADR-036 — Declared delivery and dependency truth

> Status: **Accepted**
> Date: 2026-07-14
> Scope: `@ccm/engine` flexible board contract, dependency evaluator, ready/reconcile/lint/read models, task retry evidence, `ccm` delivery/dependency CLI, and `using-ccm` projections
> Source: delivery-truth audit at frozen main `01dc8967e0be691d4ae1b38ce31bdf4a48bf63a3`; user-approved D1–D4 `decision_package`
> Co-signed: user (owner)

---

## 1. Context

`taskTrulyDone` correctly proves endpoint acceptance of a task's current candidate. The existing dependency predicate intentionally accepts legacy `status=done` tasks, with an additional fail-closed review verdict only when a review gate is declared. A frozen-main audit found two accepted implementation stacks that remained outside the target main baseline while downstream dependency chains could treat them as consumable. Three neighboring tasks had genuinely entered main through exact, contract-only, or reviewed/hardened integration paths.

The missing fact is not another completion state. It is a relationship among a producer's current candidate, a declared delivery target snapshot, and one downstream edge's consumption requirement.

## 2. Decision

We choose edge-aware delivery attestation (decision D1=C):

- board `delivery_contract` owns target declarations;
- upstream task `delivery` owns current candidate identity and append-only observations;
- downstream task `dependency_requirements` owns exact-edge or `*` consumption requirements;
- `dependencyQualified` derives `qualified | unqualified | unknown`; no persisted qualification boolean exists.

All three fields are flexible and hook-blind. `deps` remains `string[]`; the status enum and narrow-waist fields do not change.

Rollout follows decision D2: boards without a contract retain exact legacy behavior; declared mode is additive and only explicit edges gain candidate/delivery gates; strict exists as read-only dry-run/readiness analysis and cannot be persisted or enabled by this slice. Strict-default requires later explicit user approval.

Squash/rebase reconciliation follows decision D3: an integration commit must be locally contained in the target snapshot and a fresh immutable review attestation must bind the current candidate, reviewed base/target, and integration commit. Patch-id alone is insufficient.

Waivers follow decision D4: only user-authorized, exact edge/target scoped, expiring waivers qualify. They always report `qualified_by=waiver` and `target_delivered=false`.

Proof checkers are local and daemonless. They must never fetch, call a provider/harness, mutate credentials/accounts, or treat branch/worktree presence as delivery evidence.

The executable contract is [`../design_docs/2026-07-14-delivery-dependency-truth-contract.md`](../design_docs/2026-07-14-delivery-dependency-truth-contract.md).

## 3. Consequences

### 3.1 Positive

- Candidate acceptance, target delivery, and downstream qualification have separate owners and one vocabulary.
- Legacy boards and undeclared edges preserve their existing behavior.
- Git containment, reviewed reconciliation, non-git digests, target drift, and waivers share one evaluator without changing the DAG shape.
- Retry can atomically prevent old delivery evidence from leaking into a new attempt.

### 3.2 Negative

- Engine, CLI, graph, reconciliation, lint, read models, tests, and `using-ccm` must remain in lockstep.
- Declared users must record target and edge intent explicitly; strict readiness reports may expose substantial missing declarations.
- Local object or attestation loss produces `unknown` and fail-closed explicit edges until evidence is restored or waived.

### 3.3 Neutral

- `done` continues to mean true candidate completion under ADR-026, not merge/release.
- Review verdict remains the existing orthogonal approval gate.
- A binary rollback to a legacy evaluator may reopen declared edges; rollback therefore requires an explicit operator risk decision, not silent compatibility claims.

## 4. Alternatives considered

### 4.1 Explicit delivery task nodes

Rejected as the machine contract. It requires no schema but relies on humans remembering to create and connect delivery nodes, cannot revalidate target drift/digests, and recreates the observed omission failure. It remains a valid manual workflow pattern.

### 4.2 Upstream-global delivery gate

Rejected because consumption requirements belong to downstream edges. A producer-level target over-blocks heterogeneous consumers and becomes a composite review/delivery gate as soon as multiple targets appear.

### 4.3 Put requirement objects inside `deps[]`

Rejected because it would change a narrow-waist field shape and force hooks, board schema/version, fixtures, graph consumers, and migrations to change. Flexible edge metadata provides the needed semantics additively.

### 4.4 Enable strict for new boards now

Rejected for this slice. Design and investigation graphs would immediately fail on undeclared edges before declared-mode dogfood establishes the false-positive/unknown profile. Strict-default is a separately authorized decision.

## 5. Supersession conditions

Revisit the edge-aware shape only if production evidence shows that requirement metadata cannot remain bounded, or that another durable ledger becomes the authoritative owner of delivery observations. Revisit strict-default only after declared dogfood has zero unexplained unknown proofs and a user explicitly authorizes activation. Any future hook dependency on delivery fields is a separate narrow-waist decision.

## 6. Related

- [ADR-003](ADR-003-board-narrow-waist.md)
- [ADR-023](ADR-023-deps-driven-gating-and-blocked-on-discriminator.md)
- [ADR-026](ADR-026-done-true-semantics.md)
- [ADR-034](ADR-034-additive-routed-task-contracts.md)
- [Finding #94](../design_docs/dogfood-findings.md)
