## 感知当前订阅账期

Cursor 的单一 `billing_period` 是当前账户的 aggregate 近邻信号，不能证明任一池的 headroom。`ccm usage show --json` 给出 `used_percent`、`remaining_percent`、`resets_at` 与 `window_billing_period_pct`；`ccm usage advise --json` 把它映射为 `hold`、`throttle` 或 `stop_billing_period`。先看 `available`：`false` 表示当前不可判，必须保持 fail closed。

这个绑定 `cursor-ide-plugin` 的 aggregate 信号不授权任何模型候选、跨池推断或 fallback。`cursor-agent-cli` 的 model/quota 事实必须独立绑定到 CLI surface；两条路线的诚实边界查 [model-tiers.md](model-tiers.md)。

读取顺序：

1. 用 `ccm usage advise --json` 读 verdict、`strength` 与 `nearest_reset`，不要自己重算阈值。
2. 信号来自当前本机 Cursor 登录态的 dashboard usage read（`source: cursor-dashboard`）。它只证明 aggregate 账期，不证明容量拓扑、headroom 或 spillover。
3. 本地 transcript 或账户级 delta 不能补齐缺失事实，也不能归因到并发节点。

**诚实边界：** IDE 账期百分比不能替代 [model-tiers.md](model-tiers.md) 中 `cursor-agent-cli` 的独立模型合同。单节点 token、duration、tool uses 只从对应 Task / Shell / external run 的可得 telemetry 记录，不能从账户 aggregate 反推。
