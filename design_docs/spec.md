# `cc-master` —— Master Orchestrator Plugin 设计 Spec

**日期**：2026-06-05
**状态**：设计定稿（待用户复审 → writing-plans）
**性质**：通用、ship-anywhere 的 Claude Code **plugin**（装到任意环境的任意 cc agent 即可用）。
**研究基线**：`research/dynamic-workflow/`（4 报告，commit 9047592d）。
**对话史/草稿**：`docs/plans/cc-master-plugin-design.md`（本 spec 是它的干净定稿版）。
**2026-06-08 修订（最终态）**：completion gate 由 **goal-hook** 承担——`verify-board.sh` 升级为确定性 Stop-hook 自检闸；`/loop` 由后台 shell 消解。（原"原生 `/goal` 整合"路线已废弃：agent 无法自设 native `/goal`。）本 spec 的 §3/§5/§10/§12 均为修订后的最终方案。决策史见 [`adrs/ADR-004-loop-dissolution-and-goal-hook.md`](../adrs/ADR-004-loop-dissolution-and-goal-hook.md)，设计细节见 `design_docs/2026-06-08-goal-hook-design.md`。

**2026-06-24 修订（board 引擎解耦）**：board 状态逻辑（数据模型 / lint / 图分析 / 锁）已从「插件内 bash hook 直接读写」演进为**独立安装的 `ccm` CLI**（board 引擎 SSOT 归 `@ccm/engine`）；cc-master plugin 降为消费方之一——hook 经**进程边界** `spawn ccm` 访问 board（缺则优雅降级、静默不 block），webview 与 skill 脚本同走 `ccm`。下文 §3/§5 的「hook 直接读 board / 每回合 Write 整文件」是**契约级**心智（板仍是单一真相源、narrow waist 不变），但**访问形态**以 ADR-013/ADR-014 为准：board v2 三档建模（🔒/👁/✎）见 [`adrs/ADR-013-board-v2-data-model-and-cli.md`](../adrs/ADR-013-board-v2-data-model-and-cli.md)；CLI 解耦为独立产品 + ship-anywhere 改由「主机预置 per-OS SEA + 进程边界」守见 [`adrs/ADR-014-cli-decoupling-as-independent-product.md`](../adrs/ADR-014-cli-decoupling-as-independent-product.md)。

---

## 1. 目标

一个 Claude Code plugin，用一条 slash command 把任意 main-session agent 一键初始化成 **master orchestrator**，服务 long-horizon（通常 >24h）任务。

### 1.0 产品愿景 / 北极星（charter —— 本仓单一真相源）

> **本节是 cc-master 产品愿景的单一真相源（SSOT）。** README / AGENTS.md 里的愿景表述都是本节的紧凑摘要 + 回指，不另起一份。**这是北极星，不是验收单**——下列六条是 cc-master **致力于让 agent 具备**的能力目标（aspirational charter），用以持续指导迭代方向；其中哪些已落地、哪些仍是 design-only，由「愿景 vs 现状」gap 审计单独度量，**别把目标当既成事实**。

cc-master 给 Claude Code agent 提供一套 plugin，**旨在让它能够化身为一个 master orchestrator**，致力于具备以下六项能力：

1. **异步并行多线程推进、实现目标完整落地**——把目标拆成依赖图、并行派发后台工作，全程异步地把每条路径推到目标真正完整落地，而非半途。
2. **控制资源（token 用量）消耗的速度**——懂得按配额窗口（如 5h / 7d）感知并调控 token 的燃烧速率，不盲目顶满。
3. **把握好自主决策与寻求人类用户接入的边界**——懂得哪些该自己拍板、哪些必须 surface 给人类用户拍板（难撤销 / 对外可见 / 方向抉择 / 终审），在自主与 HITL 之间守住边界。
4. **目标的分解、管理、更新、规划**——懂得把目标拆解成可执行单元、持续管理与更新这张计划、在过程中重规划。
5. **在资源消耗速度合理的前提下最大化实施效率的调度编排**——懂得在 token 燃烧速率可控的约束下，把并行与调度编排到实施效率最大化。
6. **根据复杂性 / 难度 / 所需时长选择合适的模型**——懂得按一件事的复杂度、难度、预计执行时长，为每个节点选用恰当档位的模型。

> 这六条是**目标**；今天的实现可能只部分兑现其中几条。愿景文档记录方向，审计度量差距——切勿据本节声称「cc-master 已做到全部六条」。
>
> **gap 审计 SSOT → [`design_docs/vision-landing-tracker.md`](vision-landing-tracker.md)**：六条愿景在当前实现里的落地真实性（🟢真落地/🟡半落地/🔴design-only/⚫缺失）+ adversarial 断点 + 真 gap vs 设计意图，持续追踪。本节说目标，那份量差距。

### 1.1 两大能力（落地视角）

落到当前实现，charter 主要由两大能力承载：

1. **会写**：按目标选对范式、写出真正稳定 / 高效 / 高并行的 dynamic-workflow 脚本。
2. **会推进**：long-horizon 里综合用 **background shell + sub-agent + workflow** 三种后台手段 + 前台 HITL，分派后台任务后用等待空档**主观能动**地做事而非空转，全程异步——并熬过反复的 context compaction 与跨会话。

