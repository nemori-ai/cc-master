# 报告 1：Claude Code Dynamic Workflow 机制深度理解

**日期**：2026-06-05
**面向读者**：希望吃透 Claude Code「Dynamic Workflows」机制、尤其想理清**并行编排**与**主线程（编排者）如何在 workflow 后台执行期间持续推进而非空等**这两个问题的工程师与研究者。
**本报告在四份报告中的定位**：地基。报告 2（社区 skills/plugins）、报告 3（LLM-Compiler 谱系）、报告 4（SWE/PM 异步并行方法论）分别从"业界实践""学术算法""工程与管理原理"三个方向，去填补本报告在第 8 节诊断出的两块机制空白。

---

## 0. 方法论与证据分层

本报告的论断来自**四类证据**，每条结论都按可信度标注。读者必须始终区分**行为契约（behavior，机制对外承诺什么）**与**内部实现机制（mechanism，runtime 内部怎么做到的）**——Anthropic 官方文档化了前者，几乎从未公开后者。

| 证据档位 | 含义 | 本报告记号 |
|---|---|---|
| **first-party-contract** | 来自**本 agent 当前被授予的 `Workflow` 工具 schema 本身**——这是 Anthropic 写给 agent 的官方接口契约，是描述原语表面的最权威一手来源 | `[契约]` |
| **official-confirmed** | 已核对 `code.claude.com/docs/en/workflows` 或经核实的 Anthropic 员工发言 | `[官方]` |
| **community-inferred** | 来自社区逆向（ray-amjad 探测 pre-GA 二进制、alexop.dev 实测）；双源交叉印证者可信度较高，单源者应视为合理但未证实 | `[社区·双源]` / `[社区·单源]` |
| **port-design** | 来自 `langchain-dynamic-workflow`（下称 LDW）这个社区 Python 端口的**设计取舍**，不是对 Anthropic runtime 的镜像 | `[端口设计]` |

本报告相对既有逆向材料的**核心增量**：第 3、7 节用 `[契约]` 档证据，把若干此前被逆向报告标为「单源未证实」的条目升级为「接口层一手确认」。详见第 7 节的**可信度对账表**。

> **本报告的一手材料基线**：`../langchain-dynamic-workflow/research/` 下三份调研——
> - `2026-06-01-claude-code-dynamic-workflows-reverse-engineering.md`（机制逆向）
> - `2026-06-01-langchain-deepagents-substrate.md`（在 LangGraph/deepagents 上的 build-vs-buy 实证）
> - `2026-06-01-microsoft-promptflow-architecture-study.md`（control-flow ownership 轴上的对照系）
>
> 本报告在它们之上叠加了**本 agent 自身 `Workflow` 工具契约**这一额外一手来源，并据此对账。

---

## 1. 一句话本质：把"下一步做什么"的决定权从 LLM 搬进确定性脚本

Dynamic Workflow 的核心范式是**控制流反转（Control-Flow Inversion）**`[官方]`。官方原文：「A dynamic workflow is a JavaScript script that orchestrates subagents at scale. Claude writes the script for the task you describe, and a runtime executes it in the background while your session stays responsive.」以及那句口号——「**A workflow moves the plan into code.**」

官方对照表把差异讲得很直白 `[官方]`：

| 维度 | 普通 subagent/skill | Dynamic Workflow |
|---|---|---|
| 谁决定下一步运行什么 | Claude，逐轮（turn by turn） | **脚本**（the script） |
| 中间结果存放在哪 | Claude 的 context window | **脚本变量**（script variables） |
| 到达调用方 context 的内容 | 整个 trajectory | **只有最终答案** |
| 中断后 | 重启该轮 | 同会话内可 resume |
| 规模 | 每轮几个委派任务 | 单次运行数十到数百 agent |

**这解决了普通 agent 的两个硬伤** `[官方]`：(1) 单个对话窗口协调不了足够多的 agent；(2) 所有中间产物都涌进 context，把 LLM 淹没。Workflow 把规模拉到「数十到数百 agent/次运行」，把中间产物挡在 context 之外，并能施加一类可复用的质量模式——让独立 agent **对抗式交叉审查**（adversarial cross-review）彼此的发现，或从多角度起草方案再加权比较。

**这一范式与本报告主题的关系**：控制流反转之所以重要，是因为它把"并行调度"从一个**模糊的 LLM 即兴决策**变成了一段**可被工程化、可被算法优化的确定性代码**。一旦 fan-out / pipeline / loop 写在 `for`/`await` 里，它就服从于报告 3（LLM-Compiler 的 DAG 调度）和报告 4（CPM、fork-join、Little's Law）里那些成熟的并行执行原理。这是后三份报告能"接得上"的根本原因。

---

## 2. 触发、codegen 与审批门

