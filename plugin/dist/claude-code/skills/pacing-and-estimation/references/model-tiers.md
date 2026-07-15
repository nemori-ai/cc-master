# 模型档位事实 —— 可用性、相对成本与能力边界

> **何时读：** 需要确认当前 host 可用哪些档位、相对成本、能力边界、provenance 或不确定性时读取；把事实交给 `master-orchestrator-guide` 的 `references/model-allocation.md` 作具体分档、主线固定与容量动作。

## Claude 模型事实

具体 model ID、绝对价格与可用性会变化；读取模型事实时核对 Anthropic 官方 models / pricing 信息与当前运行时目录。下面的相对 output multiplier 只用于解释 burn，不替代实时真值。

| Tier | Model ID | $/1M in·out | Relative output cost | 已观察到的能力侧重 |
|---|---|---|---|---|
| Fable 5 | `claude-fable-5` | $10 · $50 | **10×** | 最强开放推理与高杠杆判断档 |
| Opus 4.8 | `claude-opus-4-8` | $5 · $25 | **5×** | 复杂、有状态的执行推理档 |
| Sonnet 4.6 | `claude-sonnet-4-6` | $3 · $15 | **3×** | 平衡型主力档 |
| Haiku 4.5 | `claude-haiku-4-5` | $1 · $5 | **1×** | 低成本、高吞吐档 |

Fable 5 当前不可用；点名请求会返回 unavailable。任何候选集都必须反映当前实测可用性。绝对美元只是易变的观测，长期 pacing 主要消费 **Haiku 1× / Sonnet 3× / Opus 5× / Fable 10×** 的相对 output cost。

## 能力与价格不是单调关系

- 复杂多文件、有状态实现上的档位差距通常最明显，降档更可能带来返工。
- 终端操作与日常工具驱动任务上，主力档常接近或超过旗舰档的速度/准确性。
- 信息整合、方案文本与常规文档上，主力档与旗舰档的观测差距经常小于价格差。
- duration 只表示时间占用；它不证明任务需要更强模型。

这些是模型分配的输入，不是任务路由。具体节点分档、主线锁档、异构二审与容量收紧动作查 `master-orchestrator-guide` 的 `references/model-allocation.md`。

## cache 与参数事实

`effort` 是 API token 旋钮，但当前派发 API 不把它传给叶子。KV cache 跨模型不可互换；主会话与每个 subagent 的 cache 相互独立。切换主会话模型会让稳定前缀重新计费，这项成本事实应与任务风险、验收强度和配额状态一起交给决策层。
