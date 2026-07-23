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

### 2.4 K1 contract-hardening registry

K1 的编译器、编辑器和 host verifier 不得自行补设计。以下 `C1`–`C14` 是开始实现前必须冻结的
合同；机器可读镜像由 `skill-knowledge contract --json` 的 `hardening_contract` 返回。registry
声明“合同已经确定”，不代表对应 capability 已实现。

| ID | 合同 |
|---|---|
| `C1` | 每个 EntryNode 通过 `surfaces[]` 绑定 host、source Markdown、stable marker 或 explicit anchor、surface kind、targets 与 lifecycle；manifest-only trigger 不计 H3/H4 |
| `C2` | 每个 SkillNode 盘点 Git 中全部 canonical Markdown；每项声明 `full / partial / non_knowledge / excluded`、point IDs、`reviewed_unbound_sha256`，`partial` 带未解决 debt，`non_knowledge/excluded` 带人工 review |
| `C3` | summary/example authority 直接指向 canonical point，并声明 `review_policy` 与 `reviewed_canonical_sha256`；canonical span hash 改变使 review-on-change 记录失效 |
| `C4` | lifecycle 为 `accepted` 的 SkillNode 与 accepted module/point/edge/entry 一样必须有 admission evidence 与 verifier，不留 `K-I08` 例外 |
| `C5` | typed change 只表达语义操作和审计，不承载任意 Markdown bytes；`begin → candidate edit → validate → apply` 在 ignored workspace 中执行，任何 optimistic-lock、scope hash 或 patch dry-run 失败都不得部分写入 |
| `C6` | canonical graph hash 只纳入 accepted portfolio/skill/module manifests、canonical span hashes、source inventory 与 accepted change-head digest；digest 排除当前 record 的 `result_graph_sha256` 防自引用，按 §10.2 稳定序列化 |
| `C7` | Markdown span hash 在 UTF-8、CRLF→LF 后计算 start/end marker 之间的精确 bytes；marker 与 span 外 generated block 不纳入，nested crossing/overlap/unclosed/duplicate fail closed |
| `C8` | budget 只报告 `estimated_tokens`、lines、UTF-8 bytes；v1 估算器是确定性的 `ceil(utf8_bytes / 3)`，不声称等于任一模型 tokenizer |
| `C9` | K1 的 host portability probe 固定覆盖 `claude-code / codex / cursor / kimi-code`，分别验证 explicit anchor、relative link、path rewrite 与 canonical/partial/stub payload；冻结 `worker_allowlist=[codex,cursor]`（与四产品 host 分界）、`anchor_form=explicit-html-id`、`path_policy=relative-final-host-path`；heading auto-slug 与 live click-through 标为 unverifiable 且 fail closed |
| `C10` | changed-scope 检查接受显式 `--base <git-ref>`；finalized change 记录 base ref、base/result graph hash、parent chain link 与 scoped before/after hashes，retired ID 从完整 immutable ledger 推导 |
| `C11` | semantic coverage denominator 是 Git 中全部 canonical Markdown，不是 graph 已声明的子集；K2 禁止缺 inventory、`partial` 或 stale unbound review |
| `C12` | report 分开输出 structural status 与 behavioral evidence status；无 baseline/candidate/holdout 证据时不得声称 agent 定位更精准 |
| `C13` | 研究结论必须保留时间语境并用显式 supersession note 演进；不得静默重写“能力不存在时不立 skill”的历史判断 |
| `C14` | governance meta-skill 真实创建后，root `AGENTS.md` 的 dev/meta 数量、路由和触发式导航必须同变更更新，并仅由 `scripts/sync-codex-skills.sh` 投影到 `.agents/skills`；runtime portfolio 仍是八个，不混入该 meta-skill |

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

span hash 的 v1 规范：

1. 按 UTF-8 读取 source，先把 `CRLF` 归一为 `LF`；孤立 `CR` 不做隐式改写。
2. hash 输入是 start marker 行结束之后、end marker 行开始之前的精确 bytes；两条 marker 自身不进入。
3. generated navigation block 必须在 point span 外；若出现在 span 内即 contract error，不做“先删再 hash”。
4. 完整嵌套可由 parser 构造独立 span；partial crossing、同 ID duplicate、unclosed 或错配 end
   一律 fail closed。
5. 对规范化 bytes 计算 lowercase hexadecimal SHA-256；line range、heading 与 host anchor 都不参与。

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

