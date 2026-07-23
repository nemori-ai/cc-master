# ccm

## 0.23.0

> **Noncommercial license boundary release** — the first ccm release under
> PolyForm Noncommercial 1.0.0, paired with cc-master plugin `v0.22.0`.

### Minor Changes

- Establish the first ccm release under PolyForm Noncommercial 1.0.0. `ccm-v0.23.0`
  is the explicit noncommercial license boundary; ccm `0.22.1` and earlier
  releases retain the MIT terms shipped with them. This release changes licensing
  and distribution metadata only, with no board-schema, engine-API, or runtime
  behavior change.

### Patch Changes

- Updated dependencies
  - @ccm/engine@0.23.0

## 0.22.1

> **Accurate cross-harness agent-stream attribution and native-subagent discovery.** This patch release is paired with cc-master plugin `v0.21.1`.

### Fixes

- **Actionable no-source diagnostics** — stream responses now distinguish a missing transcript/session binding from an unsupported harness. Claude Code, Codex, and Kimi Code records point to `ccm worker dispatch` or an explicit `agent amend` binding; Cursor explains that native `state.vscdb` is not tail-able and points to an external transcript path.
- **Host-correct native-subagent discovery** — Claude Code resolves `subagents/agent-<agentId>.jsonl` from the parent session JSONL, while Kimi Code resolves `agents/<agentId>/wire.jsonl` from `agents/main/wire.jsonl` and parses its typed wire events.
- **No parent-event leakage** — when a derived child transcript does not exist yet, the stream remains honestly unavailable instead of falling back to the parent transcript and attributing orchestrator/main events to the child.
- **Web Viewer fallback clarity** — the agent inspector mirrors the server-side reason and recovery path instead of reporting every unbound source as an unsupported agent type.
- **Concurrent bootstrap recovery on macOS** — two cold activations can now reclaim the same dead native-materializer bootstrap without the losing reclaimer treating the winner's exact `1 → 0` unlink transition as tampering. Any inode, size, mode, owner, flags, or modification-time change still fails closed.

### Compatibility

- `ccm` and `@ccm/engine` remain version-locked at `0.22.1`; this release does not change the board schema or engine API.
- Existing explicit readable `transcript_ref` and `session-id` bindings remain compatible. Native parent-to-child derivation is enabled only for empirically verified Claude Code and Kimi Code layouts; Codex and Cursor remain fail-closed when no exact child source is known.

## 0.22.0

> **Deadline-aware four-harness execution, tracked dispatch, and live agent observability.** This is the stable CLI/engine release paired with cc-master plugin `v0.21.0`.

### Highlights

- **Delivery deadlines become executable state** — Goal Contracts can settle, confirm, or amend a deadline; lint and goal checks detect pending/overdue states; forecasts, status reports, hooks, and the Web Viewer expose the same board-derived truth.
- **Resource-aware deadline risk** — `ccm estimate deadline-risk --json` runs a WIP-constrained RCPSP Monte Carlo channel, reports probability/margin/risk drivers and honest coverage/confidence fields, and fails to `unknown` instead of substituting a weaker heuristic. Thresholds remain explicitly uncalibrated; `ccm calibration capture` records prediction-time snapshots but does not manufacture labels or claim calibration.
- **Tracked cross-harness dispatch** — `ccm worker dispatch` combines real process launch with idempotent Agent Registry create/bind/link, typed identity/transcript/attach enrichment, sanitized terminal facts, and durable reconciliation. The command is synchronous, so long work still needs an outer background process/session handle. `ccm worker run` remains the unchanged raw transport with zero board side effects.
- **Registered agents are visible while they work** — the Web Viewer can open an agent drawer and tail the registered actor's raw transcript through per-harness adapters. Claude Code, Codex, and Kimi Code have implemented sources; Cursor accepts an explicit readable external transcript while native SQLite streaming remains deferred. Same-version viewer caches now invalidate by bundled build identity.
- **Four harnesses, one capability model** — Claude Code, Codex, Cursor, and Kimi Code use adapter-owned discovery, quota/usage, statusline, account, worker, upgrade, and lifecycle capabilities composed through one catalog. Missing capabilities stay typed `unsupported` or `unavailable` rather than being inferred from a hard-coded harness switch.

### Harness, model, and quota changes

- Added Kimi Code as the fourth harness across discovery, raw/tracked worker execution, board harness enums, model policy, machine-wide quota, usage collection, and Web Viewer transcript parsing.
- Kimi usage reads rolling 5-hour and 7-day windows from the managed endpoint. Expired access tokens are refreshed under a cross-process advisory lock and written atomically with mode `0600`; refresh failure degrades to an explicit recovery hint, and `CCM_KIMI_AUTO_REFRESH=0` restores read-only behavior. Account pools and external statusline installation remain unsupported.
- Refreshed official provider/model snapshots, including current Kimi K3 and K2.7 Code catalog facts, pricing/context/effort metadata, published limitations, freshness windows, and explicit live-entitlement/independent-benchmark unknowns. Catalog presence alone never authorizes automatic selection.
- Cursor first-party requests and usage-based/spend-limit capacity are separate named pools instead of one misleading percentage. Codex per-model limits are preserved instead of collapsing into legacy top-level windows.
- `usage show` adds a plain-language `agent_summary`; machine-wide readings add source-owned `refresh_hint` actions for unavailable or expired targets. Claude's independent 7-day target and all four harness surfaces remain separately attributable.

### Worker and lifecycle reliability

