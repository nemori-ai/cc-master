# 估算消费 —— 6 个 estimate verb + baseline 生命周期 + 诚实字段

> **何时读：** 要估目标 ETA、查进度/成本偏差（EVM）、看 velocity / 综合风险 / cost-to-complete、查**交付准时性**（板背交付 DDL 时相对 DDL 的 margin / risk band），或要读懂 `ccm estimate` 的输出字段、判一个预测信不信时。模型**默认想不到**去查估算——能力就绪却不被召回，agent「该 forecast 工期 / 查 EVM 偏差 / 读 risk flag」时想不起来。按「何时查 → 读哪个字段 → 形成什么决策输入」消费。**ccm 出区间/数据，`master-orchestrator-guide` 作编排决策**；直接读取当前字段，不要重算估算数学。

`ccm estimate` 是**只读 advisory**：全 verb compute、零写、不抢 board-lock。历史语料范围 `--scope home|this-repo|this-board`（默认 `home`·跨板多层收缩）。seeded 确定性 `--seed`（默认 42·MC 复现）。**5% 硬墙**：所有 `p95` = 95% 分位，**绝不算到 100%**（真上限是 session hard-stop）。

<!-- ccm:k:start point:pacing.estimate-verbs -->
## 6 个 verb 的消费映射（query → read → input）

| verb | 何时查 | 读哪个字段 | 形成的决策输入 |
|---|---|---|---|
| **`estimate forecast`** | dispatch / 排期拍——要目标 ETA | `forecast.{p50,p80,p95}`（ISO ETA·双通道 MC）+ `consistency.warning`（①②偏差>20%）+ `coverage_pct` | p80 与 deadline 的差值；`consistency.warning:true` 表示估值与吞吐通道分歧大、ETA 不稳。 |
| **`estimate evm`** | recon / 中途拍——查进度成本偏差 | `spi`/`spi_t`（Earned Schedule·进度）+ `cpi`（成本）+ `eac`/`vac`（完工预测/偏差）；前置 `has_baseline` | `spi_t<1` 落后于计划、`cpi<1` 超预算 → 输出调度决策所需的偏差幅度。`has_baseline:false` → 到 `using-ccm` 建立 baseline 前置。**用 `spi_t`（Earned Schedule）不用 `spi`**——后者末期失灵。 |
| **`estimate velocity`** | 规划拍——backlog 还要多久清空 | `velocity_tasks_per_day` + `eta_days.{p50,p80,p95}` + `sle.{p50,p85,p95}`（cycle-time 服务水平） | backlog 清空 ETA 是否撑得住目标期限；SLE 给「单任务多久算正常」的基线（喂 risk 的 WIP-aging）。 |
| **`estimate risk`** | replan / 风险拍——看综合风险 | `criticality_index`（CI/CRI/SSI·MC 高临界节点）+ `wip_aging[].status`（`at_risk`/`critical`）+ `ccpm.zone`（绿/黄/红缓冲区） | 高 CI 节点集合、超过 SLE_P95 的在飞任务集合与项目缓冲区状态。 |
| **`estimate cost-to-complete`** | pacing 拍——清空 backlog 还要烧多少配额 | `cost_to_complete_pct.{p50,p80,p95}`（剩余总**配额%**）+ `available` | p80 配额% 对照 selected target 的可证余量：装不下 → 这是 usage⊗estimate 张力（见下）。`available:false` → 账户 burn 不可得、`cost_to_complete_pct:null`、降级。`token_sizing` 是**辅助相对量计、非预算账本**——配额% 才是账本。 |
| **`estimate deadline-risk`** | 板背 `asserted`/`confirmed` 交付 DDL 时·pacing / 风险拍——查交付准时性 | `risk_band`（六态）+ `on_time_probability`（P(finish≤DDL)）+ `margin.{p50_h,p80_h,p95_h}`（DDL−forecast_pX·负=越过）+ 诚实字段（`coverage_pct`/`confidence`/`channel_disagreement`/`calibration_status`）+ `top_drivers` | 相对 DDL 的准时概率与分位裕度、先动哪个节点（详见下节）。`risk_band:"unknown"` / `on_time_probability:null` 绝不当绿。 |

（`estimate show [<id>]` 给每任务 raw vs `calibrated_h` + conformal `interval`——快速瞥单任务校准后工期。）

<!-- ccm:k:end point:pacing.estimate-verbs -->
<!-- ccm:k:start point:pacing.deadline-risk -->
## 交付 DDL 风险消费（estimate deadline-risk）

当板背一个 `asserted` / `confirmed` 交付 DDL（`goal_contract.deadline`）时，`estimate deadline-risk` 出**单一 verdict**：准时概率 + 相对 DDL 的分位 margin + 六态 risk band。它是 DDL-aware 的进度 verdict（`evm` 只看 baseline SPI/SV、对 DDL 无感）。按「读 verdict → 形成决策输入」消费，**绝不重算风险数学**：

