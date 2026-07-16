# ccm

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
