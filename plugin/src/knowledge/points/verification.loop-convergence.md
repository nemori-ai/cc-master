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
