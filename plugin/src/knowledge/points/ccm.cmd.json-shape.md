---
point: ccm.cmd.json-shape
---

## 权威陈述

<!-- ccm:k:start point:ccm.cmd.json-shape -->
## --json 输出形状

通用信封：成功 `{"ok": true, "data": <below>}`，失败 `{"ok": false, "exit": N, "error": "…", "violations": []}`。以下只列 `data` 形状。

### quota status / preflight / reserve / audit

- 普通 `quota status` 的 `data` 至少含 `{schema:"ccm/quota-status/v1",available:boolean}`。
- `quota status --machine-wide` 是通用信封的明确例外：JSON 根为
  `{schema:"ccm/machine-quota-status/v1",summary:{schema:"ccm/machine-quota-summary/v1",decisions:[...]},readings:[...],capacity_views:{schema,known_capacities,unresolved_scope_digests,unresolved_capacity_units}}`。
  `decisions[]` 至少含 `scope_digest`、`target.{harness_id,surface_id,provider_id,window}`、
  `quota_scope_digest`、`state`、`freshness`、`reason_codes[]`、`source`、`decision_revision`、
  `observation_revision`、`fanout_covered`；`readings[]` 至少含 target、`used_percentage`、`resets_at`、
  `observed_at`、`valid_until` 与 `source`，unavailable / expired 时另带可选 `refresh_hint`。unknown target 仍保留，通常表现为
  `state:"unknown"`、`freshness:"unknown"`、`reason_codes:["QUOTA_SIGNAL_UNKNOWN"]` 与空 reading，而非 ample。

  ```jsonc
  { "target": { "harness_id": "cursor", "surface_id": "cursor-agent-cli",
      "bucket_id": "billing-period-usage-based", "pool_kind": "usage_based",
      "window": { "name": "billing_period_usage_based", "kind": "billing-cycle", "duration_sec": 2592000 } },
    "used_percentage": null, "resets_at": null, "observed_at": null, "valid_until": null,
    "source": { "collector_id": "cursor-agent-dashboard",
      "source_schema": "cursor/GetCurrentPeriodUsage/v1", "auth_source": "cursor-agent-current-login" },
    "refresh_hint": {
      "reason": "cursor/... quota 信号不可用", "recoverable": true,
      "command": "ccm quota status --machine-wide --refresh --json",
      "remedy": "运行 command 后重查；仍不可用则保持 unknown 并 surface 用户。",
      "recheck": "ccm quota status --machine-wide --json", "agent_authorized": true,
      "authorization": "仅授权一次只读 quota 重采集；不授权任何凭证 mutation。"
    } }
  ```

  Cursor 每个 surface 有 `billing-period-global / first_party` 与
  `billing-period-usage-based / usage_based` 两个独立 bucket；同一 pool 可经 collector 证据跨 surface 相关，
  但 first-party 与 usage-based 的 `quota_scope_digest` 永不因同一登录态而折成一个可互补容量。

  `capacity_views` 的精确对象形状：

  ```json
  {
    "schema": "ccm/machine-quota-capacity-views/v1",
    "known_capacities": [
      {
        "quota_scope_digest": "sha256:collector-proven-pool",
        "capacity_units": 1,
        "scope_digests": ["sha256:surface-a", "sha256:surface-b"]
      }
    ],
    "unresolved_scope_digests": ["sha256:surface-c"],
    "unresolved_capacity_units": null
  }
  ```

  `known_capacities[]` 只把 collector 证明拥有相同非空 `quota_scope_digest` 的 scopes 折成一个
  `capacity_units:1`；缺 correlation evidence 的 scope 留在 `unresolved_scope_digests[]`，且
  `unresolved_capacity_units` 必须为 `null`，不得假设它们是可相加的独立容量。完整 CLI status 始终返回这个对象；
  收窄的 hook / session 注入边界可以省略 `capacity_views`，该省略既不改变 CLI 合同，也不证明任何独立容量，
  需要容量视图时重新查询 `ccm quota status --machine-wide --json`。
- `quota refresh --machine-wide` 也不套通用信封；JSON 根为 `ccm/machine-quota-refresh/v1`，描述 scopes、
  deltas、deliveries、fan-out 与 checkpoint 结果。
- `quota preflight` 的 `data` 是从 authority store 重验后得到的 mechanical decision；caller 结论不进入
  authority。承重 gate 不成立时显式含 `automatic_spawn_limit:0` 与 `blocking_reasons[]`。
