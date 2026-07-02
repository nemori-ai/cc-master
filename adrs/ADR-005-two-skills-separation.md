# ADR-005 — Distributed-skill separation: orchestrating vs authoring-workflows vs account-management

> Status: **Accepted**
> Date: 2026-06-08 (extended 2026-06-17: two → three distributed skills)
> Scope: The skill layer — `skills/master-orchestrator-guide/`,
> `skills/authoring-workflows/`, and `skills/account-management/`. Constrains where
> any new piece of guidance lives and forbids duplication between the skills.
> Source: cc-master design invariant #3 (AGENTS.md §3 红线3); `design_docs/spec.md`
> §14 (distributed-skill non-overlap acceptance criterion). 2026-06-17 extension:
> account-management admitted as the third distributed skill (user-authorized DR
> intake + curating-skill-portfolios boundary gate).

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

The same conflation risk recurred when account-switching landed (2026-06-17): the
switch *decision* (a pacing judgment the orchestrator makes) and the switch
*mechanism* (account-pool selection + token vault security) are again two different
jobs sharing the word "switch." Rather than fold the mechanism into A, it became a
third self-contained skill (`account-management`) under the identical ownership
rule — decision in A, mechanism in C, crossed by a pointer not a copy. The
separation principle below is unchanged; it now governs three skills, not two.

## 2. Decision

**Keep self-contained, non-overlapping distributed skills, with a strict ownership
rule for where guidance lives.** As of 2026-06-17 there are **three** distributed
skills (was two; account-management added) — the separation principle is unchanged,
only the count grows.

- **Skill A — `master-orchestrator-guide`** = main-thread orchestration: the
  method the orchestrator runs (decompose, dispatch-on-ready, productive idle
  windows, endpoint verification, compaction survival via the board). Owns the
  account-switch *decision* (when to switch, whether it's worth it, who signs off).
- **Skill B — `authoring-workflows`** = inside-the-script authoring: how to write
  dynamic-workflow scripts (shapes, step/phase API, mechanism contract).
- **Skill C — `account-management`** = the account-pool *mechanism* layer: how the
  `accounts.json` registry is built, how the best switch-in account is selected,
  how tokens move, and how tokens are kept secure (keychain / file vault only).
  Owns the *mechanism* of switching, never the *decision* — A references C at the
  pacing decision point without restating its mechanism.
- **Ownership rule**: if a piece of advice is about *what the orchestrator does*
  (incl. the switch decision), it goes in A; if it is about *how a workflow script
  is written*, it goes in B; if it is about *the account-pool mechanism* (select /
  switch / vault security), it goes in C. Responsibilities do not bleed across the
  three, and guidance is not duplicated between them.
- Each skill's `description` is scoped to *only* its own trigger conditions, so each
  fires for its own job and not the others' (validated by the per-skill trigger eval
  set).

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

- **Cross-references cost discipline**: where the skills genuinely touch (an
  orchestrator dispatching a workflow, or A deciding to switch accounts and C
  carrying out the switch), the boundary must be crossed by a pointer, not by
  copying — which requires authors to resist the convenient duplication.
- **Shared vocabulary needs care**: words like `loop` and `phase` mean different
  things in A vs B and must be disambiguated rather than unified. The
  account-switch *decision / mechanism* split (A owns the decision, C owns the
  mechanism) is the same discipline applied to the third skill.

### 3.3 Neutral

- New guidance forces an up-front altitude decision (A or B), which is mild friction
  that keeps the separation honest.

## 4. Alternatives Considered

### 4.1 Alternative A: merge into one "cc-master" skill

Rejected. A single skill would have to describe both altitudes, so its description
could not be scoped to one job — it would over-trigger, loading orchestration prose
when the user only wants to author a workflow (and vice versa). It would also invite
the concerns' prose to interleave, making it hard to tell which altitude any
section addresses. The spec's acceptance criterion (§14) explicitly requires the
distributed skills to be complete, self-contained, and non-overlapping.

### 4.2 Alternative B: keep two skills but allow shared/duplicated sections

Rejected. Duplicating shared guidance across both skills guarantees drift — one copy
gets updated, the other rots — which is the exact failure the single-home ownership
rule prevents. Where the skills touch, the link is a pointer, not a copy.

## 5. Related

- [`../AGENTS.md`](../AGENTS.md) — §3 红线3 (the distributed-skill non-overlap red
  line, SSOT).
- [`../skills/master-orchestrator-guide/SKILL.md`](../skills/master-orchestrator-guide/SKILL.md)
  — Skill A.
- [`../skills/authoring-workflows/SKILL.md`](../skills/authoring-workflows/SKILL.md)
  — Skill B.
- [`../skills/account-management/SKILL.md`](../skills/account-management/SKILL.md)
  — Skill C (added 2026-06-17; boundary three-liner at its top is the wording source
  for 红线3's third-skill clause).
- [`../design_docs/spec.md`](../design_docs/spec.md) — §14 acceptance criterion
  (distributed skills non-overlapping).

## 6. References

- (none — this decision is internal to cc-master's skill layout.)
