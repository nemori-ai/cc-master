# 报告 3：LLM-Compiler 及并行 / DAG-based LLM agent 编排谱系

**日期**：2026-06-05
**定位**：四份报告中的"学术算法"层。报告 1 诊断出 Dynamic Workflow 在"主线程不空等"上的空白；本报告给出该空白的**最直接学术前身**——LLM-Compiler 的 **Task Fetching Unit（TFU）**，一个"依赖一就绪即分派、绝不为未就绪任务干等"的 dataflow 调度器。报告 4 把它抽象成 work-span/dataflow 通论，本报告则给它的 LLM 具身与可跑源码。

**证据分层**：**[H]** = 论文/源码直接引证（标 `[全文]`/`[源码]` 者为本研究亲自从 arXiv PDF 全文与 LangGraph 归档 notebook 源码逐条提取，非摘要）；**[M]** = 多个二手源一致；**[L]** = 单一二手源或推断综合。

---

## 0. 执行摘要

LLMCompiler（Kim, Moon et al., ICML 2024, arXiv:2312.04511）借**经典编译器**思想，解决 ReAct"每个 function call 都要 LLM 串行 reason-act"的延迟/成本/精度三重病。它把一次 agent 任务编译成一张 **task DAG**，由三件套执行：**Function Calling Planner**（出 DAG）→ **Task Fetching Unit / TFU**（依赖一就绪即分派 + placeholder 变量替换）→ **Executor**（并发跑），外加可选的 **Dynamic Replanning** 反馈环（LangGraph 落地为 **Joiner**）。`[H][全文]`

对本任务最关心的两点：
- **TFU = "dataflow 调度器"**：不是 barrier-style 的"等整批 plan 出齐再 fan-out"，而是**指令取指单元式**——每个 task 的依赖一旦在 observation 表里就绪，立刻派给 Executor，**绝不为已经能跑的 task 干等还没就绪的 task**。配合 **Streamed Planner**（Planner 边生成边吐 task），形成 CPU 流水线式的 plan/execute 重叠。这正是"最大并行 + 永不空转"的可直接借鉴范式。`[H][全文]`
- **Replanning = loop-until-converged**：Joiner 看完整图历史，**结构化二选一**——`FinalResponse`（收尾）或 `Replan`（带 feedback 回 Planner 重编译新 DAG）。这是 dynamic/iterative workflow 内循环的原型。`[H][源码]`

实测（vs ReAct）：延迟最高 **3.74×**、成本最高 **6.73×**、精度最高 **~9%**；WebShop 上靠并行搜索 explore 拿到 **101.7×** 加速。`[H][全文]`

---

## 1. 核心论文：An LLM Compiler for Parallel Function Calling

**元信息** `[H]`：arXiv:2312.04511，v3（2024-06-05），ICML 2024。作者 Sehoon Kim, Suhong Moon, Ryan Tabrizi, Nicholas Lee, Michael W. Mahoney, Kurt Keutzer, Amir Gholami（SqueezeAILab / UC Berkeley）。代码 `github.com/SqueezeAILab/LLMCompiler`。

### 1.1 动机：ReAct 串行范式的三重病 `[H][全文 §1-2]`

ReAct（见 §3.1）把每个 function call 做成一轮 `Thought → Action → Observation`，**每一步都要重新喂全部历史 token 给 LLM**。论文指出三大代价：
1. **Latency**：本可并行的 function call 被强制串行。招牌例子（Fig 2）——"微软市值要涨多少才超过苹果"——需搜 MSFT 市值、搜 AAPL 市值、再做除法；前两个搜索**互相独立、本该并行**，ReAct 却串行跑。
2. **Cost**：ReAct 每步重发整段 prompt + 历史 reasoning trace + 历史 observation，token 随步数**二次增长**。
3. **Accuracy**：ReAct 会**重复 function call / 提前停**（LLaMA2 实验里约 **20% 的样本出现重复调用**），交错的 reason-act 反而干扰推理。`[全文 §5.1]`

### 1.2 架构：四件套 `[H][全文 §3]`

借编译器隐喻——自然语言 query 被"编译"成可并行执行的指令流：

