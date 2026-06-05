#!/usr/bin/env bash
. "$(dirname "$0")/helpers.sh"

# Case A: prompt contains the command-name sentinel → board + marker created, context injected, rc 0
P="$(make_project)"
run_hook "hooks/scripts/bootstrap-board.sh" '{"prompt":"/cc-master:as-master-orchestrator migrate the thing"}' "$P"
assert_eq 0 "$HOOK_RC" "bootstrap exits 0"
assert_file "$P/.claude/cc-master/board.json" "board created"
assert_file "$P/.claude/cc-master/active" "marker created"
assert_contains "$HOOK_OUT" "board" "injects context mentioning board"
rm -rf "$P"

# Case B: prompt contains the body sentinel (expanded-body case) → also fires
P="$(make_project)"
run_hook "hooks/scripts/bootstrap-board.sh" '{"prompt":"...\n<!-- cc-master:bootstrap:v1 -->\n..."}' "$P"
assert_file "$P/.claude/cc-master/board.json" "board created via body sentinel"
rm -rf "$P"

# Case C: unrelated prompt → no board, no marker, rc 0 (silent no-op)
P="$(make_project)"
run_hook "hooks/scripts/bootstrap-board.sh" '{"prompt":"what files changed today?"}' "$P"
assert_eq 0 "$HOOK_RC" "no-op exits 0"
assert_no_file "$P/.claude/cc-master/board.json" "no board for unrelated prompt"
rm -rf "$P"

# Case D: already-active board is NOT clobbered (idempotent)
P="$(make_project)"; mkdir -p "$P/.claude/cc-master"
printf '{"schema":"cc-master/v1","goal":"EXISTING","owner":{"active":true},"tasks":[{"id":"T0","status":"ready","deps":[]}]}' > "$P/.claude/cc-master/board.json"
touch "$P/.claude/cc-master/active"
run_hook "hooks/scripts/bootstrap-board.sh" '{"prompt":"/cc-master:as-master-orchestrator again"}' "$P"
assert_contains "$(cat "$P/.claude/cc-master/board.json")" "EXISTING" "existing board preserved"
rm -rf "$P"

finish
