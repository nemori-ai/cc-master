## 感知 5h/7d 配额窗口

Codex 当前只消费**当前账号**的 5h/7d 用量。对一个 >24h 的目标，真正构成容量约束的是这两个窗口、而非 context%（「量力而行」镜头）。

读取方式，按口径可信度排：

1. **走廊 verdict（首选）—— `ccm usage advise --json`。** 引擎 `pacing.ts` 是**走廊数学的 SSOT**：吃 Codex 当前账号 5h/7d `used_percentage`（+ `resets_at`），吐 `verdict`（`hold` / `throttle` / `switch` / `stop_5h` / `stop_7d`）+ `strength` + `nearest_reset` + 推荐 lever 类。账户信号不可得 → `available:false`。
2. **账户权威信号源 —— Codex app-server。** ccm 通过 `codex app-server --stdio` 的 `account/rateLimits/read` 读取 rate limits，并把 `primary` 300 分钟窗口映射为 5h、`secondary` 10080 分钟窗口映射为 7d。Codex 不依赖外部状态行 sidecar，也不安装外部状态行命令。
3. **本地 JSONL / transcript 反推不用作 verdict。** 它看不见服务端真实 reset，reset 倒计时可能失真到数量级；信号不可用时宁可 `available:false` 诚实降级。

**诚实天花板：** 账户口径给 `used_percentage` + `resets_at`，不给窗口绝对 token 分母；所以 pacing 只能做方向性/区间判断（该节流 / 该停 / 是否 surface 用户），不能承诺把 used% 精确收敛到某点。

**per-node observability 正交：** 账户级 pacing 管整场长跑别撞墙；单个节点的 token / duration / tool uses 来自 Codex subagent result、后台 terminal session、cloud task 或外部 run 的可得 telemetry，写进 task `observability`。不要用账户级 delta 反推单节点成本，并发时它结构性无法归因。