- Relative `worker run --cwd` values now resolve against the launching process for all four harnesses.
- The maximum worker timeout is 2 hours (default remains 10 minutes), and bounded stdout/stderr capacity rises to 512 MiB so real Codex diagnostic streams are not truncated at the former limits.
- Cursor Agent authentication detection, supported-version admission, subscription billing reads, and benign packaged worker/language-service reaping are corrected without weakening fail-closed handling for unknown descendants.
- Tracked dispatch never guesses session identity from model text: Codex, Kimi, and Claude accept only their declared structured evidence; Cursor native identity/SQLite attach remain unsupported. A missing identity can still retain a proven PID and independently supplied transcript.
- Claim-before-PID crashes, bind failures, lost supervisors, conflicting capability evidence, terminal-write failures, and response loss all converge through idempotent replay or durable reconciliation; none can silently respawn or report false success.
- Agent terminal state remains separate from task acceptance. `agent list.stale_candidates` only points out actors whose linked tasks are all done; it never auto-terminals them.

### Release and integrity changes

- Provider facts, harness capabilities, generated viewer assets, and Turbo cache inputs are covered by source-mutation tests so changed shared contracts cannot reuse stale-green package tests.
- The plugin and ccm release workflows share one metadata planner. RC bodies remain concise; stable bodies must exactly preserve the complete matching changelog section plus a tag-pinned full-changelog link.
- `ccm` and `@ccm/engine` graduate together from the changesets RC line at `0.22.0`; consumed release changesets are removed as part of the stable transition.

### Compatibility and known boundaries

- Node.js 22 or newer is required. Release binaries are built for Linux x64/arm64 and macOS x64/arm64 with a shared `SHA256SUMS`; Windows SEA/signing remains deferred.
- Existing boards remain readable. A Goal Contract whose deadline has not been settled can now return `deadline_pending`; explicitly confirm a deadline or use `goal deadline confirm-none` rather than inventing one.
- Deadline probabilities are decision aids, not delivery guarantees. Weak coverage, graph cycles, missing estimates, serious channel disagreement, or unavailable resource-aware simulation produce `unknown`, never a fabricated green verdict.
- Workers remain local and session-bound. Durable remote transport, a universal provider sandbox, Cursor native SQLite transcript streaming, and non-Claude account switching are outside this release.
- The stable plugin consumes these CLI surfaces; when upgrading separately, install `ccm-v0.22.0` before plugin `v0.21.0`.

The complete changeset ledger follows so implementation-level changes remain auditable.

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

- 1c2e8ec: kimi usage collector 主动刷新短命 access_token:过期时在跨进程 advisory 锁内重读凭证(并发赢家使本次成为 no-op)、仅当仍过期才用 refresh_token 换新并原子写回(temp+rename·保留 0600),使 kimi usage 在多 session 并发下可靠可读。token 只在内存、绝不进日志/输出。auto-refresh 是优化:失败时无损回退到既有 expired-recovery hint(`kimi -p 'hi'`·agent_authorized)——hint 据存储凭证原始态导出。`CCM_KIMI_AUTO_REFRESH=0` 逃生阀退回旧只读行为。
- 707c2e5: feat: add kimi-code (Moonshot AI Kimi Code CLI) as a 4th supported harness (MVP)

  - Harness registry: new `kimiCodeAdapter` (`ccm harness list` now reports `kimi-code`,
    detects `kimi` binary / `$KIMI_CODE_HOME`; account pool + external statusline unsupported,
    plugin distribution supported via managed-dir install).
  - Worker driver: `ccm worker help/run --harness kimi-code` passes argv straight through to the
    `kimi` executable (`kimi -p ... --output-format stream-json`); adds `KIMI_CODE_HOME` to the
    worker child env allow-list and a `kimi` executable-resolution branch (`CCM_KIMI_BIN`/`KIMI_BIN`/PATH).
  - Board model (`@ccm/engine`): `owner.harness` and `agents[].harness` enums gain `kimi-code`;
    `FMT-HARNESS` / `FMT-AGENTS` messages updated accordingly.
  - Final stable usage support reads the managed rolling 5h/7d endpoint and participates in
    machine-wide quota. Expired access tokens may refresh under the bounded, atomic credential
    contract described below; account pools and external statusline installation stay unsupported.

- 707c2e5: feat(model-policy): add Kimi K3 and Kimi K2.7 Code as worker-target model candidates

  - Provider facts: new `kimi-code` provider in `provider-model-facts.json` with two
    models — `kimi-k3` (frontier, 1M context) and `kimi-k2.7-code` (balanced,
    forced-thinking, 256K context). Both carry `benchmarks: null` on purpose: current
    vendor-published numbers are not imported as cross-vendor evidence and are not
    comparable to the cross-vendor `swe_bench_pro_pct` / `terminal_bench_2_1_pct`
    columns other providers use.
  - Provider whitelist + OFFICIAL_HOSTS gain `kimi-code` and Moonshot official hosts
    (`platform.kimi.ai`, `kimi.com`, `www.kimi.com`) so `ccm provider facts kimi-code`
    and `ccm model-policy show` expose the new snapshot.
  - Role candidates: `kimi-code-cli:kimi-k3` → `["T1","T2"]` (low confidence: benchmarks
    unpublished, carries an extra `official-benchmarks-unpublished` blocker) and
    `kimi-code-cli:kimi-k2.7-code` → `["T1","T2","T3"]` (medium confidence). Neither is
    an O candidate — conservative effect floor until benchmarks/certification arrive.
  - Community advisory: one bounded-tie-break-only Kimi K2.7 implementation-from-spec
    signal with honest limitations (vendor-self-benchmark context, single community
    review, coding below frontier on standard comparators).

  This only wires Kimi as a worker-target model provider into model-policy; it does not
  touch the origin-harness (`ORIGINS`) axis or the worker/harness enums.

