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
