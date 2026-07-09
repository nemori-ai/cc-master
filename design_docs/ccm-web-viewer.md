# `ccm web-viewer` 设计规格

> 状态：设计定稿 / 待实现（WV12 / WV13 / WV8）。
> 决策依据：[ADR-029](../adrs/ADR-029-ccm-web-viewer-namespace.md)；status report module 依据 [ADR-030](../adrs/ADR-030-ccm-status-report-and-viewer-module.md)。
> 本文是 evergreen 设计：描述目标状态。旧 `/cc-master:view` 设计记录见 [`2026-06-16-board-view-and-dag-webview.md`](2026-06-16-board-view-and-dag-webview.md)，其 viewer 只读与零联网不变式仍有效；启动入口与生命周期归属被 ADR-029 替换。

---

## 1. Product boundary

`ccm web-viewer` 是 ccm 的正式 namespace，用来启动和管理本地 board web viewer。它不是 plugin command 的别名，也不是 prompt-only skill。用户入口统一为：

```bash
ccm web-viewer open
```

定位：

- **ccm owns lifecycle**：PID、token、URL、state file、stale cleanup 都由 ccm 管。
- **viewer is read-only**：只读 board，所有 board 写入仍走其它 ccm write verbs。
- **status is generated**：board 状态报告由 `ccm status-report` 生成稳定 JSON / artifact，viewer 只消费报告，不靠 agent prompt 临场写 prose。
- **frontend is an app build artifact**：目标 UI 不是长期手写静态 HTML shell；短期 vanilla shell 只可作为 bootstrap/prototype/smoke harness，不能作为验收目标。
- **viewer is an operational visualization workspace**：首屏是可操作、可扫描的 board DAG / status 工作台，不是 landing page、marketing hero、也不是静态 JSON browser。
- **harness-neutral**：Claude Code、Codex、未来 harness 都只需要告诉用户跑同一个 terminal command。

## 2. Command contract

`web-viewer` is a static ccm namespace: implementation adds it to `ccm/apps/cli/src/registry.ts` `REGISTRY`, imports its handler in `router.ts`, and adds it to the static `HANDLERS` map. It is not dynamically discovered from a plugin.

所有命令复用 ccm 全局 flags / context：`--home`、`--board`、`--goal`、`--session-id`、`--json`、`--no-input`。`--home` 决定 service scope；正常生命周期是一份 home 对应一个可复用 service，service 启动后扫描 `<home>/boards/`，viewer 内可列出 / 切换 boards。`--board` / `--goal` 只用于选择初始 board，不参与 service identity。Home / initial selection resolution must reuse `discover.ts` (`resolveHome`, `boardsDir`, `resolveBoard`) instead of creating a second selector.

| Command | Human output | JSON output |
|---|---|---|
| `ccm web-viewer start [--board <path>\|--goal <substr>] [--home <dir>] [--host 127.0.0.1] [--port 0] [--reuse] [--no-open]` | 打印 home-scoped service URL 与初始 selection 摘要；已有同 home 健康实例则按 `--reuse` 复用。 | `{ok, service, reused, open_url?}` |
| `ccm web-viewer open [<id>] [--board <path>\|--goal <substr>] [--home <dir>] [--no-start]` | 打开 / 聚焦 home-scoped service URL；默认可无实例时 start-then-open，`--no-start` 只打开既有实例；`--board` / `--goal` 只设置初始 selection URL/query/state。 | `{ok, service, opened, open_url?}` |
| `ccm web-viewer status [<id>] [--home <dir>]` | 显示 running / stale / stopped、pid、redacted URL、home、current selection。 | `{ok, running, service}` |
| `ccm web-viewer stop [<id>] [--home <dir>] [--all] [--yes]` | 停掉 home-scoped 服务或清 stale state。 | `{ok, stopped, service}` |
| `ccm web-viewer restart [<id>] [--board <path>\|--goal <substr>] [--home <dir>]` | 停旧启新，打印新 URL；`--board` / `--goal` 只设置新实例的初始 selection。 | `{ok, previous, service, open_url?}` |
| `ccm web-viewer serve --state <path>` | internal daemon target；由 `start` spawn，用户不直接调用。 | `{ok}` only for diagnostics if needed |

可选扩展 flags：

- `--host 127.0.0.1`：v1 只允许 `127.0.0.1`，不接受 `0.0.0.0`。
- `--port <n>`：仅 `start` / `restart`；默认 `0` 让 OS 分配。固定端口碰撞必须 fail cleanly。
- `--all`：`stop --all` 批量停掉 / 清理本 home 下残留 viewer state；正常模型仍是一份 home 一个 service。
- `--no-open`：`start` 不尝试打开浏览器。
- `--no-start`：`open` 不自动启动服务，只打开 / 打印同 home 已有健康 service。

### 2.1 JSON service shape

`service` 对象字段稳定且 token-redacted：

```json
{
  "id": "wv_7f3d9c2a",
  "pid": 12345,
  "state_path": "/home/u/.cc_master/services/web-viewer/instances/wv_7f3d9c2a.json",
  "token_file": "/home/u/.cc_master/services/web-viewer/tokens/wv_7f3d9c2a.token",
  "token_sha256": "sha256:...",
  "home": "/home/u/.cc_master",
  "initial_board_path": "/home/u/.cc_master/boards/20260708T120000Z-123.board.json",
  "current_selection": {
    "board_path": "/home/u/.cc_master/boards/20260708T120000Z-123.board.json",
    "goal": "Ship feature X"
  },
  "scope": {
    "home": "/home/u/.cc_master",
    "session_id": "..."
  },
  "host": "127.0.0.1",
  "port": 51234,
  "base_url": "http://127.0.0.1:51234",
  "url": "http://127.0.0.1:51234/?token=<redacted>",
  "server": {
    "started_at": "2026-07-08T12:01:02Z",
    "ccm_version": "0.14.0"
  },
  "log_path": "/home/u/.cc_master/services/web-viewer/logs/wv_7f3d9c2a.log",
  "stale": false,
  "health": "ok"
}
```

