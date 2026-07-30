---
point: ccm.cmd.worker-quota
---

## 权威陈述

<!-- ccm:k:start point:ccm.cmd.worker-quota -->
## namespace worker（raw transport + tracked dispatch）

### worker help

```text
ccm worker help --harness <codex|claude-code|cursor-agent|kimi-code> [--scope <agent|root>]
```

resolver 使用与 `run` 相同的 executable resolution，显示最终选中的本机真实 agent command 的真实 help；
这才是 agent 组装 provider argv 的当下入口。`--scope` 的 `agent` 是默认值，显示 descriptor 定义的
agent command help；`root` 显示该 executable 的 root/global help，供调用者确认必须放在 agent 子命令
之前的全局 flags。`ccm worker run --help` 只显示 ccm 自己的 wrapper help，不转发 provider help。`worker help` 把真实
child stdout / stderr 原样写回相应 stream，并对 provider exit 作 mirror；它的固定 timeout 为 10000 ms、
stdout 上限 536870912 bytes、stderr 上限 536870912 bytes。unknown harness 在进入 provider resolver 前作为 usage error 拒绝。

### worker run

```text
ccm worker run --harness <codex|claude-code|cursor-agent|kimi-code> [--cwd <path>] [--timeout-ms <n>] [--max-output-bytes <n>] -- <provider argv...>
```

- `--` 是 ccm lifecycle options 与 provider argv 的硬边界；其后必须是调用者组装的**完整 provider argv**，
  ccm 逐项原样转发，绝不自动拼接任何 command prefix。Codex 调用者需要按真实 help 自己包含 `exec`，并把
  root/global flags 放在 provider 要求的位置。ccm 不解析、补写或规范化 provider 的 model、effort、
  permission、sandbox、prompt 或 output flags。
- **写文件 / 改代码的 worker 必须由你在 provider argv 里显式放开沙箱 / 审批闸。** harness CLI headless 默认常把 worker 关进只读沙箱或审批闸（如 `codex exec` 默认只读），你不放开它就只拿到一个改不动盘的 worker；ccm 只逐项透传、绝不替你注入任何沙箱或审批 flag（见上一条），所以放开与否只由你组装 argv 时定。先跑 `worker help` 核对本机版本，再照它组装。各 harness 放开写入的标志：
  - **codex**（`--harness codex`）：`codex exec` 默认 `--sandbox read-only`，写不了盘。放开写入传 `--sandbox workspace-write`（可写 cwd/workspace；另需可写目录用 `--add-dir <绝对目录>` 扩展）；要连审批一起全放开传 `--sandbox danger-full-access` 或 `--dangerously-bypass-approvals-and-sandbox`（危险，仅在外层已隔离时用）。
  - **cursor-agent**（`--harness cursor-agent`）：headless 用 `-p/--print`（本身能用 write/shell 工具，但命令受审批闸）。传 `-f/--force`（等价 `--yolo`）自动放行命令（除非被显式拒），才让它真正写盘；若 sandbox 模式开着再传 `--sandbox disabled` 关掉。别传 `--mode plan` / `--mode ask`（都是只读）。
  - **claude-code**（`--harness claude-code`）：没有只读沙箱，但有权限闸——headless `-p/--print` 下写类工具默认被权限检查挡。放开写入传 `--permission-mode acceptEdits`（接受文件编辑），或全绕过传 `--dangerously-skip-permissions`。
  - **kimi-code**（`--harness kimi-code`）：`-p/--prompt '<...>'` 单发本身即以非交互模式自动执行工具（含写文件），无需额外放开标志。**绝不**给 `-p` 叠 `-y/--yolo` 或 `--auto`——两者与 `-p` 互斥、会直接 exit 1 失败、不产出任何文件。
- stdin 无条件原样转发给 child。`--cwd` 必须是 absolute、existing directory（绝对、存在的目录），缺省为
  `process.cwd()`；结果里的 cwd 是解析后的真实路径。
- `--timeout-ms` 允许 50..7200000（最长 2 小时），`run` 默认 600000；`worker help` 使用固定 10000 timeout。默认给真实 agent 派发足够跑完的预算，省略时不会在两分钟处误杀长任务。
  `--max-output-bytes` 允许 256..536870912，默认 536870912，并分别约束 stdout 与 stderr（stderr 另有独立上限 536870912）。上限足够容纳大输出（如 codex 的 blueprint/state，或其动辄几十 MB 的 stderr 诊断流），不会在 1 MiB / 32 MiB 处截断并 kill 长任务。
