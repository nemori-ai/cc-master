---
point: pacing.deadline-risk
---

## 权威陈述

<!-- ccm:k:start point:pacing.deadline-risk -->
## 交付 DDL 风险消费（estimate deadline-risk）

当板背一个 `asserted` / `confirmed` 交付 DDL（`goal_contract.deadline`）时，`estimate deadline-risk` 出**单一 verdict**：准时概率 + 相对 DDL 的分位 margin + 六态 risk band。它是 DDL-aware 的进度 verdict（`evm` 只看 baseline SPI/SV、对 DDL 无感）。按「读 verdict → 形成决策输入」消费，**绝不重算风险数学**：

- **`risk_band`**（`on_track|watch|at_risk|likely_late|overdue|unknown`）+ **`strength`**（`weak|strong`·引擎按 band emit：watch=weak，at_risk/likely_late/overdue=strong）：band 升高即交付风险升高。
- **`on_time_probability`** = P(finish ≤ DDL)，**只来自资源感知（RCPSP-in-trial）通道**；`null` = 算不出（unknown），不是 0。`margin.{p50_h,p80_h,p95_h}` = DDL − forecast_pX（小时·负=越过 DDL）；p80 margin 由正转负是「按 p80 口径将越期」的早信号。
- **诚实字段（命中即降低信任 / 触发 unknown·绝不假绿）**：`coverage_pct` 低、`confidence:"low"`、`channel_disagreement` 超阈值（乐观下界通道与资源通道分歧大）、`calibration_status:"uncalibrated-conservative"`（band 阈值是未经经验校准的保守起点）、无 DDL / 图含环 / RCPSP 不可用 → `risk_band:"unknown"` + `on_time_probability:null`。**「算不出」绝不映射成绿色。**
- **`top_drivers`** = 先动哪里（critical / sensitive / blocked）。

**surface 门槛是 actionability 不是 certainty**：band 越过风险阈值就是把它作决策输入 surface 的时机，别等 `overdue`。verdict 出自 ccm；何时 surface / replan / 缩范围的编排决策归 `master-orchestrator-guide`——读数在这里，拍板在那边。

<!-- ccm:k:end point:pacing.deadline-risk -->
