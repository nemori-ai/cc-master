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

## The goal-hook — forced self-check + board gate at Stop

cc-master's deterministic guard against stopping early is the **goal-hook** (the `verify-board`
Stop hook). When you try to stop, it reads **your board** (never your reasoning) and gates the
Stop: if the board still carries actionable work — a `ready` task, or an `uncertain`
done-but-unverified node — it blocks and kicks you back. When the board is in a completion
state, it first **forces a self-check against the board's `goal`** before letting you go (a
fuse releases the gate if it ever blocks too many times in a row, so a misjudgement can't weld
you shut).

Because the hook is a shell — it sees the board, not the conversation — the self-check is
yours to do: keep the board's `status` enum honest (mark satisfied-and-dispatchable nodes
`ready`, blocked ones `blocked`, done-but-unverified ones `uncertain`), and write your
decision-program step-6 ledger + acceptance evidence into both the conversation and the board.
The hook gates on board status; your written self-check is what makes a Stop trustworthy.

### The step-6 ledger — the fixed shape (single source)

This is the canonical definition the SKILL.md decision program points to. The goal-hook reads
the board to gate your Stop, but **it cannot read your reasoning** — so each turn you reach
decision-program step 6, write the conclusion **and the acceptance evidence into both the
conversation and the board**, in a fixed shape:

- **one line per still-open path**: `<task-id> · <status> · <blocker | evidence>`
- then **one verdict line**, exactly one of:
  - `goal met` — every path is `done` and verified at the endpoint;
  - `legitimate waiting: every path blocked or surfaced` — every remaining path is blocked on
    an in-flight background task or is awaiting a user answer;
  - `still working` — there is schedulable work (you should not be at step 6 — go back to the
    top of the decision program).

The hook gates on board status; this written ledger is what makes "done" *trustworthy* rather
than merely asserted. A bare "looks done" with no per-path evidence is **not** a valid Stop.
