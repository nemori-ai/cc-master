---
point: goal.alignment-checkpoints
---

## 权威陈述

<!-- ccm:k:start point:goal.alignment-checkpoints -->
- **fresh**：Framing Test → `goal set` → 识别 / 确认交付 DDL（或确认无 DDL）→ `goal check` 返回 `ok`（非 `deadline_pending`）→ 才进入 DAG 拆解。
- **resume / compaction**：先 `goal check`，有 Brief 就读当前 revision；恢复执行前补一次 DDL / no-DDL 确认 + deadline-risk 刷新（不沿用陈旧绿 verdict），再 reconcile；hash 异常立即硬停。
- **recon / replan**：确认新发现已经过 Delta Classifier；不让 task 反向偷偷改写 goal。
- **dispatch / fill-work**：每个工作单元必须通过 Trace Test，handoff 写明 goal revision 与所兑现的 acceptance。
- **verify**：先验 task 的 local acceptance，再验当前 Goal Contract 的 global acceptance；局部全绿不等于目标完成。
- **stop / complete**：确认没有 board 外漏项、没有未分类 delta、Goal Brief hash 有效，并以当前 revision 生成验收证据。

Legacy board 没有 `goal_contract` 时保持可续跑；不要在恢复现场擅自迁移或改义。若确需纳入 lifecycle，把它当一次显式、可审计的目标确认/修订，而不是静默补字段。
<!-- ccm:k:end point:goal.alignment-checkpoints -->

## 失效类型

`environment_fact`（主体：事实方法） —— resume/compaction这一档专门针对跨session/跨压缩边界场景——删掉它,agent接手一块板时容易直接沿用之前"确认过"的目标状态,不会重新跑一次goal check去确认DDL和deadline-risk是否已过期,带着陈旧的绿灯判断继续推进。

主体是本项目 goal lifecycle 各阶段该跑哪道闸（goal check、Trace Test、legacy board 处理）的具体约定。

## 边界

这套检查点只管"目标对齐"这一件事,不替代任务执行进度、账号配额状态等其他类型的恢复检查,那些各自有自己的机制。

## 失败形态

新session通过--resume接手板后,凭board里goal字段"看起来还在"就直接开始派发新任务,却没重新跑goal check确认DDL临近或deadline-risk变化——外表一切正常,判断依据其实早该刷新却没人注意到。
