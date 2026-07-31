---
point: ccm.cmd.task
---

## 权威陈述

<!-- ccm:k:start point:ccm.cmd.task -->
## namespace task

任务：增删改查 + 状态机（DAG 节点）。

### task add

**写**

```
ccm task add <id> [flags]
```

- positional：

| 名 | 必填 | 含义 |
|---|---|---|
| `<id>` | 是 | task id（非空唯一） |

- flags：

| flag | 短名 | 类型 | enum 取值 | default | 含义 |
|---|---|---|---|---|---|
| `--title <str>` | | string | | `""` | 卡片标题 |
| `--description <str>` | | string | | | 详细描述 |
| `--type <enum>` | | enum（开放·未知值 warn） | `design, planning, development, development-demo, acceptance, e2e-integration, doc-alignment, pr` | | 任务类型 |
| `--executor <enum>` | | enum | `user, master-orchestrator, subagent, workflow, external` | | 执行者类型 |
| `--handle <str>` | | string | | | 真实后台句柄（`in_flight` subagent/workflow 必须有；`ready`/`blocked` future task 不预填；external 可记录 issue URL/number/run id） |
| `--deps <a,b>` | | csv | | `[]` | 依赖（逗号分隔） |
| `--parent <str>` | | string | | 缺=顶层 | 归属 owner 节点（嵌套 depth=1） |
| `--estimate <dur>` | | duration | `3h`/`90m`/`2d`/`1w` | | 估时 |
| `--ref <kind:ref>` | | string（可重复） | kind ∈ refKind 开放枚举 | | 引用 `kind:ref` |
| `--accept <str\|@file>` | | string/@file | | | 验收：一句话 DoD 或 `@file` |
| `--role <enum>` | | enum | `normal, fill-work` | `normal` | 调度角色 |
| `--review-gate <enum>` | | enum | `APPROVE` | | 声明显式 review 依赖门；只有 APPROVE 满足下游 deps |
| `--justification <str>` | | string | | | 决策理由 |
| `--status <enum>` | | enum | status 枚举（见 board show data） | `ready` | 初始 status |
| `--verified` | | bool | | false | 标记已验收 |
| `--artifact <str>` | | string | | | 产物链接 |
| `--wip-limit <str>` | | int | | | 本 task WIP 覆写 |
| `--set <path=val>` | | string（可重复） | | | 设**本 task** 的 ✎ 标量（裸 path 作用于本 task；`tasks[<id>].path` 可写其它 task） |
| `--set-json <path=json>` | | string（可重复） | | | 设**本 task** 的 ✎ 对象/数组（scoping 同上） |
| `--log <str>` | | string | | | 同时追一条 log |

- 例：`ccm task add T7 --type development --deps T1 --estimate 3h` · `ccm task add R1 --type review --review-gate APPROVE` · `ccm task add EXT3 --executor external --ref issue:https://github.com/o/r/issues/9 --handle o/r#9`
- external issue closed 但未端点验收：`ccm task set-status EXT3 uncertain`；验收外部 PR 后才：`ccm task done EXT3 --verified --artifact https://github.com/o/r/pull/12`

### task show

**读**

```
ccm task show <id> [flags]
```

- positional：

| 名 | 必填 | 含义 |
|---|---|---|
| `<id>` | 是 | task id |

- flags：

| flag | 短名 | 类型 | 含义 |
|---|---|---|---|
| `--json` | | bool | 完整 task JSON（否则人类卡片） |

- 例：`ccm task show T7` · `ccm task show T7 --json`

### task list

**读**（别名 `ccm ls` / `ccm task ls`）

```
ccm task list [flags]
```

- positional：无
- flags：

| flag | 短名 | 类型 | enum 取值 | 含义 |
|---|---|---|---|---|
| `--status <enum>` | | enum（可重复） | status 枚举 | 只列某 status |
| `--executor <enum>` | | enum | executor 枚举 | 只列某 executor |
| `--type <enum>` | | enum | taskType 枚举 | 只列某 type |
| `--parent <str>` | | string | | 只列某 owner 的子节点 |
| `--json` | | bool | | JSON 数组 |

