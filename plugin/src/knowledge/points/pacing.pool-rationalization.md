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

1. 读取未消费的 pool-aware pacing 通知；通知查询与 ack 命令按 `using-ccm` 操作面执行。
2. 读 `own_row` 与 `allocation.rows`，只把 sibling rows 当解释上下文，不要试图写 sibling board。
3. 把 `own_row`、reset 事实与未消费通知作为决策输入交给 `master-orchestrator-guide`。
4. 通知缺失或陈旧时，不在这里触发写操作；回到 `using-ccm` 刷新或检查 coordination 状态。
<!-- ccm:k:end point:pacing.pool-rationalization -->
