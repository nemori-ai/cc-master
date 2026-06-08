# Sample orchestration — a walkthrough you can watch happen

This is the story of one cc-master orchestration, start to finish, told so you can
**see it with your own eyes**. A toy goal goes in; a persistent board, three parallel
workers, an independent acceptance check, and a clean stand-down come out. Every board
JSON below is a real snapshot of the file the orchestrator keeps on disk — the same one a
hook reads when it decides whether you're allowed to stop.

Want the runnable proof? Every hook decision narrated here is exercised end-to-end by
[`smoke.sh`](smoke.sh) in this directory:

```bash
bash examples/sample-orchestration/smoke.sh
```

No jq, no node, no network. It prints, for each step, *what happened* and *what the hook
decided*, then a PASS/FAIL with an exit code — so it doubles as a CI smoke check.

> A note on self-driving. cc-master does **not** use any native `/goal` or `/loop`
> machinery — there is none in this plugin. The orchestrator stays productive on its own by
> running the **decision program** from the `orchestrating-to-completion` skill every turn,
> and the **goal-hook** (the `Stop` hook) is the deterministic backstop that won't let it
> quit early. That hook is the entire self-driving safety net; everything below shows it at
> work.

---

## The toy goal

> **Migrate `user_cognition`'s 3 domains (`memory`, `profile`, `preference`) to the new
> `CognitionRecord` schema.**

Small enough to read in one sitting; shaped exactly like the real thing — one shared
foundation, then independent per-domain work that wants to run in parallel.

The whole thing is one command:

```
/cc-master:as-master-orchestrator Migrate user_cognition's 3 domains to the new CognitionRecord schema
```

---

## Cast — the four moving parts

| Piece | Lifespan | Job in this story |
|---|---|---|
| **`as-master-orchestrator` command** | one-shot ignition | You type it. It carries a sentinel that fires the bootstrap hook. |
| **`bootstrap-board.sh`** (`UserPromptSubmit`) | fires once, on the command | Creates the board file, injects its path + the "you are the orchestrator" role. |
| **`reinject.sh`** (`SessionStart`) | every start / resume / **compaction** | Re-injects the role + lists active boards so a context-wiped agent re-finds itself. |
| **`verify-board.sh`** = the **goal-hook** (`Stop`) | every time the agent tries to stop | Reads *this session's* active board and decides block (keep going) or allow (you may stop). |

The board itself is the fifth character — the persistent save file all the others read and
write. It is the orchestrator's memory across compaction *and* the only window a blind
shell hook can see into.

---

## Act 1 — Ignition: the command builds the board

You type the command. `UserPromptSubmit` sees the sentinel and runs `bootstrap-board.sh`,
which creates a fresh, uniquely-named board file in the cc-master home and injects its
exact path back into the conversation:

```
cc-master: a fresh orchestration board was created at
<home>/20260608T105439Z-98526.board.json. You are now the master orchestrator for this
task — remember that path, it is YOUR board. Decompose the goal into a dependency DAG and
write tasks[] into that board file, set goal/owner/git, then invoke the
orchestrating-to-completion skill and run the decision program.
```

> **Why this matters.** The board exists *before* the agent does anything. Bootstrap is the
> activator — it doesn't trust the agent to remember to create a board; it hands one over.
> The filename is time-sortable + pid-stamped, so two orchestrations started at once never
> collide.

The board at this instant is an empty skeleton — the DAG isn't filled yet:

```json
{
  "schema": "cc-master/v1",
  "goal": "",
  "owner": { "active": true, "session_id": "", "heartbeat": "" },
  "git": { "worktree": "", "branch": "" },
  "wip_limit": 4,
  "tasks": [],
  "log": []
}
```

---

## Act 2 — Decompose: the goal becomes a dependency DAG

Now the agent does the conductor's first real job — turn the goal into a dependency graph
and write it into *its* board. For this toy goal the shape is the classic **fan-out on a
shared root**:

- **`T0`** — build the new `CognitionRecord` schema + a shared migration library. This is
  the critical-path root; nothing else can start until it lands.
- **`M1` / `M2` / `M3`** — migrate `memory` / `profile` / `preference`. Three independent
  leaves, each depending only on `T0`. The moment `T0` is done they can all run at once.

```
            ┌────────────────────────┐
            │ T0  schema + migr. lib │  (critical-path root, in_flight)
            └───────────┬────────────┘
            ┌───────────┼───────────┐
            ▼           ▼           ▼
        ┌───────┐   ┌───────┐   ┌────────────┐
        │M1 mem │   │M2 prof│   │M3 preference│   (3 leaves, blocked on T0)
        └───────┘   └───────┘   └────────────┘
```

The agent also stamps `owner.session_id` — that's the key the goal-hook later filters on,
so it gates *this* session's board and never trips over a concurrent orchestration's.