`start` / `open` may additionally return one-time `open_url` with the raw token. `status` / `list` must never expose the raw token; they show only redacted `url`, `token_sha256`, and `token_file`.

## 3. Service state

State root:

```text
<cc-master-home>/services/web-viewer/
```

Files:

```text
<home>/services/web-viewer/
  registry.lock
  instances/<id>.json
  tokens/<id>.token
  logs/<id>.log
```

Minimum file content:

```json
{
  "schema": "ccm/web-viewer-service/v1",
  "id": "wv_7f3d9c2a",
  "pid": 12345,
  "host": "127.0.0.1",
  "port": 51234,
  "base_url": "http://127.0.0.1:51234",
  "url": "http://127.0.0.1:51234/?token=<redacted>",
  "token_sha256": "sha256:...",
  "token_file": "/abs/.cc_master/services/web-viewer/tokens/wv_7f3d9c2a.token",
  "home": "/abs/.cc_master",
  "initial_board_path": "/abs/.cc_master/boards/20260708T120000Z-123.board.json",
  "current_selection": {
    "board_path": "/abs/.cc_master/boards/20260708T120000Z-123.board.json",
    "goal": "Ship feature X"
  },
  "scope": {
    "home": "/abs/.cc_master",
    "session_id": "..."
  },
  "server": {
    "started_at": "2026-07-08T12:01:02Z",
    "ccm_version": "0.14.0"
  },
  "log_path": "/abs/.cc_master/services/web-viewer/logs/wv_7f3d9c2a.log"
}
```

Rules:

- Create service root with `0700` where the platform allows it; write token files `0600` plaintext; instance JSON should not contain raw token.
- `service-id` should be stable for `{home realpath}` in the default home-scoped model, unless a future explicit multi-instance flag exists.
- `registry.lock` guards concurrent `start` / `restart` / `stop` operations. Concurrent starts must not create duplicate instances for the same home unless a future explicit multi-instance flag exists.
- `start` writes state only after the service has bound a port and passed a tokened health probe.
- `initial_board_path` is only a launch hint / first UI selection. The running service scans `<home>/boards/` and tracks current selection separately from lifecycle identity.
- `status` and `list` must tolerate malformed / partial state files: mark them invalid in human output and include an error entry in JSON; do not crash.
- stale cleanup is explicit on `start` / `restart` / `stop`; `status` may report stale without deleting unless a `--clean` flag is later added.
- stale detection requires PID liveness plus authenticated `GET /_ccm/health` matching `schema`, `id`, `pid`, and `started_at`. PID-only is unsafe.
- `stop` prefers authenticated shutdown when implemented, then SIGTERM, then stale cleanup.

## 4. Runtime service

The service is a local HTTP server with these routes:

| Route | Behavior |
|---|---|
| `GET /` | Serve the packaged frontend app entry after token validation; set same-origin token cookie. A temporary smoke shell is allowed only before the app build artifact exists. |
| `GET /_ccm/health` | Return `{schema,id,pid,started_at,ccm_version}` after token validation. |
| `GET /boards.json` | Scan `<home>/boards/`, return selectable boards and active/current metadata after token validation. |
| `GET /view-model.json` | Primary frontend payload. Return ccm-owned board workspace read model for the selected board: graph topology, status buckets, ready set, critical path, freshness, diagnostics, and UI-safe defaults. |
| `GET /task.json` | Lazy detail payload for a selected task / decision / activity row used by the inspector or detail rail. |
| `GET /board.json` | Debug / backcompat only. Fresh-read the selected allowed board and return raw board JSON or recoverable read error; the app must not use this as its polling/analyze loop. |
| `GET /status-report.json` | Return the generated `ccm/status-report/v1` report for the current or requested allowed board; compute or refresh through the status-report path when missing/stale. |
| `GET /assets/*` | Serve packaged local assets only. |
| `POST /_ccm/shutdown` | Optional internal graceful shutdown control route; token-gated, local-only, no board writes. |
| other GET | 404. |
| other non-GET | 405. |

Board read failures are recoverable. A torn write, invalid JSON, or transient read failure must not kill the service; return a structured error and let the browser keep its last good render.

## 5. Status report module

Each board detail page has a **Status** submodule or subpage backed by `ccm status-report`, not by prompt-time agent prose. The browser route is:

```text
GET /status-report.json?board=<board-file>&max_age=30s
```

Route behavior:

- `board` is a board filename under `<home>/boards/`; absent means current selection. Arbitrary paths are rejected.
- The response schema is the ccm-owned `ccm/status-report/v1` envelope. Viewer code treats it as the Status module SSOT.
- Missing artifact: compute synchronously via the status-report compute/write path and return the fresh report.
- Stale artifact: return the stale report with `artifact.freshness:"stale"` if that is the fastest safe response, and trigger one background refresh; if no usable stale artifact exists, compute synchronously.
- Compute failure: return a structured recoverable error; do not crash the service and do not fall back to inventing a prose summary in the browser.

Durable artifacts live outside the service cache:

```text
<home>/reports/status-report/
  cache.lock
  boards/<board-file-stem>.status-report.json
```

The viewer may keep short in-memory state to avoid duplicate refreshes, but the durable report belongs to `ccm status-report`, not to `<home>/services/web-viewer/cache/`. CLI users and future clients must be able to read the same artifact without a running viewer.

Freshness fields come from the report artifact:

