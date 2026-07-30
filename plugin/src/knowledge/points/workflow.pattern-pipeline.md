---
point: workflow.pattern-pipeline
---

## 权威陈述

<!-- ccm:k:start point:workflow.pattern-pipeline -->
## pipeline-by-default

**何时：** 多阶段工作，stage 之间**无须**同步——item A 可以走到 stage 2，而 item B 还在
stage 1。这是任何多阶段形状的**默认**；只有当某个 stage 真的要拿整批前一阶段的集合时，才
升级到 barrier（见 `mechanism.md` §3 的 smell-test）。

```js
const out = await pipeline(items,
  (it) => agent(`stage 1 for ${it}`),
  (prev, it) => agent(`stage 2 for ${it} using ${JSON.stringify(prev)}`),
)
```

**由谁演示：** `assets/templates/pipeline.js`（裸的流式形状）。

---

<!-- ccm:k:end point:workflow.pattern-pipeline -->
