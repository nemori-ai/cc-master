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
