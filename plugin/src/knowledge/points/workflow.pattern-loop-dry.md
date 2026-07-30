---
point: workflow.pattern-loop-dry
---

## 权威陈述

<!-- ccm:k:start point:workflow.pattern-loop-dry -->
## loop-until-dry

**何时：** 规模未知的发现——找出*所有* bug、*所有*调用点。固定计数会漏掉尾巴，dry-round
不会。去重要对着 `seen` 集合做（别用 `confirmed` 集合，否则被拒的项每轮都重新冒出来、loop
永不收敛），连续 K 个 round 什么新东西都没冒出来就停。

```js
const DRY_LIMIT = 2
const seen = new Set(), all = []
let dry = 0
while (dry < DRY_LIMIT) {
  const r = await agent('find items not yet in the seen set', { schema: ITEMS })
  const fresh = (r.items ?? []).filter((x) => !seen.has(x))
  if (fresh.length === 0) { dry++; continue }
  dry = 0
  fresh.forEach((x) => { seen.add(x); all.push(x) })
}
```

**由谁演示：** `assets/templates/loop-until-dry.js`。

---

<!-- ccm:k:end point:workflow.pattern-loop-dry -->
