---
name: pacing-and-estimation
description: 'Use when 你（orchestrator/agent）在一场 long-horizon 跑里要消费 ccm 的只读 advisory 把它配速或估算——把长跑对照 5h/7d 配额窗口 pace、纠结升档还是降档模型、估目标 ETA / 查进度偏差(EVM) / 看综合风险 / 算 cost-to-complete、或要读懂 `ccm usage advise` `ccm estimate forecast` 的 verdict 与字段时。它给的是**消费机制知识**:单侧走廊 verdict(hold/throttle/switch/stop_5h/stop_7d)怎么读、四档模型(Fable/Opus/Sonnet/Haiku)相对成本、5h/7d 配额信号源链(账户权威 sidecar > 降级)、估算诚实字段(coverage_pct/confidence/conformal 区间)什么时候该降低对预测的信任。Triggers: 读 ccm usage/estimate/baseline 的输出、"该不该降档 / 该不该换号 / 这个 forecast 信不信 / EVM 偏差怎么看 / 选哪个模型档"、配额逼顶要判换号的读-usage 那一半、pacing/估算 hook 注入提示。Do NOT use when 你要的是**决策**——该不该减速/换号/停派/replan、7d 总闸要不要 surface 用户、换号谁拍板(那是 master-orchestrator-guide);或 ccm 命令**怎么敲**、account 录号换号操作、board 字段填什么(那是 using-ccm);或 workflow 脚本怎么写(authoring-workflows)。ccm 出 verdict、决策归 master-orchestrator-guide——本 skill 只教消费层,不替编排做判断。'
---

# pacing-and-estimation — 消费 ccm 只读 advisory 配速 + 估算

> **分发 skill（随插件 ship）。** `ccm` 的 `usage` / `estimate` / `baseline` 是 cc-master 的**只读 advisory**——出 verdict / 数据，**不替 orchestrator 决策**。本 skill 是它们的**消费手册**：不是「该不该减速/换号/停派」（那是 `master-orchestrator-guide` 的编排决策），而是「既然要 pace / 要估算，怎么读这些 advisory 的 verdict 与字段、怎么喂回你的判断」。
>
> **职责边界**：**消费机制**归本 skill；**决策**归 `master-orchestrator-guide`（「量力而行」/「目标即依赖图」/「该问就问」三镜头 + 决策程序 + `references/cost-decisions.md` 的换号决策锚）；**命令怎么敲 / account 操作**归 `using-ccm`；**走廊数学 / 估算算法的实现 SSOT** 在 ccm 引擎（本 skill 不复述数学）。

---

## 何时翻开本 skill

你在一场长跑里要**消费 ccm 的只读 advisory** 做配速或估算判断的输入时——把长跑对照配额窗口 pace、选模型档、估工期/风险、读 `ccm usage advise` / `ccm estimate forecast` 的输出——就用本 skill 把 verdict 与字段读对。深度按轴分进 reference，按问题选读：

- **[references/model-tiers.md](references/model-tiers.md)** —— 四档模型相对成本 + 按难度选档的事实映射 + 为何主线固定一个模型（prompt-cache）。**「该用哪档、为什么不切主线模型」翻它。**
- **[references/usage-signals.md](references/usage-signals.md)** —— 5h/7d 配额窗口、`ccm usage advise/show` 信号源链、sidecar 由 ccm 自带的 `ccm statusline`（自动安装·无需手接）落、诚实天花板。**「配额信号从哪来、`available:false` 怎么办」翻它。**
- **[references/pacing-levers.md](references/pacing-levers.md)** —— 单侧 levers（减速 / 换号 / 停）怎么做、目标走廊上界、effective-N（多账号）缩放节奏的消费。**「verdict 出来了、具体怎么 pace」翻它。**
- **[references/estimation.md](references/estimation.md)** —— 5 个 estimate verb 的消费决策（何时查 → 读哪个字段 → 据此判断什么）+ baseline 生命周期 + 诚实字段 + usage⊗estimate 张力。**「估工期/风险/EVM 怎么读、forecast 信不信」翻它。**

---

## 心智锚 1：ccm 出 verdict，你（orchestrator）决策 ★这条定边界