- **触发** `[官方]`：用户描述任务并在 prompt 任意处含触发关键词（Claude 会高亮，alt+w 取消），**或** `/effort ultracode`（把 xhigh reasoning 与"每个实质任务自动编排 workflow"结合）。**关键词在 v2.1.160 有过变更**：旧版字面触发词是 `workflow`，v2.1.160 起改为 `ultracode`；自然语言（"use a workflow" / "run a workflow"）两版均生效（详见报告 2 §0）。本 agent 当前工具契约用的正是 `ultracode` 关键词。
- **codegen** `[契约]+[官方]`：Claude 为该任务写一个**自包含的 JavaScript 编排脚本**，交给 `Workflow` 工具。工具输入字段为 `script | name | scriptPath`，外加可选 `args` 与 `resumeFromRunId`。初次 codegen 实质是**一次成型**——没有证据表明首跑前存在自动 self-correcting 循环 `[社区·双源]`。
- **审批门** `[官方]`：脚本被解析/校验/持久化到会话目录后走审批门（CLI：Yes run / Yes don't ask again / View raw script (Ctrl+G) / No）。`/workflows` 实时显示每个 phase 的 agent 数、token 总量、耗时。
- **精化走 edit-and-resume** `[契约]`：跑一次 → 用 Write/Edit 改保存的脚本文件 → 以 `{scriptPath, resumeFromRunId}` 重调。**最长未改前缀的 `agent()` 调用从 journal 缓存瞬时重放，第一个被改/新增的调用及其后全部 live 重跑**。

**关键工程事实** `[契约]`：`Workflow` 工具调用**立即返回一个 task ID**，workflow 在后台跑，完成时一个 `<task-notification>` 注入对话。这条"立即返回 + 后台执行 + 完成通知"的契约，是本报告第 6 节讨论"主线程不空等"的**硬件基础**——它在机制层面就允许主线程在 workflow 跑着时继续做别的事。

---

## 3. 原语语义（结合 live 工具契约逐条校正）

下表是七个编排原语 + 两个注入对象（`args`、`budget`）的概览。**凡标 `[契约]` 者，均逐字来自本 agent 当前的 `Workflow` 工具 schema**——这是相对既有逆向材料最硬的升级点。

| 原语 / 对象 | 签名 | barrier? | 失败语义 | 证据 |
|---|---|---|---|---|
| `agent(prompt, opts?)` | `→ Promise<string \| object>` | n/a | 用户 skip → 返回 `null` | `[契约]` |
| `parallel(thunks)` | `→ Promise<any[]>` | **是** | thunk 抛错 → 该槽 `null`，调用**永不 reject** | `[契约]` |
| `pipeline(items, ...stages)` | `→ Promise<any[]>` | **否** | stage 抛错 → 该 item 落 `null` 并跳过其余 stage | `[契约]` |
| `phase(title)` | `→ void` | n/a | — | `[契约]` |
| `log(message)` | `→ void` | n/a | — | `[契约]` |
| `workflow(nameOrRef, args?)` | `→ Promise<any>` | n/a | 未知名/不可读路径/二级嵌套 → 抛错 | `[契约]` |
| `args` | 任意注入值 | n/a | 未传则 `undefined` | `[契约]` |
| `budget` | `{total, spent(), remaining()}` | n/a | `spent()` 达 `total` 后 `agent()` 抛错 | `[契约]` |

### 3.1 `agent(prompt, opts?)` —— leaf subagent 派生

派生一个**全新 context** 的 subagent`[契约]`。无 `schema` 时逐字返回 subagent 最终文本（string）；传入 `schema`（JSON Schema）时，校验发生在 tool-call 层，模型不匹配会被要求重试，`agent()` 返回校验过的 object——无需 `JSON.parse`。用户在 `/workflows` 里 skip 该 agent 时返回 `null`（故到处可见 `.filter(Boolean)` 习语）。

`opts` 字段 `[契约]`：`label`（显示名）、`phase`（归入命名进度组）、`schema`（强制结构化输出）、`model`（覆盖模型；默认继承主循环模型——契约明示"almost always correct，unsure 时就省略"）、`isolation:'worktree'`（在新 git worktree 中跑该 agent，仅在并行 agent 会互改文件冲突时才用，约 200–500ms + 磁盘成本/agent）、`agentType`（用自定义 subagent 类型，从与 Agent 工具同一 registry 解析）。

> **subagent 派生 subagent？**`[契约]` 明确：workflow agents 可经 ToolSearch 触达所有 session-connected MCP 工具——但契约未把"workflow 派生的 agent 能否再派生 subagent"说死。逆向报告把这列为 open question #11。本报告维持存疑。

### 3.2 `parallel(thunks)` vs `pipeline(...)` —— 并行的两副面孔（**本报告对"并行困惑"的核心澄清**）

用户对"并行 workflow"的困惑，根子在于**这两个原语都"并行"，但并行的形状完全不同**。把它们讲透是本报告的首要任务。

