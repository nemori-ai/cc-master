# 估算消费 —— 5 个 estimate verb + baseline 生命周期 + 诚实字段

> **服务愿景：C4**（分解 / 管理 / 更新 / 规划）**· C5**（资源下最大化效率）。**何时读：** 要估目标 ETA、查进度/成本偏差（EVM）、看 velocity / 综合风险 / cost-to-complete，或要读懂 `ccm estimate` 的输出字段、判一个预测信不信时。**这是本 skill 相对旧 cost-and-pacing 的净增**——estimate 整轴此前在编排决策点**完全零提及**（前序报告 §3 根因 2），agent「该 forecast 工期 / 查 EVM 偏差 / 读 risk flag」时**默认想不到**。本文把消费操作化成「何时查 → 读哪个字段 → 据此判断什么」。**ccm 出区间/数据、你（A）决策**（红线 3）；估算 OR/ML 算法的实现 SSOT 在 `@ccm/engine` 的 `estimate/`，本文不复述数学。

`ccm estimate` 是**只读 advisory**：全 verb compute、零写、不抢 board-lock。历史语料范围 `--scope home|this-repo|this-board`（默认 `home`·跨板多层收缩）。seeded 确定性 `--seed`（默认 42·MC 复现）。**5% 硬墙**：所有 `p95` = 95% 分位，**绝不算到 100%**（真上限是 session hard-stop）。

## 5 个 verb 的消费决策（query → read → judge）

| verb | 何时查 | 读哪个字段 | 据此判断什么（动作归 A） |
|---|---|---|---|
| **`estimate forecast`** | dispatch / 排期拍——要目标 ETA | `forecast.{p50,p80,p95}`（ISO ETA·双通道 MC）+ `consistency.warning`（①②偏差>20%）+ `coverage_pct` | p80 对照 deadline：超了 → replan / surface 用户（范围-期限-资源三选一）。`consistency.warning:true` = 估值通道与吞吐通道分歧大、ETA 不稳，降信任。 |
| **`estimate evm`** | recon / 中途拍——查进度成本偏差 | `spi`/`spi_t`（Earned Schedule·进度）+ `cpi`（成本）+ `eac`/`vac`（完工预测/偏差）；前置 `has_baseline` | `spi_t<1` 落后于计划、`cpi<1` 超预算 → 调度判断（要不要加资源 / 砍范围）。`has_baseline:false` → 先 `ccm baseline snapshot`（见下）。**用 `spi_t`（Earned Schedule）不用 `spi`**——后者末期失灵。 |
| **`estimate velocity`** | 规划拍——backlog 还要多久清空 | `velocity_tasks_per_day` + `eta_days.{p50,p80,p95}` + `sle.{p50,p85,p95}`（cycle-time 服务水平） | backlog 清空 ETA 是否撑得住目标期限；SLE 给「单任务多久算正常」的基线（喂 risk 的 WIP-aging）。 |
| **`estimate risk`** | replan / 风险拍——看综合风险 | `criticality_index`（CI/CRI/SSI·MC 高临界节点）+ `wip_aging[].status`（`at_risk`/`critical`）+ `ccpm.zone`（绿/黄/红缓冲区） | 高 CI 节点 = 该集中强档 + 紧盯（喂镜头 2 资源决策）；`wip_aging` 里 `critical` = 在飞任务超 SLE_P95、该 recon/hedge；`ccpm.zone:"red"` = 项目缓冲耗尽、surface 风险。 |
| **`estimate cost-to-complete`** | pacing 拍——清空 backlog 还要烧多少配额 | `cost_to_complete_pct.{p50,p80,p95}`（剩余总**配额%**）+ `available` | p80 配额% 对照当前 5h/7d 余量：装不下 → 这是 usage⊗estimate 张力（见下）。`available:false` → 账户 burn 不可得、`cost_to_complete_pct:null`、降级。`token_sizing` 是**辅助相对量计、非预算账本**——配额% 才是账本。 |

（`estimate show [<id>]` 给每任务 raw vs `calibrated_h` + conformal `interval`——快速瞥单任务校准后工期。）

## baseline 生命周期（EVM 的 plan 前置）

`ccm baseline` 是 board 内**唯一的 estimate 写 noun**——`estimate evm` 死依赖它作 plan 基线（PV 曲线的来源）：

- **`ccm baseline snapshot`** —— 在一个 iteration / 里程碑**起点**冻结当前计划（任务集 + 校准工期）作 EVM 的 plan 基线。**没有它 `estimate evm` 出 `has_baseline:false`**（exit 0·降级 warn），CPI/SPI 无从算。
- **何时 snapshot**：一个 cadence iteration 开工那刻、或一次重大 replan 后（范围变了，旧 baseline 失真）。`ccm baseline reset` 清旧基线重立。
- **`ccm baseline show`** —— 看当前基线快照（捕获时刻 + 任务集）。
- 它是**写 noun**（改 board 状态），刻意置于 `usage`/`estimate` 只读 namespace 之外——所以它**不是** advisory consume，而是 advisory（EVM）的前置 setup。命令怎么敲见 `using-ccm` 的 command-catalog。

## 诚实字段：什么时候降低对预测的信任权重

估算引擎对冷启动 / 数据不足是**诚实**的——它不假装精确。读预测**先读这几个诚实字段**，命中即**降低信任权重**（别拿一个 cold-start 点估当承诺）：

- **`coverage_pct` 低**（如 <50%）→ 估值通道覆盖不足、吞吐通道主导（#NoEstimates），ETA 更粗。
- **`source:"no-history"` / `"local-derived-approx"`**→ 没有可校准的历史语料（退原估值）/ 账户口径降级——方向性参考，非精确。
- **`confidence:"low"`**→ 引擎自评低置信。
- **conformal `interval` 很宽**（p95 与 p50 差距大）→ 不确定性大，区间比点估诚实。
- **`5% 硬墙`**：`p95` 永远是 95% 分位、不是最坏情况——别把 p95 当「绝对上限」。

**用区间不用点估**：报 ETA / cost 时带上 p50–p80–p95 区间（或至少 p80），而非一个假精确的单点数——这正是镜头 5「方向性走廊而非精确收尾」在估算侧的镜像。

## usage ⊗ estimate 张力（典型 `blocked_on:"user"` 输入）

配额侧 `ccm usage advise` 出 `throttle`/`hard_stop`，但工作侧 `ccm estimate forecast` 的 p80 ETA 还很长 / `cost-to-complete` 的 p80 配额% 装不下当前余量——这是一个典型张力：**容量不够装完该装的活**。

- **识别它**（归本 skill·消费层）：读两个字段对比——usage verdict（`throttle`/`hard_stop`）✕ estimate `forecast.p80` 超期 或 `cost_to_complete_pct.p80` > 当前余量。
- **怎么办**（归 A 镜头 7·决策）：这是一个典型的 `blocked_on:"user"` 决策——**范围（砍 scope）/ 期限（延 deadline）/ 加资源（换号补配额）三选一** surface 给用户。本文只教「怎么识别这个张力（读哪两个字段）」；surface 动作 + decision_package 采访包归 `orchestrating-to-completion`。