- 33a47f9: 新增显式同步 tracked transport `ccm worker dispatch`，同时保持 `ccm worker run` 为零 board 副作用的 raw transport。新命令要求 idempotency key，只写 board 的 `agents[]`：在既有 board lock 内完成 prepare/唯一 claim/真实 spawn PID bind + agent-side task link/session identity 单调升级/sanitized terminal/reconciliation；绝不改 task status、handle、routing attempt 或 acceptance，也不持久化 prompt、stdin、secret、environment、完整 provider argv 或 provider output。

  四个 harness 都提供真实 PID tracking；Codex 仅从已声明 `--json` transport 的 `thread.started.thread_id`、Kimi 仅从已声明 `--output-format stream-json` transport 的 `session.resume_hint.session_id` 升级 session/transcript/attach。Claude Code 可从显式 `--session-id`，或已声明 `--output-format json|stream-json` transport 的严格 `type=result / session_id` 信封取得 session identity，继而定位 transcript 并生成 `claude --resume <sid>` resume attach；绝不从任意模型文本猜身份，未观察到 session 证据时仍保持 PID-only，identity/attach 为 typed unavailable。显式 `--transcript` 指向已存在、可读的路径时，transcript 可独立为 typed supported；只有没有可读的显式 `--transcript` 时，transcript 才为 typed unavailable。Cursor 的 native session identity、SQLite transcript 与 exact attach 保持 typed unsupported，但显式 `--transcript` / `CURSOR_TRANSCRIPT_PATH` 可提供 raw transcript stream；无可读路径时仍可登记、stream 诚实为 none。claim 后 PID 前崩溃绝不自动重发；bind 失败取消并 reap owned process tree；terminal tracking failure 胜过 worker exit 0。`@ccm/engine` 新增 TrackedDispatch aggregate、BoardWriteAuthority/DispatchKey/TaskRef/RuntimeHandle value objects 及 additive `agents[].dispatch` lint/model 合约。

  Capability evidence 只允许 unavailable 与同值 supported 之间单调收敛；unsupported 与两者不可比，冲突 supported transcript/attach 也会 durable reconciliation。已落盘 closing replay 与 live terminal 使用同一套有界 persistence/reconciliation fallback，失败 receipt 只报告真正 durable 的 aggregate。

- 1c2e8ec: usage/quota 输出层重构(agent-facing 正确性 + 工效学):
  - **cursor 多池**:`GetCurrentPeriodUsage` 的 first-party 与 usage-based/spend-limit 池不再塌成一个数,`UsageSignal` 新增 `pools[]`(named·`kind:first_party|usage_based`)承载多池,`billing_period` 保留兼容;machine-wide TARGETS 分列 cursor 两池;provider-model-facts 标注模型 → 池归属。
  - **codex 按模型池**:`normalizeCodexRateLimits` 解析 `rateLimitsByLimitId`,每模型独立配额池透传(此前只读 legacy 顶层 primary/secondary·丢弃 per-model)。
  - **machine-wide refresh_hint**:`safeQuotaReading` 新增可选 hint 字段,unavailable/expired target 携带同源可执行提示(含 agent_authorized/authorization),不再只有不透明 reason_codes。
  - **agent-parse-proof**:`usage show` 新增顶层 plain-language `agent_summary`,一句话给出状态+可执行动作,消费 agent naive 读即得正确结论(此前窗口嵌 `current.*`、顶层空易致误判)。
  - doc 锁步:using-ccm command-catalog + pacing-and-estimation usage-signals 补 kimi-code、多池/hint/agent_summary 描述。全 additive·现有消费方字段语义不变。
- 1ae76ea: web-viewer #178 缓存 invalidation + agent-stream #180 per-harness 适配 + agent list stale advisory

  - **#178 web-viewer same-version 缓存永不失效修复**：`web-viewer-app-dist.ts` 加 build-id marker（sha256 over bundled base64 asset map）版本内 invalidation——快路径只在 marker 匹配时返回缓存，否则 rmSync 清孤儿 + 重 materialize + marker 写最后（crash-safe）。同版本号换前端构建时缓存自动失效，不再永久遮蔽（此前 VIEW STREAM/DDL 倒计时被旧 bundle 遮蔽看不到的根因）。
  - **#180 agent-stream per-harness 适配 + N-host parity**：kimi 结构化（源定位改 path-segment sid 匹配 + `parseKimiLine` 从 live wire.jsonl 推导 typed schema）；cursor 外部文本 transcript 短期方案（`CURSOR_TRANSCRIPT_PATH`）+ SQLite reader 声明 Track B；新增 agent-stream capability card 纳入 N-host parity matrix。
  - **agent list stale-running advisory**：`ccm agent list` 新增只读 `stale_candidates`（active agent 的 linked task 全 `done` → 疑似漏收口候选·**绝不自动 terminal**·保守判据），落在 recon roster-rebuild 触点机械兜住"收割后忘 terminal"的注意力遗漏。

- 1c2e8ec: 抬高 `ccm worker run` 的 stdout/stderr 输出上限：硬 ceiling 与默认值从 32 MiB 升至 512 MiB，stderr 独立上限从 8 MiB 升至 512 MiB。codex worker 的 stderr 动辄几十 MB，旧 8 MiB 独立上限会截断失败派发最需要的诊断流，32 MiB stdout ceiling 也会截断多十 MB 级真实载荷；新上限容纳多十 MB 级输出且仍 bound 失控 child（上限是 cap 不是预分配）。`--max-output-bytes` 允许范围相应变为 256..536870912、默认 536870912。

### Patch Changes

