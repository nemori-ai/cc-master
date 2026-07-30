---
point: goal.alignment-checkpoints
---

## 权威陈述

<!-- ccm:k:start point:goal.alignment-checkpoints -->
- **fresh**：Framing Test → `goal set` → 识别 / 确认交付 DDL（或确认无 DDL）→ `goal check` 返回 `ok`（非 `deadline_pending`）→ 才调用 `slicing-goals-into-dags`。
- **resume / compaction**：先 `goal check`，有 Brief 就读当前 revision；恢复执行前补一次 DDL / no-DDL 确认 + deadline-risk 刷新（不沿用陈旧绿 verdict），再 reconcile；hash 异常立即硬停。
- **recon / replan**：确认新发现已经过 Delta Classifier；不让 task 反向偷偷改写 goal。
- **dispatch / fill-work**：每个工作单元必须通过 Trace Test，handoff 写明 goal revision 与所兑现的 acceptance。
- **verify**：先验 task 的 local acceptance，再验当前 Goal Contract 的 global acceptance；局部全绿不等于目标完成。
- **stop / complete**：确认没有 board 外漏项、没有未分类 delta、Goal Brief hash 有效，并以当前 revision 生成验收证据。

Legacy board 没有 `goal_contract` 时保持可续跑；不要在恢复现场擅自迁移或改义。若确需纳入 lifecycle，把它当一次显式、可审计的目标确认/修订，而不是静默补字段。
<!-- ccm:k:end point:goal.alignment-checkpoints -->