- `board_hash` over board file bytes.
- `board_mtime_ms` / `board_size` as cheap pre-checks.
- `topology_hash` over normalized scheduling inputs that drive DAG/status sections.
- `advisory_hash` over non-board advisory inputs used by the report, such as usage/estimate snapshots.
- `input_hash` over the full compute contract.
- `expires_at` / `freshness` for TTL-based time-sensitive sections.

Periodic update policy:

- Correctness comes from lazy compute on route access.
- While the viewer service is running, it may warm reports on an interval for the current board and active boards.
- `ccm status-report watch` is the headless equivalent for users who want periodic artifacts without the viewer.
- Watchers and service intervals call the same `status-report write` path; they never implement a second reporter.

Minimum UI content:

- progress summary: total, true done, in-flight, ready, blocked.
- blocked-on-user decisions first, including the board-provided discuss/current-thread entry command when available.
- in-flight tasks with age, executor/handle, and hedge/risk markers.
- ready-to-dispatch tasks from the authoritative ready set.
- critical path chain with makespan and weight source.
- health cards for lint, over-scheduling, usage verdict, and report freshness.
- next actions split into `ready_to_dispatch`, `awaiting_user`, and operator attention.

The DAG view reads `/view-model.json`; task detail reads `/task.json`; `/board.json` is debug/backcompat. The Status module reads `/status-report.json` and does not derive a competing status model from raw board JSON.

## 6. Security invariants

- Bind `127.0.0.1` only.
- Token gate every route that reveals viewer UI, board data, health, or assets. Initial `?token=` may set a same-origin cookie so asset requests do not need tokenized URLs.
- Viewer/data/static routes are GET-only and read-only; no route writes board. The only allowed non-GET is optional internal authenticated shutdown, and it must not write board data.
- Zero external network: no CDN, no remote fonts, no telemetry, no update checks.
- Asset path containment: resolved asset path must remain under packaged asset root.
- Board path containment: HTTP board selection is allowed only among canonical boards under `<home>/boards/`, plus any explicit launch board allowlisted by the final design. Requests cannot read arbitrary board paths. Current selection is UI/runtime state, not service lifecycle identity.
- Report path containment: status report artifacts are selected by canonical board filename and resolved under `<home>/reports/status-report/`; requests cannot read arbitrary report files.
- State path containment: service files only under `<home>/services/web-viewer/`; no request can read arbitrary state files.
- No permissive CORS. Prefer `Cross-Origin-Resource-Policy: same-origin`, `Referrer-Policy: no-referrer`, and `Cache-Control: no-store` for board/state responses.

## 7. Frontend app architecture

### 7.1 Target stack

The target architecture is a ccm-owned frontend app build, not a static hand-written HTML shell.

Recommended baseline:

- **Vite + React + TypeScript** for the app package, local dev server, typed components, and production build artifact.
- **Graph/DAG rendering candidates**：React Flow / XYFlow for interactive node-edge views; elkjs or dagre for automatic layout; Canvas/SVG hybrid where large boards need performance. The choice is implementation-level but must be validated with browser screenshots and interaction QA.
- **UI system candidates**：shadcn/Radix/Tailwind if we want a pragmatic component kit; or a project-owned token/component system if we want fewer dependencies. Either path must support dense dashboards, keyboard/mouse interaction, responsive layouts, accessibility, and visual regression checks.
- **Service host**：`ccm web-viewer` may stay on stdlib `node:http` while it serves APIs and static assets. Hono/Fastify are optional future server choices only when route complexity justifies them.

Rejected target:

- A hand-written single-file HTML/CSS/JS shell is rejected as the long-term architecture. It may be used only as a smoke shell while service lifecycle and endpoint contracts are being stabilized.
- A milestone that still uses the smoke shell must explicitly say what remains before app-stack acceptance.

### 7.2 Service/API boundary

The viewer is split into a local ccm service and a frontend app:

- The service owns lifecycle, token gate, static asset serving, board/status read endpoints, path containment, stale detection, and shutdown.
- The frontend app consumes JSON APIs: `/boards.json`, primary `/view-model.json`, lazy `/task.json`, debug/backcompat `/board.json`, `/_ccm/health`, and `/status-report.json`.
- The frontend may keep ephemeral UI state such as selected board, focused node, active tab, filters, layout viewport, and panel state.
- The frontend must not copy the board/status source of truth into a second model. It does not reimplement board validation, status enum, `isAwaitingUser`, done/verified semantics, status-report grouping, ready-set calculation, critical path calculation, dependency validity, or scheduler semantics.
- Board writes remain outside this namespace. Filters, focus modes, layout pinning, screenshots, or exports must not mutate board JSON.

### 7.3 Runtime and packaging constraints

The app build artifact must fit ccm release constraints:

- Runtime zero external network: no CDN, remote fonts, telemetry, update checks, or remote module imports.
- Production assets are served from repo/dev build output during development and from the ccm packaged/release artifact in distribution.
- The release plan must choose one tested asset strategy: generated TypeScript asset map, bundled asset manifest, Node SEA asset support, or an explicit extraction/lookup contract.
- Loose sidecar assets are acceptable only if release tests prove `ccm web-viewer` can locate and serve them from the packaged artifact on supported platforms.
- Asset serving must keep strict containment under the packaged asset root.

### 7.4 Plugin-informed workflow

Use the marketplace/plugin research as workflow guidance:

- `build-web-apps` is the right helper for app scaffolding, UI redesign, interaction states, responsive/browser QA, and visual polish.
- `build-web-data-visualization` is the right helper for DAG/dashboard design, critical path visualization, graph layout trade-offs, accessibility of graph views, and visual regression checks.
- `figma` is useful for design-system or high-fidelity design work when the user authorizes it. It is not a blocking prerequisite for this repo.
- Asset-generation/external-platform plugins are not part of the default workflow because the viewer needs local product UI, local data visualization, and zero runtime network.

