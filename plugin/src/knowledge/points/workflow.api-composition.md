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

## 失效类型

`environment_fact`（主体：事实方法） —— 维护者懂『workflow() 只能一层』的设计，但下个上下文全忘了这个约束，尝试两层嵌套或想在子 workflow 里再调 workflow()

workflow() 的嵌套限制、资源共享与抛错条件是本框架接口事实。

## 边界

约束『只能一层』是 harness 承诺，非可协商的 taste。唯一不适用的情况是『子 workflow 调 agent()（不是 workflow()）』——那不触发嵌套限制。想要多层嵌套必须把下层逻辑内联到上层。

## 失败形态

在子 workflow 内调 `workflow()`，触发 harness 错误『nested workflow call not allowed』。代码在某个中间层卡住；除非熟悉这个约束，否则会疑惑『为什么这个该死的 workflow 给我报错？』而不是立刻意识到『我需要把这层逻辑改成内联』。
