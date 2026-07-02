# 配额信号 —— 感知 5h/7d 窗口 + 信号源链 + 诚实天花板

> **服务愿景：C2**（控制 token 消耗速度）。**何时读：** 要把一场长跑对照 5h/7d 配额窗口配速、想知道配额信号从哪来、`ccm usage advise` 出 `available:false` 时怎么办、或要理解为什么 pacing 只能做方向性走廊（不能精确收尾）时。**ccm 出 verdict、你（A）决策**（红线 3：advisory 不替编排判断）。

## 感知 5h/7d 配额窗口

一个 Pro/Max 订阅按一个 **5 小时滚动窗口**和一个 **7 天窗口**计量用量。对一个 >24h 的目标，真正构成容量约束的是这两个窗口、而非 context%（镜头 5）。

> **口径优先级：账户权威 > 本地反推。** 账户真实的 `used_percentage`（5h/7d）+ `resets_at`（reset 时刻）是**权威**，但官方核实它**只**出现在 status-line 脚本的 stdin 里——所有 hook 的 stdin、transcript JSONL、任何 `claude` CLI 子命令、API `anthropic-ratelimit-*` headers（那是 API tier 的 RPM/ITPM，与订阅 5h/7d 滚动窗口口径不同）**全都拿不到它**。本地 JSONL 只能**反推** 5h 窗口，而反推把窗口起点钉在「最近一段连续活动的首条消息」，看不见服务端真实计费窗口的 reset 事件——**reset 倒计时可失真到数量级**（实测反推「剩 21min」vs 账户权威「剩 2h55m」，差 2h40m）。所以：能拿到账户口径就**绝不**信反推。

读取方式，按口径可信度排：

1. **走廊 verdict（首选）—— `ccm usage advise --json`。** 引擎 `pacing.ts` 是**走廊数学的 SSOT**：吃账户权威 5h/7d `used_percentage`（+ `resets_at` + effective-N），吐 `verdict`（`hold` 走廊内 / `throttle` 5h 临界减速 / `switch` 5h 临界+n>1+7d 余量切号 / `stop_5h` 5h 本窗烧穿 arm wakeup / `stop_7d` 7d 硬总闸）+ `strength`（标签强度）+ `nearest_reset`（stop_* 时）+ 推荐 lever 类 + `switch_candidate` + `pool`。账户信号不可得 → `available:false`（pacing 不可判·降级）。**ccm 出 verdict、你决策**（红线 3：advisory 不替编排判断；动作仍归你的认知）。配额**状态**（当前号/备号 5h/7d %、effective-N）用 `ccm usage show --json`；任务 token 成本用 `ccm usage task-cost`。
2. **账户权威信号源 —— `ccm statusline`（ccm 自带·自动安装）→ sidecar。** ccm 的账户权威 `used_percentage`/`resets_at` 来自 status-line：ccm **自带一条 status line**（`ccm statusline`），**首次跑任意 ccm 命令时会无感知地把它装进 `settings.json`**（幂等·会覆盖你现有的 statusLine·已备份·`ccm statusline uninstall` 可恢复·`ccm statusline install` 可手动重装）。它在 status-line 被调用时渲染单行状态行的**同时**把 `rate_limits.{five_hour,seven_day}.{used_percentage,resets_at}` 落到 sidecar（`${CC_MASTER_RATE_CACHE:-${CLAUDE_CONFIG_DIR:-~/.claude}/.cc-master-rate-limits.json}`·路径跟随 `CLAUDE_CONFIG_DIR`（默认 `~/.claude`）），ccm（`usage show`/`advise`）+ `usage-pacing.js` hook 都读这同一份。**这是唯一不失真的 reset 倒计时来源**，且**不再需要你手接任何脚本**（采集已内置进 `ccm statusline`·退役了旧的带外 `statusline-capture.js` 与 `cc-usage.sh` 薄包装——直接 `ccm usage show/advise --json` 即可）。无 sidecar 时 ccm 诚实吐 `available:false`（**本地 JSONL 反推已撤**：引擎不含反推、反推的 reset 会失真到数量级；此带外信号现仅账户权威）。
3. **`npx ccusage blocks --json`** —— 社区工具，自带官方 burn rate；手头有就直接跑。但它也是解析 JSONL 的反推，给不了账户 `used_percentage`（那只在 status-line）。

> **`usage-pacing.js` hook 已退役本地 JSONL 反推 fallback。** 旧模型里 hook 在账户口径不可用时自带一层本地反推撞墙 floor；`ccm` 成为主机硬前置后，这层 fallback 前提消失——现 hook 的走廊 verdict **唯一经 `ccm usage advise`**，ccm 缺 / sidecar 缺（`available:false`）→ hook **静默**（不再本地反推）。反推 reset 倒计时会失真到数量级，退役它反而更诚实。

