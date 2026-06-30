# Pacing levers —— 双侧（减速侧 ∥ 加速侧）+ 目标走廊 + effective-N

> **服务愿景：C2**（控制 token 消耗速度）**· C5**（资源下最大化效率）。**何时读：** `ccm usage advise` 出了 verdict（throttle / accelerate / hold / hard_stop），你要把它落成具体 lever 时。这里是 levers 的**怎么做**（消费机制）——「该减速还是加速」的**判断**由 verdict + 你的认知给（镜头 5）；**换号 lever 的决策锚**（lever 阶梯 / policy 授权 / 绝不自授权）在 `orchestrating-to-completion` 的 `references/cost-decisions.md`，**不在本文**（红线 3：换号决策归 A）。

Pacing 是双向的：墙迫近时**节流而不停**（减速侧·verdict `throttle`），有余量却临 reset 时**提速而不顶满**（加速侧·verdict `accelerate`）。配额用进废退——一个 5h 窗口没用满的额度到 reset 就**永久蒸发**，这和半截撞墙同是镜头 5 的失败（一个浪费容量、一个透支容量）。

## 目标走廊（setpoint，不是单边上限）

不再瞄单一「~75% 上限」，而是瞄一条**目标走廊**：5h 窗口 reset 时落在 **~70%–90%**（下沿=别让窗口白白蒸发，上沿=留缓冲免得变量噪声下半截撞墙）。**不瞄字面 100%**——顿顿吃满 5h 会提前撞穿 7d 窗口，且变量下易在 reset 前停摆。走廊数字是默认起点、可按场景调；关键是它**两侧都有边**。`ccm usage advise` 的 `verdict` 就是引擎把当前 `used%` 对照这条走廊算出来的——你读 verdict、不必自己算走廊（DRY）。

**7d 是总闸（hard gate on acceleration）：只有 7d 窗口也有余量时才准加速。** 7d 窗口长、最易不知不觉逼顶——若 7d 已逼近上限，即便某 5h 窗口欠用引擎也**不**出 `accelerate`（让它蒸发，把额度留给 7d 跨度内更靠后的临界活）。加速永远先过 7d 这道闸。

> **`hard_stop`（7d≥85%）的动作归 A。** 当 `ccm usage advise` 出 `hard_stop`（7d `used%` 达 85%），总闸从「挡加速」收紧到「挡派发本身」——**停 dispatch 任何新节点、把「是否继续消耗 7d 配额」作 `blocked_on:"user"` surface 给用户拍板**。这套**动作 + 抗合理化**（临界路径不是绕过的理由 / 旧「今天 ship」不是预先授权 / hook「非阻断」不是 FYI）是 `orchestrating-to-completion` 镜头 5 + 决策程序 §(f) + Rationalization Table 的活——本文（消费层）只负责让你**认得这个 verdict 意味着什么**，决策回 A。

## 多账号并行下的理想节奏（effective-N）

你有时握着不止一份配额——**N 份可序列消费的配额**（真切新号计费，非名义心智数）。N 由 `usage-pacing.js` 从号池 registry `accounts.json` **算出的 effective-N**（非 active、token 未过期、**且 `switchable`** 的可切入备号数 + 当前在用号；无 registry / 空池 → effective-N=1，天然单账号），`ccm usage advise --json` 也以它返回的 `effective_n` 为权威。号池怎么建 / 怎么算见 `using-ccm` 的 `references/account-pool.md`（概念叙事）+ ccm `account` 引擎（实现）。直觉模型：N 份配额并行 → 单账号的「该用完」窗口从 5h「有效压缩」到 5h/N、理想 burn ×N、走廊到达节奏快 N 倍。

> **诚实天花板冠在前面**：账户口径只给 `used_percentage` + `resets_at`、**不给窗口绝对 token 分母**（见 `usage-signals.md` 诚实天花板），所以「N 倍速」**算不出一个 tok/min 的精确理想速率**——它只能缩放**无量纲的百分比节奏**。别把 N 缩放当成一个精确速率承诺；它是方向性的「该更积极烧 / 该更早切」，不是「精确快 N 倍」。

引擎把 N 落成两条变换（两侧不对称——这是设计）：

