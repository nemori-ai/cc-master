# Phase 2 Track A — cross-harness origin integration

日期：2026-07-10 UTC。

## Corpus

- train：`trigger-train.json`，5 should-trigger + 5 substantive near-miss，各 3 runs。
- sealed holdout：`trigger-holdout.json`，2 + 2，各 3 runs。
- runner：skill-creator `scripts.run_eval`，`--skill-path .claude/skills/harness-plugin-architecture`。

## Pre（description 编辑前）

Description：

```text
Use when 设计、审查或重构 cc-master / 类似项目的多 agent harness plugin adapter：新增或修复 host adapter、建立 N-host capability parity、判断 Track A / Track B、为跨 hooks/commands/skills/ccm 的能力建立 Capability INTENT / hook CONTRACT，或处理 Cursor IDE plugin 的非 1:1 语义。覆盖 source-to-adapter、SAP/PHIP、host-native manifest / path / hook / command 边界。Do NOT use when 只实现投影脚本（adapter-projection-engineering）、只做打包发布（plugin-release-engineering）、只改一个 skill body（cc-master-skillsmith），或只设计不改 plugin adapter 的 cross-harness headless CLI worker transport；后者属于 Phase 2 / 对应 transport 设计。
```

### Train

- aggregate：`5/10 passed`。
- 5 个 near-miss 均 `0/3` 触发，全部正确。
- 5 个 should-trigger：四条 `0/3`；“非等价 stop / compaction”一条 `1/3`。
- positive recall：`1/15`；negative specificity：`15/15`。

### Holdout

- aggregate：`2/4 passed`。
- 2 个 near-miss 均 `0/3`，全部正确。
- 2 个 should-trigger 均 `0/3`。
- positive recall：`0/6`；negative specificity：`6/6`。

判决：与 Phase 1 已记录 floor 一致，positive-recall 通道近乎全零；pre 数字不携带“当前 description 很差”的可归因信号。仍保留作 pre/post 机械记录，按 `grounding-skill-evals` 降级为 description diff review + predict-then-validate，不对死指标调词。

## 改前预测（写死，不事后改）

本轮只把 headless OUT 的模糊“Phase 2 / 对应 transport 设计”替换为明确邻居 `cross-harness-runtime-engineering`，并保留 plugin/origin IN、headless runtime OUT。预测：

1. `cross-harness worker dispatcher，不改 plugin adapter` 的 train near-miss 仍 `0/3`，不误触发 HPA。
2. projection-only / release-only / skill-body-only / README-only / ccm usage parser-only 仍不触发。
3. 因没有针对 train/holdout 正例调 description，正例的 floor 不应被宣称改善；预期 aggregate 仍约为 train `5/10`、holdout `2/4`，随机的单次正例触发不算 uplift。
4. 定性边界应比 pre 更可执行：headless runtime query 明确移交 `cross-harness-runtime-engineering`，而涉及 origin hooks/commands/skills/Capability INTENT/native handle landing 的 query 留在 HPA。

## Post

Description 仅把 headless OUT 的归属改为明确邻居 `cross-harness-runtime-engineering`，其余路由语义不变。

### Train

- aggregate：`5/10 passed`，与 pre 相同。
- 5 个 near-miss 均 `0/3` 触发，包括「设计 cross-harness worker dispatcher 且不改 plugin adapter」，全部正确。
- 5 个 should-trigger：两条各 `1/3`，其余三条 `0/3`。
- positive recall：`2/15`；negative specificity：`15/15`。

### Holdout

- aggregate：`2/4 passed`，与 pre 相同。
- 2 个 near-miss 均 `0/3`，全部正确。
- 2 个 should-trigger 均 `0/3`。
- positive recall：`0/6`；negative specificity：`6/6`。

### 判决

预测成立：边界反例没有回归，而 aggregate 仍处于已记录的 positive-recall floor。Train 正例从
`1/15` 到 `2/15` 是低样本随机波动，不声称 uplift。本轮只接受可人审的定性改进：
description 现在能把「origin plugin adapter 集成」与「same-harness / other-harness headless CLI runtime」明确分流。

## Runtime owner 撤回后的路由更正（改前预测）

Independent review 后，`cross-harness-runtime-engineering` 因没有可判定的 failing behavioral floor 撤回为
reference-wrap。本轮只把 HPA 的 headless OUT 从该悬空 skill 改指 tracked
`design_docs/cross-harness-orchestration-capability-model.md` 这个架构 / contract / 持续 SSOT，实现按普通
engineering / dev-loop skills 执行。预测：

1. `cross-harness worker dispatcher，不改 plugin adapter` near-miss 仍为 `0/3`。
2. 其余 near-miss 不回归；正例不针对调词。
3. 因 Track A 通道仍处 floor，aggregate 预期约为 train `5/10`、holdout `2/4`；不声称 recall uplift。
4. 定性改进只是 owner 可到达：HPA 仍拒绝 headless runtime，但不再指向已撤回的 skill。

### Runtime owner 路由更正 Post

- train：`5/10`；5 个 near-miss 全部 `0/3`，dispatcher-only 仍 `0/3`；positive recall `1/15`。
- holdout：`2/4`；2 个 near-miss 全部 `0/3`；positive recall `0/6`。
- 与预测一致：aggregate 和边界 specificity 不变，通道仍处 floor，不声称 uplift。
- 定性路由已从撤回的 skill 改为 tracked capability model SSOT + 普通 engineering / dev loop。
