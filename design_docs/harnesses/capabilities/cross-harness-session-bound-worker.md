# cross-harness-session-bound-worker

## Intent（host-neutral）

A master orchestrator running on Claude Code, Codex, Cursor, or Kimi Code can cross the same global `ccm`
process boundary to inspect the resolver-selected real agent-command help and explicitly launch a
session-bound Codex, Claude Code, Cursor Agent, or Kimi Code raw wrapper. The origin harness is not the
worker-selection boundary.

## Acceptance（可测等价类）

1. All four origins project the same A-layer decision path: choose a target independent of origin, inspect
   the resolver-selected real agent-command help, dispatch through D, then independently verify the parent task.
2. D is the only skill owner of exact command grammar, raw argv/stdin transport, generic process terminal and
   lifecycle residuals. A owns when/why to dispatch and parent acceptance; H owns only optional
   inventory/model/quota interpretation and copies no provider flags or catalog.
3. `cursor-ide-plugin` and `cursor-agent-cli` remain independent. The wrapper resolves only the requested
   CLI surface and does not infer authentication, model entitlement, quota, permission or safety.
4. A real accountable handle precedes `in_flight`. Process terminal is not parent acceptance; provider argv
   correctness and produced artifacts remain the caller's and parent orchestrator's responsibility.

## Host mechanisms

| host | status | mechanism | notes |
| --- | --- | --- | --- |
| claude-code | current | projected A/D/H guidance + global `ccm` raw wrapper | same R0 contract |
| codex | current | projected A/D/H guidance + global `ccm` raw wrapper | same R0 contract |
| cursor | current | projected A/D/H guidance + global `ccm` raw wrapper | IDE origin and Agent CLI target stay separate |
| kimi-code | current | projected A/D/H guidance + global `ccm` raw wrapper; `kimi -p` is non-interactive and must not be combined with `--yolo`/`--auto` | same R0 raw-passthrough contract; paid endpoint success remains a live-probe question |

## Current evidence

The hermetic raw-wrapper contract is current for all four harness ids. On the 2026-07-16 development host,
first-party live probes passed for Codex and Claude Code. Cursor's resolver, binary, real help and launch were
technically callable, but its launcher exited 0 while newly created same-PGID workspace helper / LSP processes
remained alive. ccm classified the run as wrapper exit 1, `state:failed`,
`error.code:owned_tree_survived`, then completed TERM/KILL cleanup with `reaped:true` and the whole owned process
group gone. There was no OK output; exact model, payer and live task success remain unproven. Cursor's live canary
on this exact host/version is therefore `partial` with an external provider-compatibility block, not a fully
qualified success. This host evidence does not transfer to another OS, kernel or Cursor version.

## Declared divergence

None in the guidance path. Each origin uses the same process-boundary capability; host-native subagents are
separate mechanisms and are not presented as equivalent to the CLI worker.

## Current / target boundary

This card is **current** only when cherry-picked and reviewed in the same runtime PR that implements the
four-harness raw wrapper. The narrow support is resolver-backed real help plus caller-selected raw argv/stdin,
bounded synchronous process lifecycle and a generic process envelope. It is not a normalized provider adapter.
Automatic routing/fallback, model or quota admission, account switching, safe/read-only eligibility,
cross-session durability, daemon takeover and hook-owned dispatch remain outside this capability.

## Linked surfaces

- A decision: `plugin/src/skills/master-orchestrator-guide/canonical/references/dispatch.md`
- D exact worker contract: `plugin/src/skills/using-ccm/canonical/references/command-catalog.md`
- H optional selected-target interpretation: `plugin/src/skills/pacing-and-estimation/canonical/references/cross-harness-target-facts.md`
- Runtime: `ccm/apps/cli/src/handlers/worker.ts`

## Probe deps

Registry/help tests prove that help and run resolve the same fake executable. Provider invocation tests prove
raw argv/stdin, cwd/default cwd, timeout/cancel/output bounds and generic process-terminal fields for all four
harness ids. They do not prove provider-specific flag correctness, paid endpoint success, safety or automatic
eligibility. Post-MVP work may investigate no-daemon / await-helper behavior or a short natural-drain grace for
Cursor, but must not relax the terminal invariant that the whole owned process group is gone.
