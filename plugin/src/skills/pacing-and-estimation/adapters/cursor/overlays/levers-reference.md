Cursor pacing 只在账期逼近上界时给出收紧信号；走廊内保持 `hold`。下列项目是交给 `master-orchestrator-guide` 取舍的候选 lever，不是 pacing 自己执行的动作。

## 减速候选

1. **模型候选** —— model-tiers.md 只对 `cursor-agent-cli` headless worker 给出已准入 first-party 候选；`cursor-ide-plugin` 没有 IDE-local 证据时保持 unknown。
2. **WIP** —— 同时消耗账期容量的叶子数。
3. **high-float** —— 可推迟到 `nearest_reset` 之后的非临界、token 重叶子。

## 硬停决策输入

`stop_billing_period` 表示当前账期容量已烧穿。`verdict`、`nearest_reset`、在飞状态、真实 background / wakeup handle 与“不可自动唤醒”标记都是中立输入。若决策层选择建立 watchdog，必须先创建 background Shell 或外部 scheduler 并取得真实 handle，再用 `ccm watchdog arm ... --job-id <handle> --checklist <事项>` 写 canonical `watchdog.checklist`；没有真实 handle 就不能 arm。是否停派、怎样收敛、是否建立 watchdog 或请求用户拍板，归 `master-orchestrator-guide` 决定。自动换号永久禁止。