- `run` 是无 `--json` 分叉的显式例外：它始终把 ccm 通用成功信封写到 stdout，其中 `data.schema` 固定为
  `ccm/worker-process-result/v1`。承重字段完整固定为 `schema`、`harness`、`state`、`executable`、`argv`、
  `cwd`、`stdout`、`stderr`、`stdout_bytes`、`stderr_bytes`、`truncated`、`timed_out`、`cancelled`、
  `signal`、`exit_code`、`reaped`、`duration_ms`、`cleanup`、`error`；`state` 只取 `exited`、
  `timed_out`、`cancelled`、`failed`、`rejected`。它只报告 process terminal；ccm 不解析 provider terminal，
  也不判断任务是否成功。
- provider 非零退出仍返回上述 envelope；当 `state:exited` 且 exit code 为 0..255 时，wrapper 以同一 exit
  code 结束。SIGHUP / SIGINT / SIGTERM 分别 mirror 为 129 / 130 / 143；其它 signal、timeout、rejection
  或内部 failure 返回 1。origin signal 触发的 cancel 同样 mirror 对应 signal exit。
- `run` 的 unknown harness 会进入 handler 并返回同一 schema 的 structured rejected envelope
  （`state:rejected`）；`help` 的 unknown harness 则是 usage error。两者有意不同，确保调用者对每次 run
  都只消费一种 terminal 合同。
- ccm 不自动 route、fallback、切换账号、登录或选择模型；调用方依据真实 help 显式给出 provider argv。
  provider 仍可能通过继承的环境与 `HOME`/XDG 路径读写自己的状态，因此 raw wrapper 不提供 safe、
  read-only、credential-zero-write 或 automatic-eligibility 声明。
- 命令同步等待 child terminal，并管理 timeout、cancel、输出上限与自己创建的 process tree；它不跨
  parent exit、handoff 或 ccm update 存活。launcher 关闭后若留下一个短命的 owned helper（cursor-agent 曾见），会给它一个宽裕的 reap 窗口自然退出并保留完整 transcript。Cursor 若只剩已识别的持久 service tree——已解析版本目录下精确的 `node index.js worker-server`，可带 Cursor 为它启动且严格绑定当前 home npm cache 的 `typescript-language-server --stdio` 服务链——则把这些 provider service 排除出本次 request ownership；worker-server 缺席、进程枚举失败、空快照、混有任一其它成员或任一非上述签名的存活树都继续 fail-closed（TERM→KILL + `owned_tree_survived`）。该 reap 窗口默认 5000 ms，可用环境变量 `CCM_WORKER_REAP_TIMEOUT_MS`（100..60000）在慢机器上放宽。
- 要把它用于长时后台 worker，必须由 origin harness 的后台 terminal / Shell 机制包住本命令；可 recon handle 是该 origin 机制返回的 job/session/process handle。最终 `ccm/worker-process-result/v1` 是 terminal 结果，不是 running handle，也不能倒推出 provider task acceptance。

### worker dispatch

```text
ccm worker dispatch [--board <path>] --harness <codex|claude-code|cursor-agent|kimi-code> --task <task-id> --idempotency-key <key> --intent <safe-summary> [--cwd <path>] [--timeout-ms <n>] [--max-output-bytes <n>] [--transcript <absolute-path>] -- <provider argv...>
```

