---
point: workflow.pattern-judge-panel
---

## 权威陈述

<!-- ccm:k:start point:workflow.pattern-judge-panel -->
## judge-panel

**何时：** 解空间很宽，「在一个 attempt 上反复迭代」不如「生成几个独立 attempt 再挑」。从
不同角度生成 N 个方案（MVP-first / risk-first / user-first），用一个并行 judge 给它们打分，
从胜者综合、再把亚军里最好的部分嫁接过来。

```js
const proposals = await parallel(ANGLES.map((a) => () => agent(`design from angle: ${a}`)))
const scored = await parallel(proposals.filter(Boolean).map((p) => () =>
  agent(`score 0-10:\n${JSON.stringify(p)}`, { schema: SCORE }).then((s) => ({ ...p, score: s.score }))))
const winner = scored.filter(Boolean).sort((a, b) => b.score - a.score)[0]
const final = await agent(`synthesize from the winner:\n${JSON.stringify(winner)}`)
```

**由谁演示：** `assets/examples/design-judge-panel.js`。

---

<!-- ccm:k:end point:workflow.pattern-judge-panel -->
