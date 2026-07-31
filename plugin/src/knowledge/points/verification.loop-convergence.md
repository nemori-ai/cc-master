---
point: verification.loop-convergence
---

## 权威陈述

<!-- ccm:k:start point:verification.loop-convergence -->
当一个节点的执行图取决于事先未知的中间结果（分支）时，就 loop 到收敛为止——Joiner 模式：

- **结构化闸**：一个结构化的二选一——`FinalResponse`（收敛 → 收工）vs `Replan(feedback)`（带上对先前尝试的诊断 + 要修什么 → 重编一张新 DAG → 重新调度）。这个决策按**类型**做，绝不凭一个模糊 / 空的判断——它和"一个 null review = 未通过"是同一套结构性防御。
- **`Replan.feedback` 是关键设计** —— 它不是盲目 retry，而是一个**带诊断的 replan 信号**（这正是 impl → review → verify → amender 的内层 loop：verify 闸 ≈ Joiner，amender feedback ≈ `Replan.feedback`）。
- **max-rounds 保险丝** —— 每个内层 loop 都必须有保险丝（打到轮数 / 调用上限就停）。没有 loop 可以无界地跑。
- **dedup-against-seen** —— 把已否决的项目记下来，免得一个被否的选项每一轮又重新冒出来。
<!-- ccm:k:end point:verification.loop-convergence -->

## 失效类型

`capability_gap`（主体：事实方法） —— 删掉后 agent 在处理分支未知的执行图时,不知道该用带类型的二选一去收敛,可能用一句模糊结论替代,也不会主动加 max-rounds 保险丝和 dedup-against-seen,导致循环可能无界重复劳动。

主体是分支收敛的编排模式（Joiner 结构化二选一、带诊断的 replan、保险丝、dedup），删掉就缺了处理未知分支的方法框架。

## 失败形态

循环确实在跑、每轮都有输出,但 Replan 那侧从没真正携带上一轮的具体诊断(只是空泛的“再试一次”),也没有计数——外形在收敛,实质上是无诊断的裸重试,且没有保险丝防止无界运行。
