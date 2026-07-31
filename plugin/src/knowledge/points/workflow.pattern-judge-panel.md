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

## 失效类型

`environment_fact`（双重性质·方法部分补不回来，它才是承重结构） —— 模型知道多方案评分的逻辑和价值，但 deadline 压力下会想跳过「生成多个独立方案」这一步，直接单轨反复磨

多方案打分综合的思路虽通用，但承重的是本框架 parallel()/agent(schema) 的具体语法与示例资产位置。

## 边界

解空间宽阔、可以从多个不同角度独立生成方案时；单一约束条件下各方案高度相似时无需

## 失败形态

生成的多个「方案」其实是同一思路的微调而非本质不同的角度；或只按 style 变化（简洁 vs 详细）而非设计思路变化；或没有真的从亚军里综合学到新东西
