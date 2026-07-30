---
point: devloop.converge
---

## 权威陈述

<!-- ccm:k:start point:devloop.converge -->
## 心智锚 6:收敛 = 验收达标即停,别过拟合

loss 到 0(验收每一条都绿)= **收敛,停**。继续"优化"就是**过拟合**:

- **gold-plating**:优化验收**没要求**的维度(把不在目标函数里的东西做到完美)——这是在拟合一个不存在的 loss。
- **拟合噪声**:为了过某几个特定检查去 hard-code / 特判,而非满足底层意图(见锚 7)。

判断"做完了"的唯一标准是**目标函数达标**,不是"代码我看着舒服 / 还能更完美"。"完美"不是验收里的词。

orchestrator 视角:绿灯只是训练读数,端点验收才是 validation。若 acceptance 已满足,继续扩大抽象/补非目标功能就是 overfitting,除非你显式改变 objective 并让用户/board 接受它。

> **board 接地**:收敛要写成 `done + verified + artifact` 的组合语义——`verified` 这一位表示"loss 真到 0、端点测过",**不是**"我觉得差不多了"(呼应 `master-orchestrator-guide` 的 gate-green≠passed)。loop 跑了一半、"做了但还没确认收敛"是 `uncertain` 这一档 status,**不是** `done`——别把未测的当收敛标出去。命令见 `using-ccm`。

---

<!-- ccm:k:end point:devloop.converge -->
