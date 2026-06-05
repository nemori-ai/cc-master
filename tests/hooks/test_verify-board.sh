#!/usr/bin/env bash
. "$(dirname "$0")/helpers.sh"

# mkactive HOME NAME JSON — drop a board file into the home
mkactive() { mkdir -p "$1"; printf '%s' "$3" > "$1/$2.board.json"; }
# run_stop HOME — run the Stop hook against a home dir; sets HOOK_OUT / HOOK_RC
run_stop() {
  HOOK_OUT="$(CLAUDE_PROJECT_DIR="/nonexistent-proj" CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" CC_MASTER_HOME="$1" \
             bash "$PLUGIN_ROOT/hooks/scripts/verify-board.sh" </dev/null 2>/dev/null)"; HOOK_RC=$?
}

# Case A: no active board (empty home) → allow, no block
H="$(make_project)"
run_stop "$H"
assert_eq 0 "$HOOK_RC" "empty home → rc 0"
assert_not_contains "$HOOK_OUT" "block" "empty home → no block"
rm -rf "$H"

# Case B: an active board with 0 tasks → hard block (bootstrap backstop)
H="$(make_project)"
mkactive "$H" "20260101T000000Z-1" '{"schema":"cc-master/v1","goal":"g","owner":{"active":true},"tasks":[]}'
run_stop "$H"
assert_contains "$HOOK_OUT" "block" "empty active board → block"
rm -rf "$H"

# Case C: an active board WITH a ready task → ALLOW (ready-stop is soft, not a hook block)
H="$(make_project)"
mkactive "$H" "b1" '{"schema":"cc-master/v1","owner":{"active":true},"tasks":[{"id":"T1","status":"ready","deps":[]}]}'
run_stop "$H"
assert_eq 0 "$HOOK_RC" "ready task → rc 0"
assert_not_contains "$HOOK_OUT" "\"block\"" "ready task → no block"
rm -rf "$H"

# Case D: active board with in_flight tasks → allow (legitimate waiting)
H="$(make_project)"
mkactive "$H" "b1" '{"schema":"cc-master/v1","owner":{"active":true},"tasks":[{"id":"T1","status":"in_flight","deps":[]}]}'
run_stop "$H"
assert_not_contains "$HOOK_OUT" "block" "all-waiting → no block"
rm -rf "$H"

# Case E: an ARCHIVED board (owner.active:false) with 0 tasks → ignored → allow
H="$(make_project)"
mkactive "$H" "b1" '{"schema":"cc-master/v1","owner":{"active":false},"tasks":[]}'
run_stop "$H"
assert_eq 0 "$HOOK_RC" "archived empty board → rc 0"
assert_not_contains "$HOOK_OUT" "block" "archived board ignored → no block"
rm -rf "$H"

# Case F: two active boards — one filled, one empty → still blocks (any empty active blocks)
H="$(make_project)"
mkactive "$H" "filled" '{"schema":"cc-master/v1","owner":{"active":true},"tasks":[{"id":"T1","status":"in_flight","deps":[]}]}'
mkactive "$H" "empty"  '{"schema":"cc-master/v1","owner":{"active":true},"tasks":[]}'
run_stop "$H"
assert_contains "$HOOK_OUT" "block" "an empty active board among others → block"
rm -rf "$H"

finish
