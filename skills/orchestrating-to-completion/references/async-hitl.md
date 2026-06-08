# Async completion + HITL

How to drive completions asynchronously and treat the user as a special async worker, so the
front-of-house dialogue runs in parallel with background execution and the main thread never
idle-waits.

Source: research report 2 ("the main thread doesn't idle-wait" = an ecosystem gap) + lenses
4 and 7.

---

## In-flight tracking — `dispatched_at` → p95 → hedge / degrade

Every dispatched node carries `dispatched_at` on the board. Track elapsed time against the
**p95 duration for that class of task**. When a node exceeds its class p95:

- **hedge** — dispatch a backup agent for the same task and take whichever finishes first; or
- **degrade** — let it pass with a degraded result.

This mirrors the OMNE discipline ("codex hung → defer to the milestone pool" / a "60-minute
hard deadline"): do not let a single slow agent drag the whole batch. Do **not** busy-poll a
single agent's progress or hand-roll file-size polling to guess completion (a proven
misfire) — use a structured-concurrency join and fill the waiting window with useful work.

---

## Integrate completions — on `<task-notification>`

When a `<task-notification>` arrives:

1. **Reconcile the board** — fold the finished background result into its node, mark it
   `done` (after endpoint verification — see `resume-verify.md`).
2. **Unlock newly-ready** — any node whose last dependency just satisfied becomes `ready`.
3. **Dispatch within WIP** — launch the newly-ready nodes inside the WIP cap.

This is the integrate-on-notification half of the decision program (step 1 + step 3): you do
not poll; the notification drives reconciliation, and reconciliation drives the next dispatch.

---

## The HITL model — the user is a special async worker (lenses 4 & 7)

- **Surface user-decisions immediately** — the moment a point needs the user to decide or
  confirm, surface it to the user. Don't sit on it (lens 4: the sin is being passive when you
  could act). Don't overreach on what the user must decide: anything irreversible /
  outward-facing / directional / final-approval (such as merge) must be asked first (lens 7,
  don't自专).
- **User input is an async dependency** — model it as a board node with
  `status: "blocked"`, `blocked_on: "user"`. The user's answer is just another async
  dependency satisfying that edge.
- **Ready work that doesn't depend on the user dispatches anyway** — the front-of-house
  question runs **in parallel** with background execution. Surfacing a question to the user
  never stalls work that doesn't need that answer (lens 7: front-of-house dialogue ∥
  background execution).
- **Legitimate waiting** (lens 4) is reached only when every remaining path is blocked on an
  `in_flight` background task or has been surfaced to the user and awaits an answer — at which
  point you calmly wait one beat.

Front-of-house dialogue ∥ background execution is the whole point: asking the user a question
and letting the background play are never mutually exclusive.

---

## Phased self-driving with native `/goal`

The native `/goal` mechanism keeps auto-continuing the turn while its condition is unmet. Used
end-to-end it would lock out HITL; scoped per phase it becomes a starting gun that drives each
sprint to the finish without trapping the agent. The scoping rule:

- **One goal's lifecycle = one no-HITL self-driving stretch.** A phase boundary is a HITL
  point is the goal's clear point. This meshes with the DAG: each `blocked_on:"user"` node
  already slices the graph into self-driving stretches.
  - *Inside a phase* (up to the next HITL boundary) = pure self-drive — hold a phase goal so
    the agent grinds to the end instead of dropping it half-way.
  - *At the boundary* = HITL point = the phase goal is met and cleared = the agent stops
    normally and asks the user.
  - User answers → enter the next stretch → set the next phase goal, with awareness.

- **The soul formula.** A phase `/goal`'s condition = «the phase's business end-state is
  reached» OR «the phase has entered legitimate waiting» — i.e. decision-program step 6: every
  remaining path is blocked on an in-flight background task or has been surfaced to the user
  for an answer (HITL is a subset of legitimate waiting). Three effects in one:
  - **No premature quitting** — phase unfinished, ready work or unverified nodes still on the
    board → neither branch holds → the independent evaluator kicks the agent back to work.
    This is the hard "no idle slacking" that `verify-board.sh` wants but the Stop path can't
    deliver.
  - **Never trapped at HITL** — hit a point only the user can decide → falls into legitimate
    waiting (awaiting a user answer) → released to stop and ask.
  - **Never trapped on background waits** — every path blocked on in-flight background → falls
    into legitimate waiting (awaiting background) → released to yield calmly.

  Because the evaluator reads only the conversation (never the filesystem), the OR branch fires
  only if the step-6 self-check + the phase's acceptance evidence are written out loud — set
  that as the configured prerequisite each turn.

- **Two Stop hooks, compatible.** The session runs cc-master's `verify-board` Stop hook
  alongside `/goal`'s internal Stop evaluation, and they point the same way:
  - `verify-board` blocks **only** on an empty active board, otherwise it passes.
  - `/goal` continues the turn while the phase goal is unmet **and** legitimate waiting has not
    been entered.
  - No clash: an empty board never has a goal (a goal is set only after the DAG is filled and a
    self-driving stretch begins), so when `verify-board` would block there is no goal; when a
    goal is live the board is non-empty and `verify-board` passes, leaving `/goal` to arbitrate
    whether to stop.
