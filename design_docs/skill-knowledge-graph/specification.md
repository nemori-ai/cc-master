# cc-master Skill Knowledge Graph Specification

> Status: **Normative design + executable K0 outer contract**
>
> Version: **v1alpha1**
>
> Last updated: **2026-07-23**
>
> Scope: `plugin/src/skills` 的知识身份、Markdown binding、跨 skill 导航、语义变更、
> host projection、健康诊断与研发治理。

---

## 1. 目标与验收口径

### 1.1 Job

cc-master 要把八个分发 skill 从“若干 Markdown 文件”治理成一张可维护、可计算、可投影的知识图，
让开发 agent 能精确编辑一个知识单元，让 runtime agent 能从当前知识点沿短路径到达目标知识点。

系统成功同时满足：

1. **正文不失真**：Markdown 仍是对外分发产品和 exact HOW 的证据底线。
2. **身份稳定**：知识点移动、改名或行号变化不改变 semantic ID。
3. **权威唯一**：一个 semantic subject 恰有一个 active canonical point；summary/example
   直接回指 canonical，不形成转述链。
4. **运行时全通**：对每个被声明为 full/partial covered 的 host，其 active accepted point
   navigation graph 有向强连通，point→point 有向直径不超过 3。
5. **关键内容更近**：critical module 的 primary point 满足更严格的 scoped hop SLO。
6. **变更可审计**：结构变化由类型化 operation 解释，并在 candidate graph 上整体校验后才落地。
7. **projection 不漂移**：authored graph、canonical Markdown 与 final host Markdown 的 binding、
   anchor、link、hash、覆盖声明在 CI 中互证。
8. **Git-native**：canonical data、schema、工具与测试可随仓库 clone；不要求数据库、daemon
   或网络服务。

### 1.2 非目标

- 不把每个知识点包装成可单独触发的 Agent Skill。
- 不用 RDF/OWL、Neo4j、在线向量库或后台服务作为 v1 canonical store。
- 不把任务/执行/board graph 与 skill knowledge graph 合并。
- 不把 embedding 相似度、全文搜索命中或模型“自己知道”计作 runtime hop。
- 不用一个模糊 health score 掩盖 unreachable、duplicate canonical 或 projection drift。
- 不在 K0 就实现工具链，也不在 K3 前宣称全 portfolio 已达三跳。

## 2. 领域对象与真相源

### 2.1 四类 authored node

| Node | 身份 | 拥有什么 | 不拥有什么 |
|---|---|---|---|
| `EntryNode` | 一个 runtime 入口或已注册 intent | 入口 cue、host scope、目标 module/point | 知识正文 |
| `SkillNode` | 一个分发 skill | skill 边界、module manifest 列表、host coverage | module 内 HOW |
| `ModuleNode` | 一个可路由的任务意图单元 | intent、boundary、point membership、access、router metadata | 完整正文 |
| `PointNode` | 一个最小可权威引用的知识单元 | semantic subject、role、binding、authority、cue | portfolio 策略 |

`ProjectionSurface`、source map 与生成 router 是 compiled/runtime 对象，不是 authored knowledge node。

### 2.2 一个知识模块长什么样

一个 module 是跨表示层对象：

```text
module JSON shard
  ├── intent / recognition cues / boundary
  ├── access class / relevant entries / primary points
  ├── point membership
  └── authored semantic navigation edges
          │
          ├── point A ──binds──> Markdown file X / stable marker
          ├── point B ──binds──> Markdown file X / another marker
          └── point C ──binds──> Markdown file Y / stable marker
                                      │
                                      ▼ compile
                         per-host module router + point anchors
```

它不等于一个文件，也不要求 points 连续或同文件。它只拥有一个明确 task intent；若一句话无法概括
职责，或 points 属于两个独立决策瞬间，module 必须拆分。

### 2.3 SSOT 分层

