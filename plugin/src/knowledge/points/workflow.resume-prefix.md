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
