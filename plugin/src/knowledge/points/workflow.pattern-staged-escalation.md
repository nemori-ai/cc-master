---
point: workflow.pattern-staged-escalation
---

## 权威陈述

<!-- ccm:k:start point:workflow.pattern-staged-escalation -->
## staged-escalation

**何时：** 工作应当从便宜起步，只在便宜的 stage 失败或返回低信心时，才升级到昂贵的
模型 / 方法。用一个 `pipeline()`：stage 1 是一趟便宜 pass，stage 2 有条件触发——当 stage 1
已经越过信心阈值时 stage 2 短路（原样返回 stage-1 的结果），只有没越过时才派生昂贵的
`agent('escalate: ' + item, { model: ... })`。用它把强模型只花在弱模型吃力的地方，而不是
一律都上。当心：`model` 是 cache key 的一部分（`api-reference.md`），所以你一旦改了 model
选择，escalation 分支在 resume 时会 live 重跑。

**由谁演示：** `assets/examples/staged-escalation.js`。
<!-- ccm:k:end point:workflow.pattern-staged-escalation -->
