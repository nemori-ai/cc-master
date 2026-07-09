# ADR-029 — `ccm web-viewer` 成为 board web viewer 的正式入口

> Status: **Accepted**（结构决策已定；实现由后续 WV12 / WV13 / WV8 落地）
> Date: 2026-07-08
> Scope: board web viewer 的用户入口、生命周期归属、服务状态文件、frontend app stack、plugin command / Codex skill 退役路径、ccm packaging 边界。
> Source: WV11-WEBVIEWER-DESIGN scope change：web viewer 不再由 `/cc-master:view` / `$cc-master-view` 指导启动，必须成为 ccm 正式 namespace，名字为 `ccm web-viewer`。
> Co-signed: 用户（scope change 显式指定 namespace 名称）

---

## 1. Context

当前 viewer 由 host-specific plugin 面启动：Claude Code 用 `/cc-master:view` command，Codex 用 `$cc-master-view` skill；两者再指导 agent 起 `skills/master-orchestrator-guide/scripts/view-server.js`。这在 2026-06-16 的初版设计里合理，因为 viewer 还是随 plugin 分发的带外脚本。

但 ADR-014 已把 `ccm` 定位为独立产品 / 引擎，cc-master plugin 降为消费方之一。board 的正式读写与只读 advisory namespace 已经收敛到 `ccm`；viewer 也是 board 状态层的只读消费方，而不是某个 harness 的命令技巧。继续让用户通过 `/cc-master:view` 或 skill-only 入口启动，会制造三类漂移：

- **host 漂移**：Claude Code command、Codex skill、未来 harness adapter 各自教一遍启动逻辑。
- **生命周期漂移**：后台 server 的 PID / token / URL / stale 检测没有 ccm 级状态模型，只靠当前 session 的后台 shell。
- **产品边界漂移**：用户要记住“board 操作用 ccm，但图形 viewer 用 plugin command”，违背 ADR-014 的独立产品边界。

因此需要把 web viewer 升为 ccm 的一等 namespace，并把旧 host command / skill 改成迁移层或退役对象。

WV18 进一步收紧 frontend 方向：手写静态 HTML shell 不能成为目标架构。它可以短期作为 smoke shell / bootstrap prototype，帮助证明 service lifecycle、token gate、board read routes 和 packaging path；但验收目标必须是工业化前端 app stack 的 build artifact，由 `ccm web-viewer` service 本地托管。否则 viewer 会在 UI 状态、图布局、浏览器 QA、responsive/accessibility、bundle packaging 上继续依赖手工拼接，和 `ccm` 独立产品边界不匹配。

WV20 进一步把 frontend 目标从“能打开 board 的页面”收紧为 **plugin-guided operational visualization workspace**：viewer 是操作型可视化工作台，不是 landing page、marketing shell、也不是静态 JSON browser。设计与实现必须按 `build-web-apps` 的 concept-first app UI 流程、`build-web-data-visualization` 的 operational workspace / node-link DAG / dashboard / accessibility / testing 合同推进；实现代码前先产出大屏、mobile portrait、以及因 DAG 宽图而必需的 mobile landscape 概念并过用户 approval gate。

## 2. Decision

我们选择 **`ccm web-viewer`** 作为 board web viewer 的正式入口。旧 `/cc-master:view` / `$cc-master-view` 不再是目标入口；后续只允许作为短期迁移提示，最终应从 plugin command / skill 面删除。

### 2.1 为什么是 `web-viewer`

`web-viewer` 是一个明确的产品 noun：一个本地、只读、token-gated 的 Web UI 服务。它表达的是“启动 / 管理 viewer 服务”，不是“打印一个 view”。

这也是为什么不选 `ccm view`：

- `view` 太泛，容易与 `board show`、`board graph`、未来 TUI / desktop / report view 混淆。
- `view` 像一次性读命令；实际需要 lifecycle verbs（start / status / stop / restart）。
- `web-viewer` 明确把浏览器、HTTP、本地服务、安全边界纳入名字，后续若有 `ccm tui`、`ccm desktop` 不会抢语义。

也不继续选 plugin command、skill-only 或裸脚本入口：

- plugin command 是 harness-specific 表面，不能做 ccm 级 PID / state 管理。
- skill-only 会把生命周期实现藏进 prompt prose，缺少可测试命令契约。
- 裸脚本入口让用户与 agent 直接耦合到文件布局，违背 ADR-014 “plugin 只是 ccm 消费方之一”的边界。

