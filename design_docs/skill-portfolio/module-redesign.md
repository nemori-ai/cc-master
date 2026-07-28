# Skills 体系重设计 —— 从 modules 出发（结构轴）

> 状态：**已采纳（2026-07-28）**，作为 skill portfolio 第三次重排的**结构轴** SSOT。入口见同目录 [`README.md`](README.md)；内容轴见 [`guidance-tradeoff-charter.md`](guidance-tradeoff-charter.md)。
>
> 采纳的是**判据与目标形态**；§7 列出的三处待拍板项在 README 的「未决」表里跟踪，落定后补一份 ADR（续 ADR-019 / ADR-027）。
>
> 依据：`plugin/src/knowledge` 图快照 `graph_hash=30642077b9f4c6bd9777e6420a8de638fc3a9685c908d1d9c1198e1f8f7fdaa4`（8 skill / 46 module / 249 point / 404 edge / 8 entry，`report` 0 diagnostics）。**采纳时图已前进到 47 module / 256 point / 418 edge**（`ef7da7fb…`，含协作知识点批次）——本文的点数账目以快照时为准，迁移时按当时图重算。
>
> 约束（用户拍板，本文全程遵守）：
> 1. **必须有一个顶层统一入口 skill**。
> 2. **`using-ccm` 保留，定位为纯工作手册 —— ccm CLI 的 cookbook。**

---

## 0. 一句话结论

当前 46 个 module 是**按 skill 归属切的**，不是按**认知平面**切的。于是入口、决策、机制三类知识在 SKILL A 里揉成一团（14 module / 61 point / 9 条边），而同一个概念在 A 和 D 各存一份（board 窄腰、号池、artifact/verified）。

重设计的动作只有一个：**把 249 个 point 按「读它的人此刻在做什么」重新分平面，再让 skill 边界落在平面缝上。** 结果是 46 → 47 module、8 → 9 skill，249 个 point 一个不增不减，全部有新归宿。

---

## 1. 设计原则

### 1.1 五个认知平面（分层规划思想的反身应用）

`multi-layer-planning.md` 讲的是「board ⊥ 被编排项目的 planning 层」——两层正交、层间靠显式契约交接。把这套思想**反过来架到 skills portfolio 自己头上**，得到五个平面：

| Plane | 名称 | 读它的人此刻在做什么 | 常驻性 | 篇幅纪律 |
|---|---|---|---|---|
| **P0** | 入口 / 路由 | 「我是谁、现在该看哪、这回合跑什么程序」 | **每回合常驻重注** | **极瘦**，越短越好 |
| **P1** | 决策 | 「这个目标怎么定 / 怎么切 / 怎么排 / 派谁 / 何时停」 | 按需 drill | 中等 |
| **P2** | 机制 / 操作 | 「这个命令怎么敲 / 这个 API 什么形状」 | 动手时查 | **可以很长**，但必须按章可查 |
| **P3** | 手艺 | 「这段代码 / 这个循环本身该怎么做好」 | worker 侧 | 中等 |
| **P4** | 回流 | 「这次学到的东西该沉淀成什么」 | 事后 | 短 |

平面之间只有一种合法关系：**上层单向引用下层的机制，绝不复述**。这正是 AGENTS.md §3 红线 3 已经写死、但图上一条边都没建的那套约定。

### 1.2 三条模块级不变式

1. **一个 module 只属于一个平面。** 混装平面的 module 必须拆。
2. **一个概念只有一个 owner module。** 跨 skill 出现第二份即合并。
3. **module 边界 = 文件边界。** 「按需 drill 一个 module」在物理上必须等于「读一个不大的文件」，否则渐进披露名存实亡。

### 1.3 顶层入口 = 恰好那 4 个 critical pin

portfolio 自己定了 `critical_pin_budget: {max_modules: 4, max_fraction: 0.1}`。当前这 4 个名额是 `ccm.mind-model` / `distill.evidence` / `slicing.vertical` / `verification.endpoint` —— **每个 skill 各挑一个自家最重要的，把全局常驻预算当成了 per-skill 荣誉分。**

正确读法：critical pin = **全局常驻**预算。那么顶层入口 skill 就应当**恰好等于这 4 个 critical module**，不多不少。这个对齐不是凑数——它给了「入口该装什么」一把可机检的尺子。

