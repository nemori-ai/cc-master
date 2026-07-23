# @ccm/engine

## 0.22.1

> Version synchronized with the `ccm` CLI fixed group. This patch changes transcript discovery and Web Viewer diagnostics in the CLI package only; the engine API, board model, and validation semantics are unchanged.

## 0.22.0

> Stable engine support for delivery deadlines, four-harness capability composition, tracked dispatch, and multi-pool usage evidence.

### Stable summary

- Added the deadline state machine, lint/read helpers, RCPSP-in-trial Monte Carlo scheduler, honest deadline-risk verdict, and calibration snapshot primitives used by the CLI, hooks, and viewer.
- Added the `TrackedDispatch` aggregate and its board write authority, idempotency key, task reference, runtime handle, lifecycle, evidence-monotonicity, terminal, replay, and reconciliation invariants.
- Added `kimi-code` to harness/agent enums and provider-aware engine contracts while preserving unsupported capability states.
- Added named usage pools, Codex per-model rate-limit parsing, source-owned refresh hints, and pacing helpers without collapsing independent provider windows.
- Kept board compatibility additive: legacy documents remain readable, generic setters cannot bypass the new deadline or tracked-dispatch owners, and agent settlement never changes task acceptance.

The complete changeset ledger follows.

### Minor Changes

- 1c2e8ec: 新增显式副作用型 `ccm calibration capture` producer：复用只读 deadline-risk 计算路径，把真实 backlog 与预测特征写入 home-level observed snapshot store；以 canonical board 文件身份稳定关联同一 board，并在 store lock 内按 `board_id + as-of` 幂等去重。`ccm estimate deadline-risk` 保持纯只读；本片不含 label 回填或 calibration flip。
- 42fb45e: 交付 DDL（delivery deadline）核心（issue #149）：board 的 `goal_contract` 新增 👁 `deadline` 子对象（四态 settledness 状态机 `pending|asserted|confirmed|none` + `at`/`precision`/`kind`/`rev`/`provenance`/`updated_at`，与 goal `assurance` 正交、单一 SSOT、窄腰一字不动）+ 新 writer verb `ccm goal deadline set|confirm|confirm-none|amend|show`（带锁 + board.log 审计 + rev 单调递增；confirm/confirm-none/amend 强制 `--user-authorized`、amend 强制 `--reason`；deadline 写绝不 bump goal revision；`--precision day` 落当日末刻 23:59:59Z 且强制 `--tz-input`；`--at` 只收严格 ISO-8601 UTC，时区/自然语言归 agent）+ 三条新 lint 规则（`FMT-DEADLINE` hard 形状 / `BIZ-DEADLINE-PENDING` warn 未 settle 却有可执行任务 / `BIZ-DEADLINE-OVERDUE` warn 已过期未完成，`lintBoard` 加可选 `now` 注入）+ `ccm goal check` verdict 扩展（新增 `deadline_pending`·exit 0，`ok` 收紧为 goal settled 且 deadline settled，`malformed` 覆盖 deadline 形状错，`--json` 附 `deadline` 子块）+ 引擎新增 `readDeadline`/`isDeadlineSettled`/`isDeadlineWellShaped`/`normalizeDeadlineAt` 纯 helper 供下游 endpoint / hook 复用 + 泛型 `--set goal_contract.*` bypass 封堵。`goal amend` 现原样保留 deadline 子对象（scope 变更 ≠ deadline 变更）。legacy board 自动兼容（无 deadline 键三规则皆早返回）。
- 42fb45e: 交付 DDL margin/风险状态暴露到用户可见面（issue #149·契约 §4.3 验收项 8·D6）：把 `ccm estimate deadline-risk` 的 verdict 接进既有的只读展示面，**不重算算法**（复用单一 SSOT·红线 3）。

  - **`ccm estimate forecast`**：板有 `asserted`/`confirmed` DDL 时，`--json` 输出附 `deadline_risk` 摘要块（`deadline`/`deadline_state`/`time_remaining_hours`/`risk_band`/`strength`/`on_time_probability`/`margin`/`confidence`），人读输出加 `DDL:` + `DDL margin:` 两行（margin 带符号·负=越过 DDL）。摘要 margin 与 `estimate deadline-risk` endpoint 逐字段一致（复用 `computeDeadlineRisk`·单一计算路径）。无 DDL / `none` / `pending` → `deadline_risk: null`（诚实 n/a·不假绿·不为无 DDL 板白跑 MC）。
  - **`ccm status-report`**：report 附一个**确定性、board-derived** 的 `deadline` 块（`present`/`state`/`at`/`precision`/`kind`/`time_remaining_hours`/`overdue`）+ 人读一行（settled → 截止时刻/剩余/OVERDUE；`none` → confirmed no-ddl；缺失 → 无行）。不跑 MC/不读跨板语料（保 board-hash 缓存语义）；相对 forecast 的 margin/risk band 指向 `ccm estimate deadline-risk`。
  - **web-viewer**：mission 只读投影新增 board-derived `deadline` 事实（截止时刻/状态/精度/硬软）；goal-contract 面板渲染 deadline 行 + 实时倒计时/OVERDUE 徽章（客户端挂钟·同 board-watchdog 倒计时）+ overdue 提示 callout。viewer 不跑 MC——margin/risk band verdict 归 `ccm estimate deadline-risk`。

  诚实降级贯穿三面：无 DDL 不崩、不假显示；`unknown` band 照实透出、绝不映射绿色。

