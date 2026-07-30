---
point: dispatch.workflow-and-escalation
---

## 权威陈述

<!-- ccm:k:start point:dispatch.workflow-and-escalation -->
当一个节点选了 `workflow` executor，下一个问题是把活收进**一个** workflow 还是**多个**。首要的轴是**生命周期耦合（lifecycle coupling）**，不是数量。

- **一个 workflow** —— 叶子共享同一条生命周期：同一个 goal / schema / 质量闸 / budget envelope / 综合点 / 可接受失败策略，且运行中途没有 HITL 需求。
- **多个 workflow** —— 这些流在优先级 / 失败模式 / 重启成本 / budget 上限 / escalation / 整合时机上各不相同，或者每个都需要独立的闸讨论。

HITL 只是诸多轴之一；失败隔离、优先级、整合时机同样重要。**中层**：一个带多 phase 的单 workflow；一层 `workflow()` 嵌套。

---

## 靠 escalation 重新定位（core）—— 绝不盲杀

一个 `subagent` executor 发现自己其实是一张 **sub-DAG** 时：

- **绝不能自我提拔、也不能自行 fan out**（workflow 叶子同样不能 spawn）；
- 它 **STOP 并返回一个 escalation 结果**（一张 scope map + 提议的叶子 + deps + 部分证据 + 原因）；
- 你 **supersede** 旧节点，并用那张 map 去 seed 一个 `workflow` executor。

你**靠 checkpoint 重新定位，不靠盲杀。** 推论：一个 workflow 叶子的 prompt 必须足够小、且终端；拿不准时，先跑一个 scoping subagent / workflow。

对应的节点状态路由：`uncertain → 验证节点`；`stale → 上游变了，重跑`；`escalated → supersede → workflow`。

---

## Hybrid + admission control

顶层可以同时有一个后台 shell + N 个 `subagent` + 一个 `workflow` 在飞。用 admission control 来治理它：

- **启动前先预留** —— 启动那一刻就预留 WIP + token budget（reserve-on-launch，不是 spend-then-report）。
- **WIP cap 把整合负担也算进去** —— 避免 N 个 workflow 一齐返回时的同步悬崖（synchronization cliff）。
- **并发上限 = 取 min**：CPU/IO、模型 budget、rate limit、context-return budget、综合负载，几者中的最小值。

---

<!-- ccm:k:end point:dispatch.workflow-and-escalation -->