判据（什么该常驻）：**agent 在压力下会合理化掉的东西 + 每回合都要跑的程序。** 其余一律可 drill。

---

## 2. 现状模块的四类病灶（全部有图上证据）

### 病灶 A · 平面混装（该拆）

| module | 混了哪几个平面 | 证据 |
|---|---|---|
| `control.decision-loop`（7 点） | P0 身份 + P0 决策程序 + P0 路由地图 + P1 镜头 | 7 点 **0 边**，是 A 里最大的无边点袋 |
| `ccm.board-model.contracts`（10 点） | P1 判断（planning/jc/cadence/watchdog/DDL…9 点） + P2 速查（validation-rules 1 点） | 判断与查表同居一个 module |
| `ccm.board-model.lifecycle`（7 点） | 全部是 P1 判断，却住在 P2 的 cookbook 里 | status 怎么转 / executor 怎么选 / acceptance 怎么写，都是决策不是查表 |
| `ccm.account-pool`（5 点） | P1 号池概念 4 点 + P2 命令面 1 点 | module intent 自己就写着「换号决策不在本模块」 |
| `ccm.mind-model`（6 点） | P2 协议前提 4 点 + P0 路由 2 点 | `ccm.when-to-open` 是路由不是心智 |
| `capacity.delivery`（5 点） | 模型分配 2 点 + DDL 纪律 3 点，两件事 | 5 点 0 边 |
| `verification.endpoint`（7 点） | P0 红线（terminal-is-not-done）+ P1 验收流程 6 点 | critical pin 却只有 2 条边、5 点孤立 |

### 病灶 B · 概念重复（该并）

| 概念 | 第一份 | 第二份 | 后果 |
|---|---|---|---|
| board 窄腰与写入纪律 | `board.waist-and-write`（A） | `ccm.write-gate` + `ccm.field-tiers`（D） | 两处各自演化，锁步靠人 |
| 号池 | `capacity.account-switch`（A，决策 2 点） | `ccm.account-pool`（D，概念 4 点） | 决策与概念隔了一个 skill |
| artifact/verified 真完成 | `verification.endpoint`（A） | `ccm.board.artifact-verified`（D） | 同一条 ADR-026 语义两处表述 |
| 续跑/采访 | `board.resume-and-interview`（A） | `hitl.decision-package`（A） | 同 skill 内也重 |

### 病灶 C · 归属错位（该迁）

- `goal.contract`（4 点）在 A —— 但「把原始需求变成可检验的目标 revision」属于**定义目标**平面，跟 slicing 是连续动作，不该跟排期同居。
- `devloop.outer`（2 点）在 F —— 但「把外层 loop 建成可调度的优化系统」是 **orchestrator 派发时**的决策，错位在 executor 侧 skill 里。
- `evidence.outside-in`（4 点）在 A —— 它是「让承重判断接触现实」的校准，服务的是**目标与假设**，不是派发。

### 病灶 D · 入口缺位

A 同时扮演入口、方法论、机制索引三个角色。导航整个压在 `control.navigation-map` 一个**孤立 point** 的散文里，于是每回合 compaction 必须整篇重注 16,859 tokens 的 SKILL.md。`path --from point:control.decision-program --to point:verification.terminal-is-not-done` → `SKG-PATH-UNREACHABLE`，BFS `explored` 只有起点自己。

---

## 3. 目标模块图（46 → 47，249 点全部守恒）

### 3.1 P0 · 顶层统一入口 —— `master-orchestrator-guide`（保名升格）

**为什么保名而不新建**：四个 host 的 entry surface 已全部绑定 `skill:master-orchestrator-guide` 与 `point:verification.terminal-is-not-done`。保名 = adapter 零改动、entry binding 零改动，且「master orchestrator guide」做统一入口名副其实。它从「什么都装的大 skill」**升格为纯 router + 常驻红线**。

| 新 module | access | 点 | 来源 |
|---|---|---:|---|
| `control.identity` | **critical** | 4 | 拆自 `control.decision-loop`：identity-mandate / role-consequences / operating-lenses / good-orchestration |
| `conduct.red-lines` | **critical** | 5 | `conduct.never-play`(3) + `control.rationalization-guards` + **`verification.terminal-is-not-done`**（假完成是最高频合理化，上提为红线） |
| `control.decision-program` | **critical** | 1 | 拆自 `control.decision-loop`：每回合决策程序（7 步 + step-6 ledger gate） |
| `control.atlas` | **critical** | 3 | **新建**：`control.navigation-map` + `ccm.when-to-open` + `ccm.pointers-routing` 合并，承载全 portfolio 的 typed 路由 |