**`parallel(thunks)` —— barrier 式 fan-out** `[契约]`：
- 接收 **thunk 数组** `[() => agent(...), () => agent(...)]`，**不是** promise 数组（裸 promise 会立即启动、绕过并发限制器，是已知反模式）。
- 它是 **barrier**：等待**所有** thunk 完成才返回。
- **失败永不 reject**：抛错的 thunk 在结果数组对应位置变成 `null`，调用本身从不抛——所以用前必须 `.filter(Boolean)`，结果数组按设计带"空洞"。
- **只在下游确实需要一次拿到整组前序结果时才用**：跨全集去重/合并、基于计数的提前退出（"0 bug → 跳过整个验证阶段"）、把一项与全体对比。

**`pipeline(items, ...stages)` —— 无 barrier 流式** `[契约]`：
- 每个 item **独立**流过**所有** stage，**stage 间无 barrier**——item A 可在 stage 3，而 item B 还在 stage 1。
- **墙钟时间 ≈ 最慢单 item 整条链**，而非"各步最慢 stage 之和"。
- 每个 stage 回调收到 `(prevResult, originalItem, index)`——可用 `originalItem`/`index` 在后续 stage 标注工作，不必把上下文一路 thread 过 stage 1 的返回值。
- 抛错的 stage 把该 item 落为 `null` 并跳过其剩余 stage。
- **这是多 stage 工作的默认选择**。

**判别准则**（工具契约自带的"smell test"）`[契约]`：如果你写出
```js
const a = await parallel(...)
const b = transform(a)        // flatten / map / filter —— 无跨 item 依赖
const c = await parallel(b.map(...))
```
那个中间 `transform` **不需要 barrier**，应改写成 pipeline：`pipeline(items, stageA, r => transform([r]).flat(), stageB)`。**barrier 只在 stage N 真的需要 stage N-1 的全集时才正当**（去重/合并、计数提前退出、"与其它发现对比"）。"代码更干净""阶段概念上独立"都**不是**用 barrier 的理由——barrier 的延迟是真实的：5 个 finder 跑，最慢的是最快的 3 倍，barrier 就浪费掉快 finder 2/3 的空闲时间。

> `★` **这条 smell test 直接预告了报告 3 与报告 4 的主题**：LLM-Compiler 的 **Task Fetching Unit** 就是"依赖一就绪即分派"的极致——它本质上是把 `parallel` 的 barrier 拆成 `pipeline` 的流式（报告 3）；而报告 4 里 fork-join 的 barrier 成本、dataflow 的"dispatch when ready"、关键路径分析，全是这条 smell test 背后的硬核理论。

### 3.3 `phase(title)` / `log(message)` —— 进度叙事

`phase(title)` 开启进度组，其后派生的 agent 加入该组（`/workflows` 实时树）`[契约]`；`meta.phases[].title` 与 `phase()` 调用**精确匹配**。**在并发 pipeline/parallel stage 内，优先用每-agent 的 `opts.phase` 选项而非全局 `phase()`**，以避免组归属竞态 `[契约]`。`log(message)` 在进度树上方发一行叙事，用于把"丢弃了什么"显式说出来（如 top-N 截断、no-retry、采样）——不让无声截断读起来像"全覆盖"。

### 3.4 `budget` —— 共享 token 池（**被 live 契约从"单源未证实"升级**）

`{total, spent(), remaining()}` 注入对象 `[契约]`：
- `budget.total` = 用户经 `'+500k'` 式指令设的目标，无目标时为 `null`。
- `budget.spent()` = **本轮输出 token**，**跨主循环与所有 workflow 共享**（非 per-workflow）。
- `budget.remaining()` = `max(0, total − spent())`，无目标时为 `Infinity`。
- 目标是**硬上限**：`spent()` 达 `total` 后新 `agent()` 调用抛错。
- 预算循环**必须**用 `budget.total` 守卫：`while (budget.total && budget.remaining() > 50_000) {...}`——否则无目标时 `remaining()` 为 `Infinity`，无守卫循环会一路冲进 1000-agent 上限。

> **对账**：逆向报告把 `budget` 对象表面、超限抛错、`spent()` 计什么 token（其 open question #10）全标为「community 单源、未证实」。**本 agent 的工具契约逐字确认了三件事**：对象表面 `{total, spent(), remaining()}`、超限后 `agent()` 抛错、以及 `spent()` 计的是**输出 token**且跨主循环+所有 workflow **共享**。这三条因此升级为 `[契约]`。唯一仍属社区的是错误类名 `WorkflowBudgetExceededError`（契约不暴露类名）。

### 3.5 `workflow(nameOrRef, args?)` —— 一级内联嵌套（**同样被升级**）

内联运行另一个 workflow 并返回其返回值；传保存的 workflow 名或 `{scriptPath}``[契约]`。子 workflow **共享**本次运行的并发上限、agent 计数器、abort signal、token 预算；其 agent 在 `/workflows` 里显示为 `▸ name` 嵌套组。**仅一级嵌套——在子 workflow 里调 `workflow()` 抛错**。未知名/不可读路径/子语法错也抛错（catch 以优雅降级）。

