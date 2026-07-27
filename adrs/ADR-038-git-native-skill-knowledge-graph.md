# ADR-038 — Git-native skill knowledge graph

> Status: **Accepted**
> Date: 2026-07-23
> Scope: `plugin/src/skills` 的知识身份与 Markdown binding；repo-only
> `plugin/src/knowledge/`、knowledge compiler/editor、可信投影事务、测试与 CI。
> Source: 2026-07-23 skill/plugin 全面健康诊断与三跳知识可达性设计；用户批准正式化完整方案。

---

## 1. Context

cc-master 的分发知识目前以 Markdown 文件组织。文件级 progressive disclosure 是正确的产品形态，
但文件不是可计算的知识身份：一份文件包含多个知识点，一个知识模块可以跨文件，文件移动或行号变化
会让外部索引漂移，重复转述又会制造多个 SSOT。

目标不是把 Markdown 替换成数据库，而是让维护者和 agent 能回答并机械验证：

- 一个知识模块/知识点是什么、由谁拥有、正文在哪；
- 哪个 point 是某 subject 的唯一 canonical，哪些只是 summary/example；
- 从任意 runtime point 到任意目标 point 是否在最终 host Markdown 中最多三跳；
- 为什么某个 point 被移动、拆分、合并、废弃或转移 owner；
- authored graph、Markdown 与各 host dist 是否漂移。

这项选择跨越 source layout、schema、编辑路径、projection、测试、CI 与 meta-skill，且未来可能因
规模或性能事实而被重审，因此需要 ADR。

## 2. Decision

### 2.1 Canonical source 采用 Git-native 双层表示

我们选择：

1. canonical Markdown span 继续拥有 exact knowledge prose；
2. **全局** module-sharded strict JSON 拥有 semantic identity、module intent/boundary/membership、
   point authority、routing、access 与 lifecycle（**不**把 module 语义嵌套在 skill 下）；
3. stable Markdown markers 把 point ID 绑定到正文 span；binding path/anchor/line-range 只是
   evidence，移动路径不改变 membership；
4. **skill 是 artifact**：经 candidate analysis（scoresheet + witness）与 admit verdict 后，由
   显式 composition manifest 物化；多 composition 可消费同一 SSOT；
5. immutable JSON change sets 解释 materialized diff 中的语义身份变化；
6. JSON Schema Draft 2020-12 定义 source/change 合同（含 `composition` / `candidate_analysis`）。

行号、heading 与 content hash 是 compiled source map，不是 identity。

> **Amendment (2026-07-24, K3-00)**：用户确认 **graph-first / skill-as-artifact**。原
> 「skill 拥有 module」的 structural ownership 叙事被 supersede；实现以 composition
> `consumes.modules`（id+manifest locator）为**唯一消费 SSOT**（禁止并行 `modules[]`）。
> 候选 `candidate_analysis` 的 verdict 必须由 graph metrics + authored Counterfactual
> evidence **确定性推导**；禁止 `--analysis-override`；stored verdict 须与 derived 精确一致。
> canonical graph hash 纳入规范化 composition / candidate_analysis。K3-00 walking skeleton
> 以 `dev-as-ml-loop` 贯通 schema→analysis→admit→materialize→四 host；其余 skill 全量迁移与
> package 硬化（K3-01P）属后续任务。

> **Amendment (2026-07-27, K3-03P)**：全量迁移后，point、module 与 typed edge 是
> `plugin/src/knowledge/` 中的全局 authored facts；accepted composition 才是可投影的 skill
> 产品。module 可以被多个 composition 消费，但正文与 module/point 身份仍只有一个 SSOT。
> `binding.path`、marker、anchor 与 source map 都是 evidence/projection，不是 owner，也不能从
> skill 目录反推 membership。`plugin/src/knowledge/` 是 repo-only maintainer surface，禁止进入
> host dist、package 或 release artifact；不存在平行的 knowledge runtime SSOT。

### 2.2 图是 multipane typed contract

Structural、authority、navigation、trigger、constraint、lineage 与 projection plane 分开。
只有 final host 中真实可点击的 navigation edge 计 runtime hop。
Authored edge 在 compiler nav 中以稳定 `<!-- ccm:k:edge edge:… -->` 身份化；
snapshot 按 marker ID 核对，禁止 from+to 猜边。同端点多 typed relation 全部保留。
Candidate admission 的 hop gate 使用 expected directed projection topology
（atlas/module 结构弧 + authored edges）要求 SCC=1 与 diameter≤3；undirected 仅观测。
最终权威仍是每 host materialized Markdown 的 `verifyHopContracts`。

对每个 covered host：

- active accepted point graph 必须有向强连通；
- point→point directed diameter `≤3`；
- registered entry→expected point discovery distance `≤3`；
- critical module 的 relevant entry→primary point `≤1`，any point→critical primary `≤2`。

Containment、composition consumption、authority、lineage、manifest-only edge、搜索或 embedding hit
不得用于满足 hop gate。

### 2.3 权威以 point subject 为粒度

每个 active semantic subject 恰有一个 canonical point。summary/example 必须直接指向它，禁止
authority chain。默认 navigation fan-in 直接 canonicalize，不通过 summary 中转。

重要性不用模糊总分，而用 `critical | primary | on_demand` access class、relevant entries、
primary points 与 portfolio pin budget 表达。

### 2.4 修改必须是类型化 graph transaction

