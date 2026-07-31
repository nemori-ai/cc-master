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

## 失效类型

`capability_gap`（主体：事实方法） —— 删掉后,agent 不认识这套项目特定的反模式命名与识别信号(尤其是答案卷先行、判别器泄漏这类非通用 DDD 术语),即便通晓通用 DDD 也无法诊断出对应的结构性失败。

主体是反模式的识别信号与修复方向对照表，属于诊断方法。

## 边界

适用于已决定做 DDD 建模之后的设计/评审阶段,用来识别常见结构性失败;不判断『要不要引入 DDD』本身。没有真实例外——表中任一行的识别信号一旦命中就是需要处理的信号,没有『这次先放着』的合法状态。

## 失败形态

最隐蔽的是『答案卷先行』——产出的 bounded context 划分、职责表看起来规整专业,评审挑不出明显毛病,因为它像是深思熟虑推导出来的;实际上这些边界没有可追溯到真实业务规则或不变式的推导链条,只是凭经验直接给出的答案。
