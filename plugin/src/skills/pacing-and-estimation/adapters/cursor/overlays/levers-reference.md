**pacing 是单侧的（只在逼近上界时出声）。** 没有「欠用侧加速」；走廊内一律 `hold`（静默）。

## 走廊上界（Cursor = 单窗 billing_period）

Cursor 只有**订阅账期**窗口（约 30 天 `billing_period`），没有 5h / 7d 滚动窗。`window_billing_period_pct` 逼近上界即临界（`throttle`），烧穿即 `stop_billing_period`。`ccm usage advise` 的 `verdict` 就是引擎把当前账期 `used%` 对照上界算出来的——你读 verdict，不必自己算。不要对照 `window_5h_pct` / `window_7d_pct` / `stop_5h` / `stop_7d`（Cursor 上为 null）。

## Cursor 下没有换号 lever

Cursor adapter **不支持**账号池切换；`verdict` 也不应出现 `switch`。若仍看到 `switch` / `switch_candidate` 残留语义，不要执行 `ccm account switch`；当成强节流：先降 WIP / 推迟高 float / 改派更便宜模型，仍不足时停派并 surface 用户。账期烧穿只能等 `nearest_reset`（账期续费日）或问用户，不能靠换号绕过。

## 减速 lever

1. **降级模型 / effort** —— 切到 model-tiers.md 的「配额紧张」列：机械叶 → Composer；常规实现 → Composer（强验收）/ Luna high；复杂实现 → Grok low/medium 或 Terra xhigh/max；Sol high/max 只留给高风险 review / 裁决。**先榨 first-party 池再烧 API 池**；`fast` 变体不是省钱档，Cursor 不投影 Codex `ultra`。
2. **降 WIP** —— 让更少的并发叶子在飞。
3. **推迟高 float 工作** —— 把非临界、token 重的叶子推到账期 reset 之后。

## 停 lever

- **`stop_billing_period`**：当前订阅账期配额已烧穿。停止派发新工作，把当前在飞任务收敛到安全点；先创建 background Shell 或外部 scheduler 并拿真实 handle，再用 `ccm watchdog arm --fire-at <reset-ISO-UTC> --mechanism <shell|cron> --job-id <handle>` 记录 reset 后要查的事项。没有真实 handle 时，记为 `blocked_on:"quota-reset"` 或 `blocked_on:"user"`，不要 arm 或伪造自动唤醒。
- **不要教 `stop_5h` / `stop_7d`**：那是 Claude Code / Codex 双窗语义，不适用于 Cursor。
