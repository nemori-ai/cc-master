# 对 cc-master 的影响：从文件 portfolio 升级为可验证的知识 contract

## 1. 当前基线

`[仓内实测·2026-07-23 checkout]` 对 `plugin/src/skills/**/canonical/**/*.md` 的只读扫描得到：

- 约 50 个 canonical Markdown 文件节点；
- 47 个可解析的 Markdown-local-link occurrences；
- 没有发现 broken local Markdown links；
- 按“文件 + literal Markdown local link”建立的 directed graph，可达 pair 约 1.02%；
- 有限最短路最大值为 2，但大量 pair 根本不可达；
- 38 个文件 out-degree 为 0；
- 未见可按 literal Markdown links 计算的 cross-skill 文件边。

### 基线限制

这不是对 agent 实际能力的完整判决：

- skills 中存在裸 skill 名、路径 token、prose cues 等隐含边；
- frontmatter description 提供 skill-level trigger；
- agent 可能通过 filesystem search 找到未链接内容。

这组数字只证明：**当前知识关系不是一个可由程序完整恢复、验证和维护的显式图。**

## 2. 具体案例：端点验收不是一个文件节点

“端点验收”分散在：

- `master-orchestrator-guide/canonical/SKILL.md`：原则与纪律；
- `references/worker-routing.md`：terminal → endpoint verification 的路由闭环；
- `references/resume-verify.md`：artifact/diff/tests/hash/异构第二视角的执行程序。

机器目前无法判断：

- 三处是重复，还是 principle/router/procedure 三个职责；
- 谁是 owner；
- agent 应按什么顺序读取；
- 哪个 host 投影包含完整链；
- 移动/拆分后旧引用是否仍成立。

推荐把它们标为三个不同 point：

```text
orchestration.endpoint-verification-principle
  --operationalized_by-->
routing.terminal-to-endpoint-verification
  --deepens_to/check-->
verification.endpoint-procedure
```

这是 Phase 1 最合适的 golden fixture。

## 3. 推荐源模型

选择：

```text
stable Markdown span markers
  + plugin/src/skills/<skill>/.design/knowledge.yaml
  + generated graph/source maps/runtime routers
```

不选择：

- headings 自动成为长期 ID；
- sidecar 手写 file/line ranges；
- embedding 自动生成 accepted graph；
- graph DB 作为 runtime 前置；
- 只生成 dev-only JSON、不生成 agent 可见导航。

### 为什么 `.design/knowledge.yaml`

- 与 skill 维护上下文 co-located；
- `.design` 已是 maintainer-only、分发时剔除的约定；
- 不污染 agent-facing prose；
- projection pipeline 可以在 canonical 阶段读取，再生成 host-specific runtime surfaces。

具体路径仍需在实现设计中验证 `project-skill.cjs`、SAP strategy 和 package 规则；
本报告不授权修改 projection。

## 4. Runtime topology

建议逻辑结构：

```text
current point/module
  → generated global module atlas
  → generated target module router
  → target point span
```

### 关键限制

- atlas 只含 module routing metadata，不含全量 point 正文；
- module router 只列该 module points、cues、roles；
- agent 到 point 后必须读正文 span；
- 所有边在最终 host Markdown 中有 anchor/link/invocation surface；
- atlas 超预算时必须 topology review，不能无限膨胀；
- unsupported/partial host 只计算其真实子图。

## 5. Compiler/checker 的职责边界

建议一个 dev-only、Node/JS、可确定性运行的工具，概念命令：

```text
skill-knowledge check
skill-knowledge compile
skill-knowledge report --json|--dot
skill-knowledge path --from <id> --to <id> --host <host>
skill-knowledge diff --base <ref>
skill-knowledge bootstrap --skill <name>
```

### 确定性职责

- parse markers；
- join manifests；
- source map 与 content hash；
- schema/owner/edge/lineage validation；
- authority/navigation/trigger/projection graphs；
- host-specific reachability/diameter；
- generated runtime routers；
- graph diff 与 path witness。

### 不应在 v1 自动裁决

- 两段 prose 是否语义重复；
- owner 该属于哪个 skill；
- 是否应该 split/merge；
- proposal 是否可 accepted；
- relation `when` 是否足以让 agent 正确选路。

这些可由 heuristic/LLM 提议，但必须由 portfolio discipline 和 behavior evidence admission。

