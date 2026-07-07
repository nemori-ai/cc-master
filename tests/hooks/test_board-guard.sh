#!/usr/bin/env bash
# Tests for board-guard.js (ADR-025 — node PreToolUse hook). The hook fires BEFORE Write/Edit/MultiEdit/Bash
# and DENIES a direct file-edit of THIS session's board (a *.board.json under <home>/boards/), forcing all
# board mutations through the ccm CLI (the sole write gate). It is dormant-until-armed (红线6): an UNARMED
# session (no active board) passes everything silently — a normal non-orchestration session must be free to
# Write/Edit anything. On deny it emits a PreToolUse permissionDecision:"deny" envelope carrying a
# <directive source="board-guard"> reason (why + which ccm verb to use). Any exception → fail-open (silent
# pass-through, exit 0): a crashing guard must never wedge the agent.
#
# We invoke the .js by path so its `#!/usr/bin/env node` shebang runs node; helpers.sh::run_hook is
# bash-only. We thread stdin (tool_name / tool_input.{file_path,command} / session_id) + CC_MASTER_HOME.
. "$(dirname "$0")/helpers.sh"

HOOK="$PLUGIN_ROOT/hooks/scripts/board-guard.js"

# run_guard TOOL FILE_PATH SID HOME -> sets HOOK_OUT / HOOK_RC. Drives a PreToolUse Write/Edit stdin.
run_guard() {
  HOOK_OUT="$(printf '{"session_id":"%s","hook_event_name":"PreToolUse","tool_name":"%s","tool_input":{"file_path":"%s"}}' "$3" "$1" "$2" \
    | CC_MASTER_HOME="$4" "$HOOK" 2>/dev/null)"; HOOK_RC=$?
}
# run_guard_bash SID HOME COMMAND -> drive a PreToolUse Bash stdin (tool_input.command).
run_guard_bash() {
  HOOK_OUT="$(printf '{"session_id":"%s","hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"%s"}}' "$1" "$3" \
    | CC_MASTER_HOME="$2" "$HOOK" 2>/dev/null)"; HOOK_RC=$?
}

# seed_board HOME NAME ACTIVE SID CONTENT — write a board file CONTENT into <HOME>/boards/NAME.board.json.
seed_board() { mkdir -p "$1/boards"; printf '%s' "$5" > "$1/boards/$2.board.json"; }

# A well-formed armed board owned by sess-x.
GOOD='{"schema":"cc-master/v2","meta":{"template_version":1},"goal":"g","owner":{"active":true,"session_id":"sess-x"},"git":{"worktree":"/w","branch":"b"},"tasks":[{"id":"T0","status":"ready","deps":[]}]}'

# ── (a) UNARMED — empty home (no board) → Write to a board-looking path is ALLOWED (silent pass-through) ──
H="$(make_project)"; mkdir -p "$H/boards"
run_guard "Write" "$H/boards/ghost.board.json" "sess-x" "$H"
assert_eq 0 "$HOOK_RC" "(a) unarmed → rc 0"
assert_eq "" "$HOOK_OUT" "(a) unarmed (no active board) → silent pass-through (dormant-until-armed, 红线6)"
rm -rf "$H"

# ── (b) ARMED + Write to MY active board path → DENY (permissionDecision deny + directive) ────────────
H="$(make_project)"; seed_board "$H" "mine" true "sess-x" "$GOOD"
run_guard "Write" "$H/boards/mine.board.json" "sess-x" "$H"
assert_eq 0 "$HOOK_RC" "(b) armed + Write board → rc 0 (deny is via payload, not exit code)"
assert_contains "$HOOK_OUT" '"permissionDecision":"deny"' "(b) Write of board path → permissionDecision deny"
assert_contains "$HOOK_OUT" '"hookEventName":"PreToolUse"' "(b) hookEventName is PreToolUse"
assert_contains "$HOOK_OUT" '<directive source=\"board-guard\">' "(b) deny reason carries board-guard directive (ADR-018)"
assert_contains "$HOOK_OUT" 'ccm task' "(b) directive names the ccm verb fix"
assert_valid_json "$HOOK_OUT" "(b) deny envelope is valid JSON"
rm -rf "$H"

# ── (b2) ARMED + Edit / MultiEdit board path → also DENY (structured file_path) ───────────────────────
H="$(make_project)"; seed_board "$H" "mine" true "sess-x" "$GOOD"
run_guard "Edit" "$H/boards/mine.board.json" "sess-x" "$H"
assert_contains "$HOOK_OUT" '"permissionDecision":"deny"' "(b2) Edit of board path → deny"
run_guard "MultiEdit" "$H/boards/mine.board.json" "sess-x" "$H"
assert_contains "$HOOK_OUT" '"permissionDecision":"deny"' "(b2) MultiEdit of board path → deny"
rm -rf "$H"

