# Changelog

All notable changes to **cc-master** are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **codex as a second endpoint reviewer** — `scripts/codex-review.sh` wraps
  `codex exec review` in a read-only sandbox with a silent-pass-through guard
  (empty review / failed call → NOT passed); documented in
  `skills/orchestrating-to-completion/references/resume-verify.md`.
- **Eval mechanism** — Track A (trigger-accuracy: `scripts/eval-trigger.sh` +
  per-skill `evals/trigger.json`) and Track B (orchestration-discipline
  benchmark: `scripts/eval-benchmark.sh` + `design_docs/eval/`).

### Fixed

- **goal-hook is now JSON-layout-agnostic** — task counting, actionable
  detection, and the completion fingerprint in `verify-board.sh` are scoped to
  the board's tasks region (between the `"tasks"` and `"log"` keys) instead of
  relying on a one-task-object-per-line layout. Compact single-line boards no
  longer miscount log entries as tasks, a `status:"ready"` inside `log[]` no
  longer blocks forever, and a log append between Stops no longer re-forces the
  self-check handshake.
- **Sidecar writes are atomic** (tmp + `mv`) — a concurrent Stop can never
  observe a torn handshake/fuse state.

### Changed

- **Skills optimization pass** — both shipped skills tightened (descriptions,
  reference TOCs, SSOT convergence per dogfood findings #7/#11/#13).
- **AGENTS.md** rewritten as the contributor entry point: five red lines with
  SSOT + grep/CI gates, a trigger-based deep-reading table, and the
  gstack × superpowers iteration paradigm.

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
