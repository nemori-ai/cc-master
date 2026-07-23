# 工程分类：不要把知识图、路由图、authority 和 source map 混成一张图

## 1. 最小领域对象

| 对象 | 定义 | 是否是正文 |
|---|---|---|
| `entry` | command、顶层 skill、用户意图等进入点 | 否 |
| `skill` | 可触发的 runtime package | 容器，不是 point |
| `module` | 一组共同服务一个导航意图的 points | 可绑定连续 Markdown span |
| `point` | 最小可拥有、引用、定位、验证的知识单元 | 必须绑定 primary span |
| `artifact` | Markdown 文件、manifest、generated source map | 否 |
| `projection` | canonical point 在某 host 最终产物的位置 | 否 |

### point 原子性

一个 point 应：

- 能用一句话说明它回答的判断；
- 有唯一 owner；
- 可以单独被路由到；
- 能判断一次改动是措辞、refine、split 还是 merge；
- 不因每段都要 ID 而机械碎片化。

建议 kind：

```text
principle decision procedure boundary fact
anti_pattern example glossary router check
```

## 2. 四个持久 graph plane

### 2.1 Authority graph

回答“谁定义、谁派生、谁替代谁”：

```text
owns
derives_from
summarizes
operationalizes
supersedes
```

约束：

- 定义型 point 单 owner；
- authority 边不形成非法定义循环；
- summary 不能重新成为第二 SSOT；
- delete 必须以 supersession/retirement 结束。

### 2.2 Navigation graph

回答“agent 何时、按什么顺序去读哪里”：

```text
routes_to
deepens_to
prerequisite
next
check
alternative
fallback
contrasts_with
incompatible_with
returns_to_atlas
```

属性：

- 可以有环；
- 目标 point 集应按产品要求强连通；
- 只有 runtime-visible edge 计入 hops；
- 每条边需要 recognition cue；
- procedure chain 需要 role/order；
- negative edge 也属于路由知识。

### 2.3 Trigger graph

回答“什么用户意图/command/entry 会激活哪一组知识”：

```text
intent → entry → skill → module
```

它与 frontmatter description 的 skill-level routing 对齐，但下钻到 module/point。

### 2.4 Projection graph

回答“canonical node 最终在哪里可见”：

```text
canonical point
  → canonical Markdown span
  → host strategy
  → host runtime Markdown span
```

projection 缺失、stub/partial 能力差异或 anchor 丢失时，不能继续把 canonical edge 计入该 host 的 hops。

## 3. 两个临时 query-time view

持久图不应整张灌入 agent context。每个 query 生成两个 bounded view：

### 3.1 Route plan

```text
Start
Support
Next
Check
Avoid
Debt
```

### 3.2 Evidence pack

route plan 中节点绑定的 Markdown spans，按顺序读取，并受：

- max hops；
- max file reads；
- max tokens；
- host capability；
- evidence sufficiency。

query-time view 是派生物，不是 SSOT。

## 4. Stable identity 与 source binding

### 4.1 ID 不编码位置

推荐：

```text
orchestration.endpoint-verification-principle
verification.endpoint-procedure
```

不推荐：

```text
master-orchestrator-guide/resume-verify.md#L26-L73
section-3-2
```

### 4.2 Markdown span marker

正文只携带不可见边界与稳定 anchor：

```markdown
<!-- ccm:k:start verification.endpoint-procedure -->
<a id="k-verification-endpoint-procedure"></a>

...

<!-- ccm:k:end verification.endpoint-procedure -->
```

compiler 生成 path、line/column、byte offset、content hash。行号不手写。

### 4.3 Span 约束

v1 建议：

- 一个 content-bearing node 一个 primary span；
- span 必须同文件连续；
- spans 可分离或嵌套，不得部分交叉；
- code fence 内 marker 不生效；
- 同概念多处出现时建不同职责节点，用 typed relation 连接，不做一个 ID 多 primary spans。

## 5. Node contract

### 5.1 所有 point 的公共字段

```text
id
kind
module
owner_skill
summary             # routing metadata，不代替正文
applies_when
avoid_when
maturity
lineage
admission
```

### 5.2 kind-specific contract

| kind | 可选字段 |
|---|---|
| `procedure` | inputs、outputs、termination、failure_modes |
| `decision` | decision_inputs、outcomes、escalation |
| `router` | cues、destinations、coverage_debt |
| `check` | subject、validator、pass_condition |
| `principle` | scope、non_goals、exceptions |
| `boundary` | inside、outside、handoff |

不要为了 schema 整齐给 glossary 填虚假的 termination/output。

## 6. Edge contract

一条可计算的 runtime navigation edge 至少包含：

```text
from
type
to
when
role
order?              # 有序链适用
avoid_when?
runtime_visible
host_coverage
```

### Edge role 与 type 的区别

- `type` 说明两个知识点之间的语义关系；
- `role` 说明这条边在当前导航 plan 中的作用。

