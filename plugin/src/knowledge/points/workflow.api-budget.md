---
point: workflow.api-budget
---

## 权威陈述

<!-- ccm:k:start point:workflow.api-budget -->
## `budget`——注入的全局

`{ total, spent(), remaining() }`，一个共享的 output-token 池。

- `budget.total` = 用户给的 `'+500k'` 式目标；没设就是 `null`。
- `budget.spent()` = 本回合的 output token，**跨 main loop 和所有 workflow 共享**
  （不是 per-workflow）。
- `budget.remaining()` = `max(0, total − spent())`；没设目标时是 `Infinity`。
- 目标是一道**硬上限**：`spent()` 一旦触到 `total`，新的 `agent()` 调用就**抛错**。
- **budget loop 永远用 `budget.total` 来守：**
  `while (budget.total && budget.remaining() > 50_000) { ... }`——少了这个守卫，
  `remaining()` 就是 `Infinity`，loop 会一路冲到 1,000-agent 的 cap。

<!-- ccm:k:end point:workflow.api-budget -->

## 失效类型

`environment_fact`（主体：事实方法） —— 删掉这条，模型不知道硬上限守卫的具体形式，会写出 `while (budget.remaining() > 50_000)` 这样的漏洞，在 total=null 时无限扩张。

budget 对象的字段语义、共享范围与守卫写法是本框架的接口事实。

## 边界

仅适用于循环次数不可预测的 workflow 模式（如发现循环、条件逐步细化）；固定迭代次数的 workflow 不需要此守卫。

## 失败形态

loop 条件写法从 `while (budget.total && budget.remaining() > THRESHOLD)` 变成 `while (budget.remaining() > THRESHOLD)`，在 total=null 时无限扩张；或条件整个被删除。
