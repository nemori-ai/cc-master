---
"@ccm/engine": minor
"ccm": minor
---

新增 `ccm estimate deadline-risk --json` 只读 endpoint（交付 DDL 风险 verdict·issue #149·契约 §4.3）：三通道 Monte Carlo 出**准时概率** `on_time_probability` + 分位 margin + 六态 `risk_band`（on_track/watch/at_risk/likely_late/overdue/unknown）+ `top_drivers` + 诚实字段（coverage/confidence/channel_disagreement/calibration_status/notes）。**通道诚实性**：`on_time_probability` **只来自 RCPSP-in-trial 通道**（真调度当前 DAG + 吃 `scheduling.wip_limit` 资源竞争）——`on_time_probability_source` 恒为 `rcpsp-in-trial` 或 `unknown`；precedence-only 只作显式标注的乐观下界（喂 forecast/margin + 双通道分歧信号）；throughput 降为 `channels.throughput_reference`（`kind:"heuristic-reference"`）**绝不映射 verdict**。**诚实降级**（绝不假绿）：无 DDL / 图含环 / 无有效预测 / coverage·history 太弱 / 双通道严重分歧（>0.25）/ RCPSP 不可用 → `risk_band:"unknown"` + `on_time_probability:null`（**绝不退 throughput 冒充 resource-aware**）；`now≥DDL` 且未完成 → `overdue`。band 阈值为 **explicitly uncalibrated 保守起点**（`calibration_status:"uncalibrated-conservative"`·待 labeled 语料校准）。

引擎（`@ccm/engine`）新增：`empiricalCdfAtOrBefore(sortedSamples, target)`（经验 CDF·on-time 概率载重·二分 O(log n)）+ `rcpspInTrialMc(board, params, opts)`（资源约束 MC·**堆化 serial SGS**·indeg-ready min-heap + slot min-heap·O(V log V)/trial·注入 wip 资源约束·复用现成 CPM 的 min-slack/LFT 优先规则）+ `computeDeadlineRisk(board, opts)`（§4.3 verdict SSOT）；`estimateDagMonteCarlo`/`throughputMonteCarlo` 现暴露升序样本（`makespanSamplesSorted`/`daysSamplesSorted`·零算法重写）。CLI 侧 `estimate deadline-risk` 复用引擎 `buildMcParams` + `readDeadline`（D2）；latency 降档阶梯（trials 2000→1000→500→unknown）按 DAG 规模埋好（防极端大图·别真限时）。纯只读零写（runRead），hook 只搬运不重算（红线3）。
