# 执行摘要：Skill 需要的不只是目录，而是证据绑定的知识生命周期

> 证据与展开见[官方规范](01_official_skill_format_and_harness_evidence.md)、
> [学术谱系](02_academic_landscape_2025_2026.md)、
> [工程分类](03_engineering_taxonomy.md)、
> [cc-master 映射](04_cc_master_implications.md)和
> [研究议程](05_research_agenda.md)。

## 一句话结论

推荐把 cc-master skills 建模为：

> **Markdown evidence floor + 稳定 knowledge ID/span markers + per-skill semantic manifest +
> 生成式 source map/runtime routers + 有 lineage 的 admission/maintenance loop。**

图负责身份、关系、导航和治理；Markdown 负责最终可读、可分发、可核验的知识正文。

## 八个可承重结论

1. **官方标准停在文件级。** Agent Skills 已定义 metadata → `SKILL.md` → resources 的渐进披露，
   但未定义一份文件内部多个知识点的身份、span、owner、typed edges 或 lineage。
2. **行号不能当身份。** 知识点需要稳定 ID；文件、标题、行列和 byte offset 都是由当前正文生成的
   projection。人工维护 `file + start_line + end_line` 会快速漂移。
3. **至少需要内外两层图。** 单个 skill 内部要表达 principle/decision/procedure/check/router 的关系；
   portfolio 外部要表达 dependency/compatibility/redundancy/alternative/ownership。
4. **至少需要读写两个循环。** task-time loop 负责检索、组合、读证据与行动；
   library-time loop 负责提议、验证、准入、修复、拆合、退役与 rollback。
5. **裸 `related_to` 不够。** 可行动边要表达 `when`、role、order、negative applicability、
   fallback 与 check；检索结果应是受预算约束、带角色的路径 contract，而不是相关文件堆。
6. **三跳是必要条件，不是充分条件。** `max shortest-path ≤ 3` 可以守住结构直径，
   但还必须单独守 context/token budget 和 agent 是否选对路径的行为 eval。
7. **图是原文的导航骨架。** graph summary 不能取代 knowledge span；最终判断必须能回到绑定的
   Markdown evidence。无法覆盖时应暴露 coverage debt 或停下，而不是补猜。
8. **研究时点暂不新增独立 skill。** schema/compiler/CI 是机制，不是 skill；
   单 skill 维护纪律进入 `cc-master-skillsmith`，跨 skill owner/overlap 进入
   `curating-skill-portfolios`，行为度量进入 `grounding-skill-evals`。

> **演进标记（superseded as a portfolio decision，2026-07-23）：** 上述结论描述的是治理工具尚不可
> 执行的研究时点，因而“先不立空气操作手册”仍然成立。后续正式规范已通过反事实准入，决定在 K1
> `begin → validate → apply`、graph witness 与 projection 能力真实可用后创建 dev-only
> `governing-skill-knowledge`，专责执行图诊断与 typed transaction。它不进入 runtime plugin，也不接管
> skillsmith / curating / eval 的职责。保留原文是为了保留决策演进证据，不把后来的条件倒写回研究时点。

## 推荐架构

```text
Markdown canonical spans
       │ stable IDs
       ▼
per-skill semantic manifests
       │ compile + validate
       ├──────────────► generated source map / lineage ledger
       │
       ├──────────────► authority graph
       ├──────────────► navigation graph
       ├──────────────► trigger graph
       └──────────────► projection graph
                              │
                              ▼
                 per-host runtime atlas/router Markdown
```

### 真相源分工

| 对象 | SSOT |
|---|---|
| 知识正文与措辞 | canonical Markdown span |
| knowledge ID、kind、owner、关系、适用边界 | semantic manifest |
| 文件、行号、offset、hash、host 位置 | generated source map |
| agent 实际可走的边 | 最终分发 Markdown 中的 runtime traversal surface |
| 历史与替代关系 | lineage/admission ledger |

## 三跳的正确口径

目标点集合的 runtime navigation graph 应满足有向强可达，并以生成式路由形成：

```text
current point/module
  → global module atlas
  → target module router
  → target point
```

只有满足以下条件的边才能计入 hops：

- 当前 host 最终产物中真实存在；
- agent 可以通过链接、anchor 或明确 skill invocation 执行；
- 有 `when`/recognition cue；
- 对程序链有 role/order；
- 目标 point 绑定到可读取的 Markdown evidence span。

同时必须有两道独立门：

- atlas/router 不超过 context budget；
- holdout query 中 agent 能在限定 hops/reads/tokens 内抵达正确 owner，并在无证据时 abstain。

## 研究证据强度

| 判断 | 强度 | 依据 |
|---|---|---|
| 文件级 progressive disclosure 是官方 skill 基线 | 强 | [Agent Skills 规范](https://agentskills.io/specification)、[Anthropic 工程说明](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills) |
| 入口应是地图，docs 结构与链接应机械守护 | 强但属官方实践 | [OpenAI Harness Engineering](https://openai.com/index/harness-engineering/) |
| 层次结构可改善长文档 navigation/retrieval | 中强、条件化 | [RDR2，EMNLP 2025 Findings](https://aclanthology.org/2025.findings-emnlp.1339/)、[HiKEY，ACL 2026](https://aclanthology.org/2026.acl-long.818/) |
| skill library 需要 library-time maintenance | 中、方向明确 | [SkillOps](https://arxiv.org/abs/2605.13716)；仍是受控环境预印本 |
| retrieval 应返回 role-labeled bounded context | 中 | [GoSkills](https://arxiv.org/abs/2605.06978)；预印本 |
| skill 选择、数量、顺序应联合建模 | 中 | [SkillComposer](https://arxiv.org/abs/2606.32025)；预印本 |
| skill 应按完整 lifecycle 和 operator 管理 | 中强 | [Dynamic Agent Skills](https://arxiv.org/abs/2607.10113)，TMLR 2026 接收的 124-paper survey |
| Markdown 内 knowledge ID/span schema 有通用标准 | 没有 | 本轮未找到；这是 cc-master 的工程扩展 |

## 不能从研究中推出的结论

- 不能推出“上图以后 agent 一定更准”；
- 不能推出“直径越小越好”；
- 不能推出“把所有内容塞进一个 atlas 就满足 progressive disclosure”；
- 不能把 ALFWorld/SkillsBench 的结果原样外推到 cc-master 的纪律型 prose skills；
- 不能用 embedding 相似度自动裁决 owner、重复、合并或退役；
- 不能从这轮调研直接推出一个新的分发 skill；
- 不能让 graph database 或新 runtime 依赖进入 plugin hooks。

## 正式裁决结果

用户已批准并正式化完整方案，当前合同见
[`design_docs/skill-knowledge-graph/specification.md`](../../skill-knowledge-graph/specification.md)和
[`ADR-038`](../../../adrs/ADR-038-git-native-skill-knowledge-graph.md)：

1. 稳定 knowledge ID 作为主键；
2. Markdown markers + module-sharded semantic manifest + generated source map 作为源模型；
3. structural / authority / navigation / trigger / constraint / lineage / projection 分图；
4. 三跳定义为 final host runtime Markdown 的 point→point 有向 hop contract；
5. node/edge 结构变更必须带 typed operator、lineage、admission evidence 与 candidate validation；
6. 重要性用 `critical | primary | on_demand` access class 与 pin budget 表达；
7. 每个 semantic subject 恰有一个 canonical point，summary/example 直接回指；
8. v1 采用 Git-native JSON + Node in-memory compiler，不以数据库作 canonical store。
