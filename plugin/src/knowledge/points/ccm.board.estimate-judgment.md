---
point: ccm.board.estimate-judgment
---

## 权威陈述

<!-- ccm:k:start point:ccm.board.estimate-judgment -->
## E. estimate 怎么估

`estimate` 存时间估算，喂 CPM 算临界路径，也喂 cadence health 判断 iteration 是否装得下。

**格式：**

```bash
ccm task add T3 --estimate 3h    # 3 小时
ccm task add T4 --estimate 90m   # 90 分钟
ccm task add T5 --estimate 2d    # 2 天
ccm task add T6 --estimate 1w    # 1 周
```

存储形态是 `{value: 3, unit: "h"}`，由 ccm 自动解析。

**粒度参考（操作侧）：**

| 粒度 | 典型 estimate | 行动指南 |
|---|---|---|
| 几分钟 | `15m`–`30m` | 考虑合并到上下游，太细增加调度开销 |
| 半小时到几小时 | `1h`–`6h` | 理想粒度，可并行、可独立验收 |
| 半天到一天 | `4h`–`8h` | 可接受；估算有 24% 离散度，误差在一个数量级内 |
| 多天 | `2d`+  | **考虑再切**：任务畸大往往意味着可以纵切成更小的、可独立交付的薄片——切法参见 `slicing-goals-into-dags` skill |
| 超过 1 周 | `1w`+ | 几乎肯定要拆；这种粒度的 estimate 误差巨大、无法驱动有效调度 |

**estimate 缺失时的降级：** CPM 用默认 unit（工期排序仍运行，但 makespan 是 `weight_source: "mixed"`，精度降低）。但在 open cadence iteration 里，缺 estimate 会触发 `BIZ-CADENCE-MISSING-ESTIMATE` warn：这不是 hard gate，但表示你无法判断本轮 timebox 是否 overbooked。

**不要把 estimate 当承诺：** 它是输入，不是 SLA。`actual = finished_at − started_at`（从时间戳可算），事后回流校准下次估点。

---

<!-- ccm:k:end point:ccm.board.estimate-judgment -->
