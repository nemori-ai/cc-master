---
point: ccm.board.status-semantics
---

## 权威陈述

<!-- ccm:k:start point:ccm.board.status-semantics -->
## B. status 八态语义 + 生命周期

### 各态语义速查

| status | 含义 | 对 readySet 的影响 | 典型下一步 |
|---|---|---|---|
| `ready` | deps 全满足，可以派发 | **在 readySet 里** | `task start` → in_flight |
| `in_flight` | 已派发、正在跑 | 不在 readySet | 等完成 → `task done` / 失败处置 |
| `blocked` | **两种来源**（见下）：① deps 门控（deps 未全满足·**系统自动**·无 `blocked_on`）② 语义阻塞（在等 user 或另一 task·**手动**·有 `blocked_on`） | 不在 readySet | ① deps 门控：**别手动改**——deps 全满足时任意 ccm 写命令自动归回 ready；② 语义阻塞：`task unblock <id>`（清 `blocked_on`·交回 deps 门控） |
| `done` | 执行完成 | 普通/旧 task 满足 deps；显式 review gate 还须 `review_verdict=APPROVE` | 无须再动，除非上游产物变 → `stale` |
| `escalated` | sub-agent 返回 escalation（超出能力范围） | 不在 readySet | 仍沿用本节点时 `task retry`，或 supersede 后建新 task |
| `failed` | 节点失败 | 不在 readySet | `task retry` 开新 attempt，或升级处置 → `escalated` |
| `stale` | 上游产物变了、需重跑 | 不在 readySet | 重确认输入后 `task retry`（先归档旧 evidence，再开干净新 attempt；旧 review verdict 不参与当前 gate） |
| `uncertain` | 做了但未验（验证节点尚未派出） | 不在 readySet | 验收通过 → `done`，失败 → `failed`，重做 → `in_flight` |

### native-attempt 专属 projection

板通过 `meta.contracts.native_attempt: "ccm/native-attempt/v1"` 显式 opt in 后，latest native attempt 的 append-only 状态与 task 的 status/handle 是一个由 ccm dedicated writer 独占的 projection；它不是 generic status/handle 字段的另一种写法。

| Attempt state / observation | Task projection | 唯一入口 |
|---|---|---|
| `starting` | `ready`，无 `handle` | `native-attempt-create` |
| `running`（认证 spawn + 同 handle live roster 证据） | `in_flight`，投影该真实 opaque handle | `native-attempt-bind` 或同一 handle 的 `native-attempt-reconcile` |
| `uncertain` | `uncertain`，清 active `handle`；阻止新 launch | `native-attempt-reconcile` |
| `terminal`（认证 terminal evidence） | `uncertain`，无 `handle`，绝不直接 `done`/`verified` | `native-attempt-terminal` 或 `native-attempt-reconcile` |
| `orphaned`（完成 fenced orphan audit） | 清 `handle` 后由普通 deps gating 归一为 `ready` 或 `blocked`；只允许后来显式 create | `native-attempt-reconcile` |

latest attempt 为 `starting|running|uncertain` 时，mutation boundary 统一拒绝 generic `task start/done/block/unblock/set-status`、`task update --handle` / 通用 setter、legacy `route-bind` 及其 `--force` 绕路；`BIZ-NATIVE-ATTEMPT-PROJECTION` hard lint 同时捕获 board 上被手改出的 projection mismatch。terminal 只是 worker 事实，不是父 task 验收：父层验证 result/artifact 后，仍从 `uncertain` 走普通 `task done --verified --artifact` true-done 不变式。

attempt 内的 lifecycle record 也受同一 hard projection 约束：`starting` 只能保留 create 初态，不能预载 `handle_binding`、cancel、terminal、时间戳、orphan audit 或 reconciliation；cancel 必须建立在已认证 binding 之后，terminal/orphan record 只能出现在对应可达状态。reconciliation 必须是按 observation time 严格递增的完整可信链：每条都保留私有 evidence ref/hash、source、descriptor、target 与 current lineage，running/terminal/orphaned 的专属 payload 还须分别与原 binding、顶层 terminal、顶层 fenced orphan audit 值相等；classification-only、缺字段、重排或只补一个看似合理顶层 audit 的历史一律 hard-fail。即使加 `--force`，不可能由 dedicated writer 产生的 state×record 组合也会被拒；不要靠手改 board 预填“未来证据”。

**runtime 边界：**当前四 host 的 native-attempt strategy 都是 `unsupported`，Codex 不投影 invoke artifact，也不会默认 spawn。production composition 已能从 owner home 认证 committed reservation/ticket + canonical launch identity、唯一 claim 和 Ed25519 evidence，并在 board durable commit 两侧做可恢复 transaction；这只证明 launch/evidence authority 与 ledger 原子性，不等于 host invocation 已接通。五个 `native-attempt-*` 命令不是 host tool wrapper。`expected_child_target` 是 create 时冻结的期望，不是 spawn/roster 观察，更不能单独证明 handle。

### status 何时转向哪态

**完整合法转移表（ccm 强制）：**

```
ready      → in_flight, blocked
in_flight  → done, uncertain, escalated, failed, blocked
blocked    → ready, in_flight
done       → stale
uncertain  → done, failed, in_flight
escalated  → ready
failed     → ready, escalated
stale      → ready
```

