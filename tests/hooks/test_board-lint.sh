#!/usr/bin/env bash
# Tests for board-lint.js (T9 — node PostToolUse hook, ADR-006). The hook fires on Write/Edit of THIS
# session's active board, JSON.parses it (zero spawn jq/python — 红线1), runs the lint rule-set, and on
# violations injects a NON-BLOCKING additionalContext report (hookEventName "PostToolUse") that names
# WHICH rule / WHICH task / WHY / HOW-to-fix. It NEVER emits decision:block (PostToolUse can't undo an
# already-written file), is read-only on the board (it only re-reads what was just written), and on any
# failure / unarmed / unrelated-file degrades silently (empty out, rc 0).
#
# Like usage-pacing, the hook is dormant-until-armed (红线6): reuses the SAME board-derived isArmed gate.
# We invoke the .js by path so its `#!/usr/bin/env node` shebang runs node; helpers.sh::run_hook is
# bash-only so it can't drive it. We thread stdin (tool_name / tool_input.file_path / session_id) +
# CC_MASTER_HOME directly.
. "$(dirname "$0")/helpers.sh"

HOOK="$PLUGIN_ROOT/hooks/scripts/board-lint.js"

# run_lint TOOL FILE_PATH SID HOME -> sets HOOK_OUT / HOOK_RC. Drives a PostToolUse stdin envelope.
run_lint() {
  HOOK_OUT="$(printf '{"session_id":"%s","hook_event_name":"PostToolUse","tool_name":"%s","tool_input":{"file_path":"%s"}}' "$3" "$1" "$2" \
    | CC_MASTER_HOME="$4" "$HOOK" 2>/dev/null)"; HOOK_RC=$?
}
# run_lint_bash SID HOME COMMAND -> drive a Bash tool_input (no structured file_path) to prove the hook
# stays silent on Bash edits (the coverage gap the manual script fills).
run_lint_bash() {
  HOOK_OUT="$(printf '{"session_id":"%s","hook_event_name":"PostToolUse","tool_name":"Bash","tool_input":{"command":"%s"}}' "$1" "$3" \
    | CC_MASTER_HOME="$2" "$HOOK" 2>/dev/null)"; HOOK_RC=$?
}

# seed_board HOME NAME ACTIVE SID CONTENT — write a board file CONTENT into <HOME>/boards/NAME.board.json.
seed_board() { mkdir -p "$1/boards"; printf '%s' "$5" > "$1/boards/$2.board.json"; }

# A well-formed armed board owned by sess-x (used as both the arming board and the lint target).
GOOD='{"schema":"cc-master/v2","meta":{"template_version":1},"goal":"g","owner":{"active":true,"session_id":"sess-x"},"git":{"worktree":"/w","branch":"b"},"tasks":[{"id":"T0","status":"done","deps":[],"started_at":"2026-06-23T10:00:00Z","finished_at":"2026-06-23T11:00:00Z"},{"id":"T1","status":"ready","deps":["T0"]}]}'

# ── (a) ARMED + good board edited via Write → lint passes → SILENT (no spam, rc 0) ───────────────────
H="$(make_project)"; seed_board "$H" "mine" true "sess-x" "$GOOD"
run_lint "Write" "$H/boards/mine.board.json" "sess-x" "$H"
assert_eq 0 "$HOOK_RC" "(a) armed + good board → rc 0"
assert_eq "" "$HOOK_OUT" "(a) good board → silent (lint passes, no spam)"
rm -rf "$H"

# ── (b) UNARMED — empty home (no board) → silent even though file_path looks like a board ────────────
H="$(make_project)"
run_lint "Write" "$H/boards/ghost.board.json" "sess-x" "$H"
assert_eq 0 "$HOOK_RC" "(b) unarmed empty home → rc 0"
assert_eq "" "$HOOK_OUT" "(b) unarmed (no active board) → silent (dormant-until-armed, 红线6)"
rm -rf "$H"

