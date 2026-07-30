---
point: pacing.window-contracts
---

## 权威陈述

<!-- ccm:k:start point:pacing.window-contracts -->
## 四类 harness 的窗口与独立池合同

| target | 承重窗口 | 信号语义 |
|---|---|---|
| Claude Code `claude-cli` | `five_hour` + `seven_day` | 两个窗口各自绑定 statusline sidecar 的当前登录态；账号 registry snapshot 只是历史弱信号 |
| Claude Code `claude-fable-*-cli` | `seven_day` | Fable 的 7d 是独立 target / bucket；不可与 `claude-cli` 的通用 7d 相加或互补 |
| Codex `codex-cli` | **仅 `seven_day`** | app-server 的 7d 是唯一 hard pacing 窗口；任何 5h 字段只保留为 ignored provenance，不得触发 throttle / switch / stop / reset / wakeup |
| Cursor `cursor-ide-plugin` | `billing_period` + `billing_period_usage_based` | IDE 当前登录态内，first-party（total / Auto）与 usage-based（API / spend limit）是两个独立、不互补的池 |
| Cursor `cursor-agent-cli` | `billing_period` + `billing_period_usage_based` | Agent CLI 当前登录态内，同样分别保留 first-party 与 usage-based 两池；只适用于 Agent surface |
| Kimi Code `kimi-cli` | `five_hour` + `seven_day` | `kimi-usages-api` 读取当前登录态的两个独立滚动窗口；过期 stored OAuth 可先走带锁自动刷新 |

Cursor 两条 surface 即使可能观察到同一订阅，也必须分别保留 target / source / freshness；一条可用不证明另一条
可用。同一 surface 内 first-party 与 usage-based 也不是可相加或可互补的容量：machine-wide target 分开投影，
`usage show` 则在兼容的 `billing_period` 之外用 named pools 保留原始分池事实。
Codex 的 rolling-24h（若另有足够样本导出）只能提示相对 7d 平均日预算的 burn risk，不能成为第二个 hard window。

<!-- ccm:k:end point:pacing.window-contracts -->
