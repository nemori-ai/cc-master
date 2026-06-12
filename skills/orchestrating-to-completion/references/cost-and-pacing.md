# Cost & pacing —— 模型档位与 usage-aware 节流

> **服务愿景：C2**（节流 token 消耗）**· C6**（按难度选模型档位）。**何时读：** 给每个节点选模型档位 + 想清楚为何主线固定一个模型（prompt-cache）；把一场长跑对照 5h/7d 配额窗口来 pace——靠 `${CLAUDE_SKILL_DIR}/scripts/cc-usage.sh` 感知（**账户权威 `used_percentage` 优先、本地反推 fallback**），levers：降级模型 / 降 WIP / 推迟 float。

> **它是什么——以及它*不是*什么。** 这里装的是编排者默认会缺的那块 reference 知识：四个模型档位及其相对成本、为何主线固定一个模型、以及怎么把一场 long-horizon 跑对照 5h/7d 配额窗口来 pace。它是**informational，不是红线。** Subagent pressure baseline（model-tiering ×6、usage-pacing ×2，零失败）表明 agent 已经能从镜头 2（把资源集中到临界链）和镜头 5（在容量内干活）*推导*出正确的 tiering / pacing。它们真正缺的只是下面这几条具体事实——档位定位 + 成本、切主线模型的 cache 代价、以及配额窗口的信号来源。所以把它们嵌进 `decomposition.md` 的每节点契约里就够；**别**把它们升格成一条独立纪律、更别为它们加红线（baseline 证明一条都不需要——§6 TDD-for-skills 的 Iron Law 禁止编造一条 agent 根本不会违背的规则）。

