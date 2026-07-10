---
'ccm': minor
'@ccm/web-viewer': minor
---

Web viewer migration stage 2: board-model blind-spot fields come on screen. The
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