### 2.2 Command surface

`web-viewer` namespace is static ccm CLI surface: implementation must add the namespace to `ccm/apps/cli/src/registry.ts` `REGISTRY` and add the handler import / handler map entry in `ccm/apps/cli/src/router.ts`. It is not a dynamic plugin registry.

Recommended v1 commands:

| Command | Semantics |
|---|---|
| `ccm web-viewer start [--board <path>|--goal <substr>] [--home <dir>] [--host 127.0.0.1] [--port 0] [--reuse] [--no-open] [--json]` | 为指定 / 默认 home 启动 viewer service；service 扫描 `<home>/boards/` 并可在 UI 内列出 / 切换 boards；`--board` / `--goal` 只设置初始选中 board；`--reuse` 复用同 home 的健康实例（推荐默认 true）。 |
| `ccm web-viewer open [<id>] [--board <path>|--goal <substr>] [--home <dir>] [--no-start] [--json]` | 打开 / 聚焦 home-scoped service URL；默认无实例时 start-then-open，`--no-start` 只打开既有实例；`--board` / `--goal` 只产生初始 selection URL/query/state，不按 board 创建独立 service。 |
| `ccm web-viewer status [<id>] [--home <dir>] [--json]` | 查看一个实例或当前 home 的 viewer 状态；检测 stale PID / 不健康服务，并报告 home scope 与当前 selection。 |
| `ccm web-viewer list [--home <dir>] [--json]` | 列出 home 下 viewer service instances，标注 running / stale / home / current selection。 |
| `ccm web-viewer stop [<id>] [--home <dir>] [--all] [--yes] [--json]` | 停掉一个或全部 home-scoped 实例；stale state 可清理。 |
| `ccm web-viewer restart [<id>] [--board <path>|--goal <substr>] [--home <dir>] [--json]` | 对实例或当前 home 执行 stop + start；必须生成新 token，URL 可变；`--board` / `--goal` 只设置新实例的初始 selection。 |
| `ccm web-viewer serve --state <path>` | Internal daemon target spawned by `start`; not a user-facing lifecycle command. |

Commands reuse existing ccm global flags and context: `--board`, `--home`, `--goal`, `--session-id`, `--json`, `--no-input`. Home resolution should call the existing discovery layer (`discover.ts` `resolveHome`, `boardsDir`). Board resolution (`resolveBoard`) is used only to validate / choose an **initial selection** from boards under that home; it is not part of service identity.

`--json` 使用稳定 envelope：

```json
{
  "ok": true,
  "service": {
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
    "stale": false
  }
}
```

`start --json` / `open --json` may include an additional one-time `open_url` containing the live token so automation can open the browser. `status --json` and `list --json` must redact tokens and expose only `token_sha256` / `token_file`. `stop --json` returns `{ "ok": true, "stopped": true|false, "service": service|null }`; `restart --json` returns `{ "ok": true, "previous": service|null, "service": service, "open_url": "..." }`. Errors use the existing ccm exit code discipline and, under `--json`, `{ "ok": false, "error": { "code": "...", "message": "..." } }`.

### 2.3 Service lifecycle model

Service state lives under ccm home, outside the board narrow waist:

```text
<home>/services/web-viewer/
  registry.lock
  instances/<id>.json
  tokens/<id>.token
  logs/<id>.log
```

The instance state file schema is `ccm/web-viewer-service/v1` and must include at least:

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

Lifecycle rules:

- Service scope is the canonical ccm home (or an explicitly configured service root/home), not a board. `service-id` is stable per canonical home unless implementation explicitly supports multiple instances for the same home.
- `start` is concurrency-safe through `registry.lock`; concurrent starts for the same home either reuse one healthy instance or one winner starts while others observe it.
- stale detection requires both PID liveness and tokened HTTP `GET /_ccm/health` matching `schema`, `id`, `pid`, and `started_at`. PID-only is unsafe because of PID reuse.
- `stop` prefers authenticated shutdown when implemented, then SIGTERM, then stale cleanup. If an HTTP shutdown route exists, it is internal/local/token-gated and writes no board data.
- `restart` stops the old process if live, removes stale state if not, then starts a new process with a **new token**.
- The service scans `<home>/boards/` and exposes a board list / switcher to the viewer. `--board` / `--goal` follow existing ccm discovery only to choose `initial_board_path` / initial `current_selection`; after start, current selection is UI/runtime state, not lifecycle identity. Ambiguity with `--no-input` is exit 5 / not found-style failure only when a command explicitly requested an initial selection.