- `quota reserve` 的成功 `data` 含 `action:"created"`、`reservation_id`、store-derived `request_hash`、`event_ref`、
  `snapshot_ref`、event/snapshot 各自的 directory-sync receipt；同 key 幂等返回
  `action:"idempotent-existing"` 与原 receipt。
- `quota audit` 的 `data` 是 reservation transition。只有已到 TTL 的 `held` +
  confirmed-unlaunched evidence 才为 `state:"expired"`；`committed` 或 unknown evidence 返回
  `state:"orphaned"`，容量仍 counted。multi-key 的 capacity-changing transition 由 coordinator 一次发布
  全部 legs；`expired|released` 是单调 terminal，重试只返回既有 receipt，不新增 event、不复活或重占容量。

### target / delivery / dependency

- `target set`：`{target_id,target,dry_run}`；`target show`：`{target_id,target,fact}`；`target refresh`：
  `{target_id,target,revalidations,dry_run}`。
- `delivery check` 与 `dependency explain` 的 `data` 是同一 qualification 形状：

```json
{
  "state": "qualified",
  "basis": "delivery",
  "candidate_complete": true,
  "target_delivered": true,
  "target_id": "main",
  "observation_id": "D-...",
  "qualified_by": "delivery",
  "reasons": []
}
```

`state` 固定为 `qualified|unqualified|unknown`；`qualified_by` 只在 qualified 时出现。waiver 的
`qualified_by` 是 `waiver`，但 `target_delivered` 固定 false。
- `delivery audit`：`{strict_preview:true,persisted_mode:"legacy|declared",edges:[{downstream,dependency,qualification}]}`。
- `dependency require/default`：`{downstream,dependency,requirement,dry_run}`；`dependency waive`：
  `{waiver,qualification,dry_run}`。
- `task attest-delivery`：`{task_id,target_id,qualification,dry_run}`。

### board next（`ccm board next --json` / `ccm next --json`）

`data` = id 字符串数组：

```json
["T1", "T2"]
```

无 ready 任务时为 `[]`。

### board graph（`ccm board graph --json`）

```json
{
  "topoOrder": ["T1", "T2"],
  "cycle": null,
  "readySet": [],
  "criticalPath": { "chain": ["T1", "T2"], "makespan": null, "weight_source": "mixed" },
  "parallelism": { "T1": 2, "Tinf": 2, "parallelism": 1 },
  "impact": {
    "T1": { "count": 1, "descendants": ["T2"] },
    "T2": { "count": 0, "descendants": [] }
  },
  "rollup": { "owners": {}, "inconsistencies": [] },
  "nesting": { "depth1": [], "parentCycles": [] }
}
```

### board critical-path（`ccm board critical-path --json`）

`data` = graph 的 criticalPath 子对象：

```json
{ "chain": ["T1", "T2"], "makespan": null, "weight_source": "mixed" }
```

### task list（`ccm task list --json` / `ccm ls --json`）

`data` = task 摘要数组，每项：

```json
{ "id": "T1", "status": "in_flight", "type": "development", "executor": "subagent", "title": "build framework" }
```

`executor` 缺时为 `null`。

### task show（`ccm task show <id> --json`）

`data` = 该 task 的实际存在字段（稀疏——只含已设字段）：

```json
{
  "id": "T1",
  "status": "ready",
  "deps": [],
  "title": "build framework",
  "type": "development",
  "executor": "subagent",
  "handle": "sub-1",
  "estimate": { "value": 3, "unit": "h" },
  "created_at": "2026-06-25T07:07:07Z",
  "started_at": "2026-06-25T07:07:11Z"
}
```

id 不存在时 `data` = `null`，exit 0。

### board show（`ccm board show --json`）

`data` = 摘要（非整板 JSON）：

```json
{
  "goal": "catalog probe demo",
  "owner": { "active": true, "session_id": "", "heartbeat": "2026-06-25T07:07:46Z" },
  "taskCount": 2,
  "statusCounts": { "ready": 2 },
  "lint": { "ok": true, "errors": 0, "warnings": 3 }
}
```

### board init（`ccm board init --json`）

真实写入的 `data` 是 board 摘要，并额外携带实际产物路径与命令级 capability：

```json
{
  "capabilities": ["board-init/structured-board-path-v1", "goal-contract/v1"],
  "board_path": "/abs/home/boards/<generated-board-name>",
  "goal": "catalog probe demo",
  "owner": { "active": true, "session_id": "", "heartbeat": "2026-07-13T12:00:00Z" },
  "taskCount": 0,
  "statusCounts": {},
  "lint": null
}
```

