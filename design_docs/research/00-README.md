# Dynamic Workflow 研究专辑

**主题**：系统梳理 Claude Code「Dynamic Workflows」机制，尤其是两个长期"没梳理清楚"的问题——**并行 workflow 如何编排**，以及 **workflow 在后台执行期间，主线程（编排者）如何持续推进而非空等**。
**日期**：2026-06-05
**产出形式**：四份独立报告 + 本导读。

---

## 为什么有这个专辑

Claude Code 在 2026-05-28 随 Opus 4.8 推出 Dynamic Workflows 后，"控制流反转 + 数百 agent 并行"的能力是有了，但**怎么用好**——并行结构怎么设计、后台跑着时主线程该干什么——缺一套梳理清楚的章法。本专辑从四个方向把这件事补齐：

1. **机制是什么**（报告 1）：把 Dynamic Workflow 的范式、原语、执行模型、journal/resume/determinism 吃透，并诚实诊断机制留下的空白。
2. **业界怎么做**（报告 2）：社区围绕该机制长出的 skills / plugins / 范式库，以及它们有没有触及"主线程不空等"。
3. **学术怎么解**（报告 3）：LLM-Compiler 及其 DAG-based 并行编排谱系——"依赖就绪即分派"的调度算法。
4. **工程与管理的底层原理**（报告 4）：软件工程、并行/并发计算、分布式系统、运筹学、项目管理里关于高效异步并行推进目标的成熟原理、算法、方法论。

---

## 如何阅读

| 报告 | 文件 | 你想解决的问题 | 读它 |
|---|---|---|---|
| 1 · 机制深度理解 | `01-claude-code-dynamic-workflow-mechanism.md` | "Dynamic Workflow 到底是什么、原语怎么用、`parallel` 和 `pipeline` 差在哪" | ✅ 先读这份 |
| 2 · 社区 skills/plugins | `02-community-skills-and-plugins.md` | "别人已经造了什么轮子、有哪些现成范式可抄" | 想立刻上手时读 |
| 3 · LLM-Compiler 谱系 | `03-llm-compiler-and-lineage.md` | "并行调度的学术原理、DAG 怎么排、何时 replan" | 想优化并行结构时读 |
| 4 · 异步并行方法论 | `04-async-parallel-execution-methodologies.md` | "如何分解目标、设界并行、让 orchestrator 不空转、廉价 resume" | 想建立完整方法论时读 |

**最短路径**：只想要"主线程不空等"的答案 → 报告 1 第 8 节（机制空白诊断）→ 报告 4 的综合那一节（可操作原则）→ 报告 3 的 Task Fetching Unit 一节（学术参照）。

---

## 贯穿全专辑的证据分层

所有报告统一用四档证据标注，**始终区分"行为契约"（机制对外承诺什么）与"内部实现机制"（runtime 内部怎么做）**：

| 档位 | 含义 |
|---|---|
| `[契约]` first-party-contract | 来自本 agent 当前被授予的 `Workflow` 工具 schema——描述原语表面的最权威一手来源 |
| `[官方]` official-confirmed | 已核对 `code.claude.com/docs/en/workflows` 或经核实的 Anthropic 员工发言 |
| `[社区]` community-inferred | 社区逆向（双源交叉印证较可信，单源应视为合理但未证实） |
| `[端口设计]` port-design | `langchain-dynamic-workflow` 这个社区 Python 端口的设计取舍，非对 Anthropic runtime 的镜像 |

报告 1 的一项核心增量，是用 `[契约]` 档把若干此前被逆向材料标为"单源未证实"的条目（`budget` 表面、`workflow()` 一级嵌套、`min(16, cores−2)` 并发、512KB 上限、`args` passthrough、determinism 三禁）升级为"接口层一手确认"——见报告 1 第 7.x 节对账表。

---

## 贯穿全专辑的两大关切，与四报告的接力地图

报告 1 第 8.3 节诊断出：Dynamic Workflow 机制**给了"主线程不空等"的能力（后台执行 + 完成通知），但没给方法论（等待期间做什么、如何与后台进度对齐）**。具体两块空白，由后三份报告分头填补：

- **空白①：workflow 启动后脚本结构固定、无 mid-run 输入** → "持续推进"在 workflow 内部是个编译期决策（写脚本时就定死并行结构）。
  - **报告 3** 取学术解法：LLM-Compiler 的 Task Fetching Unit「依赖就绪即分派」、Joiner 的 replan 决策，是把静态并行结构推向运行期自适应调度的参照。
- **空白②：主线程与后台 workflow 之间没有内建的"协同推进"协议** → 主线程等待期间做什么，全靠即兴。
  - **报告 2** 查生态：社区有没有 skill/plugin 专门解决"orchestrator 空转"，还是这是个空白。
  - **报告 4** 炼原理：CPM 关键路径、pipelining/look-ahead/double-buffering 重叠延迟、Little's Law/WIP 设界、build-system content-addressable cache 做廉价 resume——把"即兴"变成"有章法"。

