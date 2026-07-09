## 感知订阅账期（billing_period）配额

Cursor 当前只消费**当前账号**的订阅账期用量（约 30 天 `billing_period`）。对一个 >24h 的目标，真正构成容量约束的是这个账期窗口、而非 context%（「量力而行」镜头）。**没有 5h / 7d 滚动窗**——`window_5h_pct` / `window_7d_pct` 在 Cursor 上为 null，不要当配速输入。

读取方式，按口径可信度排：

1. **走廊 verdict（首选）—— `ccm usage advise --json`。** 引擎 `pacing.ts` 是**走廊数学的 SSOT**：吃 Cursor 当前账号 `billing_period` `used_percentage`（+ 账期结束 `resets_at`），吐 `verdict`（`hold` / `throttle` / `stop_billing_period`）+ `strength` + `nearest_reset` + 推荐 lever 类。账户信号不可得 → `available:false`。**不会**出 `switch` / `stop_5h` / `stop_7d` 作为 Cursor 目标语义。
2. **账户权威信号源 —— Cursor dashboard。** ccm 通过本机 Cursor 登录态调用 dashboard `GetCurrentPeriodUsage`（`source: cursor-dashboard`），映射为单窗 `billing_period`。Cursor 不依赖外部状态行 sidecar，也不安装 Claude 式 statusline 命令。
3. **本地 JSONL / transcript 反推不用作 verdict。** 它看不见服务端真实 reset；信号不可用时宁可 `available:false` 诚实降级。

**诚实天花板：** 账户口径给 `used_percentage` + 账期结束时间，不给窗口绝对 token 分母；所以 pacing 只能做方向性/区间判断（该节流 / 该停 / 是否 surface 用户），不能承诺把 used% 精确收敛到某点。

**per-node observability 正交：** 账户级 pacing 管整场长跑别撞墙；单个节点的 token / duration / tool uses 来自 Task subagent result、后台 Shell session 或外部 run 的可得 telemetry，写进 task `observability`。不要用账户级 delta 反推单节点成本，并发时它结构性无法归因。