例如 `deepens_to` 可以在一个 query 中是 `Support`，在另一个 query 中是 `Next`。
持久 manifest 记录默认 role/cues；query-time router 可以在合法范围内实例化视图。

## 7. 三跳 contract

### 7.1 图论定义

对 host `h` 的 runtime-visible directed graph `G_h = (V_h, E_h)`：

- `V_h` 是该 host 可消费的 accepted knowledge points/modules；
- `E_h` 只含真实 traversal surface；
- 对所有目标 point pair `(u,v)`，应有 directed shortest path；
- `diameter(G_h) ≤ 3`。

入口节点可单独定义 `entry eccentricity ≤ 3`，不应混淆 point-to-point diameter。

### 7.2 合法 hop

一次 hop 必须是 agent 可执行的“打开/调用下一个知识 surface”：

- 同文件 stable anchor；
- 跨文件 Markdown link；
- 明确 skill invocation；
- host-native 等价入口。

dev-only YAML edge、裸概念提及、无法解析的路径、unsupported host target 都不是 hop。

### 7.3 防 hub gaming

下列图直径可能合格，但产品不合格：

- 所有 point → 一个列出所有 point 的巨型 atlas；
- atlas 没有 recognition cue；
- router 只给 summary，未绑定正文；
- agent 每次都需扫描全图库；
- single hub 失效即全断。

因此 diameter 外还要报：

- atlas/router token budget；
- p50/p95 reads；
- hub load 与 articulation risk；
- route selection accuracy；
- wrong-owner rate；
- coverage debt / abstention；
- path witness。

## 8. Lifecycle 与 operator

### 8.1 Maturity

```text
proposed → accepted → deprecated → retired
```

退役 ID 永不复用。

### 8.2 v1 identity operators

| operator | ID 语义 | 必须记录 |
|---|---|---|
| `add` | 新身份 | evidence、owner、入口 |
| `refine` | 身份不变，语义边界不变 | reason、validator |
| `move` | 身份不变，只改 projection | source-map diff |
| `split` | 旧节点转 router/tombstone，新建多个 ID | from/to、reason |
| `merge` | 旧节点 superseded，新/保留一个 ID | losers/winner、冲突处理 |
| `transfer_owner` | 身份不变，owner 变化 | before/after、portfolio review |
| `deprecate` | 仍可读但不再首选 | alternative、deadline |
| `retire` | 不再 runtime 可达 | tombstone、replacement/why-none |

### 8.3 Admission

自动 proposer 可以提出：

- candidate node；
- candidate duplicate；
- candidate relation；
- candidate split/merge。

它不能直接把 maturity 改为 `accepted`。admission 至少需要：

- evidence pointer；
- owner/overlap check；
- structural validation；
- projection check；
- behavior fixture 或明确豁免理由；
- reviewer/authorizer。

## 9. 两个维护循环

### Write-time library loop

```text
evidence → proposal → operator classification
→ source binding → verify → admit/reject → lineage
```

### Read-time task loop

```text
intent + current point → bounded route
→ ordered evidence read → decide/act/check
→ answer or Debt/abstain
```

task-time 的一次临时组合不会自动成为永久 graph mutation。

## 10. 健康指标

### 结构 hard gates

- marker pairing/nesting/uniqueness；
- node ↔ span 一一绑定；
- owner 唯一；
- authority acyclic；
- relation endpoints 存在；
- lineage 合法、ID 不复用；
- host projection coverage；
- runtime edge 可解析；
- directed diameter ≤ 3。

### 诊断指标

- utility/use frequency；
- redundancy；
- compatibility/conflict；
- validation gap；
- failure risk；
- stale age；
- library growth/retirement；
- node size distribution；
- module fragmentation；
- hub load；
- token/read cost。

### 行为指标

- trigger/module/point accuracy；
- ordered composition accuracy；
- wrong-owner rate；
- max/p95 hops；
- max/p95 reads/tokens；
- evidence-grounded action correctness；
- abstention/debt calibration。

这些维度不得压成一个总健康分，因为 hard failure 会被平均值掩盖。

## 11. 典型失败模式

| 失败 | 表面症状 | 实质 |
|---|---|---|
| heading-as-ID | 改标题后节点“删除+新增” | identity 与 presentation 混淆 |
| manual line ranges | CI 偶发指错段 | location 被当成身份 |
| graph-only truth | summary 与正文冲突 | 第二 SSOT |
| untyped related edges | 图很密但不会用 | 关系无行动语义 |
| giant hub | 直径很好、token 爆炸 | gaming topology |
| dev-only reachability | JSON 全通、agent 不可达 | projection 不真实 |
| no lineage | split/merge 后历史消失 | 当前快照冒充生命周期 |
| auto-merge by embedding | 不同 owner 被误合 | 相似不等于同义/同职责 |
| one schema for all kinds | principle 被迫填 output | skill 与知识点混淆 |
| only static checks | agent 仍选错路径 | graph integrity 不等于 behavior |
