---
name: worktree-discipline
description: 'cc-master 仓库自用的 git worktree 隔离纪律——Solo（单任务单 worktree）与 Fan-out（多 worktree 并行）两种操作模式 + 一组防止并行开发污染 main checkout 或彼此的红线。何时用 / Use when：(1) 开始一段需要与 main checkout 隔离的实现工作、动第一次文件编辑之前；(2) 把并行实现 fan-out 到多个 worktree；(3) 决定这场并行怎么收口（各自 feature-branch PR vs HUB 集成分支合并回）；(4) 一次 merge / PR 落地后的清理墙、开下一个 PR 之前；(5) 给一个将在 worktree 内工作的 sub-agent 写派发 prompt；(6) 作为 master orchestrator dogfood 本仓、fan-out 后台 worker 之前先立起隔离拓扑。Triggers: worktree、隔离、fan-out、并行改文件、cd 进哪个树、main 被污染、清理残留 worktree、spoke 该不该 commit。Do NOT use when：把目标切成任务 DAG / 排 wave（那是 slicing-goals-into-dags + master-orchestrator-guide 的 decomposition），worktree 内的 TDD / 测量循环（dev-as-ml-loop / engineering-with-craft），或 PR 创建与 merge 机制（AGENTS.md §11 的 gh 手工流——本仓没有 github-pr skill）。'
---

# cc-master 的 worktree 隔离纪律

> **这是项目自用的 dev skill，不随插件分发。** 它住 `.claude/skills/`（cc-master 自己的贡献者 / dogfood 本仓的 orchestrator 用），不在 `plugin/src/skills/`（那才会 ship 给插件用户）。终端用户装 cc-master 看不到它；它只为「在本仓里安全地并行开发」存在。

worktree 是 cc-master 的并行开发**要么干净地汇成一次集成、要么悄悄污染 main checkout** 的分界点。这个 skill 承载两种操作模式——**Solo**（一个任务、一个 worktree）与 **Fan-out**（多个 worktree 并行推进一场 campaign）——以及一组红线。红线才是重点；模式只是红线适用的地形。

**cc-master 与通用 worktree 教条有一处关键背离，先记住**：cc-master 是 **single-committer**（AGENTS.md §11）——sub-agent / spoke worker 只写文件 + 自证测试绿、**绝不 commit**，由 orchestrator 端点验收后统一分组 commit。这与「你在自己的 worktree 里 commit 是安全的」这条到处流传的说法**相反**。隔离买到的是**并行改文件不互撞**，不是**commit 权**。这条见下面红线 6，是本仓移植这套纪律时最容易被合理化掉的一条。

## 本仓约定（固定，不是选择）

| 约定 | 取值 |
|---|---|
| 位置 | **仓库外的兄弟目录**——本仓惯例 `/data/qiwei/repos/cc-master-wt/<语义名>`（与 checkout 同级），或一个专用外部 worktrees 目录（如 `/data/qiwei/worktrees/cc-master-<名>`）。**绝不放进 repo 树内**（如 `.claude/worktrees/`）——放外部天然不入版本控制、不污染 `git status`，无需 gitignore |
| 命名 | 语义化的 campaign / 任务名（`ddl`、`kimi`、`cursor-auth`）；同一 campaign 的 spoke 共享前缀（`kimi-*`） |
| main checkout | **永远停在 `main`。** feature 分支只活在 worktree 里 |
| 依赖装配 | 只碰 plugin（bash/JS）→ 无需 build / 装依赖，直接编辑。碰 `ccm/`（pnpm/Turborepo TS）→ 在**这棵 worktree 里** `pnpm -C ccm install`（`ccm/**/node_modules` gitignored、**每棵树各一份**，不会从 main 继承） |
| `git stash` | 到处都禁用——worktree 的存在就是让你永远不需要它 |

## 第 0 步 —— 先读清你站在哪

创建任何东西之前，先判断自己的位置：

```bash
git rev-parse --git-dir --git-common-dir   # 两者不同 → 你在一个 linked worktree 里
git branch --show-current
```

三种位置，三种不同的正确动作：

| 你在… | 正确动作 |
|---|---|
| main checkout（两个路径相等） | 为这次工作**创建**一个 worktree；除 gitignored 草稿外绝不在这里编辑 |
| 一个 **HUB** worktree（集成分支） | 这**不是**「已经隔离了、可以直接干」——HUB 是发射台。新的并行工作流作为 spoke **从 HUB 分支** fork 出去 |
| 一个 **spoke** worktree | 干活。绝不在里面再嵌套一个 worktree |

