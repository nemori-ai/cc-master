---
point: workflow.pattern-loop-budget
---

## 权威陈述

<!-- ccm:k:start point:workflow.pattern-loop-budget -->
## loop-until-budget

**何时：** 深度要随用户的 `'+Nk'` budget 指令伸缩，而理想的 count 又说不准。共享 token
budget 还有余量就 loop。`budget.total` 守卫是必须的——少了它，`remaining()` 就是
`Infinity`，loop 会一路跑到 1,000-agent 的 cap。

```js
const RESERVE = 50_000
const out = []
while (budget.total && budget.remaining() > RESERVE) {
  out.push(await agent('produce the next batch'))
}
```

**由谁演示：** `assets/templates/loop-until-budget.js`。

---

<!-- ccm:k:end point:workflow.pattern-loop-budget -->
