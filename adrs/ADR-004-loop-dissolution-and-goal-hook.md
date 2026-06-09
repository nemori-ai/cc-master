# ADR-004 — `/loop`·`/goal` dissolution + goal-hook

> Status: **Accepted** (supersedes the native-`/goal` integration stance recorded
> in `design_docs/2026-06-08-native-goal-loop-integration.md` and spec.md §12)
> Date: 2026-06-08
> Scope: How cc-master achieves "don't half-finish / self-drive across phases" —
> the Stop hook (`verify-board.sh`), the bootstrap command, the
> `orchestrating-to-completion` skill + references, and `reinject.sh`. Removes all
> agent-facing `/goal`·`/loop`·`ScheduleWakeup`·cron·`phase` guidance.
> Source: dogfood Finding #2 (native `/goal` is unexecutable by an agent), Finding
> #4 (cross-session false block), Finding #14 (goal-hook caught a real early yield);
> background-mechanism research.

---

## 1. Context

An earlier integration stance (`design_docs/2026-06-08-native-goal-loop-integration.md`)
layered native `/goal` on top of cc-master: the bootstrap, the skill, and a
re-injection note all instructed the agent to "proactively set a phase `/goal`" at
the start of each self-driving segment, treating it as an independent-model hard
constraint that would brake the Stop.

Dogfood **Finding #2** broke this stance on contact:

- A slash command is only parsed by the harness when **a human types it in the
  input box**. When the assistant writes `/goal "..."` into its reply, that is inert
  text — it is never executed. Two rounds of `ToolSearch` confirmed there is **no
  set-goal / stop-condition tool** in the toolbox.
- So the entire "phased self-driving via `/goal`" mechanism is a **no-op for the
  agent**: it either prints `/goal` and believes it set one (a dangerous false sense
  of safety that a backstop exists), or it is confused that it has no such ability.
- The only timer primitives an agent *can* invoke — `ScheduleWakeup` (under `/loop`
  dynamic) and `CronCreate` (under `/loop` fixed, 7-day expiry, session-only) — have
  the opposite semantics (alarm-style re-entry, not stop-braking) **and** break
  ship-anywhere: `ScheduleWakeup` is unsupported on Bedrock / Vertex / Foundry.

Meanwhile the genuine need behind `/loop` — waiting on external state the harness
cannot track (CI, a remote queue, an approval timeout) — is already served by the
background-shell primitive, which is ship-anywhere (ADR-002).

## 2. Decision

**Dissolve `/loop` and `/goal` for the agent, and replace the self-drive guarantee
with a deterministic Stop hook (goal-hook).**

1. **`/loop` dissolution** — the one legitimate `/loop` use (waiting on external
   state) is expressed as a background shell: `until <ready>; do sleep N; done`
   dropped into `run_in_background`, with the harness re-entering on completion.
   Event-driven, fully ship-anywhere. No `ScheduleWakeup` / cron.
2. **`/goal` removal + goal-hook** — instead of demoting `/goal` to "an optional
   action for the human," cc-master **customizes its own Stop hook**
   (`verify-board.sh`) to deterministically enforce "don't stop while the goal is
   unmet." The hook cannot read conversation or goal semantics (ADR-001) — it only
   reads the board + stdin — so it **forces the agent to self-check and gates with
   the board**:
   - filters to the current session's active board via `owner.session_id` (fixes
     Finding #4 — no cross-session false block);
   - reads the `status` enum distribution: empty DAG → block; any `ready` /
     `uncertain` → block (work remains / output unverified); otherwise → a
     self-check handshake;
   - the handshake forces one self-check against `board.goal` before releasing,
     with a fuse to prevent a misjudged block from welding the agent shut.
3. **Pull out all agent-facing `/goal`·`/loop`·`ScheduleWakeup`·`phase` guidance**
   — pure distraction + false safety + information overload. The `board.phase`
   segment (which existed only to serve `/goal`) is deleted, which also kills
   Finding #5 (the `goal_condition` `}`/`"` silent-truncation footgun) and reduces
   Finding #7 (overload).

