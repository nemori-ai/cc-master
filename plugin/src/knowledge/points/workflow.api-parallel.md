---
point: workflow.api-parallel
---

## 权威陈述

<!-- ccm:k:start point:workflow.api-parallel -->
## `parallel(thunks) → Promise<any[]>`  — BARRIER

- **参数：** 一个 **thunk 数组**——`[() => agent(...), () => agent(...)]`。绝不是
  promise 数组（裸 promise 会立刻启动、绕开并发限流器）。
- **Barrier：** 等齐**全部** thunk，再按输入顺序返回一个结果数组。
- **Failure：** 抛错的 thunk → 对应槽位变 `null`。这个调用**绝不 reject**。所以事后总要
  `.filter(Boolean)`。
- **Cap：** 单次调用 ≤ 4,096 个 thunk。

<!-- ccm:k:end point:workflow.api-parallel -->
