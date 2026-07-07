# reinject CONTRACT

Host-neutral business-rule SSOT for the `reinject` hook (HOOKPAR-DEC).

## 触发意图

Compaction (and, more generally, any SessionStart) wipes the "I am a master orchestrator" role out
of context — the agent cannot re-inject its own role after amnesia. `reinject` is the SessionStart
hook that restores that role substrate: point at home, list this session's active board(s) by goal,
and flag unresolved bookkeeping (empty boards, `stale`/`escalated` nodes) that need reconciling
before new work is scheduled.

## 业务规则

- `rule-reinject-list-active-boards`: list every board matching this session (`owner.active:true` +
  `owner.session_id`), each rendered as `name [goal]`. No board bound explicitly — the agent
  recognizes its own board by goal.
- `rule-reinject-empty-board-hard-stop`: any listed board with zero tasks triggers a HARD STOP note
  — an armed-but-undecomposed board must never be read as permission to start implementation/tests/
  git/PR work.
- `rule-reinject-dangling-nodes`: any top-level task with `status` `stale` or `escalated` is named
  (with its `parent` owner, if any) in a "Note on resume: unresolved node(s)" reminder.
- `rule-reinject-substrate-exemption`: reinject output is the agent's operating substrate (role
  re-grounding), not a transient signal — it is explicitly exempt from the ADR-018
  ambient/advisory/directive tag protocol (AGENTS.md §13's own carve-out).

## 注入 taxonomy

N/A by design — `rule-reinject-substrate-exemption` means this hook's output is substrate, not a
tagged ambient/advisory/directive message.

## 武装语义

`arm:'boards'` — dormant (silent) when the session has zero matching active boards.

## PARITY anchors

```yaml
- rule: rule-reinject-empty-board-hard-stop
  required_hosts: [claude-code, codex]
- rule: rule-reinject-dangling-nodes
  required_hosts: [claude-code, codex]
```

## 降级行为

```yaml
- rule: reinject-subagent-dispatch-discovery-hint
  kind: host-convention-divergence
  affected_hosts: [claude-code]
  reason: >
    Codex's reinject-core.js includes an extra clause telling the agent to use tool_search to
    surface multi-agent dispatch tools if they are not visible, and to use
    multi_agent_v1.spawn_agent once discovered. This reflects a real Codex-only tool-discovery UX
    quirk (some Codex API/tool sessions do not surface subagent tools by default); Claude Code has
    no equivalent hidden-tool-discovery step, so it has no corresponding clause.
  compensating_mechanism: "n/a — Claude Code subagent dispatch (the Agent tool) is always visible; nothing to compensate."
  tracked_by: "n/a — legitimate host-capability difference, not a bug"
```