- 例：`ccm task ls --status ready` · `ccm task ls --executor subagent --json`

### task update

**写**

```
ccm task update <id> [flags]
```

- positional：

| 名 | 必填 | 含义 |
|---|---|---|
| `<id>` | 是 | task id |

- flags：

| flag | 短名 | 类型 | enum 取值 | 含义 |
|---|---|---|---|---|
| `--title <str>` | | string | | 卡片标题 |
| `--description <str>` | | string | | 详细描述 |
| `--type <enum>` | | enum（开放·未知值 warn） | taskType 枚举 | 任务类型 |
| `--executor <enum>` | | enum | executor 枚举 | 执行者类型 |
| `--handle <str>` | | string | | 后台句柄 |
| `--estimate <dur>` | | duration | `3h`/`90m`/`2d`/`1w` | 估时 |
| `--role <enum>` | | enum | `normal, fill-work` | 调度角色 |
| `--review-gate <enum>` | | enum | `APPROVE` | 声明显式 review 依赖门；只有 APPROVE 满足下游 deps |
| `--justification <str>` | | string | | 决策理由 |
| `--artifact <str>` | | string | | 产物链接 |
| `--verified` | | bool | | 标记已验收 |
| `--wip-limit <str>` | | int | | 本 task WIP 覆写 |
| `--accept <str\|@file>` | | string/@file | | 验收：一句话 DoD 或 `@file` |
| `--add-dep <a,b>` | | csv（可重复） | | 增依赖 |
| `--rm-dep <a,b>` | | csv（可重复） | | 删依赖 |
| `--add-ref <kind:ref>` | | string（可重复） | | 增引用 `kind:ref` |
| `--rm-ref <a,b>` | | csv（可重复） | | 删引用（按 ref） |
| `--parent <str>` | | string | | 改归属（`""`=升为顶层） |
| `--set <path=val>` | | string（可重复） | | 设**本 task** 的 ✎ 标量（裸 path 作用于本 task；`tasks[<id>].path` 可写其它 task） |
| `--set-json <path=json>` | | string（可重复） | | 设**本 task** 的 ✎ 对象/数组（scoping 同上） |
| `--log <str>` | | string | | 同时追一条 log |

