---
point: workflow.resume-prefix
---

## 权威陈述

<!-- ccm:k:start point:workflow.resume-prefix -->
## 5. Resume =「最长未变前缀」

契约的原话：

> 「`agent()` 调用的**最长未变前缀**立刻返回 cache 的结果；第一个被编辑/新增的调用以及
> 它之后的一切都 live 跑。同一脚本 + 同一 args → 100% cache 命中。」

心智模型：resume 顺着 `agent()` 调用的**序列**逐个往下走，按内容（`prompt` + 影响 cache
的 opts）逐项比对。某个调用没变就命中 cache；走到**第一个**变了的调用，它切到 live，此后
的一切也跟着 live 跑。所以它是*前缀有序 + 按内容比对*——既不是纯按位置，也不是乱序的
content-hash。

- 改 `schema` / `model` / `isolation` / `agentType` 会**让 cache 失效**（逼那个调用重跑）。
- `label` / `phase` 是纯装饰，**绝不**让 cache 失效。

这正是「edit-and-resume」的工作流：跑一次 → Write/Edit 那个 saved 脚本 → 用
`{scriptPath, resumeFromRunId}` 重新调用；未变前缀立刻重放，于是你只为改动的部分、以及
它之后的部分付 live 成本。

<!-- ccm:k:end point:workflow.resume-prefix -->

## 失效类型

`environment_fact`（主体：事实方法） —— 不知道哪些改动会让 cache 失效、哪些不会，会在编辑脚本做 resume 时误判哪一段会重新付出 live 成本，或反过来以为改了纯装饰字段也要重算。

主体是本引擎 resume 的契约事实：最长未变前缀命中 cache，以及哪些 opts 会让 cache 失效、哪些是纯装饰。

## 边界

只适用于同一份已保存脚本、同参数的编辑后续跑场景；不适用于两次调用参数本身就设计成不同的正常重跑判断。

## 失败形态

只改了一处看似无关紧要的调用参数（其实碰到了会影响 cache 的字段），预期只需一小段重新执行，实际上从那个调用开始往后全部重跑——表面像是机制『失灵』，其实是没认清改动踩中了失效边界。
