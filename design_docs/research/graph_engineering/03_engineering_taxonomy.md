# 工程分类：Graph Engineering 是生命周期与控制面，不是画节点和边

> 本文把[社区术语](01_community_and_anthropic_evidence.md)与[学术谱系](02_academic_landscape.md)转化为可操作的工程判定。对 cc-master 的应用见[项目影响](04_cc_master_implications.md)。

## 操作性定义

**Graph Engineering** 是对 graph-shaped agent system 的完整生命周期与控制面进行工程化：

> 为节点、边、状态、资格、版本、调度、执行实例、证据、恢复、权限和评测建立可执行、可验证、可审计的契约。

这个定义刻意把重心放在 lifecycle/control plane，而不是图形表示。系统只有 `nodes[]/edges[]`、可视化画布、几个互发消息的 agents，或把一段 prompt 拆成方框，都不足以满足定义。

## 七个最低判定条件

一个系统要声称自己在做 graph engineering，至少应回答：

1. **Identity**：节点、边、plan revision、task、actor、attempt、artifact、claim 是否有稳定且不混同的身份？
2. **Semantics**：边表示数据依赖、控制顺序、资格、通信、证据、授权还是推测？这些边是否影响执行？
3. **State**：节点/attempt 的状态机、合法转移、retry 与 terminal 语义是什么？
4. **Validation**：执行或 mutation 前，谁检查语法、拓扑、工具可用、领域可行、证据与用户授权？
5. **Scheduling**：ready frontier 如何计算？如何联合资源、能力、成本、延迟、风险、WIP 与失败域？
6. **Revision/recovery**：新事实到来后如何生成版本化 change set、失效旧 artifact、复用安全 attempt、回滚或恢复？
7. **Provenance/acceptance**：最终 claim 如何回溯到来源、工具输出、artifact 与 human decision？provider/agent terminal 如何与 task done、delivery、Goal acceptance 分离？

