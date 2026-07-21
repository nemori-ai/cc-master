# 执行摘要：从 Loop 到 Graph，真正变化的是控制面

> 本文是专栏入口摘要。证据细节见[社区与 Anthropic](01_community_and_anthropic_evidence.md)、[学术谱系](02_academic_landscape.md)、[工程分类](03_engineering_taxonomy.md)、[cc-master 影响](04_cc_master_implications.md)与[研究议程](05_research_agenda.md)。

## 结论

截至 2026-07-21，可承重的结论不是“Loop Engineering 已死”，而是：

1. **新标签，旧谱系汇流。** “Graph Engineering”在 agent 社区中的明确用法至少可追到 2025 年，2026-04 出现直接主张 loops→structured graphs 的 position paper；本轮采集到的多条社区帖子自 2026-07-18 起集中出现。它聚合了 dataflow、DAG scheduling、workflow、multi-agent topology、checkpoint、HITL、provenance、evaluator 等长期存在的工程对象；现有样本不支持推断传播规模或网络效应。
2. **Anthropic 有 graph-like 实践，但没有可核验的 graph-engineering 术语采用。** Anthropic 官方公开了 workflow patterns、orchestrator-workers、multi-agent research、durable state、dynamic workflows、grader/trace 等机制，同时 Claude 官方在 2026-06-30 明确发布 loop engineering 教程。[官方材料](https://claude.com/blog/getting-started-with-loops)不能被外部分类改写成“Anthropic 已宣布从 loop 迁移到 graph”。
3. **学术界研究的是多种不同图。** thought/search graph、task/execution graph、communication graph、workflow/program graph 与 provenance/trace graph 的对象、结果和失败域不同；Graph of Thoughts 的收益不能证明 task runtime 正确，通信拓扑优化也不能证明依赖和验收正确。
4. **Graph 不自动胜过 loop。** MultiAgentBench 只在特定 research scenario 观察到 graph topology 最佳；MAD 研究发现 debate topology 并不稳定优于 self-consistency；AGORA 也显示简单 CoT 经常以更低开销保持竞争力。对应原始论文见[学术限制性证据](02_academic_landscape.md#限制性证据为什么-graph--loop-不成立)。
5. **真正的工程增量是 lifecycle/control plane。** 节点需要稳定身份、I/O 契约和状态机；边需要可执行的依赖/资格语义；计划需要校验、版本和 revision；执行需要 scheduler、attempt、artifact、恢复与权限；结果需要 provenance 和独立验收。只有画图不够。
6. **Loop 没有消失。** Cycle 本就是 graph；节点内部仍可执行 bounded loop；外层系统仍需要 `plan → validate → execute → observe → reconcile → replan`。更稳妥的目标是 **bounded loops inside an explicit, inspectable graph**。
7. **cc-master 已经有 graph-aware control loop 的结构基底，但不是完整执行/证据图。** Goal Contract、task DAG、deps/qualification-aware ready set 与 CPM 是当前可承重 substrate。Agent registry 只是有界登记/链接面；native-attempt ledger 为 partial 且 live invoke unsupported；production delivery gate 只作用于显式 declared edges；claim-level provenance 尚未闭环。主要缺口是 plan revision、机械 resume fence、durable run journal、自动 route/admission 闭环和更强 provenance，而不是缺一张 graph UI。

## 证据强度速览

| 判断 | 强度 | 为什么 |
| --- | --- | --- |
| Anthropic/Claude 明确采用 loop engineering | 强 | [Claude 官方教程](https://claude.com/blog/getting-started-with-loops)直接使用该命名 |
| Anthropic 实现多种 graph-like 模式 | 强 | [effective agents](https://www.anthropic.com/engineering/building-effective-agents)、[multi-agent research](https://www.anthropic.com/engineering/multi-agent-research-system)、[dynamic workflows](https://claude.com/blog/introducing-dynamic-workflows-in-claude-code) |
| Anthropic 采用“Graph Engineering”术语 | 未证实 | 本轮未检得官方或员工公开采用；阴性检索不能证明绝对不存在 |
| 社区正在从单一 loop 走向显式结构 | 中 | 多源文章与框架实践一致，但术语边界和传播历史仍不稳定 |
| 显式依赖能暴露并行、降低部分调用成本 | 强但有条件 | [LLMCompiler](https://proceedings.mlr.press/v235/kim24y.html)、[BPOP](https://openreview.net/forum?id=UAXQW194WT)、[SPIN](https://arxiv.org/abs/2605.14051)；前提是依赖和 validator 正确 |
| graph 普遍优于 loop | 不成立 | 缺同预算对照；多个限制性 benchmark 显示 topology/复杂度收益依任务而定 |
| cc-master 已有 task DAG/ready/CPM 结构 substrate | 强（仓内） | production engine/CLI、tests 与 accepted ADR 共同支持；agent registry、native-attempt、delivery 与 claim provenance 另按 mixed/partial 分级，详见[项目映射](04_cc_master_implications.md) |
| cc-master 产品更名 | 当前不支持；须用户决定 | 社区与官方术语采用证据不足；产品命名属于用户产品方向决定，不自动触发六条红线 |
| 中央 autonomous scheduler | 当前不支持；须用户决定 | 当前证据不足，且属于用户 product/authority 决策。只有具体设计破坏 conductor/executor 分离、改变 board waist，或把非 portable mechanism 当 universal floor 时，才分别触发红线 4、2、5 |

## 从术语争论转向工程问题

“loop 还是 graph”容易把不同尺度混为一谈：

```text
task-internal loop          外层 control loop
proposal → tool → observe   reconcile → dispatch → verify → replan
          │                           │
          └── graph node 内           └── 驱动 graph revision/lifecycle

task/execution graph        evidence/provenance graph
deps → ready → attempts     source → activity → artifact → claim
```

工程上更有价值的提问是：

- 哪些节点/边是 durable runtime object，哪些只是一次推理的临时结构？
- 边表达数据依赖、控制顺序、资格、消息、证据，还是用户授权？
- 运行时新事实使计划失效时，如何生成 revision、校验 diff、失效旧 artifact 并保留 provenance？
- task、agent、attempt、artifact、delivery 与 Goal acceptance 是否被错误合并？
- scheduler 是否联合考虑 ready、能力、成本、延迟、风险和 WIP，而不是只做拓扑排序？
- graph mutation 是否仍由清晰的 authority/HITL 边界控制？

[工程分类报告](03_engineering_taxonomy.md)将这些问题固化为可审计的判定标准。

## 对 cc-master 的分级含义

### Preserve

- 保留 Goal Contract 先于切图、board narrow waist 与 `ccm` single-writer。
- 保留 task/actor/attempt/delivery/Goal acceptance 的身份和状态分离；这是正确的模型边界，不表示相邻 runtime planes 已端到端闭环。
- 保留 qualification-aware ready set、HITL、Track A/B host honesty 与“指挥不演奏”。

### Strengthen

- 以 flexible-tier 的 plan revision/change set 研究动态 replan，不先扩 waist。
- 加强 input fingerprint/dep pins、registry completeness、attempt links 与 evidence freshness。
- 建立集中式 execution/evidence read model，并让 WIP/admission 先 shadow 后 hard gate。

### Experiment

- 只读 shadow next-node scheduler、route simulator、graph rewrite proposal。
- 基于中间 artifact 质量的早退/改路由；从成功 attempts 推断候选偏序。
- graph churn、recovery、provenance coverage 与成本—质量联合指标。

### Reject / Defer

- 因热词重命名产品，或宣称 graph 已替代 loop。
- 让中央 autonomous scheduler 取代 master/HITL。
- 让 LLM 点对点协商成为 SSOT，或把 terminal/done 等同 Goal acceptance。
- 把单一 host Workflow、云 routine、agent-teams 或外部 graph daemon 当 portable floor。

完整证据、红线影响和用户拍板边界见[cc-master 影响报告](04_cc_master_implications.md)。

## 建议的近程研究序列

先测量，再授予 authority：

1. **Read model/diagnostics**：机械展示 graph revision 候选、attempt/artifact/evidence 关系、churn 与 freshness。
2. **Shadow proposal**：与 master 的 next-node/replan/route 决策并行，保证 no-write/no-spawn。
3. **Parity 与反事实评测**：固定输入比较 ready/qualification、token、延迟、质量、恢复和方差。
4. **Opt-in guarded writer/admission**：仅在 deterministic、fail-closed、可解释、可回滚且有 kill switch 后讨论。
5. **Runtime authority**：只有跨 harness live proof 与用户单独批准后才可能晋级。

每项假设、指标和停止条件见[研究议程](05_research_agenda.md)。

## 最终判断

Graph Engineering 对 cc-master 有价值，但价值来自一面更严格的审计镜头：把原本由上下文和人工心智维持的依赖、资格、版本、执行、恢复、证据和权限，升级为显式、可查询、可验证的控制面。这个方向与 cc-master 高度相关；它不要求否定 loop，也不授权为了“更图”而扩大 schema、自动写图或弱化 master/HITL。
