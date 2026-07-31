---
point: pacing.decision-vectors
---

## 权威陈述

<!-- ccm:k:start point:pacing.decision-vectors -->
## 可交给决策层的影响向量

1. **模型 / effort**：在不跌破任务 effect floor 的前提下，较低成本候选可能降低 burn，也可能增加返工。
2. **WIP**：同时消耗同一 quota scope 的叶子越多，窗口内 burn 通常越高。
3. **high-float**：非临界、token 重的工作可以跨 reset 推迟；临界链不能只因额度紧张就静默降质。

这些只是决策输入，不是动作。是否减 WIP、换候选、延后任务、停派、请求用户拍板或建立 watchdog，全部交回决策层。若决策层选择 wakeup，必须先取得真实 scheduler / background handle，再记录；`nearest_reset` 本身不是 handle，也不授权自动续跑。
<!-- ccm:k:end point:pacing.decision-vectors -->

## 失效类型

`environment_fact`（双重性质·方法部分补不回来，它才是承重结构） —— 删掉这条，模型知道这些向量存在，但在派发时间压力下会跳过「交回决策层」这一步，自行决策减 WIP 或延后任务。

主体是本系统里三条 burn 影响向量的含义及其在 pacing/编排分工中的归属，属本项目约定与词汇。

## 边界

仅适用于 orchestrator 的派发决策点（不是 executor 的任务执行环节）。

## 失败形态

Agent 自行调整 WIP 而不等 orchestrator 拍板；或自行决策延后任务、选择 wakeup 时机、切换账号，这些都是 orchestrator 的职责而非 agent 的。
