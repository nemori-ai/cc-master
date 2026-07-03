当前号 5h + 7d 各算一个配额%-burn-rate（Δused%/Δtime·账户权威·`window-elapsed` = 已用% ÷ 窗口已逝小时·%/h）；读 status-line sidecar（账户权威），信号不可得 → `available:false`（exit 0·诚实降级·非 exit 1）。`burn_pct_per_hour` 不可算 → `null`
