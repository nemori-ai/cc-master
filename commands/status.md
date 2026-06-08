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
- **Health check**: validate the board's narrow waist — `schema`, `goal`, `owner`, and every task has `id`/`status`/`deps`. Report any violation.

Do not modify the board; this is read-only.
