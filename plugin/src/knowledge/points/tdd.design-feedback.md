---
point: tdd.design-feedback
---

## 权威陈述

<!-- ccm:k:start point:tdd.design-feedback -->
## 卡住时怎么读

不知道如何写测试，不等于跳过测试。

| 症状 | 读法 |
|---|---|
| 不知道怎么测它 | 先写出期望的 API 调用 + 断言——测试就是接口的设计草图，写测试倒逼出接口设计 |
| 测试的 setup 极其庞大 | 被测对象依赖太多——精简接口，或提取 fixtures；测试 setup 的重量是依赖复杂度的直接映射 |
| 必须 mock 掉一切才能测 | 被测代码耦合太紧——改成依赖注入（Protocol / interface），见 `oop.md` |
| 测试极难写，感觉不可能 | 设计难以使用——这是一个值得讨论的设计 fork，不是「跳过测试」的理由 |
| 测试刚好就是很简单的东西 | 简单的代码也能崩。测试三十秒，生产 incident 不止三十秒 |

**硬写不出来的测试是设计在批评自己。** 听它，不要射杀信使。

---

<!-- ccm:k:end point:tdd.design-feedback -->
