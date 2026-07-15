#!/usr/bin/env bash
. "$(dirname "$0")/helpers.sh"

LAUNCHER="$REPO_ROOT/plugin/src/hooks/_hosts/cursor/launcher.js"
CORE="$REPO_ROOT/plugin/src/hooks/verify-board/implementations/cursor/verify-board-core.js"

mkactive() {
  mkdir -p "$1/boards"
  printf '%s' "$3" >"$1/boards/$2.board.json"
}

run_stop() {
  HOOK_OUT="$(
    printf '{"conversation_id":"%s","session_id":"%s","hook_event_name":"stop","loop_count":0}' "$2" "$2" |
      CC_MASTER_HOME="$1" node "$LAUNCHER" --event stop --core "$CORE" 2>/dev/null
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

# Empty active board: followup_message continues Cursor (not hard block).
H="$(make_project)"
mkactive "$H" "empty" '{"schema":"cc-master/v2","goal":"EMPTY CURSOR BOARD","owner":{"active":true,"session_id":"sess-empty"},"tasks":[]}'
run_stop "$H" "sess-empty"
assert_contains "$HOOK_OUT" '"followup_message"' "empty board emits followup_message"
assert_contains "$HOOK_OUT" "active board has no tasks" "empty board advisory"
assert_contains "$HOOK_OUT" "ccm board set-param stop_allow_until" "empty board includes release command"
rm -rf "$H"

# Future stop_allow_until releases the Stop continuation.
H="$(make_project)"
mkactive "$H" "released" '{"schema":"cc-master/v2","goal":"RELEASED CURSOR BOARD","owner":{"active":true,"session_id":"sess-release"},"tasks":[],"runtime":{"stop_allow_until":"2999-01-01T00:00:00Z"}}'
run_stop "$H" "sess-release"
assert_eq "" "$HOOK_OUT" "future stop_allow_until releases Stop continuation"
rm -rf "$H"

# Actionable and uncertain work.
H="$(make_project)"
mkactive "$H" "work" '{"schema":"cc-master/v2","goal":"WORK CURSOR BOARD","owner":{"active":true,"session_id":"sess-work"},"tasks":[{"id":"T1","status":"ready","deps":[]},{"id":"T2","status":"uncertain","deps":[]}]}'
run_stop "$H" "sess-work"
assert_contains "$HOOK_OUT" '"followup_message"' "actionable work emits followup_message"
assert_contains "$HOOK_OUT" "ready tasks remain: T1" "ready task advisory"
assert_contains "$HOOK_OUT" "uncertain tasks need verification: T2" "uncertain task advisory"
rm -rf "$H"

# User-blocked and in-flight without watchdog.
H="$(make_project)"
mkactive "$H" "blocked" '{"schema":"cc-master/v2","goal":"BLOCKED CURSOR BOARD","owner":{"active":true,"session_id":"sess-blocked"},"tasks":[{"id":"T3","status":"blocked","blocked_on":"user","title":"approve deploy","deps":[]},{"id":"T4","status":"in_flight","deps":[]}]}'
run_stop "$H" "sess-blocked"
assert_contains "$HOOK_OUT" "user decisions are still open: approve deploy" "user-blocked advisory"
assert_contains "$HOOK_OUT" "in-flight tasks have no armed watchdog: T4" "watchdog advisory"
rm -rf "$H"

# Future canonical record without an accountable handle is still unarmed.
H="$(make_project)"
mkactive "$H" "missing-handle" '{"schema":"cc-master/v2","goal":"MISSING HANDLE","owner":{"active":true,"session_id":"sess-missing-handle"},"watchdog":{"fire_at":"2099-01-01T00:30:00Z","mechanism":"shell"},"tasks":[{"id":"T6","status":"in_flight","deps":[]}]}'
run_stop "$H" "sess-missing-handle"
assert_contains "$HOOK_OUT" "in-flight tasks have no armed watchdog: T6" "future watchdog without job_id remains unarmed"
rm -rf "$H"

# Legacy record with a blank handle is readable but cannot silence continuation.
H="$(make_project)"
mkactive "$H" "blank-handle" '{"schema":"cc-master/v2","goal":"BLANK HANDLE","owner":{"active":true,"session_id":"sess-blank-handle"},"wakeup":{"fire_at":"2099-01-01T00:30:00Z","mechanism":"loop","job_id":"   "},"tasks":[{"id":"T7","status":"in_flight","deps":[]}]}'
run_stop "$H" "sess-blank-handle"
assert_contains "$HOOK_OUT" "in-flight tasks have no armed watchdog: T7" "legacy wakeup with blank job_id remains unarmed"
rm -rf "$H"

# A traceable but expired handle is no longer armed.
H="$(make_project)"
mkactive "$H" "expired" '{"schema":"cc-master/v2","goal":"EXPIRED","owner":{"active":true,"session_id":"sess-expired"},"watchdog":{"fire_at":"2000-01-01T00:30:00Z","mechanism":"cron","job_id":"cron-old"},"tasks":[{"id":"T8","status":"in_flight","deps":[]}]}'
run_stop "$H" "sess-expired"
assert_contains "$HOOK_OUT" "in-flight tasks have no armed watchdog: T8" "expired watchdog remains unarmed"
rm -rf "$H"

# Done-only completion state: final self-check advisory.
H="$(make_project)"
mkactive "$H" "done" '{"schema":"cc-master/v2","goal":"DONE CURSOR BOARD","owner":{"active":true,"session_id":"sess-done"},"tasks":[{"id":"T5","status":"done","deps":[]}]}'
run_stop "$H" "sess-done"
assert_contains "$HOOK_OUT" '"followup_message"' "done-only board followup for final self-check"
assert_contains "$HOOK_OUT" "self-check against the original goal" "completion self-check advisory"
rm -rf "$H"

# FUSE: 5 consecutive blocks → release with followup_message (kind:system).
H="$(make_project)"
mkactive "$H" "fuse" '{"schema":"cc-master/v2","goal":"FUSE CURSOR BOARD","owner":{"active":true,"session_id":"sess-fuse"},"tasks":[]}'
for i in 1 2 3 4; do
  run_stop "$H" "sess-fuse"
  assert_contains "$HOOK_OUT" '"followup_message"' "fuse streak $i still followup"
done
run_stop "$H" "sess-fuse"
assert_contains "$HOOK_OUT" '"followup_message"' "fuse trip emits followup_message"
assert_contains "$HOOK_OUT" "fuse tripped" "fuse trip advisory"
rm -rf "$H"

finish
