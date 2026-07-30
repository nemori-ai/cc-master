---
point: workflow.api-progress
---

## 权威陈述

<!-- ccm:k:start point:workflow.api-progress -->
## `phase(title) → void`

开启一个命名的 progress group；此后派生的 agent 都归进这个 group。`title` 必须精确匹配
某个 `meta.phases[].title`。在并发 stage 内部，改用 `opts.phase`（不会 race）。

## `log(message) → void`

在 progress tree 上方发一行叙述。用它来**把丢掉的东西明明白白说出来**——top-N 截断、
没重试、采样——免得这种悄悄的收窄被当成「full coverage」。

<!-- ccm:k:end point:workflow.api-progress -->
