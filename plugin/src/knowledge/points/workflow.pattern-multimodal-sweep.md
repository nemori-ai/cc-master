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

## 失效类型

`capability_gap`（主体：事实方法） —— 删掉这条，模型不知道「多独立角度平行搜索 + 整体去重后再 deep-read」这个模式，倾向单角度搜或无条件 deep-read 每一项。

主体是多角度独立搜索再去重再深读这一研究方法，缺了就想不到从正交角度横扫。

## 边界

仅用于发现类问题中各角度（keyword/entity/architecture/history）各能独立命中、综合后才完整的场景；如果问题天然是单一视图或各角度重度重叠，sweep 收益有限。

## 失败形态

只跑一个角度的搜索（如仅 grep keyword）就认为发现完整；或跑完所有角度但 barrier 前就开始 deep-read，导致多次重复 read 同一项；或忘记去重逻辑直接逐项 deep-read。