| Concern | 唯一权威 |
|---|---|
| exact principle/procedure/checklist/example 正文 | canonical Markdown point span |
| module intent、boundary、membership、access、routing cue | module JSON shard |
| portfolio entry、global hop policy、critical pin budget | `portfolio.json` |
| skill/module inventory 与 host coverage 声明 | per-skill `skill.json` |
| point semantic identity、canonical/summary/example authority | point record |
| 身份 split/merge/move/retire 的语义解释 | immutable change set |
| final host 路径、anchor、实际可点击 link | generated projection + final-dist verifier |

JSON 中的 `summary`、`intent`、`recognition_cues` 只作路由元数据，不能复制完整正文。

## 3. 图 plane

一份 source 合同编译成多个有不同语义的图 plane；不得把所有 edge 混成 homogeneous graph。

### 3.1 Structural plane

严格 ownership tree：

```text
portfolio ─owns→ skill ─owns→ module ─contains→ point
```

- 一个 active module 恰属一个 skill。
- 一个 active point 恰属一个 module。
- containment 不计 runtime hop。

### 3.2 Authority plane

表达 exact subject 的 canonical 与非权威表达：

```text
summary point ─summarizes→ canonical point
example point ─illustrates→ canonical point
```

硬约束：

- 每个 active `authority.subject` 恰有一个 `role: canonical` point。
- `summary`/`example` 必须有 `canonical`，且 target 必须是 active canonical point、subject 相同。
- 禁止 summary→summary、example→summary 等 authority chain。
- authority graph 必须无环。
- 默认 runtime route 先 canonicalize；只有 task 明确需要 example 时才把 example 当目标。

### 3.3 Navigation plane

这是 runtime agent 实际可点击行走的 directed graph，也是三跳指标唯一使用的 plane。 authored
语义边 closed set：

| Type | 含义 | 典型端点 |
|---|---|---|
| `requires` | 目标判断前必须先读 source | point→point |
| `next` | 有序程序中的下一步 | point→point |
| `deepens_to` | 从原则进入更深机制/细节 | point→point |
| `operationalizes` | 用 procedure/check 实现原则 | point→point |
| `applies_to` | 把一般规则应用到特定情形 | point→point |
| `contrasts_with` | 为区分边界而跳到对照点 | point→point |
| `fallback_to` | 当前 host/场景不可用时的显式降级 | module/point→module/point |
| `routes_to` | entry/module/point 按 cue 路由到 canonical target | entry/module/point→module/point |

每条 authored navigation edge 必须带 `when`，可选 `avoid_when`、`role`、`order`。禁止
`related_to`：无法解释为什么此刻应该走的边不进入 runtime graph。

编译器还生成：

- point/module → atlas 的 return link；
- atlas → module 或 critical primary point 的 route；
- module router → member canonical point；
- relevant entry → critical primary point 的 pin。

只有 final host Markdown 中存在可解析 anchor/link 的 edge 才成为 enabled runtime edge。

### 3.4 Trigger plane

`EntryNode` 把命令、skill 入口或注册 intent 映射到 module/point。Trigger edge 用于 discovery
distance，不替代 point-to-point diameter。

### 3.5 Constraint plane

`avoid_when`、host coverage、lifecycle、admission、authority canonicalization 与 explicit
fallback 共同裁剪可用 route。约束本身不计 hop。

### 3.6 Lineage plane

由 change set 派生，只向历史 identity 指：

- `split_from`
- `merged_from`
- `moved_from`
- `supersedes`
- `retired_by`

lineage 必须是 DAG，retired ID 永不复用。它用于审计和引用迁移，不进入 runtime diameter。

### 3.7 Projection plane

记录 authored point/edge 到每个 host 最终 Markdown span/anchor/link 的 source map。它是映射关系，
不是知识关系，不计 hop。

## 4. ID、binding 与原子性

### 4.1 Global ID

ID 采用稳定 namespaced form：

```text
portfolio:cc-master-runtime-skills
entry:knowledge-atlas
skill:master-orchestrator-guide
module:verification.endpoint
point:verification.endpoint-principle
change:20260723.endpoint-verification-split
```

规则：

