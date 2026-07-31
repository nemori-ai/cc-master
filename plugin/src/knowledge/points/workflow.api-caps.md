---
point: workflow.api-caps
---

## 权威陈述

<!-- ccm:k:start point:workflow.api-caps -->
## 硬 caps（见 `mechanism.md` §6）

- 并发：每个 workflow `min(16, cpu cores − 2)`。
- 每次 run 的 agent 总量：1,000。
- 每次 `parallel`/`pipeline` 调用的 item 数：4,096。
- 脚本大小：512 KB。

<!-- ccm:k:end point:workflow.api-caps -->

## 失效类型

`environment_fact`（主体：事实方法） —— 删了这条，agent 不知道 workflow 的并发上限、单次 run 最多多少 agent、脚本最大多少 KB，超了踩雷。

并发/agent 总量/item 数/脚本大小的具体上限值是环境常量。
