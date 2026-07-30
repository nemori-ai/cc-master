---
point: oop.abstraction-cost
---

## 权威陈述

<!-- ccm:k:start point:oop.abstraction-cost -->
## 这个抽象配得上它的开销吗？

每个新抽象都增加协调成本；默认是最简单可行的东西。判断标准：**near-decomposability**——一个责任、一条干净接口、可独立理解和测试。

优先扩展现有接缝（注册表、Protocol、hook），而不是竖起新边界；新边界需要结构性理由，不是假设的未来需求。

**两个提示问题**：

1. 如果我删掉这层，调用者直接调用底层 API，少了什么？（hook？翻译？合约语言变化？）如果什么都没少——删。
2. 这个抽象可以被独立理解和测试吗？不能——粒度错了，要么太大要么太细。

> 回扣根 4（分层思维）：依赖单向（domain 不依赖 persistence）；编排与规则分离（应用层纯编排、领域纯规则）。

---

<!-- ccm:k:end point:oop.abstraction-cost -->