- 42fb45e: 新增 `ccm estimate deadline-risk --json` 只读 endpoint（交付 DDL 风险 verdict·issue #149·契约 §4.3）：三通道 Monte Carlo 出**准时概率** `on_time_probability` + 分位 margin + 六态 `risk_band`（on_track/watch/at_risk/likely_late/overdue/unknown）+ `top_drivers` + 诚实字段（coverage/confidence/channel_disagreement/calibration_status/notes）。**通道诚实性**：`on_time_probability` **只来自 RCPSP-in-trial 通道**（真调度当前 DAG + 吃 `scheduling.wip_limit` 资源竞争）——`on_time_probability_source` 恒为 `rcpsp-in-trial` 或 `unknown`；precedence-only 只作显式标注的乐观下界（喂 forecast/margin + 双通道分歧信号）；throughput 降为 `channels.throughput_reference`（`kind:"heuristic-reference"`）**绝不映射 verdict**。**诚实降级**（绝不假绿）：无 DDL / 图含环 / 无有效预测 / coverage·history 太弱 / 双通道严重分歧（>0.25）/ RCPSP 不可用 → `risk_band:"unknown"` + `on_time_probability:null`（**绝不退 throughput 冒充 resource-aware**）；`now≥DDL` 且未完成 → `overdue`。band 阈值为 **explicitly uncalibrated 保守起点**（`calibration_status:"uncalibrated-conservative"`·待 labeled 语料校准）。

  引擎（`@ccm/engine`）新增：`empiricalCdfAtOrBefore(sortedSamples, target)`（经验 CDF·on-time 概率载重·二分 O(log n)）+ `rcpspInTrialMc(board, params, opts)`（资源约束 MC·**堆化 serial SGS**·indeg-ready min-heap + slot min-heap·O(V log V)/trial·注入 wip 资源约束·复用现成 CPM 的 min-slack/LFT 优先规则）+ `computeDeadlineRisk(board, opts)`（§4.3 verdict SSOT）；`estimateDagMonteCarlo`/`throughputMonteCarlo` 现暴露升序样本（`makespanSamplesSorted`/`daysSamplesSorted`·零算法重写）。CLI 侧 `estimate deadline-risk` 复用引擎 `buildMcParams` + `readDeadline`（D2）；latency 降档阶梯（trials 2000→1000→500→unknown）按 DAG 规模埋好（防极端大图·别真限时）。纯只读零写（runRead），hook 只搬运不重算（红线 3）。

- 707c2e5: feat: add kimi-code (Moonshot AI Kimi Code CLI) as a 4th supported harness (MVP)

  - Harness registry: new `kimiCodeAdapter` (`ccm harness list` now reports `kimi-code`,
    detects `kimi` binary / `$KIMI_CODE_HOME`; account pool + external statusline unsupported,
    plugin distribution supported via managed-dir install).
  - Worker driver: `ccm worker help/run --harness kimi-code` passes argv straight through to the
    `kimi` executable (`kimi -p ... --output-format stream-json`); adds `KIMI_CODE_HOME` to the
    worker child env allow-list and a `kimi` executable-resolution branch (`CCM_KIMI_BIN`/`KIMI_BIN`/PATH).
  - Board model (`@ccm/engine`): `owner.harness` and `agents[].harness` enums gain `kimi-code`;
    `FMT-HARNESS` / `FMT-AGENTS` messages updated accordingly.
  - Final stable engine contracts include Kimi's managed rolling-window usage evidence;
    account pools and external statusline capabilities stay unsupported.

