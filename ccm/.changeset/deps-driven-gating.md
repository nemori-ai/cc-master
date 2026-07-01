---
"@ccm/engine": minor
"ccm": minor
---

deps 驱动的 `ready↔blocked` 自动门控 + `blocked_on` 作语义阻塞判别器（ADR-023·Model 1）

- **`@ccm/engine`**：新增纯函数 `reconcileGating(board)`——对每个「无 `blocked_on` 且 `status ∈ {ready, blocked}`」的 task 按 deps 完成度归一（deps 全 done→`ready`，否则→`blocked`）；有 `blocked_on`（等 user / 等某 task）的语义阻塞整体豁免。一趟全板 O(V+E)、幂等、不产生新 `done`（无级联），复用 `analyzeGraph.predecessors` + `isDoneStatus` 与 `readySet` 零漂移。
- **写入关卡**：`runWrite` 在 `mutate` 之后、`lintBoard` 之前跑一趟归一——所有写 verb 自动获得 `ready↔blocked` 门控，CLI 写路径永不产生不一致态。
- **新 verb `ccm task unblock <id>`**：清 `blocked_on`（+ 附属 `decision_package`），交回 `reconcileGating` 按 deps 定 `ready`/`blocked`（`task block` 的解除侧）。
- **新 lint warn `BIZ-STATUS-DEPS`**：兜手改 board 造出的门控不一致态（`ready` 但 deps 未全 done / `blocked` 无 `blocked_on` 但 deps 全 done）——规则全集 48→49。
