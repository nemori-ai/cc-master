---
point: ccm.planning-opt-in
---

## 权威陈述

<!-- ccm:k:start point:ccm.planning-opt-in -->
## 心智锚 5：planning / routing 是 opt-in board 合同，不是自动派发器

要让一个近期 `subagent` 节点的复杂度、能力要求、模型候选、充足 / 紧张额度链和 fallback 在 handoff / resume 后仍可重建，用 `ccm/task-planning/v1` + `ccm/agent-routing/v1` 成对记录；精确字段、准备顺序与 dedicated writer 见 [references/board-model-guide.md](references/board-model-guide.md) §C.5，命令见 [references/command-catalog.md](references/command-catalog.md) 的 `board enable-contract`、`task set-planning`、`task set-routing`、`task route-bind`。

这套合同当前只拥有 **planning / ledger / activation**：`set-routing` 不选中 candidate、不 spawn，`enable-contract` 不派发，`route-bind` 也只消费调用方已经取得的 opaque running-handle claim。显式 `ccm worker help/run` raw wrapper 已可用，但不会自动写 `routing.selected` / `attempts`，也不会自动 route 或 fallback；只用同步 raw wrapper 时，不要为了“记录得更完整”强启一个当前拿不到 running handle 的合同。缺少合同的 legacy board / task 保持原行为。
<!-- ccm:k:end point:ccm.planning-opt-in -->
