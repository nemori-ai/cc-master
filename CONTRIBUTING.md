# Contributing to cc-master

Thanks for wanting to make cc-master better. This guide covers the dev loop and
the design invariants you must not break.

> 中文读者：术语保留英文，正文中英混排即可。下面所有命令对中英用户一致。

## Dev setup

cc-master is a Claude Code plugin — no build step, no package install. You run it
straight from a live clone.

```bash
git clone https://github.com/nemori-ai/cc-master.git
cd cc-master
claude --plugin-dir .          # start a local session against the live repo
```

`--plugin-dir` loads the plugin from the working tree with **no cache**, so every
edit you make takes effect on the next session — this is the fastest dogfood loop.
(The marketplace + `enabledPlugins` install path *does* cache; don't use it while
developing — see [README](README.md#install).)

Requirements: **Node 22+** and **bash** to load the plugin. For full hook behavior
you also need the `ccm` CLI built (see next).

### board 引擎 = 独立 `ccm` CLI（ADR-014）

board 的状态逻辑（lint / graph / model）已解耦为独立安装的 **`ccm` CLI**（源在
`ccm/`·`@ccm/engine` 库 + `apps/cli`，**不随 plugin 分发**）。hooks（board-lint /
verify-board）与 webview 经它工作：hooks 经进程边界 `spawn ccm`，webview 吃 vendored
`@ccm/engine` IIFE。**`ccm` 缺失时 hooks 优雅降级（静默、不 block）**，故 plugin 仍能在
只有 Node+bash 的环境加载——但要跑出**完整 hook 行为 + `run-tests.sh` 的 ccm 路径**，先建 ccm：

```bash
pnpm -C ccm install && pnpm -C ccm build   # 出 dist
```

`run-tests.sh` 会自动 `pnpm -C ccm build` + `export CCM_BIN` 指向 `ccm/apps/cli/dev-bin/ccm`
（node-bin shim，免每次重建 SEA）；无 pnpm/dist 时软失败、hook 测试走降级路径。hooks 解析
`ccm` 的顺序：`$CCM_BIN`（绝对路径覆写）> PATH 上的 `ccm`。

### Generated plugin adapters

`plugin/src` is the semantic source. `plugin/dist/<harness>` is committed generated
output and must be kept in the same commit as the source change that caused it.
Install the repo-local pre-push hook once per clone:

```bash
bash scripts/install-git-hooks.sh
```

The hook runs `bash scripts/check-plugin-dist-sync.sh` before every `git push`.
That script regenerates the Claude Code and Codex adapter trees; if `plugin/dist`
changes, the push is blocked. Review and commit the generated diff, then push
again.

## Before you open a PR

Run both checks. They are the same two gates the maintainers run:

```bash
./run-tests.sh                 # hook tests (bash) + content contract (Node 22+)
bash scripts/check-plugin-dist-sync.sh
claude plugin validate plugin/dist/claude-code
```

`run-tests.sh` must end with `ALL TESTS PASSED`, `check-plugin-dist-sync.sh`
must leave no `plugin/dist` diff, and `claude plugin validate plugin/dist/claude-code`
must report no errors.

### ccm 改动：本地验收必须对齐 CI `build-and-check`

上面三道门覆盖 hook 行为 + content contract + plugin 结构，**但不含 ccm 的严格类型检查与
lint**。CI 的 `ccm-ci` workflow 有一个 `build-and-check` job，它是**复合门（Typecheck →
Lint → Build）**，碰 `ccm/**` 的 PR 必过。本地 / subagent 常只跑 `pnpm -C ccm build`（tsdown
**非严格**、不做 `tsc --noEmit`）+ `run-tests.sh`（**不含** ccm typecheck / lint）就自报绿——
于是**本地绿、CI 红**（曾发生 CI 红被 merge 的事故，见下）。

所以**任何 `ccm/` 改动，除上面三道门，必跑这两条对齐 `build-and-check`**：

```bash
pnpm -C ccm typecheck   # 严格 tsc --noEmit —— tsdown build 不做，只此处能抓
pnpm -C ccm lint        # biome check —— 含 lint 规则 + formatter
```

biome format 欠账的修法：`cd ccm/<pkg> && pnpm exec biome check --write .` 自动改格式；
`noUnusedImports` 一类**非** auto-fixable，须手动删。

### merge 前 CI 必须绿（branch protection · 硬闸）

main 已设 **branch protection**：`build-and-check` 是 required check + **strict**（分支须与
main up-to-date）+ **enforce_admins**（连 admin 都不能红着 merge）。所以 **CI 红的 PR 任何人
（含 admin）都 merge 不进 main**——把「gate 红也能 squash 进 main」这个曾经踩过的事故从机制上
堵死。`gh pr merge <N> --squash` 之前先确认 `build-and-check` = pass：

```bash
gh pr checks <N>                            # 确认 build-and-check = pass
gh pr merge <N> --squash --delete-branch
# 或让 CI 跑完自动 merge（省得手动等）：
gh pr merge <N> --squash --auto --delete-branch
```

### 机制 ↔ skill 对账步（改了 command / hook / script 业务逻辑就做）

如果你这次 PR 改动了任何 `plugin/src/commands/` / `plugin/src/hooks/*/implementations/claude-code/` / `plugin/src/skills/*/canonical/scripts/`（或顶层
`scripts/`）里某个机制的**业务逻辑**（不只是注释 / 排版），开 PR 前做一遍**人工对账仪式**，
确保 skill prose 没和实现脱节（语义漂移）。这是一道**轻量手工核对仪式（ritual），不是自动化
门、也不接 CI**（T30 设计闸定的路线）——所以靠你照着下面三步走：

1. **查矩阵找受影响的 prose**：打开 [`design_docs/mechanism-reconciliation.md`](design_docs/mechanism-reconciliation.md)，
   找到你改的机制那一行，看「被哪些 skill prose 引用」列——这些就是可能描述了你这次改掉的行为的
   prose 文件。

2. **逐一核对 prose 是否仍与改后实现一致**：逐个打开那些文件，确认 prose 对该机制的描述仍与
   on-disk 实现相符。**不一致 = 语义漂移**——按矩阵把 prose 改对（落点就是矩阵列出的那个文件），
   并把该机制行的「上次同步日期」更新到今天。

3. **grep 硬化（堵漏列病根）**：矩阵手维护、可能漏列引用——所以对你改的机制名 `grep plugin/src/skills/`
   一遍，确认矩阵那一行没漏掉任何引用它的 prose 文件。这个 grep 是**一次性核对工具**，不是常驻
   脚本、也不是 lint 门。命令骨架（把 `<机制名>` 换成你改的那个，**优先用去扩展名的 basename**，
   因为 prose 常以不带 `.sh`/`.js` 的形式引用——例如 `verify-board` 而非 `verify-board.sh`）：

   ```bash
   # 例：改了 plugin/src/hooks/verify-board/implementations/claude-code/verify-board.js
   grep -rln verify-board plugin/src/skills/ | grep -v '/canonical/scripts/'
   # 把输出和矩阵该行「被哪些 skill prose 引用」列逐一对照：
   #   - grep 命中、矩阵没列  → 矩阵漏列了，补进矩阵那一行
   #   - 矩阵列了、grep 没命中 → 先换不带扩展名的机制名再搜一遍确认；仍无则该引用已失效，从矩阵删
   ```

   口径与矩阵表头一致：`grep -v '/scripts/'` 排除 skill 自身的脚本源码；纯 `.design/` 的设计性
   提及不算 agent 指导 prose（保留作交叉参考标注即可，不计入引用列）。

If your change is behavioral, also **dogfood it**: start a real orchestration with
`/cc-master:as-master-orchestrator <goal>` and confirm the change works against the
live plugin runtime. Several past bugs were invisible to the test suite and only
surfaced under a real session.

## Design invariants — do not break these

The six load-bearing design red lines (hooks use bash + node/JS — ADR-006 · stable board narrow
waist · two non-overlapping skills · the conductor never plays an instrument ·
ship-anywhere · every hook dormant-until-armed — ADR-007) have a **single source of truth in [`AGENTS.md` §3](AGENTS.md#3-non-negotiable-红线ssot-在此)** —
each with its decision-record link and a PR/CI grep checkpoint. Read it before
opening a PR; a PR that violates one will be sent back.

## Style & conventions

- Match the surrounding prose voice (second-person, direct) in skills and commands.
- Keep `README.md` and `README_zh.md` in sync when you touch user-facing docs.
- Add a `## [Unreleased]` entry to [`CHANGELOG.md`](CHANGELOG.md) for any
  user-visible change.
- Don't commit a real runtime board; `.claude/cc-master/` is gitignored.

### 技术问答与解释性技术文本

在 issue / PR 讨论、文档或 agent 会话中编写面向人类的技术问答、故障解释、操作说明时，
借鉴 [ASD-STE100 Simplified Technical English 官方当前正式版](https://www.asd-ste100.org/)
的清晰写作原则。截至 2026-07-20，当前正式版为 Issue 9（2025-01-15）。这是一条编辑基线，
不表示本仓文本已经通过正式 STE 合规审核。

- **准确优先**：不得为缩短文本改变技术含义或省略必要条件；项目 canonical 术语优先，
  同一对象始终使用同一名称，不为文风变化改用同义词。
- **直接且单一**：先给结论，再写条件、动作和结果；使用短句，每句只承载一个主要判断或
  动作；必须预先知道的条件放在动作之前；优先使用主动语态，操作步骤使用祈使句。
- **风险说完整**：安全说明明确标出风险级别，并写清命令或条件以及可能后果。
- **字面值不改写**：代码、API、CLI、协议字段、标识符、报错原文和直接引语保持原样。
- **按语言应用**：英文文本可直接借鉴 STE 写作规则和受控词典；中文文本只借鉴术语一致、
  信息渐进和句式直接等结构原则，不机械套用英文词典或每句 20/25 词的限制。
- **合规声明从严**：只有任务明确要求正式 STE 合规、已核对官方当前版全文并完成逐条审核时，
  才能声称“符合 ASD-STE100”；其他情况只称“借鉴 ASD-STE100”。

## Reporting bugs / requesting features

Use the issue templates under `.github/ISSUE_TEMPLATE/`. For anything security-
sensitive, follow [SECURITY.md](SECURITY.md) instead of opening a public issue.

## Contribution license

Unless the maintainers agree otherwise in writing, any contribution submitted to
this repository is offered under the project's current
[PolyForm Noncommercial License 1.0.0](LICENSE). By submitting a contribution,
you represent that you have the right to do so and agree that the contribution
may be distributed under those terms. This does not transfer your copyright.

除非维护者另行书面同意，提交到本仓库的贡献均按项目当前的
[PolyForm Noncommercial License 1.0.0](LICENSE) 提供。提交贡献即表示你有权提供该贡献，
并同意项目按该协议分发。该约定不转让你的著作权。
