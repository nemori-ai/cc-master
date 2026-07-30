---
point: routing.handle-gate
---

## 权威陈述

<!-- ccm:k:start point:routing.handle-gate -->
你可以先登记一个 `starting` runtime actor，但只有真实机制成功返回可 recon handle 后，才能把它 bind 到 agent、link 到 task，再让普通 task 进入 `in_flight`。没有 handle 或 link 的 `in_flight` 是幽灵任务；spawn 失败要收掉 `starting` 登记。

精确 command / field / status verb 只查 {{CCM_COMMAND_CATALOG_POINTER}}，不要从本文复制一套命令表。派后立即在 routing record 留下 agent、task、attempt 的关联与 handle provenance；三者可关联，不能合并成一个状态。

<!-- ccm:k:end point:routing.handle-gate -->