**核心洞察（来自研究）**："主线程不空等"在 Claude Code 生态里是**空白**——官方只承诺 session "responsive"（不被阻塞），不承诺 orchestrator "productive"（自驱找活）；且 control-flow inversion 范式结构性地把主 agent 设计成 idle 收尾。本 plugin 自建这套机制来填空白。

---

## 2. 架构总览

plugin `cc-master` = **命令 + skills + hooks + board 文件**（外加 ADR-014 解耦出的独立 `ccm` 引擎）。

> **裸计数以现状为准**：本 spec 是 2026-06-05 设计快照，下文 §2/§4/§5/§14 的「2 skills / Commands 3 条 / Hooks 3 个 / 两个 skill」是当时的形态数；**当前实际数与正式入口以 [`AGENTS.md`](../AGENTS.md) §2 与 [`design_docs/feature-manual.md`](feature-manual.md) 为准**（feature-manual 是功能点 SSOT）。本 spec 不逐版追计数，保留快照性质。2026-07-08 补注：旧 `/cc-master:status` 已被 [ADR-030](../adrs/ADR-030-ccm-status-report-and-viewer-module.md) 迁移为目标态 `ccm status-report show`，本文出现的 slash status 属历史快照。

```
cc-master/ (plugin)
├── .claude-plugin/plugin.json
├── commands/
│   ├── as-master-orchestrator.md     主引导（bootstrap）
│   ├── status.md                     汇总 board 进度/健康
│   └── stop.md                       归档/置 board 非活跃
├── skills/
│   ├── master-orchestrator-guide/  Skill A：编排方法论（魂在这）
│   │   ├── SKILL.md
│   │   └── references/{decomposition,dispatch,board,async-hitl,resume-verify}.md
│   └── authoring-workflows/          Skill B：写法 + 机制摊明
│       ├── SKILL.md
│       ├── references/{mechanism,patterns,api-reference}.md
│       └── assets/{templates,examples}/      起手脚手架 + 完整可跑范例
└── hooks/
    ├── hooks.json
    └── scripts/{bootstrap-board,verify-board,reinject}.sh
                                       （board 文件落在可配置 home 里——`$CC_MASTER_HOME`，
                                        否则 `<project>/.claude/cc-master/`——非 plugin 内）
```

**三件套的寿命分工**：
- **command** = 一次性开机引导（你主动触发，把"我是 master orchestrator"的哲学 + 操作纪律灌进 context，开好 board）。
- **skill** = 按需调阅的深度手册（写 workflow 时翻 Skill B，跑编排循环时翻 Skill A）。
- **hook** = 跨 compaction 的"记忆续命"（压缩后/收到通知时自动把"你是 orchestrator + board 摘要"重注，让角色与待办不因健忘失守）。

**生命周期**：
```
/cc-master:as-master-orchestrator <目标>
   └─[UserPromptSubmit hook 在 home 里确定性建一个唯一命名的 board 空壳 + 注入其确切路径]
   └─ agent 认领这块 board、填 DAG → 进入编排循环（决策程序）
        ├─ 派 shell / sub-agent / workflow（受 WIP+预算约束，记 board）
        ├─ 等待窗口主观能动：look-ahead / verify / 文档 / 沉淀 / HITL
        └─ 每回合收尾 flush board
   └─[24h 内反复 compaction]→ SessionStart hook 扫 home，重注角色 + home 路径 + 活跃 board 清单 → agent 凭 goal 认回自己的 board → 无缝续
   └─[Stop hook] 过早收尾 / board 未建 → 校验/兜底
   └─ ccm status-report show 看进度 · /cc-master:stop 收尾归档（置 owner.active:false）
```

---

## 3. Board（编排的持久存档）

**本质**：orchestrator 给一个长任务存的"存档文件"——一张带状态的**任务依赖图**。它同时是 ① 扛 compaction 的记忆，② hook 唯一能读到的编排状态窗口（hook 是 shell，读不到 agent context、也读不到内建 Task 工具）。

