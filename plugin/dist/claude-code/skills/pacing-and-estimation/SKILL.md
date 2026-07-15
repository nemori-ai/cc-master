---
name: pacing-and-estimation
description: 'Use when 你（orchestrator/agent）在一场 long-horizon 跑里要读取 ccm 的只读 advisory 与估算——解释 5h/7d 配额窗口、目标 ETA、EVM、综合风险、cost-to-complete，或 `ccm usage advise` / `ccm estimate forecast` 的 verdict 与字段。覆盖单侧走廊 verdict（hold/throttle/switch/stop_5h/stop_7d）、Fable/Opus/Sonnet/Haiku 的相对成本与可用性事实、账户权威信号源链，以及 coverage_pct/confidence/conformal 区间等诚实字段。Triggers: 读 ccm usage/estimate 输出或 EVM 的 `has_baseline` 字段、"这个 forecast 信不信 / EVM 偏差怎么看 / 当前模型事实和相对成本是什么 / Claude 当前账号 5h 和 7d 怎么读"、配额逼顶时判读 usage、pacing/估算 hook 注入提示。Do NOT use when要决定减速、换号、停派、replan、用户升级、模型分配、WIP、拆分、推迟、后台放置或 watchdog（归 master-orchestrator-guide）；不要在这里执行 ccm 命令、account 操作、baseline / coordination 写操作或填写 board 字段（归 using-ccm），也不要写 workflow 脚本（归 authoring-workflows）。ccm 提供 verdict，这里只整理事实与 advisory；具体决策查 master-orchestrator-guide。'
---

# pacing-and-estimation — 消费 ccm 只读 advisory 配速 + 估算

> 这里只执行三类能力：读取并解释 ccm 已产生的 advisory；引用当前 host 的模型事实 registry；把整理后的决策输入交给 `master-orchestrator-guide`。

## 封闭能力边界

1. **读取并解释 advisory**：只消费 ccm 已返回的字段，不在这里产生或更新 board、baseline、coordination 或账号状态。
2. **引用模型 registry**：只从 [references/model-tiers.md](references/model-tiers.md) 读取当前 host 已证明的可用性、provenance、能力与成本事实。
3. **交接决策输入**：只把 verdict、reset、不确定性、模型事实与来源整理给 `master-orchestrator-guide`；具体编排动作由它决定。

命令形状、flag 与任何状态 mutation 都查 `using-ccm`。前置事实不存在时保持 `unknown` / `available:false`，不要在这里补造。

## 当前 host 事实入口

- **host**：`claude-code`
- **usage profile**：读取 5h / 7d 的 `hold`、`throttle`、`switch`、`stop_5h`、`stop_7d` 与 reset 事实；verdict 本身不是账号 mutation 授权。
- **模型事实 registry**：[references/model-tiers.md](references/model-tiers.md)

## 只读 advisory 速查

| 命令 | 只读解释 |
|---|---|
| `ccm usage advise --json` | 读 `available`、`verdict`、`strength` 与 `nearest_reset`；不自行重算走廊。 |
| `ccm usage show --json` | 读当前 host 已证明的窗口百分比与 reset 状态；缺失字段保持 unknown。 |
| `ccm usage task-cost <id> --json` | 读单任务可归因的 token / duration 事实；不要用账户 aggregate delta 反推节点成本。 |
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
- model：registry 中当前 host 已证明的可用性、provenance、能力与相对成本。

把以上输入交给 `master-orchestrator-guide`；超出三类能力的具体编排动作一律归它决定。

## Pointers

- **[references/model-tiers.md](references/model-tiers.md)** — 当前 host 的模型事实 registry：可用性、provenance、相对成本与能力边界。
- **[references/usage-signals.md](references/usage-signals.md)** — usage 信号源、窗口与诚实天花板。
- **[references/pacing-levers.md](references/pacing-levers.md)** — verdict 与候选 lever 类的事实映射。
- **[references/estimation.md](references/estimation.md)** — estimate 字段、baseline-derived 事实与不确定性读法。
- **[references/pool-aware-advice.md](references/pool-aware-advice.md)** — 已经产出的 own row 与 pool-aware 通知读法。
