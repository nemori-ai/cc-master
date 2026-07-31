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
| `pacing_switch` | 引擎给出的容量层候选，消费方是后台统一管控、不是你；你不因此获得换号这个动作，禁止自动换号的 host 仍保持禁止。 |
| `pacing_stop` | 全池到 stop 边界；输出 stop 强度、reset 事实和用户决策边界。 |
| `hold` | 没有 durable 通知，容量压力未触发。 |

`target_headroom_pct` 是本板在当前池压力下按优先级权重分到的目标 headroom。`delta_headroom_pct = target - burn`：负数表示你超额，正数表示你有可 claim 空间。单位就是 headroom 百分点，不是 WIP 档位。
<!-- ccm:k:end point:pacing.own-row -->

## 失效类型

`environment_fact`（主体：事实方法） —— own_row.kind的枚举语义是这套引擎特有的字段事实,模型无法从通用知识猜出pacing_switch不是换号授权、pacing_claim是相对而非绝对余量,读错会直接做出错误的编排判断。

主体是 own_row.kind 各取值与 target/delta_headroom_pct 的字段语义与单位，属接口事实。

## 边界

own_row是同一pool内的相对分配读数,不代表自己账号相对配额窗口的绝对用量——即便own_row显示pacing_claim,自己的绝对usage仍可能已经很高,这两套坐标系必须分开读,不能互相替代。

## 失败形态

看到own_row.kind是pacing_claim、delta_headroom_pct为正,就直接判断现在可以放心加派更多任务,却没检查自己的绝对usage是否已临近配额窗口边界——同池有headroom可claim,不等于自己账号还有余量。
