---
point: devloop.ml-components
---

## 权威陈述

<!-- ccm:k:start point:devloop.ml-components -->
## subagents as ML components

派发前先问:这个优化系统缺哪个组件,而不只是"谁来写代码"。

| 组件 | subagent 负责什么 | 典型产物 | 防什么失败 |
|---|---|---|---|
| objective owner | 锐化验收、非目标、真实意图 | acceptance/spec delta/decision_package | 目标模糊下随机游走 |
| instrumentation builder | 建测试、repro、fixture、benchmark、endpoint check | failing test/repro/验证命令 | 闭眼优化或假梯度 |
| hypothesis generator | 探方案、spike、架构备选 | option memo/spike result | 过早 exploit 一条路 |
| optimizer | 做 scoped implementation | patch/diff/artifact | 没有下降 |
| evaluator | 独立端点验收、读 diff | verification transcript/hash | self-report pass-through |
| regularizer | 查复杂度、抽象、依赖、gold-plating | simplification/risk note | green 但长期负债 |
| restart trigger | 识别 plateau、坏仪器、沉没成本 | replan/split/reassign note | 补丁栈局部最小值 |

这些不是每个任务都必须配齐的岗位,而是一套调度词汇。简单任务一个执行 agent 可兼多职;复杂/高风险任务要显式拆出测量、探索、验收、正则化职责。

---

<!-- ccm:k:end point:devloop.ml-components -->
