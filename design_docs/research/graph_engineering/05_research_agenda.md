# 研究议程：先形成反事实证据，再讨论 runtime authority

> 本议程把[工程分类](03_engineering_taxonomy.md)和[cc-master 缺口](04_cc_master_implications.md)转成可证伪研究，不授权产品、schema 或 runtime 变更。专栏总览见[README](README.md)。

## 研究原则

1. **术语不驱动路线**：只研究具体能力，不以“Graph Engineering”热度证明优先级。
2. **Matched-budget**：固定模型、工具、任务、token/美元预算、并发上限和验收；否则不能比较 loop/graph。
3. **先 read，后 advise，再 authority**：`read model → shadow proposal → opt-in guarded writer/admission → live-proven runtime authority`。
4. **Graph plane 不混同**：task、communication、workflow、attempt 与 provenance 分别评价。
5. **承认 evaluator 误差**：grader 版本、输入、阈值和校准必须记录；不让 evaluator 自证正确。
6. **报告失败和方差**：不能只报 best graph；包含搜索成本、失败运行、恢复成本和 human burden。
7. **Fail closed**：unknown capability、stale evidence、缺授权或 invalid revision 只能阻止晋级，不能自动放宽。

Anthropic [Building effective agents](https://www.anthropic.com/engineering/building-effective-agents)强调以可测收益决定是否增加复杂度；[LLM-Modulo](https://proceedings.mlr.press/v235/kambhampati24a.html)强调外部 verifier；[MultiAgentBench](https://aclanthology.org/2025.acl-long.421/)与 [Should We Be Going MAD?](https://openreview.net/forum?id=CrUmgUaAQp)共同否定跨任务的“最佳 topology”假设。这三类限制构成本议程的基线纪律。

## 优先级总表

| 优先级 | 研究包 | 产出 | Authority | 成功定义 |
| --- | --- | --- | --- | --- |
| P0 | Baseline & corpus | 固定任务集、现状 traces、成本/质量/恢复基线 | 只读 | 能复现当前手工决策与变异 |
| P0 | Execution/evidence read model | task→attempt→artifact→review/delivery→claim 查询 | 只读 | 不改变 writer/ready 语义，发现真实缺口 |
| P1 | Shadow next-node/route | 候选节点/worker/model + rationale | no-write/no-spawn | parity 高、收益可测、坏数据 fail-closed |
| P1 | Revision proposal | versioned diff、影响面、invalidation 建议 | no-write | 人工可审、可回放，避免 stale artifact |
| P1 | Recovery fence | fingerprint/dep pins/action hash 的 shadow diagnostics | 只读 | 发现 replay/staleness 且低误报 |
| P2 | Artifact-quality gate | 早退/改路由 shadow decision | no-write | matched-budget 降成本且 quality 非劣 |
| P2 | Partial-order mining | 历史 attempts 的候选并行边 | proposal only | validator 后提高并行且无依赖违规 |
| P2 | Cross-harness route simulation | capability/cost/risk forecast | simulation | 不虚构 capability，校准误差可控 |
| P3 | Guarded writer/admission | opt-in、可回滚的局部 mutation/claim gate | 受控写 | 仅在前序全部通过后立项 |

## P0：建立可以反驳自己的基线

### R0.1 固定任务集与 trace corpus

**问题**：cc-master 的现状是 graph-aware control loop，但缺可比较的 decision/attempt corpus；没有基线，任何新 scheduler 都可能只是在不同样本上自我证明。

**方法**：选取至少四类真实长程目标：高可分解、强外部依赖、HITL 密集、动态需求变化。记录 Goal Contract、board revisions（即使当前只能从操作日志重建）、ready frontier、dispatch rationale、agent/attempt、artifact、review/delivery、用户 decision、token、wall time、失败与恢复。

**测量**：Goal acceptance；cost；critical-path time；intervention；retry；stale artifact；false done；run-to-run variance。

**停止条件**：不能匿名化/复现关键 traces；或不同任务的 acceptance 无可比较定义。此时先改测量，不做 scheduler 实验。

### R0.2 集中式 execution/evidence read model

**假设 H0**：只读关联 task、agent、attempt、artifact、qualification、delivery 和 Goal acceptance，就能发现比“加新 graph node”更高价值的缺口。

**实验**：在不改变 board waist/ready semantics 的情况下生成 server-side read model；检查 orphan attempts、terminal-without-evidence、done-without-delivery、stale dependencies、unattributed claims。

**成功阈**：对黄金 traces 的关系重建具有高 precision/recall；前端无需推断业务状态；生产写入为零。

**否证**：read model 只能复述 board 状态，无法找到或解释任何验收/恢复缺口。

## P1：Shadow control plane

### R1.1 Shadow next-node scheduler

**假设 H1**：使用现有 ready/qualification、WIP、CPM、capability 和成本信号，可以在不降低验收质量的前提下减少 master 的机械 selection 负担。

**设计**：

- 输入冻结为 board/read-model snapshot；同输入重复运行必须 deterministic。
- 输出仅为 candidate chain、rationale、被排除原因和 confidence。
- spy 断言 no board write、no claim、no spawn、no account switch。
- 与 master 的实际选择做 counterfactual replay；不能用“后来成功”倒灌 scheduler 输入。

**指标**：ready/qualification parity、top-k agreement、avoidable idle time、critical-path impact、wrong-route severity、解释覆盖、abstention quality。

**晋级闸**：连续多个任务族满足 parity；unknown/stale capability 一律 abstain；没有高严重度越权建议；人类 baseline 之外有净收益。

### R1.2 Versioned graph-rewrite proposal

**假设 H2**：显式 `revision proposal = diff + rationale + affected subgraph + invalidation/reuse plan + validator results + required authorizer` 能降低动态 replan 时的证据丢失和 stale artifact。

**实验情境**：上游 artifact 失败、用户改变 acceptance、工具不可用、发现隐藏依赖、并行分支冲突。让 proposal 与现有 hand-run replan 并行，但不自动写 board。

**指标**：dependency correctness、artifact invalidation precision/recall、safe attempt reuse、review time、rollback completeness、revision churn。

**否证/停止**：proposal 频繁整体重写；无法说明旧 artifact 的有效性；或 review 成本高于手工 replan。

### R1.3 Resume/replay fence diagnostics

**假设 H3**：input fingerprint、dependency pins 与 action hash 的只读诊断可在恢复前捕获 stale/duplicate-risk action。

[LangGraph Graph API](https://docs.langchain.com/oss/python/langgraph/graph-api)对 replay/side-effect 幂等的要求和 [ToolMaze](https://arxiv.org/abs/2606.05806)对异常恢复的结果支持该问题的重要性。

**指标**：真实 stale action 检出率、false fence rate、重复副作用避免数、恢复延迟。

**晋级闸**：先 warning/shadow；只有 false block 率和 override 语义明确后，才讨论 hard fence。

## P2：条件化优化

### R2.1 Artifact-quality early-exit/routing

**假设 H4**：对已有稳定 workflow，中间 artifact 的校准 gate 可以减少不必要节点，且 quality 在预设非劣界内。

[LLM-as-Scheduler](https://aclanthology.org/2026.acl-long.581/)报告了条件性 token/latency 收益，但依赖 task-specific lite judge 和既有强 workflow，因此本实验不得直接外推其数字。

**对照**：同模型/同工具/同预算的 fixed workflow；按任务族分别校准，不跨域共享阈值。

**指标**：token、wall time、acceptance delta、false early-exit、judge calibration error、tail risk。

**停止条件**：高严重度 false exit；节省只来自降低质量；gate 成本吞没收益。

### R2.2 从成功 attempts 推断候选 partial order

**假设 H5**：多样化成功 traces 可发现过度串行的控制边，形成可验证的并行候选。

[BPOP](https://openreview.net/forum?id=UAXQW194WT)提供从 traces 推断 latent partial order 的强条件性证据；其限制同样适用：trace diversity 不足或错误偏序会漏前置条件。

**方法**：只生成候选边删除/弱化；domain validator、artifact contract 和 replay 对照全部通过后，才进入人工评审。

**指标**：edge precision、parallelism/critical-path 改善、dependency violation、recovery cost。

### R2.3 Route/capability simulation

**假设 H6**：显式区分 transport、capability、admission 与 authority，可改善跨 harness route 建议而不夸大支持面。

**场景**：unsupported Workflow、缺 live invoke、quota 紧张、provider terminal、stale registry。模拟器必须把 unknown/unsupported 作为硬限制，不生成虚构 fallback。

**指标**：capability truthfulness、forecast calibration、abstention、route regret、跨 harness parity gap 可解释性。

## P3：何时才允许讨论写权限

只有当一个 shadow 机制同时满足以下条件，才值得起草独立设计/ADR并向用户申请 opt-in authority：

1. 固定输入 deterministic，输出可复现。
2. 与现有 ready/qualification/authority 约束 parity。
3. unknown、bad data、stale evidence 均 fail-closed。
4. rationale、证据和被排除候选可查询。
5. matched-budget 多任务族相对人类/现状 baseline 有净收益。
6. 失败和方差完整报告，无 best-run cherry-pick。
7. 有 kill switch、rollback、append-only audit 与明确 blast radius。
8. provider/agent terminal 永不直接投影为 task done/Goal acceptance。
9. 跨 harness 能力经 live proof，不用单 host 成功代表 portable support。
10. 用户明确批准具体 authority scope；没有“研究通过即默认授权”。

## 联合评测协议

### 必报指标

| 面 | 指标 |
| --- | --- |
| Outcome | Goal acceptance、artifact correctness、claim/source support coverage |
| Cost | input/output tokens、dollars、optimizer/search cost、并发资源 |
| Time | wall clock、critical path、queue/admission wait、human decision wait |
| Reliability | variance、retry、verification/termination failure、false done |
| Recovery | time-to-recover、attempt reuse、duplicate side effect、stale artifact |
| Graph health | revision/churn、edge precision、ready parity、orphan/blocked |
| Human | interventions、review time、false/missed escalation |
| Safety | unauthorized write/spawn、policy violation、provenance gap/injection propagation |

### 比较纪律

- 使用相同模型、工具权限、上下文预算、并发上限和 acceptance。
- 区分 online execution cost 与 offline search/compile cost。
- 报告均值、分位数、方差、失败运行和超时，不只报 best。
- Topology、prompt、model、sample selection 逐项隔离，避免混合归因。
- Reviewer 不只看 green gate，还抽查 artifacts、provenance 和否证样本。

## 外部研究跟踪清单

### 术语与 Anthropic

- 对 Boris Cherny @Scale 原视频做 timestamp transcript 核验。
- 建立 2026-07 社区文章/帖子的可存档快照，区分首次发布与后续编辑。
- 定期检索 Anthropic/Claude 官方与员工是否明确采用、定义或否定“Graph Engineering”。
- 若未来出现官方采用，仍需区分命名与性能/架构证据。

### 学术

- 复核 2026 论文的最终发表状态、代码与独立复现。
- 跟踪 graph rewrite、artifact invalidation、uncertainty-bearing edges、HITL/cycle semantics。
- 寻找同预算、同模型、同工具的 loop-vs-explicit-graph 对照研究。
- 跟踪 execution/provenance schema 的联结标准，以及 graph 对 prompt injection/false consensus 的放大或抑制。

### cc-master

- 当 [run-store v2 contract](../../../design_docs/2026-07-15-run-store-capability-v2-contract.md)、[native-attempt spec](../../../design_docs/2026-07-13-codex-native-attempt-ledger-spec.md)或 [capability model](../../../design_docs/cross-harness-orchestration-capability-model.md)发生 production 状态变化时重做映射。
- 若 board narrow waist、route/admission、Workflow/native invoke、Goal/delivery 语义变化，更新[项目影响报告](04_cc_master_implications.md)，而不是只改执行摘要。

## 更新与停止规则

专栏应在以下事件触发复核：官方术语采用；可复现 benchmark；重要论文状态变化；cc-master 相关能力落地。更新必须保留旧检索截止与裁决变化说明。

如果连续实验只证明 read model 有价值而 shadow scheduler 无净收益，应停止 scheduler 路线，保留 diagnostics；如果复杂 graph 在 matched-budget 下不优于 bounded loop，应保留简单 loop；如果收益只在某任务族成立，应把它收窄为局部 workflow，不升级为通用架构。

这正是本议程的目标：允许 Graph Engineering 作为可证伪的工程假设，而不是不可反驳的时代口号。
