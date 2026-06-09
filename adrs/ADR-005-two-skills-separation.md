# ADR-005 — Two-skill separation: orchestrating vs authoring-workflows

> Status: **Accepted**
> Date: 2026-06-08
> Scope: The skill layer — `skills/orchestrating-to-completion/` and
> `skills/authoring-workflows/`. Constrains where any new piece of guidance lives
> and forbids duplication between the two.
> Source: cc-master design invariant #3 (CONTRIBUTING.md); `design_docs/spec.md`
> §14 (two-skill non-overlap acceptance criterion).

---

## 1. Context

cc-master ships guidance at two distinct altitudes that are easy to conflate:

- **What the orchestrator does on the main thread** — decompose a goal into a DAG,
  dispatch tasks when their dependencies are ready, keep the waiting window
  productive, verify at the endpoint, survive compaction via the board.
- **How to write a dynamic-workflow script** — the inside-the-script authoring
  concern: workflow shapes, the step/phase API, `loop-until-*` patterns, the
  mechanism contract the harness validates.

These are genuinely different jobs. The orchestrator's `loop` (dispatch-on-ready)
and a workflow script's `loop-until-*` (an inside-the-script control-flow pattern)
even share a word but mean unrelated things — precisely the kind of overlap that
invites guidance to bleed across the boundary. If a single skill tried to carry
both, the description would over-trigger (firing for the wrong job), the prose would
duplicate, and a reader could not tell which altitude any given paragraph addresses.

## 2. Decision

**Keep two self-contained, non-overlapping skills, with a strict ownership rule for
where guidance lives.**

- **Skill A — `orchestrating-to-completion`** = main-thread orchestration: the
  method the orchestrator runs (decompose, dispatch-on-ready, productive idle
  windows, endpoint verification, compaction survival via the board).
- **Skill B — `authoring-workflows`** = inside-the-script authoring: how to write
  dynamic-workflow scripts (shapes, step/phase API, mechanism contract).
- **Ownership rule**: if a piece of advice is about *what the orchestrator does*, it
  goes in A; if it is about *how a workflow script is written*, it goes in B.
  Responsibilities do not bleed across the two, and guidance is not duplicated
  between them.
- The two skills' `description` fields are each scoped to *only* their own trigger
  conditions, so each fires for its own job and not the other's (validated by the
  per-skill trigger eval set).

## 3. Consequences

### 3.1 Positive

- **Clean triggering**: each skill's description targets its own job, so an
  orchestration request loads A and a "how do I write this workflow" request loads
  B — no cross-firing.
- **No duplicate maintenance**: a single piece of guidance has exactly one home, so
  there is no drift between two copies of the same advice.
- **Readable altitude**: any paragraph is unambiguously about either the
  orchestrator's behavior or a workflow script's internals.

### 3.2 Negative

- **Cross-references cost discipline**: where the two genuinely touch (an
  orchestrator dispatching a workflow), the boundary must be crossed by a pointer,
  not by copying — which requires authors to resist the convenient duplication.
- **Shared vocabulary needs care**: words like `loop` and `phase` mean different
  things in A vs B and must be disambiguated rather than unified.

### 3.3 Neutral

- New guidance forces an up-front altitude decision (A or B), which is mild friction
  that keeps the separation honest.

## 4. Alternatives Considered

### 4.1 Alternative A: merge into one "cc-master" skill

Rejected. A single skill would have to describe both altitudes, so its description
could not be scoped to one job — it would over-trigger, loading orchestration prose
when the user only wants to author a workflow (and vice versa). It would also invite
the two concerns' prose to interleave, making it hard to tell which altitude any
section addresses. The spec's acceptance criterion (§14) explicitly requires the two
skills to be complete, self-contained, and non-overlapping.

### 4.2 Alternative B: keep two skills but allow shared/duplicated sections

Rejected. Duplicating shared guidance across both skills guarantees drift — one copy
gets updated, the other rots — which is the exact failure the single-home ownership
rule prevents. Where the skills touch, the link is a pointer, not a copy.

## 5. Related

- [`../CONTRIBUTING.md`](../CONTRIBUTING.md) — design invariant #3.
- [`../skills/orchestrating-to-completion/SKILL.md`](../skills/orchestrating-to-completion/SKILL.md)
  — Skill A.
- [`../skills/authoring-workflows/SKILL.md`](../skills/authoring-workflows/SKILL.md)
  — Skill B.
- [`../design_docs/spec.md`](../design_docs/spec.md) — §14 acceptance criterion
  (two skills non-overlapping).

## 6. References

- (none — this decision is internal to cc-master's skill layout.)
