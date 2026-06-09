# Board — the orchestration save file

**Essence**: the orchestrator's "save file" for a long task — a status-bearing **task
dependency graph**. It is simultaneously ① the memory that survives compaction, and ② the only
window into orchestration state a hook can read (a hook is a shell — it cannot read the agent's
context, and it cannot read the built-in `Task` tool).

## Contents

- [Key decisions](#key-decisions)
- [The narrow-waist principle](#the-narrow-waist-principle)
- [Single source of truth](#single-source-of-truth)
- [Read / write / flush discipline](#read--write--flush-discipline)
- [Supersession — explicit state](#supersession--explicit-state-not-implicit-gc)
- [The `log` segment](#the-log-segment--lightweight-audit)
- [Example](#example-consistent-with-boardexamplejson)

---

## Key decisions

- **Name**: `board`. **Single source of truth.** **Configurable home + one uniquely-named
  board file per orchestration.** The home is `$CC_MASTER_HOME` if set, else
  `${CLAUDE_PROJECT_DIR:-$(pwd)}/.claude/cc-master/` — a user storage preference, no longer a
  hardcoded path. Each orchestration gets its own time-sortable file
  `<UTC-timestamp>-<pid>.board.json` (e.g. `20260605T101821Z-54324.board.json`), so multiple
  concurrent orchestrations never collide. The bootstrap (UserPromptSubmit) hook creates the
  file and injects its exact path; **you own which board is yours** — after compaction,
  re-discover it by listing the home and matching the `goal`. Gitignored.
- **Storage = mutable snapshot (one named board file per orchestration)**: each turn, `Write`
  the whole file (the narrow waist is small, so an edit can't corrupt it); generate the
  markdown view on demand.

---

## The narrow-waist principle

Don't nail down the whole table — only nail down the minimal contract the hook depends on. This
gives the agent freedom while keeping hand-maintenance safe.

### The pinned waist

```
top-level: schema, goal, owner { active, session_id, heartbeat }, git { worktree, branch }
tasks[ { id, status, deps } ]
```

(These map 1:1 to `board.template.json` / `board.example.json`: `schema`, `goal`,
`owner.active`, `owner.session_id`, `owner.heartbeat`, `git.worktree`, `git.branch`, and the
`tasks[]` array.)

### Status enum (each routes differently in the DAG)

`ready / in_flight / blocked(blocked_on:"user"|"<taskid>") / done / escalated / failed / stale
/ uncertain`

| status | routing |
|---|---|
| `ready` | dependencies satisfied — dispatch within the WIP cap. |
| `in_flight` | dispatched, running in the background — track `dispatched_at` against the task class p95 (see `async-hitl.md`). |
| `blocked` | waiting on `blocked_on` — either `"user"` (an async user dependency) or `"<taskid>"` (an upstream task). |
| `done` | finished and verified — content-hash accountable, skippable / resumable. |
| `escalated` | a sub-agent returned an escalation result — supersede the node and seed a workflow. |
| `failed` | the node failed — route per its escalation condition. |
| `stale` | an upstream artifact changed — re-run (see dependency pinning in `resume-verify.md`). |
| `uncertain` | done-but-unverified — route to a verification node / verify at the endpoint. |

### The flexible edges (agent-shaped freely, hook-ignored)

`title / artifact / dispatched_at / mechanism / handle / kind / justification / output_schema /
dep_pins / notes / log` — plus the example fields `verified`, `blocked_on`, and the top-level
`wip_limit`.

The hook ignores everything outside the pinned waist, so the agent can shape the flexible edges
however the task needs.

---

## Single source of truth

The built-in `Task*` tools are at most an in-session draft mirror — **non-authoritative**. Only
your board file in the home is the save file that a power-cut, a shutdown, and a hook all
recognize. When the two disagree, the board file wins.

---

## Read / write / flush discipline

- **Write the whole file each turn** — the snapshot is small.
- **Flush at decision-program step 7** (close of every turn). Optionally also flush on
  PreCompact.
- The hook only reads the board (it cannot mutate orchestration state), so the agent owns all
  writes.

---

## Supersession — explicit state, not implicit GC

When a node is re-altituded or replaced by an upstream change, that is an **explicit board
status** (`escalated` / `stale`), not implicit garbage collection. The superseded node stays on
the board with its status set so the history is auditable.

---

## The `log` segment — lightweight audit

Retrospective and audit ride on the lightweight `log` segment of the flexible edges — **not** a
full event-sourcing store (YAGNI). Append a terse entry when something noteworthy happens; keep
it cheap.

---

## Example (consistent with `board.example.json`)

```json
{
  "schema": "cc-master/v1",
  "goal": "Migrate user_cognition's 9 domains to the new CognitionRecord schema",
  "owner": { "active": true, "session_id": "abc123", "heartbeat": "2026-06-05T12:30Z" },
  "git": { "worktree": "/repo/.worktrees/cog-migrate", "branch": "feat/cog-migrate" },
  "wip_limit": 4,
  "tasks": [
    { "id": "T0", "status": "done", "deps": [], "artifact": "commit a1b2c3", "verified": true },
    { "id": "T1", "status": "in_flight", "deps": ["T0"], "mechanism": "sub-agent", "handle": "bg-7a", "dispatched_at": "12:18Z" },
    { "id": "T3", "status": "ready", "deps": ["T0"] },
    { "id": "T9", "status": "blocked", "deps": ["T1"], "blocked_on": "T1" },
    { "id": "D1", "status": "blocked", "deps": [], "blocked_on": "user", "title": "Split the PR into two?" },
    { "id": "F1", "status": "ready", "deps": [], "kind": "fill-work", "justification": "produces-reusable-artifact", "title": "Pre-draft the PR description skeleton" }
  ],
  "log": []
}
```