通用规则「已经在 worktree 里 → 跳过创建」在 **fan-out campaign 里是错的**：它把 HUB 读成了终点，而 HUB 是轮子的轴心。位置决定拓扑；拓扑来自计划。

## 模式 A —— Solo

一个边界清晰的任务，一个 worktree：

```bash
git worktree add /data/qiwei/repos/cc-master-wt/<名> -b <分支名>
cd /data/qiwei/repos/cc-master-wt/<名>       # 之后所有路径都是「这棵树」的
pnpm -C ccm install                          # 只有会碰 ccm 时才需要（每棵树自己的 node_modules）
```

基线：动手改之前，在这棵 worktree 里先跑一次干净基线（碰 ccm → `pnpm -C ccm typecheck && pnpm -C ccm lint && pnpm -C ccm test`；碰 plugin → `bash run-tests.sh`），把输出留档，这样新引入的失败才能和继承下来的区分开。纯文档改动可跳过。之后直到收口，都由下面的红线管着。

## 模式 B —— Fan-out（多 worktree 并行）

本仓并行 campaign 的招牌拓扑。**前置：一份切好 wave 结构的计划**（怎么切 → slicing-goals-into-dags；怎么排 wave / 算临界路径 → master-orchestrator-guide 的 decomposition）。没有 wave 计划的 fan-out 是盲飞——拓扑镜像计划，绝不即兴发挥。

**两种拓扑，按 spoke 之间的耦合选**：

- **独立 feature-branch worktree（本仓默认）**——各 spoke 一棵 worktree、各在自己的 feature 分支上、各自从 `main` 切出、各自成一个 PR。spoke 之间**真正独立、可单独 review** 时用这个（也是本仓 `git worktree list` 里最常见的形态）。tracking 靠 board，不靠 git 集成分支。
- **HUB 集成分支（spoke 共享地基时才用）**——一棵 HUB worktree 在从 `main` 切出的 campaign 分支上；spoke 分支**从 HUB 分支切、绝不从 `main` 切**（从 `main` 切的 spoke 对已合并回 HUB 的每个 sibling 都失明）。spoke 名共享 campaign 前缀。

**Fan-out 生命周期（无论哪种拓扑，所有 commit 与 merge 都归 orchestrator——见红线 6）**：

1. **立地基** —— 建 HUB（或第一棵 worktree），把计划要求的共享脚手架作为 setup commit 落地（**orchestrator 亲手 commit**）。
2. **Pilot spoke** —— 先让**一个** spoke 走完整流程（工作 → orchestrator 端点验收 → orchestrator commit → 集成校验）。pilot 是拿计划当模板前的验证。它干净落地后，才 scale out。
3. **并行 spoke** —— 每个 spoke 都是一个完整的模式 A 公民：自己的 worktree、自己的路径、自己的基线、（碰 ccm 时）自己的 `node_modules`。派发给 spoke worker 的 prompt 必须以**指向该 spoke worktree 的绝对路径**开头 + 一步分支核对（派发 prompt 写法见 dispatch.md；被派发 agent 之前把工作写进过 `main`）。**spoke worker 只写 + 自证 + 报告，绝不 commit。**
4. **收割与集成** —— 每个 spoke 完成（或到 wave barrier）后：orchestrator 在该 worktree 就地**端点验收**（亲跑全套门，不信 worker 自报），验收绿后**由 orchestrator 分组 commit**（每任务一 commit、只 stage 该任务真正碰过的文件、绝不 `git add -A` 盲提·AGENTS.md §11）。HUB 拓扑下再 merge 回 HUB、**每次 merge-back 后立即跑一次集成级校验**（不是攒到最后一次）；然后立即退役这棵 spoke（`git worktree remove --force` + `git branch -d`），完成的 spoke 绝不囤积。
5. **收口** —— 所有 wave 合并、最终校验绿后，走 `gh` CLI 手工流收口（feature branch → PR → squash merge，PR 到 main 等人 review；机制见 AGENTS.md §11，本仓**没有** github-pr skill）。两种形状：spoke 共享地基 / 只有一起才成立 → 一个从 HUB 出的合并 PR；spoke 真正独立可分别 review → 各 spoke 各自 PR。

