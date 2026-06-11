# Cost & pacing —— 模型档位与 usage-aware 节流

> **服务愿景：C2**（节流 token 消耗）**· C6**（按难度选模型档位）。**何时读：** 给每个节点选模型档位 + 想清楚为何主线固定一个模型（prompt-cache）；把一场长跑对照 5h/7d 配额窗口来 pace——靠 `scripts/cc-usage.sh` 感知，levers：降级模型 / 降 WIP / 推迟 float。

> **它是什么——以及它*不是*什么。** 这里装的是编排者默认会缺的那块 reference 知识：四个模型档位及其相对成本、为何主线固定一个模型、以及怎么把一场 long-horizon 跑对照 5h/7d 配额窗口来 pace。它是**informational，不是红线。** Subagent pressure baseline（model-tiering ×6、usage-pacing ×2，零失败）表明 agent 已经能从镜头 2（把资源集中到临界链）和镜头 5（在容量内干活）*推导*出正确的 tiering / pacing。它们真正缺的只是下面这几条具体事实——档位定位 + 成本、切主线模型的 cache 代价、以及配额窗口的信号来源。所以把它们嵌进 `decomposition.md` 的每节点契约里就够；**别**把它们升格成一条独立纪律、更别为它们加红线（baseline 证明一条都不需要——§6 TDD-for-skills 的 Iron Law 禁止编造一条 agent 根本不会违背的规则）。