- 33a47f9: 新增显式同步 tracked transport `ccm worker dispatch`，同时保持 `ccm worker run` 为零 board 副作用的 raw transport。新命令要求 idempotency key，只写 board 的 `agents[]`：在既有 board lock 内完成 prepare/唯一 claim/真实 spawn PID bind + agent-side task link/session identity 单调升级/sanitized terminal/reconciliation；绝不改 task status、handle、routing attempt 或 acceptance，也不持久化 prompt、stdin、secret、environment、完整 provider argv 或 provider output。

  四个 harness 都提供真实 PID tracking；Codex 仅从已声明 `--json` transport 的 `thread.started.thread_id`、Kimi 仅从已声明 `--output-format stream-json` transport 的 `session.resume_hint.session_id` 升级 session/transcript/attach。Claude Code 可从显式 `--session-id`，或已声明 `--output-format json|stream-json` transport 的严格 `type=result / session_id` 信封取得 session identity，继而定位 transcript 并生成 `claude --resume <sid>` resume attach；绝不从任意模型文本猜身份，未观察到 session 证据时仍保持 PID-only，identity/attach 为 typed unavailable。显式 `--transcript` 指向已存在、可读的路径时，transcript 可独立为 typed supported；只有没有可读的显式 `--transcript` 时，transcript 才为 typed unavailable。Cursor 的 native session identity、SQLite transcript 与 exact attach 保持 typed unsupported，但显式 `--transcript` / `CURSOR_TRANSCRIPT_PATH` 可提供 raw transcript stream；无可读路径时仍可登记、stream 诚实为 none。claim 后 PID 前崩溃绝不自动重发；bind 失败取消并 reap owned process tree；terminal tracking failure 胜过 worker exit 0。`@ccm/engine` 新增 TrackedDispatch aggregate、BoardWriteAuthority/DispatchKey/TaskRef/RuntimeHandle value objects 及 additive `agents[].dispatch` lint/model 合约。

  Capability evidence 只允许 unavailable 与同值 supported 之间单调收敛；unsupported 与两者不可比，冲突 supported transcript/attach 也会 durable reconciliation。已落盘 closing replay 与 live terminal 使用同一套有界 persistence/reconciliation fallback，失败 receipt 只报告真正 durable 的 aggregate。

- 1c2e8ec: usage/quota 输出层重构(agent-facing 正确性 + 工效学):
  - **cursor 多池**:`GetCurrentPeriodUsage` 的 first-party 与 usage-based/spend-limit 池不再塌成一个数,`UsageSignal` 新增 `pools[]`(named·`kind:first_party|usage_based`)承载多池,`billing_period` 保留兼容;machine-wide TARGETS 分列 cursor 两池;provider-model-facts 标注模型 → 池归属。
  - **codex 按模型池**:`normalizeCodexRateLimits` 解析 `rateLimitsByLimitId`,每模型独立配额池透传(此前只读 legacy 顶层 primary/secondary·丢弃 per-model)。
  - **machine-wide refresh_hint**:`safeQuotaReading` 新增可选 hint 字段,unavailable/expired target 携带同源可执行提示(含 agent_authorized/authorization),不再只有不透明 reason_codes。
  - **agent-parse-proof**:`usage show` 新增顶层 plain-language `agent_summary`,一句话给出状态+可执行动作,消费 agent naive 读即得正确结论(此前窗口嵌 `current.*`、顶层空易致误判)。
  - doc 锁步:using-ccm command-catalog + pacing-and-estimation usage-signals 补 kimi-code、多池/hint/agent_summary 描述。全 additive·现有消费方字段语义不变。

## 0.22.0-rc.4

## 0.22.0-rc.3

## 0.22.0-rc.2

## 0.22.0-rc.1

## 0.22.0-rc.0

### Minor Changes

