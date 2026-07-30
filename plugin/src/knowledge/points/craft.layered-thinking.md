---
point: craft.layered-thinking
---

## 权威陈述

<!-- ccm:k:start point:craft.layered-thinking -->
## 根 4：分层思维

把「**算什么**」和「**从哪取 / 往哪写**」分开，依赖**只许从外朝里指**。

- 依赖**单向**：domain 不依赖 persistence / web；外层实现内层定义的接口。
- **编排与规则分离**：应用层纯编排（拉数据、发事件），领域层纯规则（不碰 I/O）。**双因改变的症状是测试要 mock 一堆 I/O**——那是该拆的信号。
- 测试随之分层：domain → unit（无 I/O），边界 → integration（对真实后端）。

---

<!-- ccm:k:end point:craft.layered-thinking -->
