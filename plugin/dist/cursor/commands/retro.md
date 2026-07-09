---
name: retro
description: '读一块 cc-master board（进行中或已归档均可）的 goal / log / judgment_calls / 任务终态，产出一份面向未来同类编排 orchestrator 的复盘文档——落在被编排项目内，绝不写 board、绝不碰 GitHub。'
argument-hint: '[--home <path>] [--board <board-stem>] [--out <dir>]'
---

给一场 cc-master orchestration 做一次**只读**的复盘：把它的 `goal` / `log` / `judgment_calls` / 任务终态提炼成一份**面向未来同类任务的 orchestrator**的经验文档,落到**被编排项目内**（不是 cc-master home,也不是这场编排自己的 board）。你可以对**进行中**或**已归档**的 board 跑这条命令——两种情况都成立,别以为只有归档后才能复盘。

**这不是 `/handoff-to-new-session`。** handoff 写给"接手这场编排的下一个 session",纯叙事、指向 board、会归档 board。你现在做的复盘写给"未来做类似任务的 orchestrator",要把 log/jc/任务终态提炼成可迁移的经验、不归档、不改变 board 任何状态。两者可以先后都跑,但产物绝不合并。

参数整串由 **`$ARGUMENTS`** 传入,形如 `[--home <path>] [--board <board-stem>] [--out <dir>]`,三个都可选。先解析：

- **`--home <path>`**——本次 cc-master home,**quote-aware**：若 `--home` 后紧跟一个引号（单引号 `'` 或双引号 `"`）,取到**配对的同种引号为止**的整串（含其间所有空格）作为 path,再剥掉外层那对引号；不跟引号则取下一个空白分隔 token。例：`--home '/Users/me/My Project/.cc-master'` → home = `/Users/me/My Project/.cc-master`。缺省解析链：`--home` → `$CC_MASTER_HOME` → `$HOME/.cc_master`。
- **`--board <board-stem>`**——显式 board 选择器,`<board-stem>` = board 文件名去掉 `.board.json` 后缀。**先过 path-safe guard**：必须匹配 `^[A-Za-z0-9._-]+$`,且不是 `.` 也不是 `..`——不满足就清楚报错并停,绝不用不安全 stem 拼路径逃出 home。
- **`--out <dir>`**——覆盖复盘文档的落盘目录（见下）。相对路径相对**项目根**解析（下面第 3 步定义项目根）。**给了 `--out` 就直接用它、不做任何存在性探测**——哪怕目录本不存在,创建即可（`mkdir -p` 语义）。

## 1. 认板（这一步是本命令与 `ccm status-report show` / `/cc-master-stop` 的关键差异：接受已归档 board）

复盘价值最大的时刻往往就是编排刚收尾之后,所以这一步**必须**能对一块 `owner.active:false`（已被 `/cc-master-stop` 或 `/handoff-to-new-session` 归档）的 board 生成复盘。按下面顺序定位一块**确定的**目标 board：

1. **带 `--board <stem>`**——过 path-safe guard 后直接在 `<home>/boards/` 里定位 `<stem>.board.json`（active 或已归档都接受）。找不到就清楚报错并停。
2. **未带 `--board`,且恰好一块 `owner.active:true`**——用它（编排进行中调用的常见形态）。
3. **未带 `--board`,且没有任何 active board**（编排已收尾后调用的常见形态）——列出 `<home>/boards/` 下按文件名时间戳**倒序**的最近若干块 board（含已归档）,把每块的 `goal` 摘要一并列出,**问用户要复盘哪一块**；不要自动挑"最新的那块"去猜——多个编排共享同一 home 时猜错的代价是复盘错内容。
4. **未带 `--board`,且有多块 active**——按 `goal` 与当前对话上下文匹配；仍无法无歧义确定,同上列出候选让用户选。

拿到目标 board 的确切路径后（下文称 `<board-path>`,其文件名去掉 `.board.json` 后缀记作 `<board-stem>`）,才进入第 2 步。**不写任何 board 字段、不追加任何 log——这一步和下面每一步都只读。**

## 2. 只读取数

对 `<board-path>` 依次跑（都是 ccm 只读命令,`--board <board-path>` 是全局 flag,不需要板处于 active 才能读；每条命令的完整 flag/输出形状见 `skills/using-ccm/references/command-catalog.md` 的 `board show` / `log list` / `jc list` / `task list` / `task show` / `jc show` 各节）：