### 7.5 Operational workspace information architecture

The viewer is an operational visualization workspace. It must open on a usable board operations surface, not a landing page, hero, static JSON browser, or explanatory marketing shell.

Large-screen first viewport:

- compact top command/status bar: board switcher, search, mode tabs, live/stale/read freshness, token/session status, reset/share/export controls.
- left rail: home / boards overview, board list, filters, status buckets, outline of task groups or DAG ranks, active critical-path toggle.
- central viewport: primary DAG/topology canvas with pan/zoom/reset, selected-neighborhood focus, critical-path overlay, stale/error banner that does not erase last-known-good graph.
- right rail: inspector or Status rail for selected task, awaiting-user decision, current thread command, in-flight handle, report freshness, diagnostics, and activity snippets.

Do not put cards inside cards or make the page a decorative dashboard grid. Use rails, dividers, dense lists, tables, compact panels, and one dominant evidence viewport. Cards are allowed only for repeated atomic summaries where a list/table would be worse; nested cards are not allowed.

Required IA modules:

- **Home / boards overview**：service-scoped home, board count, running/stale service state, most recent boards, active boards, board health, and no-board empty state.
- **Board workspace**：selected board goal, owner/session metadata, freshness, progress summary, command/status bar, and URL-restorable workspace state.
- **DAG / topology**：task dependency graph, rank/layer flow, selected neighborhood, ready set, critical path, blocked/awaiting-user emphasis, and topology diagnostics.
- **Status module**：`ccm/status-report/v1` summary for progress, awaiting-user, in-flight, ready, blocked, risks, freshness, and next actions.
- **Tasks / decisions / detail rail**：lazy `/task.json` detail for selected task, decision, activity/log item, or status card. The rail should preserve graph context instead of navigating away for ordinary inspection.
- **Peers / activity / diagnostics**：executor handles, stale peers, report freshness, board lint / over-scheduling / token or session errors, and service diagnostics.

Default selection and navigation:

- `ccm web-viewer open --board` or `--goal` sets initial selected board and optional focused task/path query state.
- If no initial board is specified, the app opens the boards overview and selects the most recent active board when that is unambiguous; otherwise it asks the user to choose from the board list without showing a blank graph.
- Selecting a board updates board switcher, URL state, left outline, central DAG, right inspector, and Status module together.
- Selecting a task in the graph, outline, search result, Status module, or activity list commits the same selected task ID and opens or refreshes the inspector.
- Hover/preview may highlight a neighborhood but must not replace committed selection or pollute URL state.
- Empty-canvas click may clear selection only when it is not a drag; reset controls restore default board selection, filters, and viewport.

Search, filters, and URL state:

- URL/share state candidates: `board`, selected `task`, module/tab, search query, status filters, executor filters, critical-path/focus mode, DAG viewport target or saved zoom, mobile active panel.
- URL state uses stable IDs or canonical board filenames, never visible labels.
- Search covers task id/title, executor/handle, status bucket, awaiting-user decisions, and activity snippets when available. Search results must be keyboard reachable and able to step through dense graph matches.
- Filters must show active chips/counts near the affected view and provide reset. Closed panels must still expose active filters, selected task, freshness, caveat/source, and reset path.

Last-known-good, stale, and error states:

- Torn JSON, deleted board, malformed board, stale status report, token/session error, service reconnect, and partial payload states must be distinguishable.
- The app keeps the last-known-good `/view-model.json` render visible when a refresh fails, with a stale/error banner and timestamp.
- A recoverable read error must not clear selection, collapse panels, or replace the DAG with a generic empty screen.
- Empty board and no boards are separate states: empty board shows a valid workspace with zero tasks; no boards shows home overview and service diagnostics.

### 7.6 Read-model API contract

`/view-model.json` is the primary app payload. It exists to keep board/status/scheduler semantics in ccm-owned code instead of recreating them in the browser.

Minimum target envelope:

```json
{
  "schema": "ccm/web-viewer-view-model/v1",
  "board": {
    "id": "20260708T120000Z-123",
    "filename": "20260708T120000Z-123.board.json",
    "goal": "Ship feature X",
    "mtime_ms": 1783512062000,
    "hash": "sha256:..."
  },
  "freshness": {
    "state": "live",
    "last_read_at": "2026-07-08T12:01:02Z",
    "last_known_good_at": "2026-07-08T12:01:02Z",
    "errors": []
  },
  "graph": {
    "family": "task-dag",
    "nodes": [],
    "edges": [],
    "ranks": [],
    "critical_path": [],
    "ready_set": []
  },
  "status": {
    "buckets": [],
    "awaiting_user": [],
    "in_flight": [],
    "blocked": [],
    "done_verified": []
  },
  "diagnostics": {
    "lint": [],
    "over_scheduling": [],
    "report_freshness": "fresh"
  },
  "defaults": {
    "selected_task_id": null,
    "focus": "critical_path_or_ready"
  }
}
```

The exact schema can evolve during implementation, but ownership cannot:

- `@ccm/engine` remains the board/graph/status semantic SSOT.
- The service/read-model layer computes status grouping, ready set, critical path, dependency validity, blocked/awaiting-user semantics, done/verified semantics, freshness, and diagnostics.
- The frontend renders the payload, manages ephemeral UI state, and requests detail; it does not define its own status enum, task lifecycle, scheduler, or graph analysis.
- `/task.json?board=<file>&task=<id>` returns the lazy detail needed by the inspector: full task fields, decision/log excerpts, executor/handle detail, dependencies/dependents, and source references. It rejects non-contained board names and unknown task IDs with recoverable structured errors.
- `/board.json` is debug/backcompat for raw board inspection and parity tests. It is not the normal app state loop and must not be polled every 2s by the frontend to rebuild graph/status.

### 7.7 DAG layout contract

