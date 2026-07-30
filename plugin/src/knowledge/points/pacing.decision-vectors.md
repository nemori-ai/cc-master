---
point: pacing.decision-vectors
---

## 权威陈述

<!-- ccm:k:start point:pacing.decision-vectors -->
## 可交给决策层的影响向量

1. **模型 / effort**：在不跌破任务 effect floor 的前提下，较低成本候选可能降低 burn，也可能增加返工。
2. **WIP**：同时消耗同一 quota scope 的叶子越多，窗口内 burn 通常越高。
3. **high-float**：非临界、token 重的工作可以跨 reset 推迟；临界链不能只因额度紧张就静默降质。

这些只是决策输入，不是动作。是否减 WIP、换候选、延后任务、停派、请求用户拍板或建立 watchdog，全部交回
`master-orchestrator-guide`。若决策层选择 wakeup，必须先取得真实 scheduler / background handle，再通过
`using-ccm` 记录；`nearest_reset` 本身不是 handle，也不授权自动续跑。
<!-- ccm:k:end point:pacing.decision-vectors -->