- `ccm board show --board "<board-path>" --json`——拿 `goal` / `statusCounts` / `lint`。
- 直接读 `<board-path>` 这份 board JSON 本身（board-home 内的数据,只读、不改写）,取 `git`（`branch` / `worktree`）与 `scheduling`（`wip_limit` / `owner_wip_limit`,若有）——这两项 `ccm board show --json` 的摘要形状目前不返回,故直接读原始字段。
- `ccm log list --board "<board-path>" --json`——完整 `log` 时间线,每条含 `kind` / `summary` / `detail` / `task` / `ts`。
- `ccm jc list --board "<board-path>" --json`——每条 judgment call 的 `id` / `status`（`pending_review` / `upheld` / `overturned`）/ `severity` / `category` / `summary`；对你要在文档里细讲的那几条,再跑 `ccm jc show <id> --board "<board-path>" --json` 拿 `decision` / `rationale` / `impact` 等完整字段。
- `ccm task list --board "<board-path>" --json`——拿到全部任务 id + 摘要 status,然后对每个 id 跑 `ccm task show <id> --board "<board-path>" --json` 取该任务的**实际存在字段**（`status` / `deps` / `artifact`（若有）/ `model`（若有）/ `blocked_on`（若有残留）等——`task show` 是稀疏返回,只含已设字段）。
- 在 `<home>/boards/` 里查找与这块 board 关联的 sidecar 文档：文件名前缀为 `<board-stem>--` 的 `*.decision.md`（`/discuss` 产物）,以及内容里 `Board:` 一行指向这块 board 路径/文件名的 `*.handoff.md`（`/handoff-to-new-session` 产物,按时间戳做best-effort关联）。**只读引用它们的路径与一两句摘要,不整篇复制进复盘文档。**

**不读、不碰**：GitHub API / issue 状态,或任何非 board-home 的外部数据源。

## 3. 定落盘位置

- **项目根**：从当前工作目录起向上找到第一个 `.git` 所在层。找不到 `.git`（非仓库目录）就退化用当前工作目录本身作为项目根,并在收尾话术里提醒用户"这不是一个 git 仓库"。
- **默认目录**（未传 `--out` 时）：
  - 若项目根下**已存在** `design_docs/` 目录——落到 `<项目根>/design_docs/retros/`。
  - 若项目根下**没有** `design_docs/`——不强行新建这个约定,退到 `<项目根>/.cc-master-retros/`。
  - 两级默认都可被 `--out <dir>` 显式覆盖（覆盖时不做任何存在性探测,直接用给的目录）。
- **文件名**：`<UTC-STAMP>--<board-stem>.retro.md`,`<UTC-STAMP>` = 生成时刻的真实 UTC 时间,写成紧凑形式 `YYYYMMDDTHHMMSSZ`（无 `:`、path-safe、字典序即时间序）。
- 目标目录不存在就创建（`mkdir -p` 语义）。

## 4. 写复盘文档

frontmatter：

```yaml
---
board: <board-stem>
goal: <board.goal 原文,截断展示可选>
generated_at: <ISO-UTC>
status_counts: { done: N, in_flight: N, blocked: N, ready: N, ... }
---
```

正文按下面七节写,**每节标题固定**（哪怕内容为空也保留标题,方便未来 orchestrator 或工具按标题定位）：

1. **TL;DR**——三五句话：这场编排做成了什么、花了多大代价、最值得未来同类任务借鉴的一条是什么。
2. **发生了什么**——按 `log` 时间线整理出的叙事主干（阶段划分、关键分支决策指向哪份 `*.decision.md`）,不是逐条照抄 log,而是提炼成有因果的故事。
3. **调度与估算质量**——WIP 峰值 vs `scheduling.wip_limit`、关键路径实际耗时 vs 若有 `estimate` 字段的对比、log 里是否出现过 `usage advise` 的 throttle/switch/stop 类 verdict 记录、是否有 hedge/重派的实例。
4. **HITL 成本**——`blocked_on:"user"` 出现次数、关联的 `*.decision.md` 数量与 `ask_type` 分布、`judgment_calls` 里 `overturned` 的比例。
5. **验证过的机制**——哪些手法/工具用法被证明有效。
6. **踩的坑**——哪些环节返工、被 `overturned`、或耗时明显超出预期,及可归因的原因（若能从 log/jc 追溯）。
7. **候选经验**——把上面浮现的、值得沉淀成持久资产的点,逐条按下面的半结构化格式列出（这是给未来"把候选经验落成项目资产"的后续工作用的输入,本次你只如实生成候选清单,不做去重/合并/质量打分）：

```markdown
### 候选经验 N：<一句话概括>

- **建议归宿类型**：纪律文档 | skill | workflow | subagent
- **建议落点**：<尽力给出具体路径/名字；拿不准就写"待后续判断">
- **证据**：<board task id / log 条目摘要 / jc id,指向可复核的原始依据>
- **候选内容草稿**：<这条经验本身该怎么措辞>
```

## 5. 边界（绝不做的事）

- **绝不写 board**——不调用任何 `ccm ... update / add / set-* / archive / unblock` 等写 verb,不追加 `log`,不动 `owner` / `policy` / 任何字段。
- **绝不碰 GitHub**——不读写 issue / PR 状态、不留评论。
- **绝不写用户全局配置**（`~/.claude`、cc-master home 之外的任何用户级配置）。
- **绝不自动追加目标项目自己的"经验台账"类文件**（哪怕目标项目已有这样一份文件、哪怕候选经验里有一条明显该进去）——只在复盘文档的「候选经验」小节建议,不代它动手改。
- **不假设目标项目有任何特定 CI/PR 流程**——只落一个 markdown 文件,不开 PR、不跑 `gh`。

## 6. 收尾

写完后告诉用户：复盘文档的完整路径、七节是否都有实质内容（哪几节因证据不足留白）、候选经验条数。提醒用户 board 文件本身**零改动**——这是只读复盘的证据,不放心可以自己 `git diff` 或 diff board 文件核对。
