# Changelog

All notable changes to **cc-master** are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

_Nothing yet._

## [0.1.0] — 2026-06-08

First public release. cc-master turns any Claude Code main-session agent into a
long-horizon **master orchestrator**: it picks the right dynamic-workflow
paradigm, dispatches background work, and keeps the main thread productively
advancing across context compaction and across sessions.

### Added

- **Commands** — one-shot ignition for the orchestrator role:
  - `/cc-master:as-master-orchestrator <goal>` — bootstrap a board and become the orchestrator.
  - `/cc-master:status` — render the board summary and validate the narrow waist.
  - `/cc-master:stop` — archive the board and stand down (the board is kept, not deleted).
- **Skill A — `orchestrating-to-completion`** — the main-thread orchestration method:
  goal → dependency DAG, dispatch-on-ready, productive idle windows
  (verify · look-ahead · HITL · distil), and endpoint verification.
- **Skill B — `authoring-workflows`** — how to write dynamic-workflow scripts:
  procedural `SKILL.md` plus `references/{api-reference, patterns}` and
  `assets/` (5 templates + 4 examples). The Claude Code harness is treated as
  the authoritative validator, so no separate workflow linter is shipped.
- **Hooks (pure bash, no jq/node)** — the memory that survives compaction:
  - `UserPromptSubmit` → `bootstrap-board.sh` — deterministically creates the
    board skeleton and injects its path + the orchestrator role on the command sentinel.
  - `SessionStart` (`startup|resume|compact`) → `reinject.sh` — re-injects role + board.
  - `Stop` → `verify-board.sh` — the **goal-hook** (see its dedicated entry below).
- **Board** — the orchestrator's persistent save file: a status-bearing task
  dependency graph and the single source of truth. Lives in a configurable home
  (`$CC_MASTER_HOME`, else `<project>/.claude/cc-master/`), with a per-orchestration,
  time-sortable file so concurrent runs never collide. Gitignored.
- **goal-hook** — the `Stop` hook (`verify-board.sh`) is upgraded from a bare
  empty-board backstop into a deterministic completion gate: it reads this
  session's active board, blocks while actionable (`ready`/`uncertain`) work
  remains, forces a one-time self-check handshake against the original goal
  before releasing a completion state, and carries an anti-deadlock fuse. This
  replaces the earlier native `/goal` plan — an agent cannot set a native
  `/goal` itself, so that guidance (and the `/loop` notes) was removed in favor
  of this hook-enforced gate.
- **Test harness** — `run-tests.sh` covering hook scripts (bash assertions) and
  the content contract (Node 22+ built-in test runner: board schema,
  skill/command structure). Validates against `claude plugin validate .`.
- **Docs** — `README.md` (EN) and `README_zh.md` (中文); design specification,
  design notes, and four research reports under `design_docs/`.

[Unreleased]: https://github.com/nemori-ai/cc-master/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/nemori-ai/cc-master/releases/tag/v0.1.0