**Known residual limit**: the hook cannot stop an agent from going through the
self-check motions (semantic hand-waving). That is the ceiling of a deterministic
hook; a deployment that wants a semantic backstop can hold `/goal` itself (as a
human). cc-master does not ship that layer.

## 3. Consequences

### 3.1 Positive

- **The self-drive guarantee becomes real and deterministic**: Finding #14 is the
  live proof — the goal-hook caught the orchestrator (the author) trying to yield
  early with four background tasks in flight, forced the self-check, and surfaced
  fill-work that could be done immediately.
- **Fully ship-anywhere**: no `/goal`, no cron, no `ScheduleWakeup` — works on
  Bedrock / Vertex / Foundry (ADR-002).
- **Less cognitive load + no false safety**: the skill no longer asks the agent to
  do something it cannot do.
- **Two findings closed for free**: deleting `board.phase` removes Finding #5;
  removing the duplicated `/goal` prose reduces Finding #7.

### 3.2 Negative

- **The semantic backstop is gone**: the hook gates on board *state*, not on whether
  the goal is *truly* met; an agent can satisfy the handshake without genuinely
  finishing. Mitigated by the forced self-check + endpoint verification, not
  eliminated.
- **Two-phase handshake over-blocks slightly**: when the agent really is waiting, the
  handshake may block one extra time. Acceptable — a self-check on every stop is
  desirable anyway.

### 3.3 Neutral

- `design_docs/` history (spec / design-notes / native-goal-loop-integration) is
  **kept**, not deleted — annotated that the `/goal` approach is superseded by
  goal-hook. ADRs record supersession; they do not erase it.
- The `board.goal` field is preserved — it is the lifeline the hook self-checks
  against.

## 4. Alternatives Considered

### 4.1 Alternative A: keep native `/goal`, demote it to "an optional human action"

Rejected. It does not deliver the self-drive guarantee for the agent at all (the
agent still cannot set it), and it leaves the false-safety framing intact — the
skill would still talk about a `/goal` the agent cannot use. The user explicitly
chose a deterministic hook over a human-only soft action.

### 4.2 Alternative B: use `ScheduleWakeup` / cron for phased self-drive

Rejected. It is the only agent-invokable timer, and it *can* approximate
"don't half-finish" via alarm re-entry — but it breaks ship-anywhere (unsupported
on Bedrock / Vertex / Foundry; cron expires after 7 days). Only a deployment
willing to give up ship-anywhere could use it. See ADR-002.

### 4.3 Alternative C: add a native-`/goal` semantic backstop layer

Deferred, not adopted. A real semantic gate would need to read conversation/goal
meaning, which the deterministic hook cannot do (ADR-001). Building it is out of
this decision's scope; a user can hold `/goal` themselves if they want that layer.

## 5. Related

- [`../design_docs/2026-06-08-goal-hook-design.md`](../design_docs/2026-06-08-goal-hook-design.md)
  — the goal-hook design spec (the mechanism this ADR adopts).
- [`ADR-002-ship-anywhere-scope.md`](ADR-002-ship-anywhere-scope.md) — why
  `/loop`/`ScheduleWakeup`/cron are out of scope.
- [`ADR-001-hooks-pure-bash.md`](ADR-001-hooks-pure-bash.md) — why the hook can
  only gate on board state, not goal semantics.
- [`ADR-003-board-narrow-waist.md`](ADR-003-board-narrow-waist.md) —
  `owner.session_id` + `status` are the pinned fields the goal-hook reads.
- [`../design_docs/dogfood-findings.md`](../design_docs/dogfood-findings.md) —
  Finding #2 (the supersession trigger), Finding #4, Finding #5, Finding #7,
  Finding #14.

## 6. References

- `design_docs/2026-06-08-native-goal-loop-integration.md` — the superseded
  integration stance (kept as history).
- `design_docs/spec.md` §12 — intentional exclusions (`/loop`/`ScheduleWakeup`).
