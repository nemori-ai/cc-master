# board-lint CONTRACT

Host-neutral business-rule SSOT for the `board-lint` hook (HOOKPAR-DEC).

## 触发意图

After the agent edits a board file directly (this hook fires on `Write`/`Edit`/`MultiEdit`, and on
Codex additionally `apply_patch`), re-lint it through the authoritative `ccm board lint` engine and
inject a non-blocking report if anything is wrong. Since the edit is already on disk, this can never
be a hard gate — it is a soft "fix this next" nudge.

## 业务规则

- `rule-board-lint-active-board-gate`: only fires when the edited file resolves to the current
  session's active board (armed session + the file being edited is that exact board file) —
  archived boards, other sessions' boards, and unarmed sessions produce no output.
- `rule-board-lint-via-ccm`: `ccm board lint --board <file> --raw --json` is the single source of
  truth for lint rules; the hook never re-implements or duplicates a rule set.
- `rule-board-lint-graceful-degrade`: `ccm` unavailable / non-JSON stdout / unexpected shape → silent
  (exit 0), never crash, never block.
- `rule-board-lint-strength-by-hard-error`: report strength is `strong` if any violation is a `hard`
  error (structurally breaks the board — would hang a viewer/resume), `weak` if all violations are
  `warn`-level.
- `rule-board-lint-tag-protocol`: the report is wrapped `<advisory source="board-lint"
  strength="weak"|"strong">` — never `<directive>` (the decision to go fix it now vs. later is the
  agent's, this is not a system gate).

## 注入 taxonomy

- Always **advisory** (weak or strong per `rule-board-lint-strength-by-hard-error`) — never a
  directive, since PostToolUse cannot un-write an already-applied edit.

## 武装语义

`arm:'custom'` on Claude Code (the extra "is this file *my* active board" gate, `targetIsMyActiveBoard`
per AGENTS.md §12, stacks on top of the isArmed check) / equivalent inline gate on Codex.

## PARITY anchors

```yaml
- rule: rule-board-lint-tag-protocol
  required_hosts: [claude-code, codex]
```

## 降级行为

```yaml
- rule: board-lint-apply-patch-surface
  kind: host-convention-divergence
  affected_hosts: [claude-code]
  reason: >
    Codex's board-lint-core.js additionally matches on `apply_patch`, extracting board paths from
    the patch payload text, since Codex frequently edits files through apply_patch rather than
    Write/Edit/MultiEdit. Claude Code has no apply_patch tool, so it has no corresponding matcher.
  compensating_mechanism: "n/a — legitimate host-tool-surface difference, not a bug to reconcile."
  tracked_by: "n/a"
```