---

## 各报告状态与核心发现

### 报告 1 · 机制深度理解 — ✅ 完成
**核心发现**：(1) 用 live 工具契约把多条社区"单源未证实"升级为接口层确认（对账表）；(2) 讲透 `parallel`（barrier）vs `pipeline`（streaming）的判别 smell test；(3) 把机制放进三个对照系（vs turn-by-turn subagent / vs LangGraph 显式 DAG / vs Prompt Flow 静态 DAG）；(4) 诚实诊断"主线程不空等"的两块机制空白，交棒给报告 2/3/4。

### 报告 2 · 社区 skills/plugins — ✅ 完成
**覆盖范围**：ray-amjad/claude-code-workflow-creator（SKILL.md / api-reference / patterns / validate-workflow.mjs）、Claude Code plugin marketplaces、superpowers 的 dispatching-parallel-agents / subagent-driven-development、官方 `/deep-research` 与 `/effort ultracode`、社区范式库与最佳实践、以及对 token 成本 / 弱 mid-run 控制 / orchestrator 空转的批评。
**核心发现**：(1) **"主线程不空等"是生态的明确空白**——官方只承诺主 session "responsive"（不被阻塞）而非 orchestrator "productive"（自驱找活），生态甚至把它降维成"完成通知可靠性"问题（一堆 GitHub issue，`BackgroundTasksIdle` 请求被官方 closed as not planned）；control-flow inversion 范式结构性地把主 agent 设计成 idle 收尾。**你的"主线程不空转"实践属于无人区，需自建。** (2) 生态唯一真正基于 runtime 的产物是官方 `/deep-research`，第三方"orchestrator/workflow"插件几乎全是 pre-workflow 时代的 subagent/hook 脚手架。(3) 触发词在 v2.1.160 从 `workflow` 改为 `ultracode`（纠正报告 1 基线）。

### 报告 3 · LLM-Compiler 谱系 — ✅ 完成
**覆盖范围**：LLM-Compiler 原论文（arXiv:2312.04511，Planner / Task Fetching Unit / Executor / Joiner，parallel function calling，实测 latency/cost/accuracy 真实数字）、LangGraph LLMCompiler 实现（逐行源码）、以及 ReAct / ReWOO / Plan-and-Execute / Skeleton-of-Thought / ToT-GoT / AsyncLM / orchestrator-worker 的谱系对照。
**核心发现**：(1) **TFU（Task Fetching Unit）= "主线程不空转"的最直接学术前身**——它是无需 LLM 的确定性 dataflow 调度器，"依赖一就绪即分派、绝不为未就绪任务干等"；配合 streamed planner（边出图边派）形成 CPU 流水线式 plan/execute 重叠。(2) **Joiner 的 `FinalResponse vs Replan(feedback)` 结构化二选一 = loop-until-converged 内循环原型**，且其类型判定收尾正是防"null-review 静默放行"的范式。(3) 谱系演化 ReAct→ReWOO→LLMCompiler→CC dynamic workflow 清晰可辨；实测 LLMCompiler 比 ReAct 延迟快至 3.74×、成本省至 6.73×。

### 报告 4 · 异步并行执行方法论 — ✅ 完成
**覆盖范围**：调度理论（CPM/PERT、Amdahl/Gustafson、Brent work-span、dataflow dispatch-when-ready）、并行并发模型（fork-join、MapReduce、futures、structured concurrency、actor、CSP、pipeline、work-stealing、backpressure）、分布式可靠性（orchestration vs choreography、saga、hedged requests、checkpointing、content-addressable caching、end-to-end argument）、build 系统（Make/Bazel/Ninja 的 DAG + 内容寻址缓存类比 workflow journal）、运筹与项管（TOC/Critical Chain、Little's Law、WIP/Kanban）、以及"让 orchestrator 不空转"专章。
**核心发现**：把空白填成可操作原理——(1) **latency-hiding** 是不空转的统一框架：用 look-ahead / speculative-prefetch / 重叠综合工作填满等待窗口；(2) **CPM critical path + work-span parallelism** 决定该投几路并行、盯哪条链；(3) **Little's Law + utilization cliff** 给出"为什么要 WIP 设界、把利用率压在 ~75%"的硬数学；(4) **build-system 的 content-addressable action key** 是 content-hash journal 廉价 resume 的最强类比；(5) **end-to-end argument** 论证"正确性校验必须在 orchestrator 端点独立做，agent 自报不可信"。

---

## 最终综合：给 Claude orchestrator 的可操作清单

把四份报告蒸馏成一组**直接指导 orchestrator（含本 agent 自身）编排行为**的原则。每条标注主要出处报告。

### 一、并行结构怎么选（报告 1 §3.2 + 报告 3 §4 + 报告 4 §B）

