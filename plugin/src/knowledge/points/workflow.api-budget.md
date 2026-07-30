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
