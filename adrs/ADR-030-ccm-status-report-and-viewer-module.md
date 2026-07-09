# ADR-030 — `ccm status-report` generated report and viewer module

> Status: **Accepted**
> Date: 2026-07-08
> Scope: status report command surface, deprecated `/cc-master:status` / `$cc-master-status` surfaces, report artifact lifecycle, web-viewer board detail routes, docs/tests.
> Source: WV14-STATUS-REPORT-DESIGN + WV15-STATUS-REPORT-IMPL: status must stop relying on prompt-time agent prose and become a static, programmable ccm-generated report readable by the web viewer.

---

## 1. Context

`/cc-master:status` and the Codex `$cc-master-status` skill currently ask the foreground agent to read board data and write a status brief in prose. Some pieces already call ccm read commands, but the final report shape, grouping, risk language, and next-action wording are still prompt-time behavior. The Claude Code command body even permits agent "mental math" for simple critical paths.

That is the wrong product boundary after ADR-014 and ADR-029:

- board-adjacent computation belongs in `ccm`, not in host-specific prompt bodies.
- status output needs a stable JSON schema, so tests and the web viewer can consume it.
- web viewer pages need a status module for each board without depending on an agent being present.
- stale / periodic refresh needs artifact semantics, not transient prose in the conversation.

Therefore status must move from "agent writes a brief" to "ccm computes a deterministic report artifact".

## 2. Decision

We choose a new ccm namespace: **`ccm status-report`**.

`status-report` is a generated read model over a board. It is read-only with respect to board JSON. It may write derived report artifacts under ccm home, but it never mutates the board.

`/cc-master:status` and `$cc-master-status` are no longer formal product entry points once this ADR is accepted. WV15 implementation chooses direct deletion with no one-release deprecated shim: the plugin command and Codex skill are deleted from `plugin/src`, and projection removes them from `plugin/dist`.

### 2.1 Command surface

Recommended v1 verbs:

| Command | Semantics |
|---|---|
| `ccm status-report render [--board <path>|--goal <substr>] [--home <dir>] [--json] [--as-of <iso>] [--max-age <duration>]` | Pure one-shot computation. Reads board and advisory inputs, emits report to stdout, writes nothing. `--json` emits the stable schema; human output is derived from the same object. |
| `ccm status-report write [--board <path>|--goal <substr>] [--home <dir>] [--force] [--json] [--as-of <iso>]` | Compute and atomically write the report artifact if missing/stale, then return artifact metadata and optionally the report. |
| `ccm status-report show [--board <path>|--goal <substr>] [--home <dir>] [--json] [--max-age <duration>] [--refresh]` | User-facing read. Reuses a fresh artifact when available; computes on demand when missing/stale or when `--refresh` is set. |
| `ccm status-report watch [--home <dir>] [--board <path>|--all-active] [--interval <duration>] [--json]` | Optional foreground/daemon loop that periodically runs `write`. It is useful without the web viewer but is not required for viewer correctness. |

`render` is the primitive: no writes, easiest to snapshot-test. `write` is the artifact primitive. `show` is the human-friendly command and the best target for short-lived deprecated shims. `watch` is a convenience daemon; it must call the same compute/write path as `write`, not implement a second reporter.

Do not name this namespace `status`: `status` is already a common lifecycle verb (`web-viewer status`, `watchdog status`, `cadence status`) and would collide mentally with process/session status. `status-report` names the artifact product.

### 2.2 Stable JSON schema

All JSON output uses a versioned envelope:

```json
{
  "schema": "ccm/status-report/v1",
  "ok": true,
  "report": {
    "board": {
      "path": "/home/u/.cc_master/boards/20260708T120000Z-123.board.json",
      "file": "20260708T120000Z-123.board.json",
      "goal": "Ship feature X",
      "owner": { "active": true, "session_id": "..." },
      "git": { "branch": "main", "worktree": "/repo" }
    },
    "summary": {
      "total": 12,
      "done": 4,
      "verified_done": 4,
      "in_flight": 3,
      "ready": 2,
      "blocked_on_user": 1,
      "blocked_on_task": 1,
      "attention": 1
    },
    "groups": {
      "blocked_on_user": [],
      "in_flight": [],
      "blocked_on_task": [],
      "ready": [],
      "done": [],
      "attention": []
    },
    "critical_path": {
      "task_ids": ["T1", "T4", "T9"],
      "makespan": { "value": 9, "unit": "h" },
      "weight_source": "estimate|default|mixed|unavailable"
    },
    "decisions": {
      "awaiting_user": [],
      "judgment_calls_pending_review": []
    },
    "risks": [],
    "next_actions": {
      "ready_to_dispatch": [],
      "awaiting_user": [],
      "recommended_operator_actions": []
    },
    "health": {
      "lint": { "ok": true, "violations": [] },
      "over_scheduling": { "in_flight": 3, "wip_limit": 4, "state": "ok" },
      "usage": { "available": true, "verdict": "hold" }
    }
  },
  "artifact": {
    "path": "/home/u/.cc_master/reports/status-report/boards/20260708T120000Z-123.status-report.json",
    "created_at": "2026-07-08T12:01:02Z",
    "expires_at": "2026-07-08T12:01:32Z",
    "freshness": "fresh",
    "input_hash": "sha256:...",
    "board_hash": "sha256:...",
    "topology_hash": "sha256:...",
    "producer": { "ccm_version": "0.16.0" }
  }
}
```

