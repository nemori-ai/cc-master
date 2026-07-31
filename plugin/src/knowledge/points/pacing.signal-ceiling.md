---
point: pacing.signal-ceiling
---

## 权威陈述

<!-- ccm:k:start point:pacing.signal-ceiling -->
## 信号源与诚实天花板

- machine-wide `readings[]` 暴露 target、`used_percentage`、reset / observation / validity 时间与 source；
  unavailable / expired reading 另带可选 `refresh_hint`，先读其中的 `agent_authorized` / `authorization` 再决定
  是否执行 `command`。`summary.decisions[]` 是它的 agent-safe posture。它们不证明模型 entitlement，也不替代
  quota preflight 的 authority-bound spawn limit。
- `usage show` 的统一窗口都位于 `data.current.{five_hour,seven_day,fable_seven_day,billing_period}`，named pools
  位于 `data.current.pools[]`；不适用或不可得为 `null` / 空数组。**不要读取不存在的 `data.five_hour` 等顶层
  窗口。**`data.agent_summary` 是一句 plain-language 状态 + 可执行动作，`data.refresh_hint` 是结构化恢复提示；
  两者都在 `current` 外的 `data` 顶层。`accounts[]` 不把 current signal 的 `available` 点亮。
- 这些信号给百分比与 reset，不给绝对 token 分母；因此只能表达压力方向、强度与重判时间，不能承诺把
  used% 精确收敛到某点。
- 账户级 pacing 与 per-node observability 正交。task token / duration / tool uses 来自对应后台任务的真实
  telemetry；不要用并发期间的账户级 delta 反推单节点成本。
<!-- ccm:k:end point:pacing.signal-ceiling -->

## 失效类型

`environment_fact`（主体：事实方法） —— 这条全是具体字段路径与本系统的信号语义（data.current.* 下的具体键名、accounts[] 不点亮 available 等），模型不可能凭通用知识猜对，删掉就会读错字段或臆造出不存在的绝对 token 分母。

主体是 machine-wide readings 与 usage show 的确切 JSON 路径和字段含义，删掉就会去读不存在的顶层窗口。

## 边界

这条只讲信号「是什么、放在哪、能不能兑现精确承诺」，不讲拿到信号后该怎么决策配速，也不讲某次具体调用是否被授权执行——只提示先读 authorization 字段，不替你做判断。

## 失败形态

表面顺从、实质违反：代码或推理里直接引用 data.five_hour 这类不存在的顶层字段，拿到 undefined 却当成「暂时没有压力」处理而不报错；或拿 used_percentage 反推出一个精确剩余 token 数字做预算承诺，又或用并发期间账户级的百分比变化去归因某一个后台节点的真实消耗。
