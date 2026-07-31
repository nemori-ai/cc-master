---
point: pacing.model-tier-facts
---

## 权威陈述

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

本页只解释事实与不确定性，不决定 executor、route、WIP 或是否发车。
<!-- ccm:k:end point:pacing.model-tier-facts -->

## 失效类型

`environment_fact`（主体：事实方法） —— 模型知道三层事实框架，但缺这个项目的具体模型档位表、当前价格、entitlement 和 quota 事实

主体是 ccm registry 查询命令与 hard_facts / project_role_evidence / community_advisory 三层输出的读法，是环境事实。

## 边界

仅用于模型选择、预算分配、capacity planning 决策；不适用于代码实现决策或架构设计（那些用相反的事实源）

## 失败形态

直接引用了内嵌或过时的模型表；把某次 benchmark 的社区共识当硬约束而忽视本项目实际 entitlement；混用不同 payer 的价格做成本比较