命令级 walkthrough：[fanout-playbook.md](references/fanout-playbook.md)。

## 红线

每一条都是法律，因为每一条都曾被打破过、代价是真实返工。

1. **Write/Edit 只用 worktree 的绝对路径。** 从一个 worktree session 里用 main checkout 的路径写文件，会把文件写进 main 工作树。创建任何文件后，**在这棵 worktree 里**跑一次 `git status` 确认它落在哪。（与 dispatch.md「用绝对路径指向工作目标、绝不靠继承 cwd」同源。）
2. **测试 / 校验从这棵 worktree 自己的树跑。** `bash run-tests.sh` / `pnpm -C ccm ...` 必须在**这棵 worktree 里**（或用 `git -C <worktree>` / 显式绝对路径）跑；跑到 main checkout 的（陈旧）源上会产出**假绿**、掩盖真实失败。碰 ccm 时这棵树要有自己的 `pnpm -C ccm install`（`node_modules` gitignored、不从 main 继承，缺了会解析到过时依赖）。
3. **main checkout 永不离开 `main`。** 主路径里绝不 `git checkout <分支>`；分支在 worktree 里生、在 worktree 里死。
4. **被派发的 agent 先证明位置再动手，派发者事后独立核验落点。** worker 第一个动作：`cd <worktree>`（或全程 `git -C`）+ `git branch --show-current` 核对分支。worker 报告后，派发者（orchestrator）**独立**核验**文件确实落在这棵 worktree、且没溢进 main**（`git -C <worktree> status --short` 有预期改动、`git -C <main> status --short` 干净），**之后才由 orchestrator 提交**。worker 之前把改动写进过 `main`。
5. **merge / PR 后的清理是一堵墙，不是建议。** 任何 PR merge 后：更新本地 `main`、移除 worktree、删分支——彻底做完，才开始下一个 PR 的活。Fan-out 里 spoke 清理发生在收割即退役（生命周期第 4 步）；只有在飞的 wave 和用户指定保留的分支能存活。
6. **spoke worker 绝不 commit——commit 是 orchestrator 独占的（single-committer，本仓与通用 worktree 教条背离处）。** 见下节，本仓最容易被合理化掉的一条。
7. **长命草稿放 main checkout，不放 worktree。** worktree 里的 gitignored 文件没有 git 保护——`worktree remove` 会把它们蒸发。backlog、设计笔记、任何比分支活得久的东西，放 main checkout 的 `design_docs/plans/`（本仓的 gitignored 草稿区）。
8. **禁用 `git stash`。** 值得保存的状态是 worktree 分支上的一个 commit；不值得一个 commit 的状态不值得保存。

## 红线 6 详解 —— single-committer：spoke 也绝不自己 commit

通用 worktree 教条会告诉你：每棵 worktree 有自己的 index，并行 `git commit` 不会互相竞争，所以「完成的 spoke worker 在自己的树里 commit 是安全标准做法」。**在 cc-master，这条不成立。** 本仓是 single-committer（AGENTS.md §11）：

- **sub-agent / spoke worker 只写文件 + 自证测试绿 + 报告**，把 commit 决定权完全交回 orchestrator。
- **只有 orchestrator commit**，且在**端点验收之后**（亲跑全套门，不信 leaf 自报的绿）、**分组 commit**（每任务一个独立可回滚 commit、只 stage 该任务碰过的文件、绝不 `git add -A`）。
- 隔离（每棵 worktree 独立）买到的是**并行改文件互不冲突 + 假绿隔离**，**不是 commit 授权**。「我在自己的树里、不会 race」是真的，但 race-safety **不是** cc-master 让 spoke commit 的理由——single-committer 要的是「未经端点验收的产物不进 commit 历史」+「一个 agent 只在验收过后、由同一只手统一记账」，这与 race 无关。

> **为什么值得单列**：这是移植时最容易被「我在自己 worktree 里、commit 安全」这句话绕过去的一条。它听起来技术上没错（race 确实不会发生），但它答的是错的问题。

### Rationalization Table（借口 → 现实）

