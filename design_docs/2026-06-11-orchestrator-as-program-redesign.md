# cc-master 整体再设计：orchestrator loop = 一个长跑程序

> **status**：设计提案（proposed，待 ratify）· **date**：2026-06-11
> **基线**：6 愿景 [`spec.md §1.0`](spec.md) · 落地审计 [`vision-landing-tracker.md`](vision-landing-tracker.md) · hooks 权威调研 [`research/claude-code-hooks-reference.md`](research/claude-code-hooks-reference.md) · curating Part A/B（会话）
> **方法**：以「agent loop 作为程序运行的工作流程」为脊柱，从 master orchestrator 角度，把 6 愿景重新映射到 plugin 的四层（commands / hooks / skills / scripts）+ board，并据**核实过的** hook 能力闭合审计 gap。
> **⚠️ 已按 [ADR-006](adrs/ADR-006-hooks-may-use-node-js.md) 修订**：hook runtime 约束从「纯 bash」改为 **bash + node/JS（JS only）**——Claude Code 本身是 Node 应用，node 天然可用。最大后果：**C2 usage 感知从「注定 prose/script」翻盘为可做成 node hook**（见 §5.1 H8）；board 解析可 `JSON.parse`。本文凡提「纯 bash」均应读作「bash + node/JS」。

---

## 0. TL;DR（核心论点）

1. **skill 体系不拆**（curating 判定）：6 愿景是「指挥一个长 horizon 目标」**一个** bounded context 的 6 个镜头，全在 `orchestrating-to-completion`。拆成 6 个 skill = 装饰 + overlap + 破坏 reinject。
2. **真正的架构杠杆在 hooks 的「通知通道」，而 cc-master 当前严重欠用它。** 现役 3 hook 只占了「点火 / 退出闸 / 续跑恢复」，**自动通知通道几乎空白**——而核实过的 hooks 矩阵显示 `SubagentStop` / `PostToolBatch` / `PostToolUse` / `Stop` 都能在自主 loop 里注入 context。
3. **orchestrator loop = 程序**：四层 = 程序运行时栈，6 愿景 = 程序的并发 / 调度 / 资源 / 特权 / 持久化能力，审计 gap = 某个程序阶段缺了运行时保证或通知。
4. **最大且最廉的赢**：把 loop 的**异步事件**（并行批解析）接到**自动通知**（`PostToolBatch`），把「agent 得记得查过调度」（脆弱 prose，compaction 后最易丢）变成「运行时主动告诉它」（确定性通知）——bash 即可、不动 narrow waist。（原同列 `SubagentStop`「sub-agent 完成 → integrate 通知」一项已评估并移除——`additionalContext` 不达父线、与内建通知冗余，见 §5.1。）
5. **ADR-006 解锁的赢**：node/JS 可用后，**C2 token 感知能做成确定性 hook**（node 算 JSONL burn-rate + 注入 pacing 警告，H8）——审计里「唯一被红线1 否决」的 gap 翻盘；且 board 解析从 400 行 awk 降为 `JSON.parse`。

---

## 1. 中心模型：orchestrator loop 作为一个程序

master orchestrator 是一个**长跑程序**：它的 CPU 是 loop 里的 LLM，内存是 board（+ context window），OS/运行时是 Claude Code 的 hook 系统。四层 + board 映射到程序运行时栈：

| 程序概念 | plugin 层 | 角色 | 不该装什么 |
|---|---|---|---|
| 入口 / 调用（`main` / CLI） | **commands** | 点火程序、查状态、停机（一次性触发） | 运行时逻辑（那是 hook/skill） |
| OS / 运行时（调度中断、syscall 闸、checkpoint/restore、exit guard） | **hooks** | **确定性保证 + 自动通知，agent 跳不过**；纯 bash、ship-anywhere | 需 runtime 的计算（python/网络）、读对话语义、改权威源 |
| 程序逻辑 / 算法（CPU 执行的源码） | **skills** | LLM 当 CPU 执行的**方法论纪律**（判断、推理） | 确定性强制（hook 的活）、机械可校验结构（contract 的活） |
| 系统调用 / 外部工具（libc / 外部 bin） | **scripts** | 需 runtime 的**带外感知/审计**（usage / codex / eval），手动或编排调用 | 进 hook（违背纯 bash ship-anywhere）|
| 持久堆 / 进程状态（survives checkpoint） | **board** | 跨 compaction 存活的程序状态；narrow waist = LLM↔hook 的 **ABI** | hook 依赖非 pinned 字段（动 waist = 红线2）|

