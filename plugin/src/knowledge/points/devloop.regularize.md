---
point: devloop.regularize
---

## 权威陈述

<!-- ccm:k:start point:devloop.regularize -->
## 心智锚 8:正则化 = 简单性先验

在**同样满足目标函数**的多个方案里,选**最简单**的(最小改动、最少新概念、最少新依赖)。复杂度是目标函数没奖励、却要长期偿还的成本——简单性是你的正则项,防止"为复杂而复杂"的过拟合。(这与 `slicing-goals-into-dags` 的"薄增量"同源:小而简,在切分层和执行层都是正则。)

工程手艺是 regularization 的来源:SDD 把 objective 固成契约,DDD/OOP 缩小坏模型空间,TDD 保证 instrument 可读。细节归 `engineering-with-craft`;本 skill 只把它们放进优化图里。

<!-- ccm:k:end point:devloop.regularize -->