**(1) Function Calling Planner（§3.1）**：LLM 把 NL query 分解成一串 task，每个 task 带 `tool + args + 依赖`，构成 **DAG of task dependencies**。依赖通过 **placeholder 变量**表达——若 task `$3` 依赖 `$1`/`$2` 的输出，Planner 在 `$3` 的参数里直接写占位符。论文 Fig 2 的实际 Planner 输出（逐字）：
```
$1 = search(Microsoft Market Cap)
$2 = search(Apple Market Cap)
$3 = math($1 / $2)
$4 = llm($3)
```

**(2) Task Fetching Unit / TFU（§3.2）—— 全文最关键的工程贡献**：
- 灵感直接来自现代 CPU 的 **instruction fetching unit**。
- 职责一：**依赖一就绪即取指**——"fetches tasks to the Executor **as soon as they are ready** for (parallel) execution **based on a greedy policy**"（逐字）。
- 职责二：**变量替换**——把 task args 里的 placeholder（`$1`/`$2`）换成前驱 task 的真实 output。
- 关键论断：**"This can be implemented with a simple fetching and queuing mechanism without a dedicated LLM."** —— TFU **完全无需 LLM**，是纯确定性的 dataflow 调度器（逐字）。

**(3) Executor（§3.3）**：**异步并发**执行 TFU 取出的 task。核心保证：**"As the Task Fetching Unit guarantees that all the tasks dispatched to the Executor are independent, it can simply execute them concurrently."** 每个 task 有**独立 memory** 存中间结果，完成后 output 转回 TFU、解锁下游。Executor 持有的 tool 可以是计算器、维基搜索、API，**甚至可以是另一个专精 LLM agent**——这一句是它与 multi-agent orchestrator 的天然接口（见 §4）。

**(4) Dynamic Replanning（§3.4）**：执行图可能依赖"事前未知的中间结果"（类比程序里的 **branching**）。简单 if-else 可静态编译；复杂分支则需**重编译 / replan**——"intermediate results are sent back from the Executor to the Function Calling Planner which then generates a new set of tasks... This cycle continues until the desired final result is achieved."（逐字）。Game of 24（§1.5）是 replanning 的招牌案例。

### 1.3 Streamed Planner：流水线式 plan/execute 重叠 `[H][全文 §4.2]`

这是"orchestrator 永不空转"的论文级原型。问题：task 多时，Planner 生成全图会**阻塞 TFU 和 Executor**。解法——类比 CPU 的 **instruction pipelining**：让 Planner **异步流式吐出依赖图**，"allowing each task to be immediately processed by the Executor as soon as its dependencies are all resolved"（逐字）。

SqueezeAILab README 确认了工程开关 `--stream`——"improves latency by streaming out tasks from the Planner to the Task Fetching Unit and Executor immediately after their generation."`[H]`

实测收益（Table C.1）：streaming 带来最高 **1.3×** 额外延迟收益；在 ParallelQA 上最明显，因为 math 工具执行时间长，**正好把 Planner 生成后续 task 的延迟"藏"在工具执行后面**（HotpotQA/Movie 的 search 工具太快，藏不住，收益小）。

### 1.4 实测数字（真实数字，全文 Table 1/2/3 提取）`[H][全文]`

招牌聚合（abstract，逐字）：**"consistent latency speedup of up to 3.7×, cost savings of up to 6.7×, and accuracy improvement of up to ~9% compared to ReAct."**

| Benchmark | 模式 | 延迟 speedup vs ReAct† | 成本 reduction | 备注 |
|---|---|---|---|---|
| **HotpotQA**（多跳 QA） | 2-way 并行 | **1.80×**(GPT) / **1.40×**(LLaMA) | **3.37×** | OpenAI parallel-FC 只 1.61×；LLMCompiler 再快 ~35% |
| **Movie Recommendation**（8-way 并行） | embarrassingly parallel | **3.74×**(GPT) / **2.82×**(LLaMA) | **6.73×** | OpenAI parallel-FC 加速 2.76× |
| **ParallelQA**（自建 113 例，复杂依赖） | 混合依赖 | **2.15×**(gpt-4-turbo) / **2.27×** | **4.65×** | LLaMA2 上 ~9% 精度提升；ReAct 约 20% 重复调用 |
| **Game of 24**（ToT + replanning） | 动态 replan | **2.89×**(gpt-4) / **2.01×** | — | success rate 持平或略升；100 实例 |
| **WebShop**（决策任务，500 指令） | 并行 search/explore | **101.7×** vs LATS / **2.69×** vs LASER | — | +25.7% / +6% success rate vs ReAct |

