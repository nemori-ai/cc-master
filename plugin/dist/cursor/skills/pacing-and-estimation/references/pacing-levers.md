# Pacing levers —— target-bound 单侧收紧

> **何时读：** machine-wide posture 或 selected-target `ccm usage advise` 给出压力时，把 verdict、窗口与
> reset 事实整理成决策输入；具体取舍与编排动作由 `master-orchestrator-guide` 决定。本页不调 WIP、不换号、
> 不派发 worker，也不创建 watchdog。

<a id="ccm-k-point-pacing-upper-bound-only"></a>
<!-- ccm:k:start point:pacing.upper-bound-only -->
## 只在上界收紧

pacing 没有“额度空闲所以自动加速”的欠用侧。`healthy` / `hold` 只表示当前已证明的承重窗口未触发收紧；
它不覆盖模型准入、任务质量、权限或安全条件。`tight` / `throttle` 表示需要决策层评估减速；
`exhausted` / `stop_*` 表示该 target 的承重窗口已进入硬边界。unknown 永远不等于 healthy。

按精确 target 解读：

- **Claude Code**：5h 与 7d 都承重；`switch_candidate` 只是一份账号池候选事实，不是换号授权。
- **Codex**：只接受 7d hard gate；5h、`stop_5h`、`switch` 与 `switch_candidate` 不属于有效 Codex pacing
  合同。Codex 自动换号永久禁止；rolling-24h 只作 burn-risk advisory。
- **Cursor**：IDE 与 Agent 各自只接受自己的 billing-period posture；`stop_billing_period` 只约束对应
  surface。Cursor 自动换号永久禁止，两条 surface 不互相兜底事实。

<!-- ccm:k:end point:pacing.upper-bound-only -->
<!-- ccm:k:nav:start point:pacing.upper-bound-only -->
Knowledge navigation:
- [Knowledge atlas](../../../knowledge/atlas.md)
- [Module module:pacing.levers](../../../knowledge/modules/pacing.levers.md#ccm-k-module-pacing-levers)
- [operationalizes: 决策影响向量](./pacing-levers.md#ccm-k-point-pacing-decision-vectors)
- [routes_to: 先全局再下钻](./usage-signals.md#ccm-k-point-pacing-machine-wide-first)
- [deepens_to: 读 pool own_row](./pool-aware-advice.md#ccm-k-point-pacing-own-row)
<!-- ccm:k:nav:end -->
<a id="ccm-k-point-pacing-decision-vectors"></a>
<!-- ccm:k:start point:pacing.decision-vectors -->
## 可交给决策层的影响向量

1. **模型 / effort**：在不跌破任务 effect floor 的前提下，较低成本候选可能降低 burn，也可能增加返工。
2. **WIP**：同时消耗同一 quota scope 的叶子越多，窗口内 burn 通常越高。
3. **high-float**：非临界、token 重的工作可以跨 reset 推迟；临界链不能只因额度紧张就静默降质。

这些只是决策输入，不是动作。是否减 WIP、换候选、延后任务、停派、请求用户拍板或建立 watchdog，全部交回
`master-orchestrator-guide`。若决策层选择 wakeup，必须先取得真实 scheduler / background handle，再通过
`using-ccm` 记录；`nearest_reset` 本身不是 handle，也不授权自动续跑。
<!-- ccm:k:end point:pacing.decision-vectors -->
<!-- ccm:k:nav:start point:pacing.decision-vectors -->
Knowledge navigation:
- [Knowledge atlas](../../../knowledge/atlas.md)
- [Module module:pacing.levers](../../../knowledge/modules/pacing.levers.md#ccm-k-module-pacing-levers)
- [routes_to: 先全局再下钻](./usage-signals.md#ccm-k-point-pacing-machine-wide-first)
- [routes_to: 只在上界收紧](./pacing-levers.md#ccm-k-point-pacing-upper-bound-only)
- [applies_to: usage⊗estimate 张力](./estimation.md#ccm-k-point-pacing-usage-estimate-tension)
<!-- ccm:k:nav:end -->