示例里的 `board_path` 代表实际绝对 board artifact 路径。`ccm board init --dry-run --json`
的 `data.capabilities` 相同，但输出**不含 `data.board_path`**：dry-run 没有写出可命名的
artifact。消费者应先用 `ccm board init --capabilities --json` 做兼容性握手；该只读端点返回
`{"ok":true,"data":{"capabilities":["board-init/structured-board-path-v1","goal-contract/v1"]}}`，不解析或创建任何路径。
不得从人读 stdout 抓路径，也不得把 dry-run 当成已创建。

### board enable-contract / task planning-routing writers

- `ccm board enable-contract --preflight --json` 的 `data`：

```json
{
  "schema": "ccm/routing-contract-preflight/v1",
  "activation": "legacy",
  "ready": false,
  "tasks": [{ "task_id": "T7", "issues": [{ "code": "PLANNING-SHAPE", "path": "planning", "message": "must be an object" }] }],
  "grandfathered_terminal_task_ids": []
}
```

`activation` 只取 `legacy|enabled|invalid`。`ready:true` 才能执行写形态；写形态成功的 `data` 是 activation 后 board 摘要。
- `task set-planning --json`、`task set-routing --json`、`task route-bind --json` 的 `data` 都是写后完整 task JSON。前两者分别出现 `planning` 与初始 routing envelope；`route-bind` 还出现 `routing.selected`、append 后 `routing.attempts[]`、task `handle` 与 `status:"in_flight"`。这些 JSON 只证明 ledger 写入成功，不证明 provider spawn / liveness / parent acceptance。

### board lint（`ccm board lint --json` / `ccm lint --json`）

```json
{
  "ok": true,
  "violations": [
    { "rule": "BIZ-DEV-REFS", "level": "warn", "message": "…", "task": "T1" }
  ],
  "report": "cc-master board lint: PASS（…）\n\n[warn] …"
}
```

外层信封 `ok` 恒 true；lint 是否净看 `data.ok`（及进程 exit code，hard error 时 exit=3）。

### jc list（`ccm jc list --json`）

`data` = 数组，每项：

```json
{ "id": "J1", "status": "pending_review", "severity": "high", "category": "architecture", "summary": "test decision" }
```

### jc show（`ccm jc show <id> --json`）

`data` = 单条 jc（稀疏）：

```json
{
  "id": "J1",
  "summary": "test decision",
  "status": "pending_review",
  "category": "architecture",
  "decision": "chose A",
  "severity": "high",
  "raised_at": "2026-06-25T07:08:19Z"
}
```

### cadence status（`ccm cadence status --json`）

`data` = `{}`（无 cadence 配置时空对象；有则 `{ target, iterations… }`）。

### watchdog status（`ccm watchdog status --json`）

`data` = `null`（无 watchdog）或 watchdog 对象。对象保留原有字段，并追加派生 `health`：

```json
{
  "fire_at": "2026-06-24T12:00:00Z",
  "mechanism": "cron",
  "job_id": "cron-abc",
  "health": { "armed": true, "code": "armed" }
}
```

存量对象缺失 / 空白 `job_id` 时，`health.armed=false`、`code="missing-accountable-handle"`；
`fire_at` 已过期时 `code="expired"`。两者都附 `action`：先 `ccm watchdog disarm`，创建真实
wakeup，再带 `--job-id <handle>` 重新 arm。legacy `wakeup` 对象也按同一规则返回和诊断；读状态不改 board。

{{USING_CCM_POLICY_JSON_EXAMPLE}}

### peers list（`ccm peers --json` / `ccm peers list --json`）

`data` = 花名册：`peers[]`（活+心跳新鲜 orchestrator 扁平视图）+ `pools[]`（按 harness 分区后的竞争池）+ `count`（=M）+ `freshness_sec`（本次判活窗口）+ `as_of`（判活基准 ISO）：

```jsonc
{
  "peers": [
    {
      "board_file": "20260629T120000Z-12345.board.json",
      "goal": "prod incident fix",
      "harness": "claude-code",              // owner.harness·缺/坏 → "unknown"
      "priority": "urgent",                 // coordination.priority·缺/坏 → "normal"
      "session_id": "s1",                   // owner.session_id（"" = 未认领活板）
      "heartbeat": "2026-06-29T11:59:00Z",
      "heartbeat_age_sec": 60,
      "current": {                          // coordination.state.current·缺 → null
        "active_tasks": 1, "workload": "hotfix", "burn_contribution": 9 },
      "planned": {                          // coordination.state.planned·缺 → null
        "remaining_work": "verify+deploy", "cost_to_complete_pct": 4 }
    }
  ],
  "pools": [
    {
      "pool_id": "claude-code",              // known harness 同池；unknown 为 "unknown:<board_file>"
      "harness": "claude-code",
      "count": 1,
      "peers": [ /* 同上 PeerEntry */ ]
    }
  ],
  "count": 1,                               // = peers.length（M·喂 headroom/M 防过冲）
  "freshness_sec": 600,                     // 本次判活心跳窗口（--freshness-sec 覆写后回显）
  "as_of": "2026-06-29T12:00:00Z"
}
```