The graph family is a directed acyclic board task DAG. The default layout must preserve dependency direction and scheduling traceability.

Layout requirements:

- Default algorithm family: layered / Sugiyama-style layout. ELK layered, dagre, or an equivalent deterministic DAG layout engine are acceptable candidates.
- Renderer/interaction: React Flow / XYFlow may own viewport interaction, selection, handles, keyboard focus, and overlays; the layout engine owns node placement. Do not use React Flow's interaction model as a substitute for a real DAG layout phase.
- Force-directed layout is rejected as the main solution. It may appear only as a clearly labeled exploratory fallback for non-DAG diagnostics, never as the default board task DAG view.
- Layout inputs use real node widths/heights, label constraints, rank/order constraints from graph semantics when available, and stable IDs.
- Separate phases are expected for node placement, edge routing, overlap removal, label placement, component packing, and viewport fit.

Graph readability contract:

- Direction must be visually obvious without reading instructions.
- Long task titles wrap or truncate with accessible full text; they do not resize nodes unpredictably or overlap edges.
- Edges do not run through node bodies or important labels. Critical path / selected neighborhood edges have stronger visual treatment but preserve status color semantics.
- Edge labels, dependency counts, and status badges must not obscure node titles or handles.
- Layout should be stable across refreshes when graph topology has not materially changed; selected task and viewport should not jump on every poll.
- 200+ node boards must remain usable through focus/filter/outline strategies rather than shrinking text below readability.

Dense graph fallbacks:

- focus mode: selected task neighborhood, ready set, awaiting-user blockers, in-flight set, or critical path.
- filters: status bucket, executor/handle, owner/session, blocked reason, text search, tag/area if present.
- outline/list: synchronized task outline by rank/status, keyboard step-through, and search result list.
- critical-path mode: show path chain, makespan/weight source, and off-path context with reduced visual weight.
- selected-neighborhood mode: N-hop dependencies/dependents with breadcrumbs back to full graph.
- optional matrix/list fallback: when the node-link view is too dense for reliable tracing, provide a dependency matrix, adjacency list, or task table that preserves reachability evidence.

### 7.8 Concept-first design gate

Before implementing the app UI, WV19 / WV20 must pass a concept-first approval gate. This gate is mandatory because the viewer's layout and graph composition materially affect how users understand board state.

Required concept set:

- large-screen operational workspace concept: command/status bar, tri-pane shell, central DAG viewport, left board/outline/filter rail, right inspector/Status rail, selected/default state.
- mobile portrait concept: main visualization visible or immediately reachable, compact command bar, drawer/bottom sheet filters/details, selected task/detail behavior, stale/error state treatment.
- mobile landscape concept: wide DAG tracing surface for selected neighborhood / critical path / search step-through, with touch pan/zoom and compact detail controls.

Approval workflow:

- Produce concepts before frontend implementation. If Image Gen is available, generate the concept images. If Image Gen is unavailable, provide exact prompts plus a written semantic design contract and stop at the same approval gate.
- If the Browser plugin is available for rendered validation, use it first in later QA. If it is unavailable, the implementation plan must record the fallback to Playwright screenshots.
- Ask the user to approve or request targeted changes. Do not scaffold app UI, write component code, or finalize implementation details while approval is pending.
- After approval, extract a semantic design contract: shell, reading order, viewport hierarchy, locked/flexible elements, color semantic roles, typography density, panel behavior, mobile continuation, landscape rationale, interaction states, export behavior, and approved deviations.
- The approved concepts are not moodboards. Implementation may tune pixels and component mechanics, but cannot silently change layout hierarchy, data-bound layers, source/caveat placement, interaction meaning, or mobile reading path.

### 7.9 Mobile, accessibility, export, and reduced motion

Mobile strategy:

- Mobile portrait does not stack desktop rails before the graph. Start with a compact command bar and the main evidence or an immediately reachable main evidence view.
- Filters, board list, outline, and details live in drawers, bottom sheets, tabs, or collapsible panels. Applying or closing a panel returns focus/scroll to the affected visualization.
- Touch targets follow coarse-pointer sizing; dense graph nodes get enlarged hit regions, search, nearest-node selection, and previous/next step-through.
- Hover interactions have tap/focus/selection replacements. Essential values, caveats, and source/freshness are visible without hover.
- Define pan/zoom ownership with `touch-action`, scroll containment, explicit zoom/reset controls, and alternatives to drag-only actions. One-finger page scroll should not be trapped by default.
- Search/filter input must account for the on-screen keyboard and visual viewport; the only Apply/Close action must not be hidden by the keyboard.
- Mobile landscape is a first-class tracing mode for wide DAGs, not an afterthought. It may favor the graph viewport and compact overlays over the portrait command/drawer layout.
- Stale/offline/reconnect/partial states preserve last-known-good evidence on mobile just as on desktop.

Accessibility and inclusive visualization:

- Provide a text outline of the graph: board goal, status bucket counts, critical path chain, ready set, awaiting-user decisions, selected task, dependencies, and dependents.
- Keyboard paths must cover board switcher, search, filters, DAG node selection or outline equivalent, detail rail, Status module, reset, export, and copy/share URL.
- Screen-reader and no-pointer users must be able to reach the same task detail and selected-path evidence through outline/search/list paths even if the node-link canvas is not fully screen-reader navigable.
- Use semantic color roles with redundant encodings: status, selected, hover preview, critical path, stale/error, blocked/awaiting-user, disabled, and diagnostics. Do not rely on color alone.
- Respect `prefers-reduced-motion`; graph transitions, polling flashes, and focus animations must have static or reduced alternatives.
- Any export/static screenshot must preserve evidence: selected board, active filters, selected task/path, source/freshness, stale/error state, and enough labels to interpret the graph without hover.

### 7.10 Browser and visual QA gate

