# 学术谱系（2025-07 ～ 2026-07）：从静态 skill 文件到可维护、可组合的知识系统

## 1. 研究问题与取样方法

本轮只纳入直接关联以下问题的一手论文：

- skill representation 与 library maintenance；
- skill retrieval/composition；
- hierarchical document navigation；
- graph-to-source evidence binding；
- dynamic library lifecycle、verification 与 provenance。

检索窗口为 2025-07-23 ～ 2026-07-23。同行评审来源与新预印本分级陈述；
不以引用量、社区热度或单一 benchmark 代替方法适用性。

## 2. SkillOps：把 skill library 当自维护软件生态

来源：[SkillOps: Managing LLM Agent Skill Libraries as Self-Maintaining Software Ecosystems](https://arxiv.org/abs/2605.13716)，
2026-05-13，`[预印本·submitted to NeurIPS 2026]`。

### 方法

SkillOps 将每个 skill 表示为类型化 contract：

```text
(P, O, A, V, F)
P = preconditions
O = operation
A = produced artifacts
V = validators
F = failure modes
```

它建立两层结构：

- skill 内部 contract graph；
- skill 之间的 hierarchical ecosystem graph，关系覆盖 dependency、compatibility、
  redundancy、alternative。

library-time 维护动作包括 repair、merge、retire、补 validator/adapter 等；health 关注 utility、
compatibility、risk、validation gap 等维度。

### 结果

论文摘要报告 ALFWorld standalone success 79.5%，比最强 baseline 高 8.8 个百分点；
作为 plug-in 对 retrieval-heavy baselines 提升 0.68～2.90 个百分点，并声称当前 rule-based
library maintenance 几乎不增加 library-time LLM token。

### 限制

- 环境依赖结构化 precondition/action 与 ALFWorld/PDDL 风格任务；
- 当前维护大部分是规则型，难以识别深层语义重复或复杂冲突；
- 一个 discipline principle 或 glossary point 不天然具有 artifacts/termination；
- 结果不能直接外推到 cc-master 的自然语言、判断型 skills。

### 对 cc-master 的窄推论

- 内部 point graph 与外部 portfolio graph 应分层；
- validation gap、redundancy、compatibility 与 failure risk 值得进入 health report；
- 不应把 `(P,O,A,V,F)` 强塞给所有 knowledge point，只给 procedure/check 等适用 kind。

## 3. GoSkills：相关不等于可用，检索对象应带角色

来源：[Group of Skills: Group-Structured Skill Retrieval for Agent Skill Libraries](https://arxiv.org/abs/2605.06978)，
2026-05-07，`[预印本]`。

### 方法

GoSkills 从 typed skill graph 构建 anchor-centered groups，再通过 group graph 扩展，
最终把结果压成 bounded atomic payload，并向 agent 呈现固定 execution contract：

```text
Start
Support
Check
Avoid
```

论文强调 flat list 或 dependency bundle 会把入口、support、visible requirement 和 failure avoidance
留给 agent 临场猜。

### 对 cc-master 的窄推论

- graph edge 需要 role，不能只有 `related_to`；
- router 输出应显式呈现 Start/Support/Check/Avoid；
- budget 是 retrieval contract 的一部分；
- coverage 未满足时要显示 debt，而不是把不完整 group 冒充完整路径。

## 4. SkillComposer：选择集合、数量与顺序是联合问题

来源：[Generative Skill Composition for LLM Agents](https://arxiv.org/abs/2606.32025)，
2026-06-30，`[预印本]`。

### 方法与结果

该工作把 skill composition 表示为有约束的 skill-ID 序列预测，一次联合决定：

1. 选哪些 skills；
2. 选几个；
3. 以什么顺序执行。

摘要报告，在 SkillsBench 上相对 no-skill baseline，GPT-5.2-Codex 与
Gemini-3-Pro-Preview pass rate 分别提升 23.1 与 18.2 个百分点，并以更低 prompt token
接近 gold-skill retrieval。

### 限制与误差

- closed library + task-composition training pairs 与 cc-master 当前条件不同；
- full paper 的 error analysis 显示长链会受 short-sequence bias 影响而过早停止；
- skill selection 模型不能替代 owner、authority、lineage 等治理规则。

### 对 cc-master 的窄推论

- `prerequisite`/`next`/`check` 需要显式顺序；
- behavior eval 应覆盖多 point 的集合、数量、顺序；
- hops 过短也可能导致漏读必要 support/check，不能把最短路当唯一最优路。

## 5. Dynamic Agent Skills：library 是有 lineage 的动态 artifact store

来源：[Dynamic Agent Skills: A Lifecycle Survey and Taxonomy of Evolving Skill Libraries](https://arxiv.org/abs/2607.10113)，
2026-07-11，`[同行评审·TMLR 2026.07 accepted]`。

### 综述贡献

该综述审计 124 篇 2023～2026 工作，把 dynamic skill systems 归纳为八阶段：

1. evidence acquisition；
2. proposal；
3. verification/admission；
4. organization/storage；
5. retrieval/composition；
6. maintenance/repair；
7. distillation/portability；
8. governance/provenance。

它给出十个 library update operators：

```text
ADD REFINE MERGE SPLIT PRUNE
DISTILL ABSTRACT COMPOSE REWRITE RERANK
```

并强调 admission、repair、verifier quality、library trajectory 与 provenance/rollback。

### 对 cc-master 的窄推论

- graph 不得只记录当前快照；
- point 变更要有 operator 与 lineage；
- `proposed → accepted` 必须有 verifier/admission evidence；
- write-time abstraction/maintenance 与 read-time retrieval 必须分别观察；
- 报告 library growth、stale age、retirement、usage–utility gap，而不只报最终 task success。

## 6. SoK: Agentic Skills：skill 与普通知识点边界

来源：[SoK: Agentic Skills — Beyond Tool Use in LLM Agents](https://arxiv.org/abs/2602.20867)，
2026-02-24，`[预印本·SoK]`。

该工作把 agentic skill 形式化为带 applicability、policy、termination、interface 的可调用、
可复用、可治理程序单元，并梳理 discovery、practice、distillation、storage、composition、
evaluation、update 生命周期。

### 对 cc-master 的窄推论

skill 与 knowledge point 不应混同：

- `procedure` point 可以具有 inputs/outputs/termination/failure modes；
- `decision` point 可以具有 decision inputs/outcomes/escalation；
- `principle`、`boundary`、`glossary` 不应被迫伪装成 executable contract。

这支持“公共 point fields + kind-specific optional contract”，反对一个万能 schema。

## 7. 文档结构导航：RDR2、HiKEY 与补充证据

### RDR2

来源：[Equipping Retrieval-Augmented Large Language Models with Document Structure Awareness](https://aclanthology.org/2025.findings-emnlp.1339/)，
EMNLP 2025 Findings，`[同行评审]`。

RDR2 让 LLM router 在 document structure tree 中导航，同时判断内容相关性与层次关系；
把 routing 本身作为可训练任务，并在五个数据集上评价。

对本问题的意义：heading/document hierarchy 是有价值的 baseline structural signal，
但 hierarchy 不等于稳定 semantic identity，也不能表达 owner、alternative 或 supersession。

### HiKEY

来源：[HiKEY: Hierarchical Multimodal Retrieval for Open-Domain Document Question Answering](https://aclanthology.org/2026.acl-long.818/)，
ACL 2026，`[同行评审]`。

HiKEY 显式重建 parent–child heterogeneous graph，先做全局 coarse routing，再做 fine retrieval，
并把证据压成 token-efficient subgraph。论文报告 recall 最多提升 12.9%，end-to-end QA 最多提升 6.8%。

对本问题的意义：global router → local detail 与预算内 evidence subgraph 是合理形状；
但 cc-master 需要的是确定性 source binding 与 maintenance contract，不需要先上 multimodal retrieval。

### LongRefiner 与 TreeRAG

- [LongRefiner（ACL 2025）](https://aclanthology.org/2025.acl-long.176/)使用层次文档结构与
  adaptive refinement；
- [TreeRAG（ACL 2025 Findings）](https://aclanthology.org/2025.findings-acl.20/)使用
  hierarchical tree chunking 与双向 traversal。

它们作为补充证据共同反对“把长文档切成无结构等价 chunks”，但不直接回答知识生命周期治理。

## 8. PAGE-RAG：图是 source 的受约束投影

来源：[PAGE-RAG](https://arxiv.org/abs/2607.19301)，2026-07-21，`[极新预印本]`。

该工作把 graph 描述为 source text 的 compressed semantic skeleton，并维护 node/edge →
text evidence spans 的 binding；graph 用于导航和组织，text 是可引用、可核验的 evidence floor。
query-time 按 query profile 选择 passage、neighborhood、path、summary 等 operator，并受 token/path
预算约束；证据不足时允许 abstain。

### 为什么只窄吸收

该论文在本调研日仅发布两天，尚不足以承担成熟效果结论。可窄吸收的只是：

- graph 必须回绑 source evidence；
- graph-only retrieval 不能替代正文；
- structural expansion 应按 query 选择且受预算；
- insufficient evidence 是一种合法终态。

这些原则也可由 provenance 与 evidence-grounding 的一般工程要求独立推出。

## 9. 跨论文综合

### 一致趋势

```text
flat skill/file list
  → typed relations
  → bounded role-labeled retrieval
  → ordered composition
  → verification/admission
  → maintenance + lineage + provenance
```

### 尚无共识

- 最佳 node 粒度；
- 是否用 graph DB、JSON、YAML 或 embedded markers；
- 通用 relation vocabulary；
- 最佳 library topology；
- 三跳是否是合理 universal threshold；
- 如何在自然语言 discipline skills 上可靠自动判重/合并；
- 怎样跨 host 保持 point-level projection parity。

### 对本项目最稳妥的研究转译

先做 deterministic、auditable、text-bound 的 knowledge contract：

- stable ID；
- source span binding；
- typed edges；
- runtime-visible path；
- lineage/admission；
- structural + behavior eval。

embedding、LLM auto-curation、GraphRAG 和 learned composer 都应留在有 baseline 后的可替换实验层。
