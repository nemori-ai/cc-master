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

## 失效类型

`environment_fact`（主体：事实方法） —— 缺本框架对 parallel() API 的特定约定：thunk 数组、barrier 语义、failure-as-null、4096 thunk 上限

parallel() 收 thunk 数组、barrier 语义、失败置 null 与 cap 是接口事实。

## 边界

parallel 的 thunk barrier 用于派发多个独立工作并等齐所有结果的并发场景。禁止用于：① 已启动的 promise 数组（失去流量控制）② 需要短路的逻辑（任一失败即中止）③ 结果间有强依赖（应用 pipeline）。thunk 数组必须是纯函数工厂、每个 thunk 调用时执行。单次调用上限 4096 thunk。

## 失败形态

最常见：直接传 promise 数组而非 thunk 数组，所有 promise 立即启动绕过限流。次常见：拿到结果数组后遗忘 .filter(Boolean) 处理 null 槽位，后续代码崩溃。隐蔽形态：以为 4096 上限充裕，实际超限报错；或没有预期 failure-as-null 的行为，以为某个 thunk 失败会导致整体 reject。