> **对账**：逆向报告把"一级嵌套 + 子共享并发/计数/预算"标为「单源 ray-amjad、未证实」。**工具契约逐字确认**："shares this run's concurrency cap, agent counter, abort signal, and token budget"、"Nesting is one level only: workflow() inside a child throws"。升级为 `[契约]`。

### 3.6 `args` —— 参数注入

`args` 是传给 `Workflow` 的输入值，原样暴露为脚本全局 `[契约]`。**必须传真正的 JSON 值（数组/对象），不要传 JSON 字符串**——stringified list 到达脚本是一整个 string，`args.filter`/`args.map` 会抛错。用于参数化具名 workflow（研究问题、目标路径、config 对象）。

> 逆向报告曾观测到 pre-GA build 把 `args` 序列化成字符串（2026-05-29 探测），并指出这与工具自身 schema 矛盾、可能是 pre-release 怪癖。**当前工具契约的措辞已是"verbatim、actual JSON values"**——即 GA 后已（至少在契约层）改为 live-object passthrough。这是一个 pre-GA→GA 漂移被 live 契约证伪的实例，提醒所有 pre-GA 单源常量都需对当前 build 重核。

---

## 4. 执行模型：并发、上限、资源设界

| 上限 / 参数 | 值 | 证据 |
|---|---|---|
| 并发 agent | **`min(16, cpu cores − 2)`** per workflow；超出排队，slot 空出再跑 | `[契约]`（逆向报告此前标公式为社区单源） |
| 单次运行总 agent | **1,000**（失控循环 backstop，远高于真实需求） | `[契约]+[官方]` |
| 单个 `parallel()`/`pipeline()` 调用最大 items | **4,096**（超出是显式报错，非静默截断） | `[契约]`（**逆向报告完全未记载，本报告新增**） |
| 脚本尺寸上限 | **524288 字节（512KB）** | `[契约]`（`script` 参数 `maxLength: 524288`；逆向报告标为社区单源、低可信，现升级） |
| 每-agent stall 超时 | 180000ms（3min），重试至多 5× | `[社区·单源]`（契约不暴露） |
| VM 同步超时 | 30000ms，仅捕获无限同步循环 | `[社区·单源]`（契约不暴露） |

**资源设界的工程含义**：你可以给 `parallel()`/`pipeline()` 传至多 4096 个 item 且它们都会完成，但任一时刻只有约 `min(16, cores−2)` 个在跑——这正是报告 4 里 **WIP limit / Little's Law / semaphore** 的具体落地：并发被一个固定窗口 throttle，超出的部分排队。理解这一点对"为什么扇出 100 个 agent 不会线性加速"至关重要（Amdahl/Gustafson + 固定并发窗口的双重制约）。

**脚本是纯协调器** `[官方]+[契约]`：脚本**无直接 filesystem / shell 访问**，所有副作用工作（读、写、跑命令）都委派给用后即弃 context 的 leaf agent，只有最终结果回来。脚本是 plain JavaScript（不是 TypeScript——类型注解会解析失败），无 Node.js API，标准内建可用，**除了** `Date.now()` / `Math.random()` / 无参 `new Date()`（它们会抛错——见第 5 节）。

---

## 5. Journal / Resume / Determinism

### 5.1 Resume 的契约表述（本报告对"缓存键之争"的调和）

工具契约对 resume 的措辞值得逐字玩味 `[契约]`：

> "the **longest unchanged prefix** of agent() calls returns cached results instantly; the first edited/new call and everything after it runs live. Same script + same args → 100% cache hit."

这句话调和了既有材料里两种看似冲突的说法：
- 逆向报告（ray-amjad 单源）说缓存键是 `(prompt, opts)` 的 **content hash**。
- substrate 报告（实读 LangGraph 1.2.2 源码）发现 LangGraph 原生 `task_id` 是 **positional**（编码 step 号 + 节点名 + write 索引），驱动 resume replay-skip。

**"longest unchanged prefix" 同时蕴含两者**：resume 沿 `agent()` 调用**序列**逐个比对，只要 `(prompt, opts)` 内容未变就命中缓存，一旦遇到第一个内容变了的调用就从那里转 live。所以它在效果上是"**按序列位置遍历 + 按内容比对、遇首个不匹配即止**"——既不是纯 positional，也不是纯 content-hash 的乱序命中，而是**前缀有序 + 内容判等**。`schema`/`model`/`isolation`/`agentType` 改动会失效缓存（强制重跑），`label`/`phase` 纯装饰、永不失效 `[社区·双源]`。

**仍属内部机制、未确认**：缓存键的真实索引方式（content-hash vs index+content）、journal 落盘格式（`agent-<id>.jsonl` 为社区报告）、是 vm-module 进程内沙箱还是真 V8 isolate——这些是 mechanism，官方从未文档化。**注意：逆向报告已证伪"V8 isolate 底座"之说**——那段"V8 isolate vs microVM"语言其实出自 Cloudflare 的**另一个产品**（Claude Managed Agents 的 agent 代码沙箱），不是 workflow 编排 runtime；混淆二者是已知错误。