Frontend acceptance requires browser-visible evidence, not only unit tests or a successful build.

Required fixture states:

- canonical small board, dense 200+ node board, long task title board, empty board, no boards, malformed/torn board, deleted selected board, stale status report, token/session error, partial `/view-model.json`, and last-known-good refresh failure.
- graph states: full DAG, critical-path focus, selected neighborhood, search result, filtered view, matrix/list fallback if implemented.
- responsive states: desktop, mobile portrait, mobile landscape, keyboard-open mobile search/filter, drawer/bottom-sheet open and closed.

Required visual/browser checks:

- desktop/mobile/landscape screenshots for the same board state.
- render-ready/nonblank checks for the app shell and graph viewport.
- no-overlap checks for long titles, dense nodes, status badges, edge labels, rails, drawers, and inspector content.
- interaction checks for pan, zoom, reset, select node, clear selection, search, filter, board switch, Status module, detail rail, stale/error recovery, export/static screenshot, and URL restore.
- accessibility checks for keyboard navigation, focus visibility, text outline, hover replacement, reduced-motion mode, and color role redundancy.
- network/security checks: no external network, no remote font/CDN/telemetry/update check, token gate preserved, non-GET data/static routes rejected, no board writes, path containment for assets/boards/reports.
- deterministic visual regression: fixed viewport sizes, fixed fixtures, stable fonts/tokens, reduced animation, render-ready signals, and no live image generation inside tests.

## 8. Packaging boundary

Target layout:

- `ccm/apps/cli/src/registry.ts` adds noun `web-viewer`.
- `ccm/apps/cli/src/router.ts` imports the handler module and adds it to the static `HANDLERS` map.
- `ccm/apps/cli/src/handlers/web-viewer.ts` owns command behavior.
- ccm package includes viewer server and built frontend app assets, either under `apps/cli/src/web-viewer/`, a dedicated app package, or a package-owned asset directory copied into the SEA/bundle.
- shared board graph / status report logic should come from ccm-owned code and `@ccm/engine` where possible.

Temporary bridge allowed:

- During migration, `ccm web-viewer` may spawn the existing plugin script only as an implementation detail.
- That bridge must still own state files, token, stale detection, and command JSON from ccm.
- No docs should instruct users to run `view-server.js` or `/cc-master:view` as the primary path.
- The bridge may use a vanilla/static smoke shell only until the app package and build artifact exist; it is not an acceptance target.

Final state:

- The ccm package can run viewer without resolving `${CLAUDE_PLUGIN_ROOT}`.
- The ccm package serves the built frontend app artifact, not a hand-maintained shell.
- Plugin command / skill payload for view is removed or reduced to a deprecation shim that points at `ccm web-viewer open`.
- Plugin command / skill payload for status is removed or reduced to a deprecation shim that points at `ccm status-report show`; it must not contain report rendering prose.
- Dist outputs are regenerated from `plugin/src`; no manual dist edits.

## 9. Tech stack decision

### 9.1 Constraints

The current viewer is a plugin-era artifact: stdlib server, single large `view.html`, import-map plus vendored ESM, and engine logic loaded through an IIFE-style browser bridge. Those choices were correct for a skill-distributed script with strict runtime self-containment.

They are not the target architecture after WV18. The target is a built frontend app served by ccm.

Moving to `ccm web-viewer` relaxes these constraints:

- frontend can be a normal build artifact instead of one giant HTML file.
- dependencies can be introduced if they are justified and compatible with ccm release packaging.
- server code can be TypeScript inside `ccm/apps/cli`.
- viewer code can import `@ccm/engine` directly instead of using plugin-local duplicated helpers or IIFE bridges.

These constraints remain non-negotiable:

- localhost only: `127.0.0.1`.
- token gate.
- read-only / no board writes.
- zero runtime external network.
- path containment.
- graceful degradation for stale PID, dead service, torn JSON, malformed state, missing board.
- ship-anywhere ccm packaging, including SEA/single-binary assumptions.

### 9.2 Candidate comparison

| Candidate | Fit |
|---|---|
| Node stdlib HTTP server | Good service host. It should serve APIs/assets and enforce security; it is not the frontend architecture. |
| Hand-written static HTML shell | Rejected as target. Allowed only as temporary bootstrap/prototype/smoke harness. |
| Lightweight Node server + bundled assets | Recommended service/package shape: ccm lifecycle/state plus packaged app assets. |
| Vite + React + TypeScript build artifact | Recommended target frontend. Vite production build treats `index.html` as entry and rewrites / hashes static assets at build time, which fits “local server serves static bundle; runtime zero external network.” |
| React Flow / XYFlow | Strong candidate for interactive DAG views; validate graph size, keyboard accessibility, node density, and visual regression behavior. |
| elkjs / dagre | Strong candidates for automatic DAG layout; choose based on layout quality, bundle impact, and deterministic output under tests. |
| Canvas/SVG hybrid | Candidate when large boards make pure DOM/SVG interaction too heavy; requires stronger screenshot and interaction QA. |
| Hono | Good future candidate if we want a small typed Web-standards router. Do not add in Phase 1 unless routes grow enough to justify dependency and adapter handling. |
| Fastify | Good future candidate for a typed local API server with plugin architecture. Too much convention for Phase 1. |
| Express 5 | Mature but too broad for a localhost read-only viewer; migration / middleware surface is not justified unless ecosystem middleware becomes a real need. |
| `open` | Useful candidate for `ccm web-viewer open`; must degrade to printing URL and must be checked against SEA packaging. |
| `execa` | Usually unnecessary; stdlib `child_process` is enough for spawning the local service in Phase 1. |
| `tree-kill` | Candidate only if cross-platform process tree cleanup proves brittle with stdlib `process.kill` / platform commands. |

