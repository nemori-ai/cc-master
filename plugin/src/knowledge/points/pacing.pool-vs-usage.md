---
point: pacing.pool-vs-usage
---

## 权威陈述

<!-- ccm:k:start point:pacing.pool-vs-usage -->
## 与 `usage advise` 的关系

selected-target `usage advise` 是绝对配额压力轴：这个池有多满、是否该 throttle / stop / 考虑该 target 支持的重 lever。pool-aware own row 是相对分配轴：在同一个已证明池里，本板相对 sibling 该让还是该接。只有一块 active board 时，相对分配退化成单板 verdict，不制造额外协调噪音。

优先级权重是固定校准值：`urgent=8`、`high=4`、`normal=2`、`low=1`、`trivial=0.5`。低优 board 只有 fair-share floor，不能靠轮转抢占高优 work；这防止低优任务饿死，但不会把它提升成同等紧急。

<!-- ccm:k:end point:pacing.pool-vs-usage -->