### 5.2 Determinism guard

因为 run 被 journal 以支持 resume，任何非确定性都会使缓存失效，所以三个经典 JS 非确定源在脚本内**抛错（fail-loud）**`[契约]`：`Date.now()`、`Math.random()`、**无参** `new Date()`/`Date()`（`new Date(specificValue)` 仍可用）。契约给出的 workaround：**时间戳经 `args` 传入**；要让 agent 各异，**按 loop index 或 per-index label 变 prompt**，而非随机化。

> **对账**：逆向报告把 determinism throw 标为「双源、但 Anthropic 未确认；AST-gate vs runtime-throw 未定」。**工具契约逐字确认了抛错行为**（"throw"），故行为升级为 `[契约]`；但 **guard 是预执行 AST gate 还是运行时 throw 仍是 mechanism，未确认**。substrate 报告补了一刀实证：LangGraph **完全不强制确定性**（全底座唯一检查是一句 `-O` 可剥离的裸 `assert`，且无任何确定性异常类）——所以若把该机制移植到 LangGraph，determinism guard **必须自建**，这是 port 的真实工作而非"复刻官方"。

---

## 6. 三个对照系：把 Dynamic Workflow 放回坐标系里

理解一个机制，最好的办法是看它在"控制流归属"这根轴上的位置。三份一手材料恰好给了三个对照点。

### 6.1 vs 普通 turn-by-turn subagent（官方对照，见第 1 节）

普通模式：Claude 是 orchestrator，每个中间结果落进 context，逐轮决策。Workflow 模式：脚本持有控制流，中间结果在脚本变量，只有最终答案回 context。**取舍**：workflow 牺牲了"逐轮人工介入"（无 mid-run 输入，仅 agent permission prompt 能暂停），换来规模与 context 纯净。

### 6.2 vs LangGraph 显式 DAG（substrate 视角）

substrate 报告实读 LangGraph 1.2.2 + deepagents 0.6.7 源码，结论是：**这套机制可以、但不能"免费"建在 LangGraph 上**。LangGraph 的 `@entrypoint`/`@task` 给了控制流反转的落点（body 里的 Python 控制流由脚本拥有），`asyncio.gather` over `@task` futures 给了 `parallel()` 的 barrier，直接 `ainvoke` deepagent 给了 context quarantine——这些是 provided。但有**五块必须自建**：

1. **`pipeline()` 的 no-barrier streaming + 背压**：LangGraph 无此原语（`Send` 是 map-reduce barrier），须自建 `asyncio.Semaphore` + `asyncio.Queue` over `@task` futures。
2. **content-hash journal（success-only 语义）**：LangGraph 同步 `put_writes` 缓存结果时**无 INTERRUPT/ERROR 守卫**（已确认 bug #7589），会把失败 task 缓存成 success；journal 必须显式 success-only。
3. **fail-loud determinism guard**：底座唯一检查是 `-O` 可剥离的裸 assert，必须自建。
4. **per-leaf sandbox identity**：deepagents 的 BackendFactory 路径已 deprecated（0.7.0 移除）。
5. **SandboxManager（生命周期）**：deepagents backend **无任何** lifecycle 方法（`close/start/stop` grep 零命中），sandbox 生命周期完全是调用方责任。

**对理解 Anthropic 机制的启发**：这五块自建项反过来告诉我们，Anthropic 的 runtime 内部**至少**实现了流式 pipeline 调度器、success-only 的内容寻址 journal、确定性守卫、以及 per-agent 隔离与生命周期管理——这些是"数十到数百 agent 可靠编排"的真实工程成本所在。

### 6.3 vs Microsoft Prompt Flow 静态 DAG（control-flow ownership 轴上的反面教材）

Prompt Flow 的设计哲学**为可见性（visibility）而生**：把工具拼成可视化静态 DAG，并**刻意拒绝让 Flow 图灵完备**，把"完全动态的 LLM-引导 agent"重定向到 Semantic Kernel。这是一句对理解 Dynamic Workflow 极有价值的自白——Prompt Flow 把**控制流归属交给框架**（engine-owns-control-flow），用静态配置换可视化与可调试性。

但 Prompt Flow **自己也撞上了静态 DAG 的天花板**，于是引入 flex flow（code-first，`entry: module:callable`，控制流归代码），其官方文档逐字给出理由："Users can write complex flow with Python built-in control operators (if-else, foreach)..."——这与 Dynamic Workflow 的控制流反转**完全同侧**。教训很重：**visibility-first 的静态 DAG 是一个局部最优，一旦编排必须动态（data-dependent loop、动态 fan-out 宽度、任意分支）就会崩塌**，而那正是 Dynamic Workflow 瞄准的 regime。

