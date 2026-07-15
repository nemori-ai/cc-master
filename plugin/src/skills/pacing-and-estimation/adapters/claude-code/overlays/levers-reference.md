**pacing 是单侧的（只在逼近上界时出声）。** 没有「欠用侧加速」；走廊内一律 `hold`（静默）。

## 走廊上界

5h 窗口 `used%` 逼近约 90% 即临界（`throttle`），7d 窗口逼近约 85% 即硬总闸（`stop_7d`）。`ccm usage advise` 的 `verdict` 就是引擎把当前 `used%` 对照上界算出来的——你读 verdict，不必自己算。

## effective-N 与换号

N 由号池 registry 算出：可切入备号数 + 当前在用号。5h 撞墙时，N=1 → `throttle` 或 `stop_5h`；N>1 且 7d 有余量 → `switch`，表示有可切下一份配额。候选、policy 与授权是彼此独立的决策输入；具体取舍与编排动作由 `master-orchestrator-guide` 决定。

## 减速影响向量

1. **模型档位** —— 更便宜的档位通常降低 burn，但可能改变质量与返工风险。
2. **WIP** —— 并发叶子越多，同一窗口内的 burn 通常越高。
3. **high-float** —— 非临界、token 重的工作具有跨窗口可推迟性。

## 停止边界事实

- **`stop_5h`**：当前 5h 配额本窗口已烧穿，且无可切备号 / 7d 亦吃紧；`nearest_reset` 给出下一次可重判的时间事实。若决策层选择建立 watchdog，必须先创建真实 wakeup 并取得 handle，再用 `ccm watchdog arm ... --job-id <handle> --checklist <事项>` 写 canonical `watchdog.checklist`；没有真实 handle 就不能 arm。是否停派、如何处理在飞任务与是否建立 watchdog，归 `master-orchestrator-guide` 决定。
- **`stop_7d`**：7d 是不可逆的跨窗口消耗边界，继续消耗已进入用户拥有的决定边界；具体取舍、编排动作与抗合理化归 `master-orchestrator-guide`。
