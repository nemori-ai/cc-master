# 机制契约：`skills/master-orchestrator-guide/scripts/cc-usage.sh`

> **⚠️ 已退役（ADR-015/024 后·被 `ccm usage advise` 取代）。** 该 skill 版脚本已从仓库删除——5h/7d usage 感知 + 配速数学已收口进独立安装的 `@ccm/engine`，主线在 pacing 决策点改跑 `ccm usage advise --json`（出单侧 verdict·ADR-024）。本文正文保留作历史，**不再是 live 机制**。

> 类别（历史）：运行时带外脚本（5h/7d usage 信号·NOT a hook·随 skill 分发）。源码（已删）：`skills/master-orchestrator-guide/scripts/cc-usage.sh`。主线在 pacing 决策点 deliberately 跑。

## 触发输入
- 主线 / account 脚本调用。用法 `cc-usage.sh [--dir <jsonl-root>] [--now <ISO8601>] [--rate-cache <path>]`。
- 读：本地 Claude Code JSONL（`~/.claude/projects/**/*.jsonl` 的 assistant.message.usage 记录）+ 账户权威 sidecar `$RATE_CACHE`（默认 `~/.claude/.cc-master-rate-limits.json`，statusline-capture.js 落的）。
- **注意**：用系统 `python3`（3.9-compatible）解析 JSONL——这是带外脚本，不进 hooks/、不受红线 1 约束。

## 业务流
1. python 解析 JSONL：按 `message.id` 去重保留 MAX usage 总和（被重写记录带更完整累计 usage，first-seen 会少报）；`--now` 锚点丢弃未来行。
2. 算 5h rolling block（ccusage 口径）：>5h idle 间隙或自块首满 5h 切新块；只有仍 contains now 的块是活动窗口，过期 → 干净归零。算 used_tokens / window_remaining_min / burn_rate_per_min；7d = 7 天内 token 总和。
3. **账户权威 override**（Finding #37）：sidecar 存在且 5h reset 在未来 → source=`account`，用账户权威 used_percentage + resets_at + 从 resets_at 算的 window_remaining_min（非反推）；否则 source=`local-derived-approx`。

## 输出副作用
- 无写。stdout 一行 JSON：`{"source":..., "five_hour":{...}, "seven_day":{...}}`。

## 关键不变式
- 账户权威优先、本地反推退为 fallback——绝不让看似精确的反推值冒充权威（Finding #37：反推 reset 倒计时可失真到数量级，标 approx）。
- 账户口径只在 5h reset 在未来（窗口仍有效）时生效；resets_at ≤ now（sidecar 跨过 reset、stale）→ fallback。
- 始终发归一化 schema（不直接管道 ccusage 那种我们不控制的 shape）。
- 零网络、零额外依赖（context %used 只在 status-line stdin、本脚本不发它，由 statusline-capture.js 捕获）。
- 绝不进 hooks/（红线 1/5：python 在带外脚本合法，在 hook 里禁）。

## 失败模式
- sidecar 缺/坏 → fallback 本地反推（标 approx）。
- 最近活动 >5h 前 → 窗口已刷新 → 干净归零（不报 stale used_tokens、不报负 window_remaining_min）。