### 2.4 Security and invariants

The viewer remains a read-only local service:

- binds only `127.0.0.1`; never `0.0.0.0`.
- token-gated; token accepted via query, local same-origin cookie, or `Authorization: Bearer`; token file mode should be `0600`; status/list output must redact raw tokens.
- GET-only for viewer/data/static routes; non-GET returns 405. The sole allowed exception is an internal authenticated shutdown control route if Phase 1 implements graceful HTTP shutdown.
- zero external network; assets are local package assets, no CDN / remote font / telemetry.
- no board writes; no command in this namespace mutates board content.
- path containment: static files are served only from the packaged asset root; board-list / board-data endpoints may select only boards under `<home>/boards/` plus any explicit launch board allowlisted by the final design; arbitrary filesystem paths are rejected; service files stay under `<home>/services/web-viewer/`.
- no CORS by default; use `Cache-Control: no-store` for board/state responses.

### 2.5 Plugin-guided UI / data-visualization contract

`ccm web-viewer` 的 frontend acceptance target 是一个密集、可扫描、可交互的操作型可视化工作台：

- **Large-screen shell**：默认首屏是 compact command/status bar + tri-pane workspace：left board switcher / outline / filters，central DAG viewport，right inspector / Status rail。不要做 hero、landing page、nested cards、装饰性 bento，中心证据视口必须主导屏幕。
- **Information architecture**：至少覆盖 home / boards overview、board workspace、DAG/topology view、Status module、tasks / decisions / detail rail、peers / activity / diagnostics。默认进入最近或明确选择的 board；若无明确选择，显示 board overview 并保留一键进入最近 active board。搜索、过滤、selected task、focused critical path、layout viewport、active module、board switcher state 应有 URL/shareable state；hover preview 不进 URL。
- **Operational states**：board list、selected board、read model、Status module 都要有 loading、last-known-good、stale、partial、recoverable error、token/session error、empty board、deleted board、malformed board 状态。错误不应清空最后可用 DAG 证据。
- **Mobile**：mobile portrait 不是 desktop rails 的纵向堆叠；首屏必须显示主可视化或立即可达的 insight + 主可视化，filters/detail 用 drawer/bottom sheet。DAG 是宽图，mobile landscape 是必需设计面，用于 wide tracing、pan/zoom、selected neighborhood、critical path 跟踪。

Service/API/read-model boundary:

- **`GET /view-model.json` 是 primary frontend payload**。它由 ccm-owned code / `@ccm/engine` 生成，包含 board metadata、graph topology、status buckets、ready set、critical path、selection defaults、freshness / diagnostics 等 viewer read model。
- **`GET /task.json` 是 lazy detail target**，用于 inspector / detail rail 拉取单个 task、decision、log/activity detail。它不改变 board。
- **`GET /board.json` 只保留 debug / backcompat**，不再是 app 主循环每 2s 读取并在浏览器重复 analyze 的目标。
- Frontend 不复制 board/status/scheduler 语义：不得重新定义 status enum、`isAwaitingUser`、done/verified、ready set、critical path、dependency validity、scheduler grouping。它只渲染 ccm read model，保留 ephemeral UI state。

Graph layout contract:

- Graph family 是 **directed acyclic board task DAG**。默认布局族是 layered / Sugiyama family；React Flow / XYFlow 可负责 interaction，elkjs / dagre / 等价 DAG layout engine 负责 node placement、rank、routing hints。
- Force-directed layout 不得作为主方案；仅可作为明确标注的 exploratory fallback，且不能替代 DAG rank / dependency tracing。
- Layout 必须显式处理 real node dimensions、edge routing、overlap removal、edge labels、rank stability、selected-neighborhood stability、long task titles、200+ node boards。Dense graph fallback 包括 focus mode、filters、outline/tree list、critical-path mode、selected neighborhood、search step-through，以及必要时 matrix/list fallback。

Concept and QA gates:

