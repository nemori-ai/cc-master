---
point: craft.red-lines
---

## 权威陈述

<!-- ccm:k:start point:craft.red-lines -->
## 红线（工程硬规则，违背字面就是违背精神）

这几条是四个理论共同的底线，**跨语言跨项目成立**。它们不在「品味可权衡」那一层——是不跨的线。深度展开见各 reference。

| 红线 | 一句话 | 深度 |
|---|---|---|
| **no silent failure** | 吞异常 = 对调用者说谎；agent-facing 更糟（教假世界模型）。绝不裸 catch-all、绝不让错误悄悄变默认值。 | oop.md |
| **spec 不漂移** | 实现偷偷偏离 spec 而不更新 spec = 契约谎言。改合约**先改 spec**。 | sdd.md |
| **test-first 不是可选** | 没有失败测试就没有产码；没看它失败，你不知道它在测什么。 | tdd.md |
| **constraint parity** | test double 必须强制与真实后端同样的约束，否则你测的是 mock 不是世界。 | tdd.md |
| **无 idle wrapper / 无虚造名** | 不挣开销的层删掉；事件 / 命令 / 枚举名来自合约源、不临时起。 | oop.md · ddd.md |
<!-- ccm:k:end point:craft.red-lines -->
