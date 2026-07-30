---
point: workflow.api-failure
---

## 权威陈述

<!-- ccm:k:start point:workflow.api-failure -->
## Failure 语义（汇总）

| 位置 | 出错时 |
|---|---|
| `agent()` 被用户跳过 | 返回 `null` |
| `parallel()` thunk 抛错 | 对应槽位变 `null`；调用绝不 reject |
| `pipeline()` stage 抛错 | 那个 item 变 `null`；余下的 stage 全跳过 |
| `workflow()` 名字未知 / 读不到 / 嵌套 | **抛错**（catch 来降级） |
| `budget.total` 耗尽后再调 `agent()` | **抛错** |
| `Date.now()` / `Math.random()` / 无参 `new Date()` | **抛错**（determinism 守卫） |

<!-- ccm:k:end point:workflow.api-failure -->
