# role-substrate-reinject

## Intent（host-neutral）

After context compaction or session boundary loss, the orchestrator must regain **role substrate**:
who it is (master orchestrator), which active board(s) belong to this session (by goal), and
hard-stop signals for armed-but-empty boards and dangling `stale`/`escalated` nodes. This is
**operating substrate**, not a transient advisory (exempt from ADR-018 tag protocol per reinject
CONTRACT).

## Acceptance（可测等价类）

Given a session with matching active board(s):

1. Agent context is re-primed with master-orchestrator identity and a list of boards as
   `name [goal]` (equivalence: content present, wording may differ).
2. If any listed board has zero tasks, a **hard-stop** note appears — agent must not treat the
   session as permission to implement/test/git/PR without decomposition.
3. If top-level tasks are `stale` or `escalated`, they are named in a resume reminder.
4. Dormant when no matching active boards (silent).

Fixture tests assert equivalence classes, not byte-identical reinject text.

## Host mechanisms

| host | status | mechanism | notes |
| --- | --- | --- | --- |
| claude-code | implemented | `SessionStart` hook (`matcher: startup\|resume\|compact`) reinject.js full SKILL A re-injection | Substrate exemption |
| codex | implemented | `SessionStart` reinject-core.js — same rules + optional subagent tool_search hint | See reinject CONTRACT divergence |
| cursor | implemented | **Layered substitute** (Track B): ① alwaysApply `plugin/dist/cursor/rules/cc-master-orchestrator.mdc` slim pointer to master-orchestrator-guide (not full SKILL A); ② `preCompact` → silent no-op core (cannot inject【官方】·D3); ③ **do not** rely on `sessionStart.additional_context` (staff-confirmed drop bug · D4 FAIL) | Not 1:1 full reinject; D3/D4 closed by docs+forum 2026-07-09; hooks.yaml `implemented-track-b` |

## Declared divergence

```yaml
- rule: reinject-full-substrate-on-compact
  kind: protocol-capability-gap
  affected_hosts: [cursor]
  reason: >
    Cursor preCompact cannot inject agent context; sessionStart does not re-fire after
    compact (forum 158873); sessionStart.additional_context is a staff-confirmed drop bug
    (forum 158452 · D4 FAIL). Full SessionStart/compaction-triggered SKILL A re-injection
    has no documented 1:1 equivalent.
  compensating_mechanism: >
    Layered approach: (1) alwaysApply rule with navigation pointers + red-line summary under
    token budget; (2) preCompact observational logging / optional user-visible reminder only;
    (3) do NOT depend on sessionStart.additional_context for board list or role substrate.
    Acceptance targets equivalence classes 1–4 above, not full SKILL A text parity.
  tracked_by: design_docs/harnesses/capabilities/role-substrate-reinject.md + cursor.md D3,D4 (closed 2026-07-09)

- rule: reinject-subagent-dispatch-discovery-hint
  kind: host-convention-divergence
  affected_hosts: [claude-code]
  reason: Codex-only tool_search hint for hidden subagent tools; Claude Agent tool always visible.
  compensating_mechanism: n/a
  tracked_by: plugin/src/hooks/reinject/CONTRACT.md
```

## Linked surfaces

- Hook: [`plugin/src/hooks/reinject/CONTRACT.md`](../../../plugin/src/hooks/reinject/CONTRACT.md)
- Skill: `master-orchestrator-guide` (substrate source narrative)
- Rules: `plugin/src/rules/cursor/cc-master-orchestrator.mdc` → sync → `plugin/dist/cursor/rules/` (alwaysApply; Track B main load)
- Hook: `plugin/src/hooks/reinject/implementations/cursor/precompact-observe-core.js` (silent no-op on preCompact)

## Probe deps

cursor.md Dogfood Backlog: **D3** / **D4** — **closed 2026-07-09** via official docs + Cursor forum
(staff-confirmed). Live compact re-fire not required before Track B implementation.
