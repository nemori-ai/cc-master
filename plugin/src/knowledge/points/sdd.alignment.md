---
point: sdd.alignment
---

## 权威陈述

<!-- ccm:k:start point:sdd.alignment -->
## 三者对齐：spec ⊳ impl ⊳ test

```
spec（合约 SSOT）
    ├─→ impl：满足 spec 的实现
    └─→ test：对着 spec 验收的测试
```

**spec 给测试提供 oracle（裁判）**：测试不是随机地对实现施加断言，而是把 spec 里的每一条不变式 / 错误契约 / 行为示例**翻译成可执行断言**。如果一个测试通过但对应的 spec 条目没有被覆盖，你没有验收——你只是在随机探索实现的一个行为快照。

**实现满足 spec，而非反过来**：「我改了实现，测试也跟着改，没有 spec 约束」= 让实现偷偷定义真相。那是两个行为一致的系统，不是一个有合约的系统。

回扣**根 5（证据优于声称）**：completion gate 看的是「所有 spec 条目有对应测试通过」，不是「我觉得实现是对的」。光说「已实现」不算通过——拿出 spec 与测试对齐的证据。

---

<!-- ccm:k:end point:sdd.alignment -->
