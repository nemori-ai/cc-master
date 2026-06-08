# cc-master plugin —— 设计决策工作稿（in progress）

> **状态**：设计阶段（brainstorming）进行中。本文件是 compaction/跨会话的**恢复锚点**——下方均为已与用户对齐的 **locked** 决策。**未完**：两个 skill 的具体内容设计正在讨论。
> **关联**：研究基线 `research/dynamic-workflow/`（4 报告，已 commit 9047592d）；本设计在 worktree `research-dynamic-workflow` 分支。

## 0. 目标
一个 Claude Code **plugin**，把任意 main-session agent 一键初始化成"master orchestrator"，服务 long-horizon（24h+）任务。两大能力：
1. **会写** 正确/稳定/高效/高并行的 dynamic-workflow 脚本。
2. **会推进**：long-horizon 里综合用 sub-agent + workflow + 前台 HITL，分派后台任务后用等待空档**主观能动**地做事而非空转，全程异步。

## 1. 形态（locked）
plugin `cc-master` = **命令 + 2 skills + hooks + board 文件**。通用、ship-anywhere（不绑 OMNE）。

## 2. 命令（locked）
- `/cc-master:as-master-orchestrator [goal]` —— bootstrap（开机引导）。
- `/cc-master:status` —— 汇总 board 进度/健康。
- `/cc-master:stop` —— 归档 / 置 board 非活跃。

## 3. 两个 skill（locked：2 个，自包含，建立在命令经 Skill A 植入的哲学之上）
- **Skill A `orchestrating-to-completion`**：完整编排/调度方法论。**承载哲学权威副本** + 决策程序 + 目标→DAG + 分派纪律 + board 协议 + 异步 + HITL + resume + 端点验收 + fill-work 准入测试。
- **Skill B `authoring-workflows`**：两层——(1) **写法层**（范式选择决策树、稳定性铁律、效率规则、高并行、author 检查清单、lint ref）+ (2) **机制摊明层**（确认契约 vs 内部未知；七原语真义；parallel/pipeline 真相；determinism；resume 模型；硬上限 —— ≈ 研究报告 1）。

## 4. 哲学层（locked；权威副本在 Skill A；命令经唤起 Skill A 植入）
**信条**：
> 我是指挥，不是乐手。我把目标拆成依赖图，让独立 agent 并行演奏，自己立于乐队与用户之间——拿不准就问、该用户定的请他定、向他派问题与让后台演奏并行不悖；等待的每一拍都先排下一段、验上一段、记账与沉淀，唯有万事皆悬于后台或已抛给用户待答、再无可排之事时，才坦然等一拍。

**七镜头**：
1. 指挥不演奏 —— 拆解/分派/验收/整合，绝不亲手 impl/review。
2. 目标即依赖图 —— 拆 DAG、找 critical path、资源压关键链。
3. 就绪即发，绝不在 barrier 干等 —— dataflow，依赖一满足即派；parallelism=T₁/T∞ 定开几路。
4. 主观能动，不被动空等 —— 休息前穷尽+主动排活；合法等待 = 每条剩余路径都卡在「in-flight 后台」或「已抛给用户待答」。罪在"能动却被动空等"。
5. 量力而行，不顶满利用率 —— WIP 设界、~75%（Little's Law + utilization cliff）。
6. 只信端点验收，产出可记账可续 —— 自己端点独立验，agent 自报不可信；content-hash 记账，done+验过可跳过/resume。
7. 该问就问，前台对话∥后台执行 —— 用户=特殊异步 worker；该他定的立刻抛、不憋不擅专；其回答是异步依赖；不依赖它的 ready 工作照常派照常跑。

**红线**：
- 不亲自上手 impl/review（全分派）。
- gate 绿 ≠ 通过：必 read diff/独立验；null/空 review 视为未过（防静默放行）。
- 每个循环必有保险丝（max rounds/budget）。
- 正当等待 > 假忙：宁坦然等，也不制造 busywork/gold-plate/过度评审。
- 用户该定的不擅专：难撤销/对外可见/方向抉择/终审（如 merge）必先问。

