---
name: pacing-and-estimation
description: 'Use when 你（orchestrator/agent）在 Codex 下要消费 ccm 的只读 advisory 把它配速或估算——读当前 Codex 账号 5h/7d 用量、在 GPT-5.6 Sol/Terra/Luna 与 reasoning effort 间按效果/性价比选档、把长跑对照配额窗口 pace、估目标 ETA / 查进度偏差(EVM) / 看综合风险 / 算 cost-to-complete、或要读懂 `ccm usage advise` `ccm estimate forecast` 的 verdict 与字段时。它给的是**消费机制知识**:单侧走廊 verdict(hold/throttle/switch/stop_5h/stop_7d)怎么读、Codex 当前账号 rate-limit 信号源、GPT-5.6 family×effort 的配额充足/紧张两套 mapping、估算诚实字段(coverage_pct/confidence/conformal 区间)什么时候该降低对预测的信任、usage 与 estimate 张力怎么看。Triggers: 在 Codex 下读 ccm usage/estimate/baseline 的输出、"Sol/Terra/Luna 选哪个 / high、xhigh、max 怎么配 / 配额紧张怎么降档 / Ultra 什么时候值"、"降 WIP 信号出来了怎么落 lever / 该等 reset 还是问用户 / 这个 forecast 信不信 / EVM 偏差怎么看 / Codex 当前账号 5h 和 7d 怎么读"、配额逼顶要判读 usage 的那一半、pacing/估算 hook 注入提示。Do NOT use when 你要的是**决策**——该不该减速/停派/replan、7d 总闸要不要 surface 用户、范围/期限/配额取舍谁拍板(那是 master-orchestrator-guide);或 ccm 命令**怎么敲**、board 字段填什么(那是 using-ccm);或其他 harness 的 account 录号换号、statusline sidecar、workflow 脚本怎么写(这些 Codex adapter 当前不支持或不归本 skill)。ccm 出 verdict、决策归 master-orchestrator-guide——本 skill 只教消费层,不替编排做判断。'
---

# pacing-and-estimation — 消费 ccm 只读 advisory 配速 + 估算

> **分发 skill（随插件 ship）。** `ccm` 的 `usage` / `estimate` / `baseline` 是 cc-master 的**只读 advisory**——出 verdict / 数据，**不替 orchestrator 决策**。本 skill 是它们的**消费手册**：不是「该不该减速/换号/停派」（那是 `master-orchestrator-guide` 的编排决策），而是「既然要 pace / 要估算，怎么读这些 advisory 的 verdict 与字段、怎么喂回你的判断」。
>
> **职责边界**：**消费机制**归本 skill；**决策**归 `master-orchestrator-guide`；**命令怎么敲 / board 字段怎么填**归 `using-ccm`；**走廊数学 / 估算算法的实现 SSOT** 在 ccm 引擎。Codex 下消费当前账号 5h/7d 用量、GPT-5.6 family×effort mapping 与 host-neutral 估算；不投影其他 harness 的账号池切号或 statusline sidecar。

---

## 何时翻开本 skill

