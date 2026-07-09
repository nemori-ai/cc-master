---
name: cc-master-retro
description: 'Triggers: 当你在 Codex 收到 `$cc-master-retro [--home <path>] [--board <board-stem>] [--out <dir>]` 时，对一块 cc-master board（进行中或已归档均可）做只读复盘并把复盘文档写进被编排项目内；Do NOT 用它写 board、不用于替代 handoff 的续接叙事。'
argument-hint: '[--home <path>] [--board <board-stem>] [--out <dir>]'
---

$cc-master-retro $ARGUMENTS

对一场 cc-master orchestration 做一次**只读**的复盘：读它的 `goal` / `log` / `judgment_calls` / 任务终态，提炼成一份**面向未来同类任务的 orchestrator**的经验文档，落到**被编排项目内**（不是 cc-master home）。对进行中或已归档（`owner.active:false`）的 board 都能跑。

参数：$ARGUMENTS

- `--home <path>`：cc-master home，缺省 `$CC_MASTER_HOME` → `$HOME/.cc_master`。
- `--board <board-stem>`：显式 board 选择器（板文件名去掉 `.board.json`），先过 path-safe guard（`^[A-Za-z0-9._-]+$` 且非 `.`/`..`）。未带时：恰好一块 active 板就用它；没有 active 板则列出 `<home>/boards/` 下按时间戳倒序的候选（含已归档）+ 各自 `goal`，请用户选；不要猜。
- `--out <dir>`：覆盖落盘目录，不做存在性探测。

只读取数（都走 `ccm ... --board <path> --json`，不需要板处于 active）：`board show`（goal/statusCounts）、直接读 board JSON 取 `git`/`scheduling`（`board show --json` 摘要不含这两项）、`log list`、`jc list` + 逐条 `jc show`、`task list` + 逐个 `task show`（取 status/deps/artifact/model/blocked_on 等实际字段）。再关联同 home 下 `<board-stem>--*.decision.md` 与内容含 `Board:` 指针的 `*.handoff.md`（只引用路径与摘要，不整篇复制）。

落盘位置：从 cwd 向上找 `.git` 定项目根（找不到就用 cwd 本身）；项目根若已有一个正式设计文档目录（惯例名 `design` 或 `design_docs`）就落它下面的 `retros/<STAMP>--<board-stem>.retro.md`，没有就落 `.cc-master-retros/<STAMP>--<board-stem>.retro.md`；`--out` 显式覆盖两者。

复盘文档 frontmatter 含 `board`/`goal`/`generated_at`/`status_counts`；正文固定七节标题：TL;DR / 发生了什么 / 调度与估算质量 / HITL 成本 / 验证过的机制 / 踩的坑 / 候选经验（每条含建议归宿类型、建议落点、证据、候选内容草稿，只如实生成、不做去重合并打分）。

绝不写 board（不调用任何写 verb、不追加 log）、绝不碰 GitHub、绝不写用户全局配置、绝不自动追加目标项目自己的经验台账文件（只在候选经验小节建议）。写完把文档路径与七节实质情况告诉用户，board 文件本身应零改动。
