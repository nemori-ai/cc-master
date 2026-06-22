# 机制契约：`scripts/eval-benchmark.sh`（dev-only）

> 类别：dev-only 带外脚本（NOT a hook·**不随 plugin 分发**·仅 repo 根调用·红线 5）。源码：`scripts/eval-benchmark.sh`。跑 skill-creator Track B（编排纪律 benchmark）**聚合**步的薄包装——只是 Track B 的最后一机械步。

## 触发输入
- 开发者敲 `scripts/eval-benchmark.sh <iteration-dir> <skill-name>`。
- 依赖：`uv` + Python 3.12（系统 3.9 跑不了 skill-creator 的 PEP-604）。本聚合步不需 `claude`/`codex`（那些花在上游 run + grading + codex-pairing 步）。
- 读：`<iteration-dir>` 下 `eval-N/{with_skill,without_skill}/run-*/grading.json`。env `CC_MASTER_SKILL_CREATOR` 覆写。

## 业务流
1. 解析 iteration-dir + skill 名，从脚本位置派生 `$REPO`。
2. `cd` 进 skill-creator 目录，跑 `scripts.aggregate_benchmark`——读各 run 的 grading.json，出 benchmark.json + benchmark.md（pass_rate / time / tokens 的 mean ± stddev + with_skill−without_skill delta）。

## 输出副作用
- 写 benchmark.json + benchmark.md（在 iteration 工作区）。

## 关键不变式
- **dev-only**——不随 plugin 分发，仅 repo 根调用（红线 5）。绝不进 hooks/。
- 只是 Track B 的**最后一机械步**——完整半手动 loop（spawn with/without_skill runs、grade transcript、聚合、codex 第二评委配对）在 `design_docs/eval/track-b-benchmark.md`。
- 自身只解析路径 + shell out，不拥有 eval 逻辑（skill-creator 拥有）。

## 失败模式
- 缺参数 → usage error + exit 1。
- uv / skill-creator 缺 → 报错退出。
