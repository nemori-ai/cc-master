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
