---
point: control.navigation-map
---

## 权威陈述

<!-- ccm:k:start point:control.navigation-map -->
这份魂只装编排的**决策骨架**；专门知识不在这里——在你的**兄弟 skill** 和你自己的 **references** 里。别预加载：命中触发条件时才去调（progressive disclosure）。唤起一个兄弟 skill = 一次真实的 `Skill` 工具调用；drill 一份 reference = 读那个文件。

### 兄弟 skills（何时唤起哪个）

你不是一个人在编排——六个专门 skill 各管一段，你在决策点**单向引用**它们、不复述其内容：

| skill | 管什么（一句） | 何时唤起 |
|---|---|---|
{{AUTHORING_WORKFLOWS_ROW}}
| **using-ccm** | 怎么用 `ccm` 操作 board + account 号池（命令面 + 字段取值 + 全部校验规则） | 任何 board 写操作、敲 `ccm` 命令、撞 exit 2/3、录号/换号时 |
| **slicing-goals-into-dags** | 怎么把目标**切**成 DAG（纵切薄增量 / walking skeleton / 粒度 / 价值风险排序） | 「这目标怎么拆 / 先做什么」——「切」先于你「目标即依赖图」镜头的「排」 |
| **dev-as-ml-loop** | 把 dev 工作当优化系统：你设计外层 loop 与 handoff，执行 agent 跑单任务内层 loop | 派发 dev 任务前用它塑形 objective / measurement / artifact / restart；执行者用它把任务优化到验收 |
| **engineering-with-craft** | 领域 / 类 / 合约 / 测试**本身**怎么建得好（DDD/OOP/SDD/TDD 五根 + 工程红线） | 派发的任务涉及设计/建模/写测试的手艺**内容**时（同 F，多由执行者用） |
| **pacing-and-estimation** | 读 ccm `usage`/`estimate` 与跨 provider model-policy 只读 advisory（verdict / 角色证据 / 成本 / taste / EVM / 诚实字段） | 读 usage/estimate/model-policy 输出、判同档重排或拿不准 forecast / affinity 信不信时（**ccm 出事实与 advisory、你决策**） |

> **分工红线**：**你 = 决策 + 排期 + 换号决策锚**；切分归 `slicing-goals-into-dags`、执行循环形状归 `dev-as-ml-loop`、手艺内容归 `engineering-with-craft`、读 advisory 消费归 `pacing-and-estimation`、ccm 操作机制归 `using-ccm`、workflow 写法归 `authoring-workflows`。越界复述会破坏 skill 间互不重叠的边界。

### 你自己的 references（何时 drill）

深度细节从魂下沉到这里，保持魂瘦。大部分在七镜头处已内联指针；这是 at-a-glance 索引：

| reference | 何时 drill |
|---|---|
| `goal-contract.md` | fresh 澄清/改写目标、长需求落 Goal Brief、工作追溯、防 scope 漂移、amend revision、完成前全局验收 |
| `outside-in.md` | 规划 / 设计 / replan 中某**承重判断只由内部推断支撑**、缺外部证据时：证据五分级、校准成本阶梯、无外部通道时诚实记未知 + 可逆实验、外部证据改 goal 语义走 amendment、低风险可逆豁免 |
| `decomposition.md` | 一张**已切好**的 DAG 怎么**排期**（CPM / float / 临界路径；心算 或 `ccm board graph` 机器算 §3） |
| `deadline-discipline.md` | 这块板背着一个交付 DDL（截止期）时的九条编排纪律（倒排 / 按时优先于扩产出 / 简单性正则 / slack 管理 / 尽早 surface 风险 / `decision_package` 升级 / 提前收口 / replan 不漂移 / 收敛即停） |
| `worker-routing.md` | **派发与选型唯一入口**：任务形状 → executor → target surface → `O / T1 / T2 / T3` floor → exact qualification → 同档排序/fallback → 真实 handle → 端点验收；fresh agent 从这里一次 drill 完成整条 routing record |
| `model-allocation.md` | floor 已定后，深化复杂性 / 风险 / duration 判断，以及容量收紧时怎样保持 floor 并联动 WIP / float / background / watchdog / 用户决策 |
| `dispatch.md` | {{DISPATCH_REFERENCE_SUMMARY}} |
| `async-hitl.md` | HITL / 采访式决策 / **step-6 ledger** / 等待前 arm watchdog / 前台∥后台派发顺序 |
| `board.md` | board 协议 narrative + 长程操作纪律（窄腰 / status enum / 续跑 / 读写关卡） |
| `resume-verify.md` | 廉价续跑 + 端点验收 + content-hash + **异构族系第二视角**（高杠杆/临界强制）+ **resume 第 0 步落 worktree** |
{{COST_DECISIONS_REFERENCE_ROW}}
| `multi-layer-planning.md` | 派发的大节点**内部**本身是复杂规划问题时（board ⊥ 项目自身 planning 层） |
{{HANDOFF_REFERENCE_ROW}}

### 派发与选型导航：只进一个入口

准备派 worker 时直接 drill `references/worker-routing.md`，按它的一条有序链完成 routing record；你不再从主 skill 自己串起 dispatch、model、pacing、provider 与 lifecycle 文档。只有 hub 明确指出某个非平凡机制或动态事实需要展开时，才沿它的 owner 地图继续读。`usage` / `estimate` advisory 的解释仍归 `pacing-and-estimation`，号池操作仍归 `using-ccm`。

### 你与用户之间的 commands（知道它们存在）

{{COMMAND_SURFACE_GUIDANCE}}

---

<!-- ccm:k:end point:control.navigation-map -->
