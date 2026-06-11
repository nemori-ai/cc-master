#!/usr/bin/env bash
. "$(dirname "$0")/helpers.sh"

mkactive() { mkdir -p "$1"; printf '%s' "$3" > "$1/$2.board.json"; }
# run_ss HOME — run reinject with EMPTY stdin (no session_id → degraded: match any active board).
run_ss() {
  HOOK_OUT="$(CLAUDE_PROJECT_DIR="/nonexistent-proj" CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" CC_MASTER_HOME="$1" \
             bash "$PLUGIN_ROOT/hooks/scripts/reinject.sh" </dev/null 2>/dev/null)"; HOOK_RC=$?
}
# run_ss_sid HOME SID — run reinject with stdin JSON carrying session_id=SID (SessionStart-shaped).
# Session-scoped armed gate: only THIS session's active board(s) re-anchor the role.
run_ss_sid() {
  HOOK_OUT="$(printf '{"session_id":"%s","hook_event_name":"SessionStart","source":"compact"}' "$2" \
             | CLAUDE_PROJECT_DIR="/nonexistent-proj" CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" CC_MASTER_HOME="$1" \
               bash "$PLUGIN_ROOT/hooks/scripts/reinject.sh" 2>/dev/null)"; HOOK_RC=$?
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

# Case E: backward compat — a legacy board that still carries a residual `phase` block must NOT
# inject any phase note (the phase mechanism is gone) and must not error: goal/role/board are
# re-injected exactly as for a board with no phase at all.
H="$(make_project)"
mkactive "$H" "20260101T000000Z-1" '{"schema":"cc-master/v1","goal":"LEGACY PHASE BOARD","owner":{"active":true},"phase":{"current":"OLD PHASE NAME","goal_condition":"some old condition","task_ids":["T1","T2"]},"tasks":[{"id":"T1","status":"in_flight","deps":[]}]}'
run_ss "$H"
assert_eq 0 "$HOOK_RC" "residual phase block → still rc 0 (no error)"
assert_contains "$HOOK_OUT" "LEGACY PHASE BOARD" "still re-injects the goal when a residual phase block is present"
assert_contains "$HOOK_OUT" "orchestrator" "still re-anchors the role"
assert_not_contains "$HOOK_OUT" "OLD PHASE NAME" "residual phase.current must not be injected"
assert_not_contains "$HOOK_OUT" "some old condition" "residual phase.goal_condition must not be injected"
assert_not_contains "$HOOK_OUT" "/goal" "no /goal guidance injected anymore"
assert_not_contains "$HOOK_OUT" "phase" "no phase reminder injected anymore"
rm -rf "$H"

# Case F: an active board with NO phase field → goal/role/board re-injected, no phase reminder.
H="$(make_project)"
mkactive "$H" "20260101T000000Z-2" '{"schema":"cc-master/v1","goal":"NO PHASE HERE","owner":{"active":true},"tasks":[{"id":"T1","status":"ready","deps":[]}]}'
run_ss "$H"
assert_contains "$HOOK_OUT" "NO PHASE HERE" "still re-injects the goal when no phase"
assert_not_contains "$HOOK_OUT" "phase" "no phase reminder when board has no phase"
rm -rf "$H"

# ── H4: resume-side dangling-node report ──────────────────────────────────────────────────────────
# On resume/compact, beyond re-anchoring the role, name the board's unresolved (stale/escalated)
# nodes so a plan-update transaction break is called out on resume.

# Case G: active board with 1 stale + 1 escalated → ctx names them as unresolved, lists both ids.
H="$(make_project)"
mkactive "$H" "20260101T000000Z-3" '{"schema":"cc-master/v1","goal":"RECONCILE GOAL","owner":{"active":true},"tasks":[{"id":"T1","status":"stale","deps":[]},{"id":"T2","status":"in_flight","deps":[]},{"id":"T3","status":"escalated","deps":[]}]}'
run_ss "$H"
assert_contains "$HOOK_OUT" "RECONCILE GOAL" "G: still re-injects the goal"
assert_contains "$HOOK_OUT" "orchestrator" "G: still re-anchors the role"
assert_contains "$HOOK_OUT" "unresolved" "G: surfaces an unresolved-node note"
assert_contains "$HOOK_OUT" "T1" "G: names the stale node id"
assert_contains "$HOOK_OUT" "T3" "G: names the escalated node id"
assert_not_contains "$HOOK_OUT" "T2" "G: does not name a non-dangling (in_flight) node"
rm -rf "$H"