**4 module / 13 point，恰好用满 `critical_pin_budget.max_modules: 4`。**

### 3.2 P1 · 决策平面（三个 skill）

#### `framing-and-slicing-goals`（现 `slicing-goals-into-dags` 扩容改名）

「定义要做什么」→「切成能做的」是同一个连续动作，现在被 A 和 E 劈成两半。

| module | 点 | 变动 |
|---|---:|---|
| `goal.contract` | 4 | **迁自 A** |
| `evidence.outside-in` | 4 | **迁自 A** |
| `slicing.vertical` | 2 | 不变（critical → 降为 primary，名额让给入口） |
| `slicing.craft` | 5 | 不变 |
| `slicing.example` | 1 | 不变 |

**5 module / 16 point**

#### `scheduling-and-dispatch`（新建）

A 的主体 + D 的判断层。这是本次重设计唯一的新 skill。

| module | 点 | 变动 |
|---|---:|---|
| `scheduling.dependency-dag` | 3 | 迁自 A |
| `routing.worker-chain` | 7 | 迁自 A |
| `dispatch.parallel-mechanisms` | 6 | 迁自 A(4) + **`devloop.two-scale` / `devloop.ml-components` 迁自 F** |
| `planning.multi-layer` | 4 | 迁自 A |
| `board.task-modeling` | 7 | **迁自 D 的 `ccm.board-model.lifecycle`**（status/executor/acceptance/estimate/deps/blocked_on/字段三档） |
| `board.orchestration-contracts` | 10 | **迁自 D 的 `ccm.board-model.contracts` 判断部分**(9) + `ccm.planning-opt-in` |
| `coordination.async-hitl` | 5 | 迁自 A(4) + `board.resume-and-interview` 并入 |
| `verification.endpoint` | 7 | 迁自 A，减 terminal-is-not-done，加 `board.audit-and-graph` |
| `continuity.handoff` | 3 | 迁自 A |

**9 module / 52 point**

> 这一步顺带消掉了本仓最别扭的一处割裂：「A 讲 decomposition 怎么定粒度、D 讲 deps 字段怎么连」——同一件事的两面被 skill 边界劈开，现在合到一个平面。

#### `pacing-and-estimation`（保名扩容）

把「容量」这条轴收全：配速信号、估算、模型分配、DDL、换号 lever 全部同平面。

| module | 点 | 变动 |
|---|---:|---|
| `pacing.signals` / `pacing.estimation` / `pacing.levers` / `pacing.pool` / `pacing.model-facts` / `pacing.target-facts` | 16 | 不变 |
| `capacity.model-allocation` | 2 | **迁自 A**（拆自 `capacity.delivery`） |
| `capacity.deadline` | 3 | **迁自 A**（拆自 `capacity.delivery`） |
| `capacity.account-lever` | 6 | **合并**：A 的 `capacity.account-switch`(2) + D 的号池概念(4) |

**9 module / 27 point**

### 3.3 P2 · 机制平面（两个 cookbook）

#### `using-ccm` —— 提纯为纯 CLI cookbook（用户约束）

搬走全部 16 点判断性内容后，只剩「怎么敲」和「敲之前必须知道的前提」。

| module | 点 | 说明 |
|---|---:|---|
| `ccm.protocol-premises` | 5 | 用手册前的 5 条前提：写入关卡 / status 是状态机 / 字段三档 / 唯一写路径 / **窄腰（并入 A 的 `board.waist-and-write`）** |
| `ccm.hotpath-footgun` | 3 | 热路径 flows + footgun 表 + exit code 速记 |
| `ccm.commands.core` | 6 | board / goal / task / log / --json |
| `ccm.commands.extended` | 9 | cross-harness / usage / estimate / ops |
| `ccm.commands.scheduling` | 6 | jc / cadence / watchdog / agent / baseline + **`ccm.cmd.account`（拆自 account-pool）** |
| `ccm.validation-rules` | 2 | FMT/GRAPH/BIZ 规则速查 + **`board.worked-example`（迁自 A）** |

**6 module / 31 point**（原 8 module / 52 point）

