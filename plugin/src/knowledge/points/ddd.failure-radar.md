---
point: ddd.failure-radar
---

## 权威陈述

<!-- ccm:k:start point:ddd.failure-radar -->
## 反模式速查表

| 反模式 | 识别信号 | 修复方向 |
|---|---|---|
| **贫血模型（Anemic model）**| Entity 是字段包，行为全在 service；entity 零不变式 | 把每条不变式移回能原子持有它的 entity；若移后 entity 仍无规则，质疑它是否需要是 aggregate |
| **Aggregate 膨胀（Aggregate inflation）**| 每个名词都是 root；候选 root 零不变式 | 运行资质审计：无不变式 + 无独立生命周期 → 降级为 record / value object |
| **为对称而对称（Symmetry for its own sake）**| 某模式因为在一处适用就被用遍全系统 | 模式是对力（forces）的回答，不是制服——只在力存在时用 |
| **空洞包装（Idle wrapper）**| 抽象层对已足够的底层无行为、无合约变化 | 删除；domain 拥有 Protocol / 接口，不是包装每个库 |
| **答案卷先行（Answer-sheet-first）**| 责任段在无推导的情况下被交出；用例无可追溯的 storming 来源 | 退回五步流程；无溯源用例 = 虚造范围，删除或重新推导 |
| **语言漂移（UL drift）**| 凭记忆使用术语；在本地重定义已锁定术语 | 用前打开 SSOT；改定义走 SSOT（必要时经 ADR），禁止局部遮蔽 |
| **判别器泄漏（Discriminator leakage）**| 和类型标签、生命周期标签泄露进事件名/类型名 | 线上标识用最抽象的稳定名词；判别器活在载荷字段 |
| **弹性分层（Flexible layering）**| Domain 继承 ORM 基类；应用服务直接查数据库；domain 调外部 API | 恢复依赖单向：domain 不见 persistence，persistence 层是 ACL |

---

<!-- ccm:k:end point:ddd.failure-radar -->
