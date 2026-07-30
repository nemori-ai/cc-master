---
point: workflow.api-caps
---

## 权威陈述

<!-- ccm:k:start point:workflow.api-caps -->
## 硬 caps（见 `mechanism.md` §6）

- 并发：每个 workflow `min(16, cpu cores − 2)`。
- 每次 run 的 agent 总量：1,000。
- 每次 `parallel`/`pipeline` 调用的 item 数：4,096。
- 脚本大小：512 KB。

<!-- ccm:k:end point:workflow.api-caps -->