[LLMCompiler](https://proceedings.mlr.press/v235/kim24y.html)展示显式依赖与 frontier execution，[SPIN](https://arxiv.org/abs/2605.14051)强调执行前 validator，[BPOP](https://openreview.net/forum?id=UAXQW194WT)展示 partial-order recovery，[W3C PROV-DM](https://www.w3.org/TR/prov-dm/)提供 provenance 基础；没有任何一篇现有论文完整覆盖以上七项。

## Loop 与 Graph 不是替代关系

### 三种 loop

| Loop | 所在 plane | 合理职责 | 不应承担 |
| --- | --- | --- | --- |
| Reason-act loop | 单 agent/node 内 | 局部探索、工具调用、短程纠错 | 全局依赖、长期记忆、最终验收 |
| Executor optimization loop | 单任务实现内 | proposal→measure→adjust→converge | 顶层 scheduler/authority |
| Orchestration control loop | graph control plane | observe→reconcile→verify→replan | 亲自完成各节点的业务工作 |

Cycle 本就是 graph 的结构；反复 evaluator-optimizer 也可以是 graph 中的一条反馈边。工程目标不是删除循环，而是**给循环设边界、状态、预算、终止条件和证据**。

### 推荐形态

```text
                        ┌──── human/authority decision ────┐
                        │                                   ▼
observe → reconcile → propose revision → validate → authorize
   ▲                                           │
   │                                           ▼
evidence ← artifacts ← attempts ← ready frontier of plan@revision
   │                    │
   └── provenance ──────┘

node 内部可运行 bounded loop；外层 control loop 驱动 graph lifecycle。
```

这比“loop→graph”更准确：执行数据面可以是版本化 DAG/状态机；控制面仍以循环处理环境变化、失败、HITL 和 replan。

## Graph 的五个 plane

### 1. Thought/search plane

节点是 thought/state，边是扩展、聚合、回溯或 critique。[Tree of Thoughts](https://proceedings.neurips.cc/paper_files/paper/2023/hash/271db9922b8d1f4dd7aaef84ed5ac703-Abstract.html)与 [Graph of Thoughts](https://ojs.aaai.org/index.php/AAAI/article/view/29720)属于此类。它们通常随 query 消亡，不应冒充 durable task graph。

### 2. Task/execution plane

节点是可执行 task，边决定数据、控制或资格前置条件；runtime 计算 ready frontier 并生成 attempts。[LLMCompiler](https://proceedings.mlr.press/v235/kim24y.html)、[Data Interpreter](https://aclanthology.org/2025.findings-acl.1016/)、[SPIN](https://arxiv.org/abs/2605.14051)属于此类。它是 orchestration 的主要数据面。

### 3. Communication/organization plane

节点是 agent/role，边是消息或影响路径。[Sparse MAD](https://aclanthology.org/2024.findings-emnlp.427/)、[AgentPrune](https://arxiv.org/abs/2410.02506)、[G-Designer](https://openreview.net/forum?id=LpE54NUnmO)说明拓扑影响成本/性能，但不定义 task lifecycle。

### 4. Workflow/program plane

节点是 LLM、tool、operator 或模块，边形成可编译/优化的程序。[DSPy](https://openreview.net/forum?id=sY5N0zY5Od)、[AFlow](https://arxiv.org/abs/2410.10762)、[AgentSquare](https://arxiv.org/abs/2410.06153)属于此类。它适合稳定、可复用的局部子结构，不必成为顶层动态 orchestration skeleton。

### 5. Evidence/provenance plane

节点是 entity/activity/agent/source/claim，边记录 used、generated、derived、attributed 等关系。[W3C PROV-DM](https://www.w3.org/TR/prov-dm/)、[Graph of Trace](https://aclanthology.org/2026.acl-demo.29/)与 [ProvenanceGuard](https://arxiv.org/abs/2607.01236)属于此类。它与 execution plane 应有关联，但不能合并成同一状态机。

## 边的语义分类

| Edge kind | 可执行含义 | 校验重点 | 常见误用 |
| --- | --- | --- | --- |
| Data dependency | 下游需要上游 artifact/input | schema、freshness、content contract | 只检查上游 status=done |
| Control order | 必须先后执行，即使无数据传递 | 必要性、并行损失 | 把习惯顺序伪装成硬依赖 |
| Qualification | review/approval/delivery 未完成不得解锁 | authority、review result、delivery proof | 将 terminal 直接当 qualified |
| Communication | 允许/要求消息流 | fanout、相关错误、信息泄漏 | 把消息边当 task dependency |
| Evidence/support | claim 由 source/artifact 支持 | 来源身份、覆盖、否证 | provenance laundering |
| Resource/conflict | 共享锁、预算、设备或失败域 | reservation、WIP、互斥 | 不在 DAG 中可见却并行冲突 |
| Human decision | 运行需用户选择/授权 | 决策包完整性、不可逆边界 | agent 自授权或用“无回复”代替批准 |
| Hypothesized | LLM 推断的候选依赖 | uncertainty、独立 validator | 未验证即固化为确定边 |

Typed edges 的价值不在类型名称，而在它们参与 validator、scheduler、recovery 与 acceptance。

## Graph 生命周期

### 1. Goal/contract formation

先定义 outcome、scope、acceptance、constraints 与 authority，再切图。否则 graph 只会更高效地优化错误目标。

### 2. Plan synthesis

将目标切为 task/artifact/decision，而不是横向技术层；标明依赖类型、完成条件、风险、成本和证据要求。LLM 生成的计划是 proposal，不是 truth；[LLM-Modulo](https://proceedings.mlr.press/v235/kambhampati24a.html)支持外部 verifier 的必要性。

### 3. Validation

分层校验，不把“acyclic”当作“可执行”：

```text
syntax → topology → identity/state → tool/capability
       → domain feasibility → evidence/qualification → authority/policy
```

[FlowBench](https://aclanthology.org/2024.findings-emnlp.638/)与 [SPIN](https://arxiv.org/abs/2605.14051)共同说明结构化 workflow 仍需验证；结构 validator 也不能替代领域正确性。

### 4. Scheduling/admission

拓扑 ready 是必要但不充分条件。[HEFT](https://doi.org/10.1109/71.993206)表明异构调度需考虑计算/通信成本；LLM agent 还需质量、quota、context、工具权限、风险和 WIP。Scheduler 应区分“可运行”“适合当前 worker”“获授权运行”。

### 5. Execution/attempt

Task 是意图，agent/worker 是 actor，attempt 是一次执行，artifact 是产物。Retry 创建新 attempt，不覆写旧证据。Actor terminal 只能说明执行者停止，不能自动说明 task 通过验收。

### 6. Observe/verify

机械状态、artifact、测试、review、delivery 与 Goal-level acceptance 分层。Evaluator 也可能错，需记录 evaluator/version/input；[TextGrad](https://www.nature.com/articles/s41586-025-08661-4)展示 evaluator 驱动优化，同时也暴露目标错设风险。

### 7. Replan/rewrite

触发条件包括环境变化、失败、HITL、新依赖、成本偏移或目标修订。Rewrite 应生成 immutable revision/change set，包含 rationale、affected subgraph、artifact invalidation、attempt reuse、validator result 与 authorizer。整体重写且抹掉旧图不是可审计 replan。

### 8. Recovery/replay

Checkpoint 必须配合输入 fingerprint、dependency pins、副作用幂等与版本 fence。LangGraph [Graph API](https://docs.langchain.com/oss/python/langgraph/graph-api)对 replay/side effects 的要求说明，保存 state 不等于安全重放。[ToolMaze](https://arxiv.org/abs/2606.05806)进一步表明异常恢复是独立能力。

### 9. Acceptance/archive

完成 graph 中所有 nodes 也不一定完成 Goal；可能仍缺跨节点整合、delivery、用户选择或全局约束。Archive 应保留 plan revisions、attempts、artifacts、review/decision 与 provenance。

## 静态、动态与分布式的分类轴

| 轴 | 端点 | 工程含义 |
| --- | --- | --- |
| Structure | linear → DAG → cyclic/state machine → hyper/typed graph | 表达能力增加，也增加 validator/recovery 复杂度 |
| Mutation | immutable → append-only revisions → local rewrite → arbitrary rewrite | authority 与 invalidation 风险逐级上升 |
| Planning time | hand-designed → design-time search → query-time compile → runtime replan | “dynamic”必须注明发生阶段 |
| Control | centralized → hierarchical → blackboard → peer/distributed | 分布式不自动更可靠；SSOT 与冲突仲裁更难 |
| Determinism | deterministic nodes/edges → probabilistic work → probabilistic topology | uncertainty 必须可见并进入验证/成本模型 |
| Durability | ephemeral context → checkpoint → journaled attempts → replayable provenance | durable state 不等于 exactly-once |
| Authority | advice → shadow proposal → guarded writer → autonomous runtime | 每级需独立 evidence 与用户授权 |

## 典型架构模式

### Static validated DAG

适合已知步骤、可检查依赖和高复用任务。优点是并行、可预测和执行前拒绝；缺点是环境变化后计划脆弱。适用前提是 domain validator 与 recovery path。

### Versioned DAG + control loop

推荐的通用长程形态。Data plane 执行 immutable plan version；control plane 根据 observation 提出 revision 并校验；provenance plane关联版本、attempt、artifact。它兼容 HITL 和 fail-closed。

### Hierarchical orchestrator-worker

Lead 切分/整合，specialists 执行。[Anthropic multi-agent research](https://www.anthropic.com/engineering/multi-agent-research-system)是现实案例。优势是 context isolation 与并行；风险是 coordination、整合、成本和 lead 单点偏差。

### Blackboard/shared-state coordination

Actors 通过共同状态/claim 协调，适合异步工作；必须有 single writer/arbiter、租约、冲突处理与 provenance，否则 shared state 变成无审计聊天记录。

### Evaluator-optimizer graph

Generator→evaluator→revision，适合可测质量目标。需要独立停止条件、预算、evaluator calibration 与反 overfit；不能用 grader 自信代替 external acceptance。

### Compiled workflow + runtime gate

离线构造稳定 workflow，运行时根据 artifact 质量早退/改路由。[LLM-as-Scheduler](https://aclanthology.org/2026.acl-long.581/)提供条件性证据。风险是 gate 误判和重型 workflow 的 sunk cost。

## 失败模式

| Failure | 表面症状 | 根因/修复方向 |
| --- | --- | --- |
| Graph theater | 有图 UI，却无边语义/validator | 建可执行 contract，不再加视觉节点 |
| Category leakage | thought/communication 结果被当 execution 证据 | 分 plane、分 schema、限制 claim |
| Frozen wrong plan | 错误依赖被高速并行执行 | domain validation + runtime revision |
| Edge inflation | 所有关系都变硬依赖，parallelism 消失 | typed/qualified edges，移除习惯顺序 |
| Retry erases evidence | 重试覆写失败历史 | task/attempt 分离、append-only journal |
| Terminal=done | actor 退出即任务/Goal 完成 | qualification、delivery、Goal acceptance 分层 |
| Replay duplicates side effects | checkpoint 恢复后重复外部写入 | idempotency、action hash、dep pins |
| Graph churn | LLM 不断改图，执行无法收敛 | revision budget、minimum evidence、cooldown/approval |
| False consensus | 多 agent 沿通信边放大同一错误 | independent evidence、diverse review、provenance |
| Provenance laundering | claim 链看似完整，源头仍是无证转述 | source identity、support coverage、否证边 |
| Authority creep | shadow proposal 渐变成自动写/派发 | explicit mode、no-write spies、kill switch、HITL |
| Cost blindness | 节点更多、并发更多但 wall/token/variance 变差 | 联合成本模型与 matched-budget 对照 |

[MAST](https://arxiv.org/abs/2503.13657)、[SILO-BENCH](https://aclanthology.org/2026.acl-long.1354/)和 [Should We Be Going MAD?](https://openreview.net/forum?id=CrUmgUaAQp)分别提供验证/终止、无效通信和 topology 不稳定收益的限制性证据。

## 评价框架

不能只报 task success 或最佳一次运行。至少联合报告：

| 维度 | 指标例 |
| --- | --- |
| Quality | acceptance pass、artifact correctness、claim support coverage |
| Cost | input/output tokens、dollar、搜索/编译成本、并发资源 |
| Time | wall clock、critical-path latency、queue/admission wait |
| Reliability | run variance、retry rate、termination/verification failure |
| Recovery | time-to-recover、reused attempts、duplicate side effects、stale artifact rate |
| Graph health | churn/revisions、edge precision、ready parity、orphan/blocked rate |
| Human burden | interventions、decision latency、false escalation/missed escalation |
| Safety | unauthorized mutation/spawn、provenance gaps、injection propagation |

对照必须固定模型、工具、任务、预算和并发上限；应报告均值、方差、失败运行与 optimizer/search 成本。否则“graph 优于 loop”只是配置变化的混合效应。

## 工程决策准则

优先选最简单、能满足 acceptance 的结构。只有当新增 graph 机制解决了可测的依赖、并行、恢复、证据或权限问题，且收益覆盖 coordination/validation 成本时才升级复杂度。这与 Anthropic [Building effective agents](https://www.anthropic.com/engineering/building-effective-agents)的复杂度纪律一致。

具体到 cc-master，应按 `read model → shadow proposal → opt-in guarded writer/admission → live-proven runtime authority` 逐级晋升，详见[项目影响](04_cc_master_implications.md)和[研究议程](05_research_agenda.md)。
