# Board —— 编排存档文件

> **服务愿景：C1**（异步并行 + 完整落地）**· C4**（拆解 / 管理 / 更新 / 规划）。**何时读：** 触碰 board 契约时——narrow-waist schema、status enum 路由、柔性边、快照、可配置 home + 每编排一份 board 文件、flush 纪律、单一真相源、supersession、`log` 段。

**本质**：编排者跑长任务时的"存档文件"——一张带状态的**任务依赖图（task dependency graph）**。它身兼两职：① 跨 compaction 存活的记忆，② hook 唯一能读到的那扇编排状态窗口（hook 是个 shell——它读不到 agent 的 context，也读不到内建的 `Task` 工具）。

## 目录

- [关键决策](#关键决策)
- [narrow-waist 原则](#narrow-waist-原则)
- [单一真相源](#单一真相源)
- [读 / 写 / flush 纪律](#读--写--flush-纪律)
- [Supersession —— 显式状态](#supersession--显式状态非隐式-gc)
- [`log` 段 —— 轻量审计](#log-段--轻量审计)
- [示例](#示例与-boardexamplejson-一致)

---

## 关键决策

- **名字**：`board`。**单一真相源。** **可配置的 home + 每编排一份唯一命名的 board 文件。** home 取 `$CC_MASTER_HOME`（若设了），否则 `${CLAUDE_PROJECT_DIR:-$(pwd)}/.claude/cc-master/`——这是一个用户存储偏好，不再是硬编码路径。每场编排拿到自己那份可按时间排序的文件 `<UTC-timestamp>-<pid>.board.json`（如 `20260605T101821Z-54324.board.json`），这样多场并发编排永不相撞。bootstrap（UserPromptSubmit）hook 负责创建该文件、并注入它的精确路径；**哪个 board 是你的，由你自己认领**——compaction 之后，靠列出 home 并匹配 `goal` 把它重新找出来。Gitignored。
- **存储 = 可变快照（每编排一份命名 board 文件）**：每一回合，把整个文件 `Write` 出去（narrow waist 很小，一次 edit 不会把它写坏）；markdown 视图按需生成。

---

## narrow-waist 原则

别把整张表都钉死——只钉死 hook 所依赖的那份最小契约。这既给了 agent 自由，又让手工维护保持安全。

### 被钉死的 waist

```
top-level: schema, goal, owner { active, session_id, heartbeat }, git { worktree, branch }
tasks[ { id, status, deps } ]
```

（这些字段与 `board.template.json` / `board.example.json` 一一对应：`schema`、`goal`、`owner.active`、`owner.session_id`、`owner.heartbeat`、`git.worktree`、`git.branch`，以及 `tasks[]` 数组。）

### Status enum（各自在 DAG 里路由不同）

`ready / in_flight / blocked(blocked_on:"user"|"<taskid>") / done / escalated / failed / stale
/ uncertain`

| status | 路由 |
|---|---|
| `ready` | 依赖已满足——在 WIP cap 内派发。 |
| `in_flight` | 已派发、正在后台跑——把 `dispatched_at` 对照任务类的 p95 追踪（见 `async-hitl.md`）。 |
| `blocked` | 在等 `blocked_on`——要么 `"user"`（一条异步的用户依赖），要么 `"<taskid>"`（一个上游任务）。 |
| `done` | 完成并已验——content-hash 可记账，可跳过 / 可续。 |
| `escalated` | 一个 sub-agent 返回了 escalation 结果——supersede 该节点、再 seed 一个 workflow。 |
| `failed` | 该节点失败了——按它的 escalation 条件路由。 |
| `stale` | 一个上游产物变了——重跑（见 `resume-verify.md` 的依赖 pinning）。 |
| `uncertain` | 做了但未验——路由到一个验证节点 / 在端点验。 |

### 柔性边（agent 可自由塑形、hook 忽略）

`title / artifact / dispatched_at / mechanism / handle / kind / justification / output_schema /
dep_pins / notes / log` —— 外加示例字段 `verified`、`blocked_on`，以及 top-level 的 `wip_limit`。

钉死的 waist 之外，hook 一概忽略，所以 agent 尽可按任务需要随意塑造这些柔性边。

---

## 单一真相源

内建的 `Task*` 工具至多是一面 in-session 的草稿镜像——**不权威**。唯有 home 里你那份 board 文件，才是一次断电、一次关机、一个 hook 都还认得的存档文件。两者打架时，board 文件赢。

---

## 读 / 写 / flush 纪律

- **每回合写整个文件** —— 快照很小。
- **在决策程序 step 7 flush**（每回合收尾），也可选在 PreCompact 时再 flush 一次。
- hook 只读 board（它改不了编排状态），所以写这件事由 agent 独占。

---

## Supersession —— 显式状态，非隐式 GC

一个节点被重新定位（re-altitude）、或被一个上游变更顶替时，体现为一个**显式 board 状态**（`escalated` / `stale`），而不是隐式的垃圾回收。被顶替的节点带着它被设的状态留在 board 上，好让历史可审计。

---

## `log` 段 —— 轻量审计

回溯与审计骑在柔性边那个轻量的 `log` 段上——它**不是**一套完整的 event-sourcing 存储（YAGNI）。有值得记的事发生时追加一条简短条目即可；保持便宜。

---

## 示例（与 `board.example.json` 一致）

```json
{
  "schema": "cc-master/v1",
  "goal": "Internationalize the app to 6 locales (i18n framework + per-locale translation + locale routing)",
  "owner": { "active": true, "session_id": "abc123", "heartbeat": "2026-06-05T12:30Z" },
  "git": { "worktree": "/repo/.worktrees/i18n", "branch": "feat/i18n-rollout" },
  "wip_limit": 4,
  "tasks": [
    { "id": "T0", "status": "done", "deps": [], "artifact": "commit a1b2c3", "verified": true },
    { "id": "T1", "status": "in_flight", "deps": ["T0"], "mechanism": "sub-agent", "handle": "bg-7a", "dispatched_at": "12:18Z" },
    { "id": "T3", "status": "ready", "deps": ["T0"] },
    { "id": "T9", "status": "blocked", "deps": ["T1"], "blocked_on": "T1" },
    { "id": "D1", "status": "blocked", "deps": [], "blocked_on": "user", "title": "Split the PR into two?" },
    { "id": "F1", "status": "ready", "deps": [], "kind": "fill-work", "justification": "produces-reusable-artifact", "title": "Pre-draft the PR description skeleton" }
  ],
  "log": []
}
```
