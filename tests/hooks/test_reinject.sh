#!/usr/bin/env bash
. "$(dirname "$0")/helpers.sh"

mkactive() { mkdir -p "$1"; printf '%s' "$3" > "$1/$2.board.json"; }
run_ss() {
  HOOK_OUT="$(CLAUDE_PROJECT_DIR="/nonexistent-proj" CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" CC_MASTER_HOME="$1" \
             bash "$PLUGIN_ROOT/hooks/scripts/reinject.sh" </dev/null 2>/dev/null)"; HOOK_RC=$?
}

# Case A: no active board → silent no-op
H="$(make_project)"
run_ss "$H"
assert_eq 0 "$HOOK_RC" "no active board → rc 0"
assert_eq "" "$HOOK_OUT" "no active board → no output"
rm -rf "$H"

# Case B: an active board with a goal → re-injects role + home + goal + board name
H="$(make_project)"
mkactive "$H" "20260101T000000Z-1" '{"schema":"cc-master/v1","goal":"MIGRATE THE COGNITION SCHEMA","owner":{"active":true},"tasks":[{"id":"T1","status":"ready","deps":[]}]}'
run_ss "$H"
assert_contains "$HOOK_OUT" "MIGRATE THE COGNITION SCHEMA" "re-injects the goal"
assert_contains "$HOOK_OUT" "orchestrator" "re-anchors the role"
assert_contains "$HOOK_OUT" "20260101T000000Z-1.board.json" "names the active board"
assert_contains "$HOOK_OUT" "$H" "points at the home dir"
rm -rf "$H"

# Case C: only an archived board (active:false) → no-op
H="$(make_project)"
mkactive "$H" "b1" '{"schema":"cc-master/v1","goal":"OLD DONE TASK","owner":{"active":false},"tasks":[]}'
run_ss "$H"
assert_eq "" "$HOOK_OUT" "archived-only home → no output"
rm -rf "$H"

# Case D: two active boards → lists both goals
H="$(make_project)"
mkactive "$H" "a" '{"schema":"cc-master/v1","goal":"TASK ALPHA","owner":{"active":true},"tasks":[{"id":"T1","status":"in_flight","deps":[]}]}'
mkactive "$H" "b" '{"schema":"cc-master/v1","goal":"TASK BETA","owner":{"active":true},"tasks":[{"id":"T1","status":"in_flight","deps":[]}]}'
run_ss "$H"
assert_contains "$HOOK_OUT" "TASK ALPHA" "lists first active goal"
assert_contains "$HOOK_OUT" "TASK BETA" "lists second active goal"
rm -rf "$H"

# Case E: an active board carrying a phase (current + goal_condition) → re-injects the phase so the
# agent re-recognises which self-driving segment it is in, re-checks whether the /goal is still
# attached, and re-sets it from the board record if it was dropped (the hook cannot read goal state).
H="$(make_project)"
mkactive "$H" "20260101T000000Z-1" '{"schema":"cc-master/v1","goal":"SHIP AUTH","owner":{"active":true},"phase":{"current":"MIGRATING AUTH MODULE","goal_condition":"auth tests green OR all paths blocked on background/user","task_ids":["T1","T2"]},"tasks":[{"id":"T1","status":"in_flight","deps":[]}]}'
run_ss "$H"
assert_contains "$HOOK_OUT" "MIGRATING AUTH MODULE" "re-injects the phase.current text"
assert_contains "$HOOK_OUT" "auth tests green OR all paths blocked on background/user" "re-injects the phase.goal_condition text"
assert_contains "$HOOK_OUT" "phase" "mentions re-recognising the phase"
assert_contains "$HOOK_OUT" "/goal" "tells the agent to re-check the phase /goal"
assert_contains "$HOOK_OUT" "re-set" "tells the agent to re-set the goal from the board if dropped"
rm -rf "$H"

# Case F: backward compat — an active board with NO phase field → behaves exactly as before
# (goal/role/board all re-injected, but no phase reminder leaks in).
H="$(make_project)"
mkactive "$H" "20260101T000000Z-2" '{"schema":"cc-master/v1","goal":"NO PHASE HERE","owner":{"active":true},"tasks":[{"id":"T1","status":"ready","deps":[]}]}'
run_ss "$H"
assert_contains "$HOOK_OUT" "NO PHASE HERE" "still re-injects the goal when no phase"
assert_not_contains "$HOOK_OUT" "Current phase" "no phase reminder when board has no phase"
rm -rf "$H"

# Case G: hardening (adversarial-review BLOCKER #1) — a board with NO phase block but stray
# "current" / "goal_condition" keys on a task / log must NOT fabricate a phase note. Extraction
# must be anchored to the phase object, not scan the whole file.
H="$(make_project)"
mkactive "$H" "g1" '{"schema":"cc-master/v1","goal":"STRAY KEYS","owner":{"active":true},"tasks":[{"id":"T1","status":"ready","current":"running unit tests","deps":[]}],"log":[{"goal_condition":"oops noted"}]}'
run_ss "$H"
assert_contains "$HOOK_OUT" "STRAY KEYS" "still re-injects goal when stray keys present"
assert_not_contains "$HOOK_OUT" "Current phase" "no fabricated phase from stray current/goal_condition keys"
assert_not_contains "$HOOK_OUT" "running unit tests" "a stray task current must not leak as a phase"
rm -rf "$H"

# Case H: ordering (adversarial-review BLOCKER #2) — phase block sits BEFORE a task that also has a
# "current" key (the board.template.json order). A single-line greedy sed would grab the LAST
# "current" (the task's); extraction must be anchored to the phase object to pick the right one.
H="$(make_project)"
mkactive "$H" "h1" '{"schema":"cc-master/v1","goal":"ORDER","owner":{"active":true},"phase":{"current":"RIGHT-PHASE","goal_condition":"cond OK OR all blocked","task_ids":["T1"]},"tasks":[{"id":"T1","status":"in_flight","current":"WRONG-TASK-STATE","deps":[]}]}'
run_ss "$H"
assert_contains "$HOOK_OUT" "RIGHT-PHASE" "extracts phase.current, not an earlier task's current"
assert_not_contains "$HOOK_OUT" "WRONG-TASK-STATE" "earlier task current must not be taken as the phase"
rm -rf "$H"

# Case I: multi-line board with a real phase block → still extracted (flatten-before-match).
H="$(make_project)"
printf '%s\n' '{' '  "schema":"cc-master/v1", "goal":"PRETTY", "owner":{"active":true},' '  "phase":{ "current":"ML PHASE", "goal_condition":"cond Y", "task_ids":["T1"] },' '  "tasks":[{"id":"T1","status":"ready","deps":[]}]' '}' > "$H/i1.board.json"
run_ss "$H"
assert_contains "$HOOK_OUT" "ML PHASE" "extracts phase.current from a multi-line board"
rm -rf "$H"

finish
