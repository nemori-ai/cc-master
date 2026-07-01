# ADR-023 — deps 驱动的 `ready↔blocked` 自动门控 + `blocked_on` 作语义阻塞判别器

> Status: **Accepted**（方向经用户拍板·2026-07-01）
> Date: 2026-07-01
> Scope: 把「一个 task 是 `ready` 还是 `blocked`」从「agent/hand 手动赋值 + 状态机自由转移」收敛为「引擎按 deps 完成度**自动归一**（Model 1）」——`@ccm/engine` 新增纯函数 `reconcileGating(board)`（写入关卡 `runWrite` 在 `mutate` 后、`lintBoard` 前跑一趟），`blocked_on` 升为「语义阻塞判别器」（有它则整体豁免自动门控）；`ccm` 新增 `task unblock <id>` verb（清 `blocked_on`·交回门控）；新增 `BIZ-STATUS-DEPS` warn（规则全集 48→49）兜手改 board 造出的不一致态；`using-ccm` 两份 reference + SKILL.md 心智锚 2 锁步。**narrow waist（红线2）一字不动**（`status`/`deps`/`blocked_on` 仍是既有窄腰字段·只是「谁来定 ready/blocked」的规则变了）。
> Source: `design_docs/plans/`（Model 1 设计·用户拍板照实现）。
> Co-signed: user (owner)

---

## 1. Context

board 的 `status` 是一台状态机（`STATUS_MACHINE`·ADR-013），`ready` / `blocked` 是其中两态。`ready` 的语义定义（`readySet`·`board-graph-core.ts`）一直是「`status==='ready'` **且** deps 全 done」——即「就绪」是「拓扑就绪」与「被标为 ready」的**合取**。这留下一条裂缝：**两者可以不一致**。

- `task add T --deps <未完成>` 默认 `status='ready'`（`addTask` 缺省），但它的 deps 没全 done——于是它标着 `ready` 却不在 `readySet` 里（拓扑没就绪）。看板/派发逻辑要处处再算一遍「deps 到底 done 没」，`status` 字段本身**不可信**。
- 上游 `task done` 后，那些「deps 现已全 done」的下游节点仍标着旧的 `blocked`（没人去改），要靠 orchestrator 记得手动 `set-status <id> ready` 一个个搬——**手动、易漏、跨 compaction 更易忘**。
- `blocked` 一态承载了**两种语义**：① deps 没满足的「拓扑阻塞」② 在等 user / 等某 task 的「语义阻塞」（`blocked_on`）。两者解除方式截然不同（前者等 deps 完成、后者等外部事件），却挤在同一个 `blocked` 值里，靠 agent 心算区分。

根因：**`ready`/`blocked` 是 deps 完成度的纯函数，却被建模成一个需要手动维护的可赋值字段。** 手动维护一个「本该派生」的量，必然漂移。

## 2. Decision

把 `ready↔blocked` 从「手动赋值」收敛为「引擎按 deps 完成度**自动归一**」，`blocked_on` 升为「是否豁免自动门控」的**判别器**。这是评审中的 **Model 1**（照实现）。

### 2.1 `reconcileGating(board)` 纯函数（落 `@ccm/engine`）

新增 `packages/engine/src/board-reconcile.ts`，导出 `reconcileGating`。对每个 task：

- **仅当** `status ∈ {ready, blocked}` **且无 `blocked_on`**（`blocked_on` 空/缺）时归一：deps 全 done → `ready`，否则 → `blocked`。
- 其余状态（`in_flight`/`done`/`failed`/`escalated`/`stale`/`uncertain`）与**有 `blocked_on`** 的节点（语义阻塞）**整体豁免**——deps 满足也不翻。
- **一趟全板 O(V+E)、幂等、不产生新 `done`（无级联）**：deps 完成度按「入参板的 done 快照」评估（reconcile 绝不写 `done` → 快照稳定 → 遍历顺序无关、单趟即幂等）。
- 复用 `analyzeGraph` 的 `predecessors`（= `readySet` 同一条 `upstream` 邻接·排除 dangling/self-loop）+ `isDoneStatus`——保证「reconcile 判就绪」与「`readySet` 判就绪」零漂移（同一条 `deps.every(isDone)` 判据）。
- 纯函数：`structuredClone` 后改、绝不 alias 入参（与 `mutations.ts` 同纪律）。

### 2.2 接入写入关卡 `runWrite`（所有写 verb 自动归一）

`apps/cli/src/handlers/_common.ts` 的 `runWrite`：`const next = reconcileGating(mutate(raw, ctx))`——在 `mutate` 之后、`lintBoard` 之前。**所有写 verb 自动获得门控归一**：`task done` 掉上游后下游自动 `ready`、`task add --deps <未完成>` 自动落 `blocked`。CLI 写路径**永不产生**不一致态。

