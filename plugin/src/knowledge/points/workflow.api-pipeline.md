---
point: workflow.api-pipeline
---

## 权威陈述

<!-- ccm:k:start point:workflow.api-pipeline -->
## `pipeline(items, ...stages) → Promise<any[]>`  — NO BARRIER

- **参数：** 先一个 `items` 数组，再跟一个或多个 stage 回调。
- **流式：** 每个 item 独立流过所有 stage——stage 之间没有 barrier。
- **Stage 签名：** 每个 stage 回调收到 `(prevResult, originalItem, index)`。
- **Failure：** 抛错的 stage 把那个 item 降为 `null`，并跳过它余下的 stage。
- **Cap：** 单次调用 ≤ 4,096 个 item。

<!-- ccm:k:end point:workflow.api-pipeline -->