无活+新鲜板 → `peers:[]`、`pools:[]`、`count:0`（exit 0·fail-safe 退单板）。各 peer 数字字段坏 / 人类可读字段坏 → 该字段 `null`（降级·不污染花名册）。缺失 / 非法 `owner.harness` → `harness:"unknown"` 且进入 `unknown:<board_file>` 单例池。**无任何 secret / token 字段**（token-blind）。

### coordination inbox list（`ccm coordination inbox list --json`）

`data` = `{ inbox, count }`；`--unconsumed` 后 `inbox` 只含未消费通知：

```jsonc
{
  "inbox": [
    {
      "id": "ntf-20260709T120000Z-a1b2",
      "kind": "pacing_yield",
      "status": "unconsumed",
      "created_at": "2026-07-09T12:00:00Z",
      "expires_at": "2026-07-09T17:00:00Z",
      "strength": "strong",
      "summary": "为高优 peer 让路",
      "payload": { "peer": "A" },
      "consumed_at": null,
      "consumed_note": null
    }
  ],
  "count": 1
}
```

### coordination inbox ack（`ccm coordination inbox ack <id...> --json`）

`data` = `{ acked }`，只回显本次 id 对应的通知对象；未知 id → exit 2：

```jsonc
{
  "acked": [
    {
      "id": "ntf-20260709T120000Z-a1b2",
      "kind": "pacing_yield",
      "status": "consumed",
      "created_at": "2026-07-09T12:00:00Z",
      "expires_at": "2026-07-09T17:00:00Z",
      "strength": "strong",
      "summary": "为高优 peer 让路",
      "payload": { "peer": "A" },
      "consumed_at": "2026-07-09T12:05:00Z",
      "consumed_note": "已降档并暂停 fill-work"
    }
  ]
}
```

### coordination notify（`ccm coordination notify --json`）

`data` = `{ notification }`，即 append 后的新通知对象。同 kind 已有旧 `unconsumed` 时，写关卡会把旧条目标 `expired` 并写 `superseded_by`，新条目仍为当前唯一未消费通知。

```jsonc
{
  "notification": {
    "id": "ntf-20260709T120000Z-a1b2",
    "kind": "pacing_yield",
    "status": "unconsumed",
    "created_at": "2026-07-09T12:00:00Z",
    "expires_at": "2026-07-09T17:00:00Z",
    "strength": "strong",
    "summary": "为高优 peer 让路",
    "payload": { "peer": "A" },
    "consumed_at": null,
    "consumed_note": null
  }
}
```

### coordination arbitrate（`ccm coordination arbitrate --json`）

`data` = 本板 own row + 全池 allocation 摘要 + 本次 append 结果：

```jsonc
{
  "mode": "pool",                         // "single-board" | "pool"
  "appended": 1,                           // 本次是否新写 inbox 通知
  "append_reason": "first",                // first | edge | dedup | cooldown | no-notification
  "notification": { "id": "ntf-...", "kind": "pacing_yield", "...": "..." },
  "own_row": {
    "kind": "pacing_yield",
    "notification_kind": "pacing_yield",
    "strength": "weak",
    "target_headroom_pct": 3,
    "delta_headroom_pct": -9,
    "reason": "池压力 warn，本板 burn≈12% 高于加权目标 3%…",
    "peer": { "board_file": "20260709T120000Z-a.board.json", "priority": "normal", "weight": 2 }
  },
  "allocation": {
    "pressure": { "headroom_pct": 15, "quota_model": "{{USING_CCM_COORDINATION_QUOTA_MODEL_EXAMPLE}}", "band": "warn" },
    "base_advice": { "verdict": "throttle", "...": "..." },
    "rows": [ /* own row + sibling rows；只用于解释，不写 sibling board */ ],
    "roster_signature": "…",
    "peer_count": 2
  },
  "unconsumed": [ /* 当前本板未消费通知 */ ]
}
```

### usage show（`ccm --harness <target> usage show --json`）