The schema is intentionally a report schema, not a board clone. It may include selected task fields needed for display (`id`, `title`, `status`, `deps`, `parent`, `blocked_on`, `executor`, `handle`, `artifact`, timestamps, `decision_package.enter_cmd`), but it must not become a second board model.

Unknown additive fields are allowed. Renaming/removing fields or changing enum semantics requires a schema version bump.

### 2.3 Artifact lifecycle

Report artifacts live under ccm home, outside the board narrow waist:

```text
<home>/reports/status-report/
  cache.lock
  boards/<board-file-stem>.status-report.json
```

This is not a board sidecar and not a web-viewer-only cache:

- not a board sidecar, because generated reports are derived artifacts and should not clutter or couple to board storage.
- not `<home>/services/web-viewer/cache/`, because CLI users and other future consumers need the same artifact without a running viewer.
- under `<home>/reports/`, because it is a ccm-owned read model with a stable lifecycle.

Freshness is determined by:

- `board_hash`: sha256 of the board file bytes.
- `board_mtime_ms` and `board_size`: cheap pre-check before hashing.
- `topology_hash`: sha256 of the normalized scheduling inputs that drive DAG sections (`tasks[].id/status/deps/parent/blocked_on/estimate/started_at/dispatched_at/finished_at/verified/artifact` plus board scheduling fields).
- `advisory_hash`: sha256 of non-board advisory inputs actually used in the report, such as `usage advise` output, estimate/risk output, and their source cache mtimes when available.
- `input_hash`: sha256 of `{schema_version, board_hash, topology_hash, advisory_hash, options, ccm_version_major_contract}`.
- `expires_at`: a TTL for time-sensitive sections. Default should be short for viewer freshness (for example 30s) and configurable by `--max-age`.

A report is fresh only when the board hash matches and `now <= expires_at`. A topology hash match may let implementation reuse expensive graph sections internally, but it is not sufficient to declare the whole artifact fresh because usage and elapsed-time risks can change without board content changes.

`write` must use a lock plus temp-file-and-rename. Partial files are invalid artifacts and must be ignored or replaced.

### 2.4 Periodic update model

The recommended model is layered:

1. **Canonical primitive**: `ccm status-report render/write` owns all computation and artifact writing.
2. **Viewer lazy compute**: the web-viewer route checks the artifact on request. If missing, compute synchronously and return the report. If stale, return the stale artifact with `freshness:"stale"` and trigger one background refresh, or compute synchronously when no stale artifact exists.
3. **Viewer warm interval**: while a web-viewer service is running, it may periodically call the same write path for the current board and active boards listed in `<home>/boards/`.
4. **Headless daemon**: `ccm status-report watch` exists for users who want periodic artifacts without a running viewer.

Do not make `watch` the only freshness mechanism. The viewer must be correct after a cold start and after the watcher dies. Do not make web-viewer service state the only cache. CLI `show` must work without web-viewer.

### 2.5 Web viewer integration

Each board detail page gains a **Status** submodule or subpage. It reads:

```text
GET /status-report.json?board=<board-file>&max_age=30s
```

The route returns the same `ccm/status-report/v1` envelope, plus route-level recoverable errors if a report cannot be computed. It is token-gated and local-only under the ADR-029 service shell.

The UI should display at least:

- progress summary: total, true done, in-flight, ready, blocked.
- blocked-on-user decisions at the top, including `decision_package.enter_cmd` or the relevant discuss/current-thread instruction.
- in-flight tasks with age, executor/handle, and hedge/risk markers.
- ready-to-dispatch tasks from the authoritative ready set.
- critical path chain and makespan/weight-source.
- health cards for lint, over-scheduling, usage verdict, stale report state.
- next actions split into "ready to dispatch", "awaiting you", and "operator attention".

