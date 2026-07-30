---
point: pacing.estimate-verbs
---

## 权威陈述

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