- f7a2105: rc2: cursor headless reliability, 2h worker timeout, and kimi machine-wide quota

  - **cursor worker reap**: a successful `ccm worker run --harness cursor-agent` no longer fails with `owned_tree_survived`. cursor-agent's launcher exits leaving its packaged `worker-server` node service (and the exact TypeScript language-service chain it starts, bound to the caller's npm cache) in the process group; these are now recognized as request-independent and reaped as benign. Classification binds to the exact `args` command line, not ps(1)'s `comm` (Node 24 reports `MainThread`). A real task, unrelated helper, mixed tree, lookalike outside the bound install/home roots, or unavailable inspection stays fail-closed (`owned_tree_survived`).
  - **cursor version admission**: `2026.07.16-899851b` is admitted (added to the frozen `SUPPORTED_CURSOR_AGENT_VERSIONS` / `binary_version` contract alongside the prior version); quota admission no longer blocks with `headless.binary-unsupported`.
  - **worker timeout ceiling**: `--timeout-ms` maximum raised from 1_800_000 (30 min) to 7_200_000 (2 h) so long agent dispatches are not hard-killed at 30 min; `run` default stays 600_000. CLI help, registry, catalog, and content contracts locked in step.
  - **kimi machine-wide quota**: `kimi-code` (`kimi-cli` surface, 5h + 7d windows) is now a machine-wide quota target, so `ccm quota status --machine-wide` observes kimi through the same unified per-harness UsageReading strategy — no per-harness collector branch. With a fresh login it reports `healthy`; an expired token degrades honestly to `unknown` (`QUOTA_SIGNAL_UNKNOWN`, never a fabricated window). Closes the silent omission where a quota-capable harness was absent from the machine-wide aggregation.

- e87dc08: Four-harness worker/usage parity fixes:

  - `worker run`: resolve a relative `--cwd` (e.g. `.`) against the launching process cwd — mirroring the omitted-`--cwd` default — instead of rejecting it in `validate()` before executable resolution and surfacing a confusing `executable:null` / `request_rejected` envelope (Finding #99). Fixes all four harnesses launching with a relative `--cwd`.
  - cursor usage: `readCurrentUsage` now tries the `cursor-agent-cli` surface (self-contained `auth.json`) and falls back to `cursor-ide-plugin`, returning the first surface with a live signal. A bare `--harness cursor` read no longer reports `unavailable` when only the headless agent is logged in — both surfaces observe one subscription pool.
  - kimi-code usage: new read-only managed `/usages` collector (`kimi-usage.ts`) that discovers the current-login token, GETs the rolling 5h + weekly windows, and parses the live protobuf-enum schema. It **never refreshes or rotates** the credential (expired token → honest degrade). kimi now reports real 5h/7d balances with zero unknowns while the token is fresh.

- Updated dependencies [1c2e8ec]
- Updated dependencies [42fb45e]
- Updated dependencies [42fb45e]
- Updated dependencies [42fb45e]
- Updated dependencies [707c2e5]
- Updated dependencies [33a47f9]
- Updated dependencies [1c2e8ec]
  - @ccm/engine@0.22.0

## 0.22.0-rc.4

### Minor Changes

- rc4: tracked worker dispatch, adapter-owned harness capabilities, and provider-facts refresh

  - **tracked dispatch**: `ccm worker dispatch` synchronously claims an idempotency key, spawns the real harness process, registers and binds the board agent, upgrades only from typed session/transcript evidence, and closes sanitized lifecycle facts with durable reconciliation. `ccm worker run` remains the zero-board-side-effect raw transport.
  - **stream/viewer seam**: registered dispatches expose the same harness-specific transcript evidence consumed by the existing Web Viewer stream surface; unsupported session or transcript capabilities remain explicit rather than guessed from model text.
  - **harness composition**: capability value objects, provider/strategy composition, catalog services, and adapter-owned discovery replace parallel switch/list ownership across quota, usage, statusline, account, worker, and upgrade consumers.
  - **provider facts**: refreshes current provider/model evidence and keeps model-policy candidates bound to attested facts.
  - **test integrity**: Turbo cache inputs now include plugin harness contracts and shared sources, with a mutation-kill regression test proving those inputs invalidate cached CCM tests.

## 0.22.0-rc.3

### Patch Changes

- rc3: multi-pool usage signals, agent-parse-proof output, kimi active token refresh, deadline engine

  - **multi-pool usage**: `usage show` / `quota status` model cursor first-party vs usage-based as independent, non-additive pools; codex per-model buckets via `rateLimitsByLimitId`; Claude fable 7d as an independent target. `UsageSignal` carries named `pools[]`.
  - **agent-parse-proof output**: top-level `agent_summary` + `refresh_hint` on `usage show`, and `refresh_hint` on machine-wide readings — a naive consumer reaches the correct state + action instead of reading a null nested window and giving up.
  - **kimi active refresh**: the kimi collector refreshes an expired short-lived access_token via the stored refresh_token under an advisory lock (re-read → refresh-only-if-expired → atomic write-back; the token never enters agent context); a failed auto-refresh falls back losslessly to the expired-recovery hint.
  - **worker output ceiling**: `worker run` stdout/stderr ceiling raised to 512 MiB.
  - **deadline engine**: DDL contract fields + `estimate deadline-risk` endpoint + notification state machine.

## 0.22.0-rc.2

### Patch Changes

- rc2: cursor headless reliability, 2h worker timeout, and kimi machine-wide quota

  - **cursor worker reap**: a successful `ccm worker run --harness cursor-agent` no longer fails with `owned_tree_survived`. cursor-agent's launcher exits leaving its packaged `worker-server` node service (and the exact TypeScript language-service chain it starts, bound to the caller's npm cache) in the process group; these are now recognized as request-independent and reaped as benign. Classification binds to the exact `args` command line, not ps(1)'s `comm` (Node 24 reports `MainThread`). A real task, unrelated helper, mixed tree, lookalike outside the bound install/home roots, or unavailable inspection stays fail-closed (`owned_tree_survived`).
  - **cursor version admission**: `2026.07.16-899851b` is admitted (added to the frozen `SUPPORTED_CURSOR_AGENT_VERSIONS` / `binary_version` contract alongside the prior version); quota admission no longer blocks with `headless.binary-unsupported`.
  - **worker timeout ceiling**: `--timeout-ms` maximum raised from 1_800_000 (30 min) to 7_200_000 (2 h) so long agent dispatches are not hard-killed at 30 min; `run` default stays 600_000. CLI help, registry, catalog, and content contracts locked in step.
  - **kimi machine-wide quota**: `kimi-code` (`kimi-cli` surface, 5h + 7d windows) is now a machine-wide quota target, so `ccm quota status --machine-wide` observes kimi through the same unified per-harness UsageReading strategy — no per-harness collector branch. With a fresh login it reports `healthy`; an expired token degrades honestly to `unknown` (`QUOTA_SIGNAL_UNKNOWN`, never a fabricated window). Closes the silent omission where a quota-capable harness was absent from the machine-wide aggregation.
  - @ccm/engine@0.22.0-rc.2

