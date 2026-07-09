---
name: pacing-and-estimation
description: '{{PACING_DESCRIPTION}}'
---

# pacing-and-estimation — 消费 ccm 只读 advisory 配速 + 估算

> **分发 skill（随插件 ship）。** `ccm` 的 `usage` / `estimate` / `baseline` 是 cc-master 的**只读 advisory**——出 verdict / 数据，**不替 orchestrator 决策**。本 skill 是它们的**消费手册**：不是「该不该减速/换号/停派」（那是 `master-orchestrator-guide` 的编排决策），而是「既然要 pace / 要估算，怎么读这些 advisory 的 verdict 与字段、怎么喂回你的判断」。
>
> {{PACING_BOUNDARY}}

---

## 何时翻开本 skill

你在一场长跑里要**消费 ccm 的只读 advisory** 做配速或估算判断的输入时——把长跑对照配额窗口 pace、选模型档、估工期/风险、读 `ccm usage advise` / `ccm coordination arbitrate` / `ccm estimate forecast` 的输出——就用本 skill 把 verdict 与字段读对。深度按轴分进 reference：{{PACING_REFERENCE_POINTERS_HEAD}}

---

## 心智锚 1：ccm 出 verdict，你（orchestrator）决策

`ccm usage` / `estimate` 是**只读 advisory**——它替你**算**（走廊数学、MC 工期仿真、EVM、风险指数），吐一个 `verdict` 或一组带诚实字段的数。它**不替你拍**「该不该减速 / 该不该 surface 用户 / 该不该换号」。本 skill 教你**读 verdict + 解读字段**；读完之后的**动作**永远回到 `master-orchestrator-guide`（「量力而行」镜头、「该问就问」镜头、决策程序的 7d 总闸）。

- **别自己重算引擎已经算好的东西**（DRY）：`ccm usage advise` 已把账户 `used_percentage` + `resets_at` + effective-N 喂进引擎走廊数学，你**读它的 `verdict` 字段**即可，不必自己拿百分比重算走廊上下沿。
- **诚实降级是 advisory 的一等公民**：账户信号不可得 → `available:false`（exit 0，不是 exit 1）。这不是错误、是「pacing 此刻不可判」——别据空信号瞎催。
- **同池多板时读 pool-aware own row**：`ccm coordination arbitrate --json` 把绝对配额压力和同池 peer 的相对分配合成一条 own row；它只写本板 inbox，建议仍是 advisory。怎么读 `pacing_yield` / `pacing_claim` / `pacing_stop` 见 `references/pool-aware-advice.md`。

## 心智锚 2：pacing verdict 是单侧的，直接对应一个 lever 类

`ccm usage advise --json` 出**单侧走廊 verdict（5 值 enum·没有旧模型里的 `accelerate` 欠用侧加速与 `hard_stop`）**——只在逼近走廊上界时出声（临界减速 / 换号 / 停），走廊内静默：

| verdict | 含义 | 对应 lever 类（怎么做见 pacing-levers.md） |
|---|---|---|
| `hold` | 在走廊内，维持 | ——（静默） |
| `throttle` | 5h 临界减速 | 降档模型 / 降 WIP / 推迟 high-float |
{{PACING_SWITCH_VERDICT_ROW}}
| `stop_5h` | 5h 本窗口烧穿·无可切备号 / 7d 亦吃紧 | {{PACING_STOP_5H_WAKEUP_LEVER}} |
| `stop_7d` | **7d≥85% 跨窗口硬总闸** | 停派新节点、surface 用户拍板（**动作归 `master-orchestrator-guide`「量力而行」/「该问就问」镜头 + 决策程序**） |

附字段：`strength`（标签强度 weak\|strong·ccm 出、注入方直接用）、`nearest_reset`（`stop_*` 时该窗 reset 时刻·引导 arm wakeup）、`switch_candidate`（`switch` verdict 时推荐切入的备号·**切不切由编排层 + 用户拍**）、`pool`（号池粗粒度 { backups, switchable }）。**`stop_7d` 是最该认真对待的 verdict**——7d 是不可逆的跨窗口消耗边界，读到它就把决策 surface 回编排层，绝不当 FYI 自行越过。`stop_5h` 则是「本窗口这份配额烧穿了」——不是终点、是 arm 一个自我唤醒守到 reset 回血的信号。

## 心智锚 3：estimate 整轴别 out-of-mind

模型默认**想不到**去查估算——能力（`ccm estimate` 5 verb）就绪，消费层从不被召回。在三个拍子主动 consult estimate（操作化「何时查 → 读哪字段 → 判什么」详见 estimation.md）：

