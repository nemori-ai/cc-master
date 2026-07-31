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

## 失效类型

`environment_fact`（主体：事实方法） —— 删掉这条，模型不知道各 harness 的独立窗口合同，会跨 surface 拼接窗口（如把 claude-cli 7d 加上 fable 7d）或混淆 first-party 与 usage-based 池。

主体是一张 harness→承重窗口→信号语义的对照表，纯粹是本环境的具体事实。

## 边界

仅适用于决策涉及多个 harness target 的场景（单 surface 内部决策可忽略）；Cursor 的两条 surface 和 Codex 的 7d 单一窗口都是硬约束，不可替代或互补。

## 失败形态

在 pacing 决策中跨 surface 相加窗口（如「总共还有 claude 7d 加 fable 7d」）；或把 Cursor 的 billing_period first-party 和 usage-based 当同一池；或把 Codex 的虚拟 24h 当第二个硬 window。
