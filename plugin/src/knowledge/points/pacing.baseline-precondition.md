---
point: pacing.baseline-precondition
---

## 权威陈述

<!-- ccm:k:start point:pacing.baseline-precondition -->
## baseline 事实（EVM 的 plan 前置）

EVM 只在此前已经建立 plan baseline 时可计算。baseline 是 board 内的写状态，不属于 `usage` / `estimate` 只读 advisory；创建、覆盖或 reset 都按 `using-ccm` 的 baseline namespace 操作。你在这里仅消费这些结果字段：

- `has_baseline:false`：当前没有可消费的 plan 基线，CPI / SPI 无从计算；先转到 `using-ccm` 完成写入前置。
- `baseline_captured_at` 与冻结的任务集 / 校准工期：判断该基线是否仍对应当前 iteration / 里程碑。
- 范围变化后旧 baseline 会失真；任务集仍是占位 / rolling-wave 远期片时，PV 曲线也会建立在持续变化的计划上，后续 `spi` / `cpi` 只能降低信任权重。
- 何时重开基线是编排决策；怎样写入或 reset 是 `using-ccm` 的操作机制。

<!-- ccm:k:end point:pacing.baseline-precondition -->
