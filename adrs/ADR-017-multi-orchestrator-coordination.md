# ADR-017 — 多 orchestrator 协调：切号机械化溶解切号协调，配速协调经感知 + 板级优先级 + 机械 floor

> Status: **Accepted**（用户已 bless·2026-06-29）
> Date: 2026-06-29
> Scope: 资源/预算建模 + `ccm` 引擎（新只读跨板 `peers` 能力）+ board 协议（新增 `coordination` ✎ 块：`priority` + `state{current,planned}`·非 narrow-waist·hook 不读）+ pacing skill 心智（`pacing-the-orchestration` 册多-orch 争用段 + agentic 自调的 Rationalization Table）+ `using-ccm` 命令面锁步（新增 `peers` verb·§6）。**hook 一字不动**（`coordination` 是 ✎ 非窄腰·红线2 不破）。
> Source: 2026-06-29 多 orchestrator 协调需求发现（旧 channel+AIMD 稿被 LOADBAL 切号机械化推翻后重写；用户改了早前主意，拍板砍掉通信通道、只留感知）。
> Co-signed: user (owner)

---

## 1. Context

顶层可能有 **M 个 master orchestrator（M 块 board）并发运行、共享同一个号池**的 5h/7d 配额。问题：怎么协调它们，既不让集体烧穿配额窗口、又能价值感知地分配资源——而不是各自孤立 pacing 导致公地悲剧（任一时刻全机器仅 1 个活跃账户 + 序列储备 N，多消费者同抽一个活跃配额缸）。

**这版决策推翻了一份旧稿**，理解「为什么砍掉通信通道」必须先理解旧稿错在哪：

- **旧稿前提（已被推翻）**：旧设计把协调架在**切号**上——假设「每个 agent 各自决定何时切号 / 切哪个号」，故需要一个**公共通信通道**让它们谈判，再叠一层 **AIMD 机械底座**（借拥塞控制的加性增 / 乘性减）当 fail-safe，让各自决定的速率自适应收敛到公平份额。
- **推翻它的事实（LOADBAL 切号机械化）**：切号现在是**确定性机械操作**——ccm 引擎从**共享 registry** 算出最优号（select 算法 + reset-proximity 权重 + reserve-floor），`account switch` 持 credstore 锁、重读全局状态、重算、仅幂等切。**M 个 session 用同一引擎 + 同一份共享 registry → 算出同一答案。** 没有「各自决定 → 需谈判达成共识」这回事。
- 于是「为切号谈判而生的通信通道 + 为各自决定切号防过冲而生的 AIMD」**整套架空**——不是被更好协议取代，是问题本身消失了。但**多消费者同抽一缸**的**配速协调**仍真实存在——它不在「切号」层，在「配速 / 价值」层。

**本 ADR 的灵魂（用户·贯穿全部子决策）**：master orchestrator 是 **AI Agent**，有自主推理 / 决策 / 工具使用能力——这层 **agentic delta 是传统纯静态机械机制没有的**。协调设计必须**利用**这层智能，而非把 orchestrator 降格成只会跟死规则的速率控制器。这与两条既有哲学同源：「价值是判断、不是 board 字段」（board-v2 砍 per-task priority）→ 跨板相对价值由 agent 读彼此人类可读的 `goal`/`workload` 推理；「引擎是 forecaster + 机械优化器、判断型优化归 orchestrator」（ADR-015）→ 机械层做稳定 floor + 确定性裁决，agent 做价值感知协调。

## 2. Decision

两条结构性决策。

### 2.1 D1 — 切号机械化 ⇒ 切号协调溶解

切号是确定性机械操作（同引擎 + 同共享 registry → 同一答案），**不需要任何分布式协调**。旧稿的「通信-谈判-切号 + AIMD-防各自切号过冲」**整体移除**——不是换协议，是问题消失。残留的「某 session 切了号、其他 session 要感知到」由各 session 下个回合从共享 registry 读 active 号自然获得，**不需协议**。

### 2.2 D2 — 配速协调重建在「配速 / 价值」层：感知 + 板级优先级 + 机械 floor + agentic 独立自调（**非通信协商**）

真正的协调重建为**一个只读感知通道 + 一个板级优先级 + 一个机械 fair-share floor + agentic 独立自调**，全长在**零写争用的 home substrate**（每个 orchestrator 只写自己 board 的 `coordination` ✎ 块，ccm 读全体「活 + 心跳新鲜」板）。协调靠各自**独立感知 + agentic 自调**，**不靠互发消息协商**：

- **感知通道（只读）**——每块板 publish `coordination.state`（current：active_tasks / workload / burn_contribution；planned：remaining_work / cost_to_complete%）+ `priority`。`ccm peers` 读全体活板 → 一份花名册（goal / workload / priority / liveness），喂价值感知的自我配速。
- **板级优先级**——开板时 optional 由用户声明、默认 `normal`（五挡 urgent / high / normal / low / trivial），住 `coordination.priority`。它是 **✎ 非窄腰**、**不喂引擎调度**——只当裁决骨架 + agent 推理锚。**与 board-v2 砍 priority 不冲突**：那砍的是板内 per-task 数字 rank；这是跨板协调 hint。

