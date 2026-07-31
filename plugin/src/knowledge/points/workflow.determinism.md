---
point: workflow.determinism
---

## 权威陈述

<!-- ccm:k:start point:workflow.determinism -->
## 4. Determinism三禁（三件被禁的事）——以及*为什么*

在 workflow 脚本里，三个经典的 JavaScript 非确定性来源会**抛错（fail-loud）**：

1. `Date.now()`
2. `Math.random()`
3. 无参 `new Date()` / `Date()`——但 `new Date(specificValue)` 没问题。

**为什么：** 一次 run 会被 journal 记下来以便 resume。Resume 时，未变前缀的 `agent()`
结果直接从 cache 重放（§5）。要是脚本的*控制流*依赖了墙钟或某次随机抽样，重放就会和原始
run 分叉、journal 也就失去意义——cache 会悄悄变 stale。所以 runtime 干脆禁掉这种非确定性，
而不是让 resume 默默坏掉。

**变通办法：**
- 需要时间戳？用 `args` 传进来。
- 需要让 agent 各不相同？按 **loop index** 或一个 **per-index label** 来改 prompt，别用
  随机。

所以你的 `Date.now()`「破坏了 resume」，真相其实是反过来的：runtime 抛错正是为了*保护*
resume——脚本必须确定，最长未变前缀的 cache 才成立。

<!-- ccm:k:end point:workflow.determinism -->

## 失效类型

`environment_fact`（主体：事实方法） —— 删掉后 agent 会在 workflow 脚本里正常使用这三类非确定性调用,不知道它们会被 fail-loud 拒绝、也不理解这是为了保护 resume 的重放一致性,遇到报错时可能误以为是 bug 而尝试绕过而非改用参数传入或 loop index。

主体是本 runtime 会抛错的三个具体 API（Date.now/Math.random/无参 new Date）及其 resume 缘由与替代写法，属于工具事实。

## 失败形态

agent 确实没直接调用被禁的三个 API,却改用同样非确定的绕行手法(比如读一个每次运行都会变化的环境变量、或用文件 mtime 代替时间戳)达成同样效果——字面没触发禁令,实质仍引入了非确定性,resume 时依然会分叉。