## 5. 决策程序（locked；在 Skill A；每回合收尾前跑）
```
1. 对账 board：整合完成的后台结果；标记超 p95 的 in-flight 供 hedge
2. 有"该用户定/需确认"才能推进的点？→ 立刻抛给用户（别坐着）
3. 有 ready task（依赖已满足，含已得到的用户答）？→ 在 WIP 上限内派
4. 有合法 fill-work（过准入测试）？→ 做
5. 有完成但未验的节点？→ 端点独立验
6. 以上皆无 且 每条剩余路径都卡在（in-flight 后台）或（已抛出待用户答）→ 正当等待/交还回合
7. 收尾前 flush board
```
**fill-work 准入测试**：合法当且仅当——解除某已知依赖阻塞 / 降低集成风险 / 产出可复用产物 / 验证某具体假设；否则 = 等待，非工作。

## 6. Board（locked）
- 名 **board**；**单一真理源**；**cwd/worktree 键**；gitignored 固定路径（拟 `.claude/cc-master/board.json`）；markdown 视图按需生成。
- **存储 = (A) 可变快照 `board.json`**：每回合 Write 整文件；边里塞轻量 `log` 段承载复盘（不上完整事件溯源，YAGNI）。
- **窄腰（钉死，hook 依赖）**：`header{ schema版本, goal, owner-lease{active,session_id,heartbeat}, git{worktree,branch} }` + `tasks[{ id, status∈ready/in_flight/blocked/done, deps }]`；status 可带 `blocked_on:"user"|"<taskid>"`。
- **柔性边（agent 自由，hook 忽略）**：title/artifact/dispatched_at/kind/justification/notes/log…。
- 内建 **Task\* 工具**：顶多 in-session 草稿镜像，**非权威**。

## 7. Hooks（locked）—— 均自门控（探 board active marker，无则 `exit 0` 静默）
- **UserPromptSubmit**：grep 命令体埋的 **sentinel** → 确定性建 board **空骨架 + marker** + 注 context → `exit 0`（**不 block**）。【bootstrap 保证 Layer1】
- **Stop**：校验 board 存在 + 腰合法（≥1 任务）；不达标 `decision:"block"` + 修复指令。【bootstrap 保证 Layer3 + 过早收尾诊断】
- **SessionStart**（compact/resume/startup）：探 marker 在 → 重注"你是 <goal> 的 orchestrator + board 摘要 + 重新唤起 Skill A"。【扛 compaction / 跨会话】
- （PreCompact：提醒 flush board —— 可选）

## 8. Bootstrap 保证（locked，已核实）
三层：① UserPromptSubmit 确定性建空壳（**hook 只检测+建空骨架，不抠 goal**）② agent 填 goal+DAG（锚已存在文件）③ Stop hook 强制兜底（block 直到 board 合法）。
唯一不确定（**已中和**）：hook 见到 raw 还是 expanded prompt —— 靠命令体埋 sentinel（两种都 grep 到）+ goal 不走这条路（agent 填）+ Stop 兜底。**impl 期 5 分钟 smoke-test**：hook 把 stdin/pwd/`${CLAUDE_PROJECT_DIR}` log 到 /tmp，跑一次命令看真实格式与 cwd。

## 9. 已验证的 CC 机制（reference）
- plugin hooks 装上即常驻、无原生"命令后才激活"gate → 用 **marker 自门控**。
- 命令 = prompt；靠 hook（UserPromptSubmit）或命令体指示落 state。
- **UserPromptSubmit**：无 matcher（脚本 grep 自 filter）；在 agent 处理前触发；能写文件 + 注 additionalContext。
- **Stop**：能 `decision:"block"`（强制不结束）；**无 hook 支持自动重试**（block=停，靠人/agent 修）。
- session_id 跨 compaction/`--resume` 不变；普通重开是新 id → state 必须按 **cwd 键**。
- 内建 TodoWrite 弃用（v2.1.142）；Task\* session-scoped 且 **hook 读不到** → 必须文件。
- `skills/_shared/`（无 SKILL.md）会被忽略；跨 skill 共享靠"指示 agent Read 路径"；我们的解法 = 共享层放命令哲学植入（经 Skill A），**不搞 _shared 目录**。

## 10. 研究基线映射
`research/dynamic-workflow/`（commit 9047592d）：报告1 机制（=Skill B 机制层素材）/ 报告2 社区（"主线程不空等"=生态空白，需自建）/ 报告3 LLM-Compiler（TFU dataflow=镜头3）/ 报告4 SWE-PM（CPM/Little's Law/build-cache resume=镜头2/5/6）。