- 42fb45e: 交付 DDL（delivery deadline）核心（issue #149）：board 的 `goal_contract` 新增 👁 `deadline` 子对象（四态 settledness 状态机 `pending|asserted|confirmed|none` + `at`/`precision`/`kind`/`rev`/`provenance`/`updated_at`，与 goal `assurance` 正交、单一 SSOT、窄腰一字不动）+ 新 writer verb `ccm goal deadline set|confirm|confirm-none|amend|show`（带锁 + board.log 审计 + rev 单调递增；confirm/confirm-none/amend 强制 `--user-authorized`、amend 强制 `--reason`；deadline 写绝不 bump goal revision；`--precision day` 落当日末刻 23:59:59Z 且强制 `--tz-input`；`--at` 只收严格 ISO-8601 UTC，时区/自然语言归 agent）+ 三条新 lint 规则（`FMT-DEADLINE` hard 形状 / `BIZ-DEADLINE-PENDING` warn 未 settle 却有可执行任务 / `BIZ-DEADLINE-OVERDUE` warn 已过期未完成，`lintBoard` 加可选 `now` 注入）+ `ccm goal check` verdict 扩展（新增 `deadline_pending`·exit 0，`ok` 收紧为 goal settled 且 deadline settled，`malformed` 覆盖 deadline 形状错，`--json` 附 `deadline` 子块）+ 引擎新增 `readDeadline`/`isDeadlineSettled`/`isDeadlineWellShaped`/`normalizeDeadlineAt` 纯 helper 供下游 endpoint / hook 复用 + 泛型 `--set goal_contract.*` bypass 封堵。`goal amend` 现原样保留 deadline 子对象（scope 变更 ≠ deadline 变更）。legacy board 自动兼容（无 deadline 键三规则皆早返回）。
- 42fb45e: 交付 DDL margin/风险状态暴露到用户可见面（issue #149·契约 §4.3 验收项 8·D6）：把 `ccm estimate deadline-risk` 的 verdict 接进既有的只读展示面，**不重算算法**（复用单一 SSOT·红线 3）。

  - **`ccm estimate forecast`**：板有 `asserted`/`confirmed` DDL 时，`--json` 输出附 `deadline_risk` 摘要块（`deadline`/`deadline_state`/`time_remaining_hours`/`risk_band`/`strength`/`on_time_probability`/`margin`/`confidence`），人读输出加 `DDL:` + `DDL margin:` 两行（margin 带符号·负=越过 DDL）。摘要 margin 与 `estimate deadline-risk` endpoint 逐字段一致（复用 `computeDeadlineRisk`·单一计算路径）。无 DDL / `none` / `pending` → `deadline_risk: null`（诚实 n/a·不假绿·不为无 DDL 板白跑 MC）。
  - **`ccm status-report`**：report 附一个**确定性、board-derived** 的 `deadline` 块（`present`/`state`/`at`/`precision`/`kind`/`time_remaining_hours`/`overdue`）+ 人读一行（settled → 截止时刻/剩余/OVERDUE；`none` → confirmed no-ddl；缺失 → 无行）。不跑 MC/不读跨板语料（保 board-hash 缓存语义）；相对 forecast 的 margin/risk band 指向 `ccm estimate deadline-risk`。
  - **web-viewer**：mission 只读投影新增 board-derived `deadline` 事实（截止时刻/状态/精度/硬软）；goal-contract 面板渲染 deadline 行 + 实时倒计时/OVERDUE 徽章（客户端挂钟·同 board-watchdog 倒计时）+ overdue 提示 callout。viewer 不跑 MC——margin/risk band verdict 归 `ccm estimate deadline-risk`。

  诚实降级贯穿三面：无 DDL 不崩、不假显示；`unknown` band 照实透出、绝不映射绿色。

- 42fb45e: 新增 `ccm estimate deadline-risk --json` 只读 endpoint（交付 DDL 风险 verdict·issue #149·契约 §4.3）：三通道 Monte Carlo 出**准时概率** `on_time_probability` + 分位 margin + 六态 `risk_band`（on_track/watch/at_risk/likely_late/overdue/unknown）+ `top_drivers` + 诚实字段（coverage/confidence/channel_disagreement/calibration_status/notes）。**通道诚实性**：`on_time_probability` **只来自 RCPSP-in-trial 通道**（真调度当前 DAG + 吃 `scheduling.wip_limit` 资源竞争）——`on_time_probability_source` 恒为 `rcpsp-in-trial` 或 `unknown`；precedence-only 只作显式标注的乐观下界（喂 forecast/margin + 双通道分歧信号）；throughput 降为 `channels.throughput_reference`（`kind:"heuristic-reference"`）**绝不映射 verdict**。**诚实降级**（绝不假绿）：无 DDL / 图含环 / 无有效预测 / coverage·history 太弱 / 双通道严重分歧（>0.25）/ RCPSP 不可用 → `risk_band:"unknown"` + `on_time_probability:null`（**绝不退 throughput 冒充 resource-aware**）；`now≥DDL` 且未完成 → `overdue`。band 阈值为 **explicitly uncalibrated 保守起点**（`calibration_status:"uncalibrated-conservative"`·待 labeled 语料校准）。

  引擎（`@ccm/engine`）新增：`empiricalCdfAtOrBefore(sortedSamples, target)`（经验 CDF·on-time 概率载重·二分 O(log n)）+ `rcpspInTrialMc(board, params, opts)`（资源约束 MC·**堆化 serial SGS**·indeg-ready min-heap + slot min-heap·O(V log V)/trial·注入 wip 资源约束·复用现成 CPM 的 min-slack/LFT 优先规则）+ `computeDeadlineRisk(board, opts)`（§4.3 verdict SSOT）；`estimateDagMonteCarlo`/`throughputMonteCarlo` 现暴露升序样本（`makespanSamplesSorted`/`daysSamplesSorted`·零算法重写）。CLI 侧 `estimate deadline-risk` 复用引擎 `buildMcParams` + `readDeadline`（D2）；latency 降档阶梯（trials 2000→1000→500→unknown）按 DAG 规模埋好（防极端大图·别真限时）。纯只读零写（runRead），hook 只搬运不重算（红线 3）。

