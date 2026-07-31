---
point: workflow.api-progress
---

## 权威陈述

<!-- ccm:k:start point:workflow.api-progress -->
## `phase(title) → void`

开启一个命名的 progress group；此后派生的 agent 都归进这个 group。`title` 必须精确匹配
某个 `meta.phases[].title`。在并发 stage 内部，改用 `opts.phase`（不会 race）。

## `log(message) → void`

在 progress tree 上方发一行叙述。用它来**把丢掉的东西明明白白说出来**——top-N 截断、
没重试、采样——免得这种悄悄的收窄被当成「full coverage」。

<!-- ccm:k:end point:workflow.api-progress -->

## 失效类型

`environment_fact`（主体：事实方法） —— 删了这条，agent 不知道有 phase()/log() API，写 workflow 时无法分组 progress、无法记录被丢掉的东西（采样、没重试、截断），用户看不到透明度。

主体是 phase()/log() 两个 primitive 的签名与语义（title 必须匹配 meta.phases[].title、并发内改用 opts.phase），属于本 runtime 的接口事实；披露截断的用法只是附加条款。

## 边界

Workflow 的 progress instrumentation 工具。无例外。phase() 必须使用预声明的 title，log() 完全自由。

## 失败形态

隐蔽形态：agent 用了 phase() 但 title 没声明在 meta.phases 里（错 title 会 error）、或写了 log 但描述不清「采样 0.1% 只处理 1000 个」导致用户以为全部处理了。
