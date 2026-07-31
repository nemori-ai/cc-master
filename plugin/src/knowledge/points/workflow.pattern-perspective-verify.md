---
point: workflow.pattern-perspective-verify
---

## 权威陈述

<!-- ccm:k:start point:workflow.pattern-perspective-verify -->
## perspective-diverse-verify

**何时：** 一个 finding 可能以好几种不同方式翻车，单一 verifier 的视角会漏掉那些它管不到
的失败模式。给每个 verifier 配一面**不同的 lens**——correctness / security / performance /
reproducibility——并要求这个 finding 在每一面之下都存活下来。这是 adversarial-verify 的
diverse-lens 变体。

```js
const LENSES = ['correctness', 'security', 'performance', 'reproducibility']
const verdicts = await parallel(LENSES.map((lens) => () =>
  agent(`Verify this finding from the ${lens} angle — try to break it:\n${JSON.stringify(finding)}`,
    { label: `verify:${lens}` })))
```

**由谁演示：** `assets/examples/review-adversarial-verify.js`——它的 `DIMENSIONS`
（bugs / security / perf）在 *find* stage 就贯彻了同样的 diverse-lens 思路；当某个 finding
值得时，把同一份 lens list 搬到 *verify* stage 用。

---

<!-- ccm:k:end point:workflow.pattern-perspective-verify -->

## 失效类型

`environment_fact`（双重性质·方法部分补不回来，它才是承重结构） —— 模型知道多角度验证有价值，但耗时，压力下会跳过某些 lens、或用不完整的角度组合验证

多 lens 验证的想法通用，但承重的是本框架 parallel()+label 的写法与它与 review 示例 DIMENSIONS 的对应关系。

## 边界

系统性改动（refactor / migration / security patch）需要多面向验证；小的 bug fix 或新增单一模块可能过度防卫

## 失败形态

各个 lens 验证深度不对等（深度验证某一面，草率验证其他面）；或某些 lens 验证时带着确认偏差；或 lens 组合不全，漏掉会影响决策的某一面