# ── (c) UNARMED — board owned by ANOTHER session → not mine → silent ─────────────────────────────────
H="$(make_project)"
seed_board "$H" "other" true "sess-other" '{"schema":"cc-master/v2","goal":"g","owner":{"active":true,"session_id":"sess-other"},"tasks":[{"id":"T0","status":"ready","deps":["NOPE"]}]}'
run_lint "Write" "$H/boards/other.board.json" "sess-mine" "$H"
assert_eq 0 "$HOOK_RC" "(c) other session's board → rc 0"
assert_eq "" "$HOOK_OUT" "(c) other session's active board (even with a dangling dep) → silent (not armed for me)"
rm -rf "$H"

# ── (d) ARMED but edited file is NOT a *.board.json → silent (only the truth source is in scope) ─────
H="$(make_project)"; seed_board "$H" "mine" true "sess-x" "$GOOD"
run_lint "Write" "$H/boards/notes.txt" "sess-x" "$H"
assert_eq 0 "$HOOK_RC" "(d) non-board file → rc 0"
assert_eq "" "$HOOK_OUT" "(d) edited file is not *.board.json → silent"
rm -rf "$H"

# ── (e) ARMED but edited file is OUTSIDE home → silent (path-scoped to home) ─────────────────────────
H="$(make_project)"; seed_board "$H" "mine" true "sess-x" "$GOOD"
OUT="$(make_project)"; printf '%s' "$GOOD" > "$OUT/stray.board.json"
run_lint "Write" "$OUT/stray.board.json" "sess-x" "$H"
assert_eq 0 "$HOOK_RC" "(e) board outside home → rc 0"
assert_eq "" "$HOOK_OUT" "(e) edited board lives outside home → silent (path-scoped)"
rm -rf "$H" "$OUT"

# ── (f) Bash tool (sed/echo > board) → no structured file_path → hook stays silent (manual-script gap)
H="$(make_project)"; seed_board "$H" "mine" true "sess-x" "$GOOD"
run_lint_bash "sess-x" "$H" "sed -i s/x/y/ board.json"
assert_eq 0 "$HOOK_RC" "(f) Bash edit → rc 0"
assert_eq "" "$HOOK_OUT" "(f) Bash tool has no structured file_path → hook silent (coverage gap → manual script)"
rm -rf "$H"

# ── (g) Read tool → silent (only Write/Edit edits matter) ────────────────────────────────────────────
H="$(make_project)"; seed_board "$H" "mine" true "sess-x" "$GOOD"
run_lint "Read" "$H/boards/mine.board.json" "sess-x" "$H"
assert_eq 0 "$HOOK_RC" "(g) Read tool → rc 0"
assert_eq "" "$HOOK_OUT" "(g) Read is not an edit → silent"
rm -rf "$H"

# ── (h) HARD FAIL: invalid JSON (FMT-JSON) → injects a non-blocking PostToolUse report naming FMT-JSON ───────────
# The board is BOTH the arming board (its owner is parseable from a tolerant read? no — broken JSON
# can't arm). So we keep a SEPARATE good arming board + a broken TARGET board both owned by sess-x.
H="$(make_project)"
seed_board "$H" "armed" true "sess-x" "$GOOD"
printf '{"schema":"cc-master/v2","owner":{"active":true,"session_id":"sess-x"},"tasks":[{"id":"T0"' > "$H/boards/broken.board.json"
run_lint "Write" "$H/boards/broken.board.json" "sess-x" "$H"
assert_eq 0 "$HOOK_RC" "(h) invalid JSON → rc 0 (never blocks)"
assert_contains "$HOOK_OUT" "additionalContext" "(h) invalid JSON → injects additionalContext"
assert_contains "$HOOK_OUT" '"hookEventName":"PostToolUse"' "(h) hookEventName is PostToolUse"
assert_contains "$HOOK_OUT" "FMT-JSON" "(h) names the violated rule (FMT-JSON invalid JSON)"
assert_contains "$HOOK_OUT" "board lint" "(h) carries the cc-master board lint prefix"
assert_not_contains "$HOOK_OUT" '"decision":"block"' "(h) NEVER blocks — non-blocking only"
assert_valid_json "$HOOK_OUT" "(h) the injected envelope itself is valid JSON (multi-line report escaped)"
# ADR-018：含 hard error（FMT-JSON·结构破）→ advisory strong（应认真去修·P4 高 stakes）。注入经 jsonEscape，标签 " → \"。
assert_contains "$HOOK_OUT" '<advisory source=\"board-lint\" strength=\"strong\">' "(h) hard error → tag-wrapped advisory strong (ADR-018)"
rm -rf "$H"