**这套映射立刻给出设计原则**（§7 详述）：hook 是运行时层——只装「**必须**被确定性保证、且**纯 bash 可算**」与「**自动通知** agent 易忘之事」；其余皆 skill 方法论或 script 带外。

---

## 2. 程序生命周期（loop = workflow）× 层归属

把 orchestrator 的一轮跑当作程序执行流，逐阶段标出**谁拥有**、**现状**、**愿景**：

| # | 程序阶段 | 拥有层 | 现状 | 关联愿景 |
|---|---|---|---|---|
| 1 | **Load / bootstrap**（程序启动、init heap） | commands + `UserPromptSubmit:bootstrap` hook | 🟢 建 board + 注角色 | — |
| 2 | **Compile / plan**（建任务图） | skill（decomposition 方法论）→ agent 写 `tasks[]` DAG | 🟢 board 真文件 / 🟡 CPM 心算 | C4 |
| 3 | **Schedule**（run loop 的调度器） | skill（决策程序）；hook 可强制 | 🟡 手跑 prose scheduler；**过调度零兜底** | C5 |
| 4 | **Execute**（跑指令 / 开线程） | 三机制（shell / sub-agent / workflow，harness 原生） | 🟢 借原生机制 | C1 |
| 5 | **Interrupt / notify**（异步 I/O 完成） | **hook（当前空白）** | 🔴 靠 agent 自觉收割 done | C1 / C5 |
| 6 | **Resource throttle**（配额节流） | script（cc-usage）+ skill（pacing） | 🟢 sensing / 🟡 决策；**loop 不调传感器** | C2 |
| 7 | **Privileged-op gate**（特权操作 = sudo） | skill（HITL 判断）；hook 可通知 | 🟡 prose 边界；**未答终审能静默退出** | C3 |
| 8 | **Resource allocation**（每任务选档/核） | skill（选型方法论）+ `agent({model})` lever | 🟢 lever / 🟡 选档 / 🔴 duration 维 | C6 |
| 9 | **Checkpoint / restore**（survive compaction） | board + `SessionStart:reinject` hook | 🟢 角色恢复；**计划事务一致性无守护** | continuity / C4 |
| 10 | **Exit guard**（未完成不许退） | `Stop:verify-board` hook | 🟢 真退出闸；**只信 board status、board 完整性零保障** | C1 |

**读这张表的方式**：🔴/🟡 标注的阶段就是审计的真 gap 所在——而它们**高度集中在「阶段 5 Interrupt/notify」（完全空白）+ 阶段 3/7/9/10 的运行时保证缺位**。这正是「通知通道欠用」论点的来源。

---

## 3. 四层职责再定位（program-as-loop 下）

### 3.1 commands —— 入口/调用面
`as-master-orchestrator`（点火）/ `status`（查程序状态）/ `stop`（停机）。**再设计：`status` 变富**——把新增的 read-only 健康检查（deps 图一致性、过调度、未答用户决策、budget 快照）都从这里 surface，作为「程序状态查询」的统一出口。无新增 command。

### 3.2 hooks —— 确定性运行时层（再设计的主战场）
**原则**：只装两类——(a) **必须确定性保证**且 bash/node 可算（exit guard、特权操作不静默退出）；(b) **自动通知/感知 agent 易忘之事**（异步完成、过调度、resume 悬挂、usage burn-rate）。当前只用了 (a) 的一半 + 续跑恢复；**(b) 通知通道几乎空白**，是再设计的主战场。runtime = bash + node/JS（ADR-006）。详见 §5/§6。

