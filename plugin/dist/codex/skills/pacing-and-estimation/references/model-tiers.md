# 模型档位事实 —— 可用性、相对成本与能力边界

> **何时读：** 需要确认当前 host 可用哪些档位、相对成本、能力边界、provenance 或不确定性时读取；把事实交给 `master-orchestrator-guide` 的 `references/model-allocation.md` 作具体分档、主线固定与容量动作。

## Codex 模型事实（GPT-5.6 family × effort）

绝对价格、额度、model ID 与 benchmark 会变化；读取前核对 [OpenAI GPT-5.6 发布页](https://openai.com/index/gpt-5-6/)、[Codex 模型指南](https://developers.openai.com/codex/models) 和 [Codex pricing](https://developers.openai.com/codex/pricing)。

### Family 能力与成本观测

| family | 相对 token 价（Luna=1×） | 官方 coding headline（SWE-Pro / TB 2.1） | 能力轮廓 |
|---|---:|---:|---|
| **Luna** | 1× | 62.7% / 84.7% | 低成本、高吞吐、边界清楚时可验证 |
| **Terra** | 2.5× | 63.4% / 87.4% | 平衡型工具使用与实现能力 |
| **Sol** | 5× | 64.6% / 88.8% | 开放问题、深判断与 polish 能力最高 |

不要把已退役的 5h 消息区间当容量或成本事实；当前账号容量只读 7d hard ceiling，rolling-24h 只作 burn-rate advisory。上下文、reasoning、工具、retrieval 与 cache 都会改变实际消耗；headline benchmark 也不是每种 effort 或每类任务的承诺，它只说明观测到的能力差小于价格差。

### Effort 语义

| effort | 语义与成本事实 |
|---|---|
| **low**（UI 的 Light） | 边际推理深度与消耗最低 |
| **medium** | 默认的中等推理深度 |
| **high / xhigh** | 更高的推理深度、自检与消耗 |
| **max** | 单任务可用的最高常规推理深度与消耗 |

`ultra` 是用 subagents 展开 workstreams 的多-agent 拓扑，不是 `max` 之后的普通 effort，也不应记录成 leaf 的 model tier。Fast mode 会更快消耗 credits，不是低成本档。

Family 与 effort 是两个独立输入；临界路径、duration 或价格都不能单独推出具体型号。跨 family cache 不可互换。具体任务分档、主线 family、WIP 与 `ultra` 拓扑决策查 `master-orchestrator-guide` 的 `references/model-allocation.md`。