# ── (h2) HARD FAIL, SINGLE-ACTIVE-BOARD: the SOLE active board (this session's) is written to invalid
# JSON. The home has NO separate good arming board to save the day — the broken board IS the only thing
# in home. The hook MUST still arm off this session's own board (by name match / sole *.board.json) and
# run lint, reporting FMT-JSON. This is the codex-caught bug: isArmed used to JSON.parse-and-continue on the
# broken board, find no OTHER parseable active board, and return false → lint never ran on exactly the
# worst kind of bad write. (Regression guard: red without the 闸3/闸4 decoupling fix.)
H="$(make_project)"; mkdir -p "$H/boards"
printf '{"schema":"cc-master/v2","owner":{"active":true,"session_id":"sess-x"},"tasks":[{"id":"T0"' > "$H/boards/mine.board.json"
run_lint "Write" "$H/boards/mine.board.json" "sess-x" "$H"
assert_eq 0 "$HOOK_RC" "(h2) single broken active board → rc 0 (never blocks)"
assert_contains "$HOOK_OUT" "additionalContext" "(h2) single broken active board → injects additionalContext"
assert_contains "$HOOK_OUT" '"hookEventName":"PostToolUse"' "(h2) hookEventName is PostToolUse"
assert_contains "$HOOK_OUT" "FMT-JSON" "(h2) names FMT-JSON even when the broken board is the SOLE active board (codex bug)"
assert_contains "$HOOK_OUT" "board lint" "(h2) carries the cc-master board lint prefix"
assert_not_contains "$HOOK_OUT" '"decision":"block"' "(h2) NEVER blocks"
assert_valid_json "$HOOK_OUT" "(h2) injected envelope is valid JSON"
rm -rf "$H"

# ── (h3) RED-LINE-6 GUARD: a session that NEVER ran the orchestrator (no board of its own in home) edits
# a *.board.json that happens to be present but is owned by ANOTHER session and is broken JSON → the fix
# for (h2) must NOT make this leak. Home has one broken board owned by sess-other; this session is sid
# sess-mine. Since the broken target can't reveal its owner, and no board in home is mine, stay SILENT.
H="$(make_project)"; mkdir -p "$H/boards"
printf '{"schema":"cc-master/v2","owner":{"active":true,"session_id":"sess-other"},"tasks":[{"id":"T0"' > "$H/boards/theirs.board.json"
run_lint "Write" "$H/boards/theirs.board.json" "sess-mine" "$H"
assert_eq 0 "$HOOK_RC" "(h3) unarmed session editing a broken foreign board → rc 0"
assert_eq "" "$HOOK_OUT" "(h3) never-armed session must stay silent even on a broken board (红线6)"
rm -rf "$H"

# ── (i) HARD FAIL: dangling dep (GRAPH-DANGLING) + bad status (FMT-STATUS) → report names BOTH + the offending task ────
H="$(make_project)"
seed_board "$H" "armed" true "sess-x" "$GOOD"
seed_board "$H" "bad" true "sess-x" '{"schema":"cc-master/v2","goal":"g","owner":{"active":true,"session_id":"sess-x"},"git":{"worktree":"","branch":""},"tasks":[{"id":"T0","status":"done","deps":[]},{"id":"T3","status":"in_flght","deps":[]},{"id":"T7","status":"ready","deps":["T5"]}]}'
run_lint "Edit" "$H/boards/bad.board.json" "sess-x" "$H"
assert_eq 0 "$HOOK_RC" "(i) dangling+badstatus → rc 0"
assert_contains "$HOOK_OUT" "GRAPH-DANGLING" "(i) names dangling-dep rule (GRAPH-DANGLING)"
assert_contains "$HOOK_OUT" "FMT-STATUS" "(i) names bad-status rule (FMT-STATUS)"
assert_contains "$HOOK_OUT" "T5" "(i) names the missing upstream id (T5)"
assert_contains "$HOOK_OUT" "in_flght" "(i) echoes the bad status value (in_flght) so agent can find it"
assert_not_contains "$HOOK_OUT" '"decision":"block"' "(i) still never blocks"
assert_valid_json "$HOOK_OUT" "(i) envelope is valid JSON"
rm -rf "$H"

