# Changelog

All notable changes to **cc-master** are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **产品愿景 / 北极星 charter 持久化（docs）** — 把 cc-master 的六条产品愿景（① 异步并行多线程推进、目标完整落地；② 控制 token 消耗速度；③ 把握自主决策 vs 寻求人类接入的边界；④ 目标的分解 / 管理 / 更新 / 规划；⑤ 资源消耗速度合理前提下最大化实施效率的调度编排；⑥ 按复杂性 / 难度 / 时长选合适的模型）写入 canonical 文档作为持续指导迭代的北极星。**SSOT = `design_docs/spec.md` §1.0**（完整六条 charter，框为 aspirational「致力于」而非「已全部兑现」，附「目标 ≠ 既成事实、由 gap 审计度量差距」边界）；`README.md` / `README_zh.md`（新增「产品愿景 / The vision」节）与 `AGENTS.md` §1 各放一段紧凑摘要 + 回指 SSOT，不复述。
- **愿景落地 gap 审计 + living 追踪文档（docs）** — 新增 `design_docs/vision-landing-tracker.md`：六条愿景穿全产品面（command/hook/skill/board/script）追 trace，判落地真实性（🟢真落地/🟡半落地/🔴design-only/⚫缺失）+ adversarial 断点 + **诚实分「真 gap vs 设计意图」**。核心元模式：真 gap 几乎都不是「prose vs 机制」（多数 prose 是红线背书的设计意图），而是**非对称兜底**（C5 兜 idle 不兜顶满 / C3 Stop 闸不分未答终审与等上游）、**完整性·事务性无保障**（C1 board 完整性 / C4 supersession）、**愿景某维蒸发+overclaim**（C6 duration）。配兑现度矩阵 + 排序设计讨论清单（廉价护栏优先）+ 更新规约；`spec.md` §1.0 与 `AGENTS.md` §N 回指。
- **`requirement-elicitation`（第 4 个 dev-only meta-skill，住 `.claude/skills/`，不分发）** — 由 omne-next 同名 skill **本地化**而来：动手任何 feature / skill / 行为改动**之前**的需求发现闸（道：用户字面话是症状、不是需求 + 五个 discovery moves + strawman + 设计闸 + 何时停止挖掘）。**取代本仓 dev 流的 `superpowers:brainstorming`**（self-contain + 重接地到 board `goal` 模型与「发现 → 准入 → 造 → 度量」生命周期）。剥净全部 omne-next 硬依赖（`UserNeed` 领域模型 / 兄弟 skill 跨链接 / `omne-explore` / 目录约定），译为中文；含 `SKILL.md`、`references/discovery_moves.md`、`DESIGN.md`、`OBJECTIVE.md`。它**非「为对仗凑的第四件造/评/治」**——是不同家族的上游发现层，过 Probe（强 B.1 覆写「照字面实现」）+ 补 self-containment 缺口挣得席位。
- **两个分发 skill 补 `DESIGN.md` 设计宪法** — `skills/orchestrating-to-completion/DESIGN.md` 与 `skills/authoring-workflows/DESIGN.md`（6 段模板：one-liner / craft 自分类 / value triad / 责任边界 / 触发与反例 / 演化锚），补齐「每个站得住的 skill 都配一份 DESIGN.md」此前只覆盖 dev-only meta-skill 的不对称。
- **meta-skill 三件套（dev-only，住 `.claude/skills/`，不分发）**：
  - 新建 `curating-skill-portfolios` — portfolio 准入判断：要不要建 skill / 该 skill 还是 reference / 一组 skill 边界与重叠（Counterfactual Probe A/B + 裁剪七维 + DESIGN 宪法）；含 `OBJECTIVE.md`、`DESIGN.md`、三份 references。
  - 新建 `grounding-skill-evals` — 度量与评测纪律：声明轻量 J（成功契约）/ 接现有 eval 三脚本（Track A 触发准确率 + Track B 行为 benchmark + codex 第二评委）/ holdout + predict-then-validate 防过拟合；含 `OBJECTIVE.md`、`DESIGN.md`、三份 references。
  - 改造 `cc-master-skillsmith` — 在现有 pressure-test Iron Law 基础上，增补 craft 两轴诊断（process-control × cognitive-override，各 5 题，四象限锁 Craft A/B/C）+ 4 类 body 内容（触发 / 命名锚 / 流程骨架 / 硬约束）+ progressive-disclosure 阈值（SKILL.md ≤500 行 / references ≥100 行带 TOC）；新增 `references/craft-axis-diagnosis.md`、`references/body-content-types.md`；各配 `OBJECTIVE.md`、`DESIGN.md`。
- **skill 正文中文语言纪律** — 确立：本仓所有 skill 正文 + references 一律中文；例外仅 `name`（kebab-case 英文）、代码/路径/CLI/API 字段/工具名等技术术语；`description` 中文为主可含英文触发词。纪律写入 `AGENTS.md` §6。
- **dogfood 沉淀结论** — baseline-must-fail 原则在强模型（Sonnet 4.x 级别）上存在天花板：建议式查询（advice-shaped queries）模型直接回答而不触发 skill stub，导致 Track A 每个正例 `trigger_rate` 均为 0.0；这种 before==after==floor 的对比无信号，须退回到定性审查（已记入 `design_docs/eval/README.md`）。

### Changed

- **`AGENTS.md` §6 升级为三 meta-skill 导航 hub** — 明确「写 body → `cc-master-skillsmith`；判边界/准入 → `curating-skill-portfolios`；声明 J / 跑 eval → `grounding-skill-evals`」路由；补语言纪律段。
- **`AGENTS.md` §N 触发式深入阅读表** — 新增 `curating-skill-portfolios`（判断要不要建 skill / 边界 / 重叠）和 `grounding-skill-evals`（声明 J / 度量 / 跑 eval）两行。
- **`AGENTS.md` §4 增本仓对 superpowers 的一处覆盖** — dev 流「需求发现 / brainstorming」步改用项目自带 `requirement-elicitation`，不用 `superpowers:brainstorming`；其余「中间」段（plans / TDD / debugging / verification）与「前 / 后」仍按全局路由。
- **`AGENTS.md` §2 / §6 / §N + curating 版图自述同步** — dev meta-skill 由「三件套」扩为「三件套（造/评/治）+ `requirement-elicitation` 上游」，§6 路由四者正交（发现 → 准入 → 造 → 度量）；curating 的 portfolio 计数 2+3 → 2+4，并在 `references/counterfactual-probe.md` 注明第四件经 Probe 准入、非违背「为对仗而建第四个」警告。

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
