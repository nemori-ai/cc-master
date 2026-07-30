---
point: craft.invariant-anchor
---

## 权威陈述

<!-- ccm:k:start point:craft.invariant-anchor -->
## 根 1：不变式即锚

先找到那条**任何时刻都必须为真**的约束——它同时决定了三件事：边界划在哪、守卫放进哪个对象、拿什么测试去戳它。

- **DDD**：aggregate 的边界由它要保护的不变式划定（不是按「谁重要」）。
- **OOP**：不变式住在能**原子持有**它的最小所有者里（entity 的方法，不是散落在一堆 service）。
- **TDD**：一个测试要能**触发 / 观察**这条约束——测不到的约束等于没在测它。

---

<!-- ccm:k:end point:craft.invariant-anchor -->