- `dispatch` 复用 `run` 的 provider resolver、argv/stdin/cwd 透传、超时/输出上限和 owned process-tree supervisor，但**不是 detach**：命令同步监督到 terminal 才返回。要让 shell 调用本身后台化，仍由 origin harness 的后台 terminal/Shell 机制承载；ccm 不伪造 durable job。
- `--task` 必须指向所选 board 的现有 task；它只产生 `agents[].links[]`，**绝不**改 task 的 `status`、`handle`、`routing.attempts` 或 `acceptance`。`--intent` 会持久化，必须是安全、非敏感摘要。
- `--idempotency-key` 必填。首次调用在 board lock 内 `prepare` 再唯一 `claim`；同 key + 同 request digest 精确 replay，不再 spawn；同 key + 不同 digest 硬冲突。digest 只覆盖非敏感结构：harness/task/canonical cwd/timeout/output ceiling/stdin mode/provider argv 数量；prompt、argv 内容、stdin 与 environment 既不落 board，也不哈希进可持久的 digest。业务幂等语义完全由调用方显式 key 承担；换了语义请求就必须换 key。
- `--transcript` 可显式登记一个已存在、可读的绝对 transcript 路径；它是有意 board-visible 的只读 stream 证据，也进入 request digest。显式路径优先于 Cursor 的 `CURSOR_TRANSCRIPT_PATH`；两者都复用 agent viewer 既有的 transcript locator，Cursor 以 `raw` 事件 tail。两者都没有或不可读时，Cursor roster/detail 与 task join 仍完整保留，stream 诚实返回 `source.kind="none"`，不伪造 transcript。
- 状态机是 `prepared → launch-claimed → bound → closing → closed`，异常分支为 `reconciliation-required`。spawn 后只接受运行时返回的真实正 PID；PID evidence、`lifecycle:running` 与 agent-side task link 在同一次 board lock mutation 内落盘。任何“running 但无真实 PID evidence”的记录都会被 aggregate 拒绝。
- claim 已成功但 PID 尚未绑定时 launcher 崩溃，下一次 replay 只会落 `reconciliation-required / ambiguous-launch`，**绝不自动重发**。PID bind 写失败时 supervisor 会取消并 reap 自己拥有的完整 process tree；live terminal 与已持久化 `closing` replay 的 terminal tracking 都走同一套有界重试 + durable reconciliation fallback，仍失败则 tracking failure 胜过 worker exit 0，且 receipt 只声称最新真正落盘的 phase/reconciliation 状态。
- 四个 harness 都保证 PID tracking。只在现有实证允许时单调升级身份：Codex 仅在调用方声明 `--json` transport 时从 JSONL `thread.started.thread_id` 升 `session-id`，可定位 `rollout-*-<sid>.jsonl`，attach 为 `codex resume <sid>`；Kimi 仅在 `--output-format stream-json` 时从 `session.resume_hint.session_id` 升级，可定位 `sessions/.../<sid>/agents/main/wire.jsonl`，attach 为 `kimi -S <sid>`；Claude Code 可从显式 `--session-id` 立即取得身份，或仅在 `--output-format json|stream-json` 时从严格的 `type=result / session_id` 信封取得身份，再定位 `projects/.../<sid>.jsonl`，attach 为 `claude --resume <sid>`。它们都不从任意模型文本猜 session id。Exact attach 的 cwd/argv 只在本次 CLI receipt 与聚合校验期间短暂存在；board 只保存 typed `{kind:"session-resume"}` 能力类，不保存 argv。Cursor native identity / SQLite transcript / exact attach 仍为未证实能力；外部 transcript 路径只提供 raw stream，不伪造 Cursor session identity。`unavailable` 明确表示「能力受支持，但本次尚未观察/定位到值」，绝不用空串冒充。
- capability evidence 使用偏序而非总序：只有 `unavailable ≤ supported(同一 canonical value)`；`supported → unavailable` 保留已落盘 canonical value，重复同值幂等。`unsupported` 是「能力不支持」的负声明，与 `unavailable` / `supported` 都不可比；`unsupported ↔ unavailable`、`unsupported ↔ supported` 一律 `evidence_conflict` 并由 repository 持久化 `reconciliation-required`，不覆盖旧证据。同 session 的不同 transcript 绝对路径或不同 canonical attach cwd/argv 同样冲突；attach 原文完成比较后立即丢弃，仍不落 board。相同 degraded status 的 reason 只是诊断文本，不是证据身份，重复时保留首个 durable reason。
- board 只持久化安全生命周期事实：key/digest/phase、PID/session evidence、typed capability、terminal exit/signal/error code/reaped。它不持久化 prompt、stdin、secret、environment、完整 provider argv 或 provider output。命令仍以 `ccm/tracked-worker-dispatch-result/v1` 返回本次 worker terminal envelope；exact replay 不可能重放未持久化的 provider output。
- agent `closed/terminal` 只说明 worker 进程生命周期收口，**不等于 task done，也不证明 parent acceptance**。消费者验收 result/artifact 后，才可经 task 自己的专属命令推进。

---

## namespace provider（facts + candidate inspect）

### provider facts

**读；零 live probe**

```
ccm provider facts <provider> [--as-of <UTC>] [--json]
```