## TOC
- [模型档位](#模型档位)
- [每节点模型选择](#每节点模型选择)
- [为何主线固定一个模型](#为何主线固定一个模型)
- [感知 5h/7d 配额窗口](#感知-5h7d-配额窗口)
- [Pacing levers](#pacing-levers)

---

## 模型档位

| Tier | Model ID | $/1M in·out | Relative output cost | Use for |
|---|---|---|---|---|
| Fable 5 | `claude-fable-5` | $10 · $50 | **10×** | 最难的开放推理 / 创意 / 叙事 |
| Opus 4.8 | `claude-opus-4-8` | $5 · $25 | **5×** | 旗舰推理 · agentic · 临界路径难活 · 端点验收 |
| Sonnet 4.6 | `claude-sonnet-4-6` | $3 · $15 | **3×** | 平衡主力:常规实现 / review |
| Haiku 4.5 | `claude-haiku-4-5` | $1 · $5 | **1×** | 快 & 便宜:机械活(跑测试 / grep / 格式化 / 改名),200K context |

编排的花销由输出主导（agent 吐的远多于它读的），所以真正该拿来 pace 的数字是 **relative output multiplier**——Haiku 1× / Sonnet 3× / Opus 5× / Fable 10×：一个 Opus 叶子 ≈ 五个 Haiku 叶子，一个 Fable 叶子 ≈ 十个。

补一句 `effort`（`output_config: {effort: …}`）的事：它确实是一个 **API-layer** 的 token 旋钮，你的*主 session* 也遵循自己的 `effortLevel`。但 cc-master 的派发 API **不**把它往下穿透——workflow 的 `agent()` 只接受 label/phase/schema/model/isolation/agentType，Agent sub-agent 同样没有 effort 旋钮。所以你对*叶子*成本真正握得住的 lever 是它的**模型档位**，不是 effort——别给 `agent()` 传一个杜撰的 `effort` option（SKILL B 禁止杜撰 option）。

## 每节点模型选择

给 `decomposition.md` 的每节点契约加一个 **model** 字段，按任务*难度*来定——不是按主线恰好跑在哪个模型上：

- **机械 / 可机械检查**（跑测试套件、grep 定位、批量格式化、改变量名）→ **Haiku**。无需推理。
- **常规实现 / review** → **Sonnet**。主力 workhorse。
- **难 / correctness-critical / 临界路径**（架构选型、复杂并发 bug 的根因、端点验收一段关键 diff）→
  **Opus**；最难的开放推理 / 创意 → **Fable**。

强档集中到临界链上（镜头 2）；高 float 的机械活配便宜档、让它在空隙里跑（`decomposition.md` 的"资源决策"）。它在 workflow 一侧的对应物——随着某个 stage 变难、*在脚本内部*升级模型档位——是 SKILL B examples 里的 `staged-escalation.js`（`agent({model})`）；那里模型字面量是 resume cache key 的一部分，所以务必保持它是字面量。

## 为何主线固定一个模型

省钱靠给 leaf 配便宜模型，**不靠中途切主线模型**。在 session 中途切主对话的模型，从三方面看都是假节省：

- **它扔掉整个 prompt cache。** KV cache 跨模型不可互换——一旦切换，整段缓存好的前缀都会在下一回合当作全新输入重新计费。
- **在这里更是双重昂贵。** cc-master 的 `SessionStart` hook 在每次 compaction 后重注*整篇* SKILL A 文本——一大段稳定、可缓存的前缀。切模型恰好把那份 cache 作废。
- **它危及 board 连续性。** 一次模型切换可能正好骑在一次 compaction / session 边界上，而 `owner.session_id` 是 board 的连续性锚点（见 `board.md`）。

官方 Claude Code 的指导也是一样：把主对话固定在一个模型上；那些能跑在更便宜模型上的边角任务，交给一个 *subagent*。lever 是**每叶子的模型选择**——不是主线上的 `/model`。

## 感知 5h/7d 配额窗口

一个 Pro/Max 订阅按一个 **5 小时滚动窗口**和一个 **7 天窗口**计量用量。对一个 >24h 的目标，真正构成容量约束的是这两个窗口、而非 context%（镜头 5）。读它们有三种方式，按 ship-anywhere 优先级排：

1. **`scripts/cc-usage.sh`** —— 本仓 ship 的带外信号来源（系统 python3 解析本地 `~/.claude/projects/**/*.jsonl`，零网络 / 零依赖；**不是 hook**，像 `codex-review.sh` 一样在 pacing 决策点跑在主线上）。吐出 `five_hour{used_tokens, window_remaining_min, burn_rate_per_min}` + `seven_day{used_tokens}`。
2. **`npx ccusage blocks --json`** —— 社区工具，更准、自带一个官方 burn rate；手头有它就直接跑。（`cc-usage.sh` 刻意**不**去 shell out 调它——ccusage 的原始 schema 与我们的不同，而 `cc-usage.sh` 始终吐上面那个归一化 schema；将来若要接它，得先把 ccusage 映射进这个 schema。）
3. **Status-line stdin** `rate_limits.{five_hour,seven_day}.used_percentage` —— 仅 Pro/Max，**只能**从一个 status-line 脚本拿到（JSONL 里没有）。所以 `cc-usage.sh` *不*吐 context% / `used_percentage`——那一项是 status-line 专属。

**Burn-rate 撞墙预测。** 当前窗口熬得过下一批吗？拿 `used_tokens + burn_rate_per_min × window_remaining_min` 对比你的 plan ceiling。如果它在 `window_remaining_min` 走完之前就越过 ceiling，你会半途撞墙——现在就 pace。

诚实交代 scope：5h/7d 是*订阅*概念；确切的 plan ceiling 官方没有公布（社区是反推出来的），所以 `cc-usage.sh` 只吐绝对的 `used_tokens` + burn rate，把 %-of-plan 的换算留给调用者。API-key 用户没有滚动窗口——他们改按累计 token 消耗来 pace。

## Pacing levers

当 burn-rate 的墙迫近时，**节流而不停**——机械活仍能推进；全停是白白浪费可用配额（镜头 4），顶满则会半截撞墙停摆（镜头 5）。四个 lever，大致按顺序：

1. **降级模型** —— 首要 lever；把 token 重的叶子路由到更便宜的档位（`agent({model})` 或一个更便宜的 sub-agent）。这正是 tiering 与 pacing 咬合之处：**降级模型*本身*就是一个 pacing 动作。**（effort 在这里*不是* lever——派发 API 不把它往下穿透；见上面 §模型档位。）
2. **降 WIP** —— 让更少的并发叶子在飞（Little's Law；`dispatch.md` 的 admission control）。
3. **推迟高 float 工作** —— 把非临界、token 重的叶子推到下一个窗口；在 board 上记为 `blocked_on: "quota-reset"`，等窗口刷新时它们重新触发（这是一个被推迟的决策，由 step-6 ledger 兜住可续性）。

目标是窗口利用率 ~75%、而非 100%——留出余量，免得一个晚到的临界任务被饿死（镜头 5）。