Board snapshot — **INITIAL** (root in flight, leaves blocked waiting on it):

```json
{
  "schema": "cc-master/v1",
  "goal": "Migrate user_cognition 3 domains to the new CognitionRecord schema",
  "owner": { "active": true, "session_id": "smoke-session-001", "heartbeat": "2026-06-08T10:00Z" },
  "git": { "worktree": "/repo/.worktrees/cog-migrate", "branch": "feat/cog-migrate" },
  "wip_limit": 4,
  "tasks": [
    { "id": "T0", "status": "in_flight", "deps": [], "title": "schema + shared migration lib", "mechanism": "sub-agent" },
    { "id": "M1", "status": "blocked", "deps": ["T0"], "blocked_on": "T0", "title": "migrate domain: memory" },
    { "id": "M2", "status": "blocked", "deps": ["T0"], "blocked_on": "T0", "title": "migrate domain: profile" },
    { "id": "M3", "status": "blocked", "deps": ["T0"], "blocked_on": "T0", "title": "migrate domain: preference" }
  ],
  "log": []
}
```

The conductor dispatches `T0` to a background sub-agent and — per the decision program —
does **not** sit and watch it. There's no ready leaf yet (all three are blocked on `T0`),
so the only legitimate moves are fill-work that passes the admission test, or, if there's
none, calmly waiting one beat. The orchestra is playing; the conductor keeps the books.

---

## Act 3 — The hard part: surviving a compaction

A long task means the context window fills and **compaction** happens. Compaction can drop
"I am an orchestrator" *entirely* — and the agent cannot re-inject that fact for itself,
because the very memory that it had a role is what got wiped.

This is where `reinject.sh` earns its keep. On `SessionStart` (including `source:compact`)
it scans the home, finds the active board, reads its goal back out, and re-injects from
**outside** the agent's context:

```
You are a cc-master master orchestrator. Your orchestration board(s) live in <home>.
Active: • 20260608T105439Z-98526.board.json [Migrate user_cognition 3 domains to the new
CognitionRecord schema]. Re-read the board for the task you are working on (recognise it by
its goal), then invoke the orchestrating-to-completion skill and continue the decision
program. Do not restart work already done/verified; integrate any completed background
results first.
```

> **The key moment.** Post-compaction, the agent wakes up not knowing it was orchestrating.
> The hook hands back: (1) your role, (2) where your boards live, (3) the goal so you can
> recognise *which* board is yours, and (4) an explicit "don't redo finished work." The
> board carried the *progress* across the wipe; the hook carried the *identity*. Together
> they make the orchestration resumable across an arbitrary number of compactions and even
> across separate sessions.

The agent re-reads its board, sees `T0` finished while it was away, and continues — it does
not restart anything.

---

## Act 4 — Dispatch on ready: three leaves in parallel

`T0` lands and is verified at the endpoint (the conductor reads the diff itself — a
green gate is *not* a pass). That clears the only dependency the three leaves had, so
`M1`/`M2`/`M3` all flip from `blocked` to `ready` at once. With `wip_limit: 4` there's room
to dispatch all three in parallel — no barrier-waiting, no doing them one at a time.

Board snapshot — **MID-RUN** (root done + verified; three leaves ready to fire):

```json
{
  "schema": "cc-master/v1",
  "goal": "Migrate user_cognition 3 domains to the new CognitionRecord schema",
  "owner": { "active": true, "session_id": "smoke-session-001", "heartbeat": "2026-06-08T11:00Z" },
  "wip_limit": 4,
  "tasks": [
    { "id": "T0", "status": "done", "deps": [], "title": "schema + shared migration lib", "verified": true },
    { "id": "M1", "status": "ready", "deps": ["T0"], "title": "migrate: memory" },
    { "id": "M2", "status": "ready", "deps": ["T0"], "title": "migrate: profile" },
    { "id": "M3", "status": "ready", "deps": ["T0"], "title": "migrate: preference" }
  ],
  "log": [ { "t": "11:00Z", "note": "T0 verified done; 3 leaves now ready to dispatch in parallel" } ]
}
```

Suppose the conductor got sloppy here and tried to end the turn with those three leaves
still `ready`. The goal-hook stops it cold:

> `verify-board.sh` sees a `ready` task → **BLOCK**: *"this board still has a `ready` or
> `uncertain` task. A `ready` task can proceed now... Resolve it (or mark it
> `blocked`/`escalated`) before stopping."*

That's the anti-idle backstop made deterministic: you physically cannot stop while there is
dispatchable work on the board. (An empty board — bootstrap created but never filled —
blocks for the same reason: *"an active board has no tasks; decompose the goal first."*)

---

## Act 5 — Acceptance, then the forced self-check

