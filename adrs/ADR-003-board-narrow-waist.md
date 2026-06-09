# ADR-003 — The board narrow waist

> Status: **Accepted**
> Date: 2026-06-08
> Scope: The board JSON contract — which fields are hook-dependent (pinned) vs.
> agent-shaped (flexible). Constrains every hook, `assets/board.template.json`, and
> `skills/orchestrating-to-completion/references/board.md`.
> Source: cc-master design invariant #2 (CONTRIBUTING.md); reinforced by Finding #9
> (pinned-vs-flexible self-contradiction) in `design_docs/dogfood-findings.md`.

---

## 1. Context

The board file is cc-master's single source of truth and the **only** state a hook
can read (hooks are blind to agent context — ADR-001). The agent writes the whole
board each turn; the hooks read it to decide bootstrap / re-injection / stop-gating.

This creates a tension. If the hooks depend on *many* board fields, then:

- shell-only parsing (ADR-001) gets brittle — more fields, more fragile `sed`/`grep`
  anchors; and
- the agent loses freedom to shape the board to the task — every field is a
  contract it must not break.

But if the hooks depend on *nothing* structured, they cannot do their job (gate on
task status, filter by session, detect an empty DAG).

Finding #9 made the cost of getting this wrong concrete: `wip_limit` was described
as pinned in one place and flexible in another, and the SKILL.md list omitted it
entirely — three contradictory statements about a field no hook actually reads. The
narrow-waist principle is only valuable if the pinned/flexible boundary is stated
precisely and held.

## 2. Decision

**Adopt a narrow waist: pin a small, fixed set of fields that the hooks depend on;
everything else is a flexible edge the agent shapes freely.**

- **Pinned waist** (hook-dependent — changing names/shapes/semantics breaks hooks
  silently):
  ```
  top-level: schema, goal, owner { active, session_id, heartbeat }, git { worktree, branch }
  tasks[ { id, status, deps } ]
  ```
  plus the `status` enum (`ready / in_flight / blocked / done / escalated / failed
  / stale / uncertain`), whose values route the DAG and gate the Stop hook.
- **Flexible edges** (agent-shaped, hook-ignored): `title / artifact /
  dispatched_at / mechanism / handle / kind / justification / output_schema /
  dep_pins / notes / log`, plus `verified`, `blocked_on`, and `wip_limit`. The
  hook ignores everything outside the pinned waist.
- **Touching the waist is a same-PR contract change**: any change to a pinned
  field's name, shape, or semantics must update every hook and its tests in the
  same PR and call it out explicitly in the PR description.

## 3. Consequences

### 3.1 Positive

- **Hooks stay simple and parseable in pure bash** (ADR-001): few fields, stable
  anchors.
- **Agent keeps maximal freedom**: it can add any flexible field a task needs
  (artifacts, logs, justification) without risk of breaking a hook.
- **The pinned/flexible line is auditable**: there is one place to check whether a
  field is load-bearing, which is exactly what Finding #9 showed was missing.

### 3.2 Negative

- **The waist is a coordination point**: any genuine need to extend the
  hook-readable contract is a cross-cutting change (hooks + tests + template +
  board.md docs all at once). This is friction by design.
- **The boundary must be restated consistently everywhere** (template, board.md,
  SKILL.md) — drift there is itself a bug (Finding #9).

### 3.3 Neutral

- Supersession of a task node is an explicit pinned-status change (`escalated` /
  `stale`), not implicit garbage collection — the history stays auditable on the
  board.

## 4. Alternatives Considered

### 4.1 Alternative A: pin the whole board schema

Rejected. Pinning every field would make the board a rigid schema the agent cannot
shape to the task, and it would force every hook to parse far more JSON in pure bash
(ADR-001) — exactly the brittleness the narrow waist avoids. It also makes routine
board evolution a contract change.

### 4.2 Alternative B: pin nothing — let the agent shape everything freely

Rejected. The hooks need *some* structured contract to function: the Stop hook must
read `tasks[].status` to know whether work remains, and it must read
`owner.session_id` to avoid cross-session false blocks (Finding #4). A fully free
board gives the hooks nothing deterministic to gate on, which defeats the
skeleton's purpose.

## 5. Related

- [`ADR-001-hooks-pure-bash.md`](ADR-001-hooks-pure-bash.md) — the small waist is
  what keeps shell-only parsing tractable.
- [`../CONTRIBUTING.md`](../CONTRIBUTING.md) — design invariant #2.
- [`../skills/orchestrating-to-completion/references/board.md`](../skills/orchestrating-to-completion/references/board.md)
  — the evergreen description of the pinned waist + flexible edges.
- [`../design_docs/dogfood-findings.md`](../design_docs/dogfood-findings.md) —
  Finding #9 (`wip_limit` pinned-vs-flexible contradiction); Finding #4 (session
  filtering relies on `owner.session_id` being pinned).

## 6. References

- `assets/board.template.json` / `board.example.json` — the pinned fields map 1:1.