- 实现 app UI 前必须先产出并让用户批准 large-screen、mobile portrait、mobile landscape concepts；批准后提取 semantic design contract，锁定 shell、reading path、layout hierarchy、color roles、mobile continuation、interaction staging、export/static screenshot behavior。
- 若 Image Gen 或 Browser plugin 不可用，必须提供等价 prompts、semantic contract、QA plan，并停在同等 approval gate；不得以文字宣言直接进入实现。
- Browser/visual QA 必须覆盖 desktop、mobile portrait、mobile landscape screenshots；render-ready / nonblank；long-title、dense-board、empty/error/stale fixtures；pan/zoom/reset/select/search/filter/board switch/status interactions；zero external network；no board writes；static screenshot/export preserves evidence；accessible text outline and keyboard/search/detail paths。

### 2.6 Tech stack decision

The target frontend architecture is **not** a static hand-written HTML shell. The accepted target is a built frontend app whose production assets are served by the local `ccm web-viewer` service.

Short-term rule:

- A minimal vanilla shell is allowed only as a bootstrap/prototype or smoke harness while lifecycle and service boundaries are being stabilized.
- That shell is not an acceptance target for WV18+ frontend work and must not be documented as the long-term UI architecture.
- Any implementation milestone that still uses it must state the migration step that replaces it with the app build artifact.

Moving from plugin script to ccm namespace relaxes several plugin-era constraints:

- no need to keep the viewer as a single `view.html` plus import-map.
- no need to vendor browser ESM by hand inside a skill directory.
- no need to load ccm graph/model helpers through an IIFE bridge; ccm-owned code may import `@ccm/engine` directly.
- no need to avoid all npm dependencies merely because the code lives in a distributed skill script.

The following constraints **do not relax**:

- binds only `127.0.0.1`.
- token-gated.
- read-only / no board writes.
- zero runtime external network.
- path containment for assets, board path, and state files.
- graceful degradation on torn JSON / stale PID / missing board.
- ccm release must preserve ship-anywhere semantics, including Node SEA / single-binary packaging expectations.

Recommended target stack:

- **Frontend app**：Vite + React + TypeScript is the recommended baseline because it gives typed UI code, fast dev server, production asset hashing, and a normal build artifact without requiring a runtime server framework.
- **Graph / DAG rendering**：choose per implementation slice. React Flow / XYFlow fits interactive node-edge DAGs; elkjs or dagre fit layered / Sugiyama-family automatic layout; Canvas/SVG hybrid remains acceptable where large graph performance requires it. The viewer must still consume `/view-model.json` and ccm read models rather than inventing a second scheduling engine in the UI.
- **UI system**：shadcn/Radix/Tailwind is acceptable if the repo wants a pragmatic app UI kit; a smaller project-owned token/component system is also acceptable. Either path must support dense board/status dashboards, responsive layouts, keyboard/mouse interaction, and visual regression checks.
- **Server**：a stdlib `node:http` service remains an acceptable local asset/API host. Hono or Fastify are future candidates only if typed routing/middleware complexity justifies the dependency. Express remains over-broad for this service unless a concrete middleware need appears.
- **Runtime**：production assets are served from local package/SEA assets; no CDN, remote font, telemetry, update check, or browser network dependency.

Service/API boundary:

- `ccm web-viewer` service owns lifecycle, token gate, static asset serving, and JSON endpoints.
- ccm-owned endpoints provide read models: board list, primary `/view-model.json`, lazy `/task.json`, debug/backcompat `/board.json`, health, and `ccm/status-report/v1` via the status-report path.
- The frontend app consumes those APIs. It may keep ephemeral UI state, but it must not copy the board schema, status-report schema, scheduling rules, or critical-path logic into an independent UI model.
- Board writes remain outside this namespace. The viewer is read-only even if future UI controls add filters, focus modes, layout pinning, or export.

Plugin-informed workflow:

- Use `build-web-apps` for frontend app scaffolding, UI redesign, interaction states, browser QA, responsive passes, and general visual polish.
- Use `build-web-data-visualization` for DAG/dashboard design, critical path visualization, graph layout trade-offs, accessibility of node/edge views, and visual regression checks.
- Use `figma` only when the user authorizes design-system or high-fidelity design work. It is useful but not a blocking prerequisite for this repo.

Recommended staged path:

