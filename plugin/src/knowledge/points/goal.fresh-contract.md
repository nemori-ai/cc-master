---
point: goal.fresh-contract
---

## 权威陈述

<!-- ccm:k:start point:goal.fresh-contract -->
1. 汇总原始请求、背景、约束、issue 等证据，不先写 task。
2. 跑 **Goal Framing Test**。以下六项都能明确回答，目标才可进入 `asserted`：
   - **Outcome**：最终改变了什么，而非“做一些工作”。
   - **Scope / non-goals**：包含与明确不包含什么。
   - **Acceptance**：什么可观察证据证明真正完成；同时含功能、质量与交付形态。
   - **Constraints**：架构、兼容、期限、安全、流程等硬约束。
   - **Authority**：哪些可自主决定，哪些必须由用户批准。
   - **Fork / Done / Authority**：是否仍有会改变路线的未决分叉；“done”是否无歧义；不可逆边界的决定权是否明确。
3. 缺的是路线级信息时，生成一份完整 `blocked_on:"user"` `decision_package` 并停在 `pending`；不要用猜测填洞。缺的是低影响细节且有安全默认时，可明确记下假设后进入 `asserted`。
4. 把短、无歧义、可验收的摘要写入 revision 1：

```bash
ccm goal set --board <board> --summary "<normalized goal>" --assurance asserted
ccm goal check --board <board> --json
```

5. 用户明确确认了完整目标时，才把 assurance 升为 `confirmed`；这个授权标记只来自真实用户确认：

```bash
ccm goal confirm --board <board> --user-authorized
```

`pending` = 尚不可拆 DAG；`asserted` = agent 已基于证据完成无歧义改写，可逆地推进；`confirmed` = 用户明确确认当前 revision。不要为了追求 `confirmed` 对每个清晰请求机械追问。

<!-- ccm:k:end point:goal.fresh-contract -->

## 失效类型

`environment_fact`（主体：事实方法） —— 删掉后,agent 面对看似清楚的请求容易跳过六项框架测试,遇到路线级缺口时用自己的猜测悄悄填上,而不是生成 decision_package 停下来问。

主体是 fresh 阶段建立 Goal Contract 的具体流程、assurance 三态语义与 ccm 命令面。

## 边界

适用于目标进入 asserted 之前的最初成形阶段;board 已有 confirmed revision、新请求只是在既有目标内追加细节时不必重走六项测试。没有真实例外——缺路线级信息时没有『先猜猜看』的合法出口,只有 pending + decision_package。

## 失败形态

目标摘要写得完整笃定,assurance 却直接标成 asserted 甚至当 confirmed 处理——摘要里悄悄塞了几个用户从未提及、也无安全默认可循的假设,过程中没生成 decision_package、没停在 pending。