**操作决策——遇到以下情况选哪个状态：**

| 情况 | 选哪个 status | 命令 |
|---|---|---|
| 正常派发后台任务 | `in_flight` | `task start` |
| 后台任务完成、端点验收通过 | `done` | `task done --artifact ... --verified` |
| 后台任务完成、但验证任务还没派 | `uncertain` 或 `blocked_on:<verify-task>` | 见下方辨析 |
| 等用户决策 | `blocked`（`blocked_on:user`） | `task block --on user --decision @file` |
| 等另一 task 完成（非 deps 关系） | `blocked`（`blocked_on:<taskid>`） | `task block --on <taskid>` |
| sub-agent 返回说超出能力 | `escalated` | `task set-status <id> escalated` |
| 任务失败 | `failed` | `task set-status <id> failed` |
| 上游 artifact 变了 | `stale` | `task set-status <id> stale` |
| stale / failed / escalated 节点确认重跑 | 请求 `ready`（新 attempt）；只有 deps 全满足时才保持 `ready`，否则最终归一为 `blocked` | `task retry <id>` |

**retry 是 attempt 边界，不是 status setter：** `task retry` 先把来源 status 与旧 `started_at` / `finished_at` / `artifact` / `verified` / `review_verdict` / `delivery` 归档为 `ccm/task-retry/v1` log detail，再清空当前 attempt 的 `started_at` / `finished_at` / `artifact` / `review_verdict` / `delivery`、把 `verified` 设为布尔 `false`，并请求落 `ready`。这些步骤在同一持锁写入里原子发生；随后 deps 门控用同一个 dependency qualification evaluator 归一最终态（只有 deps 全满足，即 declared edge `qualified` / legacy edge satisfied，才→`ready`；否则→`blocked`），human/JSON 输出逐 task 报这个最终态。旧 verdict / candidate / observation 即使已归档也绝不参与新 attempt 门控。批量任一 id 不可 retry 时整批不落盘。合法的通用 `set-status <id> ready` 也走同一 reset，避免旧入口泄漏旧证据。

**`--force` 越闸是逃生口，不是捷径：** 正常流程用 verb；重跑 stale/failed/escalated 用 `task retry`。用 `--force` 跳 `in_flight` 直接 `done` 会造成无 `started_at` 的 done 节点——伪造审计轨迹，影响 timeline 与 p95 估算。

### ready ↔ blocked 由系统按 deps 自动门控

**每次 ccm 写命令落盘前，引擎自动跑一趟 `reconcileGating` 归一化**——把每个「**无 `blocked_on`**（非语义阻塞）且 status ∈ {ready, blocked}」的 task 按 deps 资格重定：**deps 全满足（declared edge `qualified` / legacy edge satisfied）→ `ready`，否则 → `blocked`**。缺 `delivery_contract` 的历史板、以及 declared 板中未声明 requirement 的边，逐字保持 legacy `dependencySatisfied` 行为。显式 requirement 的 edge 先要求 `taskTrulyDone`；review gate 的 `REQUEST-CHANGES` / 缺 APPROVE 优先 fail closed；再按 candidate 或指定 target delivered 求值。这意味着：

- **你几乎不用手动在 ready/blocked 之间搬**——普通上游 done，或 review 上游 APPROVE 后，下游会自动翻成 `ready`；反之未满足的依赖会让新节点自动落成 `blocked`。
- **手动 `task set-status <id> ready` 会被 deps 否决**——若该 task deps 未全满足且无 `blocked_on`，下一趟归一化会把它打回 `blocked`。想让一个 deps 未满足的节点强行可派发，是设计味道问题（该先切依赖），不是状态问题。
- **`blocked_on` 是「语义阻塞」判别器**：有 `blocked_on`（等 `user` / 等某 task）的节点**整体豁免**自动门控——即便 deps 全满足也不会被翻成 ready（它在等的是人 / 另一件事，不是拓扑就绪）。解除语义阻塞用 **`task unblock <id>`**（清 `blocked_on`，交回 deps 门控按满足度定 ready/blocked），不要用 `set-status`。
- **手改 board 造出的不一致态**（ready 但 deps 未全满足 / blocked 无 blocked_on 但 deps 全满足）由 `BIZ-STATUS-DEPS` warn 兜（见 [N 节](#n-校验规则全集速查fmt--graph--biz)）——CLI 写路径经归一化**永不产生**这类态，看到它多半是手编辑的板。

### uncertain vs blocked_on 辨析

这是最常混淆的两个态：

| | `uncertain` | `blocked_on:<verify-task>` |
|---|---|---|
| **语义** | 做了但不确定是否通过，验证节点尚未派出 | 产物已在，正等一个**具名**的下游 verify 裁决 |
| **hook 提醒行为** | 每拍主动提醒「resolve uncertain」 | 不提醒（已有明确等待目标） |
| **什么时候用** | verify 任务还没建/派 | verify 任务已经在 in_flight（有具名 id） |
| **噪声级别** | 高（重复提醒） | 低（只等具名依赖） |

**操作建议：** 一旦你派出了 verify 任务（它有 id 了），就把「做了未验」的节点从 `uncertain` 改成 `blocked_on:<verify-task-id>`，消掉每拍噪声、语义也更准确。

---

<!-- ccm:k:end point:ccm.board.status-semantics -->
