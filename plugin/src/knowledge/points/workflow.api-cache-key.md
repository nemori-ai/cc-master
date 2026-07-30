---
point: workflow.api-cache-key
---

## 权威陈述

<!-- ccm:k:start point:workflow.api-cache-key -->
## Cache key——四要素（`agent()` 的 resume 身份）

Resume 身份是按内容算的（见 `mechanism.md` §5）。一个 `agent()` 调用的 cache 身份由
**四样东西**决定：

1. `prompt`
2. `schema`
3. `model`
4. `isolation`（外加 `agentType`，行为一致）

其中任何一个（或 `prompt` 文本）一变，这个调用——以及它之后的一切——都会 live 重跑。
`label` 和 `phase` 是装饰，**绝不**进 cache key。

<!-- ccm:k:end point:workflow.api-cache-key -->
