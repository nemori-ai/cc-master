**pacing 是单侧的（只在逼近上界时出声）。** 没有「欠用侧加速」；走廊内一律 `hold`（静默）。

## 7d 硬边界与 rolling-24h advisory

7d 是 Codex 唯一的百分比硬边界：`used%` 逼近当前 policy 的上界时产生 7d hard-gate 事实。rolling-24h 只把 7d 快照的近期 burn 与 `100 / 7` 日预算比较，产生 `throttle-risk` advisory；它不能改变 hard eligibility、fallback、reset 或 wakeup。

任何历史或意外 `five_hour` / 5h 输入只保留为 **ignored provenance**，不得触发 throttle、switch、stop_5h、reset 或 wakeup，也不得污染一份 fresh、complete、ample 的 7d 事实。若旧输出仍把 5h 当 pacing 维度，视为 stale schema，不把它交给决策层。

## Codex 下没有换号 lever

Codex 自动换号永久禁止，`switch` / `switch_candidate` 不是 Codex pacing 合同的有效 lever。模型 / reasoning effort、WIP 与 high-float 是独立的 burn 影响向量；7d hard gate 不能靠账号池绕过。具体取舍与编排动作由 `master-orchestrator-guide` 决定。

## burn 影响向量

1. **模型 / effort** —— 从 model-tiers.md 读取相对 token 成本与能力边界；降档可能降低 burn，也可能提高返工风险。Fast mode 更快消耗 credits，**不是**省配额档。
2. **WIP** —— 并发叶子越多，同一 7d 容量内的 burn 通常越高。
3. **high-float** —— 非临界、token 重的工作可延后，不把 rolling-24h advisory 伪装成硬停指令。

## 决策输入边界

- **7d hard gate**：继续消耗已进入用户拥有的决定边界；具体取舍、编排动作与抗合理化归 `master-orchestrator-guide`。
- **rolling-24h advisory**：只报告 velocity、coverage、confidence 与来源，不单独产生硬停、reset 或 wakeup。
- 若决策层选择建立 watchdog，必须先创建真实 wakeup 并取得 handle，再用 `ccm watchdog arm ... --job-id <handle> --checklist <事项>` 写 canonical `watchdog.checklist`；没有真实 handle 就不能 arm。该事实不赋予 5h 或 rolling-24h 任何调度 authority。
