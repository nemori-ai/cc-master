# ccm

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
