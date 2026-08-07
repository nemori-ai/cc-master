---
point: ccm.cmd.task
---

## 权威陈述

<!-- ccm:k:start point:ccm.cmd.task -->
## namespace task

**语法 / positional / 例一律以 `ccm <namespace> <verb> --help` 为准**（本节曾逐条复制它们，已交还——副本天然会过期）。下面只留 help 不说的：在这个 verb 上有额外语义的 flag、语义边界、跨 verb 规则。

任务：增删改查 + 状态机（DAG 节点）。

**语法 / positional / flags / 例一律以 `ccm task <verb> --help` 为准**（本节曾逐条复制它们，已交还——副本天然会过期）。下面只留 help 不说的：各 verb 的语义边界、跨 verb 的批量与投影规则、以及「这个专用 writer 为什么不能用 generic setter 代替」这类判断。

### task add

**写**

- external issue closed 但未端点验收：`ccm task set-status EXT3 uncertain`；验收外部 PR 后才：`ccm task done EXT3 --verified --artifact https://github.com/o/r/pull/12`

### task show

**读**

### task list

**读**（别名 `ccm ls` / `ccm task ls`）

### task update

**写**

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

### task set-routing

**写（dedicated policy writer；不 selection / 不 spawn）**

```text
ccm task set-routing <id> --policy <json|@file|-> [--json]
```

- `--policy` 必填：provider-neutral policy JSON，含 `objective`、`constraints`、`candidates[]`、`chains.ample/tight` 与 `fallback`；精确字段与闭合 fallback classes 见 board-model-guide §C.5。
- writer 包装成 `ccm/agent-routing/v1` + `mode:"cross-harness"` + `selected:null` + `attempts:[]`，并与已有 planning 做 capability/effect/permission 交叉校验。
- 一旦已有 selection 或 attempt history，policy 不可替换；`attempts[]` append-only。generic setter / `--force` 不能覆盖。
- 命令不读取 provider、不选择 candidate、不 reserve、不 spawn、不 fallback。

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

### task native-attempt-create

**写（精确 Codex native-attempt ledger contract；不调用 host tool）**

当前 native invoke runtime 为 `unsupported`：四 host strategy 都不投影 invoke artifact。此命令只在 opt-in board 上，从 `$CC_MASTER_HOME/native-attempt/v1/` 的 owner-only production store 读取已提交且未过期的 reservation/ticket，核对 canonical launch identity，原子 stage 唯一 claim、冻结 immutable create snapshot、持久提交 board 后再 commit claim。`launch_allowed:true` 只属于该精确 identity/claim；命令本身不 spawn，当前也没有 host adapter 消费它。

| flag | 类型 | 必填 | enum 取值 | 含义 |
|---|---|---|---|---|
| `--selection <json>` | JSON input | 是 | | 完整 qualified selection snapshot（`@/abs/file.json`、`-` 或 JSON 字面量） |
| `--attempt <json>` | JSON input | 是 | | `starting` native attempt + immutable dispatch/lineage/request snapshot |
| `--replay-intent <enum>` | enum | 是 | `accept-no-launch`, `require-new-launch` | 精确重放如何处理已存在 create；重放永不再次授权 launch |
| `--json` | bool | | | 输出 operation result JSON |

- 精确重放返回既有 attempt、`launch_allowed:false`；同 dispatch key 的冲突 request 一律拒绝。latest attempt 为 `starting|running|uncertain` 时禁止再 create。
- production 路径不接受测试注入的 admission/evidence resolver 冒充 owner 事实。若进程在 board 落盘后、claim commit 前崩溃，只在 stage owner 已消失且 board 已含完全相同 attempt/authority 时回收同一 durable stage；owner 仍存活、缺投影或 identity 漂移时保留现场并 fail-closed。

### task native-attempt-bind

**写（owner-only evidence transaction）**

| flag | 类型 | 必填 | 含义 |
|---|---|---|---|
| `--attempt-id <str>` | string | 是 | 要从 `starting` 绑定到 `running` 的 native attempt id |
| `--evidence-record-ref <str>` | string | 是 | ccm owner-only evidence record ref；不接受 raw response / 调用方自证 JSON |
| `--json` | bool | | 输出 operation result JSON |

- writer 在锁内 stage + verify evidence，应用 engine projection 并持久提交 board 后才 commit consume；engine/lint/conflict/write 失败会 rollback，record/claim 不消费。
- 若进程恰在 board 落盘后、evidence consumption commit 前崩溃，精确重放只凭 board 上相同 evidence ref/hash 恢复同一 stage；不同 record/hash 不能借 stale lock 继续。
- 只有认证 spawn handle 与同 handle 的 authoritative live roster observation 才能投影 `running`；create 时的 `expected_child_target` 从来不是 observation。

