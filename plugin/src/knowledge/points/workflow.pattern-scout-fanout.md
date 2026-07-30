---
point: workflow.pattern-scout-fanout
---

## 权威陈述

<!-- ccm:k:start point:workflow.pattern-scout-fanout -->
## scout-then-fanout (entry shape)

**何时：** 动手之前你还不知道 work-list——现实里最常见的入口形状。让一个 scout agent 返回
这份 list，再对它 pipeline / parallel。（通常你会把 scout 内联在主线里跑；这里给的是
in-workflow 的版本。）

```js
const scout = await agent('enumerate the work items as a JSON list', { schema: ITEMS })
const out = await pipeline(scout.items ?? [], (it) => agent(`process ${it}`))
```

**由谁演示：** `assets/templates/scout-then-fanout.js`。

---

<!-- ccm:k:end point:workflow.pattern-scout-fanout -->