> **cookbook 的定义在这里被钉死**：只回答「怎么敲、敲错了怎么办、字段合法值是什么」。**不回答「该不该敲、这里填哪个值更好」**——后者一律归 P1。`ccm` ⟷ `using-ccm` 的 §6 锁步纪律因此变得可机检：命令面变 → 只碰 `ccm.commands.*` 与 `ccm.validation-rules`；判断变 → 碰 `scheduling-and-dispatch`。

#### `authoring-workflows`（不变）

3 module / 43 point。它已经是标准形态的机制 cookbook（40/43 点是 API reference + pattern catalog），且 cohesion 1.953、零孤立点。**唯一待补：description 缺 Do NOT 段**（八个 skill 里唯一没有排他边界声明的）。

### 3.4 P3 / P4 · 手艺与回流（基本不变）

- `engineering-with-craft` 5 module / 40 point —— 不动。
- `dev-as-ml-loop` 2 module / 15 point —— 只迁出 `devloop.outer`（那 2 点是 orchestrator 侧）。
- `distilling-lessons-into-assets` 4 module / 12 point —— 不动，但需补正文的跨 skill 路由（现在正文零跨 skill 引用，边界全押在 description）。

### 3.5 总账

| | 现状 | 目标 |
|---|---:|---:|
| skill | 8 | **9**（+1 新建 `scheduling-and-dispatch`） |
| module | 46 | **47** |
| point | 249 | **249**（守恒，零丢弃零新增） |

| skill | module | point | 估算 tokens | 占比 |
|---|---:|---:|---:|---:|
| `master-orchestrator-guide`（入口） | 4 | 13 | 18,922 → **目标重写至 ≤8,000** | 7.3% → ~3% |
| `framing-and-slicing-goals` | 5 | 16 | 12,682 | 4.9% |
| `scheduling-and-dispatch` | 9 | 52 | 74,188 | 28.4% |
| `pacing-and-estimation` | 9 | 27 | 19,526 | 7.5% |
| `using-ccm` | 6 | 31 | 80,307 | 30.8% |
| `authoring-workflows` | 3 | 43 | 15,605 | 6.0% |
| `engineering-with-craft` | 5 | 40 | 24,015 | 9.2% |
| `dev-as-ml-loop` | 2 | 15 | 7,054 | 2.7% |
| `distilling-lessons-into-assets` | 4 | 12 | 8,651 | 3.3% |

> token 数按「点在文件中均摊」估算，**是原样搬运的上界**，不含重写压缩收益。入口 skill 的 18,922 是搬运值；它必须被重写压缩（见 §5）。

---

## 4. 层间契约边 —— 放宽 `max_external_edge_count`

这是本次重设计的**结构性前提**。当前准入闸 `max_external_edge_count: 0` 把跨 skill 边完全焊死，于是 142 处层间引用只能活在散文里。

**提议的新 policy：按边类型分权，而不是一刀切零。**

| edge type | 跨 composition | 理由 |
|---|---|---|
| `routes_to` | ✅ **允许** | 表达「从这里去那个 skill」——正是层间单向引用的载体 |
| `contrasts_with` | ✅ **允许** | 表达「这个不是那个」——把 description 里的 Do NOT 段落成可机检的边 |
| `requires` | ❌ 禁止 | 跨界依赖会让 skill 无法独立读 |
| `deepens_to` | ❌ 禁止 | 深化跨界 = 把一个概念的正文劈成两半，破 SSOT closure |
| `next` / `operationalizes` / `applies_to` / `fallback_to` | ❌ 禁止 | 同上 |

配套 schema 字段：`max_external_edge_count` → `external_edge_policy: {allowed_types: ["routes_to","contrasts_with"], max_count: <N>}`。

这条改动**不破 SSOT closure**——每个 point 仍只有一个 owner module、一个 owner composition；跨界的只是导航与对比，不是内容。

**立竿见影的收益**：红线 3「八个 skill 互不重叠」从**人审**升级为**机检**——`contrasts_with` 跨界边直接编码了边界，`check` 能验，`path` 能查，漂移当场暴露。

---

## 5. 预期改善（可度量）

