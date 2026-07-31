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

## 失效类型

`capability_gap`（主体：事实方法） —— 删掉这条，模型不知道「先廉价、条件短路、才升级强模型」这个特定模式，倾向一上来就用强模型或无条件双阶段。

主体是先便宜 pass、按信心阈值有条件升级到强模型这一成本分配方法。

## 边界

仅用于廉价模型的信心度和错误率都足以作为门控条件的场景；信心阈值设定需要通过试跑验证，不能凭猜测。

## 失败形态

Escalation 分支在 resume 时因 model 改了而被视为新 cache key 被 live 重跑；或 stage 1 的短路条件写反导致无条件上升级；或没有实现「stage 1 命中高信心则原样返回」的短路。