### 3.3 skills —— 程序逻辑/方法论（结构不变）
**curating 判定：不拆。** 6 愿景留在 `orchestrating-to-completion` 当镜头；`authoring-workflows` 正交（一种机制的脚本写法）、按约束不动。再设计只做**定点镜头加固** + **让方法论显式引用新 hook 通知**（如「运行时会在 `PostToolBatch` 提醒你过调度——那时收一收并行」），让 skill 与 hook 协同而非各说各话。（原拟用 `SubagentStop` 做「sub-agent 完成 → integrate+端点验收」的通知，已评估并移除——`additionalContext` 不达父线、与内建通知冗余，见 §5.1。）

### 3.4 scripts —— 带外 syscall
`cc-usage.sh`（python）/ `codex-review.sh` / `eval-*.sh`：需 runtime（python/网络/多分钟）、或主线手动/编排调用的带外工具。再设计：**ADR-006 后 C2 的 in-loop usage 感知改由 node hook 承担**（H8，§5.1），`cc-usage.sh` 退为「主线手动查 usage」的带外便利、不再是唯一途径；codex-review / eval 仍带外（它们要联网/多分钟，不该进 hook）。可选新增 read-only `scripts/` 算真 float / 查 deps 图（把 C4「critical path 心算」从 🟡 提到带机器校验；这类纯算也可放 node hook，按频率/复杂度选）。

### 3.5 board —— 持久堆 / LLM↔hook 的 ABI
narrow waist 是 LLM（写富状态）与 hook（读 pinned 字段）之间的接口契约。再设计：**绝大多数新能力靠「读现有字段做通知」实现、不碰 waist**；只有两处「确定性保证」需要加 pinned 字段（H1 的 `verified/artifact`、H2 的 `wip_limit` 升格）——它们是**唯一触红线2 的改动**，gated（须 ADR-003 + 全 hook + 测试同步）。

---

## 4. 六愿景 × 四层落点（grounded in 审计）

| 愿景 | mechanism 层（🟢真落地） | methodology 层（🟡 by-design） | 真 gap → 该补在哪层 |
|---|---|---|---|
| **C1** 并行+完整落地 | 三机制(harness原生) · `Stop:verify-board` 退出闸 | dispatch 选机制 / 就绪即发 | board 完整性零保障 → **hook（H1，动 waist）** + **通知（H6 integrate）** |
| **C2** token 速控 | `scripts/cc-usage.sh` 感知 | pacing 决策 / model 杠杆 | 传感器不被 loop 调 → **node hook 确定性感知+注入（H8，ADR-006 解锁）**；pacing 决策仍 skill |
| **C3** HITL 边界 | （行为红线，端点守） | lens 7 / async-hitl | 未答终审静默退出 → **hook 通知（H3，Stop 文案）** |
| **C4** 分解/管理/更新 | board(真文件) · narrow-waist 契约 | CPM/float 心算 | supersession 无事务性 → **hook 通知（H4，reinject）** + 可选 script 校验 |
| **C5** 高效调度 | （决策程序手跑） | WIP / admission / ~75% | 过调度单侧零兜底 → **hook（H5 通知 / H2 保证）** + Track B eval |
| **C6** 按难度选模型 | `agent({model})` lever | 选档方法论 | duration 维蒸发+overclaim → **skill 接维 + 措辞校准**（非 hook）|

**读法**：mechanism 列已 🟢 的是地基（保留）；methodology 列的 🟡 **大多是红线背书的设计意图、非 gap**（审计已证）；最后一列才是要动的——**而它们压倒性地落在 hooks**（C1/C3/C4/C5 的通知版 + C2 的 node 感知 hook H8），仅 C6 落 skill（接 duration 维），仅 C1/C5 的「硬保证版」需动 waist。ADR-006 后**唯一'非 hook 不可'的只剩 C6 的选档判断**（那是认知，本就该 skill）。

---