### 9.3 Recommended phases

Phase 0: bootstrap/prototype only

- A minimal vanilla shell may exist to smoke-test service lifecycle, token gate, board listing, board reads, and status-report route.
- It is disposable and not sufficient for frontend acceptance.

Phase 1: service contract

- Add `ccm web-viewer` lifecycle/status around existing viewer behavior.
- Keep server simple, likely stdlib `node:http`, while stabilizing command JSON, state files, stale detection, restart semantics, token behavior, and endpoint tests.
- API endpoints expose ccm-owned JSON/read models; frontend code does not derive an independent board/status model.

Phase 1.5: WV19 approval gate, refined by WV20

- Before UI implementation, produce large-screen, mobile portrait, and mobile landscape concepts for the operational workspace.
- Extract the semantic design contract from approved concepts: IA, shell, read-model payload assumptions, DAG layout behavior, mobile/drawer behavior, accessibility/export behavior, and visual QA fixtures.
- If Image Gen or Browser plugin is unavailable, stop with prompts, semantic contract, and fallback QA plan instead of treating text-only design as approved implementation input.

Phase 2: app stack

- Scaffold the ccm-owned Vite + React + TypeScript frontend app.
- Serve the generated local bundle from ccm.
- Move from hand-maintained import-map/vendor assets to build-time asset graph.
- Add UI states for board switcher, `/view-model.json` loading/stale/error, Status module, DAG view, critical path focus, selected neighborhood, task detail, recoverable read errors, stale report state, and token/session errors.
- Reassess graph/layout libraries with browser screenshots, deterministic fixtures, mobile portrait/landscape checks, accessibility checks, and visual regression checks.

Phase 3: packaged acceptance

- Prove assets load from repo/dev build output and from release packaging.
- Run screenshot/browser QA across desktop, mobile portrait, and mobile landscape.
- Verify zero external network and no board writes.
- Reassess Hono/Fastify only if server route count or typed middleware needs grow.

Packaging decision:

- Prefer generated TS asset map, bundled asset manifest, or explicit Node SEA asset support so the web assets remain part of the ccm artifact.
- Avoid loose sidecar assets unless release tooling has a tested extraction / lookup contract.
- Add a SEA-serving test before declaring the migration done.

## 10. Migration plan

1. **WV12 — ccm namespace**
   - Add registry/help entries for `web-viewer`; import handler in `router.ts` and add the static `HANDLERS` map entry.
   - Implement `start/open/status/stop/restart`.
   - Add unit tests for router parsing, `--json` shapes, stale PID cleanup, home discovery plus initial board selection via existing `discover.ts`, concurrent home-scoped start lock/reuse, fixed port collision, status token redaction, and restart token renewal.

2. **WV8 — service packaging / hardening**
   - Move or wrap viewer server/assets under ccm ownership.
   - If a vanilla shell is still present, mark it bootstrap-only and keep the acceptance target on the app build artifact.
   - Preserve existing viewer behavior: DAG render, live polling, read-only board access, path containment, 127.0.0.1 binding, zero external network.
   - Add endpoint tests for viewer/data route GET-only behavior, token gate, no external URL references, board torn-write tolerance, deleted/invalid board behavior, asset containment, SEA smoke, and one parseable local URL.

3. **WV19 — concept approval / semantic design contract**
   - Produce large-screen operational workspace concept, mobile portrait concept, and mobile landscape DAG tracing concept.
   - Record approval status, approved concept references or prompts, review bullets, locked/flexible elements, and approved deviations.
   - Stop before implementation if approval is pending, rejected, or blocked by missing Image Gen / Browser plugin without an equivalent prompt/contract gate.

4. **WV21+ — app implementation after approval**
   - Depends on WV19 approval of the WV20-refined semantic design contract.
   - Scaffold or replace with the ccm-owned Vite + React + TypeScript app package.
   - Choose graph/layout libraries through browser-visible acceptance, not only API fit.
   - Add build pipeline producing a production asset manifest that `ccm web-viewer` can serve.
   - Implement against `/view-model.json` primary payload and `/task.json` lazy detail; keep `/board.json` debug/backcompat.
   - Add visual/browser QA for responsive layout, board switching, Status module, DAG interaction, critical path focus, selected neighborhood, recoverable errors, accessibility/export paths, and no-overlap UI states.

5. **WV13 — plugin guidance removal**
   - Update README / README_zh / feature manual / master-orchestrator-guide / using-ccm command catalog to point to `ccm web-viewer open`.
   - Remove or deprecate `/cc-master:view` and `$cc-master-view`; if shims remain, they only redirect users to ccm and contain no lifecycle logic.
   - Run plugin projection and sync checks.

6. **WV14 — status report module**
   - Add `ccm status-report render/write/show/watch` as the generated report surface.
   - Add `/status-report.json` to the viewer service and a Status submodule/page to board detail.
   - Move `/cc-master:status` and `$cc-master-status` out of the formal command surface; WV15 chose direct deletion with no deprecated shim.
   - Add report artifact freshness tests and legacy guidance scans.

## 11. Test plan

Minimum implementation tests:

