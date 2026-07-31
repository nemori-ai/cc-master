---
point: workflow.barrier-vs-streaming
---

## 权威陈述

<!-- ccm:k:start point:workflow.barrier-vs-streaming -->
## 3. `parallel`（barrier）vs `pipeline`（streaming）——核心澄清

两者都「并行跑东西」，但**形状**截然不同。这是最常见的混淆来源。

**`parallel(thunks)`——一道 barrier fan-out。**
- 收一个 **thunk 数组**：`[() => agent(...), () => agent(...)]`——**不是** promise 数组。
  （裸 promise 会立刻启动、绕开并发限流器，是个已知的反模式。）
- 它是一道 **barrier**：返回前等齐*每一个* thunk。
- 它**绝不 reject**：抛错的 thunk 在自己的结果槽位里变 `null`。所以总要 `.filter(Boolean)`——
  这个结果数组天生就会有洞。
- **只**在下游某步真的要一次性拿到整个集合时才用：跨集合的 dedup / merge、按 count 提前
  退出（「0 bug → 跳过全部 verification」），或拿单个 item 跟整组比。

**`pipeline(items, ...stages)`——no-barrier 流式。**
- 每个 item **独立**流过**所有** stage——item A 可以在 stage 3，而 item B 还在 stage 1，
  stage 之间没有 barrier。
- 墙钟时间 ≈ *最慢那个 item 走完整条链*的耗时，不是各步最慢 stage 加总。
- 每个 stage 回调收到 `(prevResult, originalItem, index)`——用 `originalItem`/`index` 给后
  续 stage 标注，别手动把 context 一路串下去。
- 抛错的 stage 把那个 item 降为 `null`，并跳过它余下的 stage。
- **多阶段工作就默认用它。**

### Smell-test（决定用哪个）

如果你发现自己在写：

```js
const a = await parallel(...)
const b = transform(a)        // flatten / map / filter — NO cross-item dependency
const c = await parallel(b.map(...))
```

……那么中间这个 `transform` **不**需要 barrier——把它改写成一个 pipeline：
`pipeline(items, stageA, r => transform([r]).flat(), stageB)`。

只有当 stage N 真的要拿 stage N−1 的*整个集合*时（dedup / merge、按 count 提前退出、
「跟其余每个 finding 比」），barrier 才站得住。「代码更整齐」和「这些 stage 概念上各自
独立」**都不是**用 barrier 的理由——barrier latency 是实打实的：5 个 finder、最慢的是
最快的 3 倍时，barrier 白白浪费掉那几个快 finder 三分之二的空闲时间。

<!-- ccm:k:end point:workflow.barrier-vs-streaming -->

## 失效类型

`environment_fact`（主体：事实方法） —— 不知道两个 primitive 具体的失败语义与形状差异（thunk 数组非 promise、barrier 绝不 reject、pipeline 逐 item 独立流过 stage），会把它们当成等价选项互换使用，造成不必要的等待或漏判空槽位。

主体是本 runtime 两个 primitive 的语义差异（parallel 收 thunk、绝不 reject、返回槽位有 null；pipeline 无 barrier、stage 回调签名），不知道这些就写不对脚本。

## 边界

只在判断该用哪个 primitive 时适用；已经确定用某一个之后，如何组织具体 stage 内部逻辑不受这条约束。

## 失败形态

代码结构上用了流式而不是 barrier，看起来『选对了』，但某个 stage 里悄悄攒了一个跨 item 的数组再统一处理——形式上是无阻塞流式，实质上人为造出了一个隐藏同步点，拿不到本该有的时间收益。
