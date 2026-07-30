---
point: sdd.practice-anchors
---

## 权威陈述

<!-- ccm:k:start point:sdd.practice-anchors -->
## 当代实践锚

SDD 的精神在业界有多种形态的具体落地——本节列锚点供参考，**语言 / 工具中性**，不绑特定栈：

| 实践 | 核心 spec 载体 | SDD 精神的体现 |
|---|---|---|
| **Contract-First API 设计**（先写 OpenAPI/GraphQL schema，再写实现）| OpenAPI spec / GraphQL schema | spec 在实现之前由双方签署；consumer-driven contract testing 用 spec 验收实现 |
| **Schema-First 开发**（先定义 JSON Schema / Protobuf / Avro，再写序列化/反序列化代码）| JSON Schema / Protobuf IDL / Avro schema | schema 是数据合约的 SSOT，代码从 schema 生成或验证 |
| **Consumer-Driven Contract Testing**（消费者先写期望、发布为 spec，生产者对着 spec 验收）| 消费者期望文件（Pact 等）| spec 从消费者侧流向生产者——谁消费谁定义合约，颠倒了「生产者先定义」的直觉 |
| **Spec-Kit 风格**（spec 文件是可执行的，spec-then-code 而非 code-then-spec）| 可执行 spec 文件（BDD feature files、doctest、literate spec）| spec 本身可运行——spec 和测试是同一件东西，spec 漂移会直接触发测试失败 |
| **Type-Level Spec**（用类型系统表达不变式——newtype / branded type / dependent type）| 类型签名 | 类型是机器检查的 spec；类型错误 = spec 违反；编译期 oracle |

**共同模式**：无论哪种形态，SDD 的价值主张不变——**合约先达成、实现后来满足、测试对着合约验收，三者的裁判是 spec 而非实现**。工具只是让这个信念在特定语言 / 栈里落地的载体。
<!-- ccm:k:end point:sdd.practice-anchors -->
