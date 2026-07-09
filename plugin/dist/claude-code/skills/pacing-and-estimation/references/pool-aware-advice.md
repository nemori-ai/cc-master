# Pool-aware pacing advice（多编排池感知建议）

当同一台机器上有多块 active board 在同一个 harness / account pool 下并行跑时，单看自己的 `usage advise` 会漏掉 sibling 正在烧同一份配额。此时用：

```bash
ccm coordination arbitrate --json
ccm coordination inbox list --unconsumed --json
```

`arbitrate` 做两件事：先把当前 harness 的 usage signal 归一成 `PoolPressure`，再按同池 peer 的 `coordination.priority` 和 `coordination.state.current.burn_contribution` 算本板 own row。它只写本板 `coordination.inbox`，不写别人的 board；建议仍是 advisory，不是强制调度。

## 读 `own_row`

`own_row.kind` 是你要读的主字段：

| kind | 怎么读 |
|---|---|
| `pacing_yield` | 本板当前 burn 高于加权目标；让出 `delta_headroom_pct` 对应的 headroom，优先降 WIP / 降档 / 推迟 high-float。 |
| `pacing_claim` | 本板低于加权目标，且同池存在超额 peer；可以接住 slack，但仍要看自己的 DAG 是否真有高价值 ready work。 |
| `pacing_throttle` | 没有明确 sibling 可 claim，或全池压力要求本板减速；按普通 throttle lever 处理。 |
| `pacing_switch` | 当前配额压力已到切号更合理的区间，且本板是超额行；是否切号仍回编排决策层。 |
| `pacing_stop` | 全池到 stop 边界；停派新节点，按 stop lever / 用户决策边界处理。 |
| `hold` | 没有 durable 通知；维持当前节奏。 |

`target_headroom_pct` 是本板在当前池压力下按优先级权重分到的目标 headroom。`delta_headroom_pct = target - burn`：负数表示你超额，正数表示你有可 claim 空间。单位就是 headroom 百分点，不是 WIP 档位。

## 与 `usage advise` 的关系

`usage advise` 是绝对配额压力轴：这个池有多满、是否该 throttle / switch / stop。`coordination arbitrate` 是相对分配轴：在同一个池里，本板相对 sibling 该让还是该接。两者来自同一套引擎数学；只有一块 active board 时，`arbitrate` 退化成单板 verdict，不制造额外协调噪音。

优先级权重是固定校准值：`urgent=8`、`high=4`、`normal=2`、`low=1`、`trivial=0.5`。低优 board 只有 fair-share floor，不能靠轮转抢占高优 work；这防止低优任务饿死，但不会把它提升成同等紧急。

## Rationalization Table

| 借口 | 现实 |
|---|---|
| 「我自己的 `usage advise` 是 hold，所以 sibling 再忙也和我无关。」 | `hold` 只说明绝对配额还没撞单板上界；同池 sibling 可能已经超额或欠额。跑 `coordination arbitrate` 看 own row，再决定是否让路或 claim。 |
| 「我是 urgent，所以可以吃完整个池。」 | urgent 只是权重更高，不是通吃授权。fair-share 是比例分配；超过 own row 的目标仍要有现实理由。 |
| 「看到 `pacing_claim` 就该开更多活，把 quota 用满。」 | claim 是“可以接住 slack”，不是制造 busywork。只有 DAG 上确有高价值 ready work，且 WIP / 验收能力装得下，才 claim。 |
| 「`pacing_yield` 是强制命令，我照做就行。」 | 它是 advisory。你要理解 sibling goal、自己的临界路径和用户边界；默认认真权衡，但最终动作仍由编排决策层拍板并记账。 |

## 消费顺序

1. 读 `coordination inbox list --unconsumed --json`，先处理未 ack 的 pool-aware pacing 通知。
2. 没有通知但你怀疑同池竞争变化时，跑 `ccm coordination arbitrate --json` 触发一次边沿判定。
3. 如果 append 了通知，读 `own_row` 与 `allocation.rows`，只把 sibling rows 当解释上下文，不要试图写 sibling board。
4. 执行动作后 `ccm coordination inbox ack <id> --note "...已采取的配速动作..."`。
