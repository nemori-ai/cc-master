---
description: Render a cc-master board summary — progress, blockers, critical path, decisions awaiting the user.
---

Read your orchestration board and render a concise status report. Boards live in the cc-master home (`$CC_MASTER_HOME`, else `<project>/.claude/cc-master/`), named `<timestamp>-<pid>.board.json`.

First identify which board to report on:

1. List the home and read every `<timestamp>-<pid>.board.json` whose `owner.active` is `true`.
2. If exactly one is active, use it.
3. If several are active, match each board's `goal` field against the goal you are currently driving, and use the one that matches.
4. If several match, none match, or you cannot determine the board unambiguously, **ask the user which board to report on** (list the candidate boards with their `goal` and file name) rather than guessing.

Then report from the chosen board:

- **Progress**: done / total tasks; list any `done` tasks with their `artifact`.
- **In flight**: each `in_flight` task with its `mechanism`, `handle`, and `dispatched_at`; flag any past the p95 duration for its kind as a hedge candidate.
- **Blocked**: tasks blocked on other tasks vs. blocked on the user (`blocked_on:"user"`) — surface the latter prominently.
- **Critical path**: the chain of `deps` with zero float (longest dependency chain to the goal).

Then run these **read-only program-state health checks** (all derived from the board you already read, plus an optional `cc-usage.sh` call — invent no new state, write nothing back):

- **Narrow-waist integrity**: validate the board's pinned waist — `schema`, `goal`, `owner`, and every task has `id`/`status`/`deps`. Report any violation.
- **Deps-graph consistency** — scan the `tasks[]` DAG for three defects and report each by task `id`:
  - **Dangling deps**: any `deps` entry pointing at a task `id` that does not exist on the board.
  - **Cycles**: any dependency cycle (a chain of `deps` that loops back on itself) — a cycle can never make progress.
  - **Unlockable-but-locked**: any `blocked` task whose `blocked_on` is a `<taskid>` that is already `done` — its upstream cleared but it was never released to `ready`. List these as "can be unlocked now."
- **Over-scheduling**: count `in_flight` tasks and compare against `wip_limit` (a flexible edge — may be absent; if so, say so and skip the comparison rather than assuming a cap). Report `in_flight N / wip_limit M`; flag when the cap is met (no headroom to dispatch) or exceeded (over the cap — next turn should not add more, consider deferring high-float work).
- **Unanswered user decisions**: list the `title` of every task that is **both** `status:"blocked"` **and** `blocked_on:"user"` — these are decisions the orchestrator is waiting on the user for. Require both fields (the same `blocked(blocked_on:"user")` contract verify-board.sh enforces): a task already `status:"done"` (or otherwise resolved) that still carries stale `blocked_on:"user"` metadata is an *answered* decision — do **not** report it as unanswered. Surface the genuinely unanswered ones prominently (a long-running orchestration must never silently sit on an un-answered user gate).
- **Budget snapshot**: note that the main thread can run `scripts/cc-usage.sh` (out-of-band, not a hook) for a 5h/7d usage signal — `five_hour.used_tokens` / `burn_rate_per_min` / `window_remaining_min` and `seven_day.used_tokens` — to read used / burn / remaining against the rolling quota window before pacing decisions. Surface the numbers if you ran it; otherwise point at the command.

Do not modify the board; this is read-only.