- `<provider>`：`claude-code | codex | cursor | kimi-code`。
- 行为：返回 `ccm/provider-model-facts/v1` snapshot，必带 `source`、`observed_at`、`valid_until`、`account_scope`、`confidence`、`unknown`、`models`、`freshness`、`catalog_eligible_for_admission_check`、`eligible_for_automatic_selection` 与 `automatic_selection_blockers`。它不访问 provider、不证明 live entitlement / quota / exact admission，所以静态 snapshot 的 automatic-selection eligibility 保持 false。
- Cursor 的每个 `models[]` 条目另带 `quota_pool:"first_party"|"usage_based"`，用于把 model route 绑定到对应独立池；该静态映射仍不证明 live entitlement 或 headroom。
- `--as-of`：冻结 freshness 求值时间；缺省当前 UTC。`future-invalid` / `hard-stale` 仍 exit 0 可解释，但连 admission check 都不准入；fresh 只允许进入下一道 live admission。
- 例：`ccm provider facts codex --json` · `ccm provider facts cursor --as-of 2026-07-15T12:00:00Z --json`。

### provider inspect

`ccm provider inspect codex --request @request.json --json` 是独立的 candidate inspection / gated execution 面；不要拿 facts snapshot 冒充它的 live admission。

---

## namespace model-policy（统一模型角色与排序 advisory）

### model-policy show

```text
ccm model-policy show --task <task-taxonomy> [--as-of <UTC>] [--json]
```

- `--task` 必填，取项目 registry 中的稳定 taxonomy，例如 `architecture-design`、`implementation-from-spec`、`routine-heterogeneous-review`、`repository-code-research`、`mechanical-deterministic-work`。
- 输出 `ccm/model-policy-read-model/v1`。`hard_facts` 是官方 provider snapshot，`project_role_evidence` 是项目角色候选 / blockers，`community_advisory` 是带 provenance、TTL、confidence、contradictions 与 freshness 的 taste ledger；三层不可互相补证。
- O 候选、T1/T2/T3 候选只是跨 provider 候选发现。`eligible_for_automatic_selection:false` 会一直保持，直到调用者另行取得精确 target 的 role certification 与 live admission；本命令零 provider probe、零 board 写入。
- Cursor first-party 与 third-party-model route 分开。第三方 Fable / Sol 路线因 payer / paid-use 未明确而列入 `excluded_automatic_routes`，不得静默进入 first-party fallback。

### model-policy advise

```text
ccm model-policy advise --input <json|@file|-> [--as-of <UTC>] [--json]
```

输入是 `ccm/model-policy-advice-request/v1`：调用者必须为每个 candidate 提供已认证 role grades、exact selector / live admission / quota / permission / workspace / paid-use / retention 硬门、归一化的 cost / quota-headroom / latency / context-fit / integration 分数，以及可选 community affinity envelope。

输出 `ccm/model-policy-advice/v1`，机械顺序固定为：effect floor 与 target 硬门 → 按 posture 加权基础分 → 只在基础分等价带内应用有上限且会衰减的 community tie-break。stale、mixed、unknown 或无 evidence refs 的 affinity 归零；hard deny 进入 `rejected[].reason_codes`。命令只排序输入，不现场 qualification、不选择 CLI flags、不 reserve、不 spawn、不写 board。

`--role`、`--taxonomy`、`--require` 不是该命令的 flag；不要把资格条件临时拼成 CLI 参数。先构造上述 request schema，再通过 `--input` 提交；实时语法以 `ccm model-policy advise --help` 为准。

---

## namespace orchestrator（cached context）

### orchestrator context

```bash
ccm orchestrator context --cached-only [--agent-visible] [--snapshot <json|@file|->] --as-of <UTC> \
  --harness <origin> [--board <path>] [--json]
```

只读显式 cache，绝不 live probe。`--cached-only`、`--as-of`、`--harness` 必填；snapshot
缺失/坏 JSON 时 exit 0，返回 `available:false`、`freshness.state:"unknown"` 和 warning，绝不
隐式刷新。board revision 由当前 board canonical content 的 SHA-256 导出，不是手填字段。
这里的 canonical 是递归 key-sort 后的 parsed JSON；只改 key 顺序不改 revision。所有时间须为
可精确 round-trip 的 canonical UTC，非法日期/闰日不会被 runtime 归一化后放行。公开 context
只投影 allowlist 字段，递归 secret/private-shaped key 及高信号 credential/token-shaped value
都会被无回显拒绝；普通 token budget / credential unavailable 文案不误伤。输出确定性限制在
4096 UTF-8 bytes 内，并用 `truncation` 显式报告缩短/省略数量。