模型覆盖：GPT（gpt-3.5-turbo / gpt-4 / gpt-4-turbo）与开源 LLaMA-2 70B。

> 注：论文用 **ReAct†**（加了抑制重复/早停的 prompt）作延迟对照，因原始 ReAct 的循环+早停让延迟不可预测、不公平。

### 1.5 Game of 24 = replanning 的范式样本 `[H][全文 §5.3]`

LLMCompiler 复刻 Tree-of-Thoughts 的 Game of 24，配三个 tool：`thought_proposer`、`state_evaluator`、聚合器。流程：(i) thought proposer 生成候选 partial solution → (ii) state evaluator **并行**评估保留 k 个 → (iii) **若没到 24 就 "replan"** 进入下一轮 BFS。论点：ToT 原本的串行 BFS 慢，LLMCompiler 把"提议 + 评估"并行化 + replanning 收敛，**质量不降、速度大升**。这正是 **loop-until-converged** 的 DAG 化实现。

---

## 2. 实现与生态

### 2.1 SqueezeAILab/LLMCompiler（原始仓库）`[H]`
三件套实现 + `--stream` flag；支持 OpenAI / LLaMA-2 70B(vLLM) / Azure / Friendli 端点。README 只给定性结论，精确数字在论文（已在 §1.4 提取）。

### 2.2 LangGraph LLMCompiler tutorial（官方 cookbook，源码逐行提取）`[H][源码]`

这是把论文落成可跑代码的权威参考，**对 orchestrator 设计最有借鉴价值**。LangGraph 把它建成三节点图：`plan_and_schedule → join → (条件边) → plan_and_schedule 或 END`。

**(1) Planner 流式吐 task**：每个 task 是 `{idx, tool, args, dependencies}`；args 里用 `${1}` 风格引用前驱 output。

**(2) TFU = `schedule_tasks`（最关键，逐行）**：
- **placeholder 解析** `_resolve_arg`，正则就一行：**`ID_PATTERN = r"\$\{?(\d+)\}?"`**——匹配 `$1` 或 `${1}`，从 `observations: Dict[int, Any]` 取真实值替换（逐字）。
- **依赖就绪即派 / 否则后台轮询**——核心调度逻辑（逐行复述）：
```python
with ThreadPoolExecutor() as executor:
    for task in tasks:
        deps = task["dependencies"]
        if deps and any(dep not in observations for dep in deps):
            # 依赖未就绪 → 丢线程池后台等
            futures.append(executor.submit(schedule_pending_task, task, observations, retry_after))
        else:
            # 无依赖 / 依赖全就绪 → 立刻派
            schedule_task.invoke(dict(task=task, observations=observations))
```
`schedule_pending_task` 是一个 `while True` 轮询：依赖未全在 observations 时 `time.sleep(0.25); continue`，否则执行。这就是 TFU"依赖一就绪即分派"的最小可用实现：**`ThreadPoolExecutor` 真并行 + 0.25s 轮询解阻塞 + observation dict 做 dataflow 黑板**。注释明说做了简化假设（LLM 不产生环 / 不产生指向未来的依赖），否则需要 proper topological sort（非 streaming 模式）。

**(3) Joiner（= 论文的 Dynamic Replanning，结构化二选一）**：
```python
class FinalResponse(BaseModel):
    response: str
class Replan(BaseModel):
    feedback: str  # 对前几次尝试的分析 + 需要修什么的建议
class JoinOutputs(BaseModel):
    thought: str                       # 选这个 action 的 CoT 推理
    action: Union[FinalResponse, Replan]
```
Joiner 用 `gpt-4o` + `with_structured_output(JoinOutputs, method="function_calling")` 看完整图历史后**二选一**。决策被编码成 LangGraph 条件边：
```python
def should_continue(state):
    if isinstance(state["messages"][-1], AIMessage):  # Joiner 给了 FinalResponse
        return END
    return "plan_and_schedule"   # Joiner 给了 Replan → 回去重编译新 DAG
```
**`Replan.feedback` 是带回 Planner 的"为什么没收敛 + 下一步修什么"**，正是 loop-until-converged 的关键信号载体。