**优先级裁决简化为两级（仍给全序）**：① 板级 priority（主轴·五挡）→ ② 确定性兜底（repo-priority〔optional·home 级用户配置〕+ 创建时机〔老板优先〕）。**同优先级不再走通信协商**——由各自独立感知 + agentic 自调 + 机械 fair-share floor 在配速层收口，真正分不开的硬 tie 落 ② 一锤定音。①+② 即足以让任意两板可比、单调无环、无死锁。

**配速响应分两层**：

- **agentic 主层**——读 peers 花名册 → **独立推理** value-aware 配速 / 让路（读 goal 判相对价值、认领闲置 slack、同优先级争用时各自独立自调而非协商）。**这是 agentic delta·静态机制做不到·且无需通信即可发挥**——共享只读感知 + 各自独立推理已足够。
- **机械 floor**——priority-weighted fair-share（`corridor_rate × my_weight / Σweight`，等权退化即均分 = 走廊速率 / M）当 sane 默认；agent 不在场 / 不自调时仍稳。**floor 从旧稿的 AIMD 简化为 priority-weighted fair-share**——切号协调溶解掉了 AIMD 要解的收敛问题，不再需要自适应速率动力学。
- **加速侧防过冲**——每个 session 在加速时（双侧走廊欠用侧·ADR-010）把走廊 headroom **除以 M**（M = home 活板数·现成可数）防集体过冲；7d 总闸（85%）兜底 catastrophe。这是**共享 READ（数 M）+ 本地算**，非协议。

## 3. Consequences

### 3.1 Positive

- **大幅简化**——切号协调溶解、AIMD 自适应动力学移除、**通信通道砍掉**；剩下的协调是「感知 + 板级优先级 + 简单 priority-weighted floor + agentic 独立自调」，无需 tune α/β/EWMA 半衰 / 仿真验证 M 并发不震荡 / 维护消息合并 + age-out。
- **仍利用 agentic delta**——价值感知协调（读 goal 独立推理、自调让路），不需数字 priority 喂引擎、不需双向通信。
- **fail-safe**——感知通道非命门，读不到即退单板双侧走廊（ADR-010）；M=1 退化下 floor + headroom/M 都安全。
- **复用现成机件**——board 文件 / `owner.heartbeat` liveness（ADR-011）/ ccm 跨板枚举 / ADR-010 走廊数学；`coordination` 块是 ✎ agent-shaped（hook 不 gate·红线 2 不破）。

### 3.2 Negative / 代价

- **新协议面 + skill 锁步**——`coordination` ✎ 块（priority + state{current,planned}·**无 outbox**）+ ccm 新只读跨板能力（`peers`）+ board 写 publish state，须同 PR 同步 `using-ccm` 命令面（§6 锁步），漏则手册骗人。
- **agentic 自调需 skill 心智指导**——`pacing-the-orchestration` 册多-orch 争用段教「同优先级怎么各自独立让路 / 认领 slack」+ Rationalization Table 防「我总是最重要的」自利合理化（这条是 judgment-bearing prose，须按 §6 TDD-for-skills 先跑 pressure baseline 再落）。
- **板级 priority 重新引入「优先级」概念**——须守住 reconciliation（这是跨板 hint、非引擎 per-task rank），否则有滑回 board-v2 砍掉的东西的风险。
- **同优先级硬 tie 完全靠确定性兜底**（无协商手段补位）——可接受：感知通道 + agentic 自调已覆盖绝大多数同级让路，确定性兜底只兜「都不让 / agent 不在场」的罕见硬 tie。

### 3.3 Neutral

- **红线全保**：红线 1（`peers` 跨板能力进 ccm 引擎、感知经进程边界读，不进 hook）、红线 2（`coordination` 是 ✎ 非窄腰，hook 不读·ADR-003 一字不动）、红线 3（A=配速 / 协调**决策**、机制按域分流给 ccm/C）、红线 4（agentic 自调是「指挥用判断协调」、不把 orchestrator 降格成速率控制器）、红线 5（去中心化「只写自己板 + 跨板只读聚合」、无中央调度器 / 全局锁，ccm 缺则降级退单板走廊）、红线 6（hook 一字不动·武装闸不读 `coordination`）。
- **与 ADR-010/015/016 同构**——`coordination` 是 ✎ 顶层字段（同 `baseline`/`policy`），`priority` 不喂引擎（呼应 ADR-015「判断型优化归 orchestrator」），priority 声明与 ADR-016 的 repo-priority 用户配置同源。

## 4. Alternatives Considered

### 4.1 Alternative A：旧稿——通信-谈判-切号 + AIMD 机械底座

把协调架在切号上、用公共通道谈判 + AIMD 自适应速率收敛到公平份额。**取代**——前提（agent 各自决定切号）被 LOADBAL 切号机械化推翻，AIMD 要解的收敛问题随之消失；AIMD 的复杂度（α/β 参数 tune + 稳定性仿真）不再值得。

### 4.2 Alternative B：双向通信通道（outbox + claim/yield/propose/ack + `ccm channel`）

