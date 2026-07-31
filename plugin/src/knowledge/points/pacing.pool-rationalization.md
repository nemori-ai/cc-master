---
point: pacing.pool-rationalization
---

## 权威陈述

<!-- ccm:k:start point:pacing.pool-rationalization -->
## Rationalization Table

| 借口 | 现实 |
|---|---|
| 「我自己的 `usage advise` 是 hold，所以 sibling 再忙也和我无关。」 | `hold` 只说明绝对配额还没撞单板上界；同池 sibling 可能已经超额或欠额。读取最新 own row，再把让路或 claim 作为编排决策输入。 |
| 「我是 urgent，所以可以吃完整个池。」 | urgent 只是权重更高，不是通吃授权。fair-share 是比例分配；超过 own row 的目标仍要有现实理由。 |
| 「看到 `pacing_claim` 就等于必须扩张工作。」 | `claim` 只描述正 headroom 空间，不决定是否派发；把 own row 交给编排决策层。 |
| 「`pacing_yield` 是强制命令，我照做就行。」 | 它是 advisory；own row 只提供 sibling goal、临界路径与 headroom 输入，最终动作由编排决策层拍板并记账。 |

## 消费顺序

1. 读取未消费的 pool-aware pacing 通知。
2. 读 `own_row` 与 `allocation.rows`，只把 sibling rows 当解释上下文，不要试图写 sibling board。
3. 把 `own_row`、reset 事实与未消费通知作为决策输入。
4. 通知缺失或陈旧时，不在这里触发写操作；刷新或检查 coordination 状态。
<!-- ccm:k:end point:pacing.pool-rationalization -->

## 失效类型

`environment_fact`（主体：事实方法） —— 完全知道该读 own_row、该把决策交给编排层，但在想多派发、想快点推进时会挑一种对自己有利的解读（urgent 就该多用、claim 就该扩张）绕开这一步，是选择性忽略而非不懂。

表面是借口表，但「现实」列纠正的都是 hold / urgent 权重 / claim / yield 的字段语义误读，主体仍是接口事实。

## 边界

如果这个池里客观上只有自己一个占用者、没有 sibling row 可读，让路 / claim 的判断就无对象可比——这不是省略这一步，是这一步的输入本就不存在。

## 失败形态

编排层确实读了 own_row、log 里也记了一句已检查 sibling 状态，但实际决策没被那份状态改变——不管 sibling 是否吃紧都按原计划扩张；形式上走了消费顺序的每一步，实质上那一步的读取结果从未真正进入决策。
