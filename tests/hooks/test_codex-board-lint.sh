#!/usr/bin/env bash
. "$(dirname "$0")/helpers.sh"

LAUNCHER="$REPO_ROOT/plugin/src/hooks/_hosts/codex/launcher.js"
CORE="$REPO_ROOT/plugin/src/hooks/board-lint/implementations/codex/board-lint-core.js"

seed_board() {
  mkdir -p "$1/boards"
  printf '%s' "$3" >"$1/boards/$2.board.json"
}

run_posttool() {
  HOOK_OUT="$(
    printf '%s' "$1" |
      CC_MASTER_HOME="$2" node "$LAUNCHER" --event PostToolUse --core "$CORE" 2>/dev/null
  )"
  HOOK_RC=$?
}

json_write_payload() {
  printf '{"session_id":"%s","hook_event_name":"PostToolUse","tool_name":"%s","tool_input":{"file_path":"%s"}}' "$1" "$2" "$3"
}

json_patch_payload() {
  printf '{"session_id":"%s","hook_event_name":"PostToolUse","tool_name":"apply_patch","tool_input":{"patch":%s}}' "$1" "$(node -e 'process.stdout.write(JSON.stringify(process.argv[1]))' "$2")"
}

chmod +x "$CORE"
GOOD='{"schema":"cc-master/v2","goal":"g","owner":{"active":true,"session_id":"sess-x"},"git":{"worktree":"","branch":""},"tasks":[{"id":"T0","status":"done","deps":[],"artifact":"commit T0","verified":true,"started_at":"2026-06-23T10:00:00Z","finished_at":"2026-06-23T11:00:00Z"},{"id":"T1","status":"ready","deps":["T0"]}]}'

# Good board: no lint output.
H="$(make_project)"
seed_board "$H" "mine" "$GOOD"
run_posttool "$(json_write_payload "sess-x" "Write" "$H/boards/mine.board.json")" "$H"
assert_eq 0 "$HOOK_RC" "good board -> rc 0"
assert_eq "" "$HOOK_OUT" "good board -> silent"
rm -rf "$H"

# Bad board: additionalContext with ccm lint report, non-blocking.
H="$(make_project)"
seed_board "$H" "bad" '{"schema":"cc-master/v2","goal":"g","owner":{"active":true,"session_id":"sess-x"},"tasks":[{"id":"T1","status":"ready","deps":["NOPE"]}]}'
run_posttool "$(json_write_payload "sess-x" "Write" "$H/boards/bad.board.json")" "$H"
assert_contains "$HOOK_OUT" '"hookEventName":"PostToolUse"' "bad board -> PostToolUse envelope"
assert_contains "$HOOK_OUT" "GRAPH-DANGLING" "bad board -> lint rule"
assert_contains "$HOOK_OUT" '<advisory source=\"board-lint\" strength=\"strong\">' "hard lint -> strong advisory"
assert_not_contains "$HOOK_OUT" '"decision":"block"' "lint never blocks"
rm -rf "$H"

# Single broken active board: tolerant ownership still reports FMT-JSON.
H="$(make_project)"
mkdir -p "$H/boards"
printf '{"schema":"cc-master/v2","owner":{"active":true,"session_id":"sess-x"},"tasks":[{"id":"T0"' >"$H/boards/mine.board.json"
run_posttool "$(json_write_payload "sess-x" "Write" "$H/boards/mine.board.json")" "$H"
assert_contains "$HOOK_OUT" "FMT-JSON" "single broken active board -> FMT-JSON"
rm -rf "$H"

# Foreign active board: silent.
H="$(make_project)"
seed_board "$H" "other" '{"schema":"cc-master/v2","goal":"g","owner":{"active":true,"session_id":"sess-other"},"tasks":[{"id":"T1","status":"ready","deps":["NOPE"]}]}'
run_posttool "$(json_write_payload "sess-mine" "Write" "$H/boards/other.board.json")" "$H"
assert_eq "" "$HOOK_OUT" "foreign board -> silent"
rm -rf "$H"

# apply_patch touching a bad board path: lint fires.
H="$(make_project)"
seed_board "$H" "badpatch" '{"schema":"cc-master/v2","goal":"g","owner":{"active":true,"session_id":"sess-x"},"tasks":[{"id":"T1","status":"ready","deps":["NOPE"]}]}'
PATCH="*** Begin Patch
*** Update File: $H/boards/badpatch.board.json
@@
 noop
*** End Patch"
run_posttool "$(json_patch_payload "sess-x" "$PATCH")" "$H"
assert_contains "$HOOK_OUT" "GRAPH-DANGLING" "apply_patch board path -> lint fires"
rm -rf "$H"

finish
