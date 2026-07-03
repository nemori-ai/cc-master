# ADR-012 — `parent` 升入 narrow-waist + rollup-aware Stop gate

> Status: **Accepted**（扩展 ADR-003 的 waist 集合——加一个 pinned 字段，不推翻其「窄腰 + silent-on-unknown」原则）
> Date: 2026-06-22
> Scope: board JSON 契约（硬 waist 集合 +1：`tasks[].parent`）+ `hooks/scripts/verify-board.sh`（Stop gate 变 rollup-aware）+ `hooks/scripts/board-lint-core.js`（新增 R7 nesting 不变式 + `buildGraph` 抽出 parent 倒排）+ `skills/master-orchestrator-guide/references/board.md` + `assets/board.template.json` / `board.example.json` + 全 hook 测试
> Source: D3 nested-DAG 设计稿（`design_docs/plans/2026-06-21-D3-nested-dag-design.md` §2/§3/§4）——R-B §8 推荐路(i)，**用户拍板改走路(ii)**（hook 感知 rollup）；R-B 影响矩阵 + Finding #12（并行后端点必跑全套）

---

## 1. Context

cc-master 的 0.9.0 北极星是**超大规模任务**——一个目标拆成几十上百子任务、按模块 / 阶段天然分组。今天这种结构只有两个出口：① 摊平进单层 flat `tasks[]`（丢失「这 30 个子任务同属模块 X」的分组语义），或 ② 下沉给执行者的项目内 planning 层（board 上是不透明单节点、cc-master 调度看不见）。中间档缺失——「owner 分组语义值得保留、且这些子节点值得 cc-master 自己横向调度（派发 / WIP / 端点验收 / watchdog 全覆盖）」无处安放。

D3 补这一档：让 board 承载 **nested（max depth=1）的调度图**——一个扁平节点集背两条正交边（`deps` 调度 / `parent` 容器）。`parent`（子 → 父的单值指针）是新增的容器边。

岔路口在「`parent` 该不该进 narrow-waist」。R-B 的影响审计精确指出：选项 B 下子节点本就是 top-level task，所以现有 hook **照常看见**子节点的 in_flight/ready（Stop gate 不对子节点失明）。基于此 R-B §8 推荐**路(i)**——waist 不变，把 `parent` 当纯柔性边、rollup 全归 agent prose。

但 R-B 也点出路(i) 的盲区：hook 看得见子节点的状态，**看不见父子关系**——它不知道 owner-M1 在 M1.b 还 in_flight 时不该被当「真 done」。**「父被错标 done 而子在飞」是安全相关盲区**（与 ADR-011 watchdog 补静默失败盲区同源动机）：父大节点静默标 done，整个 owner 子图就此从 Stop gate 的视野里漏掉，没有任何机器兜底。用户拍板：这道盲区值得付红线 2 代价让 hook 兜底——**改走路(ii)**（`parent` 升入 waist、verify-board Stop gate 变 rollup-aware）。

本 ADR 记录这个 ADR-003 立 waist 以来**第一次主动扩 waist**的决定。

## 2. Decision

**采路(ii)：把 `tasks[].parent` 升入 narrow-waist，让 hook 机器感知 rollup。** 五个子决定：

### 2.1 `tasks[].parent` 升入 narrow-waist（新 hook-dependent 字段）

`parent` 是**单值 `string` 或缺省**——绝不是数组（单值指针保证「一个子最多一个父」，守封装 rollup + depth=1）。取值是一个**存在的** top-level task `id`，且该 id 指向的节点本身不能有 `parent`（指向的必是 owner）。缺省 = 顶层节点（`null` 语义）。这是 ADR-003 pinned 集合从 `tasks[{id,status,deps}]` 扩为 `tasks[{id,status,deps,parent}]`。

### 2.2 verify-board Stop gate 变 rollup-aware（owner 子未全 done 时不算真 done）