```jsonc
{ "ok": true, "data": {
  "available": true, "accounts_scope": "current", "effective_n": 1,
  "agent_summary": "codex: available · 7d=18% codex=18% codex_bengalfox=0%",
  "current": {
    "source": "<adapter-source>", "available": true,
    "five_hour": null,
    "seven_day": { "used_percentage": 18, "resets_at": 1784505600 },
    "fable_seven_day": null, "billing_period": null,
    "pools": [
      { "id": "codex", "label": "Codex default", "kind": "first_party",
        "used_percentage": 18, "resets_at": 1784505600 },
      { "id": "codex_bengalfox", "label": "Codex secondary model", "kind": "first_party",
        "used_percentage": 0, "resets_at": 1784505600 }
    ],
    "captured_at": 1784200000
  },
  "accounts": [], "registry_present": false,
  "as_of": "2026-07-16T11:06:40Z", "source": "<adapter-source>", "confidence": "high",
  "refresh_hint": null
} }
```

窗口键始终位于 `data.current`；不适用 / 不可得为 `null`。`data.current.pools[]` 是可选 named-pools 扩展，
其条目含 `{id,label,kind,used_percentage,resets_at}`；Cursor 分别保留 total / Auto / API / spend-limit，Codex
分别保留 `rateLimitsByLimitId` 的模型池。兼容字段 `current.billing_period` 与 5h / 7d 字段不删除、不改语义；
Codex 即使 source 暂时暴露 `five_hour`，决策层也必须忽略它，只用 7d。不存在 `data.five_hour`、
`used_percent` / `remaining_percent` 等顶层窗口合同。`accounts[]` 只记录 registry snapshot。

`data.agent_summary` 始终是一句可独立消费的 plain-language 状态 + 动作；naive agent 应先读它，结构化判断再读
`data.current.*` 与 `data.refresh_hint`。信号可用时 `data.refresh_hint` 为 `null`；信号不可用
（`available:false`）且成因是某 harness 的短命 token
过期时，它带一个 `{reason, recoverable, command, remedy, recheck}`
对象（另含 `agent_authorized` / `authorization`）：`recoverable:true` 且 `agent_authorized:true` 时 `command` 是
让该 harness 自行刷新 token 的 agent 可执行命令、`remedy` 是「运行它 →
重跑 recheck」的完整人读步骤、`recheck` 是重新查询 usage 的命令；不可自恢复（网络 / 401 / API 变更）时
`recoverable:false` 且 `command` / `remedy` 为 `null`。Kimi collector 是窄例外：默认可在相邻锁内重读并刷新
Kimi 自己存储的 OAuth，再原子发布旋转后的 token pair；若自动刷新失败，仍返回 `kimi -p 'hi'` 的既有
harness-native hint。其他 provider 保持提示式恢复；任何路径都不把 token 放进输出。

`agent_summary` 的三类承重文案形状：available 为
`<harness>: available · 5h=<pct> 7d=<pct> ...`；已授权自恢复为
``<harness>: UNAVAILABLE (<reason>) · 你被授权运行 `<command>` 刷新后重查 · 见 refresh_hint``；网络 / API
等 opaque 故障为 `<harness>: UNAVAILABLE (<reason>) · 等待或 surface 用户 · 不可自刷 · 见 refresh_hint`。

### usage advise（`ccm usage advise --json`）

```jsonc
{ "ok": true, "data": {
  "verdict": "hold", "reason": "...", "levers": [], "strength": "weak",
  "stop_dimension": null, "nearest_reset": null,
  "window_5h_pct": null, "window_7d_pct": 18, "window_billing_period_pct": null,
  "billing_period_resets_at": null, "effective_n": 1, "switch_candidate": null,
  "confidence": "high", "source": "<adapter-source>",
  "as_of": "2026-07-16T11:06:40Z", "available": true, "refresh_hint": null
} }
```

`available:false` 时保持 `verdict:"hold"` 与低置信来源，不能解释成 ample。Claude Code 可能产生
`switch` / `stop_5h` / `stop_7d`；Codex 的有效 hard pacing 只包含 7d，Cursor 的有效 hard pacing 只包含
各自 target 的 billing period。任何 `switch_candidate` 都只是候选事实；Codex、Cursor 与 Kimi 不得自动换号。

`data.refresh_hint` 与 `usage show` 同形同义：`available:true` 时为 `null`，`available:false` 且为某
harness 短命 token 过期时带 `{reason, recoverable, command, remedy, recheck}`（`recoverable:true` 表示可按
`command` → `recheck` 手动恢复）。它是「该怎么恢复」的提示，不是「配额耗尽该停」的 `stop_*` verdict——别混淆。

