# 配额信号 —— 当前窗口 + 信号源链 + 诚实天花板

> **何时读：** 要把一场长跑对照当前 host 的配额窗口配速、想知道信号从哪来、`ccm usage advise` 出 `available:false` 时怎么办、或要理解为什么 pacing 只能做方向性走廊（不能精确收尾）时。**ccm 出 verdict、你（作为 orchestrator）决策**（advisory 不替编排判断）。

## 感知 7d hard ceiling 与 rolling-24h advisory

Codex 当前只消费**当前账号**的 7d 用量作为 hard ceiling；rolling-24h burn-rate 只提示相对 7d 平均日预算是否消耗过快，不是第二个硬窗口。对一个 >24h 的目标，真正构成容量上限的是 7d，而非 context% 或历史 5h 字段（「量力而行」镜头）。

读取方式，按口径可信度排：

1. **7d verdict（首选）—— `ccm usage advise --json`。** 只消费 Codex 当前账号 10080 分钟窗口的 `used_percentage` 与 `resets_at` 作为 hard-gate 输入。若输出还带 `five_hour`、`stop_5h` 或由 5h 推出的 `switch`，把它们标为 ignored provenance；它们不得进入 Codex 的动作判断。
2. **账户权威信号源 —— Codex app-server。** ccm 通过 `codex app-server --stdio` 的 `account/rateLimits/read` 读取 rate limits；`secondary.windowDurationMins == 10080` 才能绑定为 7d。`primary` / `five_hour` 即使出现也只留作被忽略的来源证据，不能映射成 Codex pacing authority。Codex 不依赖外部状态行 sidecar，也不安装外部状态行命令。
3. **rolling-24h burn-rate（advisory）——由可信 7d snapshot 的变化导出。** 它回答过去 24h 相对 7d 平均每日预算是否消耗过快，可提示 decision layer 检查节奏；它本身不能触发 hard stop、reset 或 wakeup。样本不足、跨 reset 或 provenance 不完整时保持 unknown。
4. **本地 JSONL / transcript 反推不用作 hard verdict。** 它看不见服务端真实 7d reset，倒计时可能失真到数量级；权威信号不可用时宁可 `available:false` 诚实降级。

**5h 的非权威边界：** 历史或额外 `five_hour` / 5h 是 ignored provenance，不得触发 `throttle`、`switch`、`stop_5h`、reset 或 wakeup。这个过滤发生在把事实交给决策层之前；不能因为旧引擎仍吐出字段就恢复已退役的产品语义。

**诚实天花板：** 账户口径给 7d `used_percentage` + `resets_at`，不给窗口绝对 token 分母；所以 pacing 只能表达压力方向、强度与 reset 区间，rolling-24h 也只是 burn-rate advisory，不能承诺把 used% 精确收敛到某点。

**per-node observability 正交：** 账户级 pacing 管整场长跑别撞墙；单个节点的 token / duration / tool uses 来自 Codex subagent result、后台 terminal session、cloud task 或外部 run 的可得 telemetry，写进 task `observability`。不要用账户级 delta 反推单节点成本，并发时它结构性无法归因。