`verify-board.sh` 的完成态握手新增一条 rollup 子句：对每个 status=`done` 的 owner（= 被任意节点 `parent` 指向的节点），若它有任何子非 done → 注入一条**非阻塞提醒**「owner X 标 done 但子 Y 仍 <status>，rollup 不一致」（**Q-N1 定 软提醒非 hard block**——与现有 watchdog / pending_user_decisions 提醒同形态，与 cc-master「hook 软提醒非硬拦」一贯风格一致；容「父整合中、子刚标完」瞬态，硬拦会误伤）。fingerprint 纳入 `parent` 维度——子节点状态变会改 fingerprint，跨 compaction recon 感知 owner 子图变化。

### 2.3 board-lint 加 R7 nesting 不变式

`board-lint-core.js` 新增 R7 系列（与 R3/R4 并列），口径与 `board-graph-core.js` 的 `rollupConsistency()`/`checkDepth1()`/`parentCycles()` 字节对齐（同一语义两处实现）：R7a `parent` 引用存在（**hard error**，类比 R4a 悬挂 dep——parent 现是硬 waist 字段）/ R7b depth=1（**hard error**）/ R7c parent 无环（**hard error**，R7a∧R7b 成立时天然无环、显式第二趟兜底）/ R7d rollup 一致性（**warn**——容瞬态、硬拦误伤）。

### 2.4 depth=1 当 HTN type 不变式（不引入显式 `depth` 字段）

owner 只含 leaf 子——有 `parent` 的节点自己不能再当 parent。这是**type 规则**（借 HTN 的 leaf / compound 框架），不是运行时 depth 计数。schema 因此**只引入 `parent` 单字段、不引入 `depth`**：depth 完全可从 `parent` O(1) 推导（max depth=1 下只有 0/1 两值，单跳即知），存它只会引入一个必须与 `parent` 链长保持一致的冗余字段（漂移源——Finding #9 `wip_limit` pinned-vs-flexible 三处矛盾的同类陷阱）。type 不变式（检「子节点不被任何节点指为 parent」一条 = depth=1）比 depth 数值约束更自文档、更易 lint。

### 2.5 `deps` open / `parent` 封装（两条正交边）

`deps` 管「什么时候能跑」——**open**：可指任意节点（含跨父子图、别的 owner 的子），拓扑就绪即派、细粒度并行不丢。`parent` 管「谁拥有我、我 roll 进谁」——**封装**：单值、一个子最多一个父。两条边正交，一个节点可以 `parent` 指 owner-A、`deps` 指 owner-B 的某个子。

## 3. Consequences

### 3.1 Positive

- **补上「父被错标 done 而子在飞」的安全盲区**：路(ii) 把「父 done 一致性」从纯 agent 自律升为 **hook 机器检测 + 软提醒**（**非强制 / 非 hard block**·Q-N1）——整个 owner 子图不再可能从 Stop 视野里静默漏掉（机器一旦检出 rollup 不一致就追加一条非阻塞提醒，与 ADR-011 watchdog 同源的安全网思路；最终是否真 done 仍由 agent 端点验收拍板，机器只软提醒不硬拦）。
- **owner 分组语义可保留且仍被 cc-master 横向调度**：超大规模目标按模块分组的中间档落地，子节点照常享派发 / WIP / 端点验收 / watchdog。
- **图算法单一真相源**：`board-lint-core.js` 的 `buildGraph` 抽成纯函数并加 parent 倒排（`children`/`parentOf`），`board-graph-core.js` 在其上叠图算法——lint 侧 R7 与库侧 rollup 查询一份口径，杜绝「lint 的图」「分析的图」「rollup 的图」三份漂移。

### 3.2 Negative

- **兑现 ADR-003 §3.2 的警告**——waist 是协调点，扩它是 cross-cutting 改动。这是 ADR-003 立 waist 以来**第一次主动扩 waist**：blast radius = `verify-board.sh` + `board-lint-core.js` + 全测试 + `board.md` + `board.template/example.json`，必须按红线 2 走「同 PR 改全 hook + 测试 + PR 描述显式说明 + 本 ADR」。
- **bash hook 第一次读 tasks 的「关系」而非「状态枚举」**——verify-board 从纯 flat 的状态计数变成要提 `(id, status, parent)` 三元组做 rollup 判定。**关键缓解：max depth=1 让 parent 映射是 flat 单层**（单值 + depth=1 ⇒ rollup 判定是纯 flat 集合运算，无递归、无深度门）——这是把脆性从「不可接受」降到「可控」的决定性约束。即便如此 verify-board 的 awk/grep 显著变重，必须配足测试。

