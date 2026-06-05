# 报告 2：Claude Code Dynamic Workflows 的社区 skills / plugins / 工具生态

**日期**：2026-06-05
**定位**：四份报告中的"业界实践"层。报告 1 从机制层诊断出"主线程不空等"是机制留下的空白；本报告调查社区实际造了哪些轮子、收敛出哪些范式，并**实证回答**：这个空白在生态里有没有人填——结论是**没有，它是一个明确的生态空白**。
**可信度分级**：**official**（Anthropic 官方）/ **community-high**（高质量第三方，作者/库可考、与官方一致）/ **community-low**（二手转述、SEO 站）/ **speculative**（推测或单一未证实来源）。

---

## 0. 机制基线的两处补充/纠正

官方 docs（[code.claude.com/docs/en/workflows](https://code.claude.com/docs/en/workflows)，**official**）补充了两个对本研究关键、且**纠正了报告 1 既有基线**的事实：

- **触发词在 v2.1.160 变了**：报告 1 §2 写的"prompt 含 `workflow` 一词"是 **v2.1.160 之前**的字面触发词；v2.1.160 起字面触发词改成 **`ultracode`**，但自然语言（"use a workflow" / "run a workflow"）两个版本都生效。这与本 agent 当前 `Workflow` 工具契约里"keyword `ultracode`"的表述一致——即报告 1 的"workflow 一词"应理解为旧版触发词。
- **`/effort ultracode`** = `xhigh` reasoning effort + 自动 workflow 编排；开启后 Claude 自行决定每个 task 要不要起 workflow，**单个请求可串成多个 workflow**（一个理解代码、一个改、一个验）。仅当前 session 有效，新 session 重置。
- **subagent 权限**（易踩的控制边界）：workflow 派生的 subagent **永远跑在 `acceptEdits` 模式**，继承 tool allowlist，file edits auto-approve，与你 session 的 permission mode 无关。
- 关闭开关：`/config` toggle、`disableWorkflows: true`、`CLAUDE_CODE_DISABLE_WORKFLOWS=1`。

---

## 1. Workflow 撰写类 skills / plugins

### 1.1 `ray-amjad/claude-code-workflow-creator` —— 生态的事实标准 authoring skill

来源：[github.com/ray-amjad/claude-code-workflow-creator](https://github.com/ray-amjad/claude-code-workflow-creator)，**community-high**（作者 Ray Amjad，AI coding workflow 领域知名 YouTuber；内容与官方 API 高度一致，且早于官方文档公开）。

**定位**：一个 Claude Code skill，教 Claude 撰写 workflow tool 脚本。作者把它定位为"Anthropic 未发布/未公告 feature 的 preview"——脚本里写它"ships inside the Claude Code binary but stays hidden behind an environment variable"（`CLAUDE_CODE_WORKFLOWS=1`），发布时间早于官方 research preview。安装：clone 进全局 skills 目录，下次启动后说"create a workflow"即触发。

**文件结构与内容**（逐个考证）：

| 文件 | 内容 |
|---|---|
| `SKILL.md` | Claude 设计/撰写 workflow 的 procedure |
| `references/api-reference.md` | 完整 API 手册（globals / options / caps / constants） |
| `references/patterns.md` | 9 个可复制粘贴的编排范式（本报告 §a 主要来源） |
| `scripts/validate-workflow.mjs` | linter，按 parser hard rules 校验 |
| `assets/templates/` | fan-out / pipeline / loop 三种 starter 模板 |
| `assets/examples/` | 6 个完整可跑示例 + technique mapping |

**`references/api-reference.md` 关键 API**（community-high，比官方 docs 更细）：

- `agent(prompt, opts?) → Promise<string|object>`；`opts`：`label`、`phase`、`schema`、`model`（`'haiku'|'sonnet'|'opus'|'inherit'|<full id>`）、`isolation: 'worktree'`、`agentType`、`stallMs`（默认 180000）。
- **cache key 构成**：`schema`/`model`/`isolation`/`agentType` 变更会 invalidate 缓存；`label`/`phase` 不会。这是 resume 正确性的底层契约。
- `pipeline(items, ...stages)` / `parallel(thunks)` / `phase(title)` / `log(message)` / `workflow(nameOrRef, args?)`。
- `budget = { total, spent(), remaining() }`；`console.log/error` 路由进 journal；`setTimeout/clearTimeout` 是 abort-aware 的，**没有 `sleep()`**。
- 系统限值：script ≤ 512 KB；同步执行 30 s 上限（防 infinite sync loop）；per-agent stall 180 s，**retry 至多 5×** 后 abandon；`WorkflowBudgetExceededError`。
- determinism sandbox 禁：`Math.random()`（改用 by-index 变 prompt）、`Date.now()`（改用 args 传时间戳）、无参 `new Date()`；**无 filesystem / Node API（`require`/`fs`/`process`）/ 网络访问**——这些只能进 `agent()` 里。

> **与报告 1 对账的注意点**：该 skill 称 `args` "序列化成 string，需自己 `JSON.parse`"——这与本 agent 当前工具契约"传 actual JSON values"不一致。报告 1 §3.6 已判定这是 pre-GA→GA 的漂移；ray-amjad 探测的是 pre-GA 二进制，**当前 GA build 以工具契约为准**。

**`scripts/validate-workflow.mjs` linter 规则**（逐条考证，community-high）：
1. script ≤ 524288 bytes
2. 必须有 `export const meta = {…}`
3. **meta 必须是第一条语句**（前面不能有任何代码）
4. meta 必须有 `name`
5. meta 必须有 `description`
6. **meta 必须是 pure literal**：禁 spread `...`、禁模板字符串（backtick）、禁函数调用
7. meta 禁用 reserved keys：`__proto__`/`constructor`/`prototype`
8. 禁 `Date.now()` / `Math.random()` / 无参 `new Date()`
9. **warning**（非 error）：`require()` / `import … from …` / `process.*`
10. **warning**：`parallel([...])` 里裸 `agent()` 应包成 thunk `() => agent(...)`（否则被立刻 eager 求值、失去并行语义——最常见的初学者 bug）

### 1.2 官方未公布独立 authoring skill

官方把 authoring 能力**内建进 binary**：`/effort ultracode` 或自然语言请求即让 Claude 直接写 + validate + run workflow（无需第三方 skill）。ray-amjad skill 的价值在于：把官方未文档化的 hard rules 显式 codify 成 linter + 给 Claude 一套 pattern library，在官方 docs 公开前是唯一权威参考。

---

## 2. Plugin marketplaces & 相关条目

| 名称 / URL | 是什么 | 与 dynamic workflows 关系 | 可信度 |
|---|---|---|---|
| 官方 docs 内建 `/deep-research` | 唯一 bundled workflow | **直接基于** workflow runtime；是范式 reference impl（见 §4） | official |
| [claudemarketplaces.com](https://claudemarketplaces.com/) | 社区目录，GitHub 日更 | 聚合站，可检索 workflow/orchestration 条目 | community-low |
| [rohitg00/awesome-claude-code-toolkit](https://github.com/rohitg00/awesome-claude-code-toolkit) | 号称 135 agents / 176+ plugins | 聚合；多为 **subagent/skill 时代**产物，非 workflow-runtime native | community-low |
| [wshobson/agents](https://github.com/wshobson/agents) | multi-harness marketplace（84 plugins/192 agents） | subagent/skill building blocks，**非** workflow-runtime | community-high |
| [davila7/claude-code-templates](https://github.com/davila7/claude-code-templates) | CLI 配置工具 + `workflow-automation` skill | 其 workflow-automation skill 讲的是 **n8n/Temporal/Inngest** 外部编排，**不是** CC dynamic workflow——同名不同物，易混淆 | community-high |
| [jqueryscript/awesome-claude-code](https://github.com/jqueryscript/awesome-claude-code) 等经典 awesome list | — | slash command / subagent / hook 为主 | community-low |

**关键发现**：截至本研究，marketplace 上**几乎没有真正"基于 workflow runtime"的第三方 plugin**。绝大多数"workflow/orchestration"条目是 **pre-workflow 时代**的 subagent/hook 编排框架（见 §3.2）。**生态还没追上 runtime。**

---

## 3. 并行 agent 编排类 skills

### 3.1 `obra/superpowers`（用户已全局安装）

来源：[github.com/obra/superpowers](https://github.com/obra/superpowers)，**community-high**。

- **`dispatching-parallel-agents`**（[SKILL.md](https://github.com/obra/superpowers/blob/main/skills/dispatching-parallel-agents/SKILL.md)）：decision framework——多个独立失败 → 每个问题域一个 agent；相关 → 串行一起查；有 shared state → 不能并行。核心是 **context-isolation principle**：agent"should never inherit your session's context or history — you construct exactly what they need"。
- **与本研究最相关的一句**：该 skill **显式论述了主线程不空转**——"This **also preserves your own context for coordination work**"。即：把脏活外包给隔离 agent，主 agent 的 context 留给 coordination/integration/oversight。这是生态里**少有的、直接讲"主 agent 在 dispatch 期间该干嘛"的论述**（虽然它是 subagent 模型，不是 workflow runtime）。
- **`subagent-driven-development`**：按 plan 逐 task 派 fresh subagent，每 task 后两段 review（先 spec compliance、再 code quality）。
- **重要架构现状**（superpowers [Issue #469](https://github.com/obra/superpowers/issues/469)）：这三个执行 skill 目前用的是 **sequential subagent dispatch**（一次一个，main agent 当 controller），**不是真并行**；Issue #469 正讨论迁到 CC 的 agent teams 做真并行。**注意：它们都不基于、也不提及 dynamic workflow runtime**——是平行、独立演进的编排路线。

### 3.2 第三方 orchestrator plugins（subagent/hook 模型，非 runtime）

| 名称 | 机制 | 成熟度 | 与 runtime 关系 |
|---|---|---|---|
| [barkain/claude-code-workflow-orchestration](https://github.com/barkain/claude-code-workflow-orchestration) | hook-based，plan mode 集成；decompose→依赖分析→sequential/parallel wave；8 个领域 agent；**soft enforcement**（silent→hint→warning→strong reminder 逐级 nudge 主 agent 别亲自上手） | 65★ | **独立 wrapper**，基于 hook + plan mode，**非** runtime |
| [shinpr/claude-code-workflows](https://github.com/shinpr/claude-code-workflows) | 专精 SWE 端到端；`/recipe-implement` `/recipe-design`；complexity-based routing；layered verification；ephemeral state 进 `docs/plans/` 不进 git | 420★ | **明确不基于** runtime，是自洽 subagent pipeline |
| claude_code_agent_farm | 多个并行 CC session 系统性改进 codebase | — | 多 session，非 runtime |

**判断**：这一层全是**官方 runtime 出现之前为了凑同样效果手搓的脚手架**。barkain 的 `soft enforcement`（逐级 nudge 主 agent 别亲自干活、强制委派）和 OMNE 项目里 `dev-master-orchestrator` 的"master 不亲自上手"红线高度同构——是同一类问题的不同解法。

---

## 4. 官方捆绑

### `/deep-research`（official，唯一 bundled workflow）

- 机制：把问题拆成 ~5 个 angle → 并行 web search → fetch & cross-check sources → **对每个 claim 投票** → 综合出带引用的报告，**未通过 cross-check 的 claim 被滤掉**。需 WebSearch tool。
- 实测数字（[buildtolaunch](https://buildtolaunch.substack.com/p/claude-code-dynamic-workflows-guide)，**community-high**，部分 paywall）：一次 run 跑 **101 个 agent / 13 分钟 / 723 次 search+read**；其中 **75 个 agent 专做 fact-check**（每个试图证伪）；18 个 claim 存活、7 个被淘汰。这是 §a"adversarial-verify"范式的官方 reference impl。
- 它**就是范式样板**：fan-out + 多 angle + adversarial verify + vote + synthesize 的组合，被社区反复引用为"该怎么写一个好 workflow"的模板。

> 注：本次任务的 3 个研究 agent + 主线程综合，本质上就是 `/deep-research` 范式的手动版——fan-out 多 angle 检索、各自返回带引用 dossier、主线程综合。

### `/effort ultracode`（official）

= `xhigh` effort + 自动编排。单请求可串多 workflow（理解→改→验）。仅当前 session，新 session 重置。

---

## 5. 校验器 / linter / 模板 / IDE 集成

- **linter**：ray-amjad 的 `validate-workflow.mjs`（§1.1，10 条规则）——生态唯一公开的 workflow linter。
- **模板/脚手架**：ray-amjad 的 `assets/templates/`（fan-out / pipeline / loop）+ 6 个 examples。
- **IDE 集成**：[Claude Code Workflow Studio](https://marketplace.visualstudio.com/items?itemName=breaking-brake.cc-wf-studio)（VS Code，**community-low/speculative**）——可视化 drag-drop canvas 设计 multi-agent orchestration，export 成 `.md`。**7838 installs 但 0 ratings**。**重要警示**：它 export 的是 markdown agent 配置/slash command，**不是 dynamic workflow JS 脚本**——是泛 multi-agent 可视化编辑器，跟 workflow runtime 没有直接绑定。**当前没有专为 dynamic-workflow JS 脚本做的可视化 IDE 工具。**

---

## 6. 范式库与最佳实践指南（社区文章沉淀）

| 来源 | 沉淀的范式库 | 可信度 |
|---|---|---|
| [claudefa.st](https://claudefa.st/blog/guide/development/dynamic-workflows) | **6 个 composable patterns**：Classify-and-Act、Fan-out-and-Synthesize、Adversarial Verification、Generate-and-Filter、Tournament(**pairwise** judge)、Loop-Until-Done | community-high |
| [官方 blog "A harness for every task"](https://claude.com/blog/a-harness-for-every-task-dynamic-workflows-in-claude-code) | 同 6 个 | official |
| [alexop.dev](https://alexop.dev/posts/claude-code-workflows-deterministic-orchestration/) | 8 个更细的：Fan-out→Reduce→Synthesize、Pipeline(streaming)、Parallel(barrier)、Adversarial Verify、**Perspective-Diverse Verify**（每个 verifier 不同 lens）、Judge Panel、**Loop-Until-Dry**（K 连续 round 无新 item 才停，dedup against *seen* 不只 confirmed） | community-high |
| [ray-amjad patterns.md](https://github.com/ray-amjad/claude-code-workflow-creator) | 9 个 canonical | community-high |
| [Ken Huang substack](https://kenhuangus.substack.com/p/claude-code-orchestration-dynamic) | 三执行模型对比（Dynamic Workflows / Subagents / Agent Teams）+ 选型决策树 | community-high |

**最佳实践共识**（跨来源）：
1. **Default to `pipeline()`**，只在 stage 真需要全部前序结果（dedup/merge/early-exit-on-count）时才用 `parallel()` barrier——避免 barrier 制造 idle。
2. 任何下游会读的字段一律用 `schema`（structured output），别 free-text JSON；stage 间用 `JSON.stringify` 传。
3. `budget.total && budget.remaining()` 的 `total &&` guard 必须有，否则无 target 时 `remaining()` 是 `Infinity`。
4. pairwise judge（"A 比 B 好吗"）远比让 agent 自评 1-10 可靠。
5. 大 run 前先在小 slice 上跑探成本；routine stage 路由 haiku/sonnet 省钱。
6. **honest test**（claudefa.st）："does this task really need more compute? Most traditional coding tasks do not need a panel of five reviewers"——两行 bug fix 别用 workflow。

---

## 7. 批评与局限

**主要来源**：[HN thread #48311705](https://news.ycombinator.com/item?id=48311705)（**community-high**，信号密集），官方/community 文章的 candid 段落。

1. **Token 成本 / "tokenmaxxing"**：官方反复 candid 承认"consume meaningfully/substantially more tokens"。HN 上有人 **18 分钟跑爆 5 小时 plan 额度**（62 个 Opus agent）；有评论直斥"tokenmaxxing disguised as a product"。dynamic workflow 的卖点正是用 JS 脚本传结果**绕开** orchestrator context 来消除"sub-agent tax"，据称省 60-90%——但此数字是 community-low 单源，**speculative**。
2. **Slop debt / 质量恶化**：HN 高赞"LLMs add slop debt...each pass just exacerbates it"；"You would correct a junior once or twice... It's something we can't do with LLMs currently"——**session 内 agent 无法从纠正中学习**。最高赞评论（199 赞）：**"My limiting factor is not speed—it's whether Claude will do the task correctly."**——直击 workflow 优化的是"广度/速度"，而用户瓶颈是"正确性/深度"。
3. **弱 mid-run 人工控制**（官方明确列为约束）：docs 写明 **"No mid-run user input"**——只有 agent permission prompt 能暂停 run；阶段间要签字必须**拆成独立 workflow**。控制手段仅：`P` 暂停/恢复、`X` skip/retry agent——**无法 steer 后续 phase 的逻辑**。
4. **Bun rewrite 反面教材**：750K 行 Zig→Rust port 被批 anti-pattern，真 Bun 开发者吐槽"vibe-coded Rust"含"coding horrors"。
5. **determinism ≠ correctness**：脚本编排 deterministic，但 transformer leaf 非确定；adversarial vote 可能**集体确信一个错误**，ground truth 还得靠 test suite 不是 agent 共识。
6. **vs LangGraph（三处 LangGraph 仍赢）**：LangGraph 提供 **first-class human-in-the-loop**、**每步 checkpoint 的 durable execution（可跨 session pause/inspect/resume）**、typed state DAG。dynamic workflow 的 resume **只限同 session**、**无 mid-run HITL**、state 是临时 JS 变量。

---

## (a) 并行范式 —— 社区收敛清单

整合 ray-amjad(9)、alexop(8)、claudefa/官方(6) 后去重，得到生态收敛的核心范式谱。每条标注机制 + 适用场景：

1. **Fan-out + Synthesize**（barrier）。机制：已知独立 item 列表，每个一个 agent 一次过，`parallel()` 当合法 barrier，最后合成。适用：codebase audit、market scan。barrier 合法因为 synthesize 真需全部结果。
2. **Pipeline-by-default**（streaming，无 barrier）。机制：item 各自流过有序 stage，谁就绪谁前进；item A 可在 stage 3 而 B 还在 stage 1。**被反复强调的"默认选择"**——消除 stage 间 idle gap。
3. **Barrier-to-dedup**。机制：下一 stage 需要*整个*前序结果集（dedup/merge/对 count early-exit）时才用 `parallel()` 收口。
4. **Loop-until-target**（固定 goal）。机制：plain counter 迭代到固定目标。适用："find 10 bugs"。
5. **Loop-until-budget**（深度随 token target 缩放）。机制：`budget.total && budget.remaining()` 检查；`total &&` guard 必须有。
6. **Loop-until-dry**（未知规模发现）。机制：反复派 finder，直到 K 个连续 round 无新 item；**dedup against everything seen（不只 confirmed）**。适用：bug hunt、security audit、open-ended research。
7. **Adversarial-verify / Skeptic-vote**。机制：对每个 finding 派 N 个独立 agent **专门试图证伪**，majority reject 证伪才存活。`/deep-research` 的 75-fact-check-agent 就是这个。
8. **Perspective-diverse-verify**。机制：每个 verifier 用**不同 lens**（correctness / security / performance / reproducibility）。
9. **Judge-panel / Tournament**。机制：N 个不同 angle 生成 attempt，**pairwise** judge 比到出 winner，从 winner 合成并嫁接 runner-up 好部分。适用：解空间宽、creative/design。
10. **Generate-and-filter**。机制：大量 noisy 候选 → rubric/verification 过滤 → 去重 → 返回高质量幸存者。
11. **Classify-and-act**（routing）。机制：classifier agent 判 task 类型 → 路由到 specialist。
12. **Nested workflow**（composition）：`workflow()` 内联跑自洽子 job，**仅一层嵌套**；共享 parent 的 concurrency cap / agent counter / token budget。可把子问题甩给 `/deep-research`。

---

## (b) 主线程 / orchestrator 不空转 —— **这是一个明确的生态空白**（核心发现）

**结论先行：生态里没有人系统讨论"让主对话线程在 workflow 后台跑时持续产出有用工作"。** 所有论述都停在"主 session **保持 responsive / 你可以继续打字**"这一被动层面，而非"orchestrator 主动并行推进别的工作"。

证据链：

1. **官方只承诺 responsive，不承诺 productive**（official）。docs/blog 的措辞一律是："a runtime executes it in the background **while your session stays responsive**""you can **keep working** in the main session while it goes, or **kick off a second workflow** alongside the first"。即：官方给的是 **"不被阻塞"**（你可手动去干别的、可再起一个 workflow），**不是"主 agent 自动找活干"**。官方模型里 workflow 一旦启动，主 session 的"产出"靠**人类**继续输入，不是 orchestrator 自驱。

2. **架构上主线程在 workflow 期间本就"无事可做"**。dynamic workflow 的设计哲学是 control-flow inversion——loop/branch/intermediate state 全搬进 JS 脚本，**主 context 只在最后收一份结果**。这恰恰意味着：run 进行时，主 agent 既不持有 plan、也收不到中间结果，**它结构性地没有可推进的状态**。这是"空转"的根因，也是为什么没人讨论"让它别空转"——在这个范式里主 agent 本就被设计成 idle 等结果。

3. **唯一沾边的论述来自 subagent 模型（非 workflow runtime）**：`obra/superpowers` 的 `dispatching-parallel-agents` 说"This also **preserves your own context for coordination work**"——但这是 **sequential subagent dispatch** 的语境，不是 background workflow runtime；且它讲的是"留 context 给协调"，不是"后台跑时主线程并行推进"。

4. **生态把这个问题降维成了"通知问题"，而非"productivity 问题"**（关键证据）。社区/官方对"主 agent idle"的全部工程关注，都集中在 **completion notification** 上，不在"让它别 idle"：
   - CC [Issue #45781 "Add BackgroundTasksIdle notification event"](https://github.com/anthropics/claude-code/issues/45781)：用户痛点是"background agent 还在跑时，Notification hook 误报 idle"；请求一个**仅当全部 background task 完成时才 fire** 的事件。**官方 Closed as not planned（stale）**。
   - [Issue #20754](https://github.com/anthropics/claude-code/issues/20754)：多 agent 同时完成时通知漏发（3 个只发 1 个）。
   - [Issue #6854](https://github.com/anthropics/claude-code/issues/6854)：请求 background bash session 完成时通知 main agent。
   - [Issue #18544](https://github.com/anthropics/claude-code/issues/18544)：请求能**关闭**自动 background 完成通知。

   也就是说：生态对"主线程 + 后台异步"的成熟度，停留在"完成了能不能可靠地戳醒主 agent"，**远没到"等待期间主 agent 自驱干别的"**。

**对元目标的直接含义**：OMNE 项目里的红线"后台工作时主线程不空转——持续推进文档维护 / 下一批 anchor 组装 / 经验沉淀"**在 CC dynamic workflow 生态里没有任何现成解法或先例**。官方范式甚至与之**结构性相悖**（主 agent 被设计成 idle 收尾）。能借鉴的最近思想是 superpowers 的"留 context 给 coordination"，但那是手动协调、非自驱填充。**这个空白本身是本研究最重要的发现之一**：你的"主线程不空转"实践属于生态前沿/无人区，**需自建机制**（例如：主 session 在后台 workflow 跑时，由 orchestrator 主动循环做文档/经验沉淀/下批组装），而不是套用社区范式。报告 3（TFU streaming planner）与报告 4（latency-hiding / look-ahead）给的是填这个空白的"原理弹药"。

---

## (c) 异步目标执行 —— 现状

| 能力 | 现状 | 来源/可信度 |
|---|---|---|
| **Background runs** | 成熟。tool 返回 `wf_…` run id 立即返回；`/workflows` 看 phase/agent count/token/elapsed；多 workflow 可并行。 | official |
| **完成通知注入** | 部分可用、**有可靠性问题**。完成时 `<task-notification>` 注入下一 turn context；但多 agent 同时完成漏发(#20754)、Windows 不激活 idle 态(#21048)；`BackgroundTasksIdle` 精细事件请求被 **拒(not planned)**(#45781)。 | official + community-high |
| **Resume** | 有，但**强约束**：仅同 session；content-hash journal，同 script+同 args 产生 identical agent 序列，`resumeFromRunId` 命中 cache 的不重跑、只跑新/改的。**退出 CC 即失效，下次从头**。 | official + community-high |
| **Cache-replay 增量** | 强项。8-stage 跑完想加第 9 个，不重跑前 8，resume 同 run id 即 cache replay。 | community-high (claudefa.st) |
| **Chaining（多 workflow 串接）** | 两条路：(1) **inline nesting** via `workflow()`，**仅一层深**，共享 parent budget/counter；(2) **ultracode session-level chaining**——单请求自动串多个 workflow，但靠 Claude 自决、非显式编排，session 重置即丢。**无官方的跨 workflow DAG / 持久 pipeline 编排原语**。 | official |
| **跨 session 持久 / durable execution** | **缺失**。vs LangGraph（每步 checkpoint、可跨 session pause/resume）最大短板。 | community-high |
| **Mid-run HITL** | **缺失**（docs 明示 no mid-run user input）。阶段间签字需拆成独立 workflow。 | official |

---

## 信源清单（带可信度）

**Official**
- [Claude Code Docs — Orchestrate subagents at scale with dynamic workflows](https://code.claude.com/docs/en/workflows)
- [claude.com/blog — A harness for every task](https://claude.com/blog/a-harness-for-every-task-dynamic-workflows-in-claude-code)、[Introducing dynamic workflows](https://claude.com/blog/introducing-dynamic-workflows-in-claude-code)、[anthropic.com/news — Claude Opus 4.8](https://www.anthropic.com/news/claude-opus-4-8)
- CC GitHub issues：[#45781](https://github.com/anthropics/claude-code/issues/45781)、[#20754](https://github.com/anthropics/claude-code/issues/20754)、[#6854](https://github.com/anthropics/claude-code/issues/6854)、[#18544](https://github.com/anthropics/claude-code/issues/18544)、[#21048](https://github.com/anthropics/claude-code/issues/21048)

**Community-high**
- [ray-amjad/claude-code-workflow-creator](https://github.com/ray-amjad/claude-code-workflow-creator)（authoring skill、9 patterns、api-reference、linter）
- [alexop.dev — deterministic orchestration](https://alexop.dev/posts/claude-code-workflows-deterministic-orchestration/)、[claudefa.st — dynamic workflows guide](https://claudefa.st/blog/guide/development/dynamic-workflows)
- [obra/superpowers](https://github.com/obra/superpowers) + [dispatching-parallel-agents SKILL.md](https://github.com/obra/superpowers/blob/main/skills/dispatching-parallel-agents/SKILL.md) + [Issue #469](https://github.com/obra/superpowers/issues/469)
- [HN #48311705](https://news.ycombinator.com/item?id=48311705)、[kenhuangus.substack](https://kenhuangus.substack.com/p/claude-code-orchestration-dynamic)、[buildtolaunch — guide & real numbers](https://buildtolaunch.substack.com/p/claude-code-dynamic-workflows-guide)
- [shinpr/claude-code-workflows](https://github.com/shinpr/claude-code-workflows)、[barkain/claude-code-workflow-orchestration](https://github.com/barkain/claude-code-workflow-orchestration)、[wshobson/agents](https://github.com/wshobson/agents)、[davila7/claude-code-templates](https://github.com/davila7/claude-code-templates)、[InfoQ — Dynamic Workflows](https://www.infoq.com/news/2026/06/dynamic-workflows-claude-code/)

**Community-low / Speculative**
- [mindstudio 系列](https://www.mindstudio.ai/blog/claude-code-5-workflow-patterns-explained)、[claudemarketplaces.com](https://claudemarketplaces.com/)、[rohitg00/awesome-claude-code-toolkit](https://github.com/rohitg00/awesome-claude-code-toolkit)
- [VS Code "Workflow Studio"](https://marketplace.visualstudio.com/items?itemName=breaking-brake.cc-wf-studio)（0 ratings，**非** workflow-runtime native）；"省 60-90% token"（单一 community-low 源，未独立证实）

---

## 未查完 / 留白（诚实标注）

1. HN 全量评论未逐楼通读；noob-programmer / buildtolaunch 正文 paywall，LangGraph 三胜点细节未拿到一手。
2. ray-amjad 的 6 个 example 脚本原文未逐个 fetch（读了 patterns/api-reference/linter）。
3. **(b) 的反证**：已尽力多角度搜"主线程 productive while running"，均回落到"responsive"语义——基于现有证据强度，判定为"生态空白"是稳健结论。

---

*本报告是四份报告中的第 2 份。核心发现："主线程不空等"是 Claude Code dynamic workflow 生态的明确空白，需自建机制；填补它的原理弹药见报告 3（TFU streaming planner）与报告 4（latency-hiding / look-ahead / Little's Law）。*
