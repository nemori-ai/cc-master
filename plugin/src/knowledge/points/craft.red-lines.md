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

## 失效类型

`motivation_conflict`（主体：行为约束） —— 删掉后，agent 在四个理论各自的具体压力下，容易把这五条本不可权衡的红线当成看情况的品味问题去谈判——吞掉一个不便处理的异常、让 mock 松掉约束、或加一层不挣开销的包装类。

五条工程红线（不吞异常、spec 不漂移、test-first、constraint parity、无 idle wrapper）主体都是「别图省事这么写」，正确路径全部更费力。

## 为什么它随模型变强而更重要

这张表把四套理论的红线压缩成五条无例外声明，模型越强，越擅长针对某一条现场构造'这里例外成立'的具体论证，论证越有技术含量就越容易被自己和审阅者误认成合理判断而非违反；这种构造能力随模型变强而变强。

## 失败形态

隐蔽违反：为不吞异常，把错误处理写成一个专门 wrapper 类来'规范地'捕获转换异常，但这个类除了包一层 try/catch 转个类型不提供任何行为——满足了'不吞异常'的说辞，实为'无 idle wrapper'红线要禁止的东西。