## 0.22.0-rc.1

### Patch Changes

- Four-harness worker/usage parity fixes:

  - `worker run`: resolve a relative `--cwd` (e.g. `.`) against the launching process cwd — mirroring the omitted-`--cwd` default — instead of rejecting it in `validate()` before executable resolution and surfacing a confusing `executable:null` / `request_rejected` envelope (Finding #99). Fixes all four harnesses launching with a relative `--cwd`.
  - cursor usage: `readCurrentUsage` now tries the `cursor-agent-cli` surface (self-contained `auth.json`) and falls back to `cursor-ide-plugin`, returning the first surface with a live signal. A bare `--harness cursor` read no longer reports `unavailable` when only the headless agent is logged in — both surfaces observe one subscription pool.
  - kimi-code usage: new read-only managed `/usages` collector (`kimi-usage.ts`) that discovers the current-login token, GETs the rolling 5h + weekly windows, and parses the live protobuf-enum schema. It **never refreshes or rotates** the credential (expired token → honest degrade). kimi now reports real 5h/7d balances with zero unknowns while the token is fresh.
  - @ccm/engine@0.22.0-rc.1

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

- 707c2e5: feat(model-policy): add Kimi K3 and Kimi K2.7 Code as worker-target model candidates

  - Provider facts: new `kimi-code` provider in `provider-model-facts.json` with two
    models — `kimi-k3` (frontier, 1M context, official benchmarks/model card not yet
    published) and `kimi-k2.7-code` (balanced, open-weight, forced-thinking, strong
    tool-use, 256K context). Both carry `benchmarks: null` on purpose: K3 has zero
    official benchmarks and K2.7's numbers are vendor self-selected sets that are not
    comparable to the cross-vendor `swe_bench_pro_pct` / `terminal_bench_2_1_pct`
    columns other providers use.
  - Provider whitelist + OFFICIAL_HOSTS gain `kimi-code` and Moonshot official hosts
    (`platform.kimi.ai`, `kimi.com`, `www.kimi.com`) so `ccm provider facts kimi-code`
    and `ccm model-policy show` expose the new snapshot.
  - Role candidates: `kimi-code-cli:kimi-k3` → `["T1","T2"]` (low confidence: benchmarks
    unpublished, carries an extra `official-benchmarks-unpublished` blocker) and
    `kimi-code-cli:kimi-k2.7-code` → `["T1","T2","T3"]` (medium confidence). Neither is
    an O candidate — conservative effect floor until benchmarks/certification arrive.
  - Community advisory: one bounded-tie-break-only Kimi K2.7 implementation-from-spec
    signal with honest limitations (vendor-self-benchmark context, single community
    review, coding below frontier on standard comparators).

  This only wires Kimi as a worker-target model provider into model-policy; it does not
  touch the origin-harness (`ORIGINS`) axis or the worker/harness enums.

- web-viewer #178 缓存 invalidation + agent-stream #180 per-harness 适配 + agent list stale advisory

  - **#178 web-viewer same-version 缓存永不失效修复**：`web-viewer-app-dist.ts` 加 build-id marker（sha256 over bundled base64 asset map）版本内 invalidation——快路径只在 marker 匹配时返回缓存，否则 rmSync 清孤儿 + 重 materialize + marker 写最后（crash-safe）。同版本号换前端构建时缓存自动失效，不再永久遮蔽（此前 VIEW STREAM/DDL 倒计时被旧 bundle 遮蔽看不到的根因）。
  - **#180 agent-stream per-harness 适配 + N-host parity**：kimi 结构化（源定位改 path-segment sid 匹配 + `parseKimiLine` 从 live wire.jsonl 推导 typed schema）；cursor 外部文本 transcript 短期方案（`CURSOR_TRANSCRIPT_PATH`）+ SQLite reader 声明 Track B；新增 agent-stream capability card 纳入 N-host parity matrix。
  - **agent list stale-running advisory**：`ccm agent list` 新增只读 `stale_candidates`（active agent 的 linked task 全 `done` → 疑似漏收口候选·**绝不自动 terminal**·保守判据），落在 recon roster-rebuild 触点机械兜住"收割后忘 terminal"的注意力遗漏。

### Patch Changes

- Updated dependencies [42fb45e]
- Updated dependencies [42fb45e]
- Updated dependencies [42fb45e]
- Updated dependencies [707c2e5]
  - @ccm/engine@0.22.0-rc.0

## 0.21.0

### Minor Changes

- fae016b: Agent Registry v1：board 新增 ✎ `agents[]` 运行时 agent 登记簿（凡派发皆登记的统一花名册·agent↔task join 存 agent 侧 `links[]`·id 遵守 run-store v2 ID 文法）+ 新 namespace `ccm agent` 七 verb（create/bind/link/terminal/probe/list/show·登记/探测/读取 noun，无任何 spawn/route/dispatch 语义）+ 按 handle 分级的活性探测与 reconcile（pid 存活 / codex·claude-code 会话文件 mtime / transcript mtime·拿不到即 unknown 保真·只写 agents[] 自己的 probe/lifecycle 字段）+ 两条 warn 级 lint（`FMT-AGENTS` 段形状 / `BIZ-INFLIGHT-AGENT` in_flight 未登记软提示）+ viewer agent 观测面。
- Add the cached coordination notification source used by machine-local monitor composition and cross-harness hook subscribers. Registration and delivery remain cached-only and provider-silent.
- 27e9330: 新增三路 origin 共用的 cached-only、shadow-only、4KiB 脱敏 orchestrator context delivery，
  并为 `ccm orchestrator context` 增加 additive `--agent-visible` 输出面。
- 4776c04: Separate review execution completion from dependency approval. Explicit review gates now keep downstream tasks blocked until the current attempt records an `APPROVE` verdict, invalidate prior verdicts at retry boundaries, and never reuse an omitted verdict from an earlier attempt.
- 2cd3f3d: Expose Goal Contract and safe cross-harness planning/routing read models in Web Viewer, with route-aware mission, inspector, DAG/list badges, filters, and shareable URL state.
- 96ca94c: Add opt-in declared delivery/dependency truth with candidate, target-delivery, and edge-qualification semantics; local-only Git, reviewed-reconciliation, and immutable-artifact proof; retry-safe evidence lifecycle; strict dry-run surfaces; and target, delivery, dependency, and attestation CLI commands. Existing boards and undeclared edges retain legacy readiness behavior, and strict-default remains disabled.
- df46609: Add the strict Codex exact-model admission A-now walking skeleton: a per-run supervisor combines live in-memory fact collection, pure deterministic W1 evaluation, preinvoke recheck, same-process at-most-once launch authority, and actual-identity reconciliation. Persistent evidence remains audit-only, automatic real-provider launch is disabled by default, and the frozen offline semantic matrix now runs in the default suite.
- Add machine-wide, cross-session quota posture and notification read models for all locally supported harnesses. Provider-scoped cached observations feed coordination, monitor, usage, quota, and shadow-routing consumers without allowing caller-invented authority or automatic account switching.
- 4b52f57: Add a fail-closed managed-attempt write-set compiler and diagnostic CLI preflight for isolated linked worktrees, with explicit artifact roots and fixed remote/account/network deny boundaries.
- 6047739: Add a provider-local offline Claude CLI driver fixture slice that consumes the shared canonical
  quota-admission ticket parser, digest, and launch-binding registry, with closed fail-closed runtime
  parsing, deterministic headless compilation, owned-process cancellation, and run-ref
  reconciliation.
- afedfe8: Add a public RuntimeEnvironment and PathResolver contract for deterministic Linux and macOS home, host-config, plugin-root, session-pointer, and executable resolution, and align CLI discovery and runtime consumers with that single portable path policy.
- 1f8ccc5: Add the platform-neutral immutable runtime supply chain used by cross-harness workers: official-provenance staging, append-only atomic activation commits, exact fd-backed invocation, crash-aware doctor/repair, and rollback without hot-reloading active images.
- Add `ccm worker` as a session-bound, raw-argv wrapper over locally installed Claude Code, Codex, and Cursor Agent CLIs. The command exposes target-native help and lifecycle management without pretending to normalize provider-specific arguments or sandbox guarantees.
- 4776c04: Add an atomic `task retry` lifecycle operation that archives prior attempt evidence, resets current attempt timestamps, artifact, and typed verification state, and applies the same safety contract to legal retry transitions through `task set-status`.
- Add opt-in cross-harness task-planning and agent-routing board contracts, validated transition gates, and dedicated CLI writers. Legacy boards remain compatible while contract-enabled attempts must carry difficulty, capability, permission, fallback, and immutable selection evidence before execution.
- 5d08d83: Add the fail-closed Codex native-attempt ledger, shared canonical launch identity, production owner-store admission/evidence composition, and crash-recoverable dedicated CLI transactions while keeping host invocation unsupported by default.
- 27e9330: Add fail-closed machine-surface eligibility and independent read-only Cursor IDE/Agent CLI discovery to the machine-wide harness inventory.
- 99c3189: 新增 Goal Contract v1：fresh board 以 pending skeleton 启动，`ccm goal set|confirm|amend|show|check` 原子管理 normalized goal 与受管、不可变、可校验的 Goal Brief；contract 激活后禁止通用 `board update --goal` 绕过 revision 审计，并新增对应 lint/capability。
- 704bab2: Add a mode-scoped Cursor Agent headless admission contract that independently gates binary, authentication, quota, sandbox, result schema, and explicit task acceptance. Inventory remains provider-silent and fail-closed, while fixture-only process effects reject RC0 empty/invalid results and keep sandbox failures separate from authentication.
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
- e0f2f37: Add a three-provider model-policy read model and pure advisory command. It keeps official provider facts, project role candidates, and expiring community task-affinity evidence separate; hard-gates effect floor and live admission before cost/quota/latency/context/integration ordering; and permits community taste only as a bounded tie-break.

  The advice request is fail-closed: every target binds a tracked candidate to current qualification and admission evidence, literal hard-gate booleans, and the current task-affinity registry revision. Caller-invented provider routes, evidence, target bindings, and never-on policy/security/permission/workspace/task overrides are rejected.

### Patch Changes

- cd8e495: Require every armed watchdog to carry a non-blank real wakeup handle, diagnose legacy missing-handle or expired records without blocking unrelated writes, and make disarm delete canonical and legacy records completely.
- 474b185: Make native runtime launcher materialization safe under concurrent cold invokes, directory-path replacement, and SIGKILL by keeping recoverable owner-only launcher and bootstrap lifecycle roots, binding publication and durability to one pinned directory object, publishing digest-pinned helpers with hard-link no-replace semantics, and reclaiming only strictly attributed abandoned objects.
- f68e380: Project cached Cursor IDE and Cursor Agent surface inventory into orchestrator pre-context without
  probing providers or enabling dispatch.
- e399200: Replace executable fd pseudo-path spawning with explicit platform assurance tiers: Linux keeps build-attested exact-fd execution, while macOS uses a build-attested final pathname identity/revision/digest check, advertises the remaining same-UID race, and rejects strict exact-object callers before spawning.
- a43b29f: Fix the graph view's "reset layout" button not clearing manually dragged node positions: the node/edge builder's memo was missing `resetKey` from its dependency list, so it kept returning the stale (dragged) positions even after the underlying dagre layout was recomputed. Reset now snaps every node back to its dagre position and refits, while manual drag persistence across polls and zero-repositioning on status-only updates are unaffected.
- 704bab2: Report Cursor IDE plugin and Cursor Agent headless CLI as separate local inventory surfaces, including executable path and explicit unknown/forbidden capability states without probing provider credentials or quota.
- e52dfd8: Scope `BIZ-EXECUTOR-HANDLE` to in-flight subagent and workflow tasks so future ready or blocked tasks do not produce false-positive warnings or invite placeholder handles.
- 7b46bb3: Make macOS monitor uninstall fail with a nonzero, replayable result when LaunchAgent unit removal fails after launchd deactivation, and bind live qualification to exact structured `launchctl bootout` evidence.
- Wait for an owned worker process tree to settle before returning terminal lifecycle evidence, preventing descendants from escaping cleanup after the direct child exits.
- 7ab0a9a: Add one crash-durable owner-only writer for persistent account, board, monitor, and web-viewer state, with explicit file/directory fsync outcomes and fail-closed hard errors.
- e904207: Prevent statusline auto-install's development guard from trusting repository markers placed at the shared system temporary-directory root. Real repositories below that boundary and worktree invocations remain suppressed, while isolated install paths no longer inherit transient `.git` markers from concurrent workers.
- 2d8c71c: Add a versioned `board-init/structured-board-path-v1` JSON capability: real `board init --json`
  returns the schema-owned `data.board_path`; `board init --capabilities --json` negotiates it without
  resolving a path or writing, and dry-run advertises compatibility without claiming an artifact.
- Updated dependencies [cd8e495]
- Updated dependencies [fae016b]
- Updated dependencies [f68e380]
- Updated dependencies [27e9330]
- Updated dependencies [4776c04]
- Updated dependencies [96ca94c]
- Updated dependencies [e52dfd8]
- Updated dependencies
- Updated dependencies [4b52f57]
- Updated dependencies [afedfe8]
- Updated dependencies [4776c04]
- Updated dependencies
- Updated dependencies [5d08d83]
- Updated dependencies [7ab0a9a]
- Updated dependencies [27e9330]
- Updated dependencies [99c3189]
- Updated dependencies [e904207]
- Updated dependencies [01dc896]
  - @ccm/engine@0.21.0

## 0.20.0

### Minor Changes

- c9c9518: Web viewer migration stage 1: the legacy MISSION CONTROL visual system replaces the
  prototype UI. The web-viewer app is rebuilt on the legacy instrument language (OKLCH
  dark+light token sets, 200x92 instrument-tile nodes with lamp/chips/rollup/gateflag/crit
  spine, header instrument rail, detail-rail block language, Legend, DecisionCard,
  DiscussHistory, board/list/timeline views, motion system with reduced-motion) on top of
  @xyflow/react + @dagrejs/dagre + bundled @fontsource fonts (zero runtime network). All
  new-generation capabilities are preserved: multi-board list/switch, search, filter chips,
  Share/Export/Reset, freshness indicator, report/diagnostics blocks, fixture fallback,
  responsive orientation. Server additions are strictly additive: `buildViewModel` gains an
  `insights` block (impact/convergence/bottleneck/wip/awaiting/age/per_node derived
  analytics — scheduling semantics stay server-side), `compactTask` whitelists
  justification/dep_pins/hitl_rounds/notes/tags/role/references, and a new
  `GET /decisions.json` endpoint serves discuss sidecars with cross-board stem guarding and
  per-file fault tolerance. No existing endpoint, schema, or CLI verb changed.
- c9c9518: Web viewer migration stage 2: board-model blind-spot fields come on screen. The
  view-model gains an additive `board_extras` passthrough block (judgment_calls / cadence /
  board-level watchdog / policy / coordination — a field missing on the board means the key
  is absent, never an error), `compactTask` whitelists the task-level `watchdog`, and
  `diagnostics.over_scheduling` is populated from the wip/wip_limit insight. `GET
/peers.json` graduates from stub to implementation: the same-home peer roster via the
  engine's `buildPeerRoster` (`ccm peers` source of truth — active + heartbeat-fresh boards
  only, priority-ordered, read-only, token-blind) plus the current board's
  coordination.inbox as a notification summary; unreadable homes and unknown boards degrade
  to an empty roster, never a 500. The UI renders the new information in the legacy
  telemetry block language: judgment-call ledger (category/severity/status badges,
  pending_review highlighted), cadence block (open iteration with timebox/member progress,
  shipped history, board watchdog readout), task-detail watchdog countdown with an
  expired/stale hint, peers block (goal/priority/heartbeat + inbox kind badges), structured
  acceptance-criteria table (desc/kind/status lamps) and estimate rendering (raw value +
  hours conversion), and the full status-report surface (health / next_actions / risks,
  report-freshness tag on diagnostics). Fixtures demonstrate every new visual state
  offline. No existing endpoint, schema, or CLI verb changed.

