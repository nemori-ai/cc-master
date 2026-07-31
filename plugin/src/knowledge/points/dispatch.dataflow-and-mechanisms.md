---
point: dispatch.dataflow-and-mechanisms
---

## 权威陈述

<!-- ccm:k:start point:dispatch.dataflow-and-mechanisms -->
派发一个 task，你在做**两个不同层面**的选择，别混为一谈：

- **executor 值**（board 上「谁执行」）—— 记在 task 上的一个 5 选 1 长期语义，扛 compaction、resume 靠它 recon。它回答「这个 task 归谁负责」：`subagent` / `workflow` / `master-orchestrator` / `user` / `external`。
- **后台机制**（「你怎么真跑你负责执行的那些」）—— 你此刻实际抄起哪个工具把活跑起来：{{BACKGROUND_DISPATCH_MECHANISM_LIST}}。它回答「怎么让它真的动起来」。

两层怎么对上：

{{BACKGROUND_DISPATCH_EXECUTOR_MAPPING}}

**分工**：本文教**派发判断 + 后台机制**——选哪个 executor / 用哪个机制真跑 / 怎么编排并行。`executor` 各值的**必填字段**（`subagent`/`workflow` 必给 handle、`external` 必给引用）与**选值决策树**是 board 字段机制——本文不复述。

---

## 分形的三个高度

派发在三个高度上是分形的——选一个后台机制，就等于选一个节点在哪个高度执行：

- **顶层（主线）** = 一个 **dataflow 调度器**：把后台机制派到 DAG 节点上、并穿插 HITL，受 WIP + 一份共享预算约束，一切都记在 board 上。
- **中层** = 一个 workflow *内部*的 fan-out（`workflow` executor 的活）。
- **叶子** = 一个 sub-agent / shell（`subagent` executor，或一个等外部状态的 shell）。

---

## 两个尺度上的 dataflow —— 为何这些高度是自相似的

这三个高度不是三个想法——它们是**同一个 dataflow 想法（就绪即派、绝不在 barrier 处阻塞）在两个尺度上的两次现身**。把这点内化，你才能把同一个本能带进一个陌生情境，而不是去对照一张规则清单。

学术根源是 LLM-Compiler 的 **Task Fetching Unit（TFU）**：一条依赖在它的输入就绪那一刻就被派出去；已经能跑的东西绝不等一个还没就绪的；而且 planner 流式地吐图，让 plan 和 execute overlap。cc-master 在两个尺度上跑的是同一套算法：

- **宏观（主线）—— dataflow 作为一种内化的*心态*。** 决策程序*本身*就是一个手跑的 TFU：对账 board（observation 黑板）→ 派发就绪任务（fetch-when-ready）→ 在空隙里塞 fill-work（planner/executor overlap）→ 在端点验收（Joiner 闸）→ 唯有就绪集为空才等。这里**没有 `pipeline()` 原语**——主线 DAG 是动态的、异构的、里头还有个人，没有任何 compile-time 脚本能表达它。Dataflow 在这里以纪律存在（就绪即派、绝不在 barrier 干等），不是代码。
{{DATAFLOW_MICRO_SCALE_GUIDANCE}}

**两个尺度之间的切线，就是按动态性切的。** 必须运行中途随机应变的工作——对一个外部完成做出反应、把一个 escalation 重新定位、吸收一个 HITL 回答——归宏观尺度（board + 决策程序，LLM 在 loop 里）。能在 compile time 就固定下来的工作——一批同构项目流过固定 stage——归一个 `pipeline()`。这正是把 LLM-Compiler 那条切线 *"LLM 吐图、代码调度它"* 从单个 agent 任务放大到整场 long-horizon 编排：主线 LLM 做动态规划（吐图 + replan），workflow 脚本做确定性调度。自相似——一个尺度嵌在另一个里。

**防你过度套用的告诫。** `pipeline()` 优化的是*吞吐量*（许多同类项目穿过固定 stage）；而一个单一的 long-horizon 目标是一张*异构 DAG*，治理它的工具是**临界路径**（CPM / work-span），不是 pipeline 吞吐量。所以 pipeline 并行只是 cc-master 的一个**构件（constituent）**，不是它的顶层骨架：

- **临界链**定 makespan——pipelining 救不了一条串行依赖；
- 只有**非临界 float** 才是 pipeline / fan-out 能填的免费并行预算；
- **一批同类子任务**（迁移 N 个文件、review N 条 finding）才是它的主场。

顶层骨架是 dataflow DAG *调度*；`pipeline()` 只是项目恰好同构时它退化成的特例。在一条串行临界链上硬抓 fan-out 是经典的误套——T₁/T∞ ≈ 1 时，根本别 fan out。拓扑复杂、拿不准这条链到底是不是 T₁/T∞ ≈ 1（心算易错估）时，可 `ccm board graph` 机器读 `parallelism` 值佐证；平凡图一眼看穿就别跑。

---

## 五个 executor 值 —— board 上「谁执行」

给每个节点定一个 executor 值。高层 min-max（默认把派出去的实现工作当 `subagent`、`master-orchestrator` 只留调度 / 验收给自己）在编排魂的决策模块；这里给逐值的语义 + 什么样的活配它：

{{EXECUTOR_VALUE_GUIDANCE}}

---

## 后台机制 —— 你怎么真跑你负责执行的那些

{{BACKGROUND_DISPATCH_MECHANISMS}}

### 等待外部状态 —— 用一个后台 shell

{{BACKGROUND_EXTERNAL_WAIT_GUIDANCE}}

> **澄清（与「禁 busy-poll」并不矛盾）：** 那里禁的是**主线前台 busy-poll**——你在前台空转忙等。这里的后台 shell 轮询正交：轮询关进一个零 token 后台 shell、骑完成通知重入，主线腾出来去填等待窗口。后台等外部状态（荐）≠ 前台空等单个 agent（禁）。

---
<!-- ccm:k:end point:dispatch.dataflow-and-mechanisms -->

## 失效类型

`capability_gap`（主体：事实方法） —— 模型不会自发想到把「谁负责执行」和「怎么真跑起来」拆成两层、并在多个高度上递归套用同一套就绪即派的调度心态，删掉后会退回逐项排队等待的默认直觉。

主体是 dataflow 在宏观与微观两尺度自相似的调度框架（TFU、临界路径 vs pipeline 吞吐量），executor 具体取值明确指向 using-ccm 不在此复述。

## 失败形态

board 上执行归属字段填得规规矩矩（比如标了某个合法值），看起来「派发记录」完整合规，但实际操作上主线原地等这一个节点跑完才去看下一个——字段值填对了，行为却退化成同步阻塞，两层分离形同虚设。
