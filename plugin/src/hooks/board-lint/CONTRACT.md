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
    the patch payload text. In the nested `functions.exec` -> `tools.apply_patch` FREEFORM path, a
    direct-core normalized hook envelope can retain that text as `tool.input.input`, so the shared
    Codex host normalizer (`_hosts/codex/apply-patch-input.js`) runs at board-lint's candidate-path
    classification boundary and collapses every recognized carrier to `{ patch: string }`: the
    native string, canonical patch object, and nested `{ input: string }` object. Keeping the
    boundary in the core covers both launcher-mediated and direct-core invocation. Claude Code has no
    `apply_patch` tool or nested `functions.exec` -> `tools.apply_patch` carrier; its board-lint
    receives structured Write/Edit/MultiEdit paths, so it needs neither this normalizer nor a
    matching implementation change.
  compensating_mechanism: "n/a — legitimate Codex host-envelope difference, not a parity gap."
  tracked_by: "n/a"

- rule: board-lint-kimi-posttooluse-discarded
  kind: host-convention-divergence
  affected_hosts: [kimi-code]
  reason: >
    kimi delivers PostToolUse via fireAndForgetTrigger — the hook's output (message) is discarded,
    so the lint advisory may not reach the model context (K4 probe: static agent-core analysis).
  compensating_mechanism: >
    board-guard PreToolUse deny is the authoritative gate on kimi (it denies Write/Edit/MultiEdit and
    Bash writes to real boards before they execute), so the post-hoc lint backstop is redundant.
    board-lint-core.js is still registered/projected (runs the same lint) for forward-compat; its
    message is emitted best-effort. SSOT: _hosts/kimi-code/ENVELOPE.md.
  tracked_by: design_docs/2026-07-16-kimi-code-adapter-design.md §3
```