- feat: `ccm viewer` noun alias for `web-viewer`; five-zone shell + mega board switcher + dual-mode inspector polish on top of the stage-1/2 migration.

### Patch Changes

- @ccm/engine@0.20.0

## 0.19.1

### Patch Changes

- fix: biome format/import lint in `@ccm/engine` coordination modules and CLI handlers/tests; exclude generated web-viewer asset map from CLI biome checks (restores `ccm-ci` green).

- Updated dependencies
  - @ccm/engine@0.19.1

## 0.19.0

### Minor Changes

- feat: multi-orchestrator coordination inbox + pool arbiter (`coordination.inbox`, `reconcileInbox`, `ccm coordination inbox|notify|arbitrate`, deterministic pool-pressure fair-share).
- feat: optional `ccm monitor` daemon + `ccm services reconcile --after-binary-replace` for wanted monitor/web-viewer after binary install/upgrade.
- feat: co-lifecycle web-viewer assets with ccm binary upgrade — build-time inline `@ccm/web-viewer` dist map, versioned materialization under `<home>/services/web-viewer/app-dist/<version>/`, reconcile ensure + HTTP probe; listener port defaults to OS-assigned ephemeral (`--port 0`).
- feat: `ccm upgrade plugin` defaults to all installed plugin-distributable harnesses (`--harness` for single target).

