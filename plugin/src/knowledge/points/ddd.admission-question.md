---
point: ddd.admission-question
---

## 权威陈述

<!-- ccm:k:start point:ddd.admission-question -->
## 那一个问题（道）

> **有没有值得保护的不变式或语言？**

这是 DDD 的根问题，在每个尺度递归——子项目、aggregate、乃至单个字段。

DDD 的每一项仪式——aggregate、repository、分层、事件——都是为了保护**不变式**（某人依赖的一致性约束）或**语言**（其他上下文赖以反应的词汇）而支付的协调成本。**两者皆无，DDD 只是仪式，不是保护**：简单的 CRUD + 数据模型才是诚实的答案。

判断路径：

- 存在真实不变式（跨字段一致性、状态机守卫、溯源语义）→ 使用完整 DDD 分层
- 多个消费者依赖这个模型的语言保持稳定 → 使用 bounded context + ubiquitous language
- 纯 CRUD 且字段验证是唯一约束 → 普通 service + 数据模型，诚实即是品味
- 「共享工具」性质（轻量跨 BC 包，无自己的领域规则）→ 不要包装成 bounded context

---

<!-- ccm:k:end point:ddd.admission-question -->
