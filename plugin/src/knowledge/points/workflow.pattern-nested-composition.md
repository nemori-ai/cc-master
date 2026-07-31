---
point: workflow.pattern-nested-composition
---

## 权威陈述

<!-- ccm:k:start point:workflow.pattern-nested-composition -->
## nested-workflow-composition

**何时：** 一个可复用的子流程已经存在——它是一个 saved workflow（或你早先 Write 出来的脚本
文件）——而你想把它当作更大脚本里的一个步骤来跑：逐项、带它自己的 `args`。
`workflow(nameOrRef, args)` 内联跑这个 child：它共用 parent 的并发 cap、agent 计数器、abort
signal 和 token budget（它的 token 计入 `budget.spent()`），它的 agent 渲染在一个 `▸ name`
group 下。两条硬边界：嵌套**只有一层**（child 里再调 `workflow()` 会抛错——让 child 保持
leaf-shaped），且名字未知 / `scriptPath` 读不到 / child 语法错误都会**抛错**——把这个调用
逐项包进一个 `catch`，这样坏掉的 child 只降级成一个内联 fallback，而不是把 parent 一起
拖死。别为了「让代码整齐」就伸手够它：一次 child run 要背上一整套 workflow 的机器开销——只
在 child 真的可复用、或需要独立维护时才组合。

**由谁演示：** `assets/examples/nested-workflow-composition.js`。

---

<!-- ccm:k:end point:workflow.pattern-nested-composition -->

## 失效类型

`environment_fact`（双重性质·方法部分补不回来，它才是承重结构） —— 压力下（快速迭代或追求代码优雅）agent 违反'只一层'约束，导致嵌套抛错或功能失败，或为复用把逻辑过度碎片化

主体是 workflow() 这个 primitive 在本引擎里的具体语义：共享 cap/budget/abort、只允许一层嵌套、名字或语法出错会抛错。

## 失败形态

嵌套多于一层时 child 调用抛错导致 parent 失败；或 child 失败未 catch 导致整个 workflow 停止；或代码表面整齐，实则把关键逻辑碎片分散到多个 workflow 文件，增加追踪维护成本。