## 5. gap 闭合设计（每个真 gap → 层 + 核实过的 hook 能力）

按「确定性保证 / 自动通知 / 方法论-script」三类组织。**hook 能力均引自核实过的 [`research/claude-code-hooks-reference.md`](research/claude-code-hooks-reference.md)。**

### 5.1 自动通知 / 感知（bash 或 node、不动 waist —— 最廉价高杠杆，先做）

- **H6 · `SubagentStop` → 后台完成自动通知主线 integrate+端点验收**〔闭 C1/C5 阶段5〕——**已评估并移除（本提案此项作废）**
  *核实（修正）*：曾以为 SubagentStop 的 `additionalContext` 能通知父 orchestrator，但官方文档 + codex 第二端点验收双重确认：`hookSpecificOutput.additionalContext` 注入的是**刚结束的 sub-agent 自己的 context、不穿过父 orchestrator 边界**——递错对象，原设想根本做不到；且与 Claude Code 内建的「sub-agent 结果摘要自动回父线」**冗余**。
  *处置*：H6（`subagent-stop.sh`）已建后又移除。「完成即整合」的纪律改由 SKILL A 决策程序的 recon 步（integrate done background）+ 内建通知承担，不靠此 hook（子 → 父通知属 background agents / agent teams，红线 5 有意排除）。阶段5「Interrupt/notify」这一笔由 H5（`PostToolBatch`）承担过调度侧。
- **H5 · `PostToolBatch` → 过调度软警告**〔闭 C5 单侧兜底〕
  *核实*：PostToolBatch 在一批并行工具调用全解析后触发，**能注入 + 能 block**。
  *做法*：批量 fan-out 解析后，hook 数 board `in_flight`，若超 `wip_limit`（存在则比、不存在优雅降级）→ 注入「WIP 顶满（N/M），下一轮别再加派、考虑 defer high-float」。补上「镜头4 有 Stop 兜 idle、镜头5 零牙齿」的对称缺口，**不阻断**（保留并行自由），仅提醒。
- **H3 · 扩 `Stop:verify-board` 文案 → 列未答 `blocked_on:"user"` 决策**〔闭 C3 静默退出〕
  *核实*：Stop 既能 block+reason，也能注入非阻断 additionalContext。
  *做法*：完成态握手文案在 board 存在 `blocked_on:"user"` 时**显式列出该悬决策 title**，把「你正挂着未答用户终审」摆到 agent 脸上。纯 bash 只读 `blocked_on`（不路由、不 pin）。
- **H4 · 扩 `SessionStart:reinject` → resume 后报悬挂状态**〔闭 C4 事务性（resume 侧）〕
  *核实*：SessionStart 注入 additionalContext（reinject 已用）。
  *做法*：resume/compact 后，hook 检 board，注入「上次有未消化的 stale/escalated 节点」+「deps 图悬挂/环」提示。让计划更新的事务断点在续跑时被点名。（deps 图完整性检查用 node 写更稳；reinject 现役 bash，可保留或局部 node。）
- **H8 ⭐ · node hook 算 usage + 注入 pacing 警告**〔闭 C2 传感器不被 loop 调，ADR-006 解锁〕
  *核实*：`Stop`/`PostToolBatch` 能注入 additionalContext；node 在任何 Claude Code host 可用（ADR-006）。
  *做法*：node `JSON.parse` 读 usage JSONL（同 `cc-usage.sh` 逻辑）算 5h/7d burn-rate，临 burn-rate 墙时注入「已用 X%、约 Y 分钟撞墙 → 现在 pace（降模型/降 WIP/defer float）」。把「传感器真实但 loop 从不调它」从脆弱 prose 升级为**运行时确定性感知+通知**——审计里「唯一被红线1 否决」的 gap 翻盘。pacing 的**决策**仍是 skill（node 只感知+提示，怎么 pace 是认知）。不动 waist。

### 5.2 确定性保证（动 narrow waist = 红线2，gated —— 仅当通知不够时上）