# ── (c) ARMED + Write to a NON-board file → ALLOWED (guard only gates board files) ────────────────────
H="$(make_project)"; seed_board "$H" "mine" true "sess-x" "$GOOD"
run_guard "Write" "$H/notes.txt" "sess-x" "$H"
assert_eq 0 "$HOOK_RC" "(c) non-board file → rc 0"
assert_eq "" "$HOOK_OUT" "(c) Write of non-board file → silent pass-through"
# A *.board.json OUTSIDE home/boards is also out of scope → allowed.
OUT="$(make_project)"
run_guard "Write" "$OUT/stray.board.json" "sess-x" "$H"
assert_eq "" "$HOOK_OUT" "(c) board-looking file outside home/boards → allowed (path-scoped)"
rm -rf "$H" "$OUT"

# ── (d) ARMED + Bash `ccm task …` touching a board path → ALLOWED (ccm is the legit write path) ───────
H="$(make_project)"; seed_board "$H" "mine" true "sess-x" "$GOOD"
run_guard_bash "sess-x" "$H" "ccm task done T0 --board $H/boards/mine.board.json"
assert_eq 0 "$HOOK_RC" "(d) Bash ccm → rc 0"
assert_eq "" "$HOOK_OUT" "(d) Bash ccm invocation → allowed (never gate ccm itself)"
run_guard_bash "sess-x" "$H" "CC_MASTER_HOME=$H ccm task done T0 --board $H/boards/mine.board.json"
assert_eq "" "$HOOK_OUT" "(d) Bash env-prefixed ccm invocation → allowed"
rm -rf "$H"

# ── (e) ARMED + Bash `echo … > board.json` → DENY (write operator + board path, no ccm) ───────────────
H="$(make_project)"; seed_board "$H" "mine" true "sess-x" "$GOOD"
run_guard_bash "sess-x" "$H" "echo '{}' > $H/boards/mine.board.json"
assert_eq 0 "$HOOK_RC" "(e) Bash echo> board → rc 0"
assert_contains "$HOOK_OUT" '"permissionDecision":"deny"' "(e) Bash echo> board.json → deny (heuristic: write-op + .board.json + no ccm)"
assert_valid_json "$HOOK_OUT" "(e) Bash deny envelope is valid JSON"
# sed -i on a board path → also deny.
run_guard_bash "sess-x" "$H" "sed -i s/a/b/ $H/boards/mine.board.json"
assert_contains "$HOOK_OUT" '"permissionDecision":"deny"' "(e) Bash sed -i board.json → deny"
rm -rf "$H"

# ── (e1) ARMED + Bash ccm appears only as data/comment → DENY (not a real ccm command segment) ───────
H="$(make_project)"; seed_board "$H" "mine" true "sess-x" "$GOOD"
run_guard_bash "sess-x" "$H" "echo ccm > $H/boards/mine.board.json"
assert_contains "$HOOK_OUT" '"permissionDecision":"deny"' "(e1) Bash echo ccm > board.json → deny (ccm as data is not a ccm invocation)"
run_guard_bash "sess-x" "$H" "echo '{}' > $H/boards/mine.board.json # ccm"
assert_contains "$HOOK_OUT" '"permissionDecision":"deny"' "(e1) Bash comment mentions ccm after board write → deny"
run_guard_bash "sess-x" "$H" "ccm board lint --board $H/boards/mine.board.json; echo '{}' > $H/boards/mine.board.json"
assert_contains "$HOOK_OUT" '"permissionDecision":"deny"' "(e1) earlier ccm segment does not excuse later direct board write"
rm -rf "$H"

# ── (e2) ARMED + Bash read-only command mentioning a board path → ALLOWED (no write operator) ─────────
H="$(make_project)"; seed_board "$H" "mine" true "sess-x" "$GOOD"
run_guard_bash "sess-x" "$H" "cat $H/boards/mine.board.json"
assert_eq "" "$HOOK_OUT" "(e2) Bash cat (read-only) of board path → allowed (no write operator)"
rm -rf "$H"

# ── (f) UNARMED + Bash echo> board → ALLOWED (dormant-until-armed applies to Bash path too) ───────────
H="$(make_project)"; mkdir -p "$H/boards"
run_guard_bash "sess-x" "$H" "echo '{}' > $H/boards/ghost.board.json"
assert_eq "" "$HOOK_OUT" "(f) unarmed Bash echo> board → silent pass-through (红线6)"
rm -rf "$H"

