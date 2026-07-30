---
point: pacing.own-row
---

## 权威陈述

<!-- ccm:k:start point:pacing.own-row -->
## 读 `own_row`

`own_row.kind` 是你要读的主字段：

| kind | 怎么读 |
|---|---|
| `pacing_yield` | 本板当前 burn 高于加权目标；把 `delta_headroom_pct` 作为应让出多少 headroom 的强度输入，并列出 WIP、模型档和 high-float 对 burn 的影响供编排决策层取舍。 |
| `pacing_claim` | 本板低于加权目标，且同池存在超额 peer；own row 显示正 headroom 空间。 |
| `pacing_throttle` | 没有明确 sibling 可 claim，或全池压力已达到 throttle 区间。 |
| `pacing_switch` | 引擎提出 host-specific 重 lever 候选；它不是账号 mutation 授权，禁止自动换号的 host 仍保持禁止。 |
| `pacing_stop` | 全池到 stop 边界；输出 stop 强度、reset 事实和用户决策边界，具体编排动作查 `master-orchestrator-guide`。 |
| `hold` | 没有 durable 通知，容量压力未触发。 |

`target_headroom_pct` 是本板在当前池压力下按优先级权重分到的目标 headroom。`delta_headroom_pct = target - burn`：负数表示你超额，正数表示你有可 claim 空间。单位就是 headroom 百分点，不是 WIP 档位。

<!-- ccm:k:end point:pacing.own-row -->
