# workflow-authoring

## Intent（host-neutral）

Enable orchestrators and workers to author, debug, and launch **Claude Code dynamic-workflow**
scripts (parallel/pipeline patterns, determinism rules, relaunch discipline) as a first-class
dispatch mechanism for complex fan-out.

## Acceptance（可测等价类）

1. On hosts with Workflow tool: skill `authoring-workflows` is discoverable and guides correct
   workflow API usage.
2. On hosts without Workflow: skill is **`unsupported_stub`** with explicit dispatch substitutes
   (Task subagent, background shell, `/loop`, external SDK) — agent must not receive dead
   workflow API references.

## Host mechanisms

| host | status | mechanism | notes |
| --- | --- | --- | --- |
| claude-code | implemented | `authoring-workflows` skill + Workflow tool | Full SAP |
| codex | unsupported_stub | `adapters/codex/strategy.yaml` mode unsupported_stub | No Workflow equivalent |
| cursor | unsupported_stub | `adapters/cursor/strategy.yaml` mode `unsupported_stub` | Task tool + background shell + `/loop` substitutes |
| kimi-code | unsupported | No Workflow equivalent | `authoring-workflows` unsupported_stub; alt: Bash background tasks / built-in coder/explore/plan subagents + Agent Swarm |

## Declared divergence

```yaml
- rule: dynamic-workflow-tool
  kind: event-unavailable
  affected_hosts: [codex, cursor]
  reason: No verified Claude dynamic-workflow / Workflow tool equivalent on Codex or Cursor IDE Agent.
  compensating_mechanism: >
    unsupported_stub skill body; current master-orchestrator-guide Cursor dispatch slots point to
    Task subagent, background shell (block_until_ms:0), /loop where available, and external schedulers.
  tracked_by: plugin/src/skills/authoring-workflows/adapters/codex/strategy.yaml + plugin/src/skills/authoring-workflows/adapters/cursor/strategy.yaml

- rule: workflow-authoring-kimi-event-unavailable
  kind: event-unavailable
  affected_hosts: [kimi-code]
  reason: kimi has no Workflow authoring/execution equivalent.
  compensating_mechanism: authoring-workflows unsupported_stub; alt Bash background tasks / built-in subagents + Agent Swarm.
  tracked_by: design_docs/2026-07-16-kimi-code-adapter-design.md §7
```

## Linked surfaces

- Skill: `authoring-workflows`, `master-orchestrator-guide` dispatch references
- ADR-002 / ADR-011 ship-anywhere dispatch floor (background shell universal)

## Probe deps

None — capability gap is structural on every unsupported host (no Workflow tool equivalent).
