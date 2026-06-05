#!/usr/bin/env bash
. "$(dirname "$0")/helpers.sh"
mkboard() { mkdir -p "$1/.claude/cc-master"; printf '%s' "$3" > "$1/.claude/cc-master/board.json"; [ "$2" = active ] && touch "$1/.claude/cc-master/active" || true; }

# Case A: no marker → silent allow (exit 0, no block)
P="$(make_project)"
run_hook "hooks/scripts/verify-board.sh" '{}' "$P"
assert_eq 0 "$HOOK_RC" "no marker → rc 0"
assert_not_contains "$HOOK_OUT" "block" "no marker → no block"
rm -rf "$P"

# Case B: active but board missing → hard block (bootstrap backstop)
P="$(make_project)"; mkdir -p "$P/.claude/cc-master"; touch "$P/.claude/cc-master/active"
run_hook "hooks/scripts/verify-board.sh" '{}' "$P"
assert_contains "$HOOK_OUT" "block" "missing board → block"
rm -rf "$P"

# Case C: active, board has a ready task → permissive nudge block
P="$(make_project)"
mkboard "$P" active '{"schema":"cc-master/v1","tasks":[{"id":"T1","status":"ready","deps":[]}]}'
run_hook "hooks/scripts/verify-board.sh" '{}' "$P"
assert_contains "$HOOK_OUT" "block" "ready task → nudge block"
assert_contains "$HOOK_OUT" "decision" "nudge emits decision json"
rm -rf "$P"

# Case D: active, all tasks in_flight/blocked → allow (legitimate waiting)
P="$(make_project)"
mkboard "$P" active '{"schema":"cc-master/v1","tasks":[{"id":"T1","status":"in_flight","deps":[]},{"id":"T2","status":"blocked","deps":["T1"]}]}'
run_hook "hooks/scripts/verify-board.sh" '{}' "$P"
assert_eq 0 "$HOOK_RC" "all-waiting → rc 0"
assert_not_contains "$HOOK_OUT" "\"block\"" "all-waiting → no block"
rm -rf "$P"

finish
