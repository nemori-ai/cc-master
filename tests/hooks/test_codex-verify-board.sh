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

# Empty active board: Stop decision:block continues Codex with an explicit release valve.
H="$(make_project)"
mkactive "$H" "empty" '{"schema":"cc-master/v2","goal":"EMPTY CODEX BOARD","owner":{"active":true,"session_id":"sess-empty"},"tasks":[]}'
run_stop "$H" "sess-empty"
assert_contains "$HOOK_OUT" '"decision":"block"' "empty board blocks Stop to continue Codex"
assert_contains "$HOOK_OUT" "active board has no tasks" "empty board advisory"
assert_contains "$HOOK_OUT" "ccm board set-param stop_allow_until" "empty board includes release command"
rm -rf "$H"

# Future stop_allow_until releases the Stop block after independent verification.
H="$(make_project)"
mkactive "$H" "released" '{"schema":"cc-master/v2","goal":"RELEASED CODEX BOARD","owner":{"active":true,"session_id":"sess-release"},"tasks":[],"runtime":{"stop_allow_until":"2999-01-01T00:00:00Z"}}'
run_stop "$H" "sess-release"
assert_eq "" "$HOOK_OUT" "future stop_allow_until releases Stop block"
rm -rf "$H"

# Actionable and uncertain work.
H="$(make_project)"
mkactive "$H" "work" '{"schema":"cc-master/v2","goal":"WORK CODEX BOARD","owner":{"active":true,"session_id":"sess-work"},"tasks":[{"id":"T1","status":"ready","deps":[]},{"id":"T2","status":"uncertain","deps":[]}]}'
run_stop "$H" "sess-work"
assert_contains "$HOOK_OUT" '"decision":"block"' "actionable work blocks Stop to continue Codex"
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

# Future canonical record without an accountable handle is still unarmed.
H="$(make_project)"
mkactive "$H" "missing-handle" '{"schema":"cc-master/v2","goal":"MISSING HANDLE","owner":{"active":true,"session_id":"sess-missing-handle"},"watchdog":{"fire_at":"2099-01-01T00:30:00Z","mechanism":"shell"},"tasks":[{"id":"T6","status":"in_flight","deps":[]}]}'
run_stop "$H" "sess-missing-handle"
assert_contains "$HOOK_OUT" "in-flight tasks have no armed watchdog: T6" "future watchdog without job_id remains unarmed"
rm -rf "$H"

# Legacy record with a blank handle is readable but cannot silence the gate.
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
mkactive "$H" "done" '{"schema":"cc-master/v2","goal":"DONE CODEX BOARD","owner":{"active":true,"session_id":"sess-done"},"tasks":[{"id":"T5","status":"done","deps":[]}]}'
run_stop "$H" "sess-done"
assert_contains "$HOOK_OUT" '"decision":"block"' "done-only board blocks for final self-check"
assert_contains "$HOOK_OUT" "self-check local task acceptance and global acceptance" "completion self-check advisory"
rm -rf "$H"

# Pending Goal Contract blocks ordinary completion/decomposition.
H="$(make_project)"
mkactive "$H" "pending" '{"schema":"cc-master/v2","goal":"","goal_contract":{"schema":"ccm/goal-contract/v1","revision":1,"assurance":"pending","updated_at":"2026-07-15T00:00:00Z"},"owner":{"active":true,"session_id":"sess-pending"},"tasks":[]}'
run_stop "$H" "sess-pending"
assert_contains "$HOOK_OUT" "Goal Contract is pending" "pending contract blocks ordinary stop"
assert_contains "$HOOK_OUT" "ccm goal set" "pending contract gives refinement verb"
rm -rf "$H"

# A complete pending decision package may stop so the user can answer it.
H="$(make_project)"
mkactive "$H" "question" '{"schema":"cc-master/v2","goal":"","goal_contract":{"schema":"ccm/goal-contract/v1","revision":1,"assurance":"pending","updated_at":"2026-07-15T00:00:00Z"},"owner":{"active":true,"session_id":"sess-question"},"tasks":[{"id":"D1","title":"Choose deployment authority","status":"blocked","blocked_on":"user","deps":[],"decision_package":{"inputs_hash":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","ask_type":"decision","context_md":"Deployment authority changes the allowed delivery action.","what_i_need":"Choose whether the PR may be merged.","options":[{"id":"draft","label":"Draft PR only"},{"id":"merge","label":"Allow merge"}],"enter_cmd":"ccm discuss D1"}}]}'
run_stop "$H" "sess-question"
assert_eq "" "$HOOK_OUT" "pending decision package allows user handoff"
rm -rf "$H"

# A blocked_on:user label without a complete decision_package is not a legal pending handoff.
H="$(make_project)"
mkactive "$H" "incomplete-question" '{"schema":"cc-master/v2","goal":"","goal_contract":{"schema":"ccm/goal-contract/v1","revision":1,"assurance":"pending","updated_at":"2026-07-15T00:00:00Z"},"owner":{"active":true,"session_id":"sess-incomplete-question"},"tasks":[{"id":"D1","title":"Choose deployment authority","status":"blocked","blocked_on":"user","deps":[]}]}'
run_stop "$H" "sess-incomplete-question"
assert_contains "$HOOK_OUT" '"decision":"block"' "incomplete pending decision package blocks"
assert_contains "$HOOK_OUT" "complete blocked_on" "incomplete pending decision package gives repair guidance"
rm -rf "$H"

# Malformed Goal Contract cannot be bypassed by stop_allow_until.
H="$(make_project)"
mkactive "$H" "bad" '{"schema":"cc-master/v2","goal":"g","goal_contract":{"schema":"wrong","revision":1,"assurance":"confirmed"},"owner":{"active":true,"session_id":"sess-bad"},"runtime":{"stop_allow_until":"2999-01-01T00:00:00Z"},"tasks":[{"id":"T1","status":"done","deps":[]}]}'
run_stop "$H" "sess-bad"
assert_contains "$HOOK_OUT" "integrity check failed" "malformed goal contract blocks despite release timestamp"
rm -rf "$H"

finish
