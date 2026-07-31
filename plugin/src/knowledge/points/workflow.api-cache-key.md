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

## 失效类型

`environment_fact`（主体：事实方法） —— 知道缓存通常怎么工作，但下一个上下文里忘记了本框架对 resume 身份的特定约定（四要素 + 装饰字段排除）

cache key 由哪四要素构成、哪些是装饰，是本引擎的实现事实。

## 边界

四要素（prompt、schema、model、isolation/agentType）决定缓存身份的约定对所有 workflow 调用一致，无例外。区别在于 fresh 调用天然无前序上下文、resume 才需真正的缓存命中检查。禁止改变四要素之一以冀望复用前序——那会造成沉默的上下文崩溃而非显式错误。

## 失败形态

隐蔽形态：形式上改了四要素其一（如 schema 加字段），用词含糊地说"本质逻辑不变"，开发者误以为缓存仍有效，其实已无命中、上下文无法接续。另一种：混淆 label/phase（装饰字段）与决策要素，误认为改 label 会改缓存身份。最严重的是不改显式值但改变了 prompt 的语义（如重构提示词逻辑），使用者看不到哪些改动触发了 cache key。