## 6. 与现有 dev skills 的职责映射

`curating-skill-portfolios` 的准入探针给出：

| 候选职责 | 归宿 |
|---|---|
| schema、parser、graph algorithms、source map | dev tooling，不是 skill |
| 编辑单个 skill body 时维护 marker/node/lineage | `cc-master-skillsmith` |
| 跨 skill owner、overlap、merge/transfer | `curating-skill-portfolios` |
| query → point 路由行为 eval | `grounding-skill-evals` |
| 新功能前真实痛点与设计准入 | `requirement-elicitation` |

暂不新增 `knowledge-graph-maintainer`：

- 它的主要触发瞬间与“编辑/审查一个 skill”重合；
- 静态机制不应包装成 agent 判断力；
- 跨 portfolio 与 eval 已有明确 owner。

未来只有当“维护 graph 本身但不编辑 skill body”形成独立、高频、强判断工作流时再过准入。

## 7. 与八个分发 skills 的边界

knowledge graph 是 **这些 skills 的维护/导航机制**，不是第九个运行时知识领域。

- 不在 `master-orchestrator-guide` 复述 graph governance；
- 不把所有跨 skill atlas 注入 SKILL A；
- 不改变 A/B/D/E/F/G/H/I 的职责边界；
- runtime atlas 只承载“何时去哪里”，不复制目标 skill 的 HOW；
- point owner 必须服从红线 3 的 skill portfolio 边界。

## 8. 红线与架构约束

### 红线 1 / 5：ship-anywhere

- compiler 是 repo dev-only；
- 不把 Python、graph DB client 或 npm runtime 塞入 hooks；
- 最终 plugin 仍分发 Markdown；
- 若 runtime 查询未来需要 `ccm`，必须另过产品/进程边界设计，不由本研究自动推出。

### 红线 2：board narrow waist

skill knowledge graph 不进入 board narrow waist；它是静态产品知识与维护资产。

### 红线 3：八 skills 不重叠

authority/owner check 应强化既有边界，不创建新的跨 skill prose SSOT。

### 红线 4：指挥不演奏

本图描述 orchestrator 应读取的知识，不改变 orchestrator 与 worker 的责任分离。

### 红线 6：dormant-until-armed

v1 不需要新 hook。若未来增加 runtime graph observer，仍须先过 armed gate。

### SAP/projection

- canonical knowledge ID 应跨 host 稳定；
- host-specific span/source map 是 projection；
- adapter stub/partial 不得伪造 capability；
- `plugin/dist` 仍为生成产物，不手改。

## 9. 分阶段建议

### Phase 0：Inventory baseline

- headings/links/skill mentions 只生成候选；
- 人审 point 粒度与 owner；
- 记录当前 reachability、context 和 route behavior，不设全库 hard gate。

### Phase 1：Identity fixture

- 定最小 schema；
- 只标注端点验收链和另一个跨 skill case；
- 验证 marker move/rename/refine/split/retire；
- 生成 source map，不生成全库 atlas。

### Phase 2：Portfolio model

- 覆盖八个分发 knowledge skills 与 entry/command；
- authority/navigation/trigger/projection 分图；
- owner、overlap、host coverage、lineage checks。

### Phase 3：Runtime navigation

- 生成 atlas/module routers；
- 对最终 host artifact 算 diameter；
- 同时设 token/read budget；
- 用 holdout query 验证 role/order/wrong-owner/abstention。

### Phase 4：Continuous maintenance

- checker 接 `run-tests.sh`；
- graph diff 进入 PR review；
- library-time health 与 task-time behavior 分开报告；
- 只有稳定、低误报诊断才晋级 hard gate。

## 10. 裁决状态与实现门

上述设计已由用户批准并收敛进
[`design_docs/skill-knowledge-graph/specification.md`](../../skill-knowledge-graph/specification.md)；
技术路线快照见
[`ADR-038`](../../../adrs/ADR-038-git-native-skill-knowledge-graph.md)。稳定 ID、marker + manifest +
generated map、分 plane、final-host 三跳、typed operator/lineage/admission、context budget 与
behavior eval 的职责分层均已确定。

当前只完成 K0 合同。批量 marker 标注、projection pipeline 修改和 hard CI 接线必须按 K1→K3
晋级门实施；K3 前不得声称全 portfolio 已满足三跳。