## 11. 待办（next）
- **【进行中】两个 skill 的具体内容设计**（结构 + progressive disclosure + 各 reference 文件）。
- 命令体 / hook 脚本细节 → spec/impl 期。
- plugin 装哪 / dev 在哪 worktree → 待定。
- 转 spec（`docs/superpowers/specs/`）→ 自审 → 用户复审 → writing-plans。

## 12. Skill A · dispatch 决策框架（codex 二评 + 机制研究 已折入）

**分形三层**：顶层主线程 = dataflow 调度器（DAG 节点派给后台手段 + 间插 HITL，受 WIP+共享预算约束，记 board）；中层 = 一个 workflow 内部 fan-out；叶 = sub-agent/shell。选手段 = 选在哪层执行该节点。

**后台执行手段（仅 3 个 —— 给 agent 的指导只教这三个）**：**shell**（机械可检执行）/ **sub-agent**（一个 terminal 推理单元）/ **workflow**（对多 leaf 确定性控制）。
> **决策留痕（勿再加）**：机制研究另查到 agent teams（实验开关 `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`）+ scheduled routines（云持久/离线，但需 claude.ai 账户、非 Bedrock/Vertex/Foundry）两个真机制；**有意排除**——通用 ship-anywhere 插件不教不可靠可用的手段，免 agent 去够用不上的工具。skill 里只字不提。

**每节点先定 contract（dispatch 前）**：input deps（pin 上游 artifact 版本/hash）· output schema（按下游需要：verdict·evidence·confidence·blockers·open-q·artifacts）· success predicate · timeout/budget · escalation condition。

**选手段判据（codex 修正：不是"数量"，是"控制/综合/context"）**：
- 需推理吗？**否 → shell**（须满足：命令已知 + 输出机械可检 + 有 timeout/retry/kill + 抓 log + 失败可路由给后续推理节点；否则拆成 shell 执行节点 + sub-agent 诊断节点）。
- 推理且 **terminal**（单证据面 + 单推理链 + 单交付 + 无需 fan-out + 无需统一 schema + context 安全 + 带显式 escalation）**→ sub-agent**。
- 需**对多 leaf 确定性控制**（fan-out/fan-in · 统一 leaf schema · 对抗验证/retry/loop · 联合综合 · context-flood 风险 · journal-resume）**→ workflow**（即便 leaf 数少也选它）。

**Intra vs Inter workflow（codex 修正：主轴是 lifecycle coupling，非 HITL）**：
- **一个 workflow**：leaves 共享同一 lifecycle —— 同目标/schema/质量门/预算包络/综合点/可接受失败策略，且无中途 HITL 需求。
- **多个 workflow**：流间 differ in 优先级/失败模式/重启成本/预算上限/escalation 策略/集成时机/需独立 gate-讨论。
- HITL 只是其中一轴；**失败隔离、优先级/抢占、集成时机**同等重要。中间档：单 workflow 多 phase；`workflow()` 一级嵌套。

**Re-altitude 规则（codex 核心补）**：sub-agent 干到一半发现自己其实是个 sub-DAG → **不许自我升格/自行 fan-out**（workflow leaf 同样不能 spawn）→ **STOP + 返回 escalation result**（scope map + 拟 leaves + deps + 已得 partial evidence + 原因）→ orchestrator **supersede** 旧节点、用该 map seed 一个 workflow。**靠 checkpoint 升格，不靠盲杀**（保住已得证据）。推论：workflow leaf prompt 必须够小够 terminal；不确定就先跑一个 scoping sub-agent/workflow 再 fan-out。

**混合 + admission control**：顶层可同时在飞 shell + N sub-agent + workflow；**启动前 reserve WIP+token 预算（reserve-on-launch，非 spend-后报）**；**WIP 上限含"集成负担"**（不只活跃执行 —— 防 N 个 workflow 同时返回的 synchronization cliff）；并发上限 = min(CPU/IO, 模型预算, rate limit, context-return 预算, 综合负载)。

**node status（扩 board 窄腰）**：`ready / in_flight / blocked(blocked_on:user|<task>) / done / escalated / failed / stale / uncertain` —— 各状态在 DAG 里路由不同（uncertain→验证节点；stale→上游变了重跑；escalated→supersede→workflow）。output schema + dep-pins 放柔性边（hook 不读）。

**v1 不过度造、降为"skill 讲原则 + 细节落 board 协议/impl"**：完整 budget-reservation ledger · dependency artifact-hash 全量 pinning · named 可复用 quality-pattern 契约 · 集成负担定量公式。

