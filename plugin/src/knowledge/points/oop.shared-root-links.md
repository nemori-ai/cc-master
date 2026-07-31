---
point: oop.shared-root-links
---

## 权威陈述

<!-- ccm:k:start point:oop.shared-root-links -->
## 回扣共享根

五条共享根让 DDD / OOP / SDD / TDD 凝成同一个 skill 的脊椎。本文回扣其中三条：

- **根 1（不变式即锚）**：不变式住在能**原子持有**它的最小所有者——聚合根的单一方法，守卫与状态翻转不可分割（见[封装即词汇](#封装即词汇)）。
- **根 3（组合优于包装）**：idle wrapper 是死重——无 hook / 无翻译 / 无合约变化的层删掉；ACL 只在真实边界（见[组合优于继承](#组合优于继承) + [红线](#红线)）。
- **根 4（分层思维）**：依赖单向（domain 从不导入 persistence）；编排与规则分离——应用层纯编排、领域层纯规则，双因改变的症状是测试要 mock 一堆 I/O（见 [SOLID as Judgment · SRP](#srp--编排与规则分离) + [DIP](#dip--domain-拥有接口)）。
<!-- ccm:k:end point:oop.shared-root-links -->

## 失效类型

`environment_fact`（主体：事实方法） —— 模型不知道这三条共享根的具体应用标准和检查点，会过度设计或遗漏关键验证

主体是本 skill 文档体系里共享根编号与各章节的对应关系，属于本项目的结构约定。