- 例：`ccm task update T7 --estimate 5h --add-dep T2` · `ccm task update T7 --rm-dep T2 --verified --artifact /abs/out.md`
- **给 task 挂 `decision_package`（正例）**：`ccm task update T7 --set-json 'decision_package={"version":1,"ask_type":"decision","context_md":"…","what_i_need":"…","options":[…],"inputs_hash":"sha256:…","enter_cmd":"{{USING_CCM_ENTER_CMD_EXAMPLE}}"}'`——裸 path 直接落在 T7 上（无须再写 `tasks[T7].` 前缀）；成功输出回显 `set tasks[T7].decision_package` 供核对落点。
- 注：`update` 无 `--deps`（用 `--add-dep` / `--rm-dep`）、无 `--status`（用 start / done / block / set-status）；裸 `--set status=…` 会被 🔒 守门拒（exit 3），不会静默落 board 顶层。
- **`--artifact` 提前诊断（issue #57 问题2）**：若目标 task 已是 `status:done` 且 `verified` 非 `true`，单独设
  `--artifact`（不带 `--verified`）必然无法满足 done 真语义（`BIZ-DONE-VERIFIED`）——handler 层提前给一个更
  直达的 `Usage` 错误（**exit 2**，不是 exit 3），指路"同时加 `--verified` 或改用 `task done --verified
  --artifact`"。这是体验性提前诊断（lint 仍是唯一校验权威），不是新增校验规则——同时给 `--verified` 或目标
  不是"已 done 且未 verified"时不触发，正常交给 lint 判。

### task set-planning

**写（dedicated whole-object writer；不派发）**

```text
ccm task set-planning <id> --profile <json|@file|-> [--json]
```

- `--profile` 必填：`ccm/task-planning/v1` JSON 字面量、`@/absolute/file.json` 或 stdin `-`。
- writer 一次替换完整 `task.planning`，并在落盘前校验七维任务画像、estimate confidence、quality effect floor、budget posture/max attempts 与 required/preferred/forbidden capability sets；精确字段见 board-model-guide §C.5。
- 这是 route-independent task profile；命令不选 harness/provider/model、不 spawn。generic `task update --set-json planning=...` 与 `--force` 都不能替代它。
- 例：`ccm task set-planning T7 --profile @/abs/planning.json`

### task set-routing

**写（dedicated policy writer；不 selection / 不 spawn）**

```text
ccm task set-routing <id> --policy <json|@file|-> [--json]
```

- `--policy` 必填：provider-neutral policy JSON，含 `objective`、`constraints`、`candidates[]`、`chains.ample/tight` 与 `fallback`；精确字段与闭合 fallback classes 见 board-model-guide §C.5。
- writer 包装成 `ccm/agent-routing/v1` + `mode:"cross-harness"` + `selected:null` + `attempts:[]`，并与已有 planning 做 capability/effect/permission 交叉校验。
- 一旦已有 selection 或 attempt history，policy 不可替换；`attempts[]` append-only。generic setter / `--force` 不能覆盖。
- 命令不读取 provider、不选择 candidate、不 reserve、不 spawn、不 fallback。
- 例：`ccm task set-routing T7 --policy @/abs/routing-policy.json`

### task route-bind

**写（原子 selection + running attempt ledger projection；不 spawn）**

```text
ccm task route-bind <id> --selection <json|@file|-> --attempt <json|@file|-> [--json]
```

- 仅适用于 `executor=subagent` 且已有 routing policy 的 `ready`（或迁移中的 legacy `in_flight`）task。opt-in native-attempt board 改走 `native-attempt-bind`，不能由本 verb 绕过。
- `--selection` 必须引用 policy candidate 与 `ample|tight` chain，带 strict-UTC freshness window、每个 candidate `requires` predicate 恰好一次 `pass` 的 qualification results 和非空 reason codes。
- `--attempt` 必须是 `state:"running"`、candidate 与 selection 一致、带 strict-UTC `started_at` 和非空 opaque `handle`；requested model/effort 若存在必须等于 candidate。writer 自动冻结完整 `selection_snapshot`。
- 成功时原子写 `routing.selected`、append attempt、投影 task `handle`、把 task 置 `in_flight` 并在从 ready 转入时盖 `started_at`。重复 attempt id 或第二个 running attempt 拒绝。
- opaque handle 当前只是 syntactic claim，不是 live provider attestation。本命令不启动 worker；显式同步 `ccm worker run` 也不会自动调用它。generic start/handle setter/`--force` 不能替代 route-bind gate。
- 例：`ccm task route-bind T7 --selection @/abs/selection.json --attempt @/abs/attempt.json`

### task native-attempt-create

**写（精确 Codex native-attempt ledger contract；不调用 host tool）**

```
ccm task native-attempt-create <id> --selection <json> --attempt <json> --replay-intent <enum> [flags]
```

当前 native invoke runtime 为 `unsupported`：四 host strategy 都不投影 invoke artifact。此命令只在 opt-in board 上，从 `$CC_MASTER_HOME/native-attempt/v1/` 的 owner-only production store 读取已提交且未过期的 reservation/ticket，核对 canonical launch identity，原子 stage 唯一 claim、冻结 immutable create snapshot、持久提交 board 后再 commit claim。`launch_allowed:true` 只属于该精确 identity/claim；命令本身不 spawn，当前也没有 host adapter 消费它。

| flag | 类型 | 必填 | enum 取值 | 含义 |
|---|---|---|---|---|
| `--selection <json>` | JSON input | 是 | | 完整 qualified selection snapshot（`@/abs/file.json`、`-` 或 JSON 字面量） |
| `--attempt <json>` | JSON input | 是 | | `starting` native attempt + immutable dispatch/lineage/request snapshot |
| `--replay-intent <enum>` | enum | 是 | `accept-no-launch`, `require-new-launch` | 精确重放如何处理已存在 create；重放永不再次授权 launch |
| `--json` | bool | | | 输出 operation result JSON |

- 例：`ccm task native-attempt-create T7 --selection @/abs/selection.json --attempt @/abs/attempt.json --replay-intent accept-no-launch`
- 精确重放返回既有 attempt、`launch_allowed:false`；同 dispatch key 的冲突 request 一律拒绝。latest attempt 为 `starting|running|uncertain` 时禁止再 create。
- production 路径不接受测试注入的 admission/evidence resolver 冒充 owner 事实。若进程在 board 落盘后、claim commit 前崩溃，只在 stage owner 已消失且 board 已含完全相同 attempt/authority 时回收同一 durable stage；owner 仍存活、缺投影或 identity 漂移时保留现场并 fail-closed。

### task native-attempt-bind

**写（owner-only evidence transaction）**

```
ccm task native-attempt-bind <id> --attempt-id <str> --evidence-record-ref <str> [flags]
```

| flag | 类型 | 必填 | 含义 |
|---|---|---|---|
| `--attempt-id <str>` | string | 是 | 要从 `starting` 绑定到 `running` 的 native attempt id |
| `--evidence-record-ref <str>` | string | 是 | ccm owner-only evidence record ref；不接受 raw response / 调用方自证 JSON |
| `--json` | bool | | 输出 operation result JSON |

- 例：`ccm task native-attempt-bind T7 --attempt-id attempt-1 --evidence-record-ref evidence:bind-1`
- writer 在锁内 stage + verify evidence，应用 engine projection 并持久提交 board 后才 commit consume；engine/lint/conflict/write 失败会 rollback，record/claim 不消费。
- 若进程恰在 board 落盘后、evidence consumption commit 前崩溃，精确重放只凭 board 上相同 evidence ref/hash 恢复同一 stage；不同 record/hash 不能借 stale lock 继续。
- 只有认证 spawn handle 与同 handle 的 authoritative live roster observation 才能投影 `running`；create 时的 `expected_child_target` 从来不是 observation。

### task native-attempt-cancel

**写（记录控制请求；ack 不是 terminal）**

```
ccm task native-attempt-cancel <id> --attempt-id <str> --request <json> [flags]
```

| flag | 类型 | 必填 | 含义 |
|---|---|---|---|
| `--attempt-id <str>` | string | 是 | 当前 `running` native attempt id |
| `--request <json>` | JSON input | 是 | immutable cancel request（`@/abs/file.json`、`-` 或 JSON 字面量） |
| `--acknowledgement-terminal-class <str>` | string | | 负向契约入口；任何用 control acknowledgement 伪造 terminal 的请求都会被拒 |
| `--json` | bool | | 输出 operation result JSON |

- 例：`ccm task native-attempt-cancel T7 --attempt-id attempt-1 --request @/abs/cancel.json`
- request 必须是完整的 `{id,request_hash,requested_at,requested_by_session_ref,control,reason_code}`；`request_hash` 是 `sha256:<64hex>`，时间是 UTC 秒精度，且本 surface 唯一合法的 `control` 是 `"interrupt-agent"`。
- 首次 exact request 记录一个 host-control effect，精确重放为零 effect；acknowledgement 不改变 `running`，后续 terminal 必须另有认证 evidence。

### task native-attempt-terminal

**写（owner-only terminal evidence transaction；不直接 done）**

```
ccm task native-attempt-terminal <id> --attempt-id <str> --evidence-record-ref <str> [flags]
```

| flag | 类型 | 必填 | 含义 |
|---|---|---|---|
| `--attempt-id <str>` | string | 是 | `running|uncertain` native attempt id |
| `--evidence-record-ref <str>` | string | 是 | ccm owner-only terminal evidence record ref |
| `--requested-task-status <str>` | string | | 负向契约入口；请求 terminal 直接写 `done` 会被拒 |
| `--json` | bool | | 输出 operation result JSON |

- 例：`ccm task native-attempt-terminal T7 --attempt-id attempt-1 --evidence-record-ref evidence:terminal-1`
- stage/verify → engine apply → durable board commit → evidence consume；任一失败 rollback 且不消费。成功只记录 immutable terminal、清 handle 并把 task 投影到 `uncertain`；父层独立验收后仍须普通 `task done --verified --artifact`。

### task native-attempt-reconcile

**写（owner-only repair/classification evidence transaction）**

```
ccm task native-attempt-reconcile <id> --attempt-id <str> --evidence-record-ref <str> [flags]
```

| flag | 类型 | 必填 | 含义 |
|---|---|---|---|
| `--attempt-id <str>` | string | 是 | 要 reconcile 的 native attempt id |
| `--evidence-record-ref <str>` | string | 是 | ccm owner-only reconcile evidence record ref |
| `--json` | bool | | 输出 operation result JSON |

- 例：`ccm task native-attempt-reconcile T7 --attempt-id attempt-1 --evidence-record-ref evidence:reconcile-1`
- 只接受认证 evidence 驱动 `uncertain`、same-handle `running`、`terminal` 或完成 fenced orphan audit 后的 `orphaned` projection；调用方不能自选 status/handle。`orphaned` 清 handle 后仍走普通 deps gating，依赖未满足时落 `blocked`，不会绕过依赖门控。
- exact replay 是 no-op；conflicting evidence 拒绝。stage/verify 后仅在 durable board commit 成功时消费，所有失败 rollback/no-consumption。

> **五个 verb 的共同硬边界：**它们是 ledger writer，不是 runtime spawn wrapper。native-active projection 也不能被 generic status/handle writer、legacy `route-bind` 或 `--force` 构造/修复；硬 lint `BIZ-NATIVE-ATTEMPT-PROJECTION` 捕获 projection mismatch。

### task start

**写**

```
ccm task start <id> [<id2> <id3> ...] [flags]
```

- positional：

| 名 | 必填 | 含义 |
|---|---|---|
| `<id>` | 是 | task id（**可给多个**，空格分隔——批量起跑，见下方"批量语义"） |

- 行为：→ `in_flight`·盖 `started_at`
- flags：

| flag | 短名 | 类型 | 含义 |
|---|---|---|---|
| `--log <str>` | | string | 同时追一条 log（批量只追一条，summary 含全部 id） |

- 例：`ccm task start T7` · `ccm task start T7 T8 T9`（批量起跑）

### task done

**写**

```
ccm task done <id> [<id2> <id3> ...] [flags]
```

- positional：

| 名 | 必填 | 含义 |
|---|---|---|
| `<id>` | 是 | task id（**可给多个**，空格分隔——批量完成，见下方"批量语义"） |

- 行为：→ `done`·盖 `finished_at`;写入关卡要求同时带 `--verified` 与非空 `--artifact`,否则 `BIZ-DONE-VERIFIED` hard gate 拒绝落盘(exit 3)
- flags：

| flag | 短名 | 类型 | 含义 |
|---|---|---|---|
| `--artifact <str>` | | string | 产物链接（绝对路径 / URL；批量时对每个 id 一视同仁） |
| `--verified` | | bool | 标记已端点验收（批量时对每个 id 一视同仁） |
| `--review-verdict <enum>` | | enum | `APPROVE, REQUEST-CHANGES`；只用于已声明 `--review-gate APPROVE` 的 task。当前 attempt 的 APPROVE 开门，REQUEST-CHANGES/缺失不开门 |
| `--log <str>` | | string | 同时追一条 log（批量只追一条，summary 含全部 id） |

- 例：`ccm task done T7 --artifact /abs/out.md --verified` · `ccm task done R1 --artifact /abs/review.md --verified --review-verdict REQUEST-CHANGES`（审查执行完成但不开门）· `ccm task done T7 T8 T9 --artifact /abs/out.md --verified`（批量）
- review task 的 `status=done` / `verified=true` 表示 review 工作和报告已完成；审批结论单独写在当前 attempt 的 `review_verdict`。只有精确 `APPROVE` 满足显式 review gate；未声明 gate 却传 `--review-verdict` 会以 exit 3 拒绝且不落盘。`stale|failed|escalated → ready` 开新 attempt 时清旧 verdict；本次 `task done` 不带 `--review-verdict` 也会显式保持 current verdict 缺失，不复用上轮批准。

### task retry

**写**

```
ccm task retry <id> [<id2> <id3> ...] [flags]
```

- positional：

| 名 | 必填 | 含义 |
|---|---|---|
| `<id>` | 是 | task id（**可给多个**，空格分隔——批量开启新 attempt） |

- 行为：仅允许 `stale` / `failed` / `escalated` → `ready`。每个 task 的旧 `started_at` / `finished_at` / `artifact` / `verified` / `review_verdict` / `delivery` 连同来源 status 先以 `ccm/task-retry/v1` 结构归档到 append-only log，再清空当前 attempt 的 `started_at` / `finished_at` / `artifact` / `review_verdict` / `delivery` 并把 `verified` 设为布尔 `false`。归档与复位同一次持锁写入，不能只成功一半。随后写入关卡按同一依赖资格 evaluator 归一：只有 deps 全满足（declared edge `qualified` / legacy edge satisfied）的 task 最终落 `ready`，否则落 `blocked`。human 与 JSON 输出都逐项回显这个 reconcile 后的最终态（批量可同时出现 `blocked` / `ready`）。
- flags：

| flag | 短名 | 类型 | 含义 |
|---|---|---|---|
| `--log <str>` | | string | 在自动归档 log 之外再追一条说明（批量只追一条，summary 含全部 id） |

- 例：`ccm task retry T7` · `ccm task retry T7 T8 T9 --log "上游契约已更新"`
- 非上述三态会报非法转移（exit 3），`--force` 也不会扩大 retry 的来源集合；若 `done` 需要重做，先合法转为 `stale`，再 `retry`。
- 合法的通用 `ccm task set-status <id> ready` 也共享同一归档 + reset，避免旧路径遗留旧证据；面向重跑意图仍优先使用具名 `retry`。

### task attest-delivery

**写**：为当前 true-done attempt 建 candidate binding，并用本地 proof 写一条 target observation。proof 不成立时
exit 3，且在进入写关卡前就拒绝，`--force` 不能把失败 proof 变成交付。

```bash
ccm task attest-delivery <id> --target <target-id> \
  --method git-commit-contained --candidate-commit <commit-or-ref>

