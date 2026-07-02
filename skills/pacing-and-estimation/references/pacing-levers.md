# Pacing levers —— 单侧（减速 / 换号 / 停）+ 走廊上界 + effective-N

> **服务愿景：C2**（控制 token 消耗速度）**· C5**（资源下最大化效率）。**何时读：** `ccm usage advise` 出了 verdict（hold / throttle / switch / stop_5h / stop_7d·ADR-024 翻转后的单侧 enum），你要把它落成具体 lever 时。这里是 levers 的**怎么做**（消费机制）——「该减速 / 该换号 / 该停」的**判断**由 verdict + 你的认知给（镜头 5）；**换号 lever 的决策锚**（lever 阶梯 / policy 授权 / 绝不自授权）在 `master-orchestrator-guide` 的 `references/cost-decisions.md`，**不在本文**（红线 3：换号决策归 A）。

**ADR-024：pacing 从双侧走廊收敛为单侧。** 旧模型有「欠用侧加速」（5h 用量低于下沿 + 临 reset → 催加速升档/升 WIP/提前拉 float）；翻转后**退役了 `accelerate` 这一侧**——pacing 只在**逼近上界**时出声，走廊内一律 `hold`（静默）。逼近上界的响应按「同一份配额内节流 → 换到下一份配额 → 本窗口烧穿等 reset → 7d 硬总闸停派」逐级升。「配额没用满就蒸发」不再作为催加速的理由（引擎不再据此出 verdict）。

## 走廊上界（ceiling，不是双边 setpoint）

瞄一条**上界**：5h 窗口 `used%` 逼近 **~90%** 即临界（`throttle`），7d 窗口逼近 **~85%** 即硬总闸（`stop_7d`）。**不瞄字面 100%**——顿顿吃满 5h 会提前撞穿 7d 窗口，且变量下易在 reset 前停摆。上界数字是默认起点、可按场景调。`ccm usage advise` 的 `verdict` 就是引擎把当前 `used%` 对照上界算出来的——你读 verdict、不必自己算（DRY）。

**7d 是跨窗口硬总闸。** 7d 窗口长、最易不知不觉逼顶——7d `used%` 达 85% 时引擎出 `stop_7d`：总闸从「挡换号加速」收紧到「挡派发本身」——**停 dispatch 任何新节点、把「是否继续消耗 7d 配额」作 `blocked_on:"user"` surface 给用户拍板**。这套**动作 + 抗合理化**（临界路径不是绕过的理由 / 旧「今天 ship」不是预先授权 / hook「非阻断」不是 FYI）是 `master-orchestrator-guide` 镜头 5 + 决策程序 §(f) + Rationalization Table 的活——本文（消费层）只负责让你**认得这个 verdict 意味着什么**，决策回 A。

## 多账号并行下的换号触发（effective-N）

你有时握着不止一份配额——**N 份可序列消费的配额**（真切新号计费，非名义心智数）。N 由 `usage-pacing.js` 从号池 registry `accounts.json` **算出的 effective-N**（非 active、token 未过期、**且 `switchable`** 的可切入备号数 + 当前在用号；无 registry / 空池 → effective-N=1，天然单账号），`ccm usage advise --json` 也以它返回的 `effective_n` 为权威。号池怎么建 / 怎么算见 `using-ccm` 的 `references/account-pool.md`（概念叙事）+ ccm `account` 引擎（实现）。

> **诚实天花板冠在前面**：账户口径只给 `used_percentage` + `resets_at`、**不给窗口绝对 token 分母**（见 `usage-signals.md` 诚实天花板），所以撞墙侧只能缩放**无量纲的百分比节奏**，不是精确速率承诺。

