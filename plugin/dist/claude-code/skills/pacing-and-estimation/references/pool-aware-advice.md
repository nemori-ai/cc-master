# Pool-aware pacing advice（多编排池感知建议）

当同一台机器上有多块 active board，且上游事实**明确证明**它们在同一个 harness / quota pool 下并行跑时，单看自己的 `usage advise` 会漏掉 sibling 正在烧同一份配额。pool identity 为 unknown / ambiguous 时不得把 boards 合池。

先由 `using-ccm` 的 coordination 操作面或 monitor 产出本板 own row：该过程会把 usage signal 归一成 `PoolPressure`，按同池 peer 的 `coordination.priority` 和 `coordination.state.current.burn_contribution` 计算相对分配，并在命中边沿时写本板 `coordination.inbox`。这里不执行这项写操作，只消费已经产出的 own row；建议仍是 advisory，不是强制调度。

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

## 与 `usage advise` 的关系

selected-target `usage advise` 是绝对配额压力轴：这个池有多满、是否该 throttle / stop / 考虑该 target 支持的重 lever。pool-aware own row 是相对分配轴：在同一个已证明池里，本板相对 sibling 该让还是该接。只有一块 active board 时，相对分配退化成单板 verdict，不制造额外协调噪音。

优先级权重是固定校准值：`urgent=8`、`high=4`、`normal=2`、`low=1`、`trivial=0.5`。低优 board 只有 fair-share floor，不能靠轮转抢占高优 work；这防止低优任务饿死，但不会把它提升成同等紧急。

## Rationalization Table

| 借口 | 现实 |
|---|---|
| 「我自己的 `usage advise` 是 hold，所以 sibling 再忙也和我无关。」 | `hold` 只说明绝对配额还没撞单板上界；同池 sibling 可能已经超额或欠额。读取最新 own row，再把让路或 claim 作为编排决策输入。 |
| 「我是 urgent，所以可以吃完整个池。」 | urgent 只是权重更高，不是通吃授权。fair-share 是比例分配；超过 own row 的目标仍要有现实理由。 |
| 「看到 `pacing_claim` 就等于必须扩张工作。」 | `claim` 只描述正 headroom 空间，不决定是否派发；把 own row 交给编排决策层。 |
| 「`pacing_yield` 是强制命令，我照做就行。」 | 它是 advisory；own row 只提供 sibling goal、临界路径与 headroom 输入，最终动作由编排决策层拍板并记账。 |

## 消费顺序

1. 读取未消费的 pool-aware pacing 通知；通知查询与 ack 命令按 `using-ccm` 操作面执行。
2. 读 `own_row` 与 `allocation.rows`，只把 sibling rows 当解释上下文，不要试图写 sibling board。
3. 把 `own_row`、reset 事实与未消费通知作为决策输入交给 `master-orchestrator-guide`。
4. 通知缺失或陈旧时，不在这里触发写操作；回到 `using-ccm` 刷新或检查 coordination 状态。