| 借口 | 现实 |
|------|------|
| 「每棵 worktree 有独立 index，并行 commit 不会 race，所以我在自己树里 commit 是安全的。」 | race-safety 为真，但答错了问题。single-committer 防的不是 race，是「未经端点验收的产物进 commit 历史」+「多只手各自记账」。你在自己的树里也一样绝不 commit。 |
| 「部署窗口要关了、用户在等，来不及回合 orchestrator，我先 commit 锁住成果。」 | 时间压力不解锁 commit 权。你的成果已经在 worktree 的工作树里落盘了——写文件 + 报告「文件在 `<worktree>`、测试绿」就已经把它交出去了，orchestrator 收割即验即 commit，不比你自己 commit 慢，且经过了端点验收。 |
| 「我已经花了 3 小时、测试都绿了，不 commit 感觉这些活白干 / 会丢。」 | 沉没成本 + 怕丢不是理由。文件在磁盘上的 worktree 里不会丢（不是 stash、不是内存态）；报告里点明落点，orchestrator 就能接。真怕丢，报告写清「未提交改动在 `<worktree>` 的这几个文件」。 |
| 「通用 worktree 纪律 / 别的项目都让完成的 spoke 在自己树里 commit，这是标准做法。」 | 那是别的项目的口径。cc-master 明确背离它（AGENTS.md §11）——移植这套纪律时，spoke-commits-safe 这一条被有意替换成 single-committer。用本仓口径，不用外仓口径。 |
| 「orchestrator 反正要 merge，我先 commit 帮它省一步。」 | 你没帮它省步，你剥夺了端点验收：orchestrator 的 commit 发生在它亲跑全套门**之后**，你的 commit 跳过了这道验收。真想帮忙，报告写清改了什么、门跑了什么结果。 |

### Red Flags —— STOP，你正要越 single-committer 的界

- 你在一棵 spoke worktree 里，正打算 `git commit`（或 `git add`），理由是「我在自己的树里/不会 race/来不及回合」。
- 你论证「*这次*时间紧 / 沉没成本高 / 通用做法允许，所以 single-committer 这次不适用」——这套论证本身就是症状。
- 你作为 spoke worker 准备 push / 开 PR / merge——这些全是 orchestrator 的活。

**违背字面就是违背精神。** 「我守的是不丢工作的精神，不是不 commit 的字面」是绕过这条红线的那句合理化。工作不会因为你不 commit 而丢——它在 worktree 的磁盘上、在你的报告里。

## 在 Orchestrator 模式下

master orchestrator **直接**应用这个 skill：立 HUB / 建 spoke、收割、端点验收、分组 commit、merge-back、清理墙——这些都是集成工作，是**指挥**，不是**演奏**（红线「指挥不演奏」的落点）。orchestrator 独占的：所有 commit（single-committer）、所有触碰 `main` 的操作、集成校验、以及任何 push / PR / merge。spoke worker 独占的只有：在自己 worktree 里**写文件 + 自证 + 报告**。

## 原生隔离工具 vs 显式 worktree

cc-master 的 harness 提供原生隔离原语——`Agent` 工具的 `isolation: "worktree"` 与 `EnterWorktree`。**ad-hoc 单 agent 隔离优先用原生工具**（harness 自己管 worktree 生命周期、约 200–500 ms + 占磁盘，用完即弃）：并行 agent 会改到同一批文件、可能冲突时用它。**模式 B 的具名 HUB 拓扑是有意的、留在显式 `git worktree` 控制下**——因为它要跨多个 spoke / wave 长期存活、要人可 `git worktree list` 审计、要精确控制 fork-from-HUB 与 merge-back 时机，这些原生 `isolation: "worktree"` 的一次性隔离给不了。

## 边界与近邻

- **slicing-goals-into-dags** —— 把目标切成 board DAG（模式 B 前置的 wave 结构从这里来）。本 skill 执行拓扑，不切分。
- **master-orchestrator-guide**（`references/decomposition.md`）—— 一张已切好的 DAG 怎么排 wave / 算临界路径；`references/dispatch.md` —— 派发 prompt 写法（红线 4 的绝对路径纪律与它同源）。本 skill 只管隔离拓扑本身。
- **dev-as-ml-loop / engineering-with-craft** —— worktree 内跑的 TDD / 测量 / 工程手艺循环（红线 2 是本 skill 与它们相遇的点）。本 skill 不碰循环内容。
- **AGENTS.md §11** —— PR / commit / 收口机制（gh 手工流、single-committer、commit 卫生）。本 skill 只决定收口的**形状**（一个合并 PR vs 各自 PR），机制归 §11。**本仓没有 github-pr skill**（历史占位、实物不存在，别去找）。