### 2.3 后续/生产采用 `[M]`
- LangChain 官方博客《Plan-and-Execute Agents》把 LLMCompiler 列为三大 planning-agent 架构之一（Plan-and-Execute / ReWOO / LLMCompiler），称 TFU "schedules tasks once their dependencies are met"，引用 **3.6×** speedup。
- 社区 PyPI `llmcompiler`（crazyyanchao 版）把它包装成"DAG 加速 agent 任务 + 减少 LLM 调用省 token"的通用架构 `[L]`；衍生项目 `LLMCompiler-Pro` `[L]`。

---

## 3. 谱系与相关工作（每个对照 LLMCompiler + Claude Code dynamic workflow）

### 3.1 ReAct（Yao et al., 2022, arXiv:2210.03629）—— sequential baseline `[H]`
`Thought → Action → Observation` few-shot 交错。**ReAct 是 LLMCompiler 的对照基线**，每个 tool call 一轮 LLM、强制串行、token 二次增长。vs CC dynamic workflow：CC 的"一步步推进 + 看结果再决定下一步"本质上是 ReAct 的高级化身——**灵活但串行**。LLMCompiler 提出的问题正是 CC 编排可借力的：**能并行的子任务不该被 reason-act 串成串**。

### 3.2 ReWOO（Xu et al., 2023, arXiv:2305.18323）—— planner/worker/solver 解耦 `[H][全文]`
- **三模块**：**Planner**（一次性出全 blueprint，含 `(Plan, #E)` 元组序列）→ **Worker**（按 plan 取证据，填 `#E1`/`#E2` 占位符）→ **Solver**（综合 plan + 证据出终答）。
- **占位符机制**：`#Es`（步骤 s 的证据变量），后续步骤引用前面的 `#E`。实例（逐字）：
  ```
  #E1 = Wikipedia[The Hennchata]
  #E2 = LLM[What is the main ingredient of The Hennchata? Given context: #E1]
  #E3 = Wikipedia[#E2]
  ```
- **关键差异（vs LLMCompiler）**：ReWOO 的 plan 是**一次性、无 observation 反馈**（"reasoning WithOut Observation"）——Planner **盲规划**（不看任何中间结果），Worker 按序填证据（论文里 sequential），**没有 TFU 式的依赖图并行调度，也没有 replanning**。它省 token 靠**消灭 per-step observation 回灌**，不是靠并行。
- **真实数字** `[全文 §3.2]`：6 个公开 benchmark 平均 **token 省 64% + 绝对精度 +4.4%**；招牌是 HotpotQA 上 **5× token 效率 + 4% 精度**。还能把 reasoning 蒸馏 fine-tune 进 LLaMA-7B。
- **三者对照**：ReWOO = "盲规划 + 序列填证据 + 一次综合"，LLMCompiler = "盲规划 + DAG 并行调度 + 可 replan"。LLMCompiler 把 ReWOO 的"Planner/Worker/Solver"升级成"Planner/TFU+Executor/Joiner"，**加了并行调度和反馈环**。

### 3.3 Plan-and-Execute / Plan-and-Solve `[H/M]`
- **Plan-and-Solve**（Wang et al., 2023, arXiv:2305.04091, ACL 2023）：zero-shot CoT 改良——先"devise a plan 拆子任务"，再"按 plan 执行"，治 CoT 的 missing-step 错误。**纯 prompt 技巧，无工具/无并行**。
- **Plan-and-Execute agent**（LangGraph）：Planner 出多步 plan → executor 逐步调工具 → **replan**。vs ReAct 省"不必每个 tool call 都唤醒大 planner LLM"；但 **tool 仍串行**。
- vs LLMCompiler：Plan-and-Execute **有 replan 环、但无 DAG 并行**；LLMCompiler 在它基础上加 TFU 的并行调度。三者的 replan 语义高度同构（"看结果决定 finish vs 续规划"）——**这是 Claude Code dynamic workflow 内循环的共同祖先**。

### 3.4 Skeleton-of-Thought（Ning et al., 2023, arXiv:2307.15337）—— parallel **decoding** `[H/M]`
先让 LLM 出**骨架**（要点列表），再**并行**展开每个要点，最后聚合。**关键区分**：SoT 并行的是**单次生成内部的内容展开**（decoding 层），**不是 function call / tool 层**，与 LLMCompiler 正交。借鉴点：**"先出骨架再并行填充"**可类比"先出 task DAG 再并行执行"——骨架 = plan，要点 = 独立 task。