### usage task-cost（`ccm usage task-cost [<id>] --json`）

单任务（给 `<task-id>`）：

```jsonc
{ "task": "T2", "scope": "this-board", "found": true,
  "tokens": { "input": 156000, "output": 39000, "total": 195000 },
  "na": false, "source": "observability", "confidence": "high" }
```

无 observability / shell → `na:true`、`tokens.total:null`；不存在 → `found:false`。

聚合（`--group-by`）：

```jsonc
{ "group_by": "executor", "scope": "this-board",
  "groups": [ { "key": "subagent", "total": 504700, "n": 7, "na_count": 3 } ],
  "total": 569500, "coverage_pct": 56, "history_n": 3,
  "source": "observability", "confidence": "medium" }
```

`--scope`（默认 `this-board`）切语料范围：`this-board` 读本板全 tasks 的 observability（含非 done → 标 N/A）；`home` / `this-repo` 跨板聚归档 done 任务的 token（`this-repo` 过滤同 repo）。回显 `scope`。

### usage burn-rate（`ccm --harness <target> usage burn-rate --json`）

```jsonc
{ "ok": true, "data": {
  "available": true,
  "five_hour": { "used_pct": 42, "resets_at": 1784217600,
    "burn_pct_per_hour": 8.4, "method": "window-elapsed", "confidence": "medium",
    "source": "<adapter-source>", "unavailable_reason": null, "harness": "<label>" },
  "seven_day": { "used_pct": 50, "resets_at": 1784764800,
    "burn_pct_per_hour": 3.1, "method": "window-elapsed", "confidence": "medium",
    "source": "<adapter-source>", "unavailable_reason": null, "harness": "<label>" },
  "source": "<adapter-source>", "as_of": "2026-07-16T11:06:40Z", "confidence": "medium",
  "refresh_hint": null
} }
```

Codex 只读 `seven_day`；Cursor billing-period 尚未进入该输出，故会返回 `available:false`，不能据此声称账期 ample。
`data.refresh_hint` 与 `usage show` 同形（`available:false` 且短命 token 过期时带
`{reason, recoverable, command, remedy, recheck}`，否则 `null`）。

### usage runway（`ccm --harness <target> usage runway --json`）

```jsonc
{ "ok": true, "data": {
  "available": true,
  "five_hour": { "used_pct": 42, "burn_pct_per_hour": 8.4,
    "remaining_corridor_pct": 48, "hours_to_ceiling": 5.71, "hours_to_reset": 4,
    "verdict": "will-exhaust-before-reset", "ceiling_pct": 90 },
  "seven_day": { "used_pct": 50, "burn_pct_per_hour": 3.1,
    "remaining_corridor_pct": 35, "hours_to_ceiling": 11.29, "hours_to_reset": 120,
    "verdict": "will-exhaust-before-reset", "ceiling_pct": 85 },
  "source": "<adapter-source>", "as_of": "2026-07-16T11:06:40Z", "confidence": "medium",
  "refresh_hint": null
} }
```

窗口不可得时对应 verdict 为 `unknown`；全部不可得时 `available:false`。Codex 忽略 5h；Cursor billing-period
尚未进入该输出，不能用 `unknown` 反推 ample。`data.refresh_hint` 与 `usage show` 同形（`available:false` 且短命
token 过期时带 `{reason, recoverable, command, remedy, recheck}`，否则 `null`）。

### estimate show（`ccm estimate show [<id>] --json`）

```jsonc
{ "scope": "home", "as_of": "ISO", "history_n": 40,
  "tasks": [ {
    "id": "T6", "raw_estimate_h": 3,
    "calibration": { "multiplier": 1.287, "source": "calibrated", "level": "type", "history_n": 23 },
    "calibrated_h": 3.86,
    "interval": { "p50": 4.83, "p80": 5.96, "p95": 10.04 },   // 5% 硬墙·单调
    "confidence": "high", "coverage_basis": "mondrian-group", "source": "calibrated"
  } ] }
```

### estimate forecast（`ccm estimate forecast --json`）