`ccm usage` / `estimate` 是**只读 advisory**——它替你**算**（走廊数学、MC 工期仿真、EVM、风险指数），吐一个 `verdict` 或一组带诚实字段的数。它**不替你拍**「该不该减速 / 该不该 surface 用户 / 该不该换号」。本 skill 教你**读 verdict + 解读字段**；读完之后的**动作**永远回到 `master-orchestrator-guide`（「量力而行」镜头、「该问就问」镜头、决策程序的 7d 总闸）。

- **别自己重算引擎已经算好的东西**（DRY）：`ccm usage advise` 已把账户 `used_percentage` + `resets_at` + effective-N 喂进引擎走廊数学，你**读它的 `verdict` 字段**即可，不必自己拿百分比重算走廊上下沿。
- **诚实降级是 advisory 的一等公民**：账户信号不可得 → `available:false`（exit 0，不是 exit 1）。这不是错误、是「pacing 此刻不可判」——别据空信号瞎催。

## 心智锚 2：pacing verdict 是单侧的，直接对应一个 lever 类

`ccm usage advise --json` 出**单侧走廊 verdict（5 值 enum·没有旧模型里的 `accelerate` 欠用侧加速与 `hard_stop`）**——只在逼近走廊上界时出声（临界减速 / 换号 / 停），走廊内静默：

| verdict | 含义 | 对应 lever 类（怎么做见 pacing-levers.md） |
|---|---|---|
| `hold` | 在走廊内，维持 | ——（静默） |
| `throttle` | 5h 临界减速 | 降档模型 / 降 WIP / 推迟 high-float |
| `switch` | 5h 临界 + n>1 + 7d 有余量 → 切到下一份配额 | 换号（usage-pacing hook 机械换号·你只调配速；决策锚归 `master-orchestrator-guide`） |
| `stop_5h` | 5h 本窗口烧穿·无可切备号 / 7d 亦吃紧 | arm watchdog 守到 `nearest_reset` 回血再续派（**动作归 `master-orchestrator-guide`**） |
| `stop_7d` | **7d≥85% 跨窗口硬总闸** | 停派新节点、surface 用户拍板（**动作归 `master-orchestrator-guide`「量力而行」/「该问就问」镜头 + 决策程序**） |

附字段：`strength`（标签强度 weak\|strong·ccm 出、注入方直接用）、`nearest_reset`（`stop_*` 时该窗 reset 时刻·引导 arm wakeup）、`switch_candidate`（`switch` verdict 时推荐切入的备号·**切不切由编排层 + 用户拍**）、`pool`（号池粗粒度 { backups, switchable }）。**`stop_7d` 是最该认真对待的 verdict**——7d 是不可逆的跨窗口消耗边界，读到它就把决策 surface 回编排层，绝不当 FYI 自行越过。`stop_5h` 则是「本窗口这份配额烧穿了」——不是终点、是 arm 一个自我唤醒守到 reset 回血的信号。

## 心智锚 3：estimate 整轴别 out-of-mind ★这条是本 skill 的核心增量

模型默认**想不到**去查估算——能力（`ccm estimate` 5 verb）就绪，消费层从不被召回。在三个拍子主动 consult estimate（操作化「何时查 → 读哪字段 → 判什么」详见 estimation.md）：

- **dispatch / 排期拍**：`ccm estimate forecast` 出目标 ETA（p50/p80/p95 双通道 MC）——读 p80 对照 deadline，超了就是 replan / surface 信号。
- **recon / 中途拍**：`ccm estimate evm` 出 CPI/SPI（进度/成本偏差）——SPI<1 落后于计划、CPI<1 超预算，据此判要不要调度。
- **replan / 风险拍**：`ccm estimate risk` 出综合风险指数；`ccm estimate cost-to-complete` 出剩余工作量。
- **诚实字段先读**：`coverage_pct` 低 / `source:"no-history"` / `confidence:"low"` / conformal 区间很宽 → **降低对该预测的信任权重**（别拿一个 cold-start 的点估当承诺）。

## 心智锚 4：模型档位是资源，按难度选、主线不切

四档相对 output 成本（稳定心智，绝对价格会 stale·详表 + Fable 可用性见 model-tiers.md）：**Haiku 1× / Sonnet 3× / Opus 5× / Fable 10×**。按任务**难度**选档（机械活=Haiku、常规实现=Sonnet、难实现/临界=Opus、裁决/独立 review=Fable）——这是**事实映射**；「把强档集中到临界链上」的**判断**归 `master-orchestrator-guide`「目标即依赖图」镜头。**主线固定一个模型**（中途切作废 prompt-cache，尤其 cc-master 每次 compaction 会重注整篇常驻编排手册）——省钱靠给 leaf 配便宜档，不靠切主线 `/model`。

