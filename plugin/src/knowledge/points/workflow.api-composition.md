---
point: workflow.api-composition
---

## 权威陈述

<!-- ccm:k:start point:workflow.api-composition -->
## `workflow(nameOrRef, args?) → Promise<any>`

内联跑另一个 workflow，并返回它的返回值。传一个 saved workflow 名字或 `{scriptPath}`。

- **只有一层：** 在一个*子* workflow *内部*再调 `workflow()` 会抛错。
- 子 workflow **共用**本次 run 的并发 cap、agent 计数器、abort signal 和 token budget。
- 名字未知 / 路径读不到 / 子 workflow 语法错误，都会**抛错**——用 `catch` 接住、优雅降级。
- 由 `assets/examples/nested-workflow-composition.js` 演示（逐项的 child run +
  catch-and-degrade fallback）。

<!-- ccm:k:end point:workflow.api-composition -->
