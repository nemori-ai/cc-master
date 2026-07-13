#!/usr/bin/env bash
. "$(dirname "$0")/helpers.sh"

LAUNCHER="$REPO_ROOT/plugin/src/hooks/_hosts/cursor/launcher.js"
CORE="$REPO_ROOT/plugin/src/hooks/board-guard/implementations/cursor/board-guard-core.js"

seed_board() {
  mkdir -p "$1/boards"
  printf '%s' "$3" >"$1/boards/$2.board.json"
}

run_pretool() {
  HOOK_OUT="$(
    printf '%s' "$1" |
      CC_MASTER_HOME="$2" node "$LAUNCHER" --event preToolUse --core "$CORE" 2>/dev/null
  )"
  HOOK_RC=$?
}

json_write_payload() {
  printf '{"conversation_id":"%s","session_id":"%s","hook_event_name":"preToolUse","tool_name":"%s","tool_input":{"file_path":"%s"}}' "$1" "$1" "$2" "$3"
}

json_shell_payload() {
  printf '{"conversation_id":"%s","session_id":"%s","hook_event_name":"preToolUse","tool_name":"Shell","tool_input":{"command":%s}}' "$1" "$1" "$(node -e 'process.stdout.write(JSON.stringify(process.argv[1]))' "$2")"
}

chmod +x "$CORE"
GOOD='{"schema":"cc-master/v2","goal":"g","owner":{"active":true,"session_id":"sess-x"},"tasks":[{"id":"T0","status":"ready","deps":[]}]}'

# Unarmed: allow silently.
H="$(make_project)"
mkdir -p "$H/boards"
run_pretool "$(json_write_payload "sess-x" "Write" "$H/boards/ghost.board.json")" "$H"
assert_eq 0 "$HOOK_RC" "unarmed write -> rc 0"
assert_eq "" "$HOOK_OUT" "unarmed write -> silent"
rm -rf "$H"

# Armed Write to board path: deny.
H="$(make_project)"
seed_board "$H" "mine" "$GOOD"
run_pretool "$(json_write_payload "sess-x" "Write" "$H/boards/mine.board.json")" "$H"
assert_contains "$HOOK_OUT" '"permission":"deny"' "Write board -> Cursor deny"
assert_contains "$HOOK_OUT" "ccm task" "Write board -> reason names ccm fix"
rm -rf "$H"

# Non-board file: allow.
H="$(make_project)"
seed_board "$H" "mine" "$GOOD"
run_pretool "$(json_write_payload "sess-x" "Write" "$H/notes.txt")" "$H"
assert_eq "" "$HOOK_OUT" "non-board write -> allow"
rm -rf "$H"

# Plain Shell ccm --board is allowed; ccm with shell redirection and echo/sed writes are blocked.
H="$(make_project)"
seed_board "$H" "mine" "$GOOD"
run_pretool "$(json_shell_payload "sess-x" "ccm task done T0 --board $H/boards/mine.board.json")" "$H"
assert_eq "" "$HOOK_OUT" "ccm command touching board -> allow"
run_pretool "$(json_shell_payload "sess-x" "ccm --help > $H/boards/mine.board.json")" "$H"
assert_contains "$HOOK_OUT" '"permission":"deny"' "Shell ccm > board -> deny"
run_pretool "$(json_shell_payload "sess-x" "ccm board show --board $H/boards/mine.board.json >> $H/boards/mine.board.json")" "$H"
assert_contains "$HOOK_OUT" '"permission":"deny"' "Shell ccm >> board -> deny"
run_pretool "$(json_shell_payload "sess-x" "echo '{}' > $H/boards/mine.board.json")" "$H"
assert_contains "$HOOK_OUT" '"permission":"deny"' "Shell echo board write -> deny"
run_pretool "$(json_shell_payload "sess-x" "sed -i s/a/b/ $H/boards/mine.board.json")" "$H"
assert_contains "$HOOK_OUT" '"permission":"deny"' "Shell sed board write -> deny"
rm -rf "$H"

finish
