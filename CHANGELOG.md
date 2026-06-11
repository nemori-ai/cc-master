# Changelog

All notable changes to **cc-master** are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **meta-skill 三件套（dev-only，住 `.claude/skills/`，不分发）**：
  - 新建 `curating-skill-portfolios` — portfolio 准入判断：要不要建 skill / 该 skill 还是 reference / 一组 skill 边界与重叠（Counterfactual Probe A/B + 裁剪七维 + DESIGN 宪法）；含 `OBJECTIVE.md`、`DESIGN.md`、三份 references。
  - 新建 `grounding-skill-evals` — 度量与评测纪律：声明轻量 J（成功契约）/ 接现有 eval 三脚本（Track A 触发准确率 + Track B 行为 benchmark + codex 第二评委）/ holdout + predict-then-validate 防过拟合；含 `OBJECTIVE.md`、`DESIGN.md`、三份 references。
  - 改造 `cc-master-skillsmith` — 在现有 pressure-test Iron Law 基础上，增补 craft 两轴诊断（process-control × cognitive-override，各 5 题，四象限锁 Craft A/B/C）+ 4 类 body 内容（触发 / 命名锚 / 流程骨架 / 硬约束）+ progressive-disclosure 阈值（SKILL.md ≤500 行 / references ≥100 行带 TOC）；新增 `references/craft-axis-diagnosis.md`、`references/body-content-types.md`；各配 `OBJECTIVE.md`、`DESIGN.md`。
- **skill 正文中文语言纪律** — 确立：本仓所有 skill 正文 + references 一律中文；例外仅 `name`（kebab-case 英文）、代码/路径/CLI/API 字段/工具名等技术术语；`description` 中文为主可含英文触发词。纪律写入 `AGENTS.md` §6。
- **dogfood 沉淀结论** — baseline-must-fail 原则在强模型（Sonnet 4.x 级别）上存在天花板：建议式查询（advice-shaped queries）模型直接回答而不触发 skill stub，导致 Track A 每个正例 `trigger_rate` 均为 0.0；这种 before==after==floor 的对比无信号，须退回到定性审查（已记入 `design_docs/eval/README.md`）。

### Changed

- **`AGENTS.md` §6 升级为三 meta-skill 导航 hub** — 明确「写 body → `cc-master-skillsmith`；判边界/准入 → `curating-skill-portfolios`；声明 J / 跑 eval → `grounding-skill-evals`」路由；补语言纪律段。
- **`AGENTS.md` §N 触发式深入阅读表** — 新增 `curating-skill-portfolios`（判断要不要建 skill / 边界 / 重叠）和 `grounding-skill-evals`（声明 J / 度量 / 跑 eval）两行。

## [0.2.0] — 2026-06-10

### Added

- **Model tiering & usage-aware pacing (SKILL A reference)** — new
  `skills/orchestrating-to-completion/references/cost-and-pacing.md`: the four
  model tiers + relative output cost, per-node tier selection, why the main
  thread stays on one model (prompt-cache), and pacing a long run against the
  5h/7d quota window (levers: downgrade model / lower WIP / defer float). Surfaced as soft pointers on lenses 2 & 5 — **reference knowledge,
  not a red line** (subagent pressure baselines showed agents already derive
  the behavior from the existing lenses; §6 Iron Law forbids fabricating an
  unviolated rule).
- **`scripts/cc-usage.sh`** — out-of-band 5h/7d usage signal for the
  orchestrator's main thread (system python3 parses local Claude Code JSONL,
  zero network / deps, ship-anywhere; **not a hook**). Emits 5h
  used/window-remaining/burn-rate + 7d used; optional `ccusage` accelerator.
- **codex as a second endpoint reviewer** — `scripts/codex-review.sh` wraps
  `codex exec review` in a read-only sandbox with a silent-pass-through guard
  (empty review / failed call → NOT passed); documented in
  `skills/orchestrating-to-completion/references/resume-verify.md`.
- **Eval mechanism** — Track A (trigger-accuracy: `scripts/eval-trigger.sh` +
  per-skill `evals/trigger.json`) and Track B (orchestration-discipline
  benchmark: `scripts/eval-benchmark.sh` + `design_docs/eval/`).
- **`nested-workflow-composition.js` example** — the first `workflow()` asset:
  composes a saved/file workflow as a per-item sub-step with shared
  budget/caps, one-level nesting, and catch-and-degrade fallback. Indexed in
  SKILL B + `patterns.md`, cross-linked from `api-reference.md`.

### Fixed

- **goal-hook is now JSON-layout-agnostic** — task counting, actionable
  detection, and the completion fingerprint in `verify-board.sh` are scoped to
  the bracket-matched `tasks` array (string- and escape-aware depth scan)
  emitting only task-object top-level fields, instead of relying on a
  one-task-object-per-line layout. Compact single-line boards no longer
  miscount log entries as tasks, a `status:"ready"` inside `log[]` no longer
  blocks forever, a log append between Stops no longer re-forces the self-check
  handshake, and flexible task-local fields — including a nested `log` with
  structured `{"id","status"}` entries — can neither truncate the scan nor
  masquerade as task state (codex review catches, two rounds).
- **Sidecar writes are atomic** (tmp + `mv`) — a concurrent Stop can never
  observe a torn handshake/fuse state.

### Changed

- **SKILL A: question-prefetch discipline (HITL)** — new `async-hitl.md` HITL
  bullet + Rationalization Table row: a foreseeable user decision on a
  not-yet-ready node is asked NOW while the user is reachable (the ask-trigger
  is "only the user can answer", never "the node became ready"), bounded
  against speculative question-peppering. Pressure-baselined per the
  skillsmith Iron Law: 6 baseline runs, 1 captured failure ("I'll stop and ask
  when we get there"), GREEN verified 2/2 with citations.
- **Skills optimization pass** — both shipped skills tightened (descriptions,
  reference TOCs, SSOT convergence per dogfood findings #7/#11/#13).
- **Eval sets expanded + Track A floor documented** — both `evals/trigger.json`
  grown 20→28 (cross-skill near-miss + strong-distractor negatives); SKILL B
  `description` de-escaped (`engine''s` → `the workflow engine`,
  semantic-equivalent). `design_docs/eval/README.md` gains a measured-floor
  warning: a real run scored every positive `trigger_rate 0.0` (root-caused in
  dogfood #25 — `find_project_root` lands on `$HOME`, advice-shaped queries are
  answered without invoking a stub, detector bails on the first tool), so a
  before==after==floor comparison carries no signal — fall back to qualitative
  review there.
- **Out-of-band scripts hardened** — `CODEX_REVIEW_MODEL` overrides the codex
  review model; `CC_MASTER_SKILL_CREATOR` overrides the skill-creator path in
  both eval wrappers; both eval wrappers pre-check that `uv` is on PATH and
  fail with an actionable message instead of `command not found`.
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

[Unreleased]: https://github.com/nemori-ai/cc-master/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/nemori-ai/cc-master/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/nemori-ai/cc-master/releases/tag/v0.1.0