- 707c2e5: feat: add kimi-code (Moonshot AI Kimi Code CLI) as a 4th supported harness (MVP)

  - Harness registry: new `kimiCodeAdapter` (`ccm harness list` now reports `kimi-code`,
    detects `kimi` binary / `$KIMI_CODE_HOME`; account pool + external statusline unsupported,
    plugin distribution supported via managed-dir install).
  - Worker driver: `ccm worker help/run --harness kimi-code` passes argv straight through to the
    `kimi` executable (`kimi -p ... --output-format stream-json`); adds `KIMI_CODE_HOME` to the
    worker child env allow-list and a `kimi` executable-resolution branch (`CCM_KIMI_BIN`/`KIMI_BIN`/PATH).
  - Board model (`@ccm/engine`): `owner.harness` and `agents[].harness` enums gain `kimi-code`;
    `FMT-HARNESS` / `FMT-AGENTS` messages updated accordingly.
  - Usage stays intentionally unavailable for this MVP: `readCurrentUsage` returns
    `signal: null, source: 'unavailable'` (no CLI quota signal). A read-only `/coding/v1/usages`
    collector is a documented follow-up — it must never refresh/rotate the stored credential.

## 0.21.0

### Minor Changes

- fae016b: Agent Registry v1：board 新增 ✎ `agents[]` 运行时 agent 登记簿（凡派发皆登记的统一花名册·agent↔task join 存 agent 侧 `links[]`·id 遵守 run-store v2 ID 文法）+ 新 namespace `ccm agent` 七 verb（create/bind/link/terminal/probe/list/show·登记/探测/读取 noun，无任何 spawn/route/dispatch 语义）+ 按 handle 分级的活性探测与 reconcile（pid 存活 / codex·claude-code 会话文件 mtime / transcript mtime·拿不到即 unknown 保真·只写 agents[] 自己的 probe/lifecycle 字段）+ 两条 warn 级 lint（`FMT-AGENTS` 段形状 / `BIZ-INFLIGHT-AGENT` in_flight 未登记软提示）+ viewer agent 观测面。
- f68e380: Project cached Cursor IDE and Cursor Agent surface inventory into orchestrator pre-context without
  probing providers or enabling dispatch.
- 27e9330: 新增三路 origin 共用的 cached-only、shadow-only、4KiB 脱敏 orchestrator context delivery，
  并为 `ccm orchestrator context` 增加 additive `--agent-visible` 输出面。
