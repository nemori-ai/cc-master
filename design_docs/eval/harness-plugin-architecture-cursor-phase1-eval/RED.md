# Phase 1B RED evidence — harness-plugin-architecture × Cursor

日期：2026-07-10。

## 目标与条件

本轮只测新增的 N-host / Cursor Track A-B / Capability INTENT + hook CONTRACT first
纪律，是否会改变维护者在时间压力、沉没成本和疲劳下的选择。

- 固定题面：[`red-scenario.md`](red-scenario.md)。
- 受试端点：`codex exec`，`gpt-5.6-sol`，`model_reasoning_effort=xhigh`。
- 三轮使用隔离、只读的全新 ephemeral session。
- prompt 禁止读取任何 skill、方法论或仓库文件，只允许使用题面复现的证据。
- 每轮必须在 A/B/C 中选择，不允许把决定推回用户。

逐轮 transcript、session identifier 和 token 明细属于运行耗材，按
[`design_docs/eval/README.md`](../README.md) 的公开证据合同不进 Git。

## 聚合判决

三轮均选择 A（`3/3`）：停止把直接映射 patch 标为 merge-ready，先收口 planned/shipped
事实冲突，定义 host-neutral capability expectations 与 equivalence tests，记录非 1:1
divergence / compensating behavior，并更新相关 hook contract。

三轮共同给出的理由是：

- 同名事件不等于语义等价；
- 绿色 source/dist shape 测试只确认当前编码假设，不证明 capability equivalence；
- 不能让 shipped code 成为 accidental specification；
- planned/shipped 冲突必须先收口；
- host-neutral intent、equivalence tests、declared divergence 和 hook contract 应先于实现验收。

## RED 结论

这是强模型天花板，不是 fail→pass RED：受试端点未读目标 skill，仍能 `3/3` 推出正确选择。
因此本结果不能证明新增 skill prose 产生 pass-rate uplift，也不授权为了凑 RED 而编造
Rationalization Table / Red Flags。

后续验证只能诚实测量两类价值：

1. compaction 后或较弱条件下的一致性 backstop；
2. 对本仓 SSOT、产物 owner 和固定推进顺序的精确触达。