**关键决策**：
- **名**：board。**单一真理源**。**可配置 home + 每编排一个唯一命名 board 文件**：home = `$CC_MASTER_HOME`，否则 `${CLAUDE_PROJECT_DIR:-$(pwd)}/.claude/cc-master/`（位置是用户存储偏好，不再硬编码）；每次 `as-master-orchestrator` 在 home 下建 `<UTC时间戳>-<pid>.board.json`（如 `20260605T101821Z-54324.board.json`），可按时间排序、多个并发编排各得独立文件不冲突。bootstrap hook 建文件并把确切路径注入 agent。**agent 自己认领哪块 board 是它的**——compaction 后靠列 home + 匹配 `goal` 重新认回。gitignored。
- **存储 = 可变快照（每编排一个命名 board 文件）**：每回合 Write 整文件（窄腰小→改不崩）；markdown 视图按需生成。（**ADR-014 后**：校验这次写盘合不合契约的机械关卡是独立 `ccm` CLI——PostToolUse lint hook 经进程边界 `spawn ccm board lint`，缺 `ccm` 则静默降级；契约本身不变。）
- **窄腰原则**（不钉死整表，只钉死 hook 依赖的极小契约 → 既给 agent 自由，又让手维护安全）：
  - **钉死的腰**（**扁平顶层字段，非 `header{}` 子对象**——对齐 board 文件实际布局，别让 agent 凭空造个 `header` key）：顶层 `schema` / `goal` / `owner-lease{active, session_id, heartbeat}` / `git{worktree, branch}` + `tasks[{ id, status, deps }]`。
  - **status 枚举**：`ready / in_flight / blocked(blocked_on:"user"|"<taskid>") / done / escalated / failed / stale / uncertain`（各状态在 DAG 里路由不同）。
  - **依赖满足合约**：是否进入 `ready` 以 `@ccm/engine` 的 `dependencySatisfied` 为 SSOT，不等价于“所有上游 status 都是 done”。普通/旧 task 以 `status=done` 满足；显式 review gate 必须同时有当前 attempt 的精确 `review_verdict=APPROVE`，缺失、空、null 或 `REQUEST-CHANGES` 一律 fail closed。
  - **attempt 重跑合约**：`stale|failed|escalated → ready` 会先把来源 status 及旧 `started_at` / `finished_at` / `artifact` / `verified` / `review_verdict` 归档进 append-only log（detail schema=`ccm/task-retry/v1`），再清除 current-attempt evidence；旧批准只留审计、不参与新 attempt 的依赖门控。完整字段与状态机 SSOT 见 [`2026-06-23-board-v2-spec.md` §6.1](2026-06-23-board-v2-spec.md#61-retry--reactivation-合约)。
  - **柔性边**（agent 自由塑形，hook 忽略）：`title / artifact / dispatched_at / mechanism / handle / kind / justification / output_schema / dep_pins / notes / log`；**（2026-06-08 增补）`phase` 段**——记当前自驱区段，`{ "current": "<阶段名>", "goal_condition": "<阶段 /goal 条件原文>", "task_ids": [...] }`，供 reinject 跨 compaction 带出、agent 认回阶段并自核 `/goal` 是否还挂着。
- **内建 Task\* 工具**：顶多 in-session 草稿镜像，**非权威**；home 里的 board 文件才是断电/关机/hook 都认的存档。
- **复盘/审计**：靠柔性边的轻量 `log` 段承载（不上完整事件溯源——YAGNI）。
- **supersession** 是显式 board 状态（节点被 re-altitude/上游变更替换时），非隐式 GC。

**board 文件示例**（home 里众多 board 之一，文件名形如 `<UTC时间戳>-<pid>.board.json`；`owner.active:true` 即"活跃"）：
```json
{
  "schema": "cc-master/v1",
  "goal": "把 web app 国际化到 6 个 locale——搭 i18n 框架、抽取所有硬编码字符串、逐 locale 翻译、上线 locale 路由",
  "owner": { "active": true, "session_id": "abc123", "heartbeat": "2026-06-05T12:30Z" },
  "git": { "worktree": "/.../.claude/worktrees/i18n", "branch": "feat/i18n-rollout" },
  "wip_limit": 4,
  "tasks": [
    { "id":"T0","status":"done","deps":[],"artifact":"commit a1b2c3","verified":true },
    { "id":"T1","status":"in_flight","deps":["T0"],"mechanism":"sub-agent","handle":"bg-7a","dispatched_at":"12:18Z" },
    { "id":"T3","status":"ready","deps":["T0"] },
    { "id":"T9","status":"blocked","deps":["T1","…","T8"],"blocked_on":"T1" },
    { "id":"D1","status":"blocked","blocked_on":"user","title":"PR 要不要拆成两个？" },
    { "id":"F1","status":"ready","kind":"fill-work","justification":"produces-reusable-artifact","title":"预起草 PR 描述骨架" }
  ],
  "log": []
}
```

---

## 4. Commands（3 条）

> 计数为 2026-06-05 快照；**现状 6 条 slash command（+ `ccm account` CLI）以 AGENTS.md / feature-manual §5 为准**（见 §2 注）。

| 命令 | 作用 |
|---|---|
| `/cc-master:as-master-orchestrator [目标]` | **bootstrap**：开机引导。命令体埋一个稳定 **sentinel**（供 hook grep 检测）+ 指示 agent 把目标分解成依赖 DAG 填进已被 hook 建好的 board，并唤起 Skill A 进入编排循环。 |
| `/cc-master:status` | **历史快照入口**：当时用于渲染 board 摘要。目标态已由 ADR-030 迁到 `ccm status-report show`；slash command 只允许 deprecated shim 或删除。 |
| `/cc-master:stop` | 把 board 置 `active:false`（归档），收尾。**不靠删文件**（删文件会丢审计）。 |

---

## 5. Hooks（3 个，门控激活）

> 计数为 2026-06-05 快照；**现状 7 个 hook 入口（武装闸 board-derived·ADR-007，board 引擎已解耦至 `ccm`·ADR-014）以 AGENTS.md / feature-manual §3 为准**（见 §2 注）。下文「Stop 唯一硬 block / SessionStart 重注」契约级心智仍成立。

plugin hooks 装上即常驻、无原生"命令后才激活"开关 → 靠**门控**收敛激活。三个 hook **都只操作 home，扫描其中的活跃 board，绝不绑定某个具体 session/board**：**Stop / SessionStart 自门控于"home 里有没有活跃 board"**（扫 home，无任何 `owner.active:true` 的 board 则 `exit 0` 静默 no-op；有才动作）；**UserPromptSubmit 不门控于活跃 board**（它正是那个*激活器*）——改门控于命令体 sentinel（命中才动作）。

| hook | 作用 |
|---|---|
| **UserPromptSubmit** | grep 命令体的 sentinel → 命中则**在 home 里确定性建一个唯一命名的 board 空骨架** + 把其确切路径 + orchestrator 角色注入 context（"这是你的 board，请填 DAG"）→ `exit 0`（不 block）。它不门控于活跃 board——它正是激活器。【bootstrap 保证 Layer 1】 |
| **Stop** | 扫 home；**仅当**有活跃 board（`owner.active:true`）且零任务时 → `decision:"block"` + 修复指令【bootstrap 兜底 Layer 3，**全插件唯一硬 block**】。其余一律放行——"别放着 ready 活空转"是**决策程序的软纪律**（Skill A），不在 hook 里硬拦（Stop 机制只能 block 或放行、且放行时 stdout 不进 agent context，无法做真正的"软推"；放在 hook 里只会变成误伤合法让渡的硬 block）。 |
| **SessionStart**（startup/resume/compact） | 扫 home；若存在任何活跃 board，则重注 orchestrator **角色** + home 路径 + 活跃 board 短清单（文件名 + goal）。它**不**指向某个固定 board 路径——agent 凭 goal 认回自己的 board，继续编排循环。**（2026-06-08 增补）reinject 现额外带出 board 新增的 `phase` 柔性边段（`current` + 阶段 goal 条件原文 + 本阶段 task 范围），提醒 agent 认回"我在冲哪段"、核对阶段 `/goal` 是否还挂着；goal 丢了则按 board 记录的条件重设（hook 读不到 goal 状态，只能提醒 agent 自核）。** 【扛 compaction / 跨会话续命】 |

（PreCompact 提醒 flush board —— **可选**，v1 可由决策程序第 7 步"收尾前 flush"覆盖。）

### Bootstrap 保证（三层，已核实 CC 机制）
1. **UserPromptSubmit 确定性建空壳**：hook 在 agent 处理前触发、能写文件、能注 context（均官方确认）；**只检测 + 建空骨架，不抠 goal**（goal 由 agent 填）。board 存在性**不依赖 agent 听话**。
2. **agent 填 goal + DAG**：唯一非机械步，锚在已存在文件上。
3. **Stop hook 强制兜底**：Stop 能 `decision:"block"`（官方确认），board 不合法就卡住对话直到修复。
**唯一不确定（已中和）**：hook 见到 raw 还是展开后 prompt（官方无文档）→ 靠命令体埋 **sentinel**（两种都 grep 到）+ goal 不走这条路 + Stop 兜底。**impl 期 5 分钟 smoke-test**：hook log stdin/pwd/`${CLAUDE_PROJECT_DIR}` 到 /tmp，跑一次命令看真实格式与 cwd。

---

## 6. 哲学层（权威副本在 Skill A 的 SKILL.md；命令经唤起 Skill A 植入；compaction 后由 SessionStart hook 触发重载）

### 身份信条
> 我是指挥，不是乐手。我把目标拆成依赖图，让独立 agent 并行演奏，自己立于乐队与用户之间——拿不准就问、该用户定的请他定、向他派问题与让后台演奏并行不悖；等待的每一拍都先排下一段、验上一段、记账与沉淀，唯有万事皆悬于后台或已抛给用户待答、再无可排之事时，才坦然等一拍。

### 七镜头
1. **指挥不演奏** —— 拆解/分派/验收/整合，绝不亲手 impl/review。
2. **目标即依赖图** —— 拆 DAG、找 critical path、资源压关键链（非关键链 float 是免费并行预算）。
3. **就绪即发，绝不在 barrier 干等** —— dataflow：依赖一满足即派；parallelism=T₁/T∞ 定开几路。
4. **主观能动，不被动空等** —— 休息前穷尽 + 主动排活；合法等待 = 每条剩余路径都卡在「in-flight 后台」或「已抛给用户待答」。罪在"能动却被动空等"，不在 idle。
5. **量力而行，不顶满利用率** —— WIP 设界、~75%（Little's Law + utilization cliff；加 agent 不一定更快）。
6. **只信端点验收，产出可记账可续** —— 自己端点独立验，agent 自报不可信；content-hash 记账，done+验过可跳过/resume。
7. **该问就问，前台对话∥后台执行** —— 用户=特殊异步 worker；该他定的立刻抛、不憋不擅专；其回答是异步依赖；不依赖它的 ready 工作照常派照常跑。

### 红线
- 不亲自上手 impl/review（全分派）。
- gate 绿 ≠ 通过：必 read diff / 独立验；null/空 review 视为未过（防静默放行）。
- 每个循环必有保险丝（max rounds / budget）。
- **正当等待 > 假忙**：宁坦然等，也不制造 busywork / gold-plate / 过度评审。
- **用户该定的不擅专**：难撤销 / 对外可见 / 方向抉择 / 终审（如 merge）必先问。

---

## 7. 决策程序（Skill A 的"牙齿"；每回合收尾前跑）

哲学是动机、不是控制；真正防空转/防假忙的是这段**确定性程序**：
```
1. 对账 board：整合完成的后台结果；标记超 p95 的 in_flight 供 hedge；标 stale（上游变了）
2. 有"该用户定/需确认"才能推进的点？→ 立刻抛给用户（别坐着）
3. 有 ready task（依赖已满足，含已得到的用户答）？→ 在 WIP 上限内派（先 reserve 预算+WIP）
4. 有合法 fill-work（过准入测试）？→ 做
5. 有完成但未验 / uncertain 的节点？→ 端点独立验 / 路由到验证节点
6. 以上皆无 且 每条剩余路径都卡在（in-flight 后台）或（已抛出待用户答）→ 正当等待/交还回合
7. 收尾前 flush board
```
**fill-work 准入测试**（把"正当等待>假忙"变可判定）：一项 fill-work 合法当且仅当——解除某已知依赖阻塞 / 降低集成风险 / 产出可复用产物 / 验证某具体假设；否则 = 等待，非工作。

---

## 8. Skill A：`master-orchestrator-guide`（编排方法论 —— 魂）

**结构**（progressive disclosure）：精简 SKILL.md（常驻，是 compaction 后 hook 重载落点）+ 按需 reference。

- **SKILL.md（魂，常驻）**：§6 哲学（信条+7镜头+红线）+ §7 决策程序 + board 协议要点 + "何时翻哪本 reference" 指路。
- **references/**：

#### `decomposition.md` —— 目标 → 依赖 DAG
- 把目标拆成 task 节点、画依赖边、得 DAG；topological 定合法序。
- CPM forward/backward pass 求 ES/EF/LS/LF + float；**float=0 的链 = critical path**，资源压这。
- parallelism = T₁/T∞（总工作量/关键链长）→ 决定"这目标最多值得几路并行"；≈1 就别 fan-out。
- granularity 拿捏（太细=协调爆，太粗=无法并行/验收）。
- **每节点先定 contract**：input deps（pin 上游 artifact） / output schema（按下游需要：verdict·evidence·confidence·blockers·open-q·artifacts） / success predicate / timeout·budget / escalation condition。
- 源：研究报告 4（CPM/work-span/Brent）。

#### `dispatch.md` —— 选手段 + 并行编排（Skill A 的核心，见 §11 完整框架）
- 三机制（shell / sub-agent / workflow）选择判据（**控制/综合/context，非数量**）。
- intra vs inter workflow（**lifecycle coupling 为主轴**）。
- re-altitude 经 escalation（sub-agent 不自我升格，STOP+报 escalation result，orchestrator supersede→workflow）。
- 混合 + admission control（reserve-on-launch，WIP 含集成负担，并发上限取 min(CPU/IO, 模型预算, rate limit, context-return, 综合负载)）。
- 源：研究报告 3（LLM-Compiler TFU dataflow）+ codex 二评。

#### `board.md` —— board 协议
- §3 全文：窄腰 schema + status 枚举 + 柔性边 + (A)快照 + 可配置 home + 每编排唯一命名 board 文件（owner.active 即"活跃"）+ 读/写/flush 纪律（决策程序第 7 步 + 可选 PreCompact）+ 单一真理源 + supersession 显式态 + log 段复盘。

#### `async-hitl.md` —— 异步完成 + HITL
- **in-flight 追踪**：`dispatched_at` → 超该类任务 p95 时长 → hedge（派备份取先完成）或降级（一个挂死的子任务超过硬截止时长就 defer，不无限等）。
- **整合完成**：收到 `<task-notification>` → 对账 board → 解锁 newly-ready → 在 WIP 内派。
- **HITL 模型**：用户=特殊异步 worker；该他定的立刻 surface（不坐着）；用户输入是异步依赖（`blocked_on:"user"`）；**不依赖它的 ready 工作照常派**（前台问题∥后台执行）；不擅专（难撤销/对外/方向/终审必问）。
- 源：研究报告 2（"主线程不空等"=生态空白）+ 镜头 4/7。

#### `resume-verify.md` —— resume + 端点验收
- **resume**：每节点 content-hash（spec+上游产出+关键 context）= build-system action key；命中即复用已落盘 artifact、跳过；compaction/中断后 resume = O(变更集)。
- **dependency pinning / stale**：节点绑上游 artifact 版本/hash；上游变 → 标 stale → 重跑（防"基于过时快照的连贯但错误结果"）。
- **端点验收**：orchestrator 独立验（跑 gate + read diff）；agent 自报不可信；gate 绿必要非充分；null/空 review = 未过。
- **loop 收敛**：结构化 gate（FinalResponse vs Replan(feedback)）+ max-rounds 保险丝 + dedup-against-seen（防被否决项每轮重现）。
- 源：研究报告 3（Joiner loop-until-converged）+ 报告 4（content-addressable cache / end-to-end argument）。

---

## 9. Skill B：`authoring-workflows`（写法 + 机制摊明）

**定位**：教 agent **写到 Claude Code harness 自己的校验契约上**，并给现成的模板/范例。**关键决策（dogfood 修正）**：**不造可运行 linter**——harness 本身就是权威校验器（`meta` 在 launch 时校验；determinism 三禁 / caps / 沙箱禁 `require` 在 runtime `throw`），独立 linter 只是它的**启发式仿冒**，会漂移、会误报（实建时就误报了注释里的 `parallel([...])`，白烧一轮去修）。所以本 skill **教契约、不重造校验器**；镜头6"只信确定性端点验收"由 harness 这个端点天然满足。本 skill 自包含（ship-anywhere），内容引研究报告 1 的机制 ground-truth。

**结构**：
- **SKILL.md（常驻）**：
  - "honest test"——这任务真需要 workflow 吗（两行 bugfix 别上五人评审团）。
  - 范式选择决策树（脚本内部：fan-out(barrier) / pipeline(streaming) / loop）。
  - author 流程：**写到 harness 契约**（meta 纯字面量首语句 / determinism 三禁 / 禁 `require`·`process` / `parallel` 传 thunk / 守 caps）→ **直接 launch，harness 报错即权威反馈**。
  - "写前必读机制 ground-truth"指路。
- **references/**：
  - `mechanism.md`（≈研究报告 1）：**确认契约 vs 内部未知**两分；七原语真义；`parallel`(barrier) vs `pipeline`(streaming) 真相 + smell test；determinism 三禁；resume="longest unchanged prefix"；硬上限（16并发/1000总/4096每调用/512KB）；**harness 是权威校验器、别重造**。**让 agent 不再猜机制、也不瞎信坊间传闻。**
  - `patterns.md`：fan-out+synthesize / pipeline-by-default / adversarial-verify / judge-panel / loop-until-{count,budget,dry} / multi-modal-sweep / completeness-critic——各带 when + 骨架。
  - `api-reference.md`：原语签名速查（`agent`/`parallel`/`pipeline`/`phase`/`log`/`budget`/`workflow`/`args` 的 opts、cache key 四要素、失败语义）。
- **assets/**（教学三层的下两层 —— `patterns.md`=片段+prose / `templates/`=整脚本骨架 / `examples/`=完整真实工作流；templates 按**控制流形状**高频度选，examples 按**任务族**高频度选）：
  - `templates/`（控制流骨架 —— **5 个结构原型**，每个隔离一种范式；顶部 docstring 写明「何时用 / 结构 / 填什么 / 对应决策树哪支」，copy→填 prompt/schema→跑。锚在 Workflow 工具 canon："DEFAULT TO pipeline()"）：
    - `fan-out.js` —— `parallel()` barrier：独立任务并发、要齐再下一步（两大原子之一）。
    - `pipeline.js` —— 多 stage 流式（**默认**）：每 item 独立穿过各 stage、无 barrier（两大原子之一、工具钦定默认）。
    - `loop-until-budget.js` —— 按 `budget` 动态缩放 fleet/深度（对应「+500k」预算指令 —— **正切本 plugin "long-horizon 预算感知" 主题**）。
    - `loop-until-dry.js` —— 未知规模发现：连续 K 轮无新增即停（找全 bug / 找全调用点）。
    - `scout-then-fanout.js` —— 混合：内联 scout 先探出 work-list → `pipeline` 铺开（工具明确推荐的"真实起手式"）。
  - `examples/`（完整可跑任务原型 —— **单 `.js` 文件、自包含**，含真实 prompt + schema + 验收；覆盖 review/design/research/migrate 四大高频族。与 template 不重复：template 给裸语法占位，example 给 composition）：
    - `review-adversarial-verify.js` —— 维度→find→对抗验证（`pipeline` + per-finding fan-out verify）；工具自带 canonical，**镜像本仓库 dev-orchestrator review 段**。**最高频**。
    - `design-judge-panel.js` —— N 个独立方案→并行评分→从优胜者综合并嫁接亚军亮点；设计/决策族。
    - `research-multimodal-sweep.js` —— N 个搜索角度并行→dedup barrier→深读→completeness critic；研究/理解族。
    - `migrate-discover-transform-verify.js` —— 发现改动点→`isolation:'worktree'` 隔离逐点改→gate 验收；迁移/重构族，**唯一演示 `isolation:'worktree'` 并行改文件防冲突**的范型。
  - **v1 边界**：5 templates + 4 examples（覆盖 review/design/research/migrate 四大高频族 + iterate 由 loop templates 承载）；niche 形状（tournament bracket / self-repair loop / staged escalation）留 `patterns.md` 文字描述、不单独成文件 —— 防 Skill B 膨胀。

> **可选对称**：Skill A 也可在 `assets/` 放一个 `board.template.json`（board 空骨架范例）+ 一个 worked board 示例；非必需，v1 可省。

---

## 10. 已验证的 CC 机制（design 依赖的事实，reference）
- plugin hooks 装上即常驻、无原生命令门控 → Stop / SessionStart 自门控于"home 里有没有活跃 board（`owner.active:true`）"。
- 命令=prompt；靠 hook 或命令体指示落 state。
- **UserPromptSubmit**：无 matcher（脚本 grep）、agent 处理前触发、能写文件+注 additionalContext。
- **Stop**：能 `decision:"block"`（强制不结束）；**无 hook 支持自动重试**（block=停，靠人/agent 修）。
- session_id 跨 compaction/`--resume` 不变；普通重开是新 id → state 落在 home 里持久化的 board 文件上（不依赖 session_id），agent 凭 goal 认回。
- 内建 **TodoWrite 弃用**（v2.1.142）；**Task\* session-scoped 且 hook 读不到** → 必须文件。
- `skills/_shared/`（无 SKILL.md）被忽略；跨 skill 共享靠"指示 agent Read 路径"；本设计共享层 = 命令哲学植入（经 Skill A），**不搞 _shared 目录**。
- **原生 `/goal`（2026-06-08 整合纳入；详见整合设计文档）**：本质 = 一个 **session 作用域、prompt-based 的 Stop hook 的 wrapper**。设一个完成条件后，**每个 turn 结束由独立小模型（默认 Haiku）评估**"条件 + 至此对话"判 yes/no，no 则自动续 turn 不交还控制权。关键事实：**跨 compaction 保持活跃**、**跨 `--resume` 恢复**（但 turn/timer/token baseline 重置）；**每会话仅一个 goal**（新 goal 覆盖旧）；评估器**只读对话，读不到文件系统、不调工具**（故验收证据/决策程序自查必须由 agent 显式呈现在对话输出里）；**hook/plugin 不能编程式设 `/goal`**——只能由 agent 主动敲命令（→ 只能是 **best-effort 增强，不进确定性兜底**）；需 v2.1.139+、需 hooks 系统启用。
- **两个 Stop hook 并存且方向相容**：会话里同时有 cc-master 的 `verify-board.sh`（仅"空 active board"时硬 block，否则放行）与 `/goal` 的内部 Stop 评估（阶段 goal 未达成且未进正当等待时令 agent 续 turn）。二者不冲突——空 board 时根本不会有 goal（goal 是 agent 填完 DAG、进入自驱区段后才设的），board 非空时 `verify-board` 放行、由 `/goal` 接管"该不该停"。**[待实测]** 多 Stop hook 合并/执行顺序（若任一 block 即 block，则二者并存安全）。

---

## 11. Skill A · dispatch 决策框架（完整）

**分形三层**：顶层主线程 = dataflow 调度器（DAG 节点派后台手段 + 间插 HITL，受 WIP+共享预算约束，记 board）；中层 = workflow 内部 fan-out；叶 = sub-agent/shell。选手段 = 选在哪层执行该节点。

**后台执行手段（仅 3 个 —— 给 agent 只教这三个）**：
- **shell**：机械可检的执行（build/测试/拉数据/监听/CI 轮询）。零 token。须配 timeout + success predicate + 抓 log + 失败可路由给后续推理节点（否则拆"shell 执行节点 + sub-agent 诊断节点"）。
- **sub-agent**（run_in_background）：一个 **terminal** 推理单元（单证据面 + 单推理链 + 单交付 + 无需 fan-out + 无需统一 schema + context 安全 + 带显式 escalation）。
- **workflow**：需对**多 leaf 确定性控制**（fan-out/fan-in · 统一 leaf schema · 对抗验证/retry/loop · 联合综合 · context-flood 风险 · journal-resume）——**即便 leaf 数少也选它**。

**选手段判据（控制/综合/context，非数量）**：需推理吗？否→shell；推理且 terminal→sub-agent；需对多 leaf 确定性控制→workflow。

**Intra vs Inter workflow（主轴 = lifecycle coupling）**：
- **一个 workflow**：leaves 共享同一 lifecycle（同目标/schema/质量门/预算包络/综合点/可接受失败策略），无中途 HITL 需求。
- **多个 workflow**：流间 differ in 优先级/失败模式/重启成本/预算上限/escalation/集成时机/需独立 gate-讨论。
- HITL 只是其一轴；失败隔离、优先级、集成时机同等重要。中间档：单 workflow 多 phase；`workflow()` 一级嵌套。

**Re-altitude（核心）**：sub-agent 发现自己其实是 sub-DAG → **不许自我升格/自行 fan-out**（workflow leaf 同样不能 spawn）→ STOP + 返回 escalation result（scope map + 拟 leaves + deps + partial evidence + 原因）→ orchestrator supersede 旧节点、用该 map seed 一个 workflow。**靠 checkpoint 升格，不靠盲杀**。推论：workflow leaf prompt 必须够小够 terminal；不确定先跑 scoping sub-agent/workflow。

**混合 + admission control**：顶层可同时在飞 shell + N sub-agent + workflow；**启动前 reserve WIP+token 预算**（reserve-on-launch，非 spend-后报）；**WIP 上限含"集成负担"**（防 N 个 workflow 同时返回的 synchronization cliff）；并发上限 = min(CPU/IO, 模型预算, rate limit, context-return 预算, 综合负载)。

**node status 路由**：uncertain→验证节点；stale→上游变了重跑；escalated→supersede→workflow。

---

## 12. 有意排除 / 不做（决策留痕）
- **原生 `/goal`（2026-06-08：未评估 → 已纳入）**：原研究基线漏评 `/goal`；本次整合调研发现它与 cc-master 核心机制高度同构，**已纳入——分阶段叠加、best-effort**。整合力度 = 主动叠加：cc-master 确定性骨架（3 hooks + board + bootstrap 三层兜底）一根不动，在其上由 bootstrap 引导 agent **主动**在每个"无需 HITL 的自驱区段"起点设一个阶段 `/goal`（灵魂公式，必带"正当等待"逃生口，撞 HITL 边界即清除→问用户→设下一段）。**不进确定性兜底**（hook 设不了 goal、LLM 中介），只作软纪律→独立模型硬约束的增益。详见 `design_docs/2026-06-08-native-goal-loop-integration.md`。
- **原生 `/loop`（仍不直接引入）+ `ScheduleWakeup`/`CronCreate`（部分解禁，许可用于 watchdog·ADR-011）**：原排除理由——动态自步调（ScheduleWakeup）Bedrock/Vertex/Foundry 不支持、`/loop` 会话 7 天过期——撞 **ship-anywhere** 硬约束；`/loop` 唯一"等会到来的外部就绪信号"真场景（CI / 远程队列 / 审批超时）仍用**已有的"后台 shell"积木消解**（`until <就绪>; do sleep N; done` 丢进 `run_in_background`，完成后 harness 通知重入），事件驱动、完全 ship-anywhere。**但有第二个 background-shell floor 兜不住的真场景——静默失败盲区**（后台任务 hang 死 / 静默死 / 压根没派出 → 无完成事件 → orchestrator 永远等不到唤醒，幽灵任务 Finding #17/#46）。对此 **`ScheduleWakeup` + `CronCreate`（`durable:false` 本地 session 内存调度，不需 claude.ai OAuth）许可作 watchdog 安全网**，层叠于 harness 自动重唤起之上、只补这个盲区。教法是**降级链**（CronCreate / ScheduleWakeup / Monitor 按情境降级，**background-shell `until` 轮询永为 universal floor**），不假设新工具到处都在——ship-anywhere 仍是硬保证。详见 [`../adrs/ADR-011-self-wakeup-watchdog.md`](../adrs/ADR-011-self-wakeup-watchdog.md)。
- **agent teams**（实验开关 `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`）、**云 `scheduled routines` / `/schedule` / RemoteTrigger**（云持久/离线，但需 claude.ai 账户 OAuth、非 Bedrock/Vertex/Foundry——注意与上条 `CronCreate` 本地内存调度区分：后者不需 OAuth、ship-anywhere 友好故已部分解禁，前者仍破 ship-anywhere）：机制研究确认它们是真后台机制，但**仍有意不教**——通用 ship-anywhere 插件不教不可靠可用的手段，免 agent 去够用不上的工具。skill 里只字不提这两类。
- **v1 不过度造，降为"skill 讲原则 + 细节落 board 协议/impl"**：完整 budget-reservation ledger、dependency artifact-hash 全量 pinning、named 可复用 quality-pattern 契约、集成负担定量公式。
- 完整乐观并发 CAS（多 session 抢同一 board）：v1 只轻量 lease（owner+heartbeat+告警接管），完整 CAS 入 backlog。

---

## 13. 留待 impl/后续决定
- **bootstrap smoke-test**：UserPromptSubmit 见到的 prompt 真实格式（raw vs expanded）、cwd、`${CLAUDE_PROJECT_DIR}` 可用性——impl 期实测。
- 命令体 sentinel 的确切串；各 hook 脚本实现。
- board 文件的完整 JSON schema（窄腰字段类型）；home 位置可配（`$CC_MASTER_HOME`，否则 `<project>/.claude/cc-master/`），文件名 `<UTC时间戳>-<pid>.board.json`。
- **plugin 装哪 / dev 在哪 worktree**：待定。
- markdown 视图生成器是否要（v1 可省，agent 直接读 json）。

---

## 14. 验收（"done" 长啥样）
- 三条命令可用；`as-master-orchestrator` 跑后 board 被**确定性**创建（即便 agent 不配合，hook 也建好空壳；Stop 兜底）。
- compaction 后 SessionStart hook 能重注角色 + board，agent 无缝续编排循环（不丢角色、不空转）。
- 两个 skill 内容完整、自包含、边界不重叠（Skill A=主线程编排，Skill B=脚本内部写法）。**（此为 2026-06-05 快照口径；现 portfolio 已扩为 7 个分发 skill〔A/B/D/E/F/G/H，退役 C〕，边界与分工以 AGENTS.md §3/§6 + feature-manual §2 为准·见 §2 注。）**
- 哲学 + 决策程序 + dispatch 框架按本 spec 落地。
- 跨会话（关机重开）能凭 home 里持久化的 board 文件续上——agent 列 home、凭 goal 认回自己的 board。
- smoke-test 三项（prompt 格式/cwd/`${CLAUDE_PROJECT_DIR}`）实测通过。