更值得玩味的一处对照：Prompt Flow 的 DAGManager 是 **pull-based 拓扑调度器**——`pop_ready_nodes()` 返回所有依赖已满足的 node，scheduler 提交 → `futures.wait(FIRST_COMPLETED)` → complete → 续提。**这正是报告 3 里 LLM-Compiler Task Fetching Unit 的同构思想，也是报告 4 里 dataflow "dispatch when ready" 的经典实现**。Dynamic Workflow 的 `pipeline()` 在精神上属于同一家族：item 一就绪就推进，不等整批。

| 维度 | Prompt Flow（DAG 模式） | Dynamic Workflow |
|---|---|---|
| 谁决定下一步 | engine（DAGManager 从声明 topology 推导） | **script**（确定性代码里的真实 `if`/`for`） |
| 中间结果位置 | DAGManager 的 `_completed_nodes_outputs` dict | script 变量 |
| 分支表达 | 声明式 `activate: {when, is}`（图剪枝） | 真实 Python/JS `if` |
| 设计取向 | 可见性优先，刻意非图灵完备 | 控制流表达力优先 |
| 可见性来源 | 静态 config graph 本身 | tracing / journal / `/workflows` 进度树 |

---

## 7. 编排范式目录（官方 + 社区）

以下范式中，**对抗式验证**为官方确认（概念），其余命名范式为社区沉淀（来自 ray-amjad 范式目录 + alexop.dev），其代码骨架与本 agent 工具契约里的范例一致 `[契约]`。

- **fan-out + synthesize**`[官方]`：把综合任务拆成可并行的每部分（"review every file in this diff""audit all 40 dependencies"），再综合。官方头条用例：codebase-wide bug sweep、500-file migration、auth audit。
- **pipeline-by-default**`[契约]`：默认 `pipeline()`，因为 item 一就绪即推进（无队头阻塞）；只在下游 stage 需整组前序结果时才上 `parallel()` barrier（见 3.2 的 smell test）。
- **adversarial verification**`[官方]`：对每个发现，派生 N 个独立 skeptic agent 去**反驳**（默认 refuted=true，举证不足就判死）；多数存活才保留（如 3 票/claim，≥2 反驳则淘汰）。官方原话："other agents try to refute what they found, and the run keeps iterating until the answers converge."**diverse-lens 变体**：给每个 verifier 不同视角（correctness / security / performance / reproducibility）——当一个发现能以多种方式出错时，视角多样性能抓到冗余抓不到的失败模式。
- **judge panel**`[契约]`：从不同角度（MVP-first / risk-first / user-first）生成 N 个独立 attempt → 并行 judge 评分 → 从赢家综合、可嫁接亚军最佳部分。解空间宽时优于"单 attempt 迭代"。
- **loop-until-{count,budget,dry}**`[契约]`：计数循环 `while(bugs.length < 10)`；预算循环 `while(budget.total && budget.remaining() > 50_000)`；dry 循环——连续 K 轮无新发现才停。**关键陷阱**：dedupe 要对**所有已见**（`seen` 集，不是 `confirmed` 集）去重，否则被 judge 否决的发现每轮重现、永不收敛。所有循环都须带硬停（counter/budget）。
- **multi-modal sweep / completeness critic**`[社区]`：多 agent 各用不同检索角度（by-container / by-content / by-entity / by-time），彼此盲查；末尾一个 critic agent 问"还缺什么——哪个 modality 没跑、哪条 claim 没验、哪个源没读"，它找到的就是下一轮工作。

**实战锚点** `[社区]`：Jarred Sumner（Bun）用 dynamic workflows + 对抗式 review 把 Bun 从 Zig 移植到 Rust——一个 workflow 映射每个 struct field 的正确 Rust lifetime，下一个把每个 `.rs` 写成行为等价端口；数百 agent 并行、每文件两个 reviewer；约 750K 行 Rust、99.8% 测试通过——但 canary-only、未入生产。**主导批评**（HN）是 **token 成本**（"tokenmaxxing"，有人 62 个 Opus agent 18 分钟烧掉 5 小时 cap）、"slop debt"、弱 mid-run 人工控制。

### 7.x 可信度对账表（本报告的核心增量）

下表汇总"逆向报告判为单源/未证实，但被本 agent 的 live 工具契约升级"的条目：

| 条目 | 逆向报告原判 | 本报告据 `[契约]` 的新判 |
|---|---|---|
| `budget` 对象表面 `{total, spent(), remaining()}` | community 单源、未证实 | **接口层确认**（错误类名仍社区） |
| `budget.spent()` 计什么 token | open question（未知） | **接口层确认 = 输出 token，跨主循环+所有 workflow 共享** |
| `workflow()` 一级嵌套 + 子共享并发/计数/预算 | 单源、未证实 | **接口层确认**（逐字一致） |
| 并发公式 `min(16, cores−2)` | 社区单源 | **接口层确认** |
| 脚本 512KB 上限 | 社区单源、低可信 | **接口层确认**（`script` 参数 `maxLength:524288`） |
| 单 `parallel/pipeline` 调用 ≤ 4096 items | 未记载 | **接口层新增确认** |
| `args` live-object passthrough（非 string 序列化） | pre-GA 标"序列化为字符串"、可能漂移 | **接口层确认 = 传 actual JSON values**（GA 已漂移） |
| determinism 三禁抛错 | 双源、Anthropic 未确认 | **行为接口层确认**（机制 AST-gate vs runtime-throw 仍未知） |
| resume = 最长未改前缀缓存 | content-hash（单源）vs positional（实证）相争 | **接口层澄清 = "longest unchanged prefix"（前缀有序+内容判等）** |