```jsonc
{ "forecast": { "p50": "ISO", "p80": "ISO", "p95": "ISO" },   // ETA·p95 = 5% 硬墙
  "makespan": { "p50": {"value":16.16,"unit":"h"}, "p80": {...}, "p95": {...} },  // throughput-only mode → null
  "throughput_days": { "p50": 4, "p80": 4, "p95": 5 },
  "criticality_index": [ {"id":"T4","criticality":0.906,"cruciality":0.713,"sensitivity":0.665} ],
  "schedule_sensitivity": [ {"id":"T4","sensitivity":0.665} ],
  "consistency": { "deviation": 0.495, "warning": true },     // ①②偏差>20% → warning
  "mode": "both", "coverage_pct": 83, "confidence": "medium", "history_n": 40,
  "scope": "home", "runs": 2000, "seed": 42, "effective_n": 1, "as_of": "ISO",
  "source": "calibrated",
  "deadline_risk": {                                          // 板有 asserted/confirmed DDL 时附·否则 null（不假绿）
    "deadline": "ISO", "deadline_state": "confirmed",
    "time_remaining_hours": 356.5, "risk_band": "at_risk", "strength": "strong",
    "on_time_probability": 0.62,
    "margin": { "p50_h": 40, "p80_h": 12.5, "p95_h": -6, "basis": "precedence-only-optimistic" } },
  //   ↑ 相对 DDL 的 margin/风险摘要（复用 `estimate deadline-risk` verdict·不重算）·margin 负=越过 DDL·
  //     无 DDL / state=none|pending → null；完整 verdict/通道/top_drivers 见 `estimate deadline-risk`
  "notes": ["1 tasks unit-time fallback…"] }   // --effective-n N>1 → throughput_days ÷N + note（通道① makespan 不变）
```

### estimate evm（`ccm estimate evm --json`）

```jsonc
{ "has_baseline": true, "baseline_captured_at": "ISO", "as_of": "ISO",
  "pv": {"value":29,"unit":"h"}, "ev": {"value":10,"unit":"h"},
  "ac": {"value":13.5,"unit":"h","source":"duration","coverage_pct":100},
  "spi": 0.345, "cpi": 0.741,
  "spi_t": 0.086, "sv_t": -69.5, "es_hours": 6.5, "at_hours": 76,   // Earned Schedule
  "eac": {"value":39.15,"unit":"h"}, "ieac_t": {"value":888.62,"unit":"h"},
  "etc": {...}, "bac": {"value":29,"unit":"h"}, "vac": {"value":-10.15,"unit":"h"},
  "confidence": "high", "warnings": [], "source": "evm-earned-schedule" }
```

无 baseline → `has_baseline:false` + `warnings:[…]`（exit 0·先 `baseline snapshot`）。

### estimate velocity（`ccm estimate velocity --json`）

```jsonc
{ "scope": "home", "window_days": null,
  "velocity_tasks_per_day": 0.6, "backlog": 6,
  "eta_days": { "p50": 4, "p80": 4, "p95": 5 },
  "sle": { "p50": 2.58, "p85": 5.6, "p95": 9.18, "unit": "h", "confidence": "high", "history_n": 40 },
  "history_n": 40, "confidence": "high", "source": "observability", "as_of": "ISO" }
// 注：`window_days` 回显**实际生效**的滑窗——不传 `--window` → `null`（不过滤）；`--window 14` → `14`（只取近 14 天 done）。
```

### estimate risk（`ccm estimate risk --json`）

```jsonc
{ "scope": "home",
  "criticality_index": [ {"id":"T4","criticality":0.906,"cruciality":0.713,"sensitivity":0.665} ],
  "wip_aging": [ {"id":"T5","age_hours":49.43,"status":"critical","sle_p85":5.6,"sle_p95":9.18} ],
  "ccpm": { "buffer_size_h": 1.97, "chain_mean_total_h": 16.61, "zone": "green",
            "buffer_health": 0.333, "chain_progress_pct": 0.333 },
  "sle": { "p85": 5.6, "p95": 9.18, "confidence": "high" },
  "history_n": 40, "confidence": "medium", "source": "calibrated",
  "as_of": "ISO", "seed": 42, "runs": 2000 }
```

### estimate cost-to-complete（`ccm estimate cost-to-complete --json`）

```jsonc
{ "cost_to_complete_pct": { "p50": 12.4, "p80": 18.9, "p95": 27.3 },  // 配额%·p95 = 5% 硬墙·burn 不可得 → null
  "mean_pct": 13.7, "backlog": 6,
  "burn_pct_per_hour": 18.4, "burn_used_pct": 92, "burn_method": "window-elapsed",
  "per_unit_samples": 23,
  "token_sizing": {                     // **辅助·非预算账本**（配额% 才是账本）
    "total_predicted_tokens": 1170000,
    "per_task": [ { "id": "T4", "predicted_tokens": 195000, "pct_share": 2.06, "knn_confidence": "medium" } ],  // 截断前 10 个 backlog 任务
    "note": "token 为派活相对 sizing（辅助·knnPredict.predictedTokens）·配额% 才是预算账本" },
  "scope": "home", "runs": 2000, "seed": 42, "as_of": "ISO",
  "source": "calibrated",               // burn 不可得 → "local-derived-approx" + available:false
  "confidence": "medium", "available": true, "history_n": 40,
  "notes": ["per-unit %-cost = burn-rate × 历史任务工期（假设串行归因…）"] }
```

