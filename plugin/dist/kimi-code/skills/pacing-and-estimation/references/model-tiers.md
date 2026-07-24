# 模型档位事实 —— 可用性、相对成本与能力边界

> **何时读：** 需要从任意 origin 确认全机四个 provider 有哪些模型候选、角色证据、相对成本、任务亲和度、provenance 或不确定性时读取；把事实交给 `master-orchestrator-guide` 的 `references/model-allocation.md` 作具体分档、主线固定与容量动作。

<a id="ccm-k-point-pacing-model-tier-facts"></a>
<!-- ccm:k:start point:pacing.model-tier-facts -->
不要读“当前 host 的内嵌型号表”。统一查询当前安装的 ccm registry：

```bash
ccm model-policy show --task <task-taxonomy> --json
ccm provider facts <claude-code|codex|cursor|kimi-code> --json
```

四个 origin 得到相同的 selected-target 事实视图；origin-specific slot 只保留 usage 信号与发车机制，不再改变目标模型表。读输出时始终分三层：

1. `hard_facts`：厂商官方 model / surface / availability / price / benchmark snapshot。它能产生 candidate，不能证明当前账号 entitlement、exact selector 或 role grade。
2. `project_role_evidence`：本项目对 `O / T1 / T2 / T3` 的候选、认证状态和 blockers。`candidate` 不等于 `certified`；认证过期或 target version 漂移后按 unknown 处理。
3. `community_advisory`：带来源、TTL、confidence、contradictions 和衰减的任务 taste。它只在硬门已过且基础分相近时作有界 tie-break；`stale / mixed / unknown` 归零，不能生成 availability、eligibility 或 effect floor。

成本比较也要 target-bound：官方 API price、订阅内 credits、on-demand、BYOK 和未知 payer 不是同一个成本池。缺真实 payer / quota / authorization 时标 unknown，不因为另一个 surface、同品牌账号或宣传价格看起来便宜就补值。

本页只解释事实与不确定性，不决定 executor、route、WIP 或是否发车。排序决策与 ample / tight fallback 回 `master-orchestrator-guide`；命令输入形状查 `using-ccm`。
<!-- ccm:k:end point:pacing.model-tier-facts -->
<!-- ccm:k:nav:start point:pacing.model-tier-facts -->
Knowledge navigation:
- [Knowledge atlas](../../../knowledge/atlas.md)
- [Module module:pacing.model-facts](../../../knowledge/modules/pacing.model-facts.md#ccm-k-module-pacing-model-facts)
- [routes_to: 先全局再下钻](./usage-signals.md#ccm-k-point-pacing-machine-wide-first)
- [routes_to: selected target 事实绑定](./cross-harness-target-facts.md#ccm-k-point-pacing-selected-target-facts)
<!-- ccm:k:nav:end -->
