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

### 柔性边（agent 可自由塑形）

`title / artifact / dispatched_at / mechanism / handle / kind / justification / output_schema /
dep_pins / notes / log` —— 外加示例字段 `verified`、`blocked_on`，以及 top-level 的 `wip_limit`。

钉死的 waist 之外，agent 尽可按任务需要随意塑造这些柔性边。但柔性边里要再分两档（hook 对它们的态度不同）：

- **大多数柔性边 = hook 完全忽略**：上面绝大多数字段，hook 一概不读、不依赖，纯属 agent-shaped。
- **少数柔性边 = soft / optional 的「hook 可观察」字段**：hook **若有则用、缺失则静默关闭对应行为（graceful degrade，不报错）**——它们既不是硬 waist（hook **要求**存在的字段），也不是「hook 完全无视」。目前唯一一个是 top-level 的 **`wip_limit`**：`posttool-batch.sh` 会 best-effort 读它，当 `in_flight` 数超过 `wip_limit` 时注入一条 **C5 过调度软警告**（非阻塞）。**这是「读」不是「要求」**：board 没有 `wip_limit`、或它非数字时，该警告按设计**静默关闭**（不报错、不影响其它行为）——省掉 `wip_limit` 就等于关掉 C5 过调度警告，知情即可，不是错误。

> **硬 waist vs soft observed —— 别混淆**：hook **要求**的字段（`schema` / `goal` / `owner.session_id` / `git` / `tasks[{id,status,deps}]` + status enum）才是受红线 2 保护、动它必须同 PR 改全部 hook + 测试的**硬 narrow-waist**；`wip_limit` 这类**「hook 若有则用」的 soft observed 字段不在硬 waist 内**——把它提进硬 waist 是结构性改动、需人审，不要顺手做。未来改 board 者：增 / 删一个 soft observed 字段只影响它驱动的那条可观察行为（如删 `wip_limit` = 关 C5 警告），不动硬 waist 契约。

### `owner.heartbeat` —— 从「pinned 但无人读」到「resume 探测信号」

`owner.heartbeat` **一直是 pinned 的 waist 字段**（见上面的「被钉死的 waist」+ `board.template.json` / `board.example.json`），但在 ADR-009 之前它只是个被钉着、**没有读者也没有固定写者**的字段。ADR-009 给了它首个用途：

- **resume 探测读它**——`as-master-orchestrator --resume` 时 bootstrap 在重盖前读 TARGET 板的 `owner.heartbeat`（连同文件 mtime）判断「这板是否看起来仍有活 session」，新鲜则先警告、要 `--force-takeover` 二次确认（接管安全闸）。
- **活 session 每回合 flush 时写它**——本回合起，活的 orchestrator 在每次 flush board 时把 `owner.heartbeat` 更新为当前时间戳（命令体 resume 段的纪律），给下一次 resume 探测留下可读信号。

这**不新增 waist 字段、ADR-003 不动**——只是首次赋予一个既有 pinned 字段一个读者（resume 探测）和一个固定写者纪律（活 session flush）。

### `owner.session_id` 与武装 / 续跑（SSOT 在 ADR-007，此处只给落地心智）

`owner.session_id` 是 hook **武装闸**读的那个字段（见 §红线 6 / ADR-007）。续跑视角要点（细节别在此复述，去 ADR-007）：

- **平台 resume（`claude --resume` / `-c`）与 compaction 都保留原 `session_id`**——`SessionStart` 分别以 `source:"resume"` / `"compact"` 触发、`session_id` 不变。故武装与 reinject **跨平台 resume / compaction 照常工作**，无需特殊处理。
- **全新独立会话（无平台 `--resume`，必拿新 `session_id`）对别人的 active 板按设计休眠**——这是红线 6 防跨会话污染，**不是**续跑失效。
- **未盖 `session_id`（空串 `""`）的 active 板保持休眠**（红线 6：不武装不相关 session）——合法续跑因 resume / compaction 保留 `session_id`、板带原 `session_id` 故照常匹配武装；异常的 blank 板（bootstrap 在缺 sid 的 stdin 上建板）由**显式 re-arm**（重跑 `as-master-orchestrator` → bootstrap 重盖 `session_id`）认领。对称收养空 board sid 曾试过并回退（CODEX12 → CODEX14：会武装任意不相关 session，破红线 6），SSOT 见 ADR-007 §2.3 / §4.5。board sid **非空且 ≠ 本会话 sid** 同样休眠。
- **`as-master-orchestrator --resume` = 显式跨 session re-arm（ADR-009）**——和上面那条平台 `--resume`（保留 sid，是 Claude Code 的 resume）**不是一回事**：这是用本插件的命令、让一个**全新 session** 显式**接管**一块别的 session 的（或已归档的）board。bootstrap（唯一武装豁免 hook，ADR-007 §2.5）会把选定旧板的 `owner.session_id` **盖成新 sid**、`owner.active` 置 `true`（**可复活 `/stop` 归档的板**，`false → true`），并**保留 `tasks` / `log` / `goal` / `git`**。这是经 `as-master-orchestrator` + 用户显式 `--resume` 授权的合法武装形态（区别于 CODEX14 拒绝的「隐式自动收养空板」），落在红线 6 精神内——SSOT 在 ADR-009，对「显式 vs 隐式」与「复活归档板为何合规」的论证去那里读，此处不复述。

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
