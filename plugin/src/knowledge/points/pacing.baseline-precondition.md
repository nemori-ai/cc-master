---
point: pacing.baseline-precondition
---

## 权威陈述

<!-- ccm:k:start point:pacing.baseline-precondition -->
## baseline 事实（EVM 的 plan 前置）

EVM 只在此前已经建立 plan baseline 时可计算。baseline 是 board 内的写状态，不属于 `usage` / `estimate` 只读 advisory；创建、覆盖或 reset 都按 baseline namespace 操作。你在这里仅消费这些结果字段：

- `has_baseline:false`：当前没有可消费的 plan 基线，CPI / SPI 无从计算；先完成写入前置。
- `baseline_captured_at` 与冻结的任务集 / 校准工期：判断该基线是否仍对应当前 iteration / 里程碑。
- 范围变化后旧 baseline 会失真；任务集仍是占位 / rolling-wave 远期片时，PV 曲线也会建立在持续变化的计划上，后续 `spi` / `cpi` 只能降低信任权重。
- 何时重开基线是编排决策；怎样写入或 reset 是操作机制。
<!-- ccm:k:end point:pacing.baseline-precondition -->

## 失效类型

`environment_fact`（主体：事实方法） —— 模型不知道 CPI/SPI 有 baseline 前置，可能在 has_baseline:false 时仍尝试引用或计算这些指标，或把已过期的基线当作可信数字使用。

主体是 EVM 的 baseline 前置字段语义（has_baseline、baseline_captured_at）与读写职责划分，属本工具具体事实。

## 失败形态

隐蔽违反：has_baseline 为 true、字段都能读到，但 baseline_captured_at 早于本轮 scope 大改，orchestrator 仍原样引用 CPI/SPI 汇报给用户，没有做任何降权说明。
