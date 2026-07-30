---
point: devloop.objective
---

## 权威陈述

<!-- ccm:k:start point:devloop.objective -->
## 心智锚 1:验收标准 = 目标函数(objective / loss)

整个 loop 只有一个朝向:**最小化"当前实现 ↔ 验收标准"的距离**。所以第一件事永远是**把目标函数看清楚**——这个任务的验收标准(DoD)到底是什么、怎么测。

- 验收**清晰**(board 的 `acceptance` 字段就是这个"两态 objective function"):直接拿它当 loss,对着它优化。**但验收清晰不等于内部设计已定**——acceptance 锁的是外部可观察行为,锁不住存储选型 / 并发语义 / 失败模式这类决策。命中 `engineering-with-craft` sdd.md「值得 SDD」的场景时,先过它的动手前硬闸(先产出或引用已认可 spec),再开始 propose 第一个改动;别因为 acceptance 写得清楚就跳过这一步。
- 验收**模糊 / 缺失**:先把它**锐化成可测的**(找 benchmark、定指标与目标值、跟编排者确认),**再**开始优化。**没有明确 objective 的优化是随机游走**——你会在一个没有 loss 的空间里乱走,改半天不知道在不在变好。模糊就先锐化,别带着模糊的目标硬下降。
- 对 orchestrator 来说,模糊验收不是"派给强 agent 让它自己理解"——那是在把 loss function 外包给 worker。先派 objective owner / 问用户 / 写 spec delta,再派实现。

> **board 接地**:这个目标函数就是 board task 的 `acceptance` 字段(一句话 DoD 或 `{criteria:[…]}`)。开工先读它;空/糊则锐化是第 0 步,锐化后用 `using-ccm` 把新 DoD 落回 board、让目标函数对编排者也显式。

---

<!-- ccm:k:end point:devloop.objective -->