### 3.3 Neutral

- **降级纪律守住向后兼容**：`parent` 缺失 / 格式不合的旧板（或手写板）→ 无 parent 边 ⇒ rollup gate 退化为现有 flat 行为（无 owner = 无 rollup 检查），board-lint silent-on-unknown 不破（旧板无 `parent` = 合法顶层节点，R7 全不报）。**绝不因旧板弄坏 Stop gate 或 lint**。
- **`kind` 仍是柔性边**：owner 节点可用 `kind:"owner"` 自标（view / status 渲染分组省一次反查），但 hook 判 owner 一律靠反查 `parent` 边、不读 `kind`——`kind` 不进 waist。

## 4. Alternatives Considered

### 4.1 Alternative A: 路(i)——waist 不变，嵌套当柔性边、rollup 全 prose（R-B 原推荐）

R-B §8 的原推荐：`parent` 当纯柔性边，hook 一字不改，rollup 全归 agent prose 纪律。**被用户拍板否决。** 理由：选项 B 下子节点是 top-level、hook 照常看得见子节点状态——但 hook **看不见父子关系**，无法在「父被错标 done 而子在飞」时兜底。这是安全相关盲区（同 ADR-011 watchdog 补静默失败的动机），值得付红线 2 代价让机器兜底，而非全靠 agent 自律（agent 在压力下能合理化掉「父 done 了吧、子差不多了」）。

### 4.2 Alternative B: 选项 A inline subtasks（子节点内嵌进父 task 对象）

把子节点作为父 task 内的嵌套数组（而非 top-level task）。**否决**——这会让 verify-board / posttool-batch 对子节点**失明**（它们只 walk tasks 数组顶层对象，嵌套子不被计 in_flight、不被 Stop gate 看见），是正确性回归。路(ii) 的子节点仍是 top-level task（享所有现有 hook 的横向可见性），只多一条 `parent` 容器边——是「扁平节点集 + 容器边」而非「嵌套对象」。

## 5. Related

- [`ADR-003-board-narrow-waist.md`](ADR-003-board-narrow-waist.md) — 本 ADR **扩展** ADR-003 的 waist 集合（加 `tasks[].parent` 一个 pinned 字段），**不推翻**其「窄腰 + silent-on-unknown」原则；ADR-003 仍 Accepted（对照 ADR-011 narrows ADR-002 的先例——扩展用 Related + 注、不改被扩 ADR 正文）。
- [`ADR-001-hooks-pure-bash.md`](ADR-001-hooks-pure-bash.md)（被 ADR-006 取代）/ [`ADR-006-hooks-may-use-node-js.md`](ADR-006-hooks-may-use-node-js.md) — verify-board rollup gate 仍纯 bash（parent flat 提取，无 jq/python），board-lint R7 是 node/JS（红线 1）。
- [`ADR-011-self-wakeup-watchdog.md`](ADR-011-self-wakeup-watchdog.md) — 同源动机（hook 兜底「无完成事件」的静默失败盲区）；rollup gate 兜底「父被错标 done 而子在飞」的同类静默盲区。
- [`../skills/master-orchestrator-guide/references/board.md`](../skills/master-orchestrator-guide/references/board.md) — `parent` 硬 waist 小节 + depth=1 不变式 + rollup 纪律的 evergreen 描述。
- [`../design_docs/dogfood-findings.md`](../design_docs/dogfood-findings.md) — Finding #9（pinned-vs-flexible 漂移，是「不引入冗余 `depth` 字段」的依据）；Finding #12（并行后端点必跑全套，是「父 done 还需父端点验收」的依据）。

## 6. References

- D3 nested-DAG 设计稿 `design_docs/plans/2026-06-21-D3-nested-dag-design.md` §2（schema）/ §3（rollup 语义）/ §4（红线 2 逐项摊开）/ §4.8（本 ADR 提纲）——含两份调研 R-A（图库）/ R-B（嵌套 schema）的综合。
- HTN（Hierarchical Task Network）的 leaf / compound 框架——depth=1 type 不变式借其 owner-only-contains-leaves 的建模。