1. **Bootstrap / prototype only**：a vanilla smoke shell may exercise service lifecycle, token gate, and JSON routes, but it is explicitly disposable.
2. **App package scaffold**：create the Vite + React + TypeScript app package under ccm ownership, with local dev/build scripts and no runtime external network.
3. **Build pipeline**：produce a production asset manifest suitable for repo/dev serving and release packaging.
4. **Service static serving**：serve the build artifact from `ccm web-viewer` with strict asset containment and token-gated data routes.
5. **Browser acceptance**：complete screenshot/visual QA, responsive checks including mobile portrait + landscape, DAG interaction, board switching, Status module rendering, accessibility/export checks, and no-board-write/no-external-network gates before accepting the frontend architecture.

Candidate assessment:

| Candidate | Assessment |
|---|---|
| Continue Node stdlib server | Recommended service host. It should serve APIs/assets, not define the frontend architecture. |
| Hand-written static HTML shell | Rejected as target architecture. Allowed only as temporary smoke/prototype scaffolding. |
| Lightweight Node server + bundled assets | Recommended service/package shape: ccm owns lifecycle/state and serves packaged app assets with strict containment. |
| Vite + React + TypeScript build artifact | Recommended target frontend. Build-time asset hashing / URL transform gives a normal static app bundle; runtime still serves only local files. |
| React Flow / XYFlow + elkjs/dagre | Recommended candidates for interactive DAG and layered layout work; final choice is implementation-level and must be validated with graph size, accessibility, mobile landscape tracing, and visual QA. |
| Hono | Future candidate if a small typed Web-standards router becomes useful; Node adapter dependency is acceptable only when justified. |
| Fastify | Future candidate if typed local API surface grows; low overhead and plugin architecture are useful but add framework conventions. |
| Express 5 | Not recommended for this viewer unless ecosystem middleware becomes necessary; mature but broader surface and migration concerns are overkill for localhost read-only routes. |
| Lifecycle libs (`open`, `execa`, `tree-kill`) | Evaluate case by case. `open` may improve `web-viewer open`; `execa` is likely unnecessary for simple spawn; `tree-kill` may help cross-platform stop semantics. Each dependency must justify SEA/release impact versus stdlib alternatives. |

Asset packaging is the main build decision. Prefer a generated TypeScript asset map, bundled asset manifest, or explicit Node SEA asset support over loose sidecar assets that weaken single-binary assumptions. If a release target cannot embed assets, the release must have an explicit extraction / lookup contract and tests proving `ccm web-viewer` can serve assets from the packaged artifact.

### 2.7 Source-of-truth and packaging boundary

Target ownership is ccm:

- CLI registry/help/handler live in `ccm/apps/cli`.
- ccm CLI namespace registration is static: edit `REGISTRY`, import the handler module in `router.ts`, and add it to the static `HANDLERS` map.
- reusable graph / board read helpers should consume `@ccm/engine` rather than re-implement board parsing.
- web app assets and server code should be packaged with ccm so `ccm web-viewer` works without knowing a plugin installation path.

The existing plugin script (`skills/master-orchestrator-guide/scripts/view-server.js` + `view.html`) may be used only as a **temporary migration payload** behind `ccm web-viewer` if that reduces implementation risk. It is not the long-term SSOT, and a hand-written static shell is not an accepted frontend target. User-facing docs and plugin commands must point to `ccm web-viewer`, not to `${CLAUDE_PLUGIN_ROOT}/.../view-server.js`.

Projection implication: command / skill removal must edit `plugin/src` and run the projection scripts; never hand-edit `plugin/dist`.

### 2.8 Migration plan

1. Add `ccm web-viewer` lifecycle/service implementation and tests.
2. Treat the current vanilla/static shell only as a smoke/prototype bridge while stabilizing service state, token gate, board list/data routes, and status-report route.
3. Before scaffolding UI implementation, complete the WV19/WV20 concept approval gate: large-screen + mobile portrait + mobile landscape concepts, semantic design contract, and browser/visual QA plan.
4. Scaffold the ccm-owned Vite + React + TypeScript frontend app package; add build/dev scripts and browser QA hooks.
5. Add build artifact packaging: generated asset manifest / SEA asset support / tested release lookup contract.
6. Serve the built app artifact from `ccm web-viewer`; the service provides JSON read-model/status endpoints and the app consumes them.
7. Replace user-facing guidance in README / feature manual / master-orchestrator-guide / using-ccm command catalog so “View” points to `ccm web-viewer open`.
8. Convert `/cc-master:view` and `$cc-master-view` to short deprecation shims, or delete them in the same release if compatibility policy allows. Shims must not keep separate lifecycle logic; they may only say “run `ccm web-viewer open`”.
9. Remove old command / skill payload from `plugin/src`, then regenerate `plugin/dist`.
10. Once ccm-native app assets are packaged, delete the plugin-owned viewer server payload unless another command still has a real need for it.