- **H1 · 扩 `Stop:verify-board` → 拦「`done` 缺 `verified`+`artifact`」**〔C1 board 完整性硬保证〕
  *需*：board 加 pinned 字段 `verified`/`artifact` → 闸能确定性拦「裸 done」。**代价**：动 waist（ADR-003 + 全 hook + 测试同步）。是给 C1「完整落地」唯一硬保证，但最贵。
- **H2 · `PreToolUse(matcher:Task)` → in_flight≥wip_limit 拒派**〔C5 过调度硬保证〕
  *需*：`wip_limit` 升 pinned + 耦合 Task 语义。**比 H5 强（真拦）但贵**；审计原推荐先用 Track B eval 守。

### 5.3 方法论 / script（非 hook）

- **C2 pacing 决策 · skill**：usage 的**感知**已上 node hook（H8）；**怎么 pace**（降模型/降 WIP/defer）仍是 skill 的认知判断（cost-and-pacing.md），by-design 留 prose。（ADR-006 前这条曾是「唯一被红线1 否决」，现已被 H8 翻盘——只剩决策层留 skill。）
- **C6 · skill 接 duration 维 + 措辞校准**：把 duration 显式接进 `cost-and-pacing.md` 选档规则，或修 README/spec 的「expected duration」措辞消除 overclaim（二选一）。
- **C4 · 可选 read-only `scripts/` float/deps 校验**：把「critical path 心算」从 🟡 提到带机器校验（ship-anywhere、不进 hook）。

---

## 6. 具体 deltas（要建/改什么）

| 层 | delta | 类型 | 红线 | 优先 |
|---|---|---|---|---|
| **hooks** | ~~新增 `SubagentStop` hook（H6 integrate 通知）~~ **已评估并移除**——`additionalContext` 不达父线、与内建通知冗余（见 §5.1） | ⛔ 作废 | — |
| **hooks** | 新增 `PostToolBatch` hook（H5 过调度软警告） | 新增·纯 bash | ✅ 合规 | **P0** |
| **hooks** | 扩 `verify-board.sh`（H3：列未答 user 决策） | 改·纯 bash | ✅ 合规 | **P0** |
| **hooks** | 扩 `reinject.sh`（H4：悬挂 stale + deps 提示） | 改·bash/node | ✅ 合规 | P1 |
| **hooks** ⭐ | 新增 **node** hook（H8：算 usage burn-rate + 注入 pacing 警告） | 新增·**node/JS** | ✅ 合规（ADR-006）| **P0/P1** |
| **skills** | `orchestrating-to-completion` 定点加固：镜头5 引用 H5/H8 通知、镜头7 引用 H3、C6 接 duration 维 | 改·prose | ⚠️ 纪律段改前跑 pressure baseline | P1 |
| **scripts** | （可选）read-only float/deps 校验器 | 新增·带外 | ✅ 合规 | P2 |
| **commands** | `status.md` surface 新健康检查（deps/过调度/未答决策/budget） | 改 | ✅ 合规 | P1 |
| **board waist** | （gated）H1 加 `verified`/`artifact`；H2 `wip_limit` 升 pinned | 改·**动 waist** | 🔴 红线2：须 ADR-003 + 全 hook + 测试同步 | P2（先 eval 验证必要性）|
| **docs** | README/spec 校准 C6 「expected duration」overclaim | 改·docs | ✅ 合规 | P1 |

> **每个 hook delta 落地前**：按本仓 hook 纪律——bash 或 node/JS（JS only，红线1/ADR-006）、自门控于激活条件、sidecar 原子写、board 解析（bash 格式无关 / node `JSON.parse`）、配 `tests/hooks/` 测试；node hook 注意启动开销（高频事件留 bash）+ 残留 `node`-on-PATH 边界（ADR-006 §3.2）。skill 纪律段改前跑 TDD-for-skills pressure baseline。

---

## 7. 设计原则（沉淀，可复用判据）