**这张表的意义**：它不改变"内部实现机制仍是黑盒"这一事实，但把"原语对外行为契约"从社区逆向的不确定状态，拉到了"以 Anthropic 给 agent 的官方接口为准"的确定状态。对**要在这套契约上做编排决策**的人（也就是本报告真正的用户）来说，行为契约确定就够了。

---

## 8. 专章：并行执行 与「主线程不空等」——直接回应本任务动机

用户的原话是：「对于并行 workflow、workflow 执行时主线程怎么利用起来持续推进（而不是空等）这些不太梳理。」本节把机制层面的事实和空白一次说清。

### 8.1 "并行"在 Dynamic Workflow 里有三个层次，别混

1. **workflow 脚本内部的并行**：`parallel()`（barrier 式 fan-out）与 `pipeline()`（无 barrier 流式）。这是脚本作者用 `for`/`await` 显式编码的并行，受 `min(16, cores−2)` 并发窗口 throttle。**用户该优化的"并行"主要在这一层**——而优化它的算法（DAG 调度、关键路径、dataflow dispatch-when-ready、fork-join barrier 成本）正是报告 3、4 的内容。
2. **多个 workflow 之间的并行/嵌套**：`workflow()` 一级内联嵌套（子共享父的并发/预算/计数）；以及在主对话里先后/并发触发多个独立 workflow（各自后台跑、各自 task-notification）。
3. **主对话线程与后台 workflow 的并行**：workflow 立即返回 task ID、后台执行、完成时注入通知——**这在机制上就允许主线程在 workflow 跑着时继续干别的**。这正是"主线程不空等"的落点。

### 8.2 机制对"主线程不空等"提供了什么

`[契约]` 提供的硬支持有三条：

- **立即返回 + 后台执行**：`Workflow` 工具调用"returns immediately with a task ID"，workflow"runs in the background"。主线程拿回控制权后**可以立刻做下一件事**。
- **完成通知注入**：workflow 完成时 `<task-notification>` 注入对话——主线程不需要轮询，被动等通知即可（契约甚至警告：harness 能追踪的后台工作完成会自动重新唤起，**主动短间隔轮询是浪费**）。
- **同会话 resume + edit-and-resume**：跑→改脚本→`{scriptPath, resumeFromRunId}` 重跑，最长未改前缀瞬时重放。这让"边看中间结果边精化下一阶段"成为可能。

本次任务本身就是这套支持的**实操演示**：我（主线程）扇出 3 个后台研究 agent 后，没有干等它们的通知，而是立刻用本地素材写这份报告 1——这正是"当前批次后台执行时，主线程 look-ahead 推进下一件可独立完成的事"。

### 8.3 机制留下的两块空白（这正是用户"感觉没梳理"的根源）

诚实地讲，Dynamic Workflow **机制本身并没有内建解决"主线程不空等"的编排策略**——它只提供了**能力**（后台执行 + 通知），没提供**方法论**（该在等待期间做什么、怎么把主线程的工作与后台 workflow 的进度对齐）。具体两块空白：

- **空白①：workflow 一旦启动，其脚本结构是固定的、无 mid-run 输入**`[官方]`。脚本内部的"持续推进"完全靠脚本作者预先用 `pipeline()` 写出流式结构；运行中主线程**无法**往一个在跑的 workflow 里"边跑边喂"新信息（要在 stage 间签字，只能把每个 stage 拆成独立 workflow）。所以"持续推进"在 workflow **内部**是个**静态编译期决策**（写脚本时就定死并行结构），不是运行期自适应。
- **空白②：主线程与后台 workflow 之间没有内建的"协同推进"协议**。机制给了"立即返回 + 完成通知"，但**主线程在等待期间该做什么、如何把自己的工作排成一条与后台进度重叠的流水线**——这完全交给主线程（也就是 Claude 自己）的即兴判断。没有原语、没有 skill、没有调度器来保证主线程不空转。

**这两块空白是后三份报告的靶心**：
- **报告 2（社区实践）**去查：社区有没有 skill/plugin/范式专门解决"orchestrator 空转"，还是这是个生态空白。
- **报告 3（LLM-Compiler）**去取：Task Fetching Unit 的"依赖就绪即分派"、Joiner 的 replan 决策，是把空白①（静态并行结构）变成运行期自适应调度的学术参照。
- **报告 4（SWE/PM 方法论）**去炼：CPM 找关键路径、pipelining/look-ahead/double-buffering 重叠 latency、Little's Law/WIP 设界、build-system content-addressable cache 做廉价 resume——这些是把空白②（主线程协同推进）从"即兴"变成"有章法"的工程与管理原理。

