---
point: workflow.pattern-adversarial-verify
---

## 权威陈述

<!-- ccm:k:start point:workflow.pattern-adversarial-verify -->
## adversarial-verify

**何时：** finding 必须可信。对每个 finding，派一个 skeptic agent 去试着 **refute** 它
（默认 `isReal = false`；证据不足 → 就毙掉它）。只留下幸存者。这是典范的质量乘数——让
独立的 agent 互相攻击对方的主张，直到答案收敛。

```js
const verified = await pipeline(findings,
  (f) => agent(`Try to REFUTE this finding. Default isReal=false if unsure:\n${JSON.stringify(f)}`,
    { schema: { type: 'object', properties: { isReal: { type: 'boolean' } }, required: ['isReal'] } })
    .then((v) => ({ ...f, verdict: v })))
return verified.filter((f) => f.verdict?.isReal)
```

**由谁演示：** `assets/examples/review-adversarial-verify.js`（dimensions → find →
逐个 finding 做 adversarial verify）。

---

<!-- ccm:k:end point:workflow.pattern-adversarial-verify -->