# ── (g) ARMED but board owned by ANOTHER session → this session is NOT armed → allowed ────────────────
H="$(make_project)"; seed_board "$H" "other" true "sess-other" "$GOOD"
run_guard "Write" "$H/boards/other.board.json" "sess-mine" "$H"
assert_eq "" "$HOOK_OUT" "(g) not-my-session (unarmed for me) → silent pass-through"
rm -rf "$H"

# ── (h) ARMED + board path and write-op in DIFFERENT, unrelated segments → ALLOWED (issue #57 A/G repro) ──
# The bug fixed here (2026-07-07-issue57 问题1, 方案1): a stale whole-string fallback used to deny any
# command that merely *mentioned* a board path AND a write operator anywhere in the string, even when
# they were unrelated command segments touching different files. Per-segment matching is the sole
# authority now — a write op in one segment and a board path in an unrelated segment must ALLOW.
H="$(make_project)"; seed_board "$H" "mine" true "sess-x" "$GOOD"
# (A-type) write op targets an unrelated tmp file in segment 1; board path only READ in segment 2.
run_guard_bash "sess-x" "$H" "echo start > /tmp/log.txt; cat $H/boards/mine.board.json"
assert_eq 0 "$HOOK_RC" "(h) A-type cross-segment mismatch → rc 0"
assert_eq "" "$HOOK_OUT" "(h) A-type: write-op segment and board-path segment are unrelated → allowed"
# (G-type) write op targets an unrelated tmp file in segment 1; board path only referenced (env assignment)
# in segment 3, which itself is a legitimate ccm invocation with no write operator.
run_guard_bash "sess-x" "$H" "echo hi > /tmp/x.txt && export B=$H/boards/mine.board.json && ccm board update --help"
assert_eq "" "$HOOK_OUT" "(h) G-type: write-op segment and board-path segment are unrelated → allowed"
rm -rf "$H"

# ── (i) ARMED + Bash write-op targets a board-LOOKING path OUTSIDE BOARDS_DIR → ALLOWED (issue #57 问题1 方案2) ──
# The Bash branch used to judge any `*.board.json`-looking string as a real board regardless of location
# (unlike the Write/Edit branch's pathIsBoard(), which requires BOARDS_DIR scoping — see (c)). A scratch
# fixture / doc example / /tmp test board must not be treated as a real board just because it shares the
# `.board.json` suffix and sits in a write-op segment.
H="$(make_project)"; seed_board "$H" "mine" true "sess-x" "$GOOD"
run_guard_bash "sess-x" "$H" "echo '{}' > /tmp/scratch/test.board.json"
assert_eq 0 "$HOOK_RC" "(i) write to board-looking path outside BOARDS_DIR → rc 0"
assert_eq "" "$HOOK_OUT" "(i) write op + .board.json path OUTSIDE BOARDS_DIR → allowed (path-scoped, like (c))"
# tee to the same kind of out-of-scope path → also allowed.
run_guard_bash "sess-x" "$H" "echo '{}' | tee /tmp/scratch/test.board.json"
assert_eq "" "$HOOK_OUT" "(i) tee to board-looking path outside BOARDS_DIR → allowed"
rm -rf "$H"

# ── (i2) ARMED + Bash write-op targets a board-looking path INSIDE BOARDS_DIR → still DENY (regression) ──
H="$(make_project)"; seed_board "$H" "mine" true "sess-x" "$GOOD"
run_guard_bash "sess-x" "$H" "cp /tmp/scratch/test.board.json $H/boards/mine.board.json"
assert_contains "$HOOK_OUT" '"permissionDecision":"deny"' "(i2) cp targeting a real board path (inside BOARDS_DIR) → deny"
rm -rf "$H"

# ── (i3) ARMED + Bash write-op + unresolved variable reference to the real board → still DENY (conservative) ──
# The path token is `\$B/mine.board.json` — a literal, unexpanded shell variable reference embedded in the
# command string (the hook never sees what `$B` actually resolves to). Since the token is not a resolvable
# literal path, the guard cannot confirm it is OUT of scope either — best-effort conservatively treats it
# as a real board and denies rather than guessing it is safe.
H="$(make_project)"; seed_board "$H" "mine" true "sess-x" "$GOOD"
run_guard_bash "sess-x" "$H" 'echo hi > /tmp/x.txt && echo {} > $B/mine.board.json'
assert_contains "$HOOK_OUT" '"permissionDecision":"deny"' "(i3) unresolved \$VAR reference to a board path + write-op → deny (conservative, cannot confirm out-of-scope)"
rm -rf "$H"

finish
