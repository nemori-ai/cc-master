---
title: The board
description: One JSON file is the single source of truth for an orchestration — and the only state a hook is allowed to read.
section: concepts
order: 1
deeper:
  - label: board.md — protocol narrative and long-run operating discipline
    url: https://github.com/nemori-ai/cc-master/blob/main/plugin/src/skills/master-orchestrator-guide/canonical/references/board.md
  - label: ADR-003 — the board narrow waist
    url: https://github.com/nemori-ai/cc-master/blob/main/adrs/ADR-003-board-narrow-waist.md
---

Every orchestration lives on a **board**: a single JSON file holding a state-annotated dependency graph of tasks, plus the goal, the audit log, and the runtime roster. It is the memory that survives context compaction, the handoff artifact between sessions, and the window through which hooks see the world.

Boards live under `${CC_MASTER_HOME:-$HOME/.cc_master}/boards/`, one file per orchestration, named `<UTC-timestamp>-<pid>.board.json` so concurrent runs never collide. The home is harness-neutral — it does not move with `CLAUDE_CONFIG_DIR` or any harness config.

## The narrow waist

Only a small, fixed set of fields is **mechanism contract** — hooks depend on exactly these, nothing more:

- `schema`, `goal`, `owner` (session id, active flag), `git` (worktree, branch)
- `tasks[]` with `{id, status, deps}` and the status enum

Everything else — estimates, decision packages, coordination blocks, observability — is **agent-shaped**: the orchestrator may structure it freely, and hooks never read it. This is the narrow waist: the protocol stays tiny and stable, so the agent's planning freedom stays large. Changing a waist field means changing every hook and its tests in the same PR.

## Task status: eight states

| status | meaning |
|---|---|
| `ready` | all deps satisfied — dispatchable now |
| `in_flight` | dispatched and running (must map to a real handle) |
| `blocked` | waiting on deps (auto-gated) or on a semantic blocker like a user decision |
| `done` | finished **and** verified — see below |
| `escalated` | the worker returned an escalation beyond its capability |
| `failed` | the attempt failed; retry opens a fresh attempt |
| `stale` | an upstream artifact changed; needs a re-run |
| `uncertain` | work happened but has not been verified yet |

You never hand-edit `status`. Lifecycle verbs (`ccm task start|done|block|unblock|retry`) move tasks through the legal transitions, and `ready`/`blocked` auto-gate from `deps` on every write — a task whose deps complete flips back to `ready` by itself.

## `done` means done

A task may only enter `done` with `verified: true` **and** a non-empty `artifact`. The engine rejects a bare `done` at the write gate (exit 3). Self-reports, green CI, and terminal worker processes are evidence — not acceptance. Verification happens at the orchestrator's own endpoint, and the artifact link is what makes the result auditable and resumable later.

## All writes go through ccm

Every board mutation passes through the `ccm` CLI's write gate: file lock, mutation, dependency re-gating, then a lint pass of **82 invariants** (schema, graph, and business rules) before the atomic write lands. Two hooks enforce the same boundary from the outside:

- **board-guard** (PreToolUse) denies any direct `Write`/`Edit`/shell redirection at a `*.board.json` file and tells you the `ccm` verb to use instead.
- **board-lint** (PostToolUse) is the soft backstop that catches anything that slipped through.

The result: the board can always be trusted by the next reader — the viewer, a resume in another session, or a hook deciding whether you are allowed to stop.
