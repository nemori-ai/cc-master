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
  `owner.session_id`), each rendered as `name [rN assurance: goal]` when a Goal Contract is present,
  or honestly marked `legacy` otherwise. No board bound explicitly — the agent
  recognizes its own board by goal.
- `rule-reinject-goal-integrity`: for every Goal Contract board, run the bounded read-only
  `ccm goal check --board <path> --json --no-input`. Missing/tampered Briefs or malformed contracts
  are named as a HARD STOP before dispatch. A spawn/timeout/signal/malformed-transport failure is
  not semantic evidence: inject a strong advisory, keep evaluating local gates, and do not prohibit
  dispatch on that transport failure alone. A `pending` empty board is a goal-framing stop: refine
  and persist the Goal Contract before decomposition; it is not a task-decomposition stop.
- `rule-reinject-deadline-pending`: the `deadline_pending` verdict (issue #149 — goal semantics
  settled but the delivery DDL not yet settled, exit 0) is a member of the known-verdict closed set
  (not `check_unavailable`, not a goal-integrity HARD STOP). It is surfaced as a plain **advisory**:
  before decomposing/dispatching, settle the DDL (`ccm goal deadline set/confirm --user-authorized`)
  or confirm no-DDL (`ccm goal deadline confirm-none --user-authorized`) so `ccm goal check` returns
  `ok`. Advisory, not a hard stop — DDL dispatch gating is an agent-level judgment, not a reinject
  hard block.
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
- rule: rule-reinject-goal-integrity
  required_hosts: [claude-code, codex]
- rule: rule-reinject-deadline-pending
  required_hosts: [claude-code, codex]
```

Cursor Track B does **not** claim PARITY anchors for empty-board / dangling-node reinject text —
those rules stay Claude Code + Codex only. Cursor acceptance is equivalence-class coverage via
alwaysApply rule + Capability Card (not byte-identical SessionStart substrate).

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

- rule: reinject-full-substrate-on-compact
  kind: protocol-capability-gap
  affected_hosts: [cursor]
  reason: >
    Cursor preCompact cannot inject agent context; sessionStart does not re-fire after compact
    (forum 158873); sessionStart.additional_context is a staff-confirmed drop bug (forum 158452 ·
    D4 FAIL). Full SessionStart/compaction-triggered SKILL A re-injection has no documented 1:1
    equivalent on Cursor.
  compensating_mechanism: >
    Track B layered substitute: (1) alwaysApply rule plugin/src/rules/cursor/cc-master-orchestrator.mdc
    (projected to plugin/dist/cursor/rules/) — slim role pointer + red-line summary + empty-board
    hard-stop, not full SKILL A; (2) preCompact core is a documented silent no-op (exit 0, empty
    stdout) because injection is useless on that event; (3) do NOT register sessionStart
    additional_context reinject. Acceptance = Capability Card equivalence classes, not full text parity.
  tracked_by: design_docs/harnesses/capabilities/role-substrate-reinject.md + cursor.md D3,D4

- rule: reinject-kimi-postcompact-discarded
  kind: protocol-capability-gap
  affected_hosts: [kimi-code]
  reason: >
    kimi fires PostCompact and SessionStart hooks but discards their output (PostCompact via
    fireAndForgetTrigger; SessionStart results dropped by triggerSessionStart) — K4 probe: static
    agent-core analysis + live confirmation (SessionStart hook fired, message not injected). So a hook
    cannot re-inject the role substrate after compaction, nor carry the dynamic board list /
    empty-board hard-stop / stale nodes.
  compensating_mechanism: >
    Track B static substrate: the manifest `sessionStart.skill` field is wired to
    `master-orchestrator-guide` (the same canonical skill body Claude Code's own PostCompact reinject
    re-injects verbatim — not a separate slim substrate skill), so kimi-code gets full-text content
    parity with Claude Code's reinject rather than a degraded summary. PluginSessionStartInjector is a
    DynamicInjector whose onContextCompacted() resets injectedAt and injectAfterCompaction() re-runs
    inject(), so that skill content is RE-INJECTED after every compaction natively (stronger than
    Cursor's alwaysApply, which cannot re-fire after compact). The PostCompact reinject-core.js is a
    documented silent no-op. What is still lost vs Claude Code's hook-carried message: the dynamic
    board list / empty-board hard-stop / stale-node reminder (those need a hook `message` channel; no
    such channel survives compaction on kimi). Acceptance = Capability Card equivalence classes.
  tracked_by: design_docs/harnesses/capabilities/role-substrate-reinject.md + kimi-code.md §6
```