**接法（已自动·无需手接）：** 不用再手动改 `settings.json`——ccm 首次被调用时自动把 `statusLine.command` 设成它自带的 `ccm statusline`（**绝对路径**写入·因 `${CLAUDE_PLUGIN_ROOT}` 在 statusLine.command 里不展开、故须绝对路径），并把你原有的 `statusLine` 备份起来。想关掉/恢复你自己的：`ccm statusline uninstall`（落 opt-out 标记·自动安装不再覆盖回去）；想手动重装：`ccm statusline install`；想全局禁用自动安装：设 `CC_MASTER_NO_AUTOINSTALL=1`。⚠️ status-line 在 idle 时安静——长等后台时配 `refreshInterval` 保持 sidecar 新鲜（`resets_at` 是绝对时刻，即使 sidecar 略旧倒计时仍准，除非已跨 reset）。

**撞墙预测。** `ccm usage advise` 的走廊数学（引擎 `pacing.ts`）已替你判这一步：5h 逼近上界出 `throttle`（有可切备号 + 7d 余量则 `switch`、无则 7d 亦吃紧时 `stop_5h`）；7d≥85% 出 `stop_7d`（跨窗口硬总闸·**7d 尤其要看**，它窗口长、最易不知不觉逼顶——`usage-pacing.js` hook 也对 7d 出声）。你只需**读 verdict + 据它拍 lever**；不必自己拿 `used_percentage` 重算走廊（那是引擎的活·DRY）。账户口径不可用 → `available:false`，hook 此时**静默**（ADR-024 后无本地反推 fallback）。读到 `stop_7d` 后的**动作**（停派新节点 / surface 用户）归 `orchestrating-to-completion` 镜头 5/7 + 决策程序 §(f)，本文只教读 verdict。

诚实交代 scope：账户 `used_percentage` 仅 Pro/Max 交互式可见；API-key 用户没有滚动窗口、headless 拿不到 status-line（status line 虽自动安装，headless 不渲染它）——这些一律 `available:false` 降级（ADR-024 后 hook 静默·不再本地反推出声）。

## 诚实天花板：只能做方向性走廊，做不到精确收尾

用当前信号**做不到**「精确闭环到 100%」，这是结构性硬墙：

1. 账户口径给 `used_percentage`（百分比）+ `resets_at`，**不给窗口绝对 token 分母** → 算不出「还能烧多少」；
2. 账户口径**不给 burn rate**，burn 只在本地反推路径、且其窗口起点可失真——**精确预测 reset 落点需要「剩余绝对额度 ÷ 权威 burn」，分子分母永远不在同一条可信路径上凑齐**；
3. 故只能做**方向性/区间** pacing（该节流 / 该换号 / 该停、走廊上界侧），不是把 used% 精确收敛到某点——这正是用**上界（区间）而非字面 100%（点）**的根本原因，不是保守取向，是信号物理上只够支撑区间判断；
4. 账户 `used%` 仅 Pro/Max 交互式可见，headless/API-key/已 `ccm statusline uninstall` opt-out 一律 `available:false` 降级——**hook 在此静默**（退役了本地反推 fallback）。
5. **pacing 单侧收敛**——退役了旧的「欠用→加速」侧（连同它对 sidecar 新鲜度的额外要求）。现只在逼近上界时出声（throttle / switch / stop_5h / stop_7d），走廊内 `hold` 静默。「配额没用满就蒸发」不再作为催加速的理由。
6. `num_account`（N 份配额）的 **N 缩放是方向性的、不是「精确快 N 倍」**：账户口径无绝对 token 分母（第 1 条），「N 倍速」算不出一个 tok/min 数，只能缩放无量纲的 `used%` 节奏——它**只在 5h 撞墙时按 N 分叉 verdict**（N>1+7d 余量→`switch` 切下一份配额 / N=1→`throttle` 或 `stop_5h`），**绝不放松撞墙的 per-account 物理保护、也不松动 7d 总闸**（7d 与 N 正交）。N 缩放只在账户口径生效。

绝不承诺「reset 时配额精确归零」。

> **与 per-node observability 口径正交（别混用）**：上面这套是**账户级 pacing**——只给 `used_percentage`（百分比、无绝对 token 分母）、混合所有在飞 node 与主线。**per-node 的 token 是另一条独立的精确路径**：每个 sub-agent / workflow 完成时 `<task-notification>` 自带 `<usage>` 块（`subagent_tokens` / `duration_ms` / `tool_uses`），orchestrator 标 done 那拍直接抄进该 task 的 `observability` 柔性边（schema 见 `orchestrating-to-completion` 的 `references/board.md`）。两者口径与用途正交：账户 pacing 管「整场长跑别撞墙」，observability 管「单个节点烧了多少、回喂自进化 / workflow 固化」。**切勿用账户级 delta（node start/finish 读两次 `used%` 取差）反推 per-node token**——并发多 node 在飞时 delta 把它们全混在一起、结构性无法归因到单 node（已有精确的 notification 路径，没理由退回污染路径）。