账户 burn 不可得 → `available:false`、`cost_to_complete_pct:null`、`mean_pct:null`（exit 0·降级）；`backlog:0` → cost `0%`。`token_sizing` 是辅助相对量计（非预算账本）。

### estimate deadline-risk（`ccm estimate deadline-risk --json`）

```jsonc
{ "deadline": "2026-08-01T09:00:00Z",         // goal_contract.deadline.at（state∈asserted/confirmed 时·否则 null）
  "deadline_state": "confirmed",               // pending | asserted | confirmed | none
  "as_of": "ISO", "time_remaining_hours": 356.5,  // (deadline − as_of)/3600000·无已确认/断言 DDL → null
  "on_time_probability": 0.82,                 // P(finish ≤ DDL)·**只来自 RCPSP-in-trial**·unknown → null
  "on_time_probability_source": "rcpsp-in-trial",  // 恒 "rcpsp-in-trial" | "unknown"（throughput 永不做源）
  "forecast": { "p50":"ISO","p80":"ISO","p95":"ISO", "basis":"precedence-only-optimistic" },  // 乐观下界口径·null=不可算
  "margin":   { "p50_h":40.0,"p80_h":12.5,"p95_h":-6.0, "basis":"precedence-only-optimistic" },  // DDL − forecast_pX·负=越过
  "risk_band": "watch",                        // on_track | watch | at_risk | likely_late | overdue | unknown
  "strength": "weak",                          // 注入力度·watch/on_track/unknown=weak·at_risk/likely_late/overdue=strong
  "channels": {
    "precedence_only": { "role":"optimistic-bound", "on_time_probability":0.90,
                         "makespan_p50_h":120.0,"makespan_p80_h":160.0,"makespan_p95_h":210.0 },  // 无资源闸·乐观下界·null=含环/空
    "resource_aware":  { "on_time_probability":0.70, "source":"rcpsp-in-trial", "wip":16, "runs":2000,
                         "makespan_p50_h":140.0,"makespan_p80_h":180.0,"makespan_p95_h":220.0 },  // verdict 源·RCPSP 不可用 → null
    "throughput_reference": { "kind":"heuristic-reference", "note":"历史吞吐采样·非 DAG 资源调度·不作 verdict",
                              "on_time_probability_heuristic":0.55, "days_p50":15.0,"days_p80":20.0,"days_p95":27.0,
                              "confidence":"high" } },  // **绝不映射 on_track**·仅旁证·null=无吞吐历史
  "channel_disagreement": 0.20,                // |P_precedence − P_rcpsp|·> 0.25 → 禁无条件 on_track（降 watch）·null=不可算
  "coverage_pct": 60, "confidence": "high",    // low coverage/history → confidence 降级 → on_track 降 unknown（不假绿）
  "history_n": 42, "scope": "home",
  "calibration_status": "uncalibrated-conservative",  // 阈值未经经验校准·保守起点（诚实·恒此值）
  "top_drivers": [                             // 先动哪里·reason ∈ critical | sensitive | blocked
    { "id":"T4", "criticality":0.906, "sensitivity":0.718, "reason":"critical" },
    { "id":"T9", "reason":"blocked", "detail":"blocked_on:user" } ],
  "runs": 2000, "rcpsp_runs": 2000,            // rcpsp_runs < runs = latency 降档；0 = RCPSP 被禁用（→ unknown）
  "seed": 42, "source": "calibrated",          // history_n>0 → "calibrated" 否则 "estimate"
  "notes": ["…诚实降级从句…"] }
```

诚实降级（**绝不假绿**）：无 DDL / 含环 / 无估值 / 低置信 / 双通道分歧 > 0.25 / RCPSP 不可用 → `risk_band:"unknown"` + `on_time_probability:null`（**绝不退 throughput 冒充 resource-aware**）；`now ≥ DDL` 且未完成 → `overdue`（strong）。`on_time_probability_source` 恒为 `rcpsp-in-trial` 或 `unknown`——throughput 通道永不做 verdict 源。band 阈值 `uncalibrated-conservative`（未经经验校准的保守起点）。
<!-- ccm:k:end point:ccm.cmd.json-shape -->
