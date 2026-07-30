---
point: sdd.change-order
---

## 权威陈述

<!-- ccm:k:start point:sdd.change-order -->
## 变更纪律：先改 spec

**顺序：spec → impl → test。顺序反了就是让实现偷偷定义真相。**

| 变更类型 | 正确顺序 | 症状（反序） |
|---|---|---|
| 新增行为 | 1. 扩展 spec（新接口 / 新字段 / 新行为示例）2. 写对应测试（先红）3. 实现 | 先写实现，再补 spec，测试验的是实现 |
| 修改行为 | 1. 修改 spec，明确标注 breaking change 2. 更新测试 3. 更新实现 | 实现悄悄偷偷变了，spec 没动，消费者靠 spec 推断的行为不再成立 |
| 删除行为 | 1. 标记 spec 中该条目为 deprecated 或删除 2. 同步通知消费者 3. 删除实现 | 直接删实现，消费者不知道合约变了 |

**breaking change 红线**：如果 spec 的修改使现有消费者的合法调用不再成立，这是一个 **breaking change**，必须显式标注、走版本协商——不能静默发生。静默的 breaking change 是 spec 漂移的一种。

---

<!-- ccm:k:end point:sdd.change-order -->
