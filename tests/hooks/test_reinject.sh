#!/usr/bin/env bash
. "$(dirname "$0")/helpers.sh"

# Case A: no marker → silent no-op
P="$(make_project)"
run_hook "hooks/scripts/reinject.sh" '{"source":"compact"}' "$P"
assert_eq 0 "$HOOK_RC" "no marker → rc 0"
assert_eq "" "$HOOK_OUT" "no marker → no output"
rm -rf "$P"

# Case B: active → re-injects role + goal + board path
P="$(make_project)"; mkdir -p "$P/.claude/cc-master"; touch "$P/.claude/cc-master/active"
printf '{"schema":"cc-master/v1","goal":"MIGRATE THE COGNITION SCHEMA","tasks":[{"id":"T1","status":"ready","deps":[]}]}' > "$P/.claude/cc-master/board.json"
run_hook "hooks/scripts/reinject.sh" '{"source":"compact"}' "$P"
assert_contains "$HOOK_OUT" "MIGRATE THE COGNITION SCHEMA" "re-injects the goal"
assert_contains "$HOOK_OUT" "board.json" "points at the board"
assert_contains "$HOOK_OUT" "orchestrator" "re-anchors the role"
rm -rf "$P"

finish
