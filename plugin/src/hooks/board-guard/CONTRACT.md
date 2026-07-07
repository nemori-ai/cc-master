# board-guard CONTRACT

Host-neutral business-rule SSOT for the `board-guard` hook (HOOKPAR-DEC, ADR-025).

## 触发意图

Board writes must only ever happen through `ccm` — that is where schema/state-machine/lock
invariants are enforced. `board-guard` is a PreToolUse gate that intercepts the agent's own
tool calls (structured file edits or shell commands) **before** they execute, and denies any
attempt to hand-edit a `*.board.json` file directly, redirecting the agent to the equivalent
`ccm` verb.

## 业务规则

- `rule-board-guard-structured-write`: a `Write`/`Edit`/`MultiEdit` tool call whose target file path
  resolves (after path normalization) into `<home>/boards/` and ends in `.board.json` is denied.
  Non-board files are always allowed.
- `rule-board-guard-bash-heuristic`: a `Bash` command is denied only if some single shell command
  *segment* (split on `;`, `&&`, `||`, `|`, newline, with unquoted `#...` comments stripped)
  simultaneously (a) contains a `.board.json`-looking token, (b) contains a write-operator
  (`>`, `>>`, `sed -i`, `tee`, `cp`, `mv`, `dd`, `truncate`), and (c) is not itself a `ccm ...`
  invocation (env-var prefixes like `FOO=1 ccm ...` still count as a ccm invocation). This is a
  best-effort heuristic, deliberately biased toward false negatives (missed hand-edits) over false
  positives (denying an unrelated command) — see `rule-board-guard-segment-touches-real-board`.
- `rule-board-guard-segment-touches-real-board`: within a candidate segment, a `.board.json` token
  only counts as "touching a real board" if it resolves (via path normalization) under the boards
  directory (`<home>/boards/`). A token containing unexpanded shell variables (e.g. `$B/x.board.json`)
  is conservatively treated as real (can't statically resolve it, so err toward denying). A token
  that resolves outside the boards directory (a scratch file, a doc example, a `/tmp` test fixture)
  does **not** count, and must not cause a deny.
- `rule-board-guard-arming-gate`: dormant until the current session is armed (an active board with
  matching `owner.session_id` exists) — an unarmed session may freely Write/Edit any file, including
  ones that happen to be named `*.board.json`.
- `rule-board-guard-directive-tag`: every deny carries a `<directive source="board-guard">` body that
  states *why* (board invariants are only enforced through `ccm`) and *what to do instead* (the
  relevant `ccm` verb).

## 注入 taxonomy

- Every deny reason is a **directive** — it is a hard PreToolUse block, and the agent has no
  reasonable path other than to comply and use `ccm` instead.

## 武装语义

`arm:'custom'` on Claude Code (isArmed must be checked *before* Gate 1's tool/path judgment, since
harness-preset arming would incorrectly early-return before the guard even sees the tool call) /
equivalent inline `isArmed` check at the top of `main()` on Codex. Reads only `owner.active` /
`owner.session_id` (narrow-waist) — never reads or writes board content.

## PARITY anchors

```yaml
- rule: rule-board-guard-segment-touches-real-board
  required_hosts: [claude-code, codex]
- rule: rule-board-guard-directive-tag
  required_hosts: [claude-code, codex]
```

## 降级行为

```yaml
- rule: board-guard-apply-patch
  kind: host-convention-divergence
  affected_hosts: [claude-code]
  reason: >
    Codex often edits files through an `apply_patch` tool rather than Claude Code's
    Write/Edit/MultiEdit surface. Claude Code has no equivalent tool, so it has no corresponding
    rule at all (not a gap on Claude Code's side — the tool simply doesn't exist there).
  compensating_mechanism: >
    Codex's board-guard-core.js additionally scans `apply_patch` payload text for `.board.json`
    path mentions (`applyPatchTouchesBoard`) and denies on a hit. This is intentionally a distinct
    host-native tool surface, not a divergence to reconcile — declared here so it is not mistaken
    for an accidental omission on the Claude Code side.
  tracked_by: "n/a — legitimate host-tool-surface difference, not a bug"

- rule: board-guard-bash-fallback-false-positive
  kind: host-convention-divergence
  affected_hosts: [codex]
  reason: >
    Prior to HOOKPAR-DEC, the Codex `bashWritesBoard` had no `segmentTouchesRealBoard` equivalent
    and carried an extra fallback branch (`sawBoardWrite ? false : WRITE_OP_RE.test(wholeCommand)`)
    that denied whenever any write-operator appeared anywhere in the command and any `.board.json`
    mention appeared anywhere else, even in an unrelated segment or a scratch/test path outside the
    boards directory (see design_docs/plans/2026-07-07-hook-parity-system.md §2.5 for the exact
    repro: `echo hi > /tmp/scratch.txt; cat notes.board.json`).
  compensating_mechanism: >
    Fixed in this round — codex board-guard-core.js now ports segmentTouchesRealBoard and drops
    the fallback branch, matching claude-code board-guard.js's judgment table byte-for-byte.
  tracked_by: "adrs/ADR-028-hook-parity-contract-and-normalization.md (fixed, this PR)"

- rule: board-guard-directive-tag-protocol
  kind: host-convention-divergence
  affected_hosts: [codex]
  reason: >
    Prior to HOOKPAR-DEC, Codex board-guard-core.js emitted a bare `{kind:'block', message}` with no
    ADR-018 tag wrapper, so the agent had no machine-readable signal for how much attention the deny
    reason deserved (it always deserves full attention — deny reasons are hard gates).
  compensating_mechanism: >
    Fixed in this round — codex board-guard-core.js now wraps the deny message in a local
    `directive('board-guard', body)` helper (no shared hook-common on the Codex side to import from,
    so the wrapper is a small local duplicate matching claude-code's hook-common.js directive()
    byte-for-byte in output shape).
  tracked_by: "adrs/ADR-028-hook-parity-contract-and-normalization.md (fixed, this PR)"
```