- 全局唯一；只允许小写字母、数字、`.`、`-`、`:`。
- ID 不包含文件名、标题编号、行号或 host。
- wording/move 不改 ID；refine 只有 semantic subject 改变时才新建 ID。
- retired ID 永不重新分配。

### 4.2 Stable Markdown binding

canonical source 用显式 marker 声明 point 边界：

```markdown
<!-- ccm:k:start point:verification.endpoint-principle -->
### 只信执行端点验收

……canonical prose……
<!-- ccm:k:end point:verification.endpoint-principle -->
```

约束：

- start/end 成对、同 ID、同文件；span 连续。
- spans 可分离或完整嵌套，不得 partial crossing。
- marker 是身份锚；line range、heading、content hash 都是编译结果。
- active canonical point 恰有一个 primary binding。
- generated navigation block 不进入 canonical span hash。
- adapter overlay 删除或破坏 marker 时，该 host projection fail closed。

### 4.3 Point 原子性

point 应能独立回答一个 principle、decision rule、procedure step group、check、example 或 boundary。
以下信号要求 split：

- 同一 span 可被两个不同 task cue 独立命中；
- 一半内容可变而另一半应稳定；
- 一半有独立 canonical owner；
- verifier 只能验证其中一部分；
- runtime route 经常只需要其中一半。

短不是原子，长也不必然不原子；判据是能否独立引用、变更、验证和授权。

## 5. 重要性与路径预算

### 5.1 不使用模糊 importance score

重要性是 scoped access contract，而不是全局 0–100 分。每个 module 声明：

```json
{
  "access": {
    "class": "critical",
    "relevant_entries": ["entry:master-orchestrator"],
    "primary_points": ["point:verification.endpoint-principle"],
    "rationale": "这是完成声明前的端点验收原则。"
  }
}
```

closed set：

| Class | 含义 | 路径合同 |
|---|---|---|
| `critical` | 相关入口下高频且错误代价高 | relevant entry→primary point ≤1；any point→primary point ≤2 |
| `primary` | 该 skill 的主干知识 | relevant entry→primary point ≤2；仍受全局直径 ≤3 |
| `on_demand` | 低频、情境化或深层细节 | 只受全局直径与 discovery ≤3 |

### 5.2 Pin budget

`portfolio.json` 必须声明 critical pin budget：

- `max_modules`：critical module 绝对上限；
- `max_fraction`：critical module 占 active module 比例上限；
- 每个 critical module 必须有非空 rationale、relevant entries 和 primary points。

超过任一预算即 hard failure。新增 critical 必须在 PR 中说明挤占哪个预算、为何不能是 primary。
这阻止所有维护者都把自己的模块标成 critical，最终把 atlas 重新做成全文目录。

### 5.3 SSOT 与最短路径同时成立

“多个地方引用”用 inbound navigation edge 解决，不复制正文：

```text
entry A ─┐
point B ─┼──────────────► canonical point C
module D ┘
```

- 默认 route fan-in 直接指向 canonical C，不经过 summary 中转。
- summary/example 可作为阅读目标，但其 authority link 一跳直达 C；不能成为其他默认 route 的枢纽。
- critical canonical point 可被 atlas 和 relevant entry 直接 pin，缩短路径不会制造第二 SSOT。
- 编译器报告 canonical fan-in、stale summary hash 与 duplicate-subject candidates；后者是 review
  提示，不能由词向量自动做 destructive merge。

## 6. Hop contract

### 6.1 有效 hop

一条边只有同时满足以下条件才计 1 hop：

1. 属于 navigation plane，或在 discovery 指标中属于 trigger plane；
2. source/target 都是当前 host 的 active accepted runtime surface；
3. final host Markdown 中存在可解析的 source link 与 target anchor；
4. `when` 匹配当前 route class，且未命中 `avoid_when`；
5. target 经 authority canonicalization 后合法；
6. router/nav block 没有超出 context budget。

以下均不计 hop：containment、authority、lineage、projection relation；manifest-only edge；
全文搜索；embedding hit；裸 skill 名；不可解析 prose mention；模型参数知识。