# ── (j) HARD FAIL: cycle (GRAPH-CYCLE) → report names the cycle rule ─────────────────────────────────────────
H="$(make_project)"
seed_board "$H" "armed" true "sess-x" "$GOOD"
seed_board "$H" "cyc" true "sess-x" '{"schema":"cc-master/v2","goal":"g","owner":{"active":true,"session_id":"sess-x"},"git":{"worktree":"","branch":""},"tasks":[{"id":"A","status":"ready","deps":["B"]},{"id":"B","status":"ready","deps":["A"]}]}'
run_lint "Write" "$H/boards/cyc.board.json" "sess-x" "$H"
assert_contains "$HOOK_OUT" "GRAPH-CYCLE" "(j) names the cycle rule (GRAPH-CYCLE)"
assert_not_contains "$HOOK_OUT" '"decision":"block"' "(j) never blocks"
rm -rf "$H"

# ── (k) HARD FAIL: tasks not an array (FMT-TASKS) ──────────────────────────────────────────────────────────
H="$(make_project)"
seed_board "$H" "armed" true "sess-x" "$GOOD"
seed_board "$H" "notarr" true "sess-x" '{"schema":"cc-master/v2","goal":"g","owner":{"active":true,"session_id":"sess-x"},"git":{"worktree":"","branch":""},"tasks":{"oops":1}}'
run_lint "Write" "$H/boards/notarr.board.json" "sess-x" "$H"
assert_contains "$HOOK_OUT" "FMT-TASKS" "(k) names tasks-not-array rule (FMT-TASKS)"
rm -rf "$H"

# ── (k2) HARD FAIL: a task MISSING deps (FMT-DEPS) — deps is a required narrow-waist field, not a flexible
# edge (board.md §narrow-waist). An agent hand-edited tasks[] and forgot deps → must be caught, named,
# and told to add "deps": []. (codex P2-A: it used to silently default to [] and PASS.)
H="$(make_project)"
seed_board "$H" "armed" true "sess-x" "$GOOD"
seed_board "$H" "nodeps" true "sess-x" '{"schema":"cc-master/v2","goal":"g","owner":{"active":true,"session_id":"sess-x"},"git":{"worktree":"","branch":""},"tasks":[{"id":"T0","status":"done","deps":[]},{"id":"T1","status":"ready"}]}'
run_lint "Write" "$H/boards/nodeps.board.json" "sess-x" "$H"
assert_eq 0 "$HOOK_RC" "(k2) missing deps → rc 0 (never blocks)"
assert_contains "$HOOK_OUT" "FMT-DEPS" "(k2) names the missing-deps rule (FMT-DEPS)"
assert_contains "$HOOK_OUT" "T1" "(k2) names the offending task (T1) so agent can locate it"
assert_not_contains "$HOOK_OUT" '"decision":"block"' "(k2) never blocks"
rm -rf "$H"