---

## 9. Open Questions（仍属内部机制、未确认）

1. **官方 Python 表面是否存在**：官方语言全程是 JavaScript；未找到任何官方 Python API。LDW 是纯社区重实现。
2. **真实内部 runtime**：vm-module 进程内沙箱、QuickJS 内嵌，还是 `isolated-vm`？未证实（但"V8 isolate 底座"之说已被证伪为张冠李戴）。
3. **缓存键索引方式**：content-hash vs index+content？契约的"longest unchanged prefix"给了行为，未给实现。
4. **determinism guard 形态**：预执行 AST gate 还是运行时 throw？未定论。
5. **180s stall / 30s VM 超时**：仅社区单源、契约不暴露，需对当前 build 重核。
6. **云端并发上限**：本地 CLI 是 `min(16, cores−2)`；Bedrock/Vertex/Foundry/Agent SDK 上是否不同？未知。
7. **workflow 派生 agent 能否再派生 subagent**：官方 sub-agents 文档说"Subagents cannot spawn other subagents"，workflow 派生 agent 是否为特例，未核实。
8. **质量无独立基准**：未找到 dynamic-workflow 输出**质量**（vs 单 agent 或 vs LangGraph/CrewAI）的独立量化基准；99.8% Bun 通过率是自报且 canary-only。

---

## 10. 信源清单（带标注）

**first-party-contract（本 agent 当前 `Workflow` 工具 schema）**
- `Workflow` 工具 description 与 input schema —— 原语签名、`parallel`/`pipeline` barrier 语义与 smell test、`budget` 对象、`workflow()` 一级嵌套、`min(16, cores−2)` 并发、1000-agent 上限、4096 items/调用上限、`script` 512KB（`maxLength:524288`）、determinism 三禁抛错、resume "longest unchanged prefix"、`args` actual-JSON passthrough。**本报告所有 `[契约]` 标注的出处。**

**official（官方主源）**
- `https://code.claude.com/docs/en/workflows` —— 控制流反转、JS+runtime、16-并发与 1000-总数、无 fs/shell、same-session resume、无 mid-run 输入、acceptEdits+allowlist 继承、`/deep-research`、v2.1.154+、`CLAUDE_CODE_DISABLE_WORKFLOWS=1`。
- `https://claude.com/blog/introducing-dynamic-workflows-in-claude-code` —— 数百并行 subagent、对抗式交叉检查、ultracode 触发。
- `https://www.anthropic.com/news/claude-opus-4-8` —— 发布上下文（2026-05-28）。
- `https://news.ycombinator.com/item?id=48311705` —— 含经核实的 Boris Cherny 发言（"JavaScript, locally or in the cloud"、Claude Agent SDK）；token-cost/slop/control 批评、Bun 重写辩论。
- `https://blog.cloudflare.com/claude-managed-agents/` —— **注意：另一产品**，"V8 isolate vs microVM"语言的真实出处（agent 沙箱后端，非 workflow runtime）。

**一手调研基线（本仓库 `../langchain-dynamic-workflow/research/`）**
- `2026-06-01-claude-code-dynamic-workflows-reverse-engineering.md` —— 机制逆向、七原语、journal/resume/determinism、meta 层、硬上限、编排范式、可信度表与 open questions。
- `2026-06-01-langchain-deepagents-substrate.md` —— LangGraph 1.2.2 / deepagents 0.6.7 build-vs-buy 实证；五块必自建项、bug #7589、`task_id` positional、`max_concurrency` 无核数默认。
- `2026-06-01-microsoft-promptflow-architecture-study.md` —— Prompt Flow DAG vs flex 的 control-flow ownership 对照、DAGManager pull-based 拓扑调度、`DEFAULT_CONCURRENCY_FLOW=16`、content-hash CacheManager。

**community-reverse（社区逆向，未经 Anthropic 证实）**
- `https://alexop.dev/posts/claude-code-workflows-deterministic-orchestration/` —— determinism throw、journaling/cache 框定、parallel-barrier/pipeline-no-barrier、meta 纯字面量的第二独立源。
- `https://raw.githubusercontent.com/ray-amjad/claude-code-workflow-creator/main/references/api-reference.md` —— 全部 API 级语义主源；多数单源细节出处。
- `https://github.com/ray-amjad/claude-code-workflow-creator` —— SKILL.md / patterns.md / validate-workflow.mjs。

---

*本报告是四份报告中的第 1 份。续读：报告 2（社区 skills/plugins）、报告 3（LLM-Compiler 谱系）、报告 4（异步并行执行方法论）。三者共同填补本报告第 8.3 节诊断出的两块机制空白。*
