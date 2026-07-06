# 派发 —— executor 值 vs 后台机制 + 编排并行

> **何时读：** 给每个 task 定派给哪个 `executor`、再选你怎么真跑你负责执行的那些、并把这些道编排起来时——五个 executor 值 vs 三种后台机制、intra-vs-inter workflow、靠 escalation 重新定位（re-altitude）、admission control、**派发卫生 + watchdog/liveness 安全网（含 watchdog 工具降级链）**。

主线编排的核心：给每个节点定**谁执行**（board 上的 `executor` 值）、选你怎么把你负责执行的那些**真跑起来**（后台机制）、再把这些道编排起来。

## 目录

- [先分清两件事：executor 值 vs 后台机制](#先分清两件事executor-值-vs-后台机制)
- [分形的三个高度](#分形的三个高度)
- [两个尺度上的 dataflow](#两个尺度上的-dataflow--为何这些高度是自相似的)
- [五个 executor 值 —— board 上「谁执行」](#五个-executor-值--board-上谁执行)
- [三种后台机制 —— 你怎么真跑你负责执行的那些](#三种后台机制--你怎么真跑你负责执行的那些)
- [选择标准 —— 控制 / 综合 / context](#选择标准--控制--综合--context不是数量)
- [Intra vs inter workflow](#intra-vs-inter-workflow--轴--生命周期耦合)
- [靠 escalation 重新定位](#靠-escalation-重新定位core--绝不盲杀)
- [Hybrid + admission control](#hybrid--admission-control)
- [派发卫生](#派发卫生--一跑真并行就咬人的机械细节)
- [watchdog / liveness](#watchdog--liveness--给静默失败盲区配一张安全网)

---

## 先分清两件事：executor 值 vs 后台机制

派发一个 task，你在做**两个不同层面**的选择，别混为一谈：

- **executor 值**（board 上「谁执行」）—— 记在 task 上的一个 5 选 1 长期语义，扛 compaction、resume 靠它 recon。它回答「这个 task 归谁负责」：`subagent` / `workflow` / `master-orchestrator` / `user` / `external`。
- **后台机制**（「你怎么真跑你负责执行的那些」）—— 你此刻实际抄起哪个工具把活跑起来：Codex subagent / 后台 terminal session / Codex cloud task / 外部 scheduler 或 CI job / Codex app thread automation。它回答「怎么让它真的动起来」。

两层怎么对上：

- `subagent` executor → 明确要求 Codex spawn subagents / parallel agents，并记录可 recon 的 agent id / thread / task 引用。CLI / App 下这是官方产品能力；API / tool 会话下先用 `tool_search` 暴露 deferred multi-agent tools，看到并调用 `multi_agent_v1.spawn_agent` 后，才把返回的 agent id 当 handle。官方语义仍是只在你明确要求 subagents 或 parallel agent work 时 spawn，不要假设它会自动派发。
- `workflow` executor → 当前 Codex adapter 不支持 Claude Code Workflow API；不要把 `Workflow` / `agent()` / `parallel()` / `pipeline()` 当成 Codex 原语。需要 fan-out 时，用 Codex subagents 并在 prompt 中要求“spawn one agent per item, wait for all, summarize with artifacts”，或把每个叶子建成独立 board task。
- `external` executor → 后台 terminal session、CI run、GitHub issue、`codex cloud exec` task、系统 cron、systemd timer、Codex app automation 等可追踪工作。必须记录 session id / URL / run id / task id / automation 名称 / 日志路径，足以让后续 recon。
- `user` executor → surface 给用户；用户回答是 async 依赖。
- `master-orchestrator` executor → 只用于你的调度 / recon / 端点验收 / 记账，不用于实现工作。

**分工**：本文教**派发判断 + 后台机制**——选哪个 executor / 用哪个机制真跑 / 怎么编排并行。`executor` 各值的**必填字段**（`subagent`/`workflow` 必给 handle、`external` 必给引用）与**选值决策树**是 board 字段机制，归 `using-ccm`（其 board 模型指南）——本文指过去、不复述。

---

## 分形的三个高度

派发在三个高度上是分形的——选一个后台机制，就等于选一个节点在哪个高度执行：

- **顶层（主线）** = 一个 **dataflow 调度器**：把后台机制派到 DAG 节点上、并穿插 HITL，受 WIP + 一份共享预算约束，一切都记在 board 上。
- **中层** = 一个 workflow *内部*的 fan-out（`workflow` executor 的活）。
- **叶子** = 一个 sub-agent / shell（`subagent` executor，或一个等外部状态的 shell）。

---

## 两个尺度上的 dataflow —— 为何这些高度是自相似的

这三个高度不是三个想法——它们是**同一个 dataflow 想法（就绪即派、绝不在 barrier 处阻塞）在两个尺度上的两次现身**。把这点内化，你才能把同一个本能带进一个陌生情境，而不是去对照一张规则清单。

学术根源是 LLM-Compiler 的 **Task Fetching Unit（TFU）**：一条依赖在它的输入就绪那一刻就被派出去；已经能跑的东西绝不等一个还没就绪的；而且 planner 流式地吐图，让 plan 和 execute overlap。cc-master 在两个尺度上跑的是同一套算法：

- **宏观（主线）—— dataflow 作为一种内化的*心态*。** 决策程序*本身*就是一个手跑的 TFU：对账 board（observation 黑板）→ 派发就绪任务（fetch-when-ready）→ 在空隙里塞 fill-work（planner/executor overlap）→ 在端点验收（Joiner 闸）→ 唯有就绪集为空才等。这里**没有 `pipeline()` 原语**——主线 DAG 是动态的、异构的、里头还有个人，没有任何 compile-time 脚本能表达它。Dataflow 在这里以纪律存在（就绪即派、绝不在 barrier 干等），不是代码。
- **微观（Codex agent runtime 内部）—— dataflow 作为可追踪派发纪律。** Codex 当前没有 Claude Code Workflow API 的 `pipeline()` / `parallel()` 原语；微观 fan-out 用 Codex subagents、后台 terminal session、Codex cloud task 或外部 CI 来表达。API / tool 会话里先用 `tool_search` 感知 deferred subagent 工具，只有真实 spawn 后才记录 `agent id`。能固定成同构批处理时，要求每个 worker 返回统一 artifact / summary，并记录 agent id / session id / cloud task id / run URL；不要把 `Workflow` 代码示例当 Codex 可调用工具。

**两个尺度之间的切线，就是按动态性切的。** 必须运行中途随机应变的工作——对一个外部完成做出反应、把一个 escalation 重新定位、吸收一个 HITL 回答——归宏观尺度（board + 决策程序，LLM 在 loop 里）。能在 compile time 就固定下来的工作——一批同构项目流过固定 stage——归一个 `pipeline()`。这正是把 LLM-Compiler 那条切线 *"LLM 吐图、代码调度它"* 从单个 agent 任务放大到整场 long-horizon 编排：主线 LLM 做动态规划（吐图 + replan），workflow 脚本做确定性调度。自相似——一个尺度嵌在另一个里。

**防你过度套用的告诫。** `pipeline()` 优化的是*吞吐量*（许多同类项目穿过固定 stage）；而一个单一的 long-horizon 目标是一张*异构 DAG*，治理它的工具是**临界路径**（CPM / work-span），不是 pipeline 吞吐量。所以 pipeline 并行只是 cc-master 的一个**构件（constituent）**，不是它的顶层骨架：

- **临界链**定 makespan——pipelining 救不了一条串行依赖；
- 只有**非临界 float** 才是 pipeline / fan-out 能填的免费并行预算；
- **一批同类子任务**（迁移 N 个文件、review N 条 finding）才是它的主场。

顶层骨架是 dataflow DAG *调度*；`pipeline()` 只是项目恰好同构时它退化成的特例。在一条串行临界链上硬抓 fan-out 是经典的误套——T₁/T∞ ≈ 1 时，根本别 fan out。拓扑复杂、拿不准这条链到底是不是 T₁/T∞ ≈ 1（心算易错估）时，可 `ccm board graph` 机器读 `parallelism` 值佐证（何时机器算 vs 心算够用见 `decomposition.md` §3）；平凡图一眼看穿就别跑。

---

## 五个 executor 值 —— board 上「谁执行」

给每个节点定一个 executor 值。高层 min-max（默认把派出去的实现工作当 `subagent`、`master-orchestrator` 只留调度 / 验收给自己）在编排魂的决策模块；这里给逐值的语义 + 什么样的活配它：

- **`subagent`** —— 一个终端推理单元负责：单一证据面 + 单一推理链 + 单一交付物 + context-safe + 携带 escalation 路径。默认把独立、可并行的实现工作派给 Codex subagent；CLI / App 里显式要求 subagent，API / tool 会话里先 `tool_search` 发现并调用 `multi_agent_v1.spawn_agent`。必须记录真实返回的 agent id / thread / task 引用；没有真实 handle 就不能写 `subagent` / `in_flight`。
- **`workflow`** —— board 字段可保留这个 executor 值表达“结构化 fan-out/fan-in 工作”，但 Codex adapter 当前不支持 Claude Code Workflow API。需要多叶子确定性控制时，用 Codex subagents / 后台 terminal / cloud task 组合实现，并记录每个 handle；不要调用 `Workflow`。
- **`master-orchestrator`** —— **你自己**做的那几件不可外包的活：调度决策、replan、端点验收、整合。你不为它起后台机制——它就是你在指挥台上亲手做的。
- **`user`** —— 人类操作者负责：需判断 / 授权 / 拍板的（merge / 不可逆 / 对外 / 方向性）。surface 给用户、把回答当一条 async 依赖，别越权替他决。
- **`external`** —— session 外或 shell/session 中可追踪的工作：后台 terminal session、CI run、GitHub issue、Codex cloud task、系统 scheduler。用 session id / issue / CI URL / task id 指过去，靠 recon 查询进度；issue closed 只是待验收信号，验收 PR / commit / report artifact 后才 done。

> **反过度工程的对称护栏**：fan-out/fan-in 有协调成本。只有一条推理链 / 一份交付物 / 没有真正的并行证据面时，一个 Codex subagent 或一个后台 terminal session 就够了；别为了“像 workflow”而制造多 worker。

---

## 三种后台机制 —— 你怎么真跑你负责执行的那些

executor 值定了“谁负责”；在 Codex 下，真把活跑起来用这些 **agent runtime 可用**机制，按可追踪性优先：

- **Codex subagents / parallel agents** —— 默认并行派发方式，但先感知当前 surface。CLI / App 里按官方 subagent 语义显式要求 Codex spawn subagents；API / tool 会话里先用 `tool_search` 查 `multi-agent subagent spawn agent parallel workers`，只有看到 `multi_agent_v1.spawn_agent` 这类可调用工具后才算当前会话可派 subagent。派发时说明拆分方式、是否等待全部结果、每个 subagent 要返回什么 artifact / summary；把 spawn 返回的 agent id / thread / run 引用记录为 handle。没有真实 spawn 返回值，就不要把 board task 标成 `subagent` / `in_flight`。
- **后台 terminal session** —— 适合长跑 shell 命令、watch loop、构建/测试、轮询外部谓词。Codex agent runtime 已验证能启动后台 shell 并返回 session id，后续可 poll 输出与退出码；把 session id、命令、工作目录、停止条件、recon 方法写进 board。不要把“我发起了命令”当完成，只有 session 退出并经端点验收后才折回 `done`。
- **Codex cloud task** —— 用 `codex cloud exec` 把独立工作 offload 到 Codex Cloud；用 `codex cloud list/status/diff/apply` recon。记录 cloud task id / env id / prompt 摘要。
- **外部 scheduler / CI job** —— 用 cron、systemd timer、GitHub Actions、CI scheduler、issue/PR bot 等承担 session 外工作。记录 run id / URL / 取消方式。
- **Codex app thread automation** —— 官方支持 attached-to-thread 的 heartbeat wake-up；适合长命令检查、轮询 GitHub/Slack、继续 review loop。当前 agent runtime / CLI 没有稳定 automation 创建命令，所以只有当当前环境已经提供或用户能配置它时才把它作为 wakeup handle；不要伪造成 agent 可直接调用的 CLI primitive。

每个 `in_flight` task 必须有真实 handle。没有真实 handle，只能保持 `ready` / `blocked`，或标成 `external` 并写清 recon 方法。

### 等待外部状态 —— 用一个后台 shell

Codex agent runtime 可用后台 terminal session 等外部状态，但没有其他 harness 那种“后台 shell 完成后自动唤醒主线”的同名语义。等外部状态时，优先用可追踪后台 session；需要跨 session / 定时唤醒时，再用 scheduler：

```bash
# 由系统 cron / CI / systemd timer 等外部 scheduler 执行，用于跨 session watchdog
codex exec resume --last "cc-master watchdog: recon board, check <predicate>, update task handles"
```

同一 session 内的长跑命令记录后台 session id；跨 session 的 watchdog 记录 scheduler 名称、命令、run id、取消方式和 checklist。也可以在 Codex app 里创建 thread automation，让当前 thread 按分钟/每日/每周 cadence 醒来检查；但只有当前环境真实提供时才依赖它。不要只写“稍后回来”。

> **澄清（与 `async-hitl.md` 的「禁 busy-poll」并不矛盾）：** 那里禁的是**主线前台 busy-poll**——你在前台空转忙等。这里的后台 shell 轮询正交：轮询关进一个零 token 后台 shell、骑完成通知重入，主线腾出来去填等待窗口。后台等外部状态（荐）≠ 前台空等单个 agent（禁）。

---

## 选择标准 —— 控制 / 综合 / context，不是数量

别按有多少东西来选，按控制 / 综合 / context 来选。给一个待派节点，顺着问下去落到一个 executor：

- 需人判断 / 授权 / 拍板吗？**是 → `user`**（surface）。
- 已在 session 外别处跑 / 追踪？**是 → `external`**（引用追踪）。
- 是你自己不可外包的调度 / 验收 / 整合 / replan？**是 → `master-orchestrator`**。
- 需要推理吗？**否**（可机械检查）**→ 用后台 shell 跑**（该节点常是 `external` 追踪，或一个你要处置的信号）。
- 需要推理、且**终端 → `subagent`。**
- 需要**对多个叶子的确定性控制 → `workflow`。**

（各值的必填字段与完整选值决策树在 `using-ccm` 的 board 模型指南——本文只给派发判断，不复述字段机制。）

---

## Intra vs inter workflow —— 轴 = 生命周期耦合

当一个节点选了 `workflow` executor，下一个问题是把活收进**一个** workflow 还是**多个**。首要的轴是**生命周期耦合（lifecycle coupling）**，不是数量。

- **一个 workflow** —— 叶子共享同一条生命周期：同一个 goal / schema / 质量闸 / budget envelope / 综合点 / 可接受失败策略，且运行中途没有 HITL 需求。
- **多个 workflow** —— 这些流在优先级 / 失败模式 / 重启成本 / budget 上限 / escalation / 整合时机上各不相同，或者每个都需要独立的闸讨论。

HITL 只是诸多轴之一；失败隔离、优先级、整合时机同样重要。**中层**：一个带多 phase 的单 workflow；一层 `workflow()` 嵌套。

---

## 靠 escalation 重新定位（core）—— 绝不盲杀

一个 `subagent` executor 发现自己其实是一张 **sub-DAG** 时：

- **绝不能自我提拔、也不能自行 fan out**（workflow 叶子同样不能 spawn）；
- 它 **STOP 并返回一个 escalation 结果**（一张 scope map + 提议的叶子 + deps + 部分证据 + 原因）；
- 你 **supersede** 旧节点，并用那张 map 去 seed 一个 `workflow` executor。

你**靠 checkpoint 重新定位，不靠盲杀。** 推论：一个 workflow 叶子的 prompt 必须足够小、且终端；拿不准时，先跑一个 scoping subagent / workflow。

对应的节点状态路由：`uncertain → 验证节点`；`stale → 上游变了，重跑`；`escalated → supersede → workflow`。

---

## Hybrid + admission control

顶层可以同时有一个后台 shell + N 个 `subagent` + 一个 `workflow` 在飞。用 admission control 来治理它：

- **启动前先预留** —— 启动那一刻就预留 WIP + token budget（reserve-on-launch，不是 spend-then-report）。
- **WIP cap 把整合负担也算进去** —— 避免 N 个 workflow 一齐返回时的同步悬崖（synchronization cliff）。
- **并发上限 = 取 min**：CPU/IO、模型 budget、rate limit、context-return budget、综合负载，几者中的最小值。

---

## 派发卫生 —— 一跑真并行就咬人的机械细节

- **派发先于 board 标注，handle 是 `in_flight` 的唯一入场券。** board 标注与真实派发是**两个独立动作**：`Write` board 把一个 task 标 `in_flight` 只是改了**模型**，真正派出 worker 的是那次 `Agent` / `Bash` 工具调用。两者一旦顺序颠倒（先标板、再去发调用），就极易在多线程编排里漏掉那次调用——尤其当一个 sibling 的完成通知插进本拍、把你引去验收它时，那次未发的 dispatch 就这样蒸发了。**纪律**：先调工具拿 handle（agentId / shell handle）、再 `Write` board 标 `in_flight`（`subagent`/`workflow` executor 的 handle 写进该 task 当 worker 实证）。没有 handle 的 `in_flight` 是**幽灵任务（phantom）**——board 与自报都「显示在跑」、背后却没有活 worker，你在空等一个不存在的进程并据此**虚构进度**。**为什么软纪律不够**：这条教训即便写进 board log，也会在同一场编排的压力下**再次**复发——一次性 log 拦不住它，故它升进了魂的决策程序（dispatch / recon 节点）作常驻护栏。**地面真相验证法**（recon 时逐个对账每个 `in_flight`）：① 该 task 是否带一个真实 handle（agentId / shell handle）；② `git status` / 工具结果里是否有它的真实产物或 transcript；③ 三者皆空 = phantom，立即降级回 `ready` 重派——别信 board 的字面、别信自报，只信 git 与工具结果这层地面真相。
- **用绝对路径指向工作目标——绝不靠继承 cwd。** 你的 cwd 常常*不是*工作落地的那个 repo（你可能在从另一个 worktree 或一个父目录驱动）。每个被派发 agent 的 prompt 都必须给出指向目标的**绝对路径**、并告诉它别依赖继承来的 cwd——否则文件会落进错误的树。
- **单一提交者：叶子负责写 + 自测，你负责提交。** 各自 `git commit` 的并行 agent 会抢 git index。要求每个叶子**写它的文件、跑它的测试证明是绿的，但绝不 commit**；由你在端点验收、再按依赖序提交。（又是 end-to-end argument——commit 完整性归你的端点，不归叶子。见 `resume-verify.md`。）
- **对同一个共享可变文件的写者，跨波串行化。** 若几个任务都追加到同一个文件（一个共享测试文件、一个 registry），*同一*波里的两个会互相覆盖。把这些写者拆进**不同的波**，使任一时刻至多一个去碰那文件——你吸收这份协调成本，好让叶子保持独立、互不相交。

---

## watchdog / liveness —— 给静默失败盲区配一张安全网

派发卫生堵的是「board 标了却没真派」（phantom，见上面〈派发卫生〉）；**watchdog 堵的是它的下游孪生**——一个真派出去的 `in_flight` 任务**事后 hang 死 / 静默死**，或那个 phantom 一直没被戳穿，而你又走到了 `wait` 边。harness 的自动重唤起是 **completion-triggered**：只在任务**触发完成事件**时把你带回来，对「永不触发完成事件」的失败（hang / 静默死 / phantom）结构性失明（完整论证 + 「N 小时成功日志不是反证」的幸存者偏差，见 `async-hitl.md` §等待前 arm watchdog）。

**external issue tracking**：`executor=external` + `references.kind=issue` 的节点不在当前 session 里运行；issue URL 是 tracking anchor，让你回外部系统看进度。不要把 GitHub issue closed 当完成事件本身：closed 只说明外部侧声称收口，下一步是找到实际 artifact（PR / commit / report / release / CI run）并端点验收；验收前保持 `uncertain` 或其它非 done 状态。

**何时 arm**：走 `wait` 边前，剩余 path 里有 blocked 在**可能静默失败的 `in_flight`** 上的（不只是 awaiting-user），或关键 external issue 长时间没有外部进展 / 没有后续 artifact 可验 → arm 一个 watchdog 定时唤醒，间隔回来 recon 对地面真相。纯 awaiting-user 不 arm（按 mechanism 用、不按 ritual 用——触发条件与 board 双层记录见 `async-hitl.md`）。

**工具降级链（按优先级，缺则降级）**——ship-anywhere 诚实性：不同 harness 的唤醒能力不同，故教法是降级链 + 显式可用性提示，不假设某个工具名到处都在：

1. **后台 terminal session（当前 agent runtime 已验证）** —— 适合同一 session 内的长跑 shell / watch loop：启动后拿 session id，后续 poll 输出与退出码；board `wakeup` 记录 session id、命令、工作目录、predicate、取消方式。它是可用的 agent 能力，不是“用户产品面按钮”。
2. **Codex app thread automation（若当前环境可用）** —— 官方支持 attached-to-thread 的 recurring wake-up，适合检查长命令、轮询连接源、继续 review loop。当前 agent runtime / CLI 没有稳定 automation 创建命令；若用户环境提供 Codex app automation，就记录 automation 名称 / cadence / 停止条件。
3. **外部 scheduler + `codex exec resume`（脚本化 floor）** —— cron、systemd timer、CI scheduler、GitHub Actions 等调用 `codex exec resume <SESSION_ID>` 或 `codex exec resume --last`，提示它 recon board、检查 predicate、更新 task。适合跨 session 无人值守，但这是外部调度，不是 Codex-native in-thread timer。
4. **Codex cloud status loop** —— 对 offloaded cloud work，记录 `codex cloud exec` 返回的 task id，后续用 `codex cloud status/list/diff/apply` recon；调度这个 recon 靠后台 terminal、thread automation 或外部 scheduler。
5. **manual recon（诚实兜底）** —— 没有真实 wakeup handle 时，把 watchdog 写成 board 里的可续约定：下一次检查时间、predicate、负责人、取消条件。不要伪造自动唤醒。

被唤醒后 recon 用的就是上面派发卫生那套地面真相验证法（handle / `git status` / 工具结果），处置完静默失败的、该 re-arm 的 re-arm——细节在 `async-hitl.md` §等待前 arm watchdog。