# ── (l) WARN-ONLY: blocked_on dangling (FMT-BLOCKED-ON) + bad timestamp (FMT-TIME) → PASS, but warns; rc 0; no block ─
H="$(make_project)"
seed_board "$H" "armed" true "sess-x" "$GOOD"
seed_board "$H" "warns" true "sess-x" '{"schema":"cc-master/v2","goal":"g","owner":{"active":true,"session_id":"sess-x"},"git":{"worktree":"","branch":""},"tasks":[{"id":"T1","status":"in_flight","deps":[],"started_at":"12:18Z"},{"id":"T9","status":"blocked","deps":[],"blocked_on":"T8"}]}'
run_lint "Write" "$H/boards/warns.board.json" "sess-x" "$H"
assert_eq 0 "$HOOK_RC" "(l) warn-only → rc 0"
assert_contains "$HOOK_OUT" "FMT-BLOCKED-ON" "(l) warns on dangling blocked_on (FMT-BLOCKED-ON)"
assert_contains "$HOOK_OUT" "FMT-TIME" "(l) warns on bad timestamp format (FMT-TIME)"
assert_not_contains "$HOOK_OUT" '"decision":"block"' "(l) warn never blocks"
# ADR-018：纯 warn（无 hard error）→ advisory weak（顺手权衡·P4 低 stakes）。
assert_contains "$HOOK_OUT" '<advisory source=\"board-lint\" strength=\"weak\">' "(l) warn-only → tag-wrapped advisory weak (ADR-018)"
rm -rf "$H"

# ── (m) RED LINE 2: agent-shaped custom fields are NEVER flagged ──────────────────────────────────────
# A board crammed with arbitrary agent-invented top-level + per-task keys, but a clean waist + deps →
# MUST pass silently. lint whitelists known fields, stays silent on unknown ones (no second waist).
H="$(make_project)"
seed_board "$H" "free" true "sess-x" '{"schema":"cc-master/v2","goal":"g","owner":{"active":true,"session_id":"sess-x"},"git":{"worktree":"","branch":""},"my_custom_top":42,"weird":{"nested":true},"tasks":[{"id":"T0","status":"done","deps":[],"artifact":"x","mechanism":"sub-agent","handle":"bg-1","whatever_i_want":["a","b"],"notes":"free text","started_at":"2026-06-23T10:00:00Z","finished_at":"2026-06-23T11:00:00Z"}]}'
run_lint "Write" "$H/boards/free.board.json" "sess-x" "$H"
assert_eq 0 "$HOOK_RC" "(m) agent-shaped fields → rc 0"
assert_eq "" "$HOOK_OUT" "(m) arbitrary custom fields → silent (红线2: lint never becomes a second waist)"
rm -rf "$H"

# ── (n) RED LINE 2: missing FLEXIBLE edges (wip_limit/title/created_at) are NEVER flagged ────────────
# The GOOD board already omits wip_limit, title, all three timestamps, log, meta on tasks → already
# proven silent in (a). This case explicitly omits EVERYTHING optional and keeps only the hard waist.
H="$(make_project)"
seed_board "$H" "minimal" true "sess-x" '{"schema":"cc-master/v2","goal":"g","owner":{"active":true,"session_id":"sess-x"},"git":{"worktree":"","branch":""},"tasks":[{"id":"X","status":"ready","deps":[]}]}'
run_lint "Write" "$H/boards/minimal.board.json" "sess-x" "$H"
assert_eq 0 "$HOOK_RC" "(n) bare-waist board → rc 0"
assert_eq "" "$HOOK_OUT" "(n) missing all flexible edges → silent (lint never requires optional fields)"
rm -rf "$H"

# ── (o) ARCHIVED target board (owner.active:false) → silent even if broken (闸4: only my ACTIVE board)
H="$(make_project)"
seed_board "$H" "armed" true "sess-x" "$GOOD"
seed_board "$H" "arch" false "sess-x" '{"schema":"cc-master/v2","goal":"g","owner":{"active":false,"session_id":"sess-x"},"tasks":[{"id":"T0","status":"ready","deps":["GHOST"]}]}'
run_lint "Write" "$H/boards/arch.board.json" "sess-x" "$H"
assert_eq 0 "$HOOK_RC" "(o) archived target → rc 0"
assert_eq "" "$HOOK_OUT" "(o) editing an archived board (active:false) → silent (only the live truth source is gated)"
rm -rf "$H"

finish