- `base_ref` 记录创建 workspace 时解析的显式 Git ref；CI 必须传真实 base SHA；
- `base_graph_sha256` 绑定 PR base 的 accepted graph；
- `result_graph_sha256` 绑定 candidate accepted graph；
- `parent_change` 记录前一 finalized change 的 ID 与 result hash；genesis 显式为 `null`；
- `scope[]` 记录 scoped file 的 before/after SHA-256，不把任意文件 bytes 塞进 ledger；
- `operations[]` 有序作用于内存 candidate；
- `reason` 与 `evidence` 解释为何这是 wording/move/split/merge 等；
- Git PR/branch protection 才是人类授权；JSON 不伪造 `approved_by`。

rebase 后 base hash 改变必须重验。已合并 change set 不原地修改，修正用新 change set。

### 8.3 Candidate transaction

本地 workspace 固定在被 Git 忽略的 `.skill-knowledge/workspaces/<change-id>/`：

```text
workspace.json       # base ref/hash、operation、scope、scoped file hashes、状态
candidate/           # 只含 scope 内候选文件
change.draft.json    # 9 类 typed semantic operations
validation.json      # 完整候选图、result hash、patch dry-run 的机器判决
apply.patch          # 工具从 accepted/candidate bytes 生成
```

编辑器流程：

```text
change begin --op <type> --scope ... --base <git-ref>
  → resolve and freeze base ref / graph hash / scoped file hashes
  → materialize scoped candidate files
  → agent edits candidate only
  → change validate <workspace>
  → apply typed operations to the complete candidate graph
  → parse markers + bind spans
  → validate all structural/authority/navigation/lineage/admission invariants
  → compile all host projections
  → parse final host links/anchors and calculate hops
  → calculate result graph hash and deterministic semantic diff
  → generate patch; check optimistic lock and git apply --check
  → change apply <workspace>
  → atomically replace scoped accepted files
  → finalize immutable change record only after accepted tree is complete
```

`change begin` 后 agent 不直接编辑 accepted tree。`change apply` 前必须重新读取 working tree scope
并与 frozen hashes 比较；scope 外修改不触碰，scope 内任一 stale/dirty/写失败都恢复原 bytes、拒绝
finalize。任何一步失败都不落半张图。Git 保留跨进程与 reviewer 层的 transaction boundary。

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
| `K-I17` | 每个 active EntryNode 的 covered host 有可解析 EntrySurface binding；manifest-only trigger 不计 hop |
| `K-I18` | Git canonical Markdown denominator 与 SkillNode source inventory 完全一致；reviewed-unbound hash 新鲜 |
| `K-I19` | review-on-change derived authority 的 `reviewed_canonical_sha256` 等于当前 canonical span hash |
| `K-I20` | accepted SkillNode 必有 admission evidence 与 verifier |
| `K-I21` | finalized change 的 base/result/parent hash 形成一条连续 immutable chain，scope hashes 与 materialized diff 一致 |
| `K-I22` | canonical graph/span/budget 计算使用已声明算法版本且同输入确定性相同 |
| `K-I23` | structural status 与 behavioral evidence 分轨；缺行为证据时不得产生 improvement claim |

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

### 10.2 Deterministic hash 与 budget contract

canonical graph hash v1 使用以下规范：

1. 收集 accepted portfolio/skill/module manifests、每个 active canonical point 的 span SHA-256、
   完整 canonical source inventory，以及 accepted change-head digest。change manifest 不作为普通 authored
   manifest 再次整份纳入。
2. change-head digest 是对当前 finalized head record 按同一稳定序列化规则计算的 SHA-256，但排除自引用字段
   `result_graph_sha256`；`base_graph_sha256`、`parent_change`、scope、operations 与 evidence 仍纳入该 digest。
   genesis 没有 head 时使用显式 `null`。这样 result hash 绑定 ledger 内容但不存在固定点计算。
3. 排除 generated router/nav、source map、dist、绝对路径、mtime/时间戳与诊断展示字段。
4. object key 按 Unicode code point 升序；contract 声明的 identity-set 数组（`skills` /
   `modules` / `points` / `edges` / `entries` / `canonical_source_inventory` 等，见
   `hardening_contract.C6.identity_set_fields`）按稳定 entity ID（inventory 条目按 `path`）升序；
   `operations`、procedure order、`when/avoid_when` 等语义顺序数组（见
   `C6.semantic_order_fields`）保留 authored order，不得排序。
5. 序列化为无额外空白的 UTF-8 JSON，随后计算 lowercase hexadecimal SHA-256。

