---
point: tdd.loop-boundary
---

## 权威陈述

<!-- ccm:k:start point:tdd.loop-boundary -->
## 接缝

本文讲「test-first 纪律本身怎么执行」：铁律、红绿重构步骤、constraint-parity、completion gate。

另一侧讲「**测试为什么**在执行循环里是梯度信号」：验收=objective、测量-迭代-收敛、plateau→restart 那套元循环心智模型。

两者不同 plane，互补不重叠。本文是手艺的纪律，另一侧是循环的形状。

---
<!-- ccm:k:end point:tdd.loop-boundary -->

## 失效类型

`environment_fact`（主体：事实方法） —— 删掉后，agent 不知道“test-first 手艺”与“外层迭代循环形状”在本知识体系里是分开维护、互补不重叠的，可能把两者内容混写或互相复述。

主体是本项目两份文档（本文与 dev-as-ml-loop）各管什么的分工事实。
