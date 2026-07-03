#!/usr/bin/env bash
. "$(dirname "$0")/helpers.sh"

LAUNCHER="$REPO_ROOT/plugin/src/hooks/_hosts/codex/launcher.js"
CORE="$REPO_ROOT/plugin/src/hooks/board-guard/implementations/codex/board-guard-core.js"

seed_board() {
  mkdir -p "$1/boards"
  printf '%s' "$3" >"$1/boards/$2.board.json"
}

run_pretool() {
  HOOK_OUT="$(
    printf '%s' "$1" |
      CC_MASTER_HOME="$2" node "$LAUNCHER" --event PreToolUse --core "$CORE" 2>/dev/null
  )"
  HOOK_RC=$?
}

json_write_payload() {
  printf '{"session_id":"%s","hook_event_name":"PreToolUse","tool_name":"%s","tool_input":{"file_path":"%s"}}' "$1" "$2" "$3"
}

json_bash_payload() {
  printf '{"session_id":"%s","hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":%s}}' "$1" "$(node -e 'process.stdout.write(JSON.stringify(process.argv[1]))' "$2")"
}

json_patch_payload() {
  printf '{"session_id":"%s","hook_event_name":"PreToolUse","tool_name":"apply_patch","tool_input":{"patch":%s}}' "$1" "$(node -e 'process.stdout.write(JSON.stringify(process.argv[1]))' "$2")"
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

# Armed Write/Edit/MultiEdit to board path: block.
H="$(make_project)"
seed_board "$H" "mine" "$GOOD"
for TOOL in Write Edit MultiEdit; do
  run_pretool "$(json_write_payload "sess-x" "$TOOL" "$H/boards/mine.board.json")" "$H"
  assert_contains "$HOOK_OUT" '"decision":"block"' "$TOOL board write -> Codex block"
  assert_contains "$HOOK_OUT" "ccm task" "$TOOL board write -> reason names ccm fix"
done
rm -rf "$H"

# Non-board file: allow.
H="$(make_project)"
seed_board "$H" "mine" "$GOOD"
run_pretool "$(json_write_payload "sess-x" "Write" "$H/notes.txt")" "$H"
assert_eq "" "$HOOK_OUT" "non-board write -> allow"
rm -rf "$H"

# Bash ccm is allowed; Bash echo/sed to board is blocked.
H="$(make_project)"
seed_board "$H" "mine" "$GOOD"
run_pretool "$(json_bash_payload "sess-x" "ccm task done T0 --board $H/boards/mine.board.json")" "$H"
assert_eq "" "$HOOK_OUT" "ccm command touching board -> allow"
run_pretool "$(json_bash_payload "sess-x" "echo '{}' > $H/boards/mine.board.json")" "$H"
assert_contains "$HOOK_OUT" '"decision":"block"' "Bash echo board write -> block"
run_pretool "$(json_bash_payload "sess-x" "sed -i s/a/b/ $H/boards/mine.board.json")" "$H"
assert_contains "$HOOK_OUT" '"decision":"block"' "Bash sed board write -> block"
rm -rf "$H"

# apply_patch touching a board path is blocked.
H="$(make_project)"
seed_board "$H" "mine" "$GOOD"
PATCH="*** Begin Patch
*** Update File: $H/boards/mine.board.json
@@
-{}
+{\"tasks\":[]}
*** End Patch"
run_pretool "$(json_patch_payload "sess-x" "$PATCH")" "$H"
assert_contains "$HOOK_OUT" '"decision":"block"' "apply_patch board path -> block"
rm -rf "$H"

# Other session: dormant.
H="$(make_project)"
seed_board "$H" "other" '{"schema":"cc-master/v2","goal":"g","owner":{"active":true,"session_id":"sess-other"},"tasks":[{"id":"T0","status":"ready","deps":[]}]}'
run_pretool "$(json_write_payload "sess-mine" "Write" "$H/boards/other.board.json")" "$H"
assert_eq "" "$HOOK_OUT" "other session board -> dormant"
rm -rf "$H"

finish