## TOC
- [模型档位](#模型档位)
- [每节点模型选择](#每节点模型选择)
- [为何主线固定一个模型](#为何主线固定一个模型)
- [感知 5h/7d 配额窗口](#感知-5h7d-配额窗口)
- [Pacing levers](#pacing-levers)

---

## 模型档位

> **易 stale 警告（SSOT 不在本表）。** 下表的具体 **model ID**、绝对 **$/1M 价格**、乃至档位构成都会随时间变动——本表的快照是**截至 2026-06**。**当前真值的单一真相源是 Anthropic API 官方文档（platform.claude.com 的 models / pricing 页），或本仓 `claude-api` skill**（它内嵌一张带 cache 日期的现价/现 ID 表）；选档要核对绝对数字时，去那里，别信本表的字面。本表的**教学价值不在绝对美元数，而在下面那行相对 multiplier 的心智模型**——那部分稳定，绝对价格不稳定。

| Tier | Model ID | $/1M in·out | Relative output cost | Use for |
|---|---|---|---|---|
| Fable 5 | `claude-fable-5` | $10 · $50 | **10×** | 高杠杆判断与裁决(verdict-bearing):独立 review / 二审 · 端点验收 · 决策咨询 · 架构仲裁 / 方案选型 · 最难的开放推理 / 创意 / 叙事 |
| Opus 4.8 | `claude-opus-4-8` | $5 · $25 | **5×** | 旗舰执行推理:agentic 实现 · 临界路径难实现活 · 复杂并发 bug 根因 · 常规 review |
| Sonnet 4.6 | `claude-sonnet-4-6` | $3 · $15 | **3×** | 平衡主力:常规实现 |
| Haiku 4.5 | `claude-haiku-4-5` | $1 · $5 | **1×** | 快 & 便宜:机械活(跑测试 / grep / 格式化 / 改名),200K context |

（绝对美元为截至 2026-06 的快照；现价以 API 官方文档 / `claude-api` skill 为准——见上方警告。）编排的花销由输出主导（agent 吐的远多于它读的），所以真正该拿来 pace 的数字是 **relative output multiplier**——Haiku 1× / Sonnet 3× / Opus 5× / Fable 10×：一个 Opus 叶子 ≈ 五个 Haiku 叶子，一个 Fable 叶子 ≈ 十个。这组**相对关系**（强档 ≈ 弱档的 N×）是这段真正稳定、可长期依赖的心智模型；档位重排或绝对单价变动时，更新上表数字即可，这组 multiplier 思路照旧。

补一句 `effort`（`output_config: {effort: …}`）的事：它确实是一个 **API-layer** 的 token 旋钮，你的*主 session* 也遵循自己的 `effortLevel`。但 cc-master 的派发 API **不**把它往下穿透——workflow 的 `agent()` 只接受 label/phase/schema/model/isolation/agentType，Agent sub-agent 同样没有 effort 旋钮。所以你对*叶子*成本真正握得住的 lever 是它的**模型档位**，不是 effort——别给 `agent()` 传一个杜撰的 `effort` option（SKILL B 禁止杜撰 option）。

## 每节点模型选择

给 `decomposition.md` 的每节点契约加一个 **model** 字段，按任务*难度*来定——不是按主线恰好跑在哪个模型上：

- **机械 / 可机械检查**（跑测试套件、grep 定位、批量格式化、改变量名）→ **Haiku**。无需推理。
- **常规实现** → **Sonnet**。主力 workhorse。
- **难实现 / correctness-critical / 临界路径**（agentic 实现、临界路径上难实现的活、复杂并发 bug 的根因）→ **Opus**；**常规 review**（日常代码审查，够重要不该降到 Sonnet）也走 **Opus**。
- **高杠杆判断与裁决**（verdict-bearing：决定「对不对 / 选哪个」的节点——独立 review / 二审、端点验收、决策咨询、架构仲裁 / 方案选型）→ **Fable**；最难的开放推理 / 创意 → 同样 **Fable**。一次错判下游成本极大、且这些节点低并发，值最强档。

> **关键区分**：判断 / 审查 / 咨询 / 裁决（决定「对不对 / 选哪个」的 verdict 节点）= **Fable**；做出那个被选定的难架构 / 复杂实现 = **Opus**——二者别混。常规 review 走 Opus；高杠杆的独立 review / 二审 / 端点验收走 Fable。

强档集中到临界链上（镜头 2）；高 float 的机械活配便宜档、让它在空隙里跑（`decomposition.md` 的"资源决策"）。它在 workflow 一侧的对应物——随着某个 stage 变难、*在脚本内部*升级模型档位——是 SKILL B examples 里的 `staged-escalation.js`（`agent({model})`）；那里模型字面量是 resume cache key 的一部分，所以务必保持它是字面量。

## 为何主线固定一个模型

省钱靠给 leaf 配便宜模型，**不靠中途切主线模型**。在 session 中途切主对话的模型，从三方面看都是假节省：

- **它扔掉整个 prompt cache。** KV cache 跨模型不可互换——一旦切换，整段缓存好的前缀都会在下一回合当作全新输入重新计费。
- **在这里更是双重昂贵。** cc-master 的 `SessionStart` hook 在每次 compaction 后重注*整篇* SKILL A 文本——一大段稳定、可缓存的前缀。切模型恰好把那份 cache 作废。
- **它危及 board 连续性。** 一次模型切换可能正好骑在一次 compaction / session 边界上，而 `owner.session_id` 是 board 的连续性锚点（见 `board.md`）。

官方 Claude Code 的指导也是一样：把主对话固定在一个模型上；那些能跑在更便宜模型上的边角任务，交给一个 *subagent*。lever 是**每叶子的模型选择**——不是主线上的 `/model`。

## 感知 5h/7d 配额窗口

一个 Pro/Max 订阅按一个 **5 小时滚动窗口**和一个 **7 天窗口**计量用量。对一个 >24h 的目标，真正构成容量约束的是这两个窗口、而非 context%（镜头 5）。

> **口径优先级（Finding #37 血泪）：账户权威 > 本地反推。** 账户真实的 `used_percentage`（5h/7d）+ `resets_at`（reset 时刻）是**权威**，但官方核实它**只**出现在 status-line 脚本的 stdin 里——所有 hook 的 stdin、transcript JSONL、任何 `claude` CLI 子命令、API `anthropic-ratelimit-*` headers（那是 API tier 的 RPM/ITPM，与订阅 5h/7d 滚动窗口口径不同）**全都拿不到它**。本地 JSONL 只能**反推** 5h 窗口，而反推把窗口起点钉在「最近一段连续活动的首条消息」，看不见服务端真实计费窗口的 reset 事件——**reset 倒计时可失真到数量级**（实测反推「剩 21min」vs 账户权威「剩 2h55m」，差 2h40m）。所以：能拿到账户口径就**绝不**信反推。

读取方式，按口径可信度排：

1. **账户权威（首选）—— `statusline-capture.js` → sidecar → `cc-usage.sh`。** 把 `${CLAUDE_SKILL_DIR}/scripts/statusline-capture.js` 接进你的 status line（见下「接法」），它在 status-line 被调用时把 `rate_limits.{five_hour,seven_day}.{used_percentage,resets_at}` 落到 sidecar。然后 `${CLAUDE_SKILL_DIR}/scripts/cc-usage.sh` 读 sidecar，吐 `source:"account"` + 权威 `used_percentage` + 从 `resets_at` 算的 `window_remaining_min`。**这是唯一不失真的 reset 倒计时来源。**
2. **本地反推（fallback）—— `cc-usage.sh` 无 sidecar 时。** 系统 python3 解析本地 `~/.claude/projects/**/*.jsonl`（零网络 / 零依赖，ship-anywhere；**不是 hook**，像 `codex-review.sh` 一样在 pacing 决策点跑在主线上），吐 `source:"local-derived-approx"` + `five_hour{used_tokens, window_remaining_min, burn_rate_per_min}` + `seven_day{used_tokens}`。**reset 倒计时是反推、可能严重失真**——只在账户口径不可用（headless / 未接 status-line / 非 Pro-Max / API-key）时用，且当 approx 看。
3. **`npx ccusage blocks --json`** —— 社区工具，自带官方 burn rate；手头有就直接跑。但它也是解析 JSONL 的反推，给不了账户 `used_percentage`（那只在 status-line）。

**接法（把 capture 接进 status line，不覆盖你已有的）：** 在 `settings.json` 把 `statusLine.command` 设为 `<脚本路径> --passthrough '<你原本的 status line 命令>'`——它捕获 sidecar 后把 stdin 透传给你原本的命令、原样输出（你的状态行不变）；没接也能用，`cc-usage.sh` 自动降级反推。⚠️ **脚本路径写法（Finding #39）**：`${CLAUDE_PLUGIN_ROOT}` / `${CLAUDE_SKILL_DIR}` 在 `statusLine.command` 的展开**官方未文档化**（hooks.json 的 command 字段明确支持，但 statusLine.command 未说明；且 statusLine 是 user-scoped、不绑特定 plugin，该变量很可能无定义）→ **保守用绝对路径**：dev / `--plugin-dir` 指向 `<repo>/skills/orchestrating-to-completion/scripts/statusline-capture.js`，安装场景指向 `~/.claude/plugins/cache/<marketplace>/cc-master/<version>/skills/orchestrating-to-completion/scripts/statusline-capture.js`。想用变量的，**自行实证一次**：设上去渲染一次，看 `~/.claude/.cc-master-rate-limits.json` 有没有落盘——落了＝展开了。⚠️ status-line 在 idle 时安静——长等后台时配 `refreshInterval` 保持 sidecar 新鲜（`resets_at` 是绝对时刻，即使 sidecar 略旧倒计时仍准，除非已跨 reset）。

**撞墙预测。** 账户口径下直接看 `used_percentage`：任一窗口逼近上限（默认阈值 ≥85%）就 pace；**7d 尤其要看**（它窗口长、最容易在不知不觉中逼顶——`usage-pacing.js` 现在也对 7d 出声）。反推 fallback 下退用 `used_tokens + burn_rate_per_min × window_remaining_min` 对比 plan ceiling，但记得 ceiling 是社区反推、window 也可能失真，结论当 approx。

诚实交代 scope：账户 `used_percentage` 仅 Pro/Max 交互式可见；API-key 用户没有滚动窗口、headless 拿不到 status-line——这些一律落到反推 fallback、按累计 token 消耗来 pace。

## Pacing levers

当 burn-rate 的墙迫近时，**节流而不停**——机械活仍能推进；全停是白白浪费可用配额（镜头 4），顶满则会半截撞墙停摆（镜头 5）。四个 lever，大致按顺序：

1. **降级模型** —— 首要 lever；把 token 重的叶子路由到更便宜的档位（`agent({model})` 或一个更便宜的 sub-agent）。这正是 tiering 与 pacing 咬合之处：**降级模型*本身*就是一个 pacing 动作。**（effort 在这里*不是* lever——派发 API 不把它往下穿透；见上面 §模型档位。）
2. **降 WIP** —— 让更少的并发叶子在飞（Little's Law；`dispatch.md` 的 admission control）。
3. **推迟高 float 工作** —— 把非临界、token 重的叶子推到下一个窗口；在 board 上记为 `blocked_on: "quota-reset"`，等窗口刷新时它们重新触发（这是一个被推迟的决策，由 step-6 ledger 兜住可续性）。

目标是窗口利用率 ~75%、而非 100%——留出余量，免得一个晚到的临界任务被饿死（镜头 5）。