算法版本 `cc-master/skill-knowledge-canonical-graph-hash/v1`、span hash 版本
`cc-master/skill-knowledge-markdown-span-hash/v1` 与 budget estimator 版本
`cc-master/skill-knowledge-budget-estimator/v1` 必须写入 contract/report；升级算法必须以 versioned
migration 重算 accepted hashes，不能原地改变同一版本的含义。

budget estimator v1 先做与 span hash 相同的 CRLF→LF 规范化，再报告：

- `utf8_bytes`：规范化后 byte length；
- `lines`：空输入为 0；非空输入为 LF 数量，加上“末 byte 不是 LF”时的 1；
- `estimated_tokens`：`ceil(utf8_bytes / 3)`，空输入为 0。

### 10.3 CLI surface

统一入口 `node scripts/skill-knowledge.mjs`。K0 已实现 `contract` 与 `check` 的 walking
skeleton；K1 pilot 额外实现 `report` / `path` / `explain`（authored navigation plane）与
`compile`（四 host runtime projection；`runtime_projection=true`）。其机器 envelope、diagnostic 与 exit code 以
[cli-contract.md](cli-contract.md) 为准。`change` 仍只冻结 vocabulary，
当前必须 exit 10、不得假成功：

```text
check [--source <dir>] [--stage K0|K1|K2|K3] [--host <host>] [--base <git-ref>]
compile [--host <host>] [--check]
report [--format json|markdown] [--host <host>]
path --from <id> --to <id> --host <host>
explain <id>
change begin --op <add|wording|refine|move|split|merge|transfer_owner|deprecate|retire> --scope ... --base <git-ref>
change validate <workspace>
change apply <workspace>
```

读命令不修改文件；写命令先创建 change set/candidate，再通过全图验证。退出码至少区分 schema、
binding、semantic invariant、projection、hop、drift 与 usage error。

`check --base` 只控制 changed-scope explanation，不缩小 routine full health check 的 denominator。
K1 尚未实现的 option（`check --host/--base`、`report --host`、`report --format markdown`）
仍随所属命令 exit 10；参数出现在合同中不等于 capability 可用。

### 10.4 Runtime projection

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

canonical coverage 的 denominator 由 Git tree 枚举 `plugin/src/skills/<runtime-skill>/canonical/**/*.md`
得到，再与每个 SkillNode 的 `canonical_source_inventory` 做集合相等检查；禁止以 graph manifest
已经列出的文件反过来定义 denominator。K1 可保留显式 `partial` debt；K2 起任何 missing/stale/partial
均为 hard failure。

### 11.3 Repo integration

固定接线：

- `run-tests.sh`：当前已自动发现 K0 content contract test；K1+ 再加入 marker、domain/graph tests；
- `scripts/sync-plugin-dist.sh`：现有 SAP/PHIP 投影后执行 knowledge graph post-pass；
- `scripts/check-plugin-dist-sync.sh`：继续作为 source/dist 同 commit 漂移门；
- GitHub Actions 已新增 `plugin-contracts` job，执行 K0 contract test + source check；
- 现有 required `build-and-check` 已保持名字稳定，作为 ccm + plugin jobs 的 aggregator；
- release gate 只发布已保存且 final-dist verifier 通过的生成物。

不要把 LLM eval 变成 deterministic CI 的依赖；它属于改行为时的带外证据。

### 11.4 Structural 与 behavioral evidence 分轨

`report` 必须同时存在但分别判决两条轨：

- `structural_status`：Schema、binding、SSOT、inventory、topology、hop、projection、drift；
- `behavioral_evidence_status`：`not_run | baseline | candidate | holdout_verdict`，并附证据 ref。

结构 hard gate 只能由 deterministic verifier 决定。行为轨未到 `holdout_verdict` 时，报告最多陈述
“未测 / 已采 baseline / candidate 待判”，不得输出“更精准”“提升正确率”等 improvement claim。
行为回归也不得被结构全绿掩盖。

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

真实创建该 meta-skill 的同一变更必须：

1. 把 root `AGENTS.md` 的项目 dev/meta skill 数量从 7 更新为 8；
2. 在路由段与“触发式深入阅读”各加一个 `governing-skill-knowledge` 指针；
3. 运行 `bash scripts/sync-codex-skills.sh`，只由 `.claude/skills` 投影 `.agents/skills`；
4. 保持 runtime portfolio 数量为 8，不在 `plugin/src/skills` 新增 governance runtime skill。

K1 工具未完成或 meta-skill 尚未创建时不得提前把 root 导航写成“已可用”；本段是创建时的原子
同步合同。

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
