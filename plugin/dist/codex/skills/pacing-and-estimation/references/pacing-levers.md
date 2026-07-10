# Pacing levers —— 单侧（减速 / 换号 / 停）+ 走廊上界 + effective-N

> **何时读：** `ccm usage advise` 出了 verdict（hold / throttle / switch / stop_5h / stop_7d·单侧 enum），你要把它落成具体 lever 时。这里是 levers 的**怎么做**（消费机制）——「该减速 / 该换号 / 该停」的**判断**由 verdict + 你的认知给（「量力而行」镜头）；具体决策归 `master-orchestrator-guide`，不在本文。

**pacing 是单侧的（只在逼近上界时出声）。** 没有「欠用侧加速」；走廊内一律 `hold`（静默）。

## 走廊上界

5h 窗口 `used%` 逼近约 90% 即临界（`throttle`），7d 窗口逼近约 85% 即硬总闸（`stop_7d`）。`ccm usage advise` 的 `verdict` 就是引擎把当前 `used%` 对照上界算出来的——你读 verdict，不必自己算。

## Codex 下没有换号 lever

Codex adapter 当前不支持账号池切换。读到 `switch` / `switch_candidate` 时，不要执行账号切换；把它当成强节流信号：先降 WIP / 推迟高 float / 改派更便宜的可用模型或 reasoning effort，仍不足时停派并 surface 用户。7d 逼顶永远是总闸，不能靠账号池绕过。

## 减速 lever

1. **降级模型 / effort** —— 切到 model-tiers.md 的「配额紧张」列：先降有强机械验收的叶子（Sol→Terra→Luna，xhigh/max→high→medium/low），再降 WIP；高错误代价裁决保留 Sol high/max。Fast mode会更快消耗 credits，**不是**省配额档；`ultra` 在 throttle 下停用。
2. **降 WIP** —— 让更少的并发叶子在飞。
3. **推迟高 float 工作** —— 把非临界、token 重的叶子推到下一个窗口。

## 停 lever

- **`stop_5h`**：当前 5h 配额本窗口已烧穿。停止派发新工作，把当前在飞任务收敛到安全点，然后用 `ccm watchdog arm --mechanism external` 记录 reset 后要查的事项。Codex adapter 可用后台 terminal、thread automation（若当前环境提供）、外部 scheduler 或 cloud status loop 做真实唤醒；没有真实 wakeup handle 时，把它作为 `blocked_on:"quota-reset"` 或 `blocked_on:"user"` 的可续状态记录下来，不要伪造自动唤醒。
- **`stop_7d`**：7d 是不可逆的跨窗口消耗边界，停派新节点并 surface 用户拍板；动作与抗合理化归 `master-orchestrator-guide`。