### 3.5 Tree-of-Thoughts / Graph-of-Thoughts —— 结构化推理拓扑 `[H/M]`
- **ToT**（Yao et al., 2023, arXiv:2305.10601, NeurIPS 2023）：推理建成**树**，节点是"thought"，用 BFS/DFS + self-evaluation + 回溯做 deliberate search。
- **GoT**（Besta et al., 2023, arXiv:2308.09687, AAAI 2024）：推理建成**任意图**，支持聚合多 thought、蒸馏整网、**反馈环**；排序任务上比 ToT 质量 +62% / 成本 -31%。
- vs LLMCompiler：ToT/GoT 的图是**推理拓扑**（探索解空间），LLMCompiler 的 DAG 是**执行拓扑**（编排 function call）。但 LLMCompiler §5.3 **把 ToT 跑在自己的 replanning 引擎上**——证明"执行 DAG 调度器"可**承载**"推理搜索拓扑"。**对 CC 的启示：workflow 引擎应能同时表达"做什么的依赖图"和"探索什么的搜索图"。**

### 3.6 异步 / speculative function calling `[H/M]`
- **AsyncLM**（Gim, Lee, Zhong, Yale, 2024, arXiv:2412.07017）：在**推理层**做异步——function 返回时往 LLM token 生成流**注入 interrupt token**，让 LLM **边生成边并发执行 function call**，不阻塞推理；Berkeley Function Calling Leaderboard 上端到端延迟降 **1.6×–5.4×**。vs LLMCompiler：LLMCompiler 在**编排层**并行，AsyncLM 在**解码层**并行，两者可叠加。
- **OpenAI / Anthropic parallel tool calling**：API 原生支持单轮返回**多个并行 tool call**。LLMCompiler 实测**自己比 OpenAI parallel-FC 还快 ~35%**，因为后者只在"同一轮内"并行，无跨轮 DAG 调度 + 无 streaming planner。

### 3.7 Orchestrator-worker / multi-agent（应用层表亲）`[M]`
**Anthropic 多 agent research 系统**：**orchestrator-worker** 模式——lead agent(Opus 4) 分析 query、定策略、**并发 spawn 3-5 个 subagent**(Sonnet 4)，每个独立 context + 工具 + 轨迹，**两级并行**。内部评测比单 agent Opus 4 **高 90.2%**，但 **token 用量约 15×**，复杂 query 研究时间最多省 90%。vs LLMCompiler：Anthropic 系统的 **subagent ≈ LLMCompiler 的"Executor 里的 LLM-agent tool"**（§3.3 明说 tool 可以是专精 agent）。但 Anthropic 的并行是 **orchestrator 一次性 fan-out（barrier-ish）**，**不是 TFU 的"依赖就绪即派 + streaming"**——这正是 LLMCompiler 能补强 multi-agent 编排的地方。AutoGen / CrewAI / LangGraph 调度粒度多在 agent 层而非 function 层 `[L]`。

---

## 4. 综合 (a)：调度——TFU 的 dataflow 范式 vs barrier fan-out【最核心关切】

**问题**：一个 workflow orchestrator 怎么"让执行最大并行、永不空转"？
**LLMCompiler 的答案 = 把 orchestration 当 dataflow/topological scheduling 做，而非 barrier fan-out。**`[H][全文 §3.2/§4.2 + 源码]`

| 维度 | **Barrier fan-out**（朴素并行） | **TFU dataflow 调度**（LLMCompiler） |
|---|---|---|
| 何时派任务 | 等**整批**就绪 → 一起派 → 等**整批**回 → 下一批 | **每个 task 的依赖一就绪就单独派**，不等同批别人 |
| 空转风险 | 高：批内最慢拖死全批（队头阻塞）；plan 没出完啥都不能动 | 低：能跑的立刻跑；Planner 边出边派（streaming） |
| 类比 | `asyncio.gather` 一个 barrier 接一个 barrier | CPU **乱序执行 / 指令取指单元** + 流水线 |
| 实现 | fan-out + join 同步点 | observation 黑板 + 依赖检查 + 就绪即 submit |