## 3. Consequences

### 3.1 Positive

- One lifecycle contract for every harness.
- Viewer state becomes inspectable / stoppable outside the agent session.
- `ccm` owns all board-adjacent service management, consistent with ADR-014.
- Security invariants become testable as CLI/service behavior instead of prose in a command prompt.

### 3.2 Negative

- ccm packaging now carries web assets and a local HTTP service.
- ccm packaging now needs a frontend build pipeline and browser/visual acceptance gates.
- Migration must touch plugin docs / command projection after the ccm namespace exists.
- Short-term duplication may exist while the old plugin script is still present.

### 3.3 Neutral

- The viewer remains read-only; board narrow waist is unchanged.
- This ADR does not implement handler code and does not change current runtime behavior by itself.

## 4. Alternatives Considered

### 4.1 `ccm view`

Rejected. It is shorter but semantically wrong: it sounds like a one-shot read command and collides with existing `board show` / `board graph` mental models. It hides the HTTP service lifecycle.

### 4.2 Keep `/cc-master:view` and `$cc-master-view`

Rejected as target architecture. It keeps the viewer coupled to host adapter command surfaces and prevents ccm from owning PID / token / stale cleanup.

### 4.3 Skill-only guidance

Rejected. A prompt can tell an agent what to do, but cannot be a stable service API or state-machine contract.

### 4.4 Continue exposing `view-server.js` as a script

Rejected. Script paths are packaging details. Users and agents should not need to know plugin file layout to manage a viewer service.

### 4.5 Hand-written static HTML shell as target architecture

Rejected. It can prove a route or serve as a temporary smoke harness, but it is too brittle as the long-term board UI architecture. DAG interaction, board switching, Status module UX, responsive behavior, accessibility, graph layout, and visual regression need an app stack and browser QA workflow. The target is a built frontend artifact served by ccm, not a manually maintained static shell.

## 5. Related

- [`ADR-014-cli-decoupling-as-independent-product.md`](ADR-014-cli-decoupling-as-independent-product.md) — ccm is an independent product / engine; plugin is one consumer.
- [`ADR-013-board-v2-data-model-and-cli.md`](ADR-013-board-v2-data-model-and-cli.md) — viewer is a read-only board consumer.
- [`../design_docs/ccm-web-viewer.md`](../design_docs/ccm-web-viewer.md) — evergreen command / service design.
- [`../design_docs/2026-06-16-board-view-and-dag-webview.md`](../design_docs/2026-06-16-board-view-and-dag-webview.md) — historical `/cc-master:view` design, superseded only for launch surface / lifecycle ownership.

## 6. References

- WV11-WEBVIEWER-DESIGN task scope.
- Existing mechanism contracts: [`../design_docs/mechanisms/cmd-view.md`](../design_docs/mechanisms/cmd-view.md), [`../design_docs/mechanisms/script-view-server.md`](../design_docs/mechanisms/script-view-server.md).
- WV11B tech-stack research sidecar.
- Vite build / assets docs: <https://vite.dev/guide/build>, <https://vite.dev/guide/assets>.
- Fastify docs / TypeScript reference: <https://fastify.io/>, <https://fastify.io/docs/latest/Reference/TypeScript/>.
- Hono docs / Node adapter docs: <https://hono.dev/docs/>, <https://hono.dev/docs/getting-started/nodejs>.
- Express 5 routing / migration docs: <https://expressjs.com/en/5x/guide/routing/>, <https://expressjs.com/en/guide/migrating-5/>.
- Node SEA docs: <https://nodejs.org/api/single-executable-applications.html>.
- Lifecycle helper references: `open` (<https://www.npmjs.com/package/open>), `execa` (<https://github.com/sindresorhus/execa>), `tree-kill` (<https://github.com/pkrumins/node-tree-kill>).
- Codex plugin-guided design sources: `build-web-apps` frontend app builder/testing skills and `build-web-data-visualization` data visualization, node-link layout, dashboard, testing, accessibility, operational workspace, mobile responsive visualization, layout hierarchy, and meaning-preserving visual design workflow references.