| 指标 | 现状 | 目标 | 依据 |
|---|---:|---:|---|
| 入口 skill 常驻重注成本 | 16,859 tok | **≤8,000**（激进档 ~5,000） | 只留 13 个常驻 point，七镜头/合理化表保留、4.x 操作段全部下沉 |
| `using-ccm` 准入 cap 占用 | **89.8%** | **61.3%** | 117,761 → 80,307 |
| 孤立 point | 53 / 249（21%） | **0** | 拆分后每个 module 都需自建 route/deepen 边 |
| `master-orchestrator-guide` cohesion | **0.148** | ≥1.5 | 13 点小 module 内建全连通 |
| 跨 skill typed edge | **0** | ≥40 | 覆盖 142 处散文引用中的承重部分 |
| `contrasts_with` 边 | 7（全 skill 内） | ≥16 | 9 个 skill 两两边界，至少覆盖 A↔E、A↔D、A↔H、F↔G、E↔A、I↔G/E/F |
| 单文件最大 token | 69,436 | **≤6,000** | `command-catalog.md` 按 namespace 一命令一文件拆成 ~21 章 |

**关于 `router_budget.atlas_max_tokens: 2800` 的诚实说明**：入口 skill 即使压缩到 5,000 tokens，仍是这个预算的 1.8 倍。原因是它同时承担 router（该 ≤2800）和常驻红线（合理化表 + 红旗，压不掉——那是纪律型内容，删了就失效）。建议**把预算拆成两档**：`atlas_max_tokens: 2800`（纯路由部分）+ `resident_discipline_max_tokens: 3200`（常驻纪律部分），合计 6,000。硬压到 2800 会触发 AGENTS.md §5 警告的「brevity bias 丢洞察」那一侧悬崖。

---

## 6. 迁移路线（5 批，每批独立可验）

用图工具的 typed change 事务（`change begin → validate → apply`）逐批推进，每批 `report` 必须回到 0 diagnostics。

| 批次 | 内容 | 依赖 | 风险 |
|---|---|---|---|
| **M1** | 放宽 `external_edge_policy`（portfolio schema + admission 闸） | — | 低。纯 policy，不动内容 |
| **M2** | 建 `control.atlas`，把 A 的散文导航落成 typed `routes_to` 边；补齐 8 个 skill 两两 `contrasts_with` | M1 | 低。纯增边，不动 point 归属 |
| **M3** | 拆 A：`control.decision-loop` → identity / decision-program / atlas；`verification.endpoint` 让出 terminal-is-not-done；`capacity.delivery` 一拆二 | M2 | 中。动 critical pin，四 host entry binding 需复验 |
| **M4** | 建 `scheduling-and-dispatch`，迁入 A 的 9 个 module + D 的 16 个判断点 | M3 | **高**。新 skill 需过 curating 准入（D1/D2/D3 + Probe A/B），description 需跑 Track A trigger eval |
| **M5** | `using-ccm` 提纯 + `command-catalog.md` 按 namespace 拆章；`framing-and-slicing-goals` 改名扩容；`pacing` 吸收 capacity | M4 | 中。§6 `ccm`⟷`using-ccm` 锁步纪律需同步改写 |

**M1+M2 可以先做且独立成立**——即使后面不拆 skill，把 142 处散文引用落成图上的边，本身就把红线 3 从人审变成机检。建议先合这一刀。

---

## 7. 待定与不做

**待你拍板的三处：**

1. **新 skill 叫什么** —— `scheduling-and-dispatch` 是我的推荐（涵盖排期/路由/并行/board 建模/HITL/验收）。备选 `dispatching-and-verifying`（更强调派发→验收这条链）。
2. **`slicing-goals-into-dags` 是否改名** —— 吸收 goal.contract + evidence.outside-in 后，`framing-and-slicing-goals` 更准，但改名要动 entry binding + trigger eval。不改名也能跑，只是名不副实。
3. **入口压缩档位** —— 激进档 ~5,000 tok（七镜头下沉，入口只留身份+红线+决策程序+路由）vs 保守档 ~8,000 tok（七镜头与合理化表留在入口）。这是「重注成本」与「纪律强度」的直接权衡。

**明确不做：**

- **不删任何 point。** 249 个全部守恒——这次是重新分区，不是裁剪。裁剪该单独走 curating 闸，跟重分区混在一起会让两件事都判不清。
- **不动 `engineering-with-craft` / `authoring-workflows` 的内部结构。** 它们 cohesion ≥1.95、零孤立点，是当前图上最健康的两个，动它们没有收益。
- **不引入第 10 个 skill。** 8→9 已经是能守住红线 3 的上限；再多就该重新审 portfolio 准入了。
