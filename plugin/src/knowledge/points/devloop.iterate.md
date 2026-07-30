---
point: devloop.iterate
---

## 权威陈述

<!-- ccm:k:start point:devloop.iterate -->
## 心智锚 2:dev loop = 迭代优化,不是一次成型

**propose 改动 → 测量 → 读梯度 → 调整 → 重复。** 小步、每步测量,优于"写一大坨再跑"——后者等于一步迈到谷底、放弃了沿途所有方向信息。每一轮的产出不是"更多代码",是"更小的 loss + 一点关于下一步往哪走的信息"。

把每一轮当成一个可证伪 hypothesis:"我相信改 X 会因为 Y 降低 loss。"然后做最小有用干预并测量。说不出 hypothesis 却继续写代码,通常是在用 churn 假装优化。

---

<!-- ccm:k:end point:devloop.iterate -->