加 `--agent-visible` 时，ccm 进一步把 raw context 与当前板上最多 12 个合约化 `ready`
task 的 pure-shadow route advice 合成 `ccm/origin-context-delivery/v1`。完整 `content` 是
`<ambient source="orchestrator-context">`，仍受 4096 UTF-8 bytes 硬上限；资格 `ref`、路径、
任意 warning 文本、model/provider 私有信息均不进入投影。delivery 明示 `shadow_only:true`、
`dispatch_enabled:false`，只供 Claude Code / Codex / Cursor origin adapter 注入上下文；它不
reserve、不 spawn、不写 attempt/board。三路只允许 `origin_harness` 与 same/other 描述标签差异，
同 harness CLI 仍为 `cli-headless`。

## namespace route（shadow advisory）

### route advise

```bash
ccm route advise <task-id> --context <json|@file|-> --origin <harness> --as-of <UTC> \
  [--board <path>] [--json]
```

只读 planned task 与 `ccm/orchestrator-context/v1`，沿该 task 明示的 ample/tight chain 给建议。
context origin 必须等于 `--origin`；`available:false`、unknown/stale/revision mismatch 均 fail closed
为 no-route。advice 会按自己的 `--as-of` 重算 freshness，旧的 fresh context 过期后不能 replay。
同 harness CLI 保持 `cli-headless`，不会折叠为 native；品牌/crossness 不参与排序。该命令不
reserve、不 spawn、不建 attempt、不写 board。

---

## namespace quota（live admission authority）

这组命令是 cross-harness dispatch 的 provider-neutral 本地 quota authority seam。它不登录、登出、切号、
复制或写入 Codex/Cursor credential，也不直接调用 provider/model 或启动 worker。每个 provider rule 明示
承重 window；Codex 的 5h window 已退役，只有 Codex rule 会过滤 5h 并以同 payer+pool 的 fresh 7d
observation 作 hard gate。rolling 24h 只给风险 advisory，不把 ample 硬改成 deny。

### quota status

```bash
ccm quota status [--machine-wide] [--refresh] [--home <dir>] [--json]
ccm quota status --machine-wide --refresh --json
```

不带 `--machine-wide` 时读取 owner-only quota store。空 store 也 exit 0，并在通用成功信封的 `data` 中诚实返回
`{schema:"ccm/quota-status/v1",available:false}`；missing 绝不折算成 ample，`available:true` 也只证明 store 可读。

带 `--machine-wide` 时默认读取所有受支持 target scope 的本机**缓存**投影，exit 0，并直接返回根 schema
`ccm/machine-quota-status/v1`（不套通用 `{ok,data}` 信封）。默认不调用 provider collector；加 `--refresh`
则先通过同一组 per-harness live collector 对每个 target 作 best-effort 采集、填充 observation 缓存，再返回同一
status schema，所以冷缓存无需 monitor daemon 也不会永久全 unknown。该 flag 会初始化 home salt 并写 observation
缓存，不是纯缓存读取；单个 target 采集/持久化失败不伪造成功事实，仍以 unknown/error posture 诚实返回。用
`summary.decisions[]` 的精确 `target.harness_id + target.surface_id + target.window` 绑定候选。`state`、
`freshness`、`reason_codes[]` 与 `fanout_covered` 都是承重事实；unknown / stale / missing 不能解释为 ample。
`readings[]` 在 unavailable / expired 时可带 `refresh_hint.{reason,recoverable,command,remedy,recheck,agent_authorized,authorization}`；只有 `agent_authorized:true` 才表示 agent 可按边界执行 command。Claude 另投影独立的 `claude-fable-*-cli + seven_day`；Codex 只投影 `codex-cli + seven_day`；Cursor 每个 surface 都分别投影 first-party `billing_period` 与 usage-based `billing_period_usage_based`，两池不互补，任一 surface 的信号也不能补齐另一条；Kimi Code 投影
`kimi-cli + five_hour` 与 `kimi-cli + seven_day`，由 `kimi-usages-api` 读取当前登录态，过期 stored OAuth 可先带锁自动刷新。

### quota refresh

```bash
ccm quota refresh --machine-wide [--home <dir>] [--json]
```