- **欠用侧（催加速更积极）**：欠用判定的 ceil 抬成 `effective_ceil = min(95, ceil × N)`（默认 ceil=60）。直觉：N 份配额时你该烧得更快，同一剩余时间下「还没烧到该烧的量」的判定线更高——N=1→60（原行为）、N≥2→基本「临 reset 还没烧满就催加速」。封顶 95，绝不把一个快满的窗口误判成「欠用」。
- **撞墙侧（per-account 物理线，按 N 分叉措辞）**：撞当前账号 5h 墙（默认 85%）时——**N=1** → 这是该账号要烧穿、回落减速（原行为）；**N>1** → 当前账号 5h 烧满只是**「切到下一份配额」的触发信号、不是减速信号**（`verdict` 此时倾向 `accelerate`/`switch_candidate` 非空，理想是把这份烧满后顺势用下一份）。**7d 墙不随 N 变**：7d 是跨窗口总闸（N 是 5h 内的序列/并行度，正交），7d 命中永远减速、无论几份配额。读到 `switch_candidate` 后**切不切由 A + 用户拍**（决策锚见 A 的 `cost-decisions.md`）。

## 减速侧 lever（verdict `throttle`，大致按顺序）

当 burn-rate 的墙迫近时，**节流而不停**——机械活仍能推进；全停是白白浪费可用配额（镜头 4），顶满则会半截撞墙停摆（镜头 5）。三个 lever，大致按顺序：

1. **降级模型** —— 首要 lever；把 token 重的叶子路由到更便宜的档位（`agent({model})` 或一个更便宜的 sub-agent）。这正是 tiering 与 pacing 咬合之处：**降级模型*本身*就是一个 pacing 动作。**（effort 在这里*不是* lever——派发 API 不把它往下穿透；见 `model-tiers.md`。）
2. **降 WIP** —— 让更少的并发叶子在飞（Little's Law；admission control 见 `orchestrating-to-completion` 的 `dispatch.md`）。
3. **推迟高 float 工作** —— 把非临界、token 重的叶子推到下一个窗口；在 board 上记为 `blocked_on: "quota-reset"`，等窗口刷新时它们重新触发（这是一个被推迟的决策，由 step-6 ledger 兜住可续性）。

## 加速侧 lever（verdict `accelerate`：5h 欠用 + 临 reset + 7d 有余量，与减速侧对称）

触发：`ccm usage advise` 出 `accelerate`（当前 5h `used%` 明显低于走廊下沿、`resets_at` 临近、**且 7d `used%` 仍有余量**）。此时不是装忙制造 busywork（那仍违镜头 4），而是把**本就 ready、本该做、只因省额度被你压着没派的真实工作**提前拉进本窗口。三个镜像 lever：

1. **升档模型** —— 减速侧「降级模型」的镜像：把为省额度降到便宜档的临界/难活升回它**本该**的档（Sonnet→Opus、裁决回 Fable）。首要加速 lever。
2. **升 WIP** —— 在 Little's Law 与利用率悬崖之内多放几条并发 lane，让更多 ready 的 float 活同时在飞。
3. **把后续窗口的 float 提前拉进本窗口** —— 减速侧「推迟 float」的精确镜像：原打算 defer 到下窗口的非临界活，若已 ready 且本窗口有余量，提前派发。

**加速侧的红线对齐。** 加速 ≠ 镜头 5 禁止的「顶满利用率」。镜头 5 禁的是冲过悬崖/顶到 100% 半截撞墙；在走廊内、过了 7d 总闸、拉的是真实 ready 工作而非 busywork——这是**填满本就该填的容量**，恰是镜头 5「量力而行」的另一半。把「reset 前冲刺」一律读成过度利用而拒绝，是**误读**——只有越过走廊上沿/绕过 7d 总闸/制造 busywork 才是过度利用。

> **换号 lever 是最重的一根，但它的决策锚不在本文。** 轻 lever（降档 / 降 WIP / 推迟 float）在**同一份配额内**腾挪；当一份配额真要在本窗口烧穿、而你还握着未消费备号（effective-N>1、`switch_candidate` 非空）时，最重的 lever 是**换号**（切到下一份配额）。但**何时换、谁拍板、policy 授权、绝不自授权、切换前后约束**全是**编排决策**——见 `orchestrating-to-completion` 的 `references/cost-decisions.md`（决策锚）；换号**机制**（`ccm account switch` 怎么切、policy 硬闸怎么 exit 7）见 `using-ccm`（D）+ ccm `account` 引擎。本文（消费层）只到「读懂 `switch_candidate` 意味着有可切的下一份配额」为止。