| 工作形态 | 选 | 为什么 |
|---|---|---|
| 多个**同构、无依赖**任务 | **fan-out / barrier**（`parallel`） | MapReduce map 阶段；barrier 合法因为 reduce 真需全集 |
| 多个走**相同多阶段流程**的任务 | **pipeline**（streaming，默认） | 消除队头阻塞；item 就绪即推进；orchestrator 始终满载 |
| **有跨任务依赖**的任务网 | **dataflow 调度**（TFU 式：维护就绪集，依赖一满足即派） | 绝不为未就绪任务让已就绪的干等 |
| **一条长串行依赖链**（parallelism≈1） | **sequential** | Amdahl：fan-out 无收益，省配额 |

判别口诀（报告 1 的 smell test）：`parallel → 无跨项依赖的 transform → parallel` 一定该改成 pipeline。barrier 只在"下游真需要整组前序结果"时才用。

### 二、主线程怎么不空转（报告 2 §b 空白 + 报告 3 §4 + 报告 4 §6——本专辑的 payload）

**生态没有现成解，这是自建机制。** 后台 workflow / agent 在跑时，orchestrator 从"有用工作池"取活填满等待窗口，**绝不 idle-poll 空等**：

1. **Look-ahead 规划下一阶段**（最高价值）：为下游 task 草拟 spec、grep 真实符号、预读文件、起草 reviewer prompt——批次完成即"即插即用"。
2. **Speculative prefetch**：对"八成会走的分支"提前准备，错了即弃。
3. **重叠自己的综合工作**：把 orchestrator 的串行职责（整合上批产出、更新 journal/progress、沉淀记忆、milestone review 决策）安排进后台执行窗口——这是 Amdahl 的串行段，必须和并行段重叠。
4. **Verify 上一批**（pipeline 错位）：批 N 跑实现时，独立 verify 批 N−1 的 gates。
5. **streamed planner 重叠**：分派/等待已派任务时，继续组装后续依赖图（报告 3 的 TFU streaming）。

**反模式（禁止）**：阻塞 sleep 轮询、手搓文件 size 轮询（已误报翻车）、什么都不做干等通知。**正确**：用 structured-concurrency 的 nursery join 等批次，等待期间持续产出。

> 本次任务即此原则的现场演示：3 个研究 agent 后台检索时，主线程没干等通知，而是依次写完报告 1、README、报告 4/3/2，每一步都在等待窗口内产出。

### 三、给并行设界（报告 4 §D + 报告 1 §4）

- **WIP 上限**（semaphore）：CC 机制本身已把并发 throttle 在 `min(16, cores−2)`；自建编排时也要显式设界。理由是 Little's Law + utilization cliff——别把利用率推到 100%，目标 ~75%，否则尾延迟与队列超线性爆炸、context/配额耗尽。
- **CCPM buffer**：别给单 task 藏余量，在 milestone/PR 级设共享 buffer（agent 工期高度不确定，聚合 buffer 比分散省）。

### 四、廉价 resume（报告 4 §E + 报告 1 §5）

- 每个 task 算 **content-hash**（spec + 上游产出 refs + 关键上下文）= Bazel action key；执行前查 journal，命中即复用已落盘 artifact、跳过。
- compaction/中断后 resume = O(变更集)，不是 O(全部)。
- **determinism 裂缝（AI 非确定性）**：缓存"已落盘且通过 end-to-end 校验的 artifact"，而非"重跑会一样"。CC 自身的 resume 是"longest unchanged prefix"——同序列前缀内容未变即命中。

### 五、内循环与正确性（报告 3 §5-6 + 报告 4 §3.7）

- **loop-until-converged 用结构化 gate**：`FinalResponse vs Replan(feedback)` 强制二选一 + 类型判定收尾 + 调用上限保险丝，防静默放行。
- **end-to-end argument**：正确性的最终校验必须由 orchestrator 这个端点独立做（独立跑 gates、read diff）——**agent 自报"全绿"不可信**，这不是冗余而是唯一可靠点。
- **LLM 出图、代码调度的分层**：让 LLM 一次性出依赖图，placeholder 替换/依赖检查/并发派发全确定性——正确性与可复现性的根基。

### 一句话守则

> 把目标当 DAG，沿 critical path 投资源；fan-out 同构任务、pipeline 多阶段流程、dataflow 调度有依赖任务网、串行长依赖链；后台跑着时用 look-ahead / speculative-prefetch / 重叠综合工作填满每一个等待窗口（绝不空转）；用 WIP 上限把利用率压在 ~75% 避开 latency cliff；用 content-hash journal 实现 O(变更集) resume；正确性校验永远在 orchestrator 端点独立做，不信 agent 自报。

---

*本目录由 OMNE-Next 在 worktree `research-dynamic-workflow` 中产出。四份报告 + 本导读已全部完成。报告 1 由主线程基于一手素材（含本 agent 自身 `Workflow` 工具契约）撰写；报告 2/3/4 由三个并行后台研究 agent 检索、主线程综合落盘——这一编排过程本身即"主线程不空等"原则的现场演示。*