# Case H: active board with NO stale/escalated (all ready/in_flight/done) → ctx unchanged, no note.
H="$(make_project)"
mkactive "$H" "20260101T000000Z-4" '{"schema":"cc-master/v1","goal":"ALL CLEAR GOAL","owner":{"active":true},"tasks":[{"id":"T1","status":"ready","deps":[]},{"id":"T2","status":"in_flight","deps":[]},{"id":"T3","status":"done","deps":[]}]}'
run_ss "$H"
assert_contains "$HOOK_OUT" "ALL CLEAR GOAL" "H: re-injects the goal"
assert_not_contains "$HOOK_OUT" "unresolved" "H: no dangling-node note when nothing is stale/escalated"
rm -rf "$H"

# Case I: no active board → still silent (H4 must not break the dormant no-op).
H="$(make_project)"
mkactive "$H" "b1" '{"schema":"cc-master/v1","goal":"ARCHIVED","owner":{"active":false},"tasks":[{"id":"T1","status":"stale","deps":[]}]}'
run_ss "$H"
assert_eq "" "$HOOK_OUT" "I: archived board with a stale task → still silent (dormant)"
rm -rf "$H"

# Case J: stale/escalated tokens living only inside a nested task-local "log" array must NOT trip the
# dangling-node note (the tasks-region scan isolates nested fields — same guard as verify-board.sh).
H="$(make_project)"
mkactive "$H" "20260101T000000Z-5" '{"schema":"cc-master/v1","goal":"NESTED LOG GOAL","owner":{"active":true},"tasks":[{"id":"T1","status":"in_flight","deps":[],"log":[{"id":"L1","status":"stale"},{"id":"L2","status":"escalated"}]}]}'
run_ss "$H"
assert_contains "$HOOK_OUT" "NESTED LOG GOAL" "J: re-injects the goal"
assert_not_contains "$HOOK_OUT" "unresolved" "J: nested log stale/escalated does not trip the note"
rm -rf "$H"

# ── ARMED GATE: reinject is now SESSION-SCOPED (no longer home-scoped) ──────────────────────────────
# A hook stays dormant until THIS session is armed (active board with owner.session_id==stdin sid).
# reinject used to activate on ANY active board in home (home-scoped) — a brand-new session that
# never ran as-master-orchestrator would get falsely re-anchored as an orchestrator just because some
# OTHER session left an active board behind. These cases pin the session-scoped behavior.

# Case K (session match): board owned by THIS session → re-anchor (role + goal + board name).
H="$(make_project)"
mkactive "$H" "20260101T000000Z-K" '{"schema":"cc-master/v1","goal":"MY SESSION GOAL","owner":{"active":true,"session_id":"sess-mine"},"tasks":[{"id":"T1","status":"ready","deps":[]}]}'
run_ss_sid "$H" "sess-mine"
assert_eq 0 "$HOOK_RC" "K: my session's active board → rc 0"
assert_contains "$HOOK_OUT" "MY SESSION GOAL" "K: my session's board → re-injects the goal"
assert_contains "$HOOK_OUT" "orchestrator" "K: my session's board → re-anchors the role"
assert_contains "$HOOK_OUT" "20260101T000000Z-K.board.json" "K: my session's board → names it"
rm -rf "$H"