### 6.2 四个独立 SLO

对每个 covered host 分别计算：

| ID | 指标 | 硬门 |
|---|---|---|
| `H1` | enabled runtime navigation graph 中所有 active accepted point endpoints 的相互可达性 | 恰好一个 point-reachable SCC |
| `H2` | point→point directed diameter（允许 atlas/module router 作中间 traversal surface） | `≤ 3` |
| `H3` | registered entry→expected point discovery distance | `≤ 3` |
| `H4` | critical/primary access SLO | 符合 §5.1 |

H2 不能被 H3 替代；atlas→point 很近不代表任意 point 之间可达。

### 6.3 默认三跳拓扑

```text
current point ─1→ knowledge atlas ─2→ target module router ─3→ target canonical point
```

critical primary point 缩短为：

```text
current point ─1→ knowledge atlas ─2→ critical canonical point
relevant entry ─1→ critical canonical point
```

atlas 只列 module cue 与 critical pins；module router 只列 admitted member point 的 cue/authority
role/link，不复制 HOW。summary/example 只有在其独立 cue 命中时才作为目标显示，其他默认 route
canonicalize 到对应 canonical point。

### 6.4 健康报告

报告必须逐 host 输出：

- node/edge/covered point counts；
- SCC 与 unreachable ordered pairs；
- diameter、p50/p95、每点 eccentricity；
- shortest-path witness；
- critical/primary SLO violations；
- atlas/module router token、line 与 fan-out budget；
- articulation/hub dependency；
- canonical fan-in、authority violation、stale summary；
- coverage debt、unsupported paths 与 abstention；
- broken binding/anchor/link、projection drift。

不生成单一总分。Hard failure 与 soft diagnostic 必须分栏。

## 7. Source layout 与 schema

目标 authored layout：

```text
plugin/src/knowledge/
├── portfolio.json
├── changes/
│   └── change.20260723.endpoint-verification-split.json
└── skills/
    └── master-orchestrator-guide/
        ├── skill.json
        └── modules/
            └── verification.endpoint.json
```

机器合同：

- [knowledge-source.schema.json](schemas/knowledge-source.schema.json)：portfolio、skill、module。
- [knowledge-change.schema.json](schemas/knowledge-change.schema.json)：语义变更事务。

文件按 module 分片，而非一张巨型 JSON：

- 一次正常修改只碰一个 module shard 和对应 Markdown；
- merge conflict 与 reviewer blast radius 小；
- compiler 仍可在内存中装成整图；
- 跨 module 不变式由 candidate graph 校验，不由文件原子性假装保证。

## 8. 类型化语义变更

### 8.1 禁止通用 CRUD 作为 agent 写入口

正式写路径只允许：

| Operation | 语义 |
|---|---|
| `add` | 新建 module/point/edge，ID 从未出现 |
| `wording` | 仅改 canonical wording/binding hash，不改 semantic identity |
| `refine` | 保持 ID，但收窄/澄清 subject 或 routing metadata |
| `move` | 保持 point ID，改变 binding path/marker 或 module membership |
| `split` | 一个 active identity 退役，产生 2+ 个新 identity |
| `merge` | 2+ 个 active identity 退役，产生一个新 identity |
| `transfer_owner` | module 在 skill 间转移；同时修复 membership/entry/routes |
| `deprecate` | 仍可读但不再作为默认 target，必须指定 replacement 或 rationale |
| `retire` | 从 active/runtime graph 移除，保留 lineage tombstone |

直接手改 JSON/marker 可以保留为紧急 escape hatch，但 CI 从 base/result graph diff 反推结构变化；存在
未被 change set 完整解释的 identity、owner、authority、lifecycle、binding 或 edge diff即拒绝。

### 8.2 Change set

每次逻辑 transaction 一份 immutable JSON：