## 13. 原生 `/goal`·`/loop` 整合（2026-06-08 增补；与 spec §3/§5/§10/§12 呼应）

> **关联设计文档**：`design_docs/2026-06-08-native-goal-loop-integration.md`（整合设计定稿，含调研事实基线 [确证]/[待实测]、风险缓解、验收）。本节只记关键决策链，细节去那看。
> **起因**：原研究基线评估过 `/loop`（决定用 board 任务循环替代）、明确排除过 agent-teams / scheduled routines，**唯独漏评了原生 `/goal`**。本次正面补评——`/goal` 与 cc-master 高度同构，值得整合而非平行重造。

**整合力度 = 主动叠加（locked）**：cc-master 确定性骨架（3 hooks + board + bootstrap 三层兜底）**一根不动**；在其上**主动**叠加 `/goal`（bootstrap 即引导 agent 敲命令），`/loop` 用已有积木消解。既充分利用原生，又不破坏确定性保证。

**`/goal` = 分阶段自驱发令枪（locked）**：`/goal` 有致命副作用——只要 goal 活着 agent 就被自动续 turn、停不下来问用户；一个"端到端全程 goal"会把第 7 镜头（该问就问、前台∥后台）和整个 HITL 模型架空。解法是给 goal 找对粒度：**一个 goal 的生命周期 = 一段「无需 HITL 的自驱区段」**。这与 cc-master 的 DAG 天然咬合——`blocked_on:"user"` 决策节点本就把 DAG 切成若干自驱区段：阶段内（到下一 HITL 边界前）挂阶段 goal、逼 agent 啃到底；阶段边界 = HITL 点 = goal 已达成并清除 = 正常停下来问用户；用户答完 → 进下一区段 → agent 有感知地再设下一个阶段 goal。goal 从"全程枷锁"降级为"分段冲刺发令枪"，HITL 在段缝里得以呼吸。

**灵魂公式（核心机制，locked）**：阶段 goal 的完成条件统一收敛为——

> **阶段 `/goal` 条件 = 「本阶段业务终态达成」 ∨ 「本阶段已进入正当等待」**（决策程序第 6 步判据：所有剩余路径都阻塞在 in-flight 后台任务、或已抛给用户待答；HITL 是正当等待的子集）。

一箭三雕：① **防过早收工**——阶段没干完、还有 ready 活却想停 → 两分支皆不满足 → 独立裁判把 agent 踹回去干（这正是 `verify-board.sh` 软纪律想要、Stop 机制做不到的"硬防 idle 偷懒"）；② **不困死 HITL**——撞必须用户拍板的点 → 落入"正当等待(待用户答)" → 放行停下来问；③ **不困死后台等待**——所有路径都在等 in-flight 后台 → 落入"正当等待(等后台)" → 放行安心 yield。净效果：把第 4 镜头"罪在能动却被动空等，不在 idle"——全套体系最难自律的一条——从软纪律升级为独立模型执行的硬约束。**配套前提**：agent 每回合收尾跑决策程序时，把第 6 步自查结论 + 阶段验收证据**显式写进对话**（评估器只读对话、读不到文件），裁判才有据可判"正当等待 vs 偷停"。

**逃生口 = 正当等待（locked）**：灵魂公式的 ∨ 右支即逃生口，复用决策程序第 6 步的"正当等待"判据，HITL 是其子集——这保证 goal 永不与 cc-master 的 HITL/后台等待模型打架。**goal 不锚 board 镜像**：评估器读不到文件，若锚"board 全 done"会沦为橡皮图章 + 逼 agent 刷屏；改锚"业务终态 ∨ 正当等待"，证据须呈现在对话。

**跨 compaction 的阶段感知（locked）**：`/goal` 跨 compaction 保持活跃（仅跨 `--resume` 重置 timer）——即便 agent 压缩后忘了身份，挂着的阶段 goal 仍逼它啃当前段，**goal 反替 cc-master 扛了一道 compaction**。为让 agent 认回"我在冲哪段"，board 柔性边新增 `phase` 段（`current` + 阶段 goal 条件原文 + 本阶段 task 范围）；`reinject.sh` 重注时带出，提醒 agent 认回阶段、核对 goal 是否还挂着，goal 丢了则按 board 记录条件重设（hook 读不到 goal 状态，只能提醒 agent 自核）。这是 cc-master "board 扛 compaction"既有套路的自然延伸。