你在一场长跑里要**消费 ccm 的只读 advisory** 做配速或估算判断的输入时——把长跑对照配额窗口 pace、选模型档、估工期/风险、读 `ccm usage advise` / `ccm coordination arbitrate` / `ccm estimate forecast` 的输出——就用本 skill 把 verdict 与字段读对。深度按轴分进 reference：完整 reference 列表 + 何时翻哪份，见文末 [Pointers](#pointers)。

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
| `switch` | 当前 5h 临界但 Codex adapter 不支持账号池切换 | 不切号；当作强节流/停派信号处理，优先降 WIP / 推迟 float / 等 reset 或 surface 用户 |
| `stop_5h` | 5h 本窗口烧穿·无可切备号 / 7d 亦吃紧 | 停派新工作，记录 reset 后的 Codex recon；如果你有已配置的 Codex thread automation 或外部 scheduler，就把它作为 watchdog 句柄写进 board，否则 surface 给用户约定回来检查。 |
| `stop_7d` | **7d≥85% 跨窗口硬总闸** | 停派新节点、surface 用户拍板（**动作归 `master-orchestrator-guide`「量力而行」/「该问就问」镜头 + 决策程序**） |

附字段：`strength`（标签强度 weak\|strong·ccm 出、注入方直接用）、`nearest_reset`（`stop_*` 时该窗 reset 时刻·引导 arm wakeup）、`switch_candidate`（`switch` verdict 时推荐切入的备号·**切不切由编排层 + 用户拍**）、`pool`（号池粗粒度 { backups, switchable }）。**`stop_7d` 是最该认真对待的 verdict**——7d 是不可逆的跨窗口消耗边界，读到它就把决策 surface 回编排层，绝不当 FYI 自行越过。`stop_5h` 则是「本窗口这份配额烧穿了」——不是终点、是 arm 一个自我唤醒守到 reset 回血的信号。

## 心智锚 3：estimate 整轴别 out-of-mind

模型默认**想不到**去查估算——能力（`ccm estimate` 5 verb）就绪，消费层从不被召回。在三个拍子主动 consult estimate（操作化「何时查 → 读哪字段 → 判什么」详见 estimation.md）：

- **dispatch / 排期拍**：`ccm estimate forecast` 出目标 ETA（p50/p80/p95 双通道 MC）——读 p80 对照 deadline，超了就是 replan / surface 信号。
- **recon / 中途拍**：`ccm estimate evm` 出 CPI/SPI（进度/成本偏差）——SPI<1 落后于计划、CPI<1 超预算，据此判要不要调度。
- **replan / 风险拍**：`ccm estimate risk` 出综合风险指数；`ccm estimate cost-to-complete` 出剩余工作量。
- **诚实字段先读**：`coverage_pct` 低 / `source:"no-history"` / `confidence:"low"` / conformal 区间很宽 → **降低对该预测的信任权重**（别拿一个 cold-start 的点估当承诺）。

## 心智锚 4：family 选能力下限，effort 买边际深度

Codex 选档是二维的：先按任务开放性 / 可验证性在 **Luna → Terra → Sol** 里选 family，再用**最低能稳定达标**的 reasoning effort。官方 headline coding eval 中，Sol/Terra/Luna 的 SWE-Bench Pro 为 **64.6/63.4/62.7**，Terminal-Bench 2.1 为 **88.8/87.4/84.7**；API token 价比约 **5:2.5:1**。能力差小于价格差，所以别把所有临界节点无脑推到 Sol max。

- **配额充足（效果优先）**：机械叶用 Luna medium；常规实现用 Terra high/xhigh；复杂开放实现用 Sol high/xhigh；不可逆裁决 / 端点验收才用 Sol max。`ultra` 只给能拆成独立 workstreams 的任务——它是多 agent 拓扑，不是 max 之后的普通 effort。
- **配额紧张（性价比优先）**：机械叶用 Luna low/medium；清晰常规实现用 Luna high 或 Terra medium；复杂实现用 Terra high/xhigh；Sol high/max 只留给错误代价最高的裁决 / review。停用 `ultra`，先降可机械验收叶子的档位与 WIP。

主线会话在开跑前选定：通常 Sol medium；配额紧张且目标边界清楚时可从 Terra medium/high 起步。运行中别因短时水位频繁切主线——省配额主要靠 leaf 分档。完整证据、任务矩阵和边界见 `references/model-tiers.md`。

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

命令怎么敲、每个 flag、`--json` 形状看 `using-ccm` 的 command catalog。本 skill 只教消费这些输出。

## footgun 速查

| 现象 | 真相 / 怎么做 |
|---|---|
| `ccm usage advise` 出 `available:false` | Codex 当前账号信号不可得；保守派发，不要反推。 |
| 看到 `switch` | Codex adapter 不支持账号池切换；不要执行账号切换命令。 |
| 想精确把 used% 收敛到 100% | 做不到（结构性硬墙：账户口径无绝对 token 分母 + burn 与额度不在同一可信路径）。只做方向性走廊。详见 usage-signals.md 诚实天花板。 |
| `estimate evm` 报没有 baseline | EVM 死依赖 baseline 作 plan 基线——先 `ccm baseline snapshot`（见 estimation.md baseline 生命周期）。 |
| forecast 给了点估就当承诺 | 先读诚实字段（coverage_pct / confidence / conformal 区间）——cold-start / 低覆盖时点估不可信，降低信任权重。 |
| 把 `stop_5h` 当终点 | `stop_5h` 是「本窗口这份 5h 配额烧穿」——不是任务失败，是 arm 一个 watchdog 守到 `nearest_reset` 回血再续派的信号（换号无门时的兜底）。见 pacing-levers.md。 |
| 多板同池时只看自己的 `usage advise` | 漏掉 sibling 相对分配。读 `coordination arbitrate` 的 own row；`pacing_yield` / `pacing_claim` 的字段解释见 `references/pool-aware-advice.md`。 |

---

## Pointers

- **[references/model-tiers.md](references/model-tiers.md)** —— Codex GPT-5.6 Sol/Terra/Luna × effort mapping + 配额充足/紧张两套任务路由 + `max`/`ultra` 边界。**「该用哪档、怎么兼顾效果与性价比」翻它。**
- **[references/usage-signals.md](references/usage-signals.md)** —— Codex 当前账号 5h / 7d 信号源、`available:false` 降级、诚实边界。
- **[references/pacing-levers.md](references/pacing-levers.md)** —— 单侧 levers（减速 / 停）怎么做；Codex 下 `switch` 不执行账号池切换，降级为 throttle / 等待 / surface 用户。
- **[references/estimation.md](references/estimation.md)** —— estimate verb 的消费决策、baseline 生命周期、诚实字段、usage 与 estimate 的张力。
- **using-ccm** —— ccm 命令怎么敲、board 字段怎么写。
- **master-orchestrator-guide** —— 决策层；Codex adapter 只消费这里的 advisory 与本 host 的 GPT-5.6 mapping，不把其他 harness 的 account/statusline 机制投影过来。
- `references/pool-aware-advice.md` — 多块 active board 同池竞争时，怎么读 `coordination arbitrate` 的 own row / inbox 通知。
- 实时真相永远以 `ccm <namespace> <cmd> --help` 为准 + ccm 引擎是走廊数学 / 估算算法的实现 SSOT——本文是消费视图，不复述数学。
