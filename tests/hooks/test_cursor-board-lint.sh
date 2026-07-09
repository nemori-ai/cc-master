#!/usr/bin/env bash
. "$(dirname "$0")/helpers.sh"

LAUNCHER="$REPO_ROOT/plugin/src/hooks/_hosts/cursor/launcher.js"
CORE="$REPO_ROOT/plugin/src/hooks/board-lint/implementations/cursor/board-lint-core.js"

seed_board() {
  mkdir -p "$1/boards"
  printf '%s' "$3" >"$1/boards/$2.board.json"
}

run_posttool() {
  HOOK_OUT="$(
    printf '%s' "$1" |
      CC_MASTER_HOME="$2" node "$LAUNCHER" --event postToolUse --core "$CORE" 2>/dev/null
  )"
  HOOK_RC=$?
}

json_write_payload() {
  printf '{"conversation_id":"%s","session_id":"%s","hook_event_name":"postToolUse","tool_name":"Write","tool_input":{"file_path":"%s"}}' "$1" "$1" "$2"
}

chmod +x "$CORE"
GOOD='{"schema":"cc-master/v2","goal":"g","owner":{"active":true,"session_id":"sess-x"},"git":{"worktree":"","branch":""},"tasks":[{"id":"T0","status":"done","deps":[],"artifact":"commit T0","verified":true,"started_at":"2026-06-23T10:00:00Z","finished_at":"2026-06-23T11:00:00Z"},{"id":"T1","status":"ready","deps":["T0"]}]}'

# Good board: no lint output.
H="$(make_project)"
seed_board "$H" "mine" "$GOOD"
run_posttool "$(json_write_payload "sess-x" "$H/boards/mine.board.json")" "$H"
assert_eq 0 "$HOOK_RC" "good board -> rc 0"
assert_eq "" "$HOOK_OUT" "good board -> silent"
rm -rf "$H"

# Bad board: additional_context with ccm lint report, non-blocking.
H="$(make_project)"
seed_board "$H" "bad" '{"schema":"cc-master/v2","goal":"g","owner":{"active":true,"session_id":"sess-x"},"tasks":[{"id":"T1","status":"ready","deps":["NOPE"]}]}'
run_posttool "$(json_write_payload "sess-x" "$H/boards/bad.board.json")" "$H"
assert_contains "$HOOK_OUT" '"additional_context"' "bad board -> additional_context envelope"
assert_contains "$HOOK_OUT" "GRAPH-DANGLING" "bad board -> lint rule"
assert_contains "$HOOK_OUT" '<advisory source=\"board-lint\" strength=\"strong\">' "hard lint -> strong advisory"
assert_not_contains "$HOOK_OUT" '"permission":"deny"' "lint never denies"
rm -rf "$H"

# Foreign active board: silent.
H="$(make_project)"
seed_board "$H" "other" '{"schema":"cc-master/v2","goal":"g","owner":{"active":true,"session_id":"sess-other"},"tasks":[{"id":"T1","status":"ready","deps":["NOPE"]}]}'
run_posttool "$(json_write_payload "sess-mine" "$H/boards/other.board.json")" "$H"
assert_eq "" "$HOOK_OUT" "foreign board -> silent"
rm -rf "$H"

finish