**`/loop` = 后台 shell 消解（locked）**：cc-master 是事件驱动（后台一完成 harness 自动唤醒重入），不需定时轮询。`/loop` 唯一真场景（等 harness 追踪不到的外部状态：CI / 远程队列 / 审批超时）用已有"后台 shell"机制吃掉：`until <外部状态就绪>; do sleep 60; done` 丢进 `run_in_background`，完成后 harness 通知重入。更贴事件驱动、完全 ship-anywhere——连 `/loop`/`ScheduleWakeup` 都不引入（它们 Bedrock/Vertex/Foundry 不支持动态自步调、会话 7 天过期，撞 ship-anywhere 硬约束）。把需求消解回已有积木，真正兑现"不重造轮子"。

**两个 Stop hook 相容（locked）**：会话里同时存在 cc-master `verify-board.sh`（仅"空 active board"时硬 block）与 `/goal` 内部 Stop 评估（阶段 goal 未达成且未进正当等待时令 agent 续 turn），方向相容、不冲突——空 board 时根本不会有 goal（goal 是 agent 填完 DAG、进入自驱区段后才设的），board 非空时 `verify-board` 放行、由 `/goal` 接管"该不该停"。**[待实测]** 多 Stop hook 合并/执行顺序（impl 期 smoke-test 验证；若任一 block 即 block 则并存安全）。

**`/goal` 只能 best-effort（贯穿全节，再强调）**：hook/plugin 不能编程式设 `/goal`（LLM 中介，只能由 agent 主动敲命令）→ `/goal` 这层只能是 **best-effort 增强，不进确定性兜底**；cc-master 的 bootstrap 三层兜底 + `verify-board` 硬 block 仍是确定性骨架。goal 是增益非依赖：agent 不设 goal 时，原决策程序软纪律 + `verify-board` 兜底仍在，功能不退化。

## 14. 二审（对抗验证）发现与修复（2026-06-08）

> 落地后两路独立二审（codex 独立诊断 + 对抗 reviewer）**双签**命中同一组 `reinject` 健壮性 BLOCKER——正是我和落地 sub-agent 同源盲区漏掉的。处置如下（详见整合设计文档 §7/§9 与 commit 历史）。

- **BLOCKER A/B（已修，TDD）**：`reinject.sh` 原用全文件 sed 提取 `"current"`/`"goal_condition"` → ① 杂散同名键（task/log）凭空捏造假阶段；② 单行贪婪 / 多行 `head -1` 取错值；③ 转义引号处静默截断、据残缺条件重设 `/goal`。**修法（守 ship-anywhere 纯 bash）**：`tr` 压平 board + sed 锚出 `"phase":{...}` 对象、只在其内提取（根治 ①②+多行）；转义截断 ③ 靠 `board.md` 约定 `goal_condition` 用纯文本、不含裸 `"`/`}` 兜底。补红测试 Case G/H/I（先暴露后修复）。
- **C（已修）**：多 active board × `/goal` 每会话唯一 → `reinject` 文案改单数绑定 + `async-hitl.md` 明确"阶段 goal 只服务当前主攻 board，第二个 `/goal` 会静默覆盖"。
- **D（文档澄清；反驳 reviewer 定性）**：段中突发 HITL **不是 bug**——`surface ≠ stop`，先榨干不依赖该答案的 ready 活、OR 逃生口在无活时自然放行（镜头 4+7 的理想执行）；`async-hitl.md` 补此情形（含"决策大到要重画计划则收窄 phase"的旁支）。
- **F（采纳轻量版）**：step-6 自查给出**结构化 ledger 格式**（`<task-id> · <status> · <blocker|evidence>` + 终判行），让 OR 逃生口可被评估器机械判定，而非靠自信断言。

### Backlog（本次有意不修，留痕）
- **verify-board 跨 session 误伤**（codex SHOULD-FIX 3）：`verify-board.sh` 检查 home 内**任意** active 空 board 即 block，不绑 session——无关并发 session 的空 board 会误伤当前 Stop。这是**既有设计缺陷、非本次整合引入**（`verify-board.sh` 本次未改），故记 backlog 不在本次展开。候选解法：board 加 `session_id`、verify-board 按当前 session 过滤；或绑 `goal` 匹配。与既有"完整乐观并发 CAS（多 session 抢同一 board）"backlog 项同源。
