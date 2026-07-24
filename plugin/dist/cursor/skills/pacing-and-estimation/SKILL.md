<a id="ccm-k-skill-pacing-and-estimation"></a>
---
name: pacing-and-estimation
description: 'Use when 你（orchestrator/agent）从 Cursor origin 读取 ccm 的只读 advisory 与估算——包括全机 Claude Code / Codex / Cursor / Kimi Code target 的 quota posture、四 provider 统一 `model-policy` 的 O/T1/T2/T3 候选，以及 ETA、EVM、风险和 cost-to-complete。Triggers: 读 `ccm quota status --machine-wide`、`ccm usage show|advise`、`ccm model-policy show|advise`、estimate 输出或 pacing hook 通知，判断某个 target 的窗口、来源、freshness、verdict、affinity 或 forecast 是否可信。Do NOT use when要决定减速、换号、停派、replan、用户升级、最终模型分配、WIP、拆分、推迟、后台放置或 watchdog（归 master-orchestrator-guide）；不要在这里执行 ccm 命令、account 操作、baseline / coordination 写操作或填写 board 字段（归 using-ccm），也不要执行真实 provider 请求。所有 origin 共享同一 machine-wide target 视角；Cursor IDE 与 Agent 必须分别绑定，自动换号永久禁止。'
---

# pacing-and-estimation — 消费 ccm 只读 advisory 配速 + 估算

> 这里只执行三类能力：读取并解释 ccm 已产生的 advisory；引用三个 provider 共用的模型事实 / role / affinity registry；把整理后的决策输入交给 `master-orchestrator-guide`。

## 封闭能力边界

1. **读取并解释 advisory**：只消费 ccm 已返回的字段，不在这里产生或更新 board、baseline、coordination 或账号状态。
2. **引用模型 registry**：只从 [references/model-tiers.md](references/model-tiers.md) 读取全机 selected targets 的可用性、provenance、role evidence、affinity 与成本事实。
3. **交接决策输入**：只把 verdict、reset、不确定性、模型事实与来源整理给 `master-orchestrator-guide`；具体编排动作由它决定。

命令形状、flag 与任何状态 mutation 都查 `using-ccm`。前置事实不存在时保持 `unknown` / `available:false`，不要在这里补造。

## 当前 origin 的 usage + 全机模型事实入口

- **host**：`cursor`
- **usage profile**：读取 aggregate `billing_period` 的 `hold`、`throttle`、`stop_billing_period` 与 reset 事实；它不证明容量池拓扑，自动换号永久禁止。
- **模型事实 registry**：[references/model-tiers.md](references/model-tiers.md)

## 只读 advisory 速查

| 命令 | 只读解释 |
|---|---|
| `ccm usage advise --json` | 读 `available`、`verdict`、`strength` 与 `nearest_reset`；不自行重算走廊。 |
| `ccm usage show --json` | 读当前 host 已证明的窗口百分比与 reset 状态；缺失字段保持 unknown。 |
| `ccm usage task-cost <id> --json` | 读单任务可归因的 token / duration 事实；不要用账户 aggregate delta 反推节点成本。 |
| `ccm model-policy show --task <task-taxonomy> --json` | 读三个 provider 共用的 hard facts、项目 role evidence 与有时效的 community advisory；三层不可互相补证。 |
| `ccm coordination inbox list --unconsumed --json` | 只读已经产出的 pool-aware own row 与通知；不存在或陈旧时保持不可判。 |
| `ccm estimate forecast --json` | 读 p50 / p80 / p95、`coverage_pct`、`confidence` 与区间宽度。 |
| `ccm estimate evm --json` | 读 `has_baseline`、`spi_t` 与 `cpi`；`has_baseline:false` 时不制造计划事实。 |
| `ccm estimate velocity --json` | 读吞吐、backlog ETA 与 SLE 区间。 |
| `ccm estimate risk --json` | 读 criticality、WIP aging 与 CCPM zone 等风险事实。 |
| `ccm estimate cost-to-complete --json` | 读剩余配额区间与 `available`，作为 usage × estimate 张力输入。 |

先读 `available`、provenance 与诚实字段。低覆盖、低置信或宽区间只会降低输入权重，不能被改写成确定承诺。命令的完整 flag、exit code 与 JSON schema 查 `using-ccm`；这里保留字段解释，不复算 ccm 引擎算法。

## 交给决策层的最小输入

- usage：`verdict`、`strength`、`nearest_reset`、窗口事实与信号来源。
- estimate：p50 / p80 / p95、`coverage_pct`、`confidence`、conformal 区间、EVM 与风险字段。
- pool-aware：只读已经产出的 own row、通知 freshness 与 pool identity 证据。
- model：registry 中三个 provider 的可用性、provenance、role evidence、task affinity 与相对成本；origin 不裁剪候选池。

把以上输入交给 `master-orchestrator-guide`；超出三类能力的具体编排动作一律归它决定。

## Pointers

- **[references/model-tiers.md](references/model-tiers.md)** — 三个 provider 共用的模型事实 / role evidence / task-affinity read model：可用性、provenance、相对成本与能力边界。
- **[references/usage-signals.md](references/usage-signals.md)** — usage 信号源、窗口与诚实天花板。
- **[references/pacing-levers.md](references/pacing-levers.md)** — verdict 与候选 lever 类的事实映射。
- **[references/estimation.md](references/estimation.md)** — estimate 字段、baseline-derived 事实与不确定性读法。
- **[references/pool-aware-advice.md](references/pool-aware-advice.md)** — 已经产出的 own row 与 pool-aware 通知读法。
- **[references/cross-harness-target-facts.md](references/cross-harness-target-facts.md)** — 从任意 origin 解释 selected target 的 inventory、model 与 quota envelope。
<!-- ccm:k:entry-pin:start -->
Knowledge entry pins for entry:pacing-and-estimation:
- [先全局再下钻](./references/usage-signals.md#ccm-k-point-pacing-machine-wide-first)
- [Module module:pacing.estimation](../../knowledge/modules/pacing.estimation.md#ccm-k-module-pacing-estimation)
- [primary: 六 estimate verb 消费映射](./references/estimation.md#ccm-k-point-pacing-estimate-verbs)
- [Module module:pacing.levers](../../knowledge/modules/pacing.levers.md#ccm-k-module-pacing-levers)
- [primary: 只在上界收紧](./references/pacing-levers.md#ccm-k-point-pacing-upper-bound-only)
- [Module module:pacing.model-facts](../../knowledge/modules/pacing.model-facts.md#ccm-k-module-pacing-model-facts)
- [Module module:pacing.pool](../../knowledge/modules/pacing.pool.md#ccm-k-module-pacing-pool)
- [Module module:pacing.signals](../../knowledge/modules/pacing.signals.md#ccm-k-module-pacing-signals)
- [Module module:pacing.target-facts](../../knowledge/modules/pacing.target-facts.md#ccm-k-module-pacing-target-facts)
- [primary: selected target 事实绑定](./references/cross-harness-target-facts.md#ccm-k-point-pacing-selected-target-facts)
<!-- ccm:k:entry-pin:end -->
