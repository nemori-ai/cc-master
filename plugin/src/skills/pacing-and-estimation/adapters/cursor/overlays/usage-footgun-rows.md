| `ccm usage advise` 出 `available:false` | Cursor dashboard 信号不可得；保守派发，不要反推百分比。 |
| 看到 `switch` / `stop_5h` / `stop_7d` | Cursor 无换号、无 5h/7d；不要执行账号切换，也不要按双窗走廊行动——按 billing_period throttle/stop 处理。 |
| 对照 `window_5h_pct` / `window_7d_pct` | Cursor 上为 null；只用 `window_billing_period_pct`。 |
