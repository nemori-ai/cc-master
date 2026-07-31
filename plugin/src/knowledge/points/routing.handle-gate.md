---
point: routing.handle-gate
---

## 权威陈述

<!-- ccm:k:start point:routing.handle-gate -->
你可以先登记一个 `starting` runtime actor，但只有真实机制成功返回可 recon handle 后，才能把它 bind 到 agent、link 到 task，再让普通 task 进入 `in_flight`。没有 handle 或 link 的 `in_flight` 是幽灵任务；spawn 失败要收掉 `starting` 登记。

精确 command / field / status verb 只查 {{CCM_COMMAND_CATALOG_POINTER}}，不要从本文复制一套命令表。派后立即在 routing record 留下 agent、task、attempt 的关联与 handle provenance；三者可关联，不能合并成一个状态。

<!-- ccm:k:end point:routing.handle-gate -->

## 失效类型

`motivation_conflict`（主体：行为约束）

要求先拿到真实可 recon handle 才能置 in_flight，直接标状态明显更省事，动机完美者知道即会遵守。

## 为什么它随模型变强而更重要

跳过这一步的理由，永远比这一步本身更容易说得漂亮。能力越强，越能给「我确信 spawn 成功了」找到充分依据：机制细节我懂、失败模式我列得出、多一次确认只是仪式。能力弱时这像自我安慰，能力强时它听起来像洞察。但这条约束从一开始就不是为了弥补无知，它要求的判据是外部真实返回的那个东西，而不是任何人对成功的把握有多高。把握越可信，越需要一个不接受把握作为证据的关口。