- 4776c04: Separate review execution completion from dependency approval. Explicit review gates now keep downstream tasks blocked until the current attempt records an `APPROVE` verdict, invalidate prior verdicts at retry boundaries, and never reuse an omitted verdict from an earlier attempt.
- 96ca94c: Add opt-in declared delivery/dependency truth with candidate, target-delivery, and edge-qualification semantics; local-only Git, reviewed-reconciliation, and immutable-artifact proof; retry-safe evidence lifecycle; strict dry-run surfaces; and target, delivery, dependency, and attestation CLI commands. Existing boards and undeclared edges retain legacy readiness behavior, and strict-default remains disabled.
- Add machine-wide, cross-session quota posture and notification read models for all locally supported harnesses. Provider-scoped cached observations feed coordination, monitor, usage, quota, and shadow-routing consumers without allowing caller-invented authority or automatic account switching.
- 4b52f57: Add a fail-closed managed-attempt write-set compiler and diagnostic CLI preflight for isolated linked worktrees, with explicit artifact roots and fixed remote/account/network deny boundaries.
- afedfe8: Add a public RuntimeEnvironment and PathResolver contract for deterministic Linux and macOS home, host-config, plugin-root, session-pointer, and executable resolution, and align CLI discovery and runtime consumers with that single portable path policy.
- 4776c04: Add an atomic `task retry` lifecycle operation that archives prior attempt evidence, resets current attempt timestamps, artifact, and typed verification state, and applies the same safety contract to legal retry transitions through `task set-status`.
- Add opt-in cross-harness task-planning and agent-routing board contracts, validated transition gates, and dedicated CLI writers. Legacy boards remain compatible while contract-enabled attempts must carry difficulty, capability, permission, fallback, and immutable selection evidence before execution.
- 5d08d83: Add the fail-closed Codex native-attempt ledger, shared canonical launch identity, production owner-store admission/evidence composition, and crash-recoverable dedicated CLI transactions while keeping host invocation unsupported by default.
- 27e9330: Add fail-closed machine-surface eligibility and independent read-only Cursor IDE/Agent CLI discovery to the machine-wide harness inventory.
- 99c3189: 新增 Goal Contract v1：fresh board 以 pending skeleton 启动，`ccm goal set|confirm|amend|show|check` 原子管理 normalized goal 与受管、不可变、可校验的 Goal Brief；contract 激活后禁止通用 `board update --goal` 绕过 revision 审计，并新增对应 lint/capability。
- 01dc896: Add a provider-neutral live quota admission engine, owner-only crash-durable observation and
  reservation store, strict held-to-committed ticket/run lineage, recoverable multi-key transaction
  coordination, payer+pool concurrency control, and `quota status/preflight/reserve/audit` CLI surface.
  Preflight derives authority from stored observation, policy, effect, reservation, and committed
  ticket facts rather than caller conclusions. Codex admission treats only the seven-day window as a
  hard quota signal; rolling 24-hour velocity remains advisory and account or credential mutation
  stays forbidden. Reserve capacity and canonical request digests are store-derived; reservation IDs
  are authority-scope unique. Multi-key journals own lookup and every capacity-changing transition,
  while terminal audit retries remain monotonic and cannot reoccupy released capacity. Machine-scope
  idempotency-key locks and durable indexes prevent cross-aggregation duplicate holds, Codex policy and
  percentage domains fail closed before admission, source coordinates are validated symmetrically, and
  single-key terminal retries repair event-durable snapshot projections.

### Patch Changes

- cd8e495: Require every armed watchdog to carry a non-blank real wakeup handle, diagnose legacy missing-handle or expired records without blocking unrelated writes, and make disarm delete canonical and legacy records completely.
- e52dfd8: Scope `BIZ-EXECUTOR-HANDLE` to in-flight subagent and workflow tasks so future ready or blocked tasks do not produce false-positive warnings or invite placeholder handles.
- 7ab0a9a: Add one crash-durable owner-only writer for persistent account, board, monitor, and web-viewer state, with explicit file/directory fsync outcomes and fail-closed hard errors.
- e904207: Prevent statusline auto-install's development guard from trusting repository markers placed at the shared system temporary-directory root. Real repositories below that boundary and worktree invocations remain suppressed, while isolated install paths no longer inherit transient `.git` markers from concurrent workers.

## 0.20.0

### Minor Changes

- Version-only lockstep bump with `ccm@0.20.0` (mission-control web-viewer migration lives in the `ccm` / `@ccm/web-viewer` packages).

## 0.18.0

### Minor Changes

- 01dadc1: Add Cursor harness usage: billing_period window on UsageSignal / pacingAdvice (hold|throttle|stop_billing_period, never switch), plus cursor-dashboard GetCurrentPeriodUsage reader and harness adapter registration.

## 0.17.2

### Patch Changes

- Version-only lockstep patch for ccm-v0.17.2. Runtime behavior changes are in the `ccm` CLI package.

## 0.17.1

### Patch Changes

- Version-only lockstep patch for ccm-v0.17.1. Runtime behavior changes are in the `ccm` CLI package.

## 0.17.0

### Minor Changes

- feat: expose board read models needed by ccm web viewer and status reports

  - Adds the stable data/model support consumed by `ccm status-report` and the `ccm web-viewer` service: board/task status grouping, DAG-friendly task metadata, progress calculation, critical path/status summaries, freshness hashes, and lint/health inputs for generated reports.
  - Keeps board JSON as the single writable source of truth: status reports are derived artifacts, viewer routes are read-only, and board mutations continue to go through existing ccm write paths.

## 0.16.0

### Minor Changes