这是显式的 machine-wide **live producer**：刷新所有受支持 target、发布本机投影并把 posture edge fan-out
给已订阅 session；缺 `--machine-wide` 是用法错误。它会调用 provider collector 并写本机 quota / notification
状态，因而不属于普通只读巡检热路径。默认先用 `quota status --machine-wide` 读缓存；只有调用方明确需要刷新、
接受其 provider 与写入副作用时才运行本命令。JSON 根是 `ccm/machine-quota-refresh/v1`，同样不套通用信封。

### quota preflight

```bash
ccm quota preflight --input <json|@file|-> [--json]
```

admission 输入只接受 `source_key`、`reservation_id`、`checked_at` 这类 authority reference；命令从
owner-only observation/reservation store 读取 policy、effect、provider-rule hard-window buckets、source revision、committed
ticket digest 与 run lineage 后重验，caller 自给的 `live` / `policy` / `effect` 结论不产生授权。
unknown / empty / tight / hard-stale / observation conflict / identity conflict / invalid commit 均返回
`automatic_spawn_limit:0`。带 `requested_effect` 的 lifecycle deny 仍是零副作用纯机械判定；
Codex/Cursor 的 account/session/credential/auth mutation request 固定 deny，effect count 为 0。
它不以 harness id 主动抓取剩余额度、不创建 authority observation/reservation；没有既存 authority refs 就没有可重验的 allow。

### quota reserve

```bash
ccm quota reserve --input <json|@file|-> [--home <dir>] [--json]
```

请求必须是闭合 `ccm/quota-reservation-request/v1`，带明确 `checked_at`，amount 为 positive finite，且只能创建 `held`；
caller 不能自铸 `committed`，也不能自铸 capacity/headroom/request hash。命令从 owner-only observation
authority 重验 source/account/pool/identity 与 hard-window buckets，并按 source profile 的 fresh/hard TTL、
`observed_at`、`valid_until`、reset 与 clock skew 在每次读取时重算 freshness；持久化的 `freshness:"fresh"`
不能授权过期 evidence。caller 给出的 capacity 必须与锁内推导
完全一致，否则 typed deny。Codex policy/provider-rule revision 必须是受支持的 7d pairing，所有承重百分比
严格落在 finite `0..100`；未知 revision、越界 ceiling/usage/margin/amount 都在 hold 前 fail closed。request
hash 由 store 对完整承重 binding canonical 计算；idempotency key 由 machine-scope lock + durable index 统一
寻址，同 canonical hash 即使换 provisional ID 也复用原 receipt，变更 aggregation/attempt/candidate/source/
account/pool/identity 即冲突；reservation ID 在本机 authority scope 全局唯一。multi-bucket 先发布 recoverable
transaction coordinator，只有 committed
journal 才让所有 legs 同时成为 authority；lookup、audit、expiry、release 也以该 journal 为唯一 authority，
projection 只可重建，crash/retry 不暴露 split state，任一不 fit 时全部写入 0。`held -> committed` 是
supervisor/runtime composition 的内部 transition：写入
ticket digest 与 attempt/run/account/pool/identity/aggregation/source/expiry lineage，不由 public reserve
输入控制。该命令只保留本地容量，不声称 provider 已预留或退款。

### quota audit

```bash
ccm quota audit --input <json|@file|-> [--home <dir>] [--json]
```

用 launch/process evidence 审计 reservation。只有 store locked/readable、claim absent、process identity
proven-absent 且 TTL 已到才能把 held 判为 expired；`committed` 即使 claim absent 或墙钟已过也只能
orphan-audit 并继续计入容量。terminal/finalization proof 必须用闭合 schema 绑定 reservation ID/request hash、
attempt、run、ticket digest、连续 terminal journal revision、proven-dead process identity 与 cleanup/evidence
retention；任意非空对象、partial/mismatch/conflict proof 都不能释放容量。manager/session 消失、mtime 或
PID-not-found 单独都不能释放。managed
lock owner 记录 boot ID、process-start identity 与 nonce；只有平台证据可证明 stale 时才 journaled
recovery，不可证明就保持 `QUOTA_LOCK_BUSY`。multi-key transition 由 coordinator 一次发布全部 legs；
`expired|released` 是单调 terminal，重试不得新增 event、复活 reservation 或重新占用容量；single-key
transition 在 event durable、snapshot publish 前 crash 时，terminal retry 会先从 event authority 修复 stale
projection 再返回。

---

<!-- ccm:k:end point:ccm.cmd.worker-quota -->
