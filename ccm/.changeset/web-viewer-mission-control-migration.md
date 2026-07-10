---
'ccm': minor
'@ccm/web-viewer': minor
---

Web viewer migration stage 1: the legacy MISSION CONTROL visual system replaces the
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
