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

**spec 给测试提供 oracle（裁判）**：把 spec 里每一条不变式 / 错误契约 / 行为示例**翻译成可执行断言**。测试通过但对应 spec 条目没被覆盖 = 没验收。

**实现满足 spec，而非反过来**：「改了实现、测试跟着改、没有 spec 约束」= 让实现偷偷定义真相。

回扣**根 5（证据优于声称）**：completion gate 看的是「所有 spec 条目有对应测试通过」，不是「我觉得实现是对的」。

---

<!-- ccm:k:end point:sdd.alignment -->

## 失效类型

`capability_gap`（主体：事实方法） —— 模型不会自动把测试当作 spec 每条条目的可执行断言来设计，可能对实现随意打断言，测试通过却没有真正验收 spec 的行为契约。

主体是 spec/impl/test 三者关系的概念框架——spec 充当测试的 oracle，缺了它就不知道该按什么标准判定验收。

## 失败形态

隐蔽违反：测试确实写了也通过了，但断言的是这份实现的具体返回值细节而非 spec 写的行为契约——换一种同样满足 spec 的合法实现，这个测试就会误报失败，它验的是快照不是契约。
