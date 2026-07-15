## 感知 5h/7d 配额窗口

一个 Pro/Max 订阅按一个 **5 小时滚动窗口**和一个 **7 天窗口**计量用量。对一个 >24h 的目标，真正构成容量约束的是这两个窗口、而非 context%（「量力而行」镜头）。

读取方式，按口径可信度排：

1. **走廊 verdict（首选）—— `ccm usage advise --json`。** 引擎 `pacing.ts` 是**走廊数学的 SSOT**：吃账户权威 5h/7d `used_percentage`（+ `resets_at` + effective-N），吐 `verdict`（`hold` / `throttle` / `switch` / `stop_5h` / `stop_7d`）+ `strength` + `nearest_reset` + 推荐 lever 类 + `switch_candidate` + `pool`。账户信号不可得 → `available:false`。
2. **账户权威信号源 —— Claude Code status-line sidecar。** ccm 自带 `ccm statusline`，首次跑任意 ccm 命令时会无感知地安装到全局 status line；它在渲染状态行的同时把 `rate_limits.{five_hour,seven_day}.{used_percentage,resets_at}` 落到 `${CC_MASTER_RATE_CACHE:-${CC_MASTER_HOME:-$HOME/.cc_master}/.cc-master-rate-limits.json}`。ccm `usage show/advise` 和 usage-pacing hook 都读这同一份。
3. **本地 JSONL / 社区工具反推**只作低信任参考；它看不见服务端真实 reset，reset 倒计时可能失真到数量级。ccm 引擎不把它作为 pacing verdict 的 fallback。

**接法：** 不用手动改 settings；ccm 自动安装 status line。要恢复原状态行用 `ccm statusline uninstall`；要手动重装用 `ccm statusline install`；要禁用自动安装设 `CC_MASTER_NO_AUTOINSTALL=1`。

**诚实天花板：** 账户口径给 `used_percentage` + `resets_at`，不给窗口绝对 token 分母；所以 pacing 只能表达压力方向、强度与 reset 区间，不能承诺把 used% 精确收敛到某点。

**per-node observability 正交：** 账户级 pacing 管整场长跑别撞墙；单个节点的 token / duration / tool uses 来自后台任务完成事件的 observability，写进 task `observability`，不要用账户级 delta 反推单节点成本。