### Patch Changes

- Updated dependencies
  - @ccm/engine@0.19.0

## 0.18.0

### Minor Changes

- 01dadc1: Add Cursor harness usage: billing_period window on UsageSignal / pacingAdvice (hold|throttle|stop_billing_period, never switch), plus cursor-dashboard GetCurrentPeriodUsage reader and harness adapter registration.

### Patch Changes

- feat: co-lifecycle web-viewer assets with ccm binary upgrade — build-time inline `@ccm/web-viewer` dist map, versioned materialization under `<home>/services/web-viewer/app-dist/<version>/`, reconcile ensure + HTTP probe; listener port defaults to OS-assigned ephemeral (`--port 0`).

- Updated dependencies [01dadc1]
  - @ccm/engine@0.18.0

## 0.17.2

### Patch Changes

- fix: make web-viewer health/shutdown helper work from the SEA binary

  - `ccm web-viewer start/status/restart` no longer tries to run the SEA executable as `node -e`; it uses the current Node executable in dev and `node`/`CCM_NODE_BIN` as the helper runtime when launched from the packaged ccm binary.

- Updated dependencies
  - @ccm/engine@0.17.2

## 0.17.1

### Patch Changes

- fix: derive web-viewer/status-report producer versions from the CLI version SSOT

  - `ccm web-viewer` health/state now reports the installed CLI version instead of a stale hard-coded version.
  - `ccm status-report` producer metadata now uses the same `readVersion()` path as `ccm --version`, including SEA `CCM_VERSION` injection.