- **dispatch / 排期拍**：`ccm estimate forecast` 出目标 ETA（p50/p80/p95 双通道 MC）——读 p80 对照 deadline，超了就是 replan / surface 信号。
- **recon / 中途拍**：`ccm estimate evm` 出 CPI/SPI（进度/成本偏差）——SPI<1 落后于计划、CPI<1 超预算，据此判要不要调度。
- **replan / 风险拍**：`ccm estimate risk` 出综合风险指数；`ccm estimate cost-to-complete` 出剩余工作量。
- **诚实字段先读**：`coverage_pct` 低 / `source:"no-history"` / `confidence:"low"` / conformal 区间很宽 → **降低对该预测的信任权重**（别拿一个 cold-start 的点估当承诺）。

{{PACING_MODEL_TIER_ANCHOR}}

## usage ⊗ estimate 张力（典型决策输入）

配额 `throttle`/`stop_7d` 但 `forecast` 还很长——容量不够装完该装的活，是本 skill 最常喂给编排决策的一种张力。怎么识别（读哪两个字段对比）+ 怎么办（surface 给用户三选一）的完整阐述见 estimation.md §usage ⊗ estimate 张力，本节不复述。

## duration ⊗ 模型档位（别把长任务自动升档）

选模型档时同时看三轴：**复杂性**（问题结构有多难）、**不确定性 / 风险**（错了代价多大）、**duration**（预计会占用多久）。duration 是成本与排期信号，不是智力需求信号：一个 6h 的机械迁移通常该拆小、降 WIP 或外部化，而不是自动升到更强模型；一个 30m 的架构裁决可能反而需要强档。看到 cadence oversized / overbooked warning 时，先问「能不能切薄」和「能不能把非临界部分放到 float / background」，再谈升档。

实测 duration 漂移要回流到估算：完成任务比 estimate 慢很多时，重估未开始下游；比 estimate 快很多时，也别立刻把全局 forecast 乐观化，先确认它不是特殊样本。

---

## 热路径速查

```bash
ccm usage advise --json        # 单侧走廊 verdict（hold/throttle/switch/stop_5h/stop_7d）+ strength/nearest_reset/switch_candidate/pool
ccm coordination arbitrate --json # 同池 pool-aware own row（yield/claim/throttle/switch/stop）+ inbox append edge
ccm coordination inbox list --unconsumed --json
ccm usage show --json           # 当前号 + 备号 5h/7d used% / resets_at / effective_n（状态，非 verdict）
ccm usage task-cost <id> --json # 单任务 token 成本
ccm estimate forecast --json    # 目标 ETA：p50/p80/p95 双通道 MC
ccm estimate evm --json         # CPI/SPI 进度成本偏差（需 baseline 作前置）
ccm estimate risk --json        # 综合风险指数
ccm estimate cost-to-complete --json
ccm baseline snapshot           # iteration 起点基线（EVM 的 plan SSOT·写 noun）
```

{{PACING_COMMAND_CATALOG_POINTER}}

## footgun 速查

| 现象 | 真相 / 怎么做 |
|---|---|
{{PACING_USAGE_FOOTGUN_ROWS}}
| 想精确把 used% 收敛到 100% | 做不到（结构性硬墙：账户口径无绝对 token 分母 + burn 与额度不在同一可信路径）。只做方向性走廊。详见 usage-signals.md 诚实天花板。 |
| `estimate evm` 报没有 baseline | EVM 死依赖 baseline 作 plan 基线——先 `ccm baseline snapshot`（见 estimation.md baseline 生命周期）。 |
| forecast 给了点估就当承诺 | 先读诚实字段（coverage_pct / confidence / conformal 区间）——cold-start / 低覆盖时点估不可信，降低信任权重。 |
| 把 `stop_5h` 当终点 | `stop_5h` 是「本窗口这份 5h 配额烧穿」——不是任务失败，是 arm 一个 watchdog 守到 `nearest_reset` 回血再续派的信号（换号无门时的兜底）。见 pacing-levers.md。 |
| 多板同池时只看自己的 `usage advise` | 漏掉 sibling 相对分配。读 `coordination arbitrate` 的 own row；`pacing_yield` / `pacing_claim` 的字段解释见 `references/pool-aware-advice.md`。 |

---

## Pointers

{{PACING_POINTERS_HOST}}
{{PACING_SIBLING_POINTERS}}
- `references/pool-aware-advice.md` — 多块 active board 同池竞争时，怎么读 `coordination arbitrate` 的 own row / inbox 通知。
- 实时真相永远以 `ccm <namespace> <cmd> --help` 为准 + ccm 引擎是走廊数学 / 估算算法的实现 SSOT——本文是消费视图，不复述数学。
