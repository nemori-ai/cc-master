---
point: pacing.upper-bound-only
---

## 权威陈述

<!-- ccm:k:start point:pacing.upper-bound-only -->
## 只在上界收紧

pacing 没有“额度空闲所以自动加速”的欠用侧。`healthy` / `hold` 只表示当前已证明的承重窗口未触发收紧；
它不覆盖模型准入、任务质量、权限或安全条件。`tight` / `throttle` 表示需要决策层评估减速；
`exhausted` / `stop_*` 表示该 target 的承重窗口已进入硬边界。unknown 永远不等于 healthy。

按精确 target 解读：

- **Claude Code**：5h 与 7d 都承重；`switch_candidate` 只是一份账号池候选事实，不是换号授权。
- **Codex**：只接受 7d hard gate；5h、`stop_5h`、`switch` 与 `switch_candidate` 不属于有效 Codex pacing
  合同。Codex 自动换号永久禁止；rolling-24h 只作 burn-risk advisory。
- **Cursor**：IDE 与 Agent 各自只接受自己的 billing-period posture；`stop_billing_period` 只约束对应
  surface。Cursor 自动换号永久禁止，两条 surface 不互相兜底事实。

<!-- ccm:k:end point:pacing.upper-bound-only -->