1. **hook = 确定性运行时**：可用 **bash + node/JS**（ADR-006；JS only，排除 jq/python/TS-直跑）。只装「必须保证 + bash/node 可算」（exit guard / 特权不静默 / 调度强制 / **usage 感知**）与「自动通知易忘之事」（异步完成 / 过调度 / resume 悬挂）。简单/高频用 bash，结构化 JSON 解析+计算用 node。**hook 仍不碰：读对话语义（只有 transcript_path 指针）、改权威源 board（只读+sidecar）、jq/python/TS。**
2. **skill = 方法论**：判断/推理/立场（分解、调度决策、pacing **决策**、HITL 判断）。**6 愿景大多 by-design 在此**——审计证明它们是红线背书的设计意图，不是「该机制化却没机制化」。
3. **script = 带外 syscall**：需**联网 / 多分钟 / 主线手动调用**的工具（codex-review / eval）。ADR-006 后「纯算（如 usage）」可进 node hook，不必非走 script；script 留给真带外的活。
4. **board waist = ABI**：能「读现有字段做通知」就别 pin 新字段；只有「确定性 block 保证」才值得动 waist（红线2 成本）。
5. **通知通道是当前最大未开发面**：把 loop 的异步事件接到 hook 注入，是把脆弱 prose（compaction 易丢）升级成确定性运行时行为的最廉路径。**先穷尽通知，再考虑动 waist 的硬保证。**

---

## 8. 排序（cheap wins first，waist 改动 gated）

- **第一波（P0，全不动 waist · bash 为主）**：H5（PostToolBatch 过调度警告）+ H3（Stop 列未答 user 决策）。这两笔补上 C5/C3 的对称缺口，**杠杆最高、成本最低、零红线风险**。（原列 H6（SubagentStop integrate 通知）已评估并移除——`additionalContext` 不达父线、与内建通知冗余，见 §5.1。）
- **第二波（P1）**：H8（node usage 感知 hook，闭 C2——ADR-006 解锁的大赢，因是 node 单列）+ H4（reinject 悬挂提示）+ skill 定点加固（引用新通知 + C6 duration）+ status 变富 + C6 措辞校准。
- **第三波（P2，gated）**：H1/H2 的硬保证——**先用 Track B eval 验证「通知不够、确实需要硬拦」**，证实必要再付动 waist + ADR 的代价；可选 script 校验器。

---

## 9. 红线合规自检

| 红线 | 本设计如何合规 |
|---|---|
| 1 hooks 只用 bash+node/JS（ADR-006）| 新/改 hook 全用 bash 或 node/JS（JS only）读 board+注入；**usage 计算用 node hook（H8）**；不用 jq/python/TS-直跑 |
| 2 board narrow waist 稳定 | P0/P1 全「读现有字段」不动 waist；唯 H1/H2 动 waist，**显式 gated 进 P2 + 须 ADR-003 + 全 hook + 测试** |
| 3 两 skill 不重叠 | skill 结构不变（不拆）；`authoring-workflows` 按约束不动；orchestrating 只定点加固，不跨界 |
| 4 指挥不演奏 | hook 只做「保证 + 通知」，调度/分解/pacing 判断仍是主线（skill）的活；不把认知外包给引擎 |
| 5 ship-anywhere | 新机制只用 hook（bash/node·JS——node 随 Claude Code 保证存在）/ script（带外）；不引入 agent-teams / scheduled routines / jq / python / Bedrock 上会断的依赖 |

---

## 10. 与现有文档的关系

- **charter**（[`spec.md §1.0`](spec.md)）说目标；**审计**（[`vision-landing-tracker.md`](vision-landing-tracker.md)）量差距；**本文**给「怎么补差距」的架构设计；**hooks 参考**（[`research/claude-code-hooks-reference.md`](research/claude-code-hooks-reference.md)）是本文 hook 能力的权威依据。
- ratify 后：P0/P1 的 hook deltas 各走「设计→实现→测试」；动 waist 的 P2 须新写 ADR（扩 ADR-003 或新 ADR）；spec.md 可吸收本文的层职责定位。