### 2.3 `blocked_on` 作语义阻塞判别器 + `task unblock`

有 `blocked_on`（等 `user` / 等某 task）= 语义阻塞，与拓扑就绪正交，**豁免**自动门控（即便 deps 全 done 也不自动翻 ready）。解除语义阻塞新增 `ccm task unblock <id>`：清 `blocked_on`（+ 附属 `decision_package`），**不直接定 status**——交回 `reconcileGating` 按 deps 归一。这是 `task block` 的解除侧，也是「新需求：禁止直接编辑 board / 别手 `set-status` 解 deps 阻塞」的必需前置。

### 2.4 `BIZ-STATUS-DEPS`（warn·规则全集 48→49）

新增 lint warn：`status==='ready'` 但 deps 未全 done，**或** `status==='blocked'` ∧ 无 `blocked_on` ∧ deps 全 done。它精确等于「`reconcileGating` 本应改动此 task」的补集——CLI 写路径经归一化永不产生，故命中 = 手改 board 的信号。warn 非 hard（graceful·可跑任意写命令自愈）。

### 2.5 与既有不变式的关系

- **narrow waist（红线2）不破**：`status`/`deps`/`blocked_on` 仍是既有窄腰字段，字段集与 tier 一字不动——变的只是「`ready`/`blocked` 由谁定」的规则（从手动改为引擎派生）。
- **`STATUS_MACHINE` 转移合法性不变**：`blocked→ready`/`ready→blocked` 仍是合法转移（`set-status` 仍能手发），只是下一趟 `reconcileGating` 会按 deps 否决不一致的手动结果。lint 仍不强制转移合法性（ADR-013）。
- **`isAwaitingUser` 不破**：它查 `blocked_on==='user'` + status∈{blocked,in_flight}——Model 1 对有 `blocked_on` 的节点整体豁免，天然不动它。
- **`done` 真语义不变**：reconcile 不产生新 `done`，`taskTrulyDone`（verified+artifact）与 rollup gate 不受影响。

## 3. Consequences

**正面**：`status` 的 `ready`/`blocked` 变成 deps 的可信派生量（不再手动维护、不再漂移）；orchestrator 不用手搬 ready/blocked，省一整类跨 compaction 易忘的簿记；`blocked` 的两种语义被 `blocked_on` 干净拆开；`readySet` 与落盘 `status` 从此一致。

**代价 / 边界**：
- 想让一个 deps 未满足的节点强行「可派发」的旧习惯失效（`set-status ready` 会被下一趟归一打回 blocked）——但那本是设计味道问题（该先切依赖），不是状态问题。
- 一个既存 fixture（`baseline-example.board.json` 的 T5：`ready` 但 dep `in_flight`）本就是不一致态，随本 ADR 修正为 `blocked`（体现「一致板」应有的样子）。
- `reconcileGating` 每次写多跑一趟 O(V+E) + 一次 `structuredClone`——对 board 规模（几十~几百节点）可忽略。

## 4. Alternatives（评审中被否的 Model 2 / 3）

- **Model 2 —— 级联自动完成 / 传播**：reconcile 时若某节点 deps 全 done 就顺带做更多传播（甚至连锁推进）。**否**：会产生「引擎替 agent 决定推进」的越界，且级联使「一趟归一」不再幂等、顺序敏感、难推理。Model 1 刻意「不产生新 done、无级联、单趟幂等」。
- **Model 3 —— 把 `ready`/`blocked` 彻底从 `status` 枚举里删掉，纯派生**（status 只留 in_flight/done/… + 一个独立的 `gate` 派生视图）。**否**：动窄腰枚举 + 全 hook/viewer/lint 的大改，破坏面过大；且 `blocked` 承载的语义阻塞（`blocked_on:user` 决策门）需要一个落地的 status 值供 `isAwaitingUser`/webview 用。Model 1 用「`blocked_on` 判别器 + 自动门控」在**不动枚举**的前提下拿到同样的「status 可信」收益，改动面最小。

## 5. Related

- ADR-013（board v2 数据模型 + `STATUS_MACHINE` + 三档 tier）——本 ADR 修订「`ready`/`blocked` 由谁定」，不动其字段集/tier/转移表。
- ADR-003（narrow waist）——本 ADR 不动窄腰字段集，只改门控规则，红线2 不破。
- `board-graph-core.readySet`——reconcile 复用其 `predecessors` 邻接 + `isDoneStatus`，两者零漂移。
- §6「`ccm` ⟷ `using-ccm` 锁步」——本 ADR 同步 `using-ccm` 的 `board-model-guide.md`（status 表 blocked 行 + G 节 + BIZ-STATUS-DEPS）+ `command-catalog.md`（`task unblock`）+ SKILL.md 心智锚 2。