- `base_graph_sha256` 绑定 PR base 的 accepted graph；
- `result_graph_sha256` 绑定 candidate accepted graph；
- `operations[]` 有序作用于内存 candidate；
- `reason` 与 `evidence` 解释为何这是 wording/move/split/merge 等；
- Git PR/branch protection 才是人类授权；JSON 不伪造 `approved_by`。

rebase 后 base hash 改变必须重验。已合并 change set 不原地修改，修正用新 change set。

### 8.3 Candidate transaction

编辑器流程：

```text
load accepted base
  → apply typed operations in memory
  → materialize candidate files in temporary tree
  → parse markers + bind spans
  → validate all structural/authority/navigation/lineage/admission invariants
  → compile all host projections
  → parse final host links/anchors and calculate hops
  → compare expected diff + hashes
  → atomically replace scoped working-tree files
```

任何一步失败都不落半张图。Git 保留跨进程与 reviewer 层的 transaction boundary。

## 9. Invariant registry

| ID | Hard invariant |
|---|---|
| `K-I01` | node/edge ID 全局唯一，retired ID 不复用 |
| `K-I02` | module 恰属一个 skill；point 恰属一个 module |
| `K-I03` | active accepted canonical point 恰有一个 primary Markdown binding |
| `K-I04` | spans 只分离或嵌套，不 partial crossing |
| `K-I05` | 每 subject 恰有一个 active canonical；summary/example 直接指向它 |
| `K-I06` | authority 与 lineage graph 无环 |
| `K-I07` | edge type/endpoint/owner 满足 registry；无 `related_to` |
| `K-I08` | accepted node/edge 有 evidence 与 verifier |
| `K-I09` | enabled runtime edge 在 final host 有真实 traversal surface |
| `K-I10` | 每 covered host active point graph 恰一 SCC，directed diameter ≤3 |
| `K-I11` | entry discovery 与 access class hop SLO 满足 |
| `K-I12` | critical module 不超 pin budget |
| `K-I13` | unsupported/stub host 不生成或声称虚假 point surface |
| `K-I14` | source/result graph diff 被 change operations 完整解释 |
| `K-I15` | source→dist projection 可复现，generated block 不污染 source hash |
| `K-I16` | canonical source 不含手写 generated nav block |

每个错误必须带 stable code、node/edge/change ID、source location、witness 和修复建议。

## 10. Compiler 与 meta-toolkit

### 10.1 技术栈

- Node.js 22 ESM；
- strict JSON；
- JSON Schema Draft 2020-12；
- 编译时 in-memory adjacency maps；
- BFS、SCC、topological sort、cycle witness 手写即可；
- pinned Ajv 只用于开发期生成提交进仓的 standalone validator；
- clean clone 的 routine check 只依赖 Node，不现场安装 Ajv。

不引入 runtime database。只有同时满足任一触发器才重审 SQLite **作为可重建 cache**：

- active nodes 超过 25,000；
- clean-check p95 超过 2 秒且 profiling 证明 JSON parse/graph scan 是瓶颈；
- 多进程增量查询成为真实需求；
- 单次 compiled artifact 大到明显影响 Git/CI。

即便重审，Markdown + JSON + change set 仍是 canonical source。

### 10.2 CLI surface

统一入口 `node scripts/skill-knowledge.mjs`。K0 已实现 `contract` 与 `check` 的 walking
skeleton；其机器 envelope、diagnostic 与 exit code 以 [cli-contract.md](cli-contract.md) 为
准。其余命令只冻结 vocabulary，当前必须 exit 10、不得假成功：

```text
check [--source|--dist <host>|--changed]
compile [--host <host>|--all]
report [--json|--dot] [--host <host>]
path --from <id> --to <id> --host <host>
explain <id>
change add|wording|refine|move|split|merge|transfer-owner|deprecate|retire
```

读命令不修改文件；写命令先创建 change set/candidate，再通过全图验证。退出码至少区分 schema、
binding、semantic invariant、projection、hop、drift 与 usage error。

### 10.3 Runtime projection

每个 host 最终生成：