## usage ⊗ estimate 张力（典型决策输入）

配额 `throttle`/`stop_7d` 但 `forecast` 还很长 → 这是一个典型张力：容量不够装完该装的活。**识别它**（读 usage verdict 与 estimate forecast 两个字段对比）归本 skill；**怎么办**（典型 `blocked_on:"user"`：范围/期限/加资源三选一 surface 给用户）归 `master-orchestrator-guide`「该问就问」镜头。

---

## 热路径速查

```bash
ccm usage advise --json        # 单侧走廊 verdict（hold/throttle/switch/stop_5h/stop_7d）+ strength/nearest_reset/switch_candidate/pool
ccm usage show --json           # 当前号 + 备号 5h/7d used% / resets_at / effective_n（状态，非 verdict）
ccm usage task-cost <id> --json # 单任务 token 成本
ccm estimate forecast --json    # 目标 ETA：p50/p80/p95 双通道 MC
ccm estimate evm --json         # CPI/SPI 进度成本偏差（需 baseline 作前置）
ccm estimate risk --json        # 综合风险指数
ccm estimate cost-to-complete --json
ccm baseline snapshot           # iteration 起点基线（EVM 的 plan SSOT·写 noun）
```

命令怎么敲、每个 flag、`--json` 形状 → `using-ccm` 的 command-catalog（`${CLAUDE_PLUGIN_ROOT}/skills/using-ccm/references/command-catalog.md`·命令面）。本 skill 只教**消费**这些 verb 的输出。

## footgun 速查

| 现象 | 真相 / 怎么做 |
|---|---|
| `ccm usage advise` 出 `available:false` | 账户信号不可得（headless / 已 opt-out `ccm statusline` / API-key / 云后端）——pacing 不可判，别据空信号硬判 pacing（hook 此时也静默）。sidecar 来源见 usage-signals.md（ccm 自带 `ccm statusline` 自动落）。 |
| 想精确把 used% 收敛到 100% | 做不到（结构性硬墙：账户口径无绝对 token 分母 + burn 与额度不在同一可信路径）。只做方向性走廊。详见 usage-signals.md 诚实天花板。 |
| `estimate evm` 报没有 baseline | EVM 死依赖 baseline 作 plan 基线——先 `ccm baseline snapshot`（见 estimation.md baseline 生命周期）。 |
| forecast 给了点估就当承诺 | 先读诚实字段（coverage_pct / confidence / conformal 区间）——cold-start / 低覆盖时点估不可信，降低信任权重。 |
| 把 `stop_5h` 当终点 | `stop_5h` 是「本窗口这份 5h 配额烧穿」——不是任务失败，是 arm 一个 watchdog 守到 `nearest_reset` 回血再续派的信号（换号无门时的兜底）。见 pacing-levers.md。 |

---

## Pointers

- [references/model-tiers.md](references/model-tiers.md) —— 四档相对成本 + 按难度选档事实映射 + 为何主线固定一个模型。
- [references/usage-signals.md](references/usage-signals.md) —— 5h/7d 窗口 + `ccm usage` 信号源链 + sidecar 接法 + 诚实天花板。
- [references/pacing-levers.md](references/pacing-levers.md) —— 单侧 levers（减速 / 换号 / 停）怎么做 + 目标走廊上界 + effective-N 缩放节奏。
- [references/estimation.md](references/estimation.md) —— 5 estimate verb 消费 + baseline 生命周期 + 诚实字段 + usage⊗estimate 张力。
- **master-orchestrator-guide**（决策层）—— 该不该减速/换号/停派/surface 是它的活；换号 lever 阶梯 / policy 授权 / 绝不自授权红线在它的 `${CLAUDE_PLUGIN_ROOT}/skills/master-orchestrator-guide/references/cost-decisions.md`。本 skill 是它的「decision 之前怎么读 advisory」。
- **using-ccm**（命令面）—— ccm 命令怎么敲、account 录号换号操作、board 字段填什么。
- 实时真相永远以 `ccm <namespace> <cmd> --help` 为准 + ccm 引擎是走廊数学 / 估算算法的实现 SSOT——本文是消费视图，不复述数学。
