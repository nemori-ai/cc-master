Use when 你（orchestrator/agent）在 Cursor IDE Agent 下要消费 ccm 的只读 advisory 把它配速或估算——把长跑对照 **订阅账期（约 30 天 billing cycle）** pace、估目标 ETA / 查进度偏差(EVM) / 看综合风险 / 算 cost-to-complete、或要读懂 `ccm usage advise` `ccm estimate forecast` 的 verdict 与字段时。它给的是**消费机制知识**：Cursor 单窗 `billing_period` verdict（hold/throttle/stop_billing_period）怎么读、`window_billing_period_pct` 与 `nearest_reset`（账期结束）含义、估算诚实字段(coverage_pct/confidence/conformal 区间)什么时候该降低对预测的信任。Triggers: 在 Cursor 下读 ccm usage/estimate/baseline 的输出、"账期用量逼顶怎么落 lever / 该等 billing reset 还是问用户 / 这个 forecast 信不信"、Stop 侧 pacing advisory。Do NOT use when 你要的是**决策**——该不该减速/停派/replan、范围/期限/配额取舍谁拍板（那是 master-orchestrator-guide）；或 ccm 命令**怎么敲**（那是 using-ccm）。

**Cursor 与 Claude Code / Codex 的硬分叉（必读）：**
- **无 5h / 7d 滚动窗**——不要对照 `window_5h_pct` / `window_7d_pct` / `stop_5h` / `stop_7d` 做 Cursor 配速（那些字段在 Cursor 上为 null）。
- **无自动换号**——`verdict` 永不出现 `switch`；不要建议 `ccm account switch`。
- 信号源：本机 Cursor 登录态 → dashboard `GetCurrentPeriodUsage`（`source: cursor-dashboard`）；读失败则 `available:false`，hook 应静默，勿编造百分比。
- 配速 levers：降模型档 / 降 WIP / 推迟高 float / 等 `nearest_reset`（账期续费日）——不是换号。

ccm 出 verdict、决策归 master-orchestrator-guide——本 skill 只教消费层，不替编排做判断。
