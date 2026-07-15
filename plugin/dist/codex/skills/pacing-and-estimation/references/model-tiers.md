# 模型档位事实 —— 可用性、相对成本与能力边界

> **何时读：** 需要确认当前 host 可用哪些档位、相对成本、能力边界、provenance 或不确定性时读取；把事实交给 `master-orchestrator-guide` 的 `references/model-allocation.md` 作具体分档、主线固定与容量动作。

## Codex 模型事实入口（family × effort）

运行 `ccm provider facts codex --json`。该命令返回 ccm 内置、带 OpenAI 官方来源和有效期的 GPT-5.6 snapshot；本页只教你消费字段，不维护第二份 model ID 清单。

进入 live admission 前要求 `freshness:"fresh"`、`catalog_eligible_for_admission_check:true`、完整的 `source/observed_at/valid_until/account_scope/confidence/unknown`。静态 snapshot 的 `eligible_for_automatic_selection` 必须保持 `false`；当前账号 entitlement 与 exact-model admission 另行证明后，orchestrator 才能组合这些事实做选择。当前 snapshot 保存的官方观测是 Luna/Terra/Sol 相对 output cost `1 / 2.5 / 5`，以及 SWE-Pro / Terminal-Bench 2.1 headline；例如 Sol 为 `64.6 / 88.8`。这些数值只用于校验 ccm facts 没有漂移，不能替代当次命令输出，也不是每类任务或每种 effort 的承诺。

### Effort 语义

| effort | 稳定语义 |
|---|---|
| **low**（UI 的 Light） | 边际推理深度与消耗最低 |
| **medium** | 默认的中等推理深度 |
| **high / xhigh** | 更高的推理深度、自检与消耗 |
| **max** | 单任务可用的最高常规推理深度与消耗 |

`ultra` 是用 subagents 展开 workstreams 的多-agent 拓扑，不是 `max` 之后的普通 effort，也不应记录成 leaf 的 model tier。Fast mode 会更快消耗 credits，不是低成本档。Family 与 effort 是独立输入；具体任务分档查 `master-orchestrator-guide` 的 `references/model-allocation.md`。