```text
plugin/dist/<host>/
├── knowledge/
│   ├── atlas.md
│   └── modules/<module-id>.md
└── skills/<skill>/**/*.md
    └── generated point anchors + tiny navigation blocks
```

规则：

- `knowledge/` 是 shared runtime support surface，不是第九个分发 skill。
- source Markdown 不手写 generated block。
- projection 先清旧 block，再从 graph hash 生成。
- final-dist verifier 重新 parse 所有 anchor/link，不能只信模板。
- relative link 以 final host path 计算，不依赖 `${CLAUDE_PLUGIN_ROOT}` 在 Markdown 中展开。
- `partial` host 只计算真实投影子图；`stub/unsupported` 不声称 coverage。

## 11. 测试、防漂移与 CI

### 11.1 Test pyramid

1. **Schema unit**：valid/invalid source/change fixtures。
2. **Domain unit**：ID、binding、authority、edge endpoint、admission、lineage、pin budget。
3. **Graph property**：SCC、diameter、canonicalization、witness determinism。
4. **Golden fixtures**：单 module、跨文件 module、critical pin、summary fan-in、partial host。
5. **Mutation/metamorphic**：删 marker、断 anchor、造 authority chain、改 owner 不改 routes、
   把 critical 全开、插入虚边骗 hop。
6. **Projection integration**：canonical → host dist → reparse → source map/hop。
7. **Behavior eval**：结构绿后，用 Track A/B 量 agent 是否更精准触达；不进无 LLM 的 hard CI。

### 11.2 Drift matrix

| 漂移 | 检测 |
|---|---|
| Markdown marker ↔ point binding | marker parser + one-to-one invariant |
| JSON subject/authority ↔ canonical owner | authority validator |
| source graph ↔ generated router/nav | deterministic compile + graph hash |
| canonical path ↔ host adapter path | per-host source map + final link parse |
| source ↔ committed dist | 现有 `check-plugin-dist-sync.sh` |
| base/result semantic diff ↔ change set | change replay + hash/diff explanation |
| access class ↔ actual hop | per-host shortest path assertions |
| host coverage claim ↔ surface | projection verifier |

### 11.3 Repo integration

固定接线：

- `run-tests.sh`：当前已自动发现 K0 content contract test；K1+ 再加入 marker、domain/graph tests；
- `scripts/sync-plugin-dist.sh`：现有 SAP/PHIP 投影后执行 knowledge graph post-pass；
- `scripts/check-plugin-dist-sync.sh`：继续作为 source/dist 同 commit 漂移门；
- GitHub Actions 已新增 `plugin-contracts` job，执行 K0 contract test + source check；
- 现有 required `build-and-check` 已保持名字稳定，作为 ccm + plugin jobs 的 aggregator；
- release gate 只发布已保存且 final-dist verifier 通过的生成物。

不要把 LLM eval 变成 deterministic CI 的依赖；它属于改行为时的带外证据。

## 12. Dev meta-skill 架构

### 12.1 准入结论

K1 能力可用后实现一个 **dev-only** `governing-skill-knowledge`，放 `.claude/skills/`，
同步到 `.agents/skills/`，不随 plugin 分发。K0 不发布这个 skill：当前 typed change、
graph witness 与 projection 都尚不可执行，提前发布会让触发成功的 agent 误以为它有一条安全
写路径。正式创建前仍须按 `cc-master-skillsmith` 跑 pressure baseline，并按
`grounding-skill-evals` 声明 J、验证 Track A/B。

| 维 | 判定 | 证据 |
|---|---|---|
| D1 audience-plane | 1 | 维护者对本仓 skill graph 做诊断/变更；明确是 dev plane |
| D2 bounded-context | 1 | 单一职责是执行 graph health + typed semantic change protocol |
| Probe A | strong A2/A3 | agent 默认没有本仓 schema/CLI/transaction 路径，无法可靠重构 |
| Probe B | strong B1/B4 | agent 默认会直接编辑 JSON/Markdown、漏 change set 或只看文件级链接 |
| Verdict | admit | 双价值，且不与现有 skill 的 body/portfolio/eval/adapter 职责重叠 |

