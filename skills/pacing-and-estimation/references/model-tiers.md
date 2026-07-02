# 模型档位 —— 四档相对成本 + 按难度选档 + 为何主线不切

> **何时读：** 给每个节点选模型档位、纠结升档还是降档、或想清楚为何主线固定一个模型（prompt-cache）时。这里装的是**事实映射**（哪四档、相对成本、按难度落点）——「把强档集中到临界链上」的**判断**归 `master-orchestrator-guide`「目标即依赖图」镜头，本文不复述决策。

## 模型档位

> **易 stale 警告（SSOT 不在本表）。** 下表的具体 **model ID**、绝对 **$/1M 价格**、乃至档位构成都会随时间变动——本表快照**截至 2026-06**。**当前真值的单一真相源是 Anthropic API 官方文档（platform.claude.com 的 models / pricing 页），或本仓 `claude-api` skill**（内嵌带 cache 日期的现价/现 ID 表）；选档要核对绝对数字时去那里，别信本表字面。本表的**教学价值不在绝对美元数，而在下面那行相对 multiplier 的心智模型**——那部分稳定，绝对价格不稳定。

| Tier | Model ID | $/1M in·out | Relative output cost | Use for |
|---|---|---|---|---|
| Fable 5 | `claude-fable-5` | $10 · $50 | **10×** | 高杠杆判断与裁决(verdict-bearing):独立 review / 二审 · 端点验收 · 决策咨询 · 架构仲裁 / 方案选型 · 最难的开放推理 / 创意 / 叙事 |
| Opus 4.8 | `claude-opus-4-8` | $5 · $25 | **5×** | 旗舰执行推理:agentic 实现 · 临界路径难实现活 · 复杂并发 bug 根因 · 常规 review |
| Sonnet 4.6 | `claude-sonnet-4-6` | $3 · $15 | **3×** | 平衡主力:常规实现 |
| Haiku 4.5 | `claude-haiku-4-5` | $1 · $5 | **1×** | 快 & 便宜:机械活(跑测试 / grep / 格式化 / 改名),200K context |

> **⚠️ 运行时可用性补充（2026-06，临时框——Fable 5 恢复即删本框、上表与下文不动）。** 当前账户层 **Claude Fable 5 不可用**：点名调用会被挡回 *"Claude Fable 5 is currently unavailable. Please use Opus 4.8 or another available model."* 在它恢复前，本文**每一处指派给 Fable 的节点——高杠杆判断与裁决（独立 review / 二审 · 端点验收 · 决策咨询 · 架构仲裁 / 方案选型）、最难的开放推理 / 创意 / 叙事——一律回退到次强档 Opus 4.8（`claude-opus-4-8`）。** 上表 Fable 行与下文每处 Fable 指派**一律保留不删**（它们记录的是「档位本应如何」这套稳定心智模型，可用性是一时的运行时约束、非档位重排）；只把落点临时从 Fable 改投 Opus。副作用：回退期 Opus 同时背「难实现」与「裁决」两副身份，下面那条「Fable 裁决 vs Opus 实现」的关键区分在*档位落点*上暂时合一——**但判断标准本身不变**，只是这两类活暂用同一档执行。Fable 恢复后照上表 / 下文原指派切回即可。

（绝对美元为截至 2026-06 的快照；现价以 API 官方文档 / `claude-api` skill 为准——见上方警告。）编排的花销由输出主导（agent 吐的远多于它读的），所以真正该拿来 pace 的数字是 **relative output multiplier**——Haiku 1× / Sonnet 3× / Opus 5× / Fable 10×：一个 Opus 叶子 ≈ 五个 Haiku 叶子，一个 Fable 叶子 ≈ 十个。这组**相对关系**（强档 ≈ 弱档的 N×）是这段真正稳定、可长期依赖的心智模型；档位重排或绝对单价变动时，更新上表数字即可，这组 multiplier 思路照旧。

