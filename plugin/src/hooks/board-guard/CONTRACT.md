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
  On Codex every recognized alias (`file_path`, `path`, `filename`) is inspected: any board target
  is denied, and multiple aliases are denied fail-closed when a value is invalid or the normalized
  targets conflict. A single valid non-board alias remains allowed.
- `rule-board-guard-apply-patch-targets`: an `apply_patch` call is classified only from its
  structured `*** Add File:` / `*** Delete File:` / `*** Update File:` / `*** Move to:` headers.
  Codex surfaces the patch through more than one carrier shape. The shared host normalizer
  (`_hosts/codex/apply-patch-input.js`) runs at each Codex core's classification boundary and
  collapses each recognized carrier to the single `{ patch: string }` object the parser expects: a
  native FREEFORM bare string, an already-canonical `{ patch: <string> }` object, and the nested
  `functions.exec` -> `tools.apply_patch` FREEFORM carrier `{ input: <patch string> }`. An
  unrecognized carrier (non-string, array, or an object with no string `patch`/`input`) is passed
  through unchanged so the parser still sees no usable patch and denies fail-closed.
  One optional non-empty `*** Environment ID: ...` control directive is accepted only immediately
  after `*** Begin Patch`; its value uses the same exact Rust `char::is_whitespace` normalization as
  controls. It, the known non-target `*** End of File` marker, and patch hunk content are never
  target-path signals. The parser preserves the installed tool's context-sensitive whitespace
  grammar: whitespace outside the envelope is ignored; envelope markers and file headers in a
  top-level control slot normalize both sides; `Move to` / `End of File` in Update state normalize
  only trailing whitespace. Normalization uses Unicode White_Space
  (`0009-000D,0020,0085,00A0,1680,2000-200A,2028,2029,202F,205F,3000`) and deliberately excludes
  `FEFF`. Physical-line ingestion removes at most two suffix CR bytes (the installed CRLF pipeline's
  bounded behavior); a third remains raw and makes an otherwise empty hunk line malformed. Hunk
  lines otherwise use their raw prefix, so a leading-space header-looking line remains context data
  rather than target evidence. Whitespace-only physical lines may follow a valid `End of File`, but
  nonblank Update content after it still requires a new `@@` marker.
  Every source and destination header is denied if its filesystem-effect path resolves into
  `<home>/boards/*.board.json`. Codex 0.144.2 classifies target rootedness from the raw target before
  its filesystem-effect cleanup removes embedded TAB/CR, and the guard must preserve that order: a
  target beginning raw TAB/CR followed by `/absolute-looking-path` remains relative and resolves to
  a shadow below the patch cwd rather than to the absolute-looking path. Only after rootedness is
  fixed is the observed TAB/CR removal mirrored for classification. No other byte is removed (`FEFF`
  suffixes remain distinct paths), and an ordinary leading space remains a literal target byte (two
  spaces after the header colon must not collapse). The resulting effect path follows every existing
  final-file or ancestor symlink; for an absent Add/Move destination it resolves the deepest existing
  ancestor and appends the still-absent suffix. A broken/looping symlink, non-directory ancestor,
  permission failure, or any other opaque filesystem resolution is ambiguous and therefore denied
  fail-closed. Embedded CR/U+2028 remain safely capturable by
  the control lexer. Multi-file patches are denied when any declared target is a board.
  The parser also validates the current tool grammar: every present Add body line starts `+` (an
  empty Add is valid), Delete has no body, Update has at least one hunk line whose non-empty lines
  start with space/`+`/`-`, and `*** End of File` occurs only after a non-empty Update hunk (a later
  hunk starts with `@@`). An empty, duplicate, or late Environment ID directive, missing/unknown/
  conflicting headers, invalid bodies/marker ordering, or an incomplete patch envelope are malformed
  or ambiguous and therefore denied fail-closed.
- `rule-board-guard-bash-heuristic`: a `Bash` command is denied only if some single shell command
  *segment* (split on `;`, `&&`, `||`, `|`, newline, with unquoted `#...` comments stripped)
  simultaneously (a) contains a `.board.json`-looking token and (b) contains a write-operator
  (`>`, `>>`, `sed -i`, `tee`, `cp`, `mv`, `dd`, `truncate`). The command word does not exempt a
  shell write: `ccm ... > board` and `ccm ... >> board` are denied because the shell opens/truncates
  the board outside ccm's write gate. For an actual `ccm` command segment, redirections are
  target-aware: a board used only as the `--board` argv value is not a shell write target, so
  redirecting ordinary CLI output to a non-board target such as `/dev/null` remains allowed; any
  `>` / `>>` whose own target is a real board is still denied. Shell syntax in earlier segments
  (including a `FIRE=$(date ...)` assignment used by a later `ccm watchdog arm`) cannot bleed into
  the ccm segment. Quoted argv data remains data even when it contains `#`, `;`, `|`, or `>`.
  An ordinary `ccm ... --board <board>` with no redirection also remains allowed. This is a
  best-effort heuristic, deliberately biased toward false
  negatives (missed hand-edits) over false positives (denying an unrelated command) — see
  `rule-board-guard-segment-touches-real-board`.
