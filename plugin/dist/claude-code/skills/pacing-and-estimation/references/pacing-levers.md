# Pacing levers —— 单侧（减速 / 换号 / 停）+ 走廊上界 + effective-N

> **何时读：** `ccm usage advise` 出了 verdict（hold / throttle / switch / stop_5h / stop_7d·单侧 enum），你要把它落成具体 lever 时。这里是 levers 的**怎么做**（消费机制）——「该减速 / 该换号 / 该停」的**判断**由 verdict + 你的认知给（「量力而行」镜头）；具体决策归 `master-orchestrator-guide`，不在本文。

**pacing 是单侧的（只在逼近上界时出声）。** 没有「欠用侧加速」；走廊内一律 `hold`（静默）。

## 走廊上界

5h 窗口 `used%` 逼近约 90% 即临界（`throttle`），7d 窗口逼近约 85% 即硬总闸（`stop_7d`）。`ccm usage advise` 的 `verdict` 就是引擎把当前 `used%` 对照上界算出来的——你读 verdict，不必自己算。

## effective-N 与换号

N 由号池 registry 算出：可切入备号数 + 当前在用号。5h 撞墙时，N=1 → `throttle` 或 `stop_5h`；N>1 且 7d 有余量 → `switch`，表示有可切下一份配额。读到 `switch` / `switch_candidate` 后切不切、谁拍板归编排层；policy=allow 时 usage-pacing hook 可机械执行账号切换。

## 减速 lever

1. **降级模型** —— 把 token 重的叶子路由到更便宜的档位。
2. **降 WIP** —— 让更少的并发叶子在飞。
3. **推迟高 float 工作** —— 把非临界、token 重的叶子推到下一个窗口。

## 停 lever

- **`stop_5h`**：当前 5h 配额本窗口已烧穿，且无可切备号 / 7d 亦吃紧。响应是 **arm 一个 watchdog 自我唤醒**（background-shell `until` 轮询为 floor·降级链见 `master-orchestrator-guide` 的 `${CLAUDE_PLUGIN_ROOT}/skills/master-orchestrator-guide/references/dispatch.md` + `authoring-workflows`）守到 `ccm usage advise` 出的 `nearest_reset` 后配额回血再续派；在飞任务可跑完 / 端点验收，别再派需要大量 5h 配额的新活。
- **`stop_7d`**：7d 是不可逆的跨窗口消耗边界，停派新节点并 surface 用户拍板；动作与抗合理化归 `master-orchestrator-guide`。
