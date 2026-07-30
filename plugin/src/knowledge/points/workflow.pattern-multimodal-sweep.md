---
point: workflow.pattern-multimodal-sweep
---

## 权威陈述

<!-- ccm:k:start point:workflow.pattern-multimodal-sweep -->
## multi-modal-sweep

**何时：** 一个问题最好从几个**独立角度**分头搜索来回答，各角度各抓到不同的东西——按
keyword/grep、按 entity/symbol、按 structure/architecture、按 history/changelog。把所有
角度横扫一遍，再在昂贵的 deep-read 之前对整个集合去重（这里 barrier *是*对的——去重得
攒齐每个角度的命中）。

```js
const swept = await parallel(ANGLES.map((a) => () => agent(`research the question ${a}`, { schema: HITS })))
const deduped = [...new Set(swept.filter(Boolean).flatMap((r) => r.hits ?? []))]
const reads = await pipeline(deduped, (ref) => agent(`deep-read ${ref}`))
```

**由谁演示：** `assets/examples/research-multimodal-sweep.js`。

---

<!-- ccm:k:end point:workflow.pattern-multimodal-sweep -->
