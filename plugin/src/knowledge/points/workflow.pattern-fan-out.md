---
point: workflow.pattern-fan-out
---

## 权威陈述

<!-- ccm:k:start point:workflow.pattern-fan-out -->
## fan-out + synthesize

**何时：** 一个任务拆成若干独立部分，而你得把它们*全部*收齐才能合并——「review 这个 diff
里的每个文件」「audit 全部 40 个依赖」「map 每个 struct 字段」。用 `parallel()`，因为综合
那一步要拿整个集合。

```js
const parts = await parallel(items.map((it) => () => agent(`work ${it}`)))
const summary = await agent(`synthesize:\n${JSON.stringify(parts.filter(Boolean))}`)
```

**由谁演示：** `assets/templates/fan-out.js`（裸的 barrier 形状）。

---

<!-- ccm:k:end point:workflow.pattern-fan-out -->

## 失效类型

`capability_gap`（主体：事实方法） —— 不知道独立任务收齐后综合时用 parallel barrier，会误用流式或无序处理，导致漏任务或结果顺序错乱

主体是 fan-out + synthesize 这个模式及其适用判据（综合步需要整个集合时才用 barrier）。

## 边界

只适用于『多个独立部分、必须收齐整批才能合并』的场景。若允许流式处理中间结果或增量综合，不需要 barrier；用 pipeline + streaming 即可。

## 失败形态

不知道 barrier 模式，可能误用流式（fan-out 后逐个处理逐个推送给综合阶段，结果不完整就先给了下游）；或虽然 fan-out 了多个任务但没有显式等待全部完成就继续，导致竞态条件或漏项。代码形式上『好像』在并行，实质已违反了『收齐』这个前提。
