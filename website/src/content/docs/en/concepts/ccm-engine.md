---
title: The ccm engine
description: An independently installed CLI owns every board write, every invariant, and every forecast — the plugin is just one of its consumers.
section: concepts
order: 4
deeper:
  - label: Command catalog — the full ccm surface, verb by verb
    url: https://github.com/nemori-ai/cc-master/blob/main/plugin/src/skills/using-ccm/canonical/references/command-catalog.md
  - label: ADR-014 — decoupling the CLI into an independent product
    url: https://github.com/nemori-ai/cc-master/blob/main/adrs/ADR-014-cli-decoupling-as-independent-product.md
  - label: ADR-022 — the two version lines
    url: https://github.com/nemori-ai/cc-master/blob/main/adrs/ADR-022-version-line-decoupling.md
---

`ccm` is a standalone CLI (a per-OS Node binary, backed by the `@ccm/engine` library) that holds the single source of truth for boards, quota, estimation, workers, and the agent registry. It installs independently of the plugin and versions on its own track.

The architectural line is a **process boundary**: plugin hooks and skills never import the engine — they shell out to the global `ccm` binary and exchange JSON. That keeps every write behind one gate, lets the same engine serve the web viewer and future clients, and means a `ccm` upgrade never requires reinstalling the plugin.

## The command surface, at a glance

| Namespace | What it covers |
|---|---|
| `board` / `task` / `goal` | Board lifecycle, the task state machine, DAG/critical-path analysis, and the versioned Goal Contract |
| `log` / `jc` / `cadence` | Append-only audit trail, judgment-call records, iteration shipping rhythm |
| `usage` / `estimate` / `baseline` | **Read-only advisories**: quota windows and verdicts, Monte-Carlo forecasts, EVM baselines |
| `quota` / `model-policy` / `provider` | Machine-wide cached quota posture, model-role views, provider facts |
| `worker` / `agent` / `harness` / `runtime` | Cross-harness worker wrapper, the runtime agent registry, machine inventory, runtime supply chain |
| `account` | The Claude Code account pool (add/refresh/delete/list/switch) — credentials stay token-blind |
| `coordination` / `peers` / `monitor` | Multi-orchestrator awareness: cross-board roster, notification inbox, pool arbiter, background monitor daemon |
| `status-report` / `web-viewer` | The generated status report and the read-only local mission-control UI |
| `watchdog` / `policy` / `upgrade` | Self-wakeup timers, board-scoped autonomy policy, self-upgrades |

Every command accepts `--json` (machine-readable envelope: `{"ok": true, "data": …}`) and shares global flags like `--board`, `--home`, and `--dry-run`. The full verb-by-verb surface is the command catalog linked below.

## The agent lifecycle, closed both ways

Every dispatch registers a runtime actor (`ccm agent create|bind|link`), and once its output is harvested and verified the orchestrator closes the loop with `ccm agent terminal` — a terminal agent is evidence, never automatic task acceptance. `ccm agent probe` reconciles liveness without closing anything, and `ccm agent list` surfaces `stale_candidates` when a registered agent has gone quiet. The registry observes; it never spawns.

## ccm advises; the orchestrator decides

The read-only namespaces (`usage`, `estimate`, `model-policy`, `route`) are deliberately **advisory**. `ccm usage advise` returns a verdict (`hold`, `throttle`, `switch`, `stop_5h`, `stop_7d`) with evidence and honesty fields (source, confidence, freshness); `ccm estimate forecast` returns P50/P80/P95 ETAs from thousands of simulations. Neither executes anything — slowing down, switching accounts, or dispatching is always the orchestrator's call. Facts come from the engine; judgment stays with the agent, and authority with you.

When a signal is missing, stale, or unverifiable, ccm says `unknown` / `available: false` — it never papers over a gap as "plenty of quota left."

## One write gate, 82 invariants

All board writes — from the agent, from hooks, from the CLI itself — pass a single gate in the engine: lock, mutate, dependency re-gating, then **82 lint invariants** (schema, graph, and business rules) before the atomic write. Illegal transitions and malformed fields are rejected with `exit 3` and a list of violations, which is how "write it right the first time" stays a mechanical property rather than a hope.

## Two version lines

The plugin and `ccm` release independently: the plugin ships under bare `vX.Y.Z` tags, `ccm` under `ccm-vX.Y.Z` tags. The installer resolves the latest of each line, and you can pin them separately (`--plugin-version` / `--ccm-version`). When upgrading one line at a time, upgrade `ccm` first — new plugin features may depend on newer engine commands, while an older plugin against a newer `ccm` is handled additively.
