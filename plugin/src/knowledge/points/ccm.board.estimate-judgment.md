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
| 多天 | `2d`+  | **考虑再切**：任务畸大往往意味着可以纵切成更小的、可独立交付的薄片 |
| 超过 1 周 | `1w`+ | 几乎肯定要拆；这种粒度的 estimate 误差巨大、无法驱动有效调度 |

**estimate 缺失时的降级：** CPM 用默认 unit（工期排序仍运行，但 makespan 是 `weight_source: "mixed"`，精度降低）。但在 open cadence iteration 里，缺 estimate 会触发 `BIZ-CADENCE-MISSING-ESTIMATE` warn：这不是 hard gate，但表示你无法判断本轮 timebox 是否 overbooked。

**不要把 estimate 当承诺：** 它是输入，不是 SLA。`actual = finished_at − started_at`（从时间戳可算），事后回流校准下次估点。

---
<!-- ccm:k:end point:ccm.board.estimate-judgment -->

## 失效类型

`environment_fact`（主体：事实方法） —— 删掉后,agent 不知道 --estimate 的具体单位格式、存储结构,也不知道缺失 estimate 具体会触发什么后果,会按普适直觉硬猜格式或误判影响范围。

主体是 ccm estimate 的书写格式、存储形态与缺失时的降级/lint 行为，粒度参考只是附随说明。

## 边界

适用于给单个 task 填写 --estimate 这一取值决策;不覆盖『这个任务该不该拆』的决策本身。没有真实例外——即便任务性质上无法预估工期,也该走『缺失降级为 mixed』这条系统设计好的路径,而不是编造数字凑格式。

## 失败形态

给一个动辄以周为单位的任务照填 1w 就直接派发,不触发『考虑再切』的判断;或者把粒度合理的任务的 estimate 当承诺,进度稍有出入就当违约上报,而不是回流校准下一次估点。