### task native-attempt-cancel

**写（记录控制请求；ack 不是 terminal）**

| flag | 类型 | 必填 | 含义 |
|---|---|---|---|
| `--attempt-id <str>` | string | 是 | 当前 `running` native attempt id |
| `--request <json>` | JSON input | 是 | immutable cancel request（`@/abs/file.json`、`-` 或 JSON 字面量） |
| `--acknowledgement-terminal-class <str>` | string | | 负向契约入口；任何用 control acknowledgement 伪造 terminal 的请求都会被拒 |
| `--json` | bool | | 输出 operation result JSON |

- request 必须是完整的 `{id,request_hash,requested_at,requested_by_session_ref,control,reason_code}`；`request_hash` 是 `sha256:<64hex>`，时间是 UTC 秒精度，且本 surface 唯一合法的 `control` 是 `"interrupt-agent"`。
- 首次 exact request 记录一个 host-control effect，精确重放为零 effect；acknowledgement 不改变 `running`，后续 terminal 必须另有认证 evidence。

### task native-attempt-terminal

**写（owner-only terminal evidence transaction；不直接 done）**

| flag | 类型 | 必填 | 含义 |
|---|---|---|---|
| `--attempt-id <str>` | string | 是 | `running|uncertain` native attempt id |
| `--evidence-record-ref <str>` | string | 是 | ccm owner-only terminal evidence record ref |
| `--requested-task-status <str>` | string | | 负向契约入口；请求 terminal 直接写 `done` 会被拒 |
| `--json` | bool | | 输出 operation result JSON |

- stage/verify → engine apply → durable board commit → evidence consume；任一失败 rollback 且不消费。成功只记录 immutable terminal、清 handle 并把 task 投影到 `uncertain`；父层独立验收后仍须普通 `task done --verified --artifact`。

### task native-attempt-reconcile

**写（owner-only repair/classification evidence transaction）**

| flag | 类型 | 必填 | 含义 |
|---|---|---|---|
| `--attempt-id <str>` | string | 是 | 要 reconcile 的 native attempt id |
| `--evidence-record-ref <str>` | string | 是 | ccm owner-only reconcile evidence record ref |
| `--json` | bool | | 输出 operation result JSON |

- 只接受认证 evidence 驱动 `uncertain`、same-handle `running`、`terminal` 或完成 fenced orphan audit 后的 `orphaned` projection；调用方不能自选 status/handle。`orphaned` 清 handle 后仍走普通 deps gating，依赖未满足时落 `blocked`，不会绕过依赖门控。
- exact replay 是 no-op；conflicting evidence 拒绝。stage/verify 后仅在 durable board commit 成功时消费，所有失败 rollback/no-consumption。

> **五个 verb 的共同硬边界：**它们是 ledger writer，不是 runtime spawn wrapper。native-active projection 也不能被 generic status/handle writer、legacy `route-bind` 或 `--force` 构造/修复；硬 lint `BIZ-NATIVE-ATTEMPT-PROJECTION` 捕获 projection mismatch。

### task start

**写**

- 行为：→ `in_flight`·盖 `started_at`

### task done

**写**

- 行为：→ `done`·盖 `finished_at`。真完成语义（`--verified` + 非空 `--artifact`）与 review verdict 规则见 `ccm task done --help`。

### task retry

**写**

- 行为：仅允许 `stale` / `failed` / `escalated` → `ready`。归档进 append-only log 的 attempt 证据含 `started_at` / `finished_at` / `artifact` / `verified` / `review_verdict` / `delivery`；复位后按依赖资格归一——**deps 全满足**落 `ready`，否则落 `blocked`。归档 + 复位 + 归一的精确顺序与原子性见 `ccm task retry --help`。

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

- 行为：→ `blocked`·设 `blocked_on`

### task unblock

**写**

- 行为：清 `blocked_on` 后交回 deps 门控定 status，见 `ccm task unblock --help`。

### task set-status

**写**

- flags：仅 global flags（如 `--force` 越非法转移闸、`--log`）
- 补充：合法的 `stale` / `failed` / `escalated` → `ready` 会共享 `task retry` 的证据归档与 attempt reset；表达重跑意图时优先用具名 `task retry`。

### task rm

**写**（破坏性·非 TTY 须 `--yes`）

- flags：仅 global flags（破坏性确认用 `--yes`）

---

<!-- ccm:k:end point:ccm.cmd.task -->

## 失效类型

`environment_fact`（主体：事实方法） —— 删了这条知识，agent 不知道 ccm task 当下有哪些命令、每个命令的 flag 是什么、怎么组合参数。这不是「概念不知」而是「CLI 易腐事实不知」。

task 各 verb 的 flag、状态机合法转移、native-attempt 契约与批量 lint 语义是本工具的具体接口与机制事实。