- `rule-board-guard-nested-shell-command`: when the actual command word (after env assignments) is
  `bash` or `sh` (an absolute launcher path is allowed) and it has an exact `-c` option, the following
  argv word is executable shell syntax and is recursively inspected by the same bounded lexer. No
  other quoted/ordinary argv word is reinterpreted as shell code: text passed to `printf`, `echo`,
  `node`, or another ordinary command remains data even if it contains `tee`, `>`, `bash -c`, and a
  protected-board path. Recursion is capped at four nested launchers; a deeper candidate that still
  contains a protected-board path plus a write hint is denied fail-closed rather than bypassing the
  guard. This is a deliberately bounded lexer rule, not a general shell AST or expansion engine.
- `rule-board-guard-segment-touches-real-board`: within a candidate segment, a `.board.json` token
  only counts as "touching a real board" if it resolves (via path normalization) under the boards
  directory (`<home>/boards/`). A token containing unexpanded shell variables (e.g. `$B/x.board.json`)
  is conservatively treated as real (can't statically resolve it, so err toward denying). A token
  that resolves outside the boards directory (a scratch file, a doc example, a `/tmp` test fixture)
  does **not** count, and must not cause a deny. Shell classification consumes lexer words directly;
  it never joins parsed argv back into a whitespace-delimited string, so a quoted protected path that
  contains spaces remains one path token through rootedness and boards-directory classification.
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
  required_hosts: [claude-code, codex, cursor]
- rule: rule-board-guard-bash-heuristic
  required_hosts: [claude-code, codex, cursor]
- rule: rule-board-guard-nested-shell-command
  required_hosts: [claude-code, codex, cursor]
- rule: rule-board-guard-directive-tag
  required_hosts: [claude-code, codex, cursor]
- rule: rule-board-guard-apply-patch-targets
  required_hosts: [codex]
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
    Codex's board-guard-core.js uses an explicit context-aware control lexer and section-state parser
    for the `apply_patch` envelope, its optional leading Environment ID directive, and file headers;
    classifies every declared source/destination path; validates Add/Delete/Update body grammar and
    End-of-File placement against the current apply_patch parser; and reads hunk content from raw
    prefixes so header-looking data is never path evidence.
    Ambiguous or malformed patch structure is denied fail-closed. This is intentionally a distinct
    host-native tool surface, not a divergence to reconcile — declared here so it is not mistaken
    for an accidental omission on the Claude Code side.
  tracked_by: "n/a — legitimate host-tool-surface difference, not a bug"

- rule: board-guard-apply-patch-envelope-normalization
  kind: host-convention-divergence
  affected_hosts: [claude-code, cursor, kimi-code]
  reason: >
    `apply_patch` is a Codex- (and Codex-family-) only tool surface. Codex delivers the patch under
    several carrier shapes — a native FREEFORM bare string, an already-canonical `{ patch: <string> }`
    object, and the nested `functions.exec` -> `tools.apply_patch` FREEFORM carrier
    `{ input: <patch string> }`. The parser needs a single `{ patch: string }` object. claude-code,
    cursor, and kimi-code have no `apply_patch` tool at all (they edit through Write/Edit/MultiEdit or
    Shell/Bash), so there is no carrier for them to normalize — not a gap on their side.
  compensating_mechanism: >
    The shared Codex host normalizer (`_hosts/codex/apply-patch-input.js`
    `normalizeApplyPatchInput`) collapses each recognized carrier to `{ patch: string }` immediately
    before board-guard / board-lint classify targets, so an ordinary non-board `apply_patch` source
    edit is allowed. An unrecognized carrier (non-string, array, or an object with no string
    `patch`/`input`) is passed through unchanged so the parser still sees no usable patch and denies
    fail-closed; real board targets and symlink/effect-path ambiguity remain denied. This one helper
    covers both launcher-mediated and direct-core Codex paths.
  tracked_by: "GitHub issue #156 (fixed, this PR)"

- rule: board-guard-kimi-envelope
  kind: host-convention-divergence
  affected_hosts: [kimi-code]
  reason: >
    kimi has no Claude `decision:block` / Codex `apply_patch`. Direct board writes arrive as
    Write/Edit/MultiEdit (path check) or Bash (write heuristic). The deny envelope is
    hookSpecificOutput.permissionDecision="deny" + permissionDecisionReason, not decision:block.
  compensating_mechanism: >
    kimi-code board-guard-core.js ports the claude-code/cursor lexer (lexShellCommands /
    segmentTouchesRealBoard byte-aligned) with a Bash|Write|Edit|MultiEdit dispatch; the launcher
    maps kind:block -> { hookSpecificOutput: { permissionDecision: "deny", permissionDecisionReason } }.
    PreToolUse deny is authoritative on kimi (probe-confirmed). SSOT: _hosts/kimi-code/ENVELOPE.md.
  tracked_by: design_docs/2026-07-16-kimi-code-adapter-design.md §3
```