### 12.2 边界

新 skill 只教：

- 何时运行 health diagnosis；
- 如何解释 invariant/hop/projection witness；
- 如何选择 typed operation；
- 如何通过 candidate transaction 修改 graph；
- 何时因 coverage debt/authority ambiguity 停下升级。

明确移交：

| 关切 | Owner |
|---|---|
| 一个 skill body 该怎么写 | `cc-master-skillsmith` |
| 要不要建 skill、module owner/portfolio 边界争议 | `curating-skill-portfolios` |
| J、Track A/B 与行为改进是否成立 | `grounding-skill-evals` |
| origin/host capability 架构 | `harness-plugin-architecture` |
| projection 脚本实现 | `adapter-projection-engineering` |
| release artifact 与发布门 | `plugin-release-engineering` |

工具 schema/命令速查放 references，不把静态 registry 全塞入 SKILL.md。

### 12.3 轻量成功契约

实现 skill 前写 `OBJECTIVE.md`：

- `J_top`：维护者 agent 对 skill knowledge 做结构变更时，选择正确 typed operation，保持
  canonical/lineage/binding/projection/hop 不变式并给出可复现 witness。
- `without_skill_floor`：默认 agent 直接改 JSON/Markdown，把文件链接误当全图可达，或用 summary
  复制 canonical 正文；结构检查出现未解释 diff/authority chain/drift。
- `strict_dims`：
  1. 不绕过 typed transaction 与 candidate validation；
  2. 不制造第二 canonical，不用非 runtime edge 冒充 hop。

body 写作前必须跑 pressure baseline；description 改动走 Track A，行为纪律走 Track B + 非同家族二评。

## 13. 开发迭代协议

一次正常知识变更：

1. 识别任务：wording、refine、move、split、merge、transfer、deprecate 或 retire。
2. `explain/path/report` 读取当前 owner、authority、inbound routes、host coverage、shortest witnesses。
3. 用 typed command 构建 change set 与 candidate。
4. 修改 canonical Markdown span；不手写 generated nav。
5. candidate 全图校验；失败时按 witness 修复，不 suppress。
6. compile 所有 affected hosts，final-dist reparse。
7. 跑 source tests、dist sync check；行为变化再跑 Track A/B。
8. PR review 同时看 Markdown diff、JSON semantic diff、change set、health delta、dist diff。
9. 合并后 change set immutable；错误用新 change 修正。

## 14. 渐进启用

| 阶段 | 范围 | Hard gate | 晋级条件 |
|---|---|---|---|
| `K0 observe` | 正式规范/schema/example | 仅新资产自洽 | schema/examples/review 通过 |
| `K1 pilot` | 一个高价值 skill、2–3 modules | pilot scope hard；全局只报告 debt | typed editor + projection + golden/mutation tests |
| `K2 covered` | 八 skill 全部 active points | binding/authority/host coverage hard | 所有 point admission 完成、无 unresolved owner |
| `K3 enforced` | portfolio 全图 | H1–H4、change replay、dist drift 全 hard | 每 host witness 通过，budget 达标，CI 接线稳定 |

只允许晋级，不允许用“后续补图”静默降低当前阶段硬门。若要降级必须有显式 ADR/回滚变更。

## 15. 决策与开放点

本规范已经确定：

- module-sharded strict JSON + Markdown marker；
- point 级 canonical authority；
- multipane typed graph；
- per-host point→point directed diameter `≤3`；
- access class + pin budget；
- typed change transactions；
- Node in-memory compiler 与 generated runtime Markdown；
- dev-only governance skill；
- K0→K3 hardening。

仍留给实现阶段、但不改变上述合同的细节：

- CLI 的最终命令名与错误码数字；
- standalone validator 的生成文件路径；
- atlas/router 精确 line/token budget 初值；
- K1 pilot 选择哪一个 skill/module；
- semantic duplicate detector 的启发式（永远 soft，不自动合并）。