# Case L (FALSE-ACTIVATION GAP, the core fix): home has an active board owned by ANOTHER session, and
# THIS is a fresh session that never ran as-master-orchestrator → reinject must be SILENT (the new
# session is NOT an orchestrator; the leftover board is not its concern).
H="$(make_project)"
mkactive "$H" "20260101T000000Z-L" '{"schema":"cc-master/v1","goal":"OTHER SESSION GOAL","owner":{"active":true,"session_id":"sess-other"},"tasks":[{"id":"T1","status":"in_flight","deps":[]}]}'
run_ss_sid "$H" "sess-fresh-newcomer"
assert_eq 0 "$HOOK_RC" "L: other session's board, fresh session → rc 0"
assert_eq "" "$HOOK_OUT" "L: other session's active board does NOT activate a fresh session (false-activation gap closed)"
rm -rf "$H"

# Case M (mixed home): two active boards, one mine one another session's → only MY goal re-injected,
# the other session's goal is NOT leaked into my context.
H="$(make_project)"
mkactive "$H" "mine"  '{"schema":"cc-master/v1","goal":"GOAL FOR ME","owner":{"active":true,"session_id":"sess-m"},"tasks":[{"id":"T1","status":"in_flight","deps":[]}]}'
mkactive "$H" "other" '{"schema":"cc-master/v1","goal":"GOAL FOR THEM","owner":{"active":true,"session_id":"sess-o"},"tasks":[{"id":"T1","status":"in_flight","deps":[]}]}'
run_ss_sid "$H" "sess-m"
assert_contains "$HOOK_OUT" "GOAL FOR ME" "M: re-injects MY session's goal"
assert_not_contains "$HOOK_OUT" "GOAL FOR THEM" "M: does NOT leak the other session's goal"
rm -rf "$H"

# Case N (session-scoped H4 dangling note): stale/escalated only counted on MY board. My board is
# clean; the OTHER session's board has a stale node → no dangling note (it's not mine to reconcile).
H="$(make_project)"
mkactive "$H" "mine"  '{"schema":"cc-master/v1","goal":"CLEAN GOAL","owner":{"active":true,"session_id":"sess-n"},"tasks":[{"id":"T1","status":"in_flight","deps":[]}]}'
mkactive "$H" "other" '{"schema":"cc-master/v1","goal":"DIRTY GOAL","owner":{"active":true,"session_id":"sess-x"},"tasks":[{"id":"T9","status":"stale","deps":[]}]}'
run_ss_sid "$H" "sess-n"
assert_contains "$HOOK_OUT" "CLEAN GOAL" "N: re-injects my clean goal"
assert_not_contains "$HOOK_OUT" "unresolved" "N: other session's stale node does not trip MY dangling note"
assert_not_contains "$HOOK_OUT" "T9" "N: other session's stale node id not surfaced to me"
rm -rf "$H"

# Case O (session-scoped H4, positive): MY board has a stale node → my dangling note fires, naming it.
H="$(make_project)"
mkactive "$H" "20260101T000000Z-O" '{"schema":"cc-master/v1","goal":"RECONCILE MINE","owner":{"active":true,"session_id":"sess-o2"},"tasks":[{"id":"T1","status":"in_flight","deps":[]},{"id":"T5","status":"stale","deps":[]}]}'
run_ss_sid "$H" "sess-o2"
assert_contains "$HOOK_OUT" "unresolved" "O: my own stale node trips the dangling note"
assert_contains "$HOOK_OUT" "T5" "O: my own stale node id is named"
rm -rf "$H"

# Case P (degraded: no session_id → match any active, compaction-boundary robustness). A SessionStart
# whose stdin carries no session_id falls back to home-scoped matching so a compaction that drops the
# sid still re-anchors. (Preserves the original behavior under the degraded path.)
H="$(make_project)"
mkactive "$H" "20260101T000000Z-P" '{"schema":"cc-master/v1","goal":"DEGRADED GOAL","owner":{"active":true,"session_id":"sess-whatever"},"tasks":[{"id":"T1","status":"in_flight","deps":[]}]}'
run_ss "$H"   # empty stdin → no sid → degraded
assert_contains "$HOOK_OUT" "DEGRADED GOAL" "P: empty session_id → degraded match any active board (compaction robustness)"
rm -rf "$H"

finish
