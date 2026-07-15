# cross-harness-session-bound-worker

## Intent（host-neutral）

A master orchestrator running on Claude Code, Codex, or Cursor can cross the same global `ccm`
process boundary to actively query a selected worker target and explicitly launch the current read-only,
session-bound Cursor Agent thin slice. The origin harness is not the worker-selection boundary.

## Acceptance（可测等价类）

1. All three origins project the same A-layer decision path. With no target facts pre-injected, the
   orchestrator follows D's active-query surface before deciding and uses H's provider-neutral target-fact
   interpretation. Origin-local facts never fill a target-worker gap.
2. D is the only runtime owner of exact command grammar, output/terminal semantics and residual effects.
   A owns the route/admission/lifecycle decision; H owns only inventory/model/quota interpretation.
3. `cursor-ide-plugin` and `cursor-agent-cli` remain independent. Static model facts do not prove live
   entitlement/exact admission, and quota-store availability does not prove headroom.
4. Unknown, stale, conflicting, tight or unbound target evidence means no spawn. A real accountable handle
   precedes `in_flight`, and worker terminal evidence still requires parent acceptance.

## Host mechanisms

| host | status | mechanism | notes |
| --- | --- | --- | --- |
| claude-code | current-partial | projected A/D/H guidance + global `ccm` process boundary | same MVP contract |
| codex | current-partial | projected A/D/H guidance + global `ccm` process boundary | same MVP contract |
| cursor | current-partial | projected A/D/H guidance + global `ccm` process boundary | IDE origin and Agent CLI target stay separate |

## Declared divergence

None in the guidance path. Each origin uses the same process-boundary capability; host-native subagents are
separate mechanisms and are not presented as equivalent to the CLI worker.

## Current / target boundary

This card is **current/partial**. Current support is one explicit, read-only, session-bound Cursor Agent
worker plus active read-only fact acquisition. The active query can honestly end in no-spawn when quota
authority references, live exact-model evidence, or per-call authorization are absent. Automatic routing or
fallback, account switching, write-capable workers, cross-session durability, daemon takeover and hook-owned
dispatch remain outside this capability.

## Linked surfaces

- A decision: `plugin/src/skills/master-orchestrator-guide/canonical/references/dispatch.md`
- D active-query and worker contract: `plugin/src/skills/using-ccm/canonical/references/command-catalog.md`
- H selected-target interpretation: `plugin/src/skills/pacing-and-estimation/canonical/references/cross-harness-target-facts.md`
- Runtime: `ccm/apps/cli/src/handlers/worker.ts`

## Probe deps

Registry/help tests prove the four active-query surfaces and worker surface. Behavioral evaluation starts with
no target facts in context and requires an active query before route judgment. Provider invocation tests use
a controlled fake executable; they do not require a paid canary or prove provider-wide zero-write.
