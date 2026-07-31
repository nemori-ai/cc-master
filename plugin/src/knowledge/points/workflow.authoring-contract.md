---
point: workflow.authoring-contract
---

## 权威陈述

<!-- ccm:k:start point:workflow.authoring-contract -->
## 3. 写作流程——照 harness 契约起草，再 launch

1. **起草**：从 `assets/templates/` 里的某个骨架（或 `assets/examples/` 里某个完整组合）
   起手，填进真实的 prompt、schema、work-list。`meta` 必须是第一条语句、且是一个纯字面量
   （`name` + `description`）。
2. **照 harness 的 validation 契约写。** runtime 才是权威的 checker——**没有一个独立的
   linter 要你跑，你也不该自己造一个**。契约如下：
   - `meta` 是第一条语句、是纯字面量（`name` + `description` 必填）——harness 在 **launch
     时**校验。
   - 不出现 `Date.now()` / `Math.random()` / 无参 `new Date()`——它们会破坏 resume，harness
     在 **runtime 抛错**。
   - 不出现 `require` / node-builtin import / `process.*`——sandbox 一律拒收。
   - `parallel()` 收 thunk（`() => ...`），不收裸 promise（裸 promise 会立刻 eager 执行、
     barrier 也就丢了）。
   - 守住 caps（16 并发 / 1,000 总量 / 单次调用 4,096 / 512 KB）。

   每条约束的含义和缘由见 `references/mechanism.md`。
3. **Launch。** harness 拒收脚本或抛错时，它的报错就是权威——读它，照
   `references/mechanism.md` 修好，再 relaunch。

> **为什么不配 linter？** `meta`（launch 时）和 determinism / caps / escape（runtime 时）
> harness 都已经权威地校验过了。再造一个独立的 static linter，无非是把 harness 自己的检查
> 用启发式重写一遍——会漂、还比真货差。所以本 skill 只教你契约，不 ship 第二个 validator。
> （编排原则「信确定性 endpoint、不信 prose 自检」在这里由 harness 兑现——它*就是*那个
> endpoint。）

<!-- ccm:k:end point:workflow.authoring-contract -->

## 失效类型

`environment_fact`（主体：事实方法） —— 删掉后,agent 会用通用 JS 写法(如 Date.now()、裸 promise)去写 workflow 脚本,因为不知道这个 harness 具体禁止什么、具体的并发/体积上限是多少,导致 launch 被拒或 resume 语义被破坏。

主体是 harness 的具体 validation 契约清单（meta 必须首条字面量、determinism 三禁、禁 require/process、parallel 收 thunk、四个 cap 数字），删掉就不知道本 harness 认什么。

## 边界

适用于会被真正 launch 到 harness 里执行的 workflow 脚本;对不打算 launch 的练习性代码片段不适用,因为契约靠 launch-time/runtime 报错把关,没有 launch 动作契约无从谈起。没有真实例外——契约由 runtime 强制,不存在『这次可以不遵守』的情形。

## 失败形态

parallel(fn()) 而非 parallel(() => fn())——脚本语法合法、launch 不报错,但传入的 promise 在传参那一刻就已经 eager 执行,预期的并发 barrier 已失效;这类问题不会被明显报错拦下,只在实际执行时间线错乱后才会被发现。
