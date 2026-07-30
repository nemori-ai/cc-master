---
point: pacing.usage-estimate-tension
---

## 权威陈述

<!-- ccm:k:start point:pacing.usage-estimate-tension -->
## usage ⊗ estimate 张力（典型 `blocked_on:"user"` 输入）

配额侧 selected-target `ccm usage advise` 出 `throttle` 或硬停 verdict，但工作侧 `ccm estimate forecast` 的 p80 ETA 还很长 / `cost-to-complete` 的 p80 配额% 装不下该 target 当前可证余量——这是一个典型张力：**容量不够装完该装的活**。

- **识别输入**（消费层）：读两个字段对比——usage verdict（`throttle` / 硬停）✕ estimate `forecast.p80` 超期 或 `cost_to_complete_pct.p80` > 当前余量。
- **决策输入**：列出**范围 / 期限 / 用户已明确批准且 selected target 支持的容量**之间的张力；具体调度动作查 `master-orchestrator-guide`。
<!-- ccm:k:end point:pacing.usage-estimate-tension -->
