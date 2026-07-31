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

## 失效类型

`environment_fact`（双重性质·方法部分补不回来，它才是承重结构） —— 模型知道反驳 finding 很重要，但时间紧的压力下会想跳过 refute 阶段、直接相信自己的第一遍找

承重的是本框架 agent()/pipeline() 的调用形状、schema 写法与 bundled 示例路径，模型猜不出这套 API。

## 边界

critical finding（会影响决策、用户受益或 security）需必做；探索阶段的低风险发现可灵活跳过

## 失败形态

skeptic 角色没有真的尝试 refute，只是走过场；或只验证了高层逻辑但没验证细节；或 schema 里没有真的让它有「declare isReal=false」的出口