正式写入口使用 `add | wording | refine | move | split | merge | transfer_owner | deprecate |
retire`，不提供无语义通用 CRUD。工具在内存 candidate graph 上应用 operation，完整验证
binding/authority/lineage/navigation/projection/hop 后才原子落地 scoped files。Git PR 与 branch
protection 是最终的人类授权和跨进程 transaction boundary。

### 2.5 工具链使用轻量 Node compiler

compiler/editor 使用 Node 22 ESM、strict JSON、in-memory adjacency maps 和基础 BFS/SCC/toposort。
pinned Ajv 只在开发时生成提交进仓的 standalone validator；clean clone routine check 不现场安装
schema dependency。

编译器只能消费冻结的 source snapshot 与独立冻结的 trusted projection plan，并把 accepted
composition 投影进既有 host-native skill surface；repo-only graph、analysis、contract 与
`knowledge/` 目录不进入 host dist。final verifier 在 sealed candidate 上重解析实际
link/anchor 与 skill surface；只有这份 verified snapshot 可以发布。

package/release 只消费 committed publish receipt、对应 attestation 与冻结 bundle plan。package
阶段不得重新扫描 source、sync dist、重新 compile 或扩大文件集合。

### 2.6 不使用数据库作为 v1 canonical store

SQLite/RDF/Neo4j/向量库均不进入 v1 canonical path。只有真实规模或 profiling 达到规范中的重审
阈值时，才可另立 ADR 引入 SQLite 作为可重建 cache；Markdown、JSON 与 change set 仍保持 source
of truth。

### 2.7 渐进启用，不预支合规声明

按 K0 observe → K1 pilot → K2 covered → K3 enforced 晋级。只有 K3 的 per-host 全图检查通过后，
才可声称 accepted runtime skill projection 达到三跳合同。

## 3. Consequences

### 3.1 Positive

- Markdown 产品形态不变，同时获得稳定、可计算的 point identity。
- module 可跨文件，文件移动和行号变化不再破坏 semantic references。
- SSOT 唯一性、三跳、host coverage 与 dist drift 可进入 deterministic CI。
- module 分片缩小正常 PR 的冲突面，全图校验仍保证跨 shard 健壮性。
- typed change set 保留 split/merge/owner transfer 的因果与 lineage。
- 工具和数据都能随 GitHub 同步，无服务运维与本地数据库 bootstrap。

### 3.2 Negative

- 维护一个知识点要同时尊重 Markdown marker、JSON metadata 与 change protocol。
- 生成 router/nav 会扩大 dist diff，并要求所有 host projection 做端点复验。
- all-pairs diameter 与 critical pins 会引入 atlas/router budget 和 topology review。
- semantic duplicate detection 无法完全机械化，仍需 curating/reviewer 判断。

### 3.3 Neutral

- 分发 skill 数量仍为八；`plugin/src/knowledge/` 是 repo-only 治理输入，不是第九个 skill，
  也不是 runtime/package/release surface。
- task/execution graph schema 不受影响。
- LLM behavior eval 继续带外运行，不进入无模型 deterministic hard CI。

## 4. Alternatives Considered

### 4.1 只从 Markdown heading 自动抽图

拒绝。heading 是排版结构，不是稳定 semantic identity；无法可靠表达跨文件 module、authority、
lineage、access 或 typed operation。

### 4.2 一张巨型 JSON

拒绝。它虽可计算，但正常改动冲突面过大，owner/reviewer 边界不清。module shard + candidate
full-graph validation 提供更好的局部编辑与全局健壮性。

### 4.3 纯 sidecar 行号区间

拒绝。行号是易漂移定位结果；没有 source marker 无法可靠证明 span identity。

### 4.4 RDF/OWL 或图数据库

拒绝用于 v1。表达力和查询能力超过当前需求，却增加 schema/tool/infra/同步成本，不符合
ship-with-repo 的 meta-toolkit 边界。

### 4.5 SQLite 作为 canonical store

拒绝用于 v1。二进制数据库不利于 human diff/merge/review，Markdown/JSON 双写仍不可避免。
未来仅可作为 derived cache 重审。

### 4.6 只靠文档纪律和人工 review

拒绝。无法持续证明 point uniqueness、authority acyclicity、final-host hops、projection coverage
或 change completeness。

## 5. Supersession triggers

本决策只在以下事实出现时重审：

- active graph 超过 25,000 nodes；
- clean-check p95 超过 2 秒，profiling 证明 JSON/graph scan 是主瓶颈；
- 出现真实多进程增量查询需求；
- final Markdown 无法在可接受 context budget 内承载三跳 router，且有可部署的替代 traversal
  surface；
- Agent Skills 或主要 hosts 提供标准化、可验证的 block identity/navigation protocol。

重审不自动授权废弃 Markdown evidence floor、point-level canonical authority 或 change lineage。

## 6. Related

- [正式规范](../design_docs/skill-knowledge-graph/specification.md)
- [机器 schema 与示例](../design_docs/skill-knowledge-graph/README.md)
- [研究专栏](../design_docs/research/skill_knowledge_graph/README.md)
- [ADR-031 — N-host capability parity](ADR-031-n-host-capability-parity.md)
- [ADR-005 — skill separation](ADR-005-two-skills-separation.md)

## 7. References

外部规范、论文与来源链接集中维护在
[Skill Knowledge Graph 研究专栏](../design_docs/research/skill_knowledge_graph/README.md)，本 ADR
不复制证据清单。