**TFU 的"依赖就绪即分派"机制（dataflow）**：
1. **observation 黑板**：`observations: Dict[task_idx, result]` 是共享 dataflow 状态。
2. **就绪判定**：task 的 `dependencies` 全在 `observations` 里 = 就绪。
3. **就绪即派**：无依赖/依赖全就绪的 task **立刻** submit 给并发 Executor；未就绪的 **不阻塞**别人——丢后台轮询，依赖一到立刻跑。
4. **placeholder 替换**：派之前把 args 里的 `$1`/`${1}` 用 `ID_PATTERN` 正则换成真实 output。
5. **Streamed Planner（流水线）**：Planner **不等全图出齐**，边生成边喂 TFU；Executor 跑前面 task 的时间**正好遮掩** Planner 生成后面 task 的延迟。

**映射到 Claude Code dynamic-workflow orchestrator（可直接落地）**：
1. **plan 表示成显式依赖图，而非线性 step 列表**——每个 step 声明它消费哪些上游 step 的产物（= placeholder / `${n}`）。有了依赖图，调度器才能算出"现在哪些能并行"。
2. **调度器做 topological / dataflow 调度，不做 barrier**：维护"就绪集"，**任一 step 依赖满足就立刻派 subagent**，**绝不因为同批某个 step 还在跑而让已就绪的 step 干等**——这是"orchestrator 永不空转"的算子级定义。
3. **planner 与 executor 流水线重叠**：orchestrator 在分派/等待已派任务时，**继续规划/组装后续任务的依赖图**——别等所有产出回来才想下一批。（与项目记忆"后台工作时主线程不空转、持续推进下一批 anchor 组装"**完全同构**——streamed planner 就是这条纪律的算法化身。）
4. **subagent = Executor 的 LLM-tool**：论文明说 Executor 的 tool 可以是"tailored LLM agent"——你的 orchestrator 可把每个 leaf task 派给 opus/sonnet/codex subagent，**TFU 调度逻辑原封不动复用**。
5. **粒度选择**：barrier fan-out 适合**真·embarrassingly parallel**（Movie Rec 8-way，无依赖）；**有依赖时 TFU 才显威**（ParallelQA pattern b/c）。orchestrator 应按 task 依赖结构**自适应**——无依赖批量 fan-out，有依赖走 dataflow。（呼应项目记忆"调度策略路由：按 task 性质/scope/耦合度选 single vs fork N-way"。）

> **与报告 1/4 的接力**：报告 1 §3.2 的 `parallel` vs `pipeline` smell test，在这里有了学术名字——`parallel` 是 barrier fan-out，`pipeline` 是 TFU 式 dataflow。报告 4 §1.5 的 dataflow"dispatch when ready"、§2.8 的 work-stealing，是 TFU 的通用理论母体。

---

## 5. 综合 (b)：Replanning——Joiner 的"收尾 vs replan" → loop-until-converged

**机制** `[H 全文 §3.4 + 源码]`：
- **触发**：执行图依赖事前未知的中间结果（branching）。Game of 24 是典型。
- **决策者 = Joiner**：看**完整图历史**，结构化二选一 `JoinOutputs.action: Union[FinalResponse, Replan]`，附 `thought`（CoT）。
- **收尾**：`FinalResponse(response)` → 条件边返回 `END`。
- **replan**：`Replan(feedback)` → feedback 带"前几次尝试的分析 + 该修什么"回 Planner → 编译**新 DAG**（可引用旧 observation）→ TFU 再调度。循环直到收敛或撞 LLM 调用上限。

**映射到 dynamic / iterative workflow（内循环）**：
- 这是 **loop-until-converged** 的标准结构：`compile DAG → execute → Joiner 评估 → (收敛?) 收尾 : (带 feedback) 重编译`。
- **`Replan.feedback` 是关键设计**——不是简单 retry，而是**带诊断的重规划信号**。这正对应项目记忆里 dev-master-orchestrator 的"impl → review → orchestrator verify → 必要时 amender 回 review"内循环：**Joiner ≈ orchestrator 的 verify gate**，`Replan.feedback` ≈ 给 amender 的"需要修什么"。
- **静默放行陷阱**：项目记忆记过"null-review 静默放行已修"。LangGraph 的 `should_continue` 用**类型判定**（`isinstance(last, AIMessage)`）做收尾门——**结构化、非空判定**，正是防"空 review 被误当通过"的范式。Joiner 强制二选一（structured output），不允许模糊放行。
- **上限护栏**：内循环必须有**保险丝**（"until 撞 LLM 调用上限"，呼应项目记忆"内循环=保险丝"）。

---

## 6. 综合 (c)：确定性 / parallel function calling 正确性

