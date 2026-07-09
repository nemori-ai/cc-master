# post-tool-batch-gate

## Intent（host-neutral）

After a **batch** of parallel tool executions completes (fan-out window), apply orchestration
gates that need a stable "batch boundary" — notably WIP cap soft warnings (`posttool-batch`) and
mid-flight usage pacing samples that should not fire on every single `PostToolUse`.

## Acceptance（可测等价类）

1. When parallel fan-out completes, orchestrator receives at most one WIP-cap advisory per batch
   window (not N duplicates for N tools).
2. When batch boundary is unavailable, WIP enforcement degrades to per-tool guard + stop-side
   pacing without silent loss of safety (board-guard still denies direct board writes).

## Host mechanisms

| host | status | mechanism | notes |
| --- | --- | --- | --- |
| claude-code | implemented | `PostToolBatch` → posttool-batch.js + usage-pacing.js sampling | Distinct from PostToolUse |
| codex | unsupported | No PostToolBatch event — hooks.yaml `unsupported` | WIP via board-guard + stop pacing |
| cursor | unsupported | **No PostToolBatch**【官方】— hooks.yaml `unsupported` | Track B event-unavailable |

## Declared divergence

```yaml
- rule: post-tool-batch-boundary
  kind: event-unavailable
  affected_hosts: [codex, cursor]
  reason: Codex and Cursor IDE Agent expose no PostToolBatch (or equivalent batch-complete hook).
  compensating_mechanism: >
    Omit batch hook. WIP cap: rely on board-guard + verify-board stop gate. Optional future:
    debounced postToolUse sidecar (single advisory per debounce window) — not P0; must not pretend
    to be PostToolBatch parity.
  tracked_by: plugin/src/hooks/_manifest/hooks.yaml posttool-batch.host_coverage

- rule: usage-pacing-midflight-sample
  kind: event-unavailable
  affected_hosts: [codex, cursor]
  reason: usage-pacing PostToolBatch sampling segment has no trigger on these hosts.
  compensating_mechanism: Stop-only pacing advisory (see usage-pacing-midflight capability).
  tracked_by: plugin/src/hooks/usage-pacing/CONTRACT.md
```

## Linked surfaces

- Hooks: `posttool-batch`, `usage-pacing` CONTRACTs
- Reference: [`cursor.md`](../cursor.md) §Hard Gaps #2

## Probe deps

None required for event-unavailable declaration. Optional future: measure debounced `postToolUse` noise.