为「同优先级主动协商 / 临时让路」设计的 `coordination.outbox`（claim/yield/propose/ack 消息）+ `ccm channel post|read`。**曾入选后被砍**（用户拍板 2026-06-29·改了早前主意）。理由：M 个 orchestrator 看见同一份只读花名册即可**各自独立推理**出合理份额（隔壁快完 → 我多让 / 隔壁闲置 → 我多取），不必双向通信达成共识；同优先级协商这一中间层由「独立感知 + agentic 自调 + 机械 fair-share floor」收口、硬 tie 由确定性兜底拍。砍掉后更省、更 fail-safe（无消息合并 / age-out / 鬼消息清理 / 点对点信道维护）。**这是本 ADR 最关键的取舍**——协调≠通信，共享只读感知 + 独立推理足以替代双向协商。

### 4.3 Alternative C：纯聚合% 无任何通道

最简——只看聚合配额%、headroom/M 闸挡过冲。**否决为「全部」、降为退化态**：能挡过冲但无价值感知协调（不知道隔壁是高价值冲刺还是低价值闲置）。降为「读不到感知通道时的 fail-safe 退化态」，不作常态。

### 4.4 Alternative D：board 加数字 priority 字段（进窄腰 / 喂引擎调度）

把 priority 升入 narrow-waist、让引擎按数字 rank 调度。**否决**——board-v2 有意无 per-task 数字 priority（价值是判断、不是字段）。`coordination.priority` 故意留在 ✎ 块、不喂引擎、只当跨板协调 hint + 裁决骨架；进窄腰会把它升格成跨全 hook 契约改动且违背「价值是判断」。

### 4.5 Alternative E：中央调度器 / 全局锁分配配额

设一个中央组件统一分配各板配额。**否决**——单点故障、写争用、违 ship-anywhere 的去中心气质（红线 5）。本 ADR 用「只写自己板 + 跨板只读聚合」的 home substrate 避开。

## 5. Related

- [`ADR-010-two-sided-pacing-corridor.md`](ADR-010-two-sided-pacing-corridor.md) — `corridor_rate` 来源 + 7d 硬总闸（85%）；机械 floor 的 fair-share 在走廊速率上切份额，加速侧 headroom/M 防过冲建在双侧走廊欠用侧之上。
- [`ADR-015-estimation-and-pacing-engine.md`](ADR-015-estimation-and-pacing-engine.md) — 「引擎是 forecaster + 机械优化器、判断型优化归 orchestrator」分工的同源延伸；`coordination.priority` 不喂引擎（同 ADR-015 把判断留给 orchestrator）。
- [`ADR-016-board-scoped-orchestrator-authority.md`](ADR-016-board-scoped-orchestrator-authority.md) — `coordination` 与 `policy` 同为 ✎ 顶层字段；板级 priority 的用户声明与 repo-priority 用户配置同源。
- [`ADR-011-self-wakeup-watchdog.md`](ADR-011-self-wakeup-watchdog.md) — 复用 `owner.heartbeat` liveness 判 peer 板「活 + 心跳新鲜」。
- [`ADR-003-board-narrow-waist.md`](ADR-003-board-narrow-waist.md) / [`ADR-013-board-v2-data-model-and-cli.md`](ADR-013-board-v2-data-model-and-cli.md) — `coordination` 是 ✎ flexible 字段、不进窄腰，保红线 2；board-v2「砍 per-task priority」是本 ADR §2.2 reconciliation 的对象。
- [`ADR-018-hook-agent-message-protocol.md`](ADR-018-hook-agent-message-protocol.md) — 感知信号注入 agent context 时按标签包（`<ambient>` 背景 / `<advisory>` 建议），匹配「更新世界模型」与「value-aware 自调建议」的影响力度。
- `account-management` skill（切号机制·D1 切号机械化的机制 SSOT）+ `using-ccm`（`ccm peers` 命令面落点·锁步）+ `pacing-the-orchestration` 册多-orch 争用段（agentic 协调心智教学落点）。
- evergreen 设计文档（gitignored plans·schema / 两级裁决 / 配速两层 / `ccm peers` verb / fail-safe / 通信通道墓碑 / open questions 收口）：`../design_docs/plans/2026-06-29-coord-perception-communication.md`（COORD 完整设计）+ `../design_docs/plans/2026-06-29-loadbal-account-namespace-design.md`（LOADBAL 切号机械化·D1 事实前提）+ `../design_docs/plans/2026-06-26-resource-budget-model.md`（配额%权威 / 双轴 / 供给-需求 / M 折扣建模）+ `../design_docs/plans/2026-06-26-multi-orchestrator-coordination-adr-draft.md`（本 ADR 的草稿源）。

## 6. References

- 公地悲剧（tragedy of the commons）—— M 个孤立优化者同抽一个共享配额缸的集体过冲；机械 fair-share floor + headroom/M 是其去中心化缓解。
- 协调≠通信——共享只读状态 + 各自独立推理可替代双向消息协商达成的一致（本 ADR §4.2 砍通信通道的理论依据），与 cc-master「去中心 / 只写自己板 / 跨板只读聚合」的 ship-anywhere 气质同源。
