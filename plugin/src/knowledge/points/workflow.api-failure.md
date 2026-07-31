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

## 失效类型

`environment_fact`（主体：事实方法） —— 缺本框架对错误处理的特定约定：哪些场景静默降级为 null、哪些抛错、非确定源守卫

各处出错是返回 null 还是抛错的对照表是本引擎的行为事实。

## 边界

可分离的失败（skip、单个 parallel thunk 抛错、单个 pipeline stage 抛错）静默变 null，对应槽位可检验。不可分离的全局约束失败（未知 workflow、budget 耗尽、访问非确定源）抛错中止。边界判据：是否可被上一级 catch 处理或跳过——可以就变 null，不可以就抛错。

## 失败形态

误信所有失败都静默变 null，结果 budget 耗尽时被意外抛错。反过来过度 try-catch 包裹所有 agent() 调用，漏掉了构造时的检查（未知 workflow）。混淆 skip 的 null（用户显式行为）与异常转化的 null（系统自动降级）。最隐蔽的是在 workflow 脚本某处偷用 Date.now() 或 Math.random()，加上隐式重试会产生非幂等行为而且难以察觉。
