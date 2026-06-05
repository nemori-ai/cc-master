---
description: Render a cc-master board summary — progress, blockers, critical path, decisions awaiting the user.
---

Read `.claude/cc-master/board.json` and render a concise status report:

- **Progress**: done / total tasks; list any `done` tasks with their `artifact`.
- **In flight**: each `in_flight` task with its `mechanism`, `handle`, and `dispatched_at`; flag any past the p95 duration for its kind as a hedge candidate.
- **Blocked**: tasks blocked on other tasks vs. blocked on the user (`blocked_on:"user"`) — surface the latter prominently.
- **Critical path**: the chain of `deps` with zero float (longest dependency chain to the goal).
- **Health check**: validate the board's narrow waist — `schema`, `goal`, `owner`, and every task has `id`/`status`/`deps`. Report any violation.

Do not modify the board; this is read-only.