**N 落在撞墙侧的分叉（per-account 物理线）**：撞当前账号 5h 墙（默认 90%）时——**N=1**（无可切备号）→ 这是该账号本窗口要烧穿：若 7d 亦吃紧 → `stop_5h`（arm watchdog 守到 reset 回血），否则 `throttle`（回落减速）；**N>1**（有可切入备号）+ 7d 有余量 → 引擎出 **`switch`**（当前账号 5h 烧满只是**「切到下一份配额」的触发信号、不是减速信号**，理想是把这份烧满后顺势用下一份满配额的 5h 窗）。**7d 墙不随 N 变**：7d 是跨窗口总闸（N 是 5h 内的序列/并行度，正交），7d 逼顶永远 `stop_7d`、无论几份配额。读到 `switch` / `switch_candidate` 后**切不切、谁拍板**归 A（决策锚见 A 的 `cost-decisions.md`）——但注意 `usage-pacing.js` hook 在 policy=allow 时会**机械换号**（切号执行归 hook·你只调配速）。

## 减速 lever（verdict `throttle`，大致按顺序）

当 burn-rate 的墙迫近时，**节流而不停**——机械活仍能推进；全停是白白浪费可用配额（镜头 4），顶满则会半截撞墙停摆（镜头 5）。三个 lever，大致按顺序：

1. **降级模型** —— 首要 lever；把 token 重的叶子路由到更便宜的档位（`agent({model})` 或一个更便宜的 sub-agent）。这正是 tiering 与 pacing 咬合之处：**降级模型*本身*就是一个 pacing 动作。**（effort 在这里*不是* lever——派发 API 不把它往下穿透；见 `model-tiers.md`。）
2. **降 WIP** —— 让更少的并发叶子在飞（Little's Law；admission control 见 `master-orchestrator-guide` 的 `dispatch.md`）。
3. **推迟高 float 工作** —— 把非临界、token 重的叶子推到下一个窗口；在 board 上记为 `blocked_on: "quota-reset"`，等窗口刷新时它们重新触发（这是一个被推迟的决策，由 step-6 ledger 兜住可续性）。

## 换号 lever（verdict `switch`）—— 最重的一根，决策锚不在本文

轻 lever（降档 / 降 WIP / 推迟 float）在**同一份配额内**腾挪；当一份配额真要在本窗口烧穿、而你还握着未消费备号（effective-N>1、`switch_candidate` 非空）时，最重的 lever 是**换号**（切到下一份配额）。`usage-pacing.js` hook 在 `switch` verdict + policy=allow 时**机械执行换号**（`ccm account switch`·token-blind·选号 / policy 硬闸 deny→exit7 都在 ccm）；policy=deny 或全池逼顶时把「是否换号」作 `blocked_on:"user"` surface 给你拍。**何时换、谁拍板、policy 授权、绝不自授权、切换前后约束**全是**编排决策**——见 `master-orchestrator-guide` 的 `references/cost-decisions.md`（决策锚）；换号**机制**（`ccm account switch` 怎么切、policy 硬闸怎么 exit 7）见 `using-ccm`（D）+ ccm `account` 引擎。本文（消费层）只到「读懂 `switch` / `switch_candidate` 意味着有可切的下一份配额」为止。

## 停 lever（verdict `stop_5h` / `stop_7d`）

换号无门（N=1 或全池逼顶）而配额烧穿时，pacing 收紧到「停」——但两种停性质不同：

- **`stop_5h`（本窗口烧穿·可自愈）**：当前 5h 配额本窗口已烧穿，且无可切备号 / 7d 亦吃紧。这**不是任务失败**——5h 窗口会 reset 回血。响应是 **arm 一个 watchdog 自我唤醒**（background-shell `until` 轮询为 floor·降级链见 `master-orchestrator-guide` 的 `dispatch.md` + `authoring-workflows`）守到 `ccm usage advise` 出的 `nearest_reset` 后配额回血再续派；在飞任务可跑完 / 端点验收，别再派需要大量 5h 配额的新活。
- **`stop_7d`（跨窗口硬总闸·须 surface 用户）**：7d 是不可逆的跨窗口消耗边界（reset 周期长）——不是「等一会儿就回血」，而是**停派新节点 + 把「是否继续消耗 7d 配额」作 `blocked_on:"user"` surface 给用户拍板**。动作 + 抗合理化归 A 镜头 5/7 + 决策程序 §(f)（见上「7d 是跨窗口硬总闸」段）。
