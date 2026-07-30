---
point: workflow.pattern-loop-count
---

## 权威陈述

<!-- ccm:k:start point:workflow.pattern-loop-count -->
## loop-until-count

**何时：** 你有一个明确的目标 count——「找 10 个 bug」「产出 5 个选项」。count 没到目标
就 loop，但**永远**留一个硬停（这里目标*本身*就是那个停；绝不写无界的 `while`）。

```js
const found = []
while (found.length < 10) {
  const r = await agent('find the next item not yet found')
  found.push(r)
}
```

**由谁演示：** loop 控制流 template 算一个家族——把
`assets/templates/loop-until-dry.js` 里的 dry-round 守卫换成一个 count 守卫即可。

---

<!-- ccm:k:end point:workflow.pattern-loop-count -->