**LLMCompiler 怎么保证并行不出错** `[H 全文 + 源码]`：
1. **依赖解析是确定性的、无 LLM**：TFU "without a dedicated LLM"——placeholder 替换 + 依赖检查纯代码（`ID_PATTERN` 正则 + dict 查表）。**LLM 只负责"出依赖图"这一次创造性工作，调度/替换/并发全是确定性算子。** 这是正确性的关键架构选择——把不确定性（LLM）和确定性（调度）**分层**。
2. **独立性保证**：TFU **只把"依赖已满足"的 task 派给 Executor**，所以可并发——**并发安全由调度器的依赖检查保证，不是靠运气**。
3. **数据依赖通过 placeholder 显式传递**：task 间数据流是**显式声明**的（`$3` 的 args 写 `$1`/`$2`），不是隐式共享可变状态——天然避免竞态。LangGraph 注释点了风险边界：假设"LLM 不产生环 / 不产生指向未来的依赖"，否则需 proper topological sort。
4. **竞态防护**：LangGraph 实现注释 "each task inserts a different key... to avoid race conditions"——每个 task 写 observation dict 的**不同 key**。
5. **错误隔离**：task 执行异常被 `try/except` 捕获、把 traceback 当 observation 存回——**单 task 失败不炸全图**（graceful degradation）。

**对 CC orchestrator 的启示**：
- **LLM 出图、代码调度**的分层是工业级编排的正解——别让 LLM 实时决定"现在派谁"，让它一次性出依赖图，调度器确定性执行。
- **显式数据依赖（placeholder）> 隐式共享状态**——subagent 间传产物要显式声明，避免隐式耦合/竞态。
- **每个 task 写不同 key + 异常转 observation** = 项目记忆"no silent failure"+"production-grade resilience"在编排层的落地。

---

## 7. 综合 (d)：四范式对照表

| 轴 | **ReAct** | **ReWOO** | **LLMCompiler** | **Claude Code Dynamic Workflow** |
|---|---|---|---|---|
| **谁来规划** | 无独立 planner，边想边做 | 独立 Planner（盲规划） | 独立 Function Calling Planner(LLM) | Orchestrator/主 agent(LLM) |
| **何时规划** | 每步即时 | 一次性、前置、全量 | 前置全量 + **streaming 边出边派** + **可 replan** | 前置 plan + 执行中按结果**动态 replan** |
| **DAG 静/动** | 无显式 DAG（隐式线性链） | 静态 DAG（`#E` 依赖，不变） | **静态 DAG + 动态 replan 重编译** | **动态**（执行中重规划/插入任务） |
| **并行机制** | **无**（串行 reason-act） | Worker 按序填证据（论文 sequential） | **TFU 依赖就绪即派 + Executor 并发**(dataflow) | subagent fan-out（多为 barrier，可向 dataflow 演进） |
| **replanning** | 隐式（每步重想） | **无**（盲规划到底） | **有**（Joiner: FinalResponse vs Replan loop） | **有**（核心特性，loop-until-converged） |
| **确定性** | 低（每步 LLM） | 中（plan 后较确定） | **高**（LLM 只出图，TFU/Executor 全确定性） | 中（orchestrator 决策含 LLM；verify gate 可结构化） |
| **粒度** | 单 function call | plan-step（证据级） | **task / function call**（细，可嵌 LLM-agent） | **task / subagent**（粗，每 leaf 一个 agent） |
| **token/cost** | 高（历史二次增长） | **低**（省 64%）—消灭 observation 回灌 | 低（省至 6.7×）—并行 + 少 LLM 轮 | 高（multi-agent ~15× chat） |
| **招牌指标** | baseline | HotpotQA 5× token / +4% acc | 3.74× 延迟 / 6.73× cost / +9% acc | 任务完成质量（非延迟优先） |

**一句话谱系演化**：ReAct（串行交错）→ ReWOO（解耦盲规划、省 token，但仍序列、无反馈）→ LLMCompiler（加 **DAG 并行调度 + streaming + replan 反馈环**）→ Claude Code dynamic workflow（把 task 换成 **subagent**、把 Joiner 换成 **orchestrator verify gate**、把 replan 换成 **dev-loop 内循环**）。**LLMCompiler 是 CC 编排在"并行调度 + loop-until-converged"两条轴上的直接学术前身。**

---

