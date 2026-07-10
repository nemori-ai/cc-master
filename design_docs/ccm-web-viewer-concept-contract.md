# `ccm web-viewer` WV21 concept contract

> Status: pending user approval
> Concept image: [`assets/ccm-web-viewer-concepts/wv21-operational-workspace-concept.png`](assets/ccm-web-viewer-concepts/wv21-operational-workspace-concept.png)
> Source design: [ADR-029](../adrs/ADR-029-ccm-web-viewer-namespace.md), [`ccm-web-viewer.md`](ccm-web-viewer.md)

## Concept Scope

This concept covers the first app implementation direction for `ccm web-viewer`:

- desktop operational visualization workspace
- mobile portrait workspace
- mobile landscape DAG tracing mode

It is a semantic UI contract, not a moodboard. Implementation can tune component mechanics and exact pixels, but it must preserve the information architecture, hierarchy, interaction staging, and responsive continuation.

## Locked Elements

- **Product shape**: dense operational tool, not a landing page, static JSON browser, or decorative dashboard.
- **Desktop shell**: two-line top — mission line (identity / objective / current-board chip + mega board switcher / the one alarm slot / utilities / theme) + status strip (pure board-level readouts); stage-scoped controls (view toggle / filter echo / search) live on the stage toolbar of the central column; left analysis/filter/critical-path rail (board switching lives on the mission line's board chip, not the rail); dominant central DAG viewport; right dual-mode inspector (board mission brief by default, selected-task drill-down on selection).
- **Primary evidence**: layered task DAG remains the central surface. Critical path, selected task, task status, and stale/error states are visible without hover.
- **Read-model boundary**: the app renders `/view-model.json` for graph/status and `/task.json` for inspector detail; raw `/board.json` is not the main UI loop.
- **Mobile portrait**: graph visible on first screen; filters and detail use compact controls / bottom-sheet behavior; active filters and freshness stay visible.
- **Mobile landscape**: wide DAG tracing mode with critical-path or selected-neighborhood focus, compact overlays, zoom/reset/search-step controls, and a lightweight detail panel.
- **Visual language**: graphite/near-white operational surfaces; restrained teal, green, amber, red, and blue semantic accents; crisp compact typography; rails, dividers, lists, tabs, icon controls.
- **Accessibility/export**: text outline/list path must preserve board, selected task, critical path, ready set, awaiting-user decisions, freshness, and active filters. Static screenshot/export must remain interpretable.

## Flexible Elements

- Exact brand wordmark treatment and icon set.
- Final typeface and token values.
- Whether DAG flow is top-to-bottom or left-to-right per viewport, as long as dependency direction and rank are obvious.
- React Flow / XYFlow node anatomy, provided labels, badges, handles, and hit targets stay readable.
- Exact rail widths and breakpoint mechanics.
- Whether Status is a rail tab or split module, provided it remains visible and synchronized with selection. (Fulfilled by the right rail's default board-level mission brief: status report / diagnostics / judgment calls / cadence / peers render whenever no task is selected, so the rail is never empty.)

## Interaction Contract

- Board switch updates URL state, left rail, central DAG, right inspector, and Status module together.
- Search results are keyboard reachable and can step through dense DAG matches.
- Filters show active chips/counts near the affected view and have reset paths.
- Hover is preview only; committed selection drives URL state and inspector.
- Pan/zoom/reset have explicit controls; mobile does not trap page scroll by default.
- Refresh failure keeps last-known-good graph visible with stale/error banner and timestamp.
- Empty board, no boards, malformed board, deleted board, stale report, partial read model, and token/session error have distinct states.

## QA Implications

Implementation acceptance must include screenshots and interaction checks for:

- desktop workspace
- mobile portrait with detail/filter sheet behavior
- mobile landscape DAG tracing
- dense 200+ node board
- long task titles
- stale/last-known-good refresh failure
- malformed/deleted board
- selected critical path and selected neighborhood
- keyboard/search/detail path
- static screenshot/export

No implementation task may treat the smoke shell or a raw JSON page as satisfying this concept contract.