- **`risk_band`**（`on_track|watch|at_risk|likely_late|overdue|unknown`）+ **`strength`**（`weak|strong`·引擎按 band emit：watch=weak，at_risk/likely_late/overdue=strong）：band 升高即交付风险升高。
- **`on_time_probability`** = P(finish ≤ DDL)，**只来自资源感知（RCPSP-in-trial）通道**；`null` = 算不出（unknown），不是 0。`margin.{p50_h,p80_h,p95_h}` = DDL − forecast_pX（小时·负=越过 DDL）；p80 margin 由正转负是「按 p80 口径将越期」的早信号。
- **诚实字段（命中即降低信任 / 触发 unknown·绝不假绿）**：`coverage_pct` 低、`confidence:"low"`、`channel_disagreement` 超阈值（乐观下界通道与资源通道分歧大）、`calibration_status:"uncalibrated-conservative"`（band 阈值是未经经验校准的保守起点）、无 DDL / 图含环 / RCPSP 不可用 → `risk_band:"unknown"` + `on_time_probability:null`。**「算不出」绝不映射成绿色。**
- **`top_drivers`** = 先动哪里（critical / sensitive / blocked）。

**surface 门槛是 actionability 不是 certainty**：band 越过风险阈值就是把它作决策输入 surface 的时机，别等 `overdue`。verdict 出自 ccm；何时 surface / replan / 缩范围的编排决策归 `master-orchestrator-guide`——读数在这里，拍板在那边。

<!-- ccm:k:end point:pacing.deadline-risk -->
<!-- ccm:k:start point:pacing.baseline-precondition -->
## baseline 事实（EVM 的 plan 前置）

EVM 只在此前已经建立 plan baseline 时可计算。baseline 是 board 内的写状态，不属于 `usage` / `estimate` 只读 advisory；创建、覆盖或 reset 都按 `using-ccm` 的 baseline namespace 操作。你在这里仅消费这些结果字段：

- `has_baseline:false`：当前没有可消费的 plan 基线，CPI / SPI 无从计算；先转到 `using-ccm` 完成写入前置。
- `baseline_captured_at` 与冻结的任务集 / 校准工期：判断该基线是否仍对应当前 iteration / 里程碑。
- 范围变化后旧 baseline 会失真；任务集仍是占位 / rolling-wave 远期片时，PV 曲线也会建立在持续变化的计划上，后续 `spi` / `cpi` 只能降低信任权重。
- 何时重开基线是编排决策；怎样写入或 reset 是 `using-ccm` 的操作机制。

<!-- ccm:k:end point:pacing.baseline-precondition -->
<!-- ccm:k:start point:pacing.honest-fields -->
## 诚实字段：什么时候降低对预测的信任权重

估算引擎对冷启动 / 数据不足是**诚实**的——它不假装精确。读预测**先读这几个诚实字段**，命中即**降低信任权重**（别拿一个 cold-start 点估当承诺）：

- **`coverage_pct` 低**（如 <50%）→ 估值通道覆盖不足、吞吐通道主导（#NoEstimates），ETA 更粗。
- **`source:"no-history"` / `"local-derived-approx"`**→ 没有可校准的历史语料（退原估值）/ 账户口径降级——方向性参考，非精确。
- **`confidence:"low"`**→ 引擎自评低置信。
- **conformal `interval` 很宽**（p95 与 p50 差距大）→ 不确定性大，区间比点估诚实。
- **`5% 硬墙`**：`p95` 永远是 95% 分位、不是最坏情况——别把 p95 当「绝对上限」。

**用区间不用点估**：报 ETA / cost 时带上 p50–p80–p95 区间（或至少 p80），而非一个假精确的单点数——这正是「量力而行」镜头「方向性走廊而非精确收尾」在估算侧的镜像。

<!-- ccm:k:end point:pacing.honest-fields -->
<!-- ccm:k:start point:pacing.usage-estimate-tension -->
## usage ⊗ estimate 张力（典型 `blocked_on:"user"` 输入）

配额侧 selected-target `ccm usage advise` 出 `throttle` 或硬停 verdict，但工作侧 `ccm estimate forecast` 的 p80 ETA 还很长 / `cost-to-complete` 的 p80 配额% 装不下该 target 当前可证余量——这是一个典型张力：**容量不够装完该装的活**。

- **识别输入**（消费层）：读两个字段对比——usage verdict（`throttle` / 硬停）✕ estimate `forecast.p80` 超期 或 `cost_to_complete_pct.p80` > 当前余量。
- **决策输入**：列出**范围 / 期限 / 用户已明确批准且 selected target 支持的容量**之间的张力；具体调度动作查 `master-orchestrator-guide`。
<!-- ccm:k:end point:pacing.usage-estimate-tension -->