## 8. 给 OMNE dynamic-workflow orchestrator 的可执行 takeaways

1. **plan 表示成显式依赖 DAG**（每 task 声明上游 placeholder），而非线性 step 列表——并行调度的前提。`[H §3.1]`
2. **调度器走 dataflow 而非 barrier**：维护就绪集，**依赖一满足即派 subagent，已就绪的绝不为未就绪的干等**——"orchestrator 永不空转"的算子定义。`[H §3.2]`
3. **planner/executor 流水线重叠**：分派/等待时继续组装后续 DAG（= 已有的"主线程不空转"纪律的算法化）。`[H §4.2]`
4. **LLM 出图、代码调度的分层**：LLM 只做一次创造性规划，placeholder 替换 / 依赖检查 / 并发派发全确定性——正确性与可复现性的根基。`[H §3.2 + 源码]`
5. **loop-until-converged 用结构化 Joiner gate**：`Union[FinalResponse, Replan(feedback)]` 强制二选一 + 类型判定收尾 + 调用上限保险丝，防静默放行。`[源码]`
6. **subagent = Executor 的 LLM-tool**：TFU 调度逻辑对"tool 是函数"还是"tool 是 agent"无差别——multi-agent 编排可直接套 TFU 范式，把 Anthropic 的 barrier fan-out 升级成依赖感知 dataflow。`[H §3.3]`

---

## 信源清单（带可信度）

**核心论文（已抓全文 PDF 逐条提取，[H]）**
- LLMCompiler：Kim, Moon, Tabrizi, Lee, Mahoney, Keutzer, Gholami. *An LLM Compiler for Parallel Function Calling*. arXiv:2312.04511v3 (ICML 2024). https://arxiv.org/abs/2312.04511 ｜ PDF https://arxiv.org/pdf/2312.04511 ｜ 代码 https://github.com/SqueezeAILab/LLMCompiler
- ReWOO：Xu et al. *ReWOO: Decoupling Reasoning from Observations for Efficient Augmented Language Models*. arXiv:2305.18323. https://arxiv.org/abs/2305.18323

**实现（已抓归档 notebook 源码逐行提取，[H]）**
- LangGraph LLMCompiler tutorial（含 `schedule_tasks`/`_resolve_arg`/`ID_PATTERN`/`JoinOutputs`/`should_continue` 源码）：https://docs.langchain.com/oss/python/langgraph/ ｜ 归档原文 https://github.com/langchain-ai/langgraph/blob/23961cff61a42b52525f3b20b4094d8d2fba1744/docs/docs/tutorials/llm-compiler/LLMCompiler.ipynb
- LangChain blog《Plan-and-Execute Agents》(三方对照, 3.6× 引用) `[M]`：https://www.langchain.com/blog/planning-agents

**谱系（[H] 元信息 / [M] 内容）**
- ReAct：Yao et al. arXiv:2210.03629 https://arxiv.org/abs/2210.03629
- Plan-and-Solve：Wang et al. arXiv:2305.04091 (ACL 2023) https://arxiv.org/abs/2305.04091
- Skeleton-of-Thought：Ning et al. arXiv:2307.15337 https://arxiv.org/abs/2307.15337
- Tree-of-Thoughts：Yao et al. arXiv:2305.10601 (NeurIPS 2023) https://arxiv.org/abs/2305.10601
- Graph-of-Thoughts：Besta et al. arXiv:2308.09687 (AAAI 2024) https://arxiv.org/abs/2308.09687
- AsyncLM：Gim, Lee, Zhong (Yale). arXiv:2412.07017 https://arxiv.org/abs/2412.07017
- Anthropic 多 agent research 系统 `[M]`：https://www.anthropic.com/engineering/multi-agent-research-system

**可信度提示**：§1.4 全部 per-benchmark 数字、§1.2-1.3 算法描述、§2.2 全部代码细节均来自亲自从论文 PDF 与归档 notebook 逐条提取（标 `[全文]`/`[源码]`），可信度 [H]。谱系部分论文存在性与 arXiv ID 为 [H]，内容描述依赖搜索摘要为 [M]。

---

*本报告是四份报告中的第 3 份。它给出了"主线程不空等"的最直接学术前身（TFU dataflow 调度）与内循环原型（Joiner loop-until-converged）。配合报告 4（通用理论母体）与报告 1（CC 机制现状）一起读。*
