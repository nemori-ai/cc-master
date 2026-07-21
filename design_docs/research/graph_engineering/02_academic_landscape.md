# 学术谱系：不是一张图，而是五条研究线的汇合

> 检索截止：2026-07-21。本文优先引用论文页、正式标准、ACL Anthology、PMLR、OpenReview 与 arXiv。社区命名见[社区与 Anthropic](01_community_and_anthropic_evidence.md)，工程判定见[工程分类](03_engineering_taxonomy.md)。

## 结论先行

“Graph Engineering”还不是边界稳定的学术术语。直接提出 loops→structured graphs 的 [SGH](https://arxiv.org/abs/2604.11378) 是 position/design paper，作者明确没有 production implementation 或实证结果。更可靠的学术判断是：并发 dataflow、DAG scheduling、显式计划、推理搜索图、multi-agent communication topology、workflow/program optimization、动态调度、恢复与 provenance 等多条谱系正在汇合。

文献支持的方向是：**把可验证结构从不断增长的 LLM context 中提升为显式 runtime object，并为其添加 validator、scheduler、version、attempt、recovery 与 provenance**。文献不支持“图天然优于 loop”。收益取决于任务可分解性、依赖质量、验证器、成本模型、错误相关性与 benchmark。

## 五类 graph 对象

| 类型 | 节点 / 边 | 常见动态性 | Durable runtime graph？ | 不能越权证明什么 |
| --- | --- | --- | --- | --- |
| Thought/search graph | thought/state；扩展、聚合、回溯 | search-time dynamic | 通常否 | 不能证明 task/attempt/recovery 正确 |
| Task/execution graph | 可执行任务；数据、控制、资格依赖 | static 或 runtime versioned rewrite | 是 | 不能仅凭拓扑证明领域可行和低层执行可靠 |
| Communication graph | agent/role；消息、影响路径 | 固定、按输入生成、按轮裁剪 | 部分 | 不能证明 task ready、artifact、验收和 provenance |
| Workflow/program graph | LLM/tool/operator；计算/控制流 | 多为 design-time search 后部署，也可 runtime routing | 是 | benchmark 最佳 program 不等于通用最佳架构 |
| Provenance/trace graph | entity/activity/agent；used/generated/derived | execution-time append | 是，属于证据面 | 可观测不自动等于成功、安全或因果正确 |

这五类图可以在同一系统中并存，但不应压成一种节点/边。Execution graph 回答“下一步能否执行”；communication graph 回答“消息如何流”；provenance graph 回答“这个 claim/产物从何而来”。

## 动态性必须分层

- **Search-time dynamic**：每个 query 内生成 thought tree/graph，然后随回答结束而丢弃，如 [Tree of Thoughts](https://proceedings.neurips.cc/paper_files/paper/2023/hash/271db9922b8d1f4dd7aaef84ed5ac703-Abstract.html)与 [Graph of Thoughts](https://ojs.aaai.org/index.php/AAAI/article/view/29720)。
- **Design-time dynamic**：离线搜索、优化或编译 workflow，部署时冻结，如 [AFlow](https://arxiv.org/abs/2410.10762)、[ADAS](https://arxiv.org/abs/2408.08435)、[AgentPrune](https://arxiv.org/abs/2410.02506)。
- **Runtime dynamic**：根据执行中的 observation/artifact 增删节点、改路由或 replan，如 [Data Interpreter](https://aclanthology.org/2025.findings-acl.1016/)、[DeMAC](https://aclanthology.org/2025.findings-emnlp.757/)、[LLM-as-Scheduler](https://aclanthology.org/2026.acl-long.581/)。

“每个 query 动态生成一张随后冻结的图”不等于系统支持运行时 plan revision。Runtime dynamic 还需要 revision identity、结构/领域校验、artifact invalidation、attempt reuse、恢复语义和权限边界。

## 演化脉络

- **1974**：[Kahn process networks](https://www.cs.columbia.edu/~sedwards/papers/kahn1974semantics.pdf)为并发 dataflow 提供组合语义。
- **2002**：[HEFT/CPOP](https://doi.org/10.1109/71.993206)把 task DAG、异构 worker 计算成本与通信成本放入统一调度模型。
- **2013**：[W3C PROV-DM](https://www.w3.org/TR/prov-dm/)标准化 entity、activity、agent 以及生成、使用、派生和责任关系。
- **2022–2023**：[ReAct](https://openreview.net/forum?id=WE_vluYUL-X)成为隐式 reasoning-action-observation loop 基线；Plan-and-Solve、ReWOO 分离 planning 与 execution；ToT 外置搜索。
- **2024**：GoT、LLMCompiler、Data Interpreter、GPTSwarm、DSPy 把不同层面的 graph 变成程序对象；communication topology 成为独立变量。
- **2025**：ADAS、AFlow、AgentSquare 搜索 agent/workflow；AgentPrune、G-Designer、AgentDropout 优化通信图；FlowBench、MAST 暴露 planning、verification、termination 失败。
- **2026**：LLM-as-Scheduler、BPOP、SPIN、ToolMaze、Graph of Trace、ProvenanceGuard 分别探索动态调度、偏序恢复、图校验、异常恢复、可观测和证据追踪；SGH 直接提出 loops→structured graphs，但仍属 position paper。

## Primary-source 研究矩阵

等级说明：A 为同行评议论文或标准；B 为有实证/代码的 preprint；C 为 position/design/限制性论证。R5 最直接对应 execution/workflow runtime，R2 主要是 graph-shaped reasoning。论文中的百分比只代表各自实验设置，不跨论文横比。

### A. Loop、计划与 thought/search graph

| # | 工作 | 主要贡献 | 与 Graph Engineering 的边界 | 等级 |
| ---: | --- | --- | --- | --- |
| 1 | Kahn 1974, [Parallel Programming semantics](https://www.cs.columbia.edu/~sedwards/papers/kahn1974semantics.pdf) | 显式进程/通道的持续 dataflow 与组合语义 | 不处理概率节点、恢复或资源调度 | A/R3 |
| 2 | Topcuoglu et al. 2002, [HEFT/CPOP](https://doi.org/10.1109/71.993206) | DAG upward rank、异构计算/通信成本调度 | 假设成本可估、图已知；不能直接移植到 LLM quality | A/R4 |
| 3 | W3C 2013, [PROV-DM](https://www.w3.org/TR/prov-dm/) | entity/activity/agent provenance 与 bundle | 给证据模型，不给 agent runtime policy | A/R4 |
| 4 | Yao et al. ICLR 2023, [ReAct](https://openreview.net/forum?id=WE_vluYUL-X) | reasoning-action-observation loop；ALFWorld/WebShop 相对基线提升 | 计划/执行/记忆混在增长 context，无显式 deps/validation | A/R3 |
| 5 | Wang et al. ACL 2023, [Plan-and-Solve](https://aclanthology.org/2023.acl-long.147/) | 先生成线性 subtask plan 再求解 | 无工具状态、并行、replan，不是 runtime graph | A/R2 |
| 6 | Xu et al. 2023, [ReWOO](https://arxiv.org/abs/2305.18323) | Planner–Worker–Solver 与 interlinked references；HotpotQA 报告 5× token efficiency | 观察前冻结计划，异常恢复需另建层 | B/R4 |
| 7 | Yao et al. NeurIPS 2023, [Tree of Thoughts](https://proceedings.neurips.cc/paper_files/paper/2023/hash/271db9922b8d1f4dd7aaef84ed5ac703-Abstract.html) | 动态 thought search；Game of 24 报告 74% vs CoT 4% | 手工 decomposition、调用成本高；不是 durable task graph | A/R2 |
| 8 | Besta et al. AAAI 2024, [Graph of Thoughts](https://ojs.aaai.org/index.php/AAAI/article/view/29720) | thought 聚合/feedback graph；特定排序任务报告质量/成本收益 | 任务窄、图操作手工定义，无 worker/attempt/provenance | A/R2 |
| 9 | Kambhampati et al. ICML 2024 Position, [LLM-Modulo](https://proceedings.mlr.press/v235/kambhampati24a.html) | LLM 提议、外部 verifier/solver 验证 | 是“图需验证器”的限制证据，不是所有 LLM planning 的统一否定 | C/R4 |

### B. Task/execution、调度、恢复与 provenance

| # | 工作 | 主要贡献/结果 | 关键限制 | 等级 |
| ---: | --- | --- | --- | --- |
| 10 | Kim et al. ICML 2024, [LLMCompiler](https://proceedings.mlr.press/v235/kim24y.html) | query-specific tool DAG；planner–TFU–parallel executor；报告最高 3.7× latency、6.7× cost、约 +9% accuracy | 域有限，无 durable recovery/plan revision | A/R5 |
| 11 | Hong et al. Findings ACL 2025, [Data Interpreter](https://aclanthology.org/2025.findings-acl.1016/) | hierarchical task graph，运行中生成/优化节点；DABench 75.9→94.9% | 数据科学域；复合实现使因果归因混杂 | A/R5 |
| 12 | Xiao et al. Findings EMNLP 2024, [FlowBench](https://aclanthology.org/2024.findings-emnlp.638/) | 51 scenarios/6 domains 揭示 workflow planning 差距 | Benchmark，不是 runtime；直接反驳“给图即可靠” | A/R4 |
| 13 | Yu et al. ICAPS 2025, [DynTaskMAS](https://ojs.aaai.org/index.php/ICAPS/article/view/36130) | 动态 task graph、异步并行；报告时间 -21–33%、利用率 65→88% | ICAPS 2025 Algorithmic paper；单一框架/实验设置，外部效度与独立复现仍待检验 | A/R5 |
| 14 | Li et al. ICML 2026, [BPOP](https://openreview.net/forum?id=UAXQW194WT) | 从成功 traces 推断 latent partial order，frontier execution 复用 | 需 trace diversity；错误偏序可能漏前置条件 | A/R5 |
| 15 | Ozaki & Patel 2026, [SPIN](https://arxiv.org/abs/2605.14051) | validator 检查静态 DAG 与 prefix execution；AssetOpsBench 报告调用和完成率改善 | Preprint；结构 validator 不等于领域正确 | B/R5 |
| 16 | Hu Wei 2026, [Structured Graph Harness](https://arxiv.org/abs/2604.11378) | DAG、node state machine、planning/execution/recovery 分层 | 作者明确无 production implementation/empirics | C/R5 |
| 17 | Xiang et al. ACL 2026, [LLM-as-Scheduler authoritative PDF](https://aclanthology.org/2026.acl-long.581.pdf) | 既有 workflow DAG 上按中间 artifact 动态早退/改路由；权威 PDF 摘要为平均 token -50.5%、latency 超过 -36% | ACL HTML/XML 摘要的 token 数字为 43%，与 PDF 冲突；本表按 ACL 声明为权威版本的 PDF。方法依赖 task-specific lite judge 与强基础 workflow | A/R5 |
| 18 | Zhang et al. ACL Demo 2025, [AGORA](https://aclanthology.org/2025.acl-demo.11/) | 统一多类 graph reasoning/workflow 的评测引擎 | 简单 CoT 常以低开销保持稳健；demo 非随机对照 | A/R5 |
| 19 | Gao et al. ACL Demo 2026, [Graph of Trace](https://aclanthology.org/2026.acl-demo.29/) | 实时 trace graph 记录 tool/code/intermediate events | 提升理解/usability，不证明成功率或安全提升 | A/R4 |
| 20 | She et al. 2026, [ProvenanceGuard](https://arxiv.org/abs/2607.01236) | action–evidence support graph，tool call 前检查；安全 benchmark 报告改善 | Preprint；LLM judge 与来源真实性仍可能失效 | B/R4 |
| 21 | Zhu et al. 2026, [ToolMaze](https://arxiv.org/abs/2606.05806) | DAG topology 控制路径复杂度，异常时需 replan；隐式语义故障显著降低 PRR | 故障注入不覆盖全部生产异常；恢复增长慢于基础执行 | B/R5 |
| 22 | Aghzal et al. ACL 2026, [Why Web Agents Fail](https://aclanthology.org/2026.acl-long.1483/) | high-level plan、low-level execution、replan 三层分析 | 高层 plan 更精炼但低层 grounding/execution 仍是主瓶颈 | A/R4 |

### C. Multi-agent communication/topology

| # | 工作 | 主要贡献/结果 | 关键限制 | 等级 |
| ---: | --- | --- | --- | --- |
| 23 | Liu et al. COLM 2024, [DyLAN](https://openreview.net/forum?id=XII0Wp1XA9) | layerwise agent network、任务级选 agent、动态早停 | 优化 communication，不定义 task dependency runtime | A/R3 |
| 24 | Zhuge et al. ICML 2024, [GPTSwarm](https://arxiv.org/abs/2402.16823) | operation nodes + information-flow edges 的 composite graph | Proof-of-concept；搜索成本和跨任务稳定性有限 | A/R4 |
| 25 | Qian et al. ICLR 2025, [MacNet](https://arxiv.org/abs/2406.07155) | communication DAG/topological order，扩展至千级 agents | 重复调用不等于独立能力扩展 | A/R3 |
| 26 | Li et al. Findings EMNLP 2024, [Sparse MAD](https://aclanthology.org/2024.findings-emnlp.427/) | 稀疏静态通信拓扑可匹配/优于全连接，成本最高约 -53% | 只处理 static communication graph | A/R3 |
| 27 | Zhang et al. ICLR 2025, [AgentPrune](https://arxiv.org/abs/2410.02506) | spatial-temporal message graph 剪枝；报告显著 token/cost 降低 | 搜索成本、训练集依赖和鲁棒性需另算 | A/R3 |
| 28 | Zhang et al. ICLR 2025, [G-Designer](https://openreview.net/forum?id=LpE54NUnmO) | VGAE 按 query 生成 communication topology | 依赖训练/评价设置；不定义 task state machine | A/R3 |
| 29 | Wang et al. ACL 2025, [AgentDropout](https://aclanthology.org/2025.acl-long.1170/) | 按 round 裁剪 nodes/edges；报告 token 与表现改善 | 小数据 mask 未必是真正在线适配 | A/R3 |
| 30 | Liu et al. Findings EMNLP 2025, [DeMAC](https://aclanthology.org/2025.findings-emnlp.757/) | 随环境更新 task/coordination DAG | 单一 simulation 域，混合 task 与 communication graph | A/R4 |
| 31 | Zhu et al. ACL 2025, [MultiAgentBench](https://aclanthology.org/2025.acl-long.421/) | 比较 star/chain/tree/graph | graph 只在 research scenario 最好；无全局最佳 topology | A/R3 |
| 32 | Cemri et al. 2025, [MAST](https://arxiv.org/abs/2503.13657) | 1,642 traces、14 failure modes；verification/termination 是独立失败类 | 观察性/judge-assisted，但人工分类一致性较高 | B/R4 |
| 33 | Zhang et al. ACL 2026, [SILO-BENCH](https://aclanthology.org/2026.acl-long.1354/) | 54 configs/1,620 experiments；通信活跃不等于 distributed computation | role-free algorithm setting；>50 agents 的高级协作零成功 | A/R3 |
| 34 | Smit et al. ICML 2024, [Should We Be Going MAD?](https://openreview.net/forum?id=CrUmgUaAQp) | 多种 debate topology/protocol 不稳定优于 self-consistency/ensemble | 限于 debate，但构成“图不自动胜出”的直接反证 | A/R3 |
| 35 | Jiang et al. ACL 2026, [Guided Topology Diffusion](https://aclanthology.org/2026.acl-long.1764/) | 按任务生成稀疏 communication topology，多目标优化 | 受 proxy reward/benchmark 限制，只处理通信拓扑 | A/R3 |

### D. Workflow/program synthesis 与 optimization

| # | 工作 | 主要贡献/结果 | 关键限制 | 等级 |
| ---: | --- | --- | --- | --- |
| 36 | Khattab et al. ICLR 2024, [DSPy](https://openreview.net/forum?id=sY5N0zY5Od) | declarative modules 形成 computation graph，compiler 优化 demonstrations/parameters | 重点不是 durable scheduling/recovery | A/R4 |
| 37 | Yuksekgonul et al. Nature 2025, [TextGrad](https://www.nature.com/articles/s41586-025-08661-4) | 在 computation graph 反传自然语言 critique | 无数值梯度保证；依赖 evaluator，存在目标错设 | A/R3 |
| 38 | Hu et al. ICLR 2025, [ADAS](https://arxiv.org/abs/2408.08435) | meta-agent 生成 code-defined agent program | 不保证 DAG；搜索成本、评价泄漏、archive overfit | A/R3 |
| 39 | Zhang et al. ICLR 2025, [AFlow](https://arxiv.org/abs/2410.10762) | MCTS 离线修改 LLM node/edge workflow；六 benchmark 报告条件性提升 | 需计入搜索成本与方差，防 benchmark overfit | A/R4 |
| 40 | Shang et al. ICLR 2025, [AgentSquare](https://arxiv.org/abs/2410.06153) | Planning/Reasoning/Tool/Memory 模块演化重组 | workflow search 不等于 task lifecycle；surrogate 可偏置 | A/R3 |

## 跨论文综合

### 从隐式 loop 外置出来的职责

[ReAct](https://openreview.net/forum?id=WE_vluYUL-X)把 planning、scheduling、execution、recovery 和 memory 混在同一 context；[ReWOO](https://arxiv.org/abs/2305.18323)外置 planner/worker/solver；[LLMCompiler](https://proceedings.mlr.press/v235/kim24y.html)外置 planner/task fetcher/parallel executor；[SPIN](https://arxiv.org/abs/2605.14051)外置 generator/validator/prefix controller；[LLM-as-Scheduler](https://aclanthology.org/2026.acl-long.581/)外置 workflow/gate/scheduler；[BPOP](https://openreview.net/forum?id=UAXQW194WT)外置 trace/partial order/frontier executor；[ProvenanceGuard](https://arxiv.org/abs/2607.01236)外置 action/evidence/guard。

**本报告推断**：这条共同方向比“从 loop 换成 graph”更精确——将职责、契约和证据变成可检查的系统对象。

### 静态 blueprint 与动态控制面互补

静态 DAG 能暴露并行、减少重复上下文、在执行前拒绝部分坏结构；但 observation 晚到后，计划可能失效。可持续的架构更像两层：

```text
control plane: observe → propose revision → validate → authorize
                                  │
data plane:    immutable plan version → ready frontier → attempts → artifacts
                                  │                         │
provenance:    revision + inputs ─┴──── generated/used ────┘
```

Loop 上移为受约束的 control loop，并未消失。Static graph 需要 versioned recovery 层，否则只是更快地并行执行错误计划。

### Topology optimization 不等于 task engineering

Sparse MAD、AgentPrune、G-Designer、AgentDropout 证明消息路径会影响 token、性能和鲁棒性，但通常不定义：task 何时 ready、哪个 artifact 满足 dependency、attempt 如何恢复、谁有权限 rewrite、完成如何验证。这些结果能支撑 communication engineering，不能直接为 task DAG lifecycle 承重。

## 限制性证据：为什么 “graph > loop” 不成立

- [AGORA](https://aclanthology.org/2025.acl-demo.11/)显示简单 CoT 常以更低开销保持竞争力。
- [Should We Be Going MAD?](https://openreview.net/forum?id=CrUmgUaAQp)发现多种 debate topology/protocol 并不稳定优于 self-consistency 或 multi-path ensemble。
- [MultiAgentBench](https://aclanthology.org/2025.acl-long.421/)中 graph 只在 research scenario 最好，不存在跨任务普适 topology。
- [MAST](https://arxiv.org/abs/2503.13657)把 system design、inter-agent misalignment、verification、termination 区分为不同失败域；简单改 topology 未解决大部分失败。
- [SILO-BENCH](https://aclanthology.org/2026.acl-long.1354/)说明更多通信不自动产生分布式计算能力。
- [ToolMaze](https://arxiv.org/abs/2606.05806)表明 replan/fault tolerance 不会随基础执行能力等速增长。
- [Why Web Agents Fail](https://aclanthology.org/2026.acl-long.1483/)显示更精炼的高层计划仍可能被低层 grounding/execution 瓶颈吞没。
- [LLM-Modulo](https://proceedings.mlr.press/v235/kambhampati24a.html)强调 LLM-generated plans 需要外部 verifier，不能自我声称有效。

正确的对照不是 loop/graph 二选一，而是比较在固定模型、工具、任务、预算和验证条件下，哪些职责值得外置，付出多少协调/恢复成本，带来什么质量/延迟/方差变化。

## 对工程的可承重命题

| 命题 | 主要证据 | 限定 |
| --- | --- | --- |
| plan/execute 解耦可减少重复 context、暴露并行 | ReWOO、LLMCompiler | 任务域有限，依赖必须正确 |
| workflow 执行前需要独立 validator | SPIN、FlowBench、LLM-Modulo | 结构校验之外仍需领域/权限校验 |
| 固定重型 workflow 可能浪费资源 | LLM-as-Scheduler | 依赖可校准 gate 和高质量中间 artifact |
| recovery 是独立瓶颈 | ToolMaze、Why Web Agents Fail | 近期 benchmark，需生产复现 |
| communication topology 影响成本/鲁棒性 | Sparse MAD、AgentPrune、G-Designer、AgentDropout | 只限 communication graph |
| execution 与 provenance 应分层但关联 | W3C PROV、Graph of Trace、ProvenanceGuard | 标准 + 新兴实证；schema 仍在探索 |
| 异构调度不能只看 ready set | HEFT、LLM-as-Scheduler | LLM quality/cost 不满足传统确定性假设 |
| 成功 traces 可用于恢复候选偏序 | BPOP | 需多样 trace 与独立前置条件验证 |
| graph 的价值来自 lifecycle 而非表示 | 上述跨文献共同方向 | **本报告综合推断**，不是单篇论文原话 |

## 对 cc-master 的证据分级

- **强证据支持审计**：DAG 结构/领域校验；ready 与异构资源分离；task/agent/attempt 分离；plan revision 与恢复证据；token/latency/quality/recovery 联合测量；execution trace 与 claim/source provenance。
- **适合受控实验**：按中间 artifact 质量早退/改路由；从历史成功 attempts 推断候选偏序；局部 graph rewrite + artifact invalidation；按任务难度选择 model/agent/topology。
- **目前只宜研究**：LLM 自主生成并部署任意 workflow；以 GNN/diffusion 自动拓扑作为主线 scheduler；从单组 benchmark 推导通用架构；宣称 graph 让 loop、HITL 或 recovery 不再必要。

具体 Preserve/Strengthen/Experiment/Reject 与红线边界见[cc-master 影响](04_cc_master_implications.md)。

## 关键研究缺口

1. 缺统一但不混同的 graph IR：task、artifact、message、tool action、claim、human decision 不应全是一种 node。
2. 缺 rewrite 语义：新增依赖后哪些 artifacts 失效、哪些 attempts 可复用。
3. 缺 cycles/HITL/wait 的严格模型；静态 DAG 常以整体重生成绕开。
4. 缺 uncertainty-bearing edge；LLM 推断依赖常被写成确定事实。
5. 缺异构 model/worker 的质量—成本—延迟联合 benchmark。
6. 缺分层 validation：语法、拓扑、工具可用、领域可行、用户授权是不同检查。
7. 缺 execution/provenance 一体关联但概念分离的 schema。
8. 缺真实长程动态环境中的同预算 loop-vs-graph 随机比较。
9. 缺 causal evaluation；拓扑收益常混入 prompt、model、sample selection。
10. 缺完整成本与方差报告；离线搜索成本、并发资源、失败运行常被遗漏。
11. 缺安全研究；图既可限制错误，也可能放大 prompt injection、false consensus 与 provenance laundering。

这些缺口被转化为[研究议程](05_research_agenda.md)中的可证伪实验，而不是直接转成产品承诺。
