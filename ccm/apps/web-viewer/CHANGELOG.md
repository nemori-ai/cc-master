# @ccm/web-viewer

## 0.19.0

### Minor Changes

- 2cd3f3d: Expose Goal Contract and safe cross-harness planning/routing read models in Web Viewer, with route-aware mission, inspector, DAG/list badges, filters, and shareable URL state.

### Patch Changes

- a43b29f: Fix the graph view's "reset layout" button not clearing manually dragged node positions: the node/edge builder's memo was missing `resetKey` from its dependency list, so it kept returning the stale (dragged) positions even after the underlying dagre layout was recomputed. Reset now snaps every node back to its dagre position and refits, while manual drag persistence across polls and zero-repositioning on status-only updates are unaffected.

## 0.18.0

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