- Updated dependencies
  - @ccm/engine@0.17.1

## 0.17.0

### Minor Changes

- feat: add ccm-native web viewer and generated status reports

  - `ccm web-viewer start/open/status/stop/restart/serve` manages a home-scoped localhost viewer service with PID/state files, token-gated URLs, stale process detection, read-only board/data routes, and no public `list` command.
  - The viewer service scans the configured home boards directory, supports initial board selection with `--board` / `--goal`, and serves the built `@ccm/web-viewer` React app for board switching, DAG canvas, status-aware node rendering, task inspection, board filters, export/share actions, and live board refresh within two seconds of local board file changes.
  - `ccm status-report render/write/show/watch` produces stable `ccm/status-report/v1` reports under `<home>/reports/status-report/` and powers the viewer Status module without writing board JSON.
  - CLI help, registry, router tests, service hardening tests, status-report tests, and large-board performance smoke fixtures now cover the new web-viewer/status-report surface.

### Patch Changes

- Updated dependencies
  - @ccm/engine@0.17.0

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

### Patch Changes

- Updated dependencies [aa13545]
  - @ccm/engine@0.16.0

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

### Patch Changes

- Updated dependencies [29f682f]
  - @ccm/engine@0.15.0

## 0.14.1

### Patch Changes

- 96e0f68: fix: expose board source for GitHub issue bootstrap

  `ccm board init` now accepts `--github-issue <url>` and stores it as a board-level source (`board.source.kind=github_issue`, `board.source.url`) so issue-based bootstrap is treated as a requirement source rather than synthetic task seed.

- Updated dependencies [96e0f68]
  - @ccm/engine@0.14.1

## 0.14.0

### Minor Changes

- 7ede866: Enforce true-done board integrity: `status=done` now requires `verified=true` and a non-empty `artifact`, and `ccm task done` writes without both evidence fields are rejected by validation.

### Patch Changes

- Updated dependencies [7ede866]
  - @ccm/engine@0.14.0

## 0.13.0

### Minor Changes

- Host-aware ccm plumbing for multi-harness installs:
  - Adds Claude Code / Codex / generic harness registry support plus `ccm harness` discovery.
  - Adds Codex app-server rate-limit consumption for `usage show` / `usage advise`.
  - Updates `ccm upgrade` to report Codex plugin install roots and support host-specific plugin upgrade/install planning.
  - Adds `runtime.stop_allow_until` support through `ccm board set-param` so Codex Stop hooks can intentionally release a bounded continuation block.

### Patch Changes

- Updated dependencies
  - @ccm/engine@0.13.0

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

### Patch Changes

- Updated dependencies [70307e8]
- Updated dependencies [2f9890c]
  - @ccm/engine@0.12.0

## 0.11.0

### Minor Changes

- ccm 线首个独立发版（ccm-v0.11.0·版本线解耦后·ADR-022）。本轮两项新功能：

  - **`ccm upgrade` 命令** — ccm 自更新子命令：就地把本机 `ccm` 二进制升级到 ccm 线最新 release（按 `ccm-v*` tag 解析），免重跑 install.sh。
  - **`GRAPH-CONNECTED` 连通性 lint 规则** — board lint 新增一条 warn 级规则：把 `deps` ∪ `parent` 容器边当无向边算弱连通分量，分量 > 1（图被切成互不相连的孤岛子图）时提示规划失焦（漏连依赖 / 任务不属于本目标）。连通性计入 parent 容器边（ADR-012），`deps:[]` 的嵌套子任务经其 owner 连进主图、不被误判孤岛。

### Patch Changes

- Updated dependencies
  - @ccm/engine@0.11.0
