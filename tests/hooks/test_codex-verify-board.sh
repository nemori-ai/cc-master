#!/usr/bin/env bash
. "$(dirname "$0")/helpers.sh"

LAUNCHER="$REPO_ROOT/plugin/src/hooks/_hosts/codex/launcher.js"
CORE="$REPO_ROOT/plugin/src/hooks/verify-board/implementations/codex/verify-board-core.js"

mkactive() {
  mkdir -p "$1/boards"
  printf '%s' "$3" >"$1/boards/$2.board.json"
}

run_stop() {
  HOOK_OUT="$(
    printf '{"session_id":"%s","hook_event_name":"Stop","stop_hook_active":false}' "$2" |
      CC_MASTER_HOME="$1" node "$LAUNCHER" --event Stop --core "$CORE" 2>/dev/null
  )"
  HOOK_RC=$?
}

chmod +x "$CORE"

# Unarmed: no output.
H="$(make_project)"
run_stop "$H" "sess-none"
assert_eq 0 "$HOOK_RC" "no active board -> rc 0"
assert_eq "" "$HOOK_OUT" "no active board -> no output"
rm -rf "$H"

# Other session: dormant.
H="$(make_project)"
mkactive "$H" "other" '{"schema":"cc-master/v2","goal":"OTHER","owner":{"active":true,"session_id":"sess-other"},"tasks":[{"id":"T1","status":"ready","deps":[]}]}'
run_stop "$H" "sess-mine"
assert_eq "" "$HOOK_OUT" "other session active board ignored"
rm -rf "$H"

# Empty active board: non-blocking systemMessage, not decision:block.
H="$(make_project)"
mkactive "$H" "empty" '{"schema":"cc-master/v2","goal":"EMPTY CODEX BOARD","owner":{"active":true,"session_id":"sess-empty"},"tasks":[]}'
run_stop "$H" "sess-empty"
assert_contains "$HOOK_OUT" '"systemMessage"' "empty board emits systemMessage"
assert_contains "$HOOK_OUT" "active board has no tasks" "empty board advisory"
assert_not_contains "$HOOK_OUT" '"decision":"block"' "Codex Stop advisory is non-blocking"
rm -rf "$H"

# Actionable and uncertain work.
H="$(make_project)"
mkactive "$H" "work" '{"schema":"cc-master/v2","goal":"WORK CODEX BOARD","owner":{"active":true,"session_id":"sess-work"},"tasks":[{"id":"T1","status":"ready","deps":[]},{"id":"T2","status":"uncertain","deps":[]}]}'
run_stop "$H" "sess-work"
assert_contains "$HOOK_OUT" "ready tasks remain: T1" "ready task advisory"
assert_contains "$HOOK_OUT" "uncertain tasks need verification: T2" "uncertain task advisory"
rm -rf "$H"

# User-blocked and in-flight without watchdog.
H="$(make_project)"
mkactive "$H" "blocked" '{"schema":"cc-master/v2","goal":"BLOCKED CODEX BOARD","owner":{"active":true,"session_id":"sess-blocked"},"tasks":[{"id":"T3","status":"blocked","blocked_on":"user","title":"approve deploy","deps":[]},{"id":"T4","status":"in_flight","deps":[]}]}'
run_stop "$H" "sess-blocked"
assert_contains "$HOOK_OUT" "user decisions are still open: approve deploy" "user-blocked advisory"
assert_contains "$HOOK_OUT" "in-flight tasks have no armed watchdog: T4" "watchdog advisory"
rm -rf "$H"

# Done-only completion state: final self-check advisory.
H="$(make_project)"
mkactive "$H" "done" '{"schema":"cc-master/v2","goal":"DONE CODEX BOARD","owner":{"active":true,"session_id":"sess-done"},"tasks":[{"id":"T5","status":"done","deps":[]}]}'
run_stop "$H" "sess-done"
assert_contains "$HOOK_OUT" "self-check against the original goal" "completion self-check advisory"
rm -rf "$H"

finish