- `ccm web-viewer --help` and each verb help render correctly.
- registry/help namespace tests cover static `REGISTRY` and `router.ts` handler-map integration.
- `start --json` creates service files under `<home>/services/web-viewer/`, returns a live `open_url`, and binds only `127.0.0.1`.
- `start` / `open` emit exactly one parseable local URL in human output.
- second `start --json` for the same home reuses the healthy service even when a different initial board is requested.
- concurrent `start` calls for the same home are serialized by `registry.lock` and reuse the same healthy instance.
- fixed `--port` collision fails cleanly without leaving a bogus healthy instance.
- `restart --json` returns previous + new service and changes token.
- stale state with dead PID is detected and replaced.
- PID reuse is caught by failed `/_ccm/health` schema/id/pid/started_at probe.
- `status` / `list` redact raw token and expose only redacted URL, `token_sha256`, and `token_file`.
- `start` / `open` with `--board` or `--goal` set `initial_board_path` / initial `current_selection` without changing service identity.
- ambiguous initial selection fails under `--no-input` and succeeds with `--goal`.
- `GET /boards.json` lists boards under `<home>/boards/`, and `GET /board.json` can switch among allowed home boards without starting a new service.
- the frontend app can switch boards without restarting the service and without mutating board files.
- viewer/data/static non-GET requests return 405; missing / wrong token returns 401/403; valid token returns board.
- deleted / invalid current selection returns a recoverable viewer error and does not crash service lifecycle commands.
- board malformed during read returns recoverable error, not process exit.
- no route can serve `../` paths or non-packaged assets.
- read-only home snapshot: starting, polling, opening, listing, stopping viewer never changes board JSON content.
- zero external network: built HTML / JS / CSS contain no `http://` or `https://` asset URLs except the localhost runtime URL generated by the CLI.
- `GET /view-model.json` is the primary frontend read-model payload and matches `@ccm/engine` / ccm service semantics for nodes, edges, status buckets, ready set, critical path, diagnostics, freshness, and default selection.
- `GET /task.json` returns lazy inspector/detail data for selected tasks or decisions without writing board JSON; unknown IDs and deleted boards return recoverable errors.
- `GET /board.json` remains debug/backcompat and is not required for normal app polling/analyze.
- packaged artifact / SEA serving test proves assets load from the ccm artifact, not from source-tree sidecars.
- `GET /status-report.json` returns `ccm/status-report/v1`, honors token gate, rejects non-contained board names, and never writes board JSON.
- stale / missing status report artifacts are refreshed through the shared status-report write path; torn artifacts are ignored or replaced.
- viewer Status module renders ready / in-flight / blocked / critical path / decisions / risks / next actions from the report schema, not from a second local inference model.
- concept gate test: WV19 approval record exists for large-screen, mobile portrait, and mobile landscape concepts, or the run stops with prompts/semantic contract because Image Gen or Browser plugin is unavailable.
- browser screenshot / visual QA covers desktop, mobile portrait, and mobile landscape widths; dense 200+ node boards, empty board, no boards, long task titles, token/session errors, stale report state, partial `/view-model.json`, and recoverable board-read failures.
- DAG interaction acceptance covers pan/zoom/reset, node focus/detail, selected-neighborhood focus, critical path highlighting, board switching, search, filters, URL restore, and accessible keyboard/focus or outline-equivalent behavior where the chosen graph library supports it.
- visual QA includes no-overlap checks for long titles, dense nodes, edge labels, status badges, rails, drawers, bottom sheets, command bar, and inspector/detail content.
- accessibility/export QA covers text outline of graph, keyboard/search/detail/selection paths, color semantic roles with redundant encodings, `prefers-reduced-motion`, hover replacement, and static screenshot/export preserving selected board, active filters, selected task/path, freshness, and caveats.
- mobile QA covers portrait main-visualization visibility, drawer/bottom-sheet apply/cancel/reset return path, touch targets, pan/zoom ownership, keyboard-open search/filter viewport, stale/offline/partial states, and landscape wide DAG tracing.
- visual regression uses deterministic fixtures, fixed viewport sizes, stable tokens/fonts, reduced animation, render-ready/nonblank checks, and no live generated assets inside tests.
- generated frontend bundle is the accepted UI artifact; a temporary smoke shell alone cannot satisfy frontend acceptance.

Documentation tests:

- old `/cc-master:view` references are either removed from user-facing docs or explicitly marked deprecated with `ccm web-viewer open` as replacement.
- old `/cc-master:status` / `$cc-master-status` references are removed from user-facing docs; remaining mentions are historical design / ADR context only.
- plugin dist is regenerated from source after command / skill removal.

## 12. Research inputs

- WV11B tech-stack research sidecar.
- Vite production build and asset handling docs.
- Fastify, Hono, and Express official docs for server framework trade-offs.
- Node SEA docs for single executable asset/dependency packaging constraints.
- `open`, `execa`, and `tree-kill` package docs for lifecycle convenience trade-offs.
- Codex openai-curated marketplace scan:
  - `build-web-apps` `frontend-app-builder` for concept-first frontend app design, React/Vite default app stack, dense tool UI rules, responsive/browser QA, and concept-to-implementation fidelity.
  - `build-web-apps` `frontend-testing-debugging` for Browser-first visual QA, Playwright fallback, DOM/nonblank/console/screenshot/interaction evidence, and desktop/mobile checks.
  - `build-web-data-visualization` `data-visualization` router for analytical job classification, URL state, mobile-first visualization, export, accessibility, and QA as design inputs.
  - `node-link-and-diagram-layout` for DAG family classification, layered/Sugiyama layout, routing/overlap/stability, 200+ node readability, and force-layout anti-patterns.
  - `dashboards-and-real-time-visualization` for operational workspace scanning, last-known-good/stale/offline states, coordinated interactions, and mobile control placement.
  - `testing-data-visualizations` for deterministic fixtures, visual regression, mobile portrait/landscape screenshots, render-ready/nonblank checks, interaction checks, and stale/error fixtures.
  - `accessibility-and-inclusive-visualization` for text outline, keyboard/search/detail paths, color redundancy, reduced motion, and export/static screenshot accessibility.
  - Foundations: `operational-visualization-workspaces.md`, `mobile-first-responsive-visualization.md`, `layout-hierarchy-and-self-explanatory-ux.md`, and `meaning-preserving-visual-design-workflow.md`.
  - `figma` optional with user authorization for design-system/high-fidelity flows; it is not a blocking prerequisite.