- aa13545: feat: task-scoped bare `--set/--set-json` dotpaths, `board update --set/--set-json`, and written-path echo (Finding #83)

  - `ccm task add <id>` / `ccm task update <id>`: a bare dotpath in `--set`/`--set-json`
    (e.g. `--set-json 'decision_package={…}'`) now scopes to **that task** — matching the intuition
    of named flags like `--title`. Previously bare paths silently landed on the board top level
    while the command still reported "task 已更新", polluting the board root with dead data
    (Finding #83). An explicit `tasks[<other-id>].field` prefix keeps its existing cross-task
    semantics (escape hatch preserved). 🔒 load-bearing protection is unchanged — and now bare
    `--set status=…` in a task context is refused (exit 3) instead of silently writing top-level junk.
  - `ccm board update` gains `--set <path=val>` / `--set-json <path=json>` as the front door for
    board-top-level ✎ flexible fields (bare path lands on the board root; 🔒 `schema`/`goal`/`owner`/
    `git`/`tasks` still refused; `tasks[<id>].field` prefix targets that task). `board update` with
    only `--set`/`--set-json` (no named flag) is now accepted.
  - After any `--set`/`--set-json` write, non-`--json` output echoes the normalized logical path
    actually written (e.g. `set tasks[T7].decision_package`), eliminating the zero-signal
    wrong-destination failure mode.
  - Help text for `--set`/`--set-json` on `task add`/`task update`/`board update`/`jc add`/
    `cadence update`/`cadence open` now states the scoping semantics explicitly.
  - `jc add` / `cadence update` / `cadence open` keep their existing board-top-level bare-path
    semantics (no task anchor in those contexts) — unchanged.

## 0.15.0

### Minor Changes

- 29f682f: feat: batch `task start`/`task done`, early `--artifact` diagnostic, and BIZ-DEV-REFS hard gate

  - `ccm task start` / `ccm task done` now accept multiple positional ids (`ccm task done T1 T2 T3
--verified --artifact X`), running one mutate + one lint + one write for the whole batch instead
    of N independent writes. This fixes the "batch backfill death spiral" where a full-board lint
    hard error on unrelated tasks caused every individual write in a large batch to be rejected
    (only 1 of N calls would ever land). `--force` still applies uniformly across the whole batch;
    any illegal transition or missing id fails the entire batch atomically (no partial writes).
    `--json` output shape is now always an array (length = number of ids given, including single-id
    calls — the one intentional shape change).
  - `ccm task update <id> --artifact <v>` now gives an early, friendlier `Usage` error (exit 2) when
    the target task is already `status:done` with `verified` not `true` and `--verified` isn't also
    given — that combination can never satisfy `BIZ-DONE-VERIFIED`, so we surface the fix
    ("add --verified, or use `task done --verified --artifact`") immediately instead of only via the
    full lint report on exit 3. Lint remains the sole validation authority; this is a UX-only
    pre-check.
  - `BIZ-DEV-REFS` (development tasks must reference `kind=spec` and `kind=plan`) is upgraded from
    `warn` to `hard` — a `development` task missing spec/plan anchors is now rejected at write time
    (`--force` still crosses it), instead of silently accepted with a warning.

## 0.14.1

### Patch Changes

- 96e0f68: fix: expose board source for GitHub issue bootstrap

  `ccm board init` now accepts `--github-issue <url>` and stores it as a board-level source (`board.source.kind=github_issue`, `board.source.url`) so issue-based bootstrap is treated as a requirement source rather than synthetic task seed.

## 0.14.0

### Minor Changes

- 7ede866: Enforce true-done board integrity: `status=done` now requires `verified=true` and a non-empty `artifact`, and `ccm task done` writes without both evidence fields are rejected by validation.

## 0.13.0

### Minor Changes

- Host-adapter groundwork for Codex and multi-harness installs:
  - Adds host-aware path helpers and harness-facing exports consumed by `ccm`.
  - Extends board runtime parameter validation with `runtime.stop_allow_until`, the bounded release valve used by Codex Stop hooks.
  - Keeps the board model and runtime whitelist in sync with the new Stop continuation gate.

## 0.12.0

### Minor Changes

- 70307e8: deps 驱动的 `ready↔blocked` 自动门控 + `blocked_on` 作语义阻塞判别器（ADR-023·Model 1）

  - **`@ccm/engine`**：新增纯函数 `reconcileGating(board)`——对每个「无 `blocked_on` 且 `status ∈ {ready, blocked}`」的 task 按 deps 完成度归一（deps 全 done→`ready`，否则 →`blocked`）；有 `blocked_on`（等 user / 等某 task）的语义阻塞整体豁免。一趟全板 O(V+E)、幂等、不产生新 `done`（无级联），复用 `analyzeGraph.predecessors` + `isDoneStatus` 与 `readySet` 零漂移。
  - **写入关卡**：`runWrite` 在 `mutate` 之后、`lintBoard` 之前跑一趟归一——所有写 verb 自动获得 `ready↔blocked` 门控，CLI 写路径永不产生不一致态。
  - **新 verb `ccm task unblock <id>`**：清 `blocked_on`（+ 附属 `decision_package`），交回 `reconcileGating` 按 deps 定 `ready`/`blocked`（`task block` 的解除侧）。
  - **新 lint warn `BIZ-STATUS-DEPS`**：兜手改 board 造出的门控不一致态（`ready` 但 deps 未全 done / `blocked` 无 `blocked_on` 但 deps 全 done）——规则全集 48→49。

- 2f9890c: pacing verdict 翻转为单侧（减速）+ 换号 + 停（ADR-024·supersedes ADR-010 双侧走廊）

  - **verdict enum 翻转**——`{hold, throttle, switch, stop_5h, stop_7d}` 取代旧 `{accelerate, hold, throttle, hard_stop}`：砍掉整个 underuse 加速侧（号池令单窗口「欠用」非真稀缺——一次 `ccm account switch` = 新满血 5h 窗口，加速 advisory 反诱导 busywork）；`hard_stop` 拆成 `stop_5h`（短停）/ `stop_7d`（长停）；新增 `switch`。
  - **池感知 `pacingAdvice`**——接 `predictPoolUsage`（冻结备份投影）+ `selectAccount`：临界 + 健康可切备号 → `switch`（换下一份配额，不减速）；池温无逃逸 → `throttle`（5h `weak` / 7d `strong`）；全池撞墙（`selectAccount` 返回 `NONE_ALL_EXHAUSTED`·权威锚，switch 尝试本身即探针）→ `stop_5h`/`stop_7d`（emit `nearest_reset` epoch sec 供 agent arm wakeup）。单账户 7d 到顶 → `switch`（不再 `stop`，修旧 over-braking bug；只全池撞墙才停）。
  - **`usage advise` 输出改形**——`PacingAdvice` 新增 `strength`（`weak|strong`·ADR-018 force mapping·引擎 emit / hook 直接消费）、`switch_candidate`（email）、`stop_dimension`（`5h|7d|null`）、`nearest_reset`（epoch sec|null）；**drop `hard_stop_7d`**（并入 `stop_7d`）；underuse accelerate 侧移除。
  - **`selectAccount` 补对称 5h 硬闸**——原来只用单窗口（7d≥85%）硬闸、5h 仅软权重，会切到 `5h=99% / 7d 健康` 的号（落地即撞墙）且全池 5h 墙 / 7d 健康时不返 `NONE_ALL_EXHAUSTED`（该 stop 却空切）。新增 `CCM_SELECT_5H_HARD_GATE`（默认 `90`·非 95），gate 改对称 `p5≥90 || p7≥85`（p5 用 reset 恢复后的值·不误杀刚 reset 的号）→「candidate ⟺ 双窗口都健康」「`NONE_ALL_EXHAUSTED` ⟺ 无双窗口健康号」。令 pacing 的 `switch`/`stop` verdict 正确性闭合（switch 目标保证双窗口有余量·全池含 5h 墙侧才 stop 不空切）。ADR-024 §3.1 amend。
  - 池聚合只在引擎（红线 2/3）；换号 policy 硬闸（`deny→exit7`）仍在 `ccm account switch`。`using-ccm` / `pacing-and-estimation` skill 手册同 PR 锁步。

## 0.11.0

### Minor Changes

- ccm 线首个独立发版（ccm-v0.11.0·版本线解耦后·ADR-022）。本轮两项新功能：

  - **`ccm upgrade` 命令** — ccm 自更新子命令：就地把本机 `ccm` 二进制升级到 ccm 线最新 release（按 `ccm-v*` tag 解析），免重跑 install.sh。
  - **`GRAPH-CONNECTED` 连通性 lint 规则** — board lint 新增一条 warn 级规则：把 `deps` ∪ `parent` 容器边当无向边算弱连通分量，分量 > 1（图被切成互不相连的孤岛子图）时提示规划失焦（漏连依赖 / 任务不属于本目标）。连通性计入 parent 容器边（ADR-012），`deps:[]` 的嵌套子任务经其 owner 连进主图、不被误判孤岛。