The three leaves run in parallel, finish, and are each **independently verified** at the
endpoint — the conductor checks the actual migrated records, not the workers' self-reports.
Every node is now `done`. Nothing is `ready`, nothing is `uncertain`.

Board snapshot — **DONE** (every node done + verified):

```json
{
  "schema": "cc-master/v1",
  "goal": "Migrate user_cognition 3 domains to the new CognitionRecord schema",
  "owner": { "active": true, "session_id": "smoke-session-001", "heartbeat": "2026-06-08T12:30Z" },
  "wip_limit": 4,
  "tasks": [
    { "id": "T0", "status": "done", "deps": [], "title": "schema + shared migration lib", "verified": true },
    { "id": "M1", "status": "done", "deps": ["T0"], "title": "migrate: memory", "verified": true },
    { "id": "M2", "status": "done", "deps": ["T0"], "title": "migrate: profile", "verified": true },
    { "id": "M3", "status": "done", "deps": ["T0"], "title": "migrate: preference", "verified": true }
  ],
  "log": [ { "t": "12:30Z", "note": "all 3 domains migrated + independently verified; goal looks met" } ]
}
```

The board looks finished — so the agent tries to stop. **Here is the most important hook
moment in the whole story.** The goal-hook will not take "done" on faith. On the *first*
stop in a completion state, it blocks exactly once and forces a self-check:

> `verify-board.sh` sees a completion state, first stop → **BLOCK (once)**: *"before you
> stop, self-check against this board's `goal`. (1) Is every point that needs the user
> surfaced / marked `blocked_on:"user"`? (2) Against the **original goal**, is every to-do
> actually done — including any NOT yet listed on the board? If something is missing, add it
> to `tasks[]` and keep going; only stop once the goal is truly met."*

> **Why a handshake and not a hard allow.** A shell hook can't read the agent's reasoning —
> it only sees board status. So instead of trusting the status distribution, it forces the
> agent to re-derive completion against the *original goal*, on purpose catching the failure
> mode where the board says done but a real to-do was never written down. The hook records
> "I forced the self-check this round" in a sidecar file it owns — **it never writes the
> board**, which stays the agent's single source of truth.

The agent does the self-check, confirms all three domains really are migrated and verified
and nothing is owed to the user, and tries to stop again. This time the handshake is
already satisfied:

> `verify-board.sh`, completion state, second stop → **ALLOW** (exit 0, no `decision:block`).
> The conductor may stand down.

And a safety valve sits behind all of this: if the agent somehow gets wedged in a
block loop, a **fuse** (5 consecutive blocks) force-releases the stop with a warning, so a
single misjudgment can never permanently trap the session.

---

## Act 6 — Stand down: archive, and the hooks go quiet

The goal is met and verified. The user (or `/cc-master:stop`) stands the orchestration
down, which flips `owner.active` to `false`. The board is **kept, not deleted** — it's a
record of the finished run — but every hook must now treat it as inactive.

Board snapshot — **ARCHIVED** (`owner.active:false`):

```json
{
  "schema": "cc-master/v1",
  "goal": "Migrate user_cognition 3 domains to the new CognitionRecord schema",
  "owner": { "active": false, "session_id": "smoke-session-001" },
  "tasks": [
    { "id": "T0", "status": "done", "deps": [] },
    { "id": "M1", "status": "done", "deps": ["T0"] },
    { "id": "M2", "status": "done", "deps": ["T0"] },
    { "id": "M3", "status": "done", "deps": ["T0"] }
  ]
}
```

Now the hooks fall silent, the way they should for a dormant orchestration:

- `reinject.sh` scans the home, finds **no** active board → injects nothing (empty output).
  Future sessions won't be told "you are an orchestrator" — because right now, you aren't.
- `verify-board.sh` finds no active board owned by this session → **ALLOW (dormant)**. The
  agent can stop freely; there's nothing left to gate.

Curtain.

---

## The whole arc, as the hooks saw it

| Act | Board state | Hook | Decision |
|---|---|---|---|
| 1 Ignition | (none → empty skeleton) | `bootstrap-board.sh` | create board, inject path + role |
| 2 Decompose | 4-node DAG, root `in_flight` | — | agent fills `tasks[]` |
| 3 Compaction | unchanged | `reinject.sh` | re-inject role + board listing |
| 4 Dispatch | 3 leaves `ready` | `verify-board.sh` | **block** (ready work pending) |
| 5a Done, 1st stop | all `done` | `verify-board.sh` | **block once** (forced self-check) |
| 5b Done, 2nd stop | all `done` | `verify-board.sh` | **allow** (handshake satisfied) |
| 6 Archive | `owner.active:false` | `reinject.sh` / `verify-board.sh` | **silent** / **allow** (dormant) |

Every one of those decisions is asserted, live, by [`smoke.sh`](smoke.sh). Run it and watch
the same story play out against the real hook scripts.