The viewer must not infer its own conflicting status model from raw board data when a status report is available. Raw board routes remain useful for DAG rendering; the Status module consumes the report route.

This module belongs in the `ccm web-viewer` frontend app target described by ADR-029. A temporary static smoke shell may exercise `/status-report.json`, but it is not the accepted UI target. The accepted viewer UI consumes the `ccm/status-report/v1` envelope from the service API and renders it in the app; it does not copy report grouping, status semantics, or next-action rules into an independent browser model.

### 2.6 Safety and invariants

- Board JSON is read-only. `status-report` writes only report artifacts under `<home>/reports/status-report/`.
- No plugin code imports `@ccm/engine`; plugin shims, if temporarily kept, shell to `ccm`.
- Web routes inherit ADR-029 invariants: bind `127.0.0.1`, token-gated, no CORS by default, zero external network, path containment, no board writes.
- HTTP board selection accepts only board files under `<home>/boards/`.
- Report artifact paths are derived from canonical board filenames, not arbitrary user paths.
- Missing `ccm`, bad board JSON, advisory command failure, or torn artifact must produce structured errors, not silent prose.
- `status-report` may call read-only ccm analysis paths and engine helpers inside ccm. It must not call write verbs against the board.

### 2.7 Tests and acceptance gates

Implementation should add:

- CLI snapshot tests for `render --json`, `show`, and human output derived from the JSON report.
- schema compatibility tests for `ccm/status-report/v1`.
- artifact freshness tests for board hash, board mtime pre-check, topology hash, advisory TTL, stale replacement, lock/temp-file behavior.
- no-board-write tests comparing board file hash before/after `render`, `write`, `show`, `watch` tick, and viewer route access.
- viewer route tests for `/status-report.json` token gate, board containment, stale/missing artifact behavior, and recoverable compute errors.
- browser/visual tests proving the app Status module renders from `ccm/status-report/v1` across responsive layouts, dense boards, stale reports, and recoverable errors without board writes or external network.
- legacy guidance scans proving `/cc-master:status` and `$cc-master-status` appear only in deprecated or historical context after migration.
- `git diff --check`, `bash run-tests.sh`, and plugin projection sync once plugin command/skill files are removed or shimmed.

## 3. Consequences

### 3.1 Positive

- Status becomes testable, cacheable, and web-consumable.
- Claude Code, Codex, and future harnesses share one report contract.
- The web viewer can show a board status page without an agent in the loop.
- Critical path, ready set, lint, usage, and next actions stop drifting across prompt bodies.

### 3.2 Negative

- ccm gains another generated-artifact lifecycle.
- Existing users of `/cc-master:status` / `$cc-master-status` need a migration path.
- Report freshness now has TTL and cache invalidation complexity.

### 3.3 Neutral

- Board schema and narrow waist do not change.
- Web viewer remains read-only.
- This ADR does not implement the namespace or remove existing plugin files by itself.

## 4. Alternatives Considered

### 4.1 Keep `/cc-master:status` and `$cc-master-status`

Rejected. Host-specific prompt surfaces cannot provide a stable report schema, periodic artifacts, or viewer route contract.

### 4.2 Make web-viewer compute status internally only

Rejected. That would solve the UI but leave terminal users and automation without the report. It would also make the viewer service the hidden SSOT for status computation.

### 4.3 Store report inside the board

Rejected. It would write derived data into the orchestration source of truth, expand write traffic, and risk turning the board into a cache. Reports are derived read models and belong outside the board.

### 4.4 Store report under `<home>/services/web-viewer/cache/`

Rejected as the primary location. The report is not viewer-private; CLI `show` and future clients should consume the same artifact. The viewer may keep memory caches, but durable artifacts live under `<home>/reports/status-report/`.

### 4.5 Name the namespace `ccm status`

Rejected. `status` is already a lifecycle verb across ccm namespaces and would blur process status with board status reports.

## 5. Related

- [ADR-014 — CLI decoupling as independent product](ADR-014-cli-decoupling-as-independent-product.md)
- [ADR-029 — `ccm web-viewer` namespace](ADR-029-ccm-web-viewer-namespace.md)
- [`design_docs/ccm-web-viewer.md`](../design_docs/ccm-web-viewer.md)
- [`design_docs/feature-manual.md`](../design_docs/feature-manual.md)
