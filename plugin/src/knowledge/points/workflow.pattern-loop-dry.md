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

## 失效类型

`capability_gap`（主体：事实方法） —— 删掉这条，模型不知道「seen 去重 + dry-round 判停」这个发现模式，倾向用固定计数或「信心足了就停」这类主观判断。

主体是 dry-round 收敛方法及其判据（对 seen 而非 confirmed 去重，否则被拒项每轮重现、loop 不收敛）。

## 边界

仅用于结果集大小难以预估、且需要「绝对穷举」而不是「样本代表」的场景；如果问题的结果集已知或足够小，固定计数或阈值判停更高效。

## 失败形态

Loop 在第 N 轮突然停止（因为某一轮无新发现），但之后又陆续出现新项；或混淆「confirmed 集合」（排斥被拒项导致重复轮询）与「seen 集合」（纯因重复跳过）。
