---
point: ccm.planning-opt-in
---

## 权威陈述

<!-- ccm:k:start point:ccm.planning-opt-in -->
## 心智锚 5：planning / routing 是 opt-in board 合同，不是自动派发器

要让一个近期 `subagent` 节点的复杂度、能力要求、模型候选、充足 / 紧张额度链和 fallback 在 handoff / resume 后仍可重建，用 `ccm/task-planning/v1` + `ccm/agent-routing/v1` 成对记录；精确字段、准备顺序与 dedicated writer 见 [references/board-model-guide.md](references/board-model-guide.md) §C.5，命令见 [references/command-catalog.md](references/command-catalog.md) 的 `board enable-contract`、`task set-planning`、`task set-routing`、`task route-bind`。

这套合同当前只拥有 **planning / ledger / activation**：`set-routing` 不选中 candidate、不 spawn，`enable-contract` 不派发，`route-bind` 也只消费调用方已经取得的 opaque running-handle claim。显式 `ccm worker help/run` raw wrapper 已可用，但不会自动写 `routing.selected` / `attempts`，也不会自动 route 或 fallback；只用同步 raw wrapper 时，不要为了“记录得更完整”强启一个当前拿不到 running handle 的合同。缺少合同的 legacy board / task 保持原行为。
<!-- ccm:k:end point:ccm.planning-opt-in -->

## 失效类型

`environment_fact`（主体：事实方法） —— set-routing/enable-contract/route-bind具体做不做什么(不选中候选、不spawn、不自动fallback),是这个CLI当前版本的实现事实,模型无法从命名或通用经验推断出来,猜错就会误判派发已经发生。

主体是 planning/routing 合同的能力边界（只 ledger 不 spawn 不 fallback），属本工具语义事实。

## 边界

这条边界描述的是当前版本的opt-in合同现状,不是永久设计承诺——若后续版本让raw wrapper自动写routing.selected/attempts,边界随之改变。

## 失败形态

走完set-routing→route-bind整套流程后,board上的routing记录看起来完整,容易误以为这本身意味着任务已经在跑;但route-bind只是记下调用方已经拿到的running-handle claim,若中间那次实际派发没有真正发生,记录和执行状态会悄悄脱节而两边都不报错。
