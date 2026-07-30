---
point: workflow.resource-caps
---

## 权威陈述

<!-- ccm:k:start point:workflow.resource-caps -->
## 6. 硬 caps（资源边界）

| Cap | 值 |
|---|---|
| 每个 workflow 的并发 agent | **`min(16, cpu cores − 2)`**——超出的排队，slot 空出来就跑 |
| 每次 run 的 agent 总量 | **1,000**（runaway-loop 兜底，远高于真实需要） |
| 单次 `parallel()`/`pipeline()` 调用的 item 数 | **4,096**（超出显式报错——不是静默截断） |
| 脚本大小 | **512 KB**（`script` 参数上的 `maxLength: 524288`） |

**工程后果：** 你可以给 `parallel`/`pipeline` 喂多达 4,096 个 item，它们最终都会跑完，但
任一瞬间只有约 `min(16, cores−2)` 个在跑——其余排队。这就是为什么 fan out 100 个 agent
**并不**等于 100× 加速：一个固定的并发窗口卡住了吞吐（Amdahl / Gustafson + 一道固定窗口）。
按你实际拥有的窗口来规划并行度，别按 item 数。

<!-- ccm:k:end point:workflow.resource-caps -->