ccm task attest-delivery <id> --target <target-id> \
  --method reviewed-reconciliation-contained --candidate-commit <oid> \
  --integration-commit <oid> --attestation /abs/review.json

ccm task attest-delivery <id> --target <target-id> \
  --method artifact-digest-contained --logical-name <name> --artifact-version <immutable-version> \
  --artifact-ref <immutable-ref> --artifact-digest sha256:<64hex>
```

- exact Git：candidate commit 必须本地存在且被冻结 target OID exact containment。
- reviewed reconciliation：integration commit 必须 contained；本地 attestation（≤1 MiB）须 APPROVE，并精确绑定
  candidate fingerprint、target/target OID、integration commit 与 reviewed base。proof 持久化 attestation 的绝对路径与
  exact-byte digest；每次资格求值都会重新读取并复核，文件缺失、内容改变或 binding 漂移均为 unknown/fail-closed。
- artifact：冻结 manifest（≤1 MiB / ≤4096 entries）须含 exact logical-name/version/ref/digest 条目。
- branch/worktree 只定位 repository，不是 proof。命令不 fetch、不调用 provider/harness。
- generic `--set` / `--set-json` 不能写 `delivery`；candidate fingerprint 必须由本命令按当前 attempt 证据重算。

**批量语义（`task start` / `task done` / `task retry` 共用）**：`runWrite` 的写入
关卡是"mutate → 对整块 next 板跑一次 `lintBoard` → 有 hard error 就整体拒绝、不落盘"。逐条独立调用
`ccm task done <id>`（N 次独立进程 = N 次独立 mutate+lint+write）时，只要 board 上**还有其它任务**违反某条
hard 规则（哪怕与本次改的 id 无关），每一次单独调用都会因为**全局其它任务的存量违规**被拒——这正是"批量
45 个 id 只 1 个生效"的死结根因。批量调用（一次传入多个 id）把 N 次独立调用坍缩成**一次**调用：内部对每个
id 依次 `transition` + 覆写字段，但只跑**一次** `lintBoard` + **一次**落盘——只要这一批 id 本身在这次操作
后都变得合规、且 board 上没有**第三方**（不在这批里的）存量违规，就能一次性全部落盘。

- **all-or-nothing**：批量里任意一个 id 转移非法（如仍是 `ready` 没 `start` 就 `done`）或不存在，整批**都不
  落盘**（包括批量里其它本来合法的 id）——没有"部分提交"，`runWrite` 从来没有这个概念。
- **`--force`**：对 start/done 整批统一生效（既有全局语义），越过非法转移 + lint hard error；不支持"这批里第 3 个不
  force、其它 force"这种细粒度控制。
- **`--json` 输出形状**：`data` 从「单任务对象」统一为**数组**（长度恒等于传入 id 数，**含单 id 调用**——
  单 id 时 `data` 是长度为 1 的数组，这是本次改动唯一的向后不兼容点）。
- 若 board 上还有本批之外的第三方违规 task，批量 verb 不解决那个更大的问题——那仍需 `--force` 或把那些 id
  也纳入本次批量调用。

### task block

**写**

```
ccm task block <id> --on <str> [flags]
```

- positional：

| 名 | 必填 | 含义 |
|---|---|---|
| `<id>` | 是 | task id |

- 行为：→ `blocked`·设 `blocked_on`
- flags：

| flag | 短名 | 类型 | 必填 | 含义 |
|---|---|---|---|---|
| `--on <str>` | | string | 是 | 阻塞源：`user` 或某 task id |
| `--decision <str\|@file>` | | string/@file/`-` | `--on user` 时必给 | decision_package |
| `--log <str>` | | string | | 同时追一条 log |

- 例：`ccm task block T7 --on T2` · `ccm task block T9 --on user --decision @/abs/decision.json`

### task unblock

**写**

```
ccm task unblock <id> [flags]
```

- positional：

| 名 | 必填 | 含义 |
|---|---|---|
| `<id>` | 是 | task id |

- 行为：清除 `blocked_on`（+ 附属 `decision_package`）语义阻塞标记，**不直接定 status**——交回写入关卡的 `reconcileGating` 按 deps 满足度归一（deps 全满足→`ready`，否则→`blocked`）。这是 `task block` 的解除侧、也是「不该手 `set-status` 解 deps 阻塞」的正解。
- flags：

| flag | 短名 | 类型 | 必填 | 含义 |
|---|---|---|---|---|
| `--log <str>` | | string | | 同时追一条 log |

- 例：`ccm task unblock T7`

### task set-status

**写**

```
ccm task set-status <id> <status> [flags]
```

- positional：

| 名 | 必填 | 含义 |
|---|---|---|
| `<id>` | 是 | task id |
| `<status>` | 是 | 目标 status |

- flags：仅 global flags（如 `--force` 越非法转移闸、`--log`）
- 例：`ccm task set-status T7 escalated` · `ccm task set-status T7 done --force`
- 补充：合法的 `stale` / `failed` / `escalated` → `ready` 会共享 `task retry` 的证据归档与 attempt reset；表达重跑意图时优先用具名 `task retry`。

### task rm

**写**（破坏性·非 TTY 须 `--yes`）

```
ccm task rm <id> [flags]
```

- positional：

| 名 | 必填 | 含义 |
|---|---|---|
| `<id>` | 是 | task id |

- flags：仅 global flags（破坏性确认用 `--yes`）
- 例：`ccm task rm T7 --yes`

---

<!-- ccm:k:end point:ccm.cmd.task -->

## 失效类型

`environment_fact`（主体：事实方法） —— 删了这条知识，agent 不知道 ccm task 当下有哪些命令、每个命令的 flag 是什么、怎么组合参数。这不是「概念不知」而是「CLI 易腐事实不知」。

task 各 verb 的 flag、状态机合法转移、native-attempt 契约与批量 lint 语义是本工具的具体接口与机制事实。