补一句 `effort`（`output_config: {effort: …}`）的事：它确实是一个 **API-layer** 的 token 旋钮，你的*主 session* 也遵循自己的 `effortLevel`。但 cc-master 的派发 API **不**把它往下穿透——workflow 的 `agent()` 只接受 label/phase/schema/model/isolation/agentType，Agent sub-agent 同样没有 effort 旋钮。所以你对*叶子*成本真正握得住的 lever 是它的**模型档位**，不是 effort——别给 `agent()` 传一个杜撰的 `effort` option（`authoring-workflows` 禁止杜撰 option）。

## 每节点模型选择（按难度选档的事实映射）

给每节点契约一个 **model** 字段，按任务*难度*来定——不是按主线恰好跑在哪个模型上。这是**事实映射**；把强档集中到临界链、float 配便宜档的**调度判断**在 `master-orchestrator-guide`「目标即依赖图」镜头 + 其 `references/decomposition.md` 的「资源决策」：

- **机械 / 可机械检查**（跑测试套件、grep 定位、批量格式化、改变量名）→ **Haiku**。无需推理。
- **常规实现** → **Sonnet**。主力 workhorse。
- **难实现 / correctness-critical / 临界路径**（agentic 实现、临界路径上难实现的活、复杂并发 bug 的根因）→ **Opus**；**常规 review**（日常代码审查，够重要不该降到 Sonnet）也走 **Opus**。
- **高杠杆判断与裁决**（verdict-bearing：决定「对不对 / 选哪个」的节点——独立 review / 二审、端点验收、决策咨询、架构仲裁 / 方案选型）→ **Fable**；最难的开放推理 / 创意 → 同样 **Fable**。一次错判下游成本极大、且这些节点低并发，值最强档。（⚠️ **Fable 当前不可用 → 这些节点回退 Opus 4.8**，见上「运行时可用性补充」。）

> **关键区分**：判断 / 审查 / 咨询 / 裁决（决定「对不对 / 选哪个」的 verdict 节点）= **Fable**；做出那个被选定的难架构 / 复杂实现 = **Opus**——二者别混。常规 review 走 Opus；高杠杆的独立 review / 二审 / 端点验收走 Fable。（**Fable 不可用期**：这些 Fable 落点临时回退 Opus 4.8。判断标准照旧，只是档位落点暂与 Opus 合并；此时靠任务身份本身、而非档位差异来区分裁决 vs 实现。）

它在 workflow 一侧的对应物——随着某个 stage 变难、*在脚本内部*升级模型档位——是 `authoring-workflows` examples 里的 `staged-escalation.js`（`agent({model})`）；那里模型字面量是 resume cache key 的一部分，所以务必保持它是字面量。

## 为何主线固定一个模型

省钱靠给 leaf 配便宜模型，**不靠中途切主线模型**。在 session 中途切主对话的模型，从三方面看都是假节省：

- **它扔掉整个 prompt cache。** KV cache 跨模型不可互换——一旦切换，整段缓存好的前缀都会在下一回合当作全新输入重新计费。
- **在这里更是双重昂贵。** cc-master 在每次 compaction 后会自动重注*整篇*常驻编排手册文本——一大段稳定、可缓存的前缀。切模型恰好把那份 cache 作废。
- **它危及 board 连续性。** 一次模型切换可能正好骑在一次 compaction / session 边界上，而 `owner.session_id` 是 board 的连续性锚点。

官方 Claude Code 的指导也是一样：把主对话固定在一个模型上；那些能跑在更便宜模型上的边角任务，交给一个 *subagent*。lever 是**每叶子的模型选择**——不是主线上的 `/model`。

> **watchdog 间隔的 cache-warmth（一句指针）**：等待前 arm 一个 watchdog 时，唤醒间隔也吃这份 prompt-cache 心智——短间隔（<270s）保温、长间隔（≥1200s）当长等处理；间隔 ≈ 最长 `in_flight` 的 p95 + 余量，别短到把主线 cache 频繁失效又没活可干。完整降级链 + 间隔取法在 `master-orchestrator-guide` 的 `references/dispatch.md` §watchdog/liveness，此处不复述。
