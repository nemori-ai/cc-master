---
name: cc-master-distill
description: 'Triggers: 当你在 Codex 收到 `$cc-master-distill <retro-path...> [--asset-type <disc,skill,workflow,subagent>] [--apply pr|draft] [--out-branch <name>]` 时，把一份或多份复盘文档的候选经验蒸馏成目标项目的实际资产（纪律文档 / skill / workflow / subagent），一律走 feature-branch+PR 或非 git 项目的变更草稿目录收口；Do NOT 用它写 board、Do NOT 调用任何 ccm 命令、Do NOT 静默丢弃任何候选经验。'
argument-hint: '<retro-path...> [--asset-type <types>] [--apply pr|draft] [--out-branch <name>]'
---

$cc-master-distill $ARGUMENTS

把一份或多份 `$cc-master-retro` 产出的复盘文档里的候选经验,蒸馏成目标项目的实际资产。这不是复盘本身
（复盘只读、产候选经验清单）——本命令**可写**,把候选经验落成增改并收口成 PR（或非 git 项目的变更草稿
目录）。本命令消费的是 retro 文件本身，**不消费 board、不碰 cc-master home、不调用任何 `ccm` 命令**。

**第一步：调用 `distilling-lessons-into-assets` skill**——它承载"一条候选经验该落成纪律文档 / skill /
workflow / subagent 中的哪一种、以及每种资产该怎么落地"的判断力，动手规划前先内化它；下面每一步提到
"归宿判断"或"落地手艺"都以该 skill 的心智为准，本文不重复其内容。

参数：$ARGUMENTS

- `<retro-path...>`（必填，可给多个）：一个或多个 `*.retro.md` 文件路径。不传路径则按 `$cc-master-retro`
  的默认落盘约定探测（项目根下正式设计文档目录的 `retros/` 子目录,或 `.cc-master-retros/`）,探测到多份
  就列出全部（含各自 `goal`/生成时间摘要）问用户要蒸馏哪几份，不要猜"最新的那份"。路径解析失败清楚
  报错并停，不静默跳过。
- `--asset-type <disc,skill,workflow,subagent>`（可选）：只蒸馏指定归宿类型，默认全部四类都处理。
- `--apply pr|draft`（可选，默认 `pr`）：`pr` 走 feature-branch+PR 收口；`draft` 显式只写变更草稿目录、
  不开 PR。没有 `direct` 选项——四类资产统一走 PR 或降级草稿。
- `--out-branch <name>`（可选）：PR 用的 feature branch 名，不传则自动生成 `distill/<UTC-STAMP>`。

流程：① 读取全部 `<retro-path>` 的候选经验（只读，聚合并标注来源）。② 单 agent 全局探测目标项目结构
（`.git` 定项目根，扫描 skill/subagent/workflow 机制与 `AGENTS.md`/`CLAUDE.md`/`CONTRIBUTING.md`）、
去重合并同落点候选、按 `distilling-lessons-into-assets` 决策树判定归宿并按目标文件分组，产出蒸馏计划。
③ 蒸馏计划一次性呈现给用户审阅（批准全部/部分/要求修改/打回重规划）——**未获批准前不执行任何文件改动**。
④ 用户批准后按目标文件分组 fan-out 执行：先读既有内容套用文风，忠实转录候选内容（**唯一硬约束：不允许
脱离证据字段做泛化/改写**，措辞不够具体就收窄而非泛化），每个目标文件分组落一个独立 commit。⑤ 收口：
git 项目建 feature branch、`gh pr create`（`gh` 不可用则报告 branch 已建好、由用户自行推送）；非 git
项目（或显式 `--apply draft`）写入 `.cc-master-distill-drafts/<UTC-STAMP>/`（`MANIFEST.md` + 每个目标
文件的 `.proposed` 完整内容草稿），不做任何原地改动。

质量硬闸（贯穿全程）：文风一致性（容错）、冲突/重复检测（强制，矛盾候选标"冲突待裁决"不擅自选边）、
证据可追溯性/忠实转录（强制，唯一硬约束）、敏感信息扫描（强制，命中标注"疑似敏感"不自动决定脱敏是否
充分）、端点验收（视目标项目基础设施而定）、人工审阅（最终闸，收尾必须列出可逐条核对的改动清单）。

边界：绝不写用户全局配置；绝不动 cc-master board（不调用任何 `ccm` 写 verb，证据字段只读引用）；被
蒸馏项目无特殊路径（读到目标项目自己的贡献纪律就自然遵守，不写死特殊分支）；不假设目标项目一定是
GitHub 仓库；不做多次调用间的记忆（同一份 retro 跑两次会重新生成蒸馏计划，这是已知限制）。
