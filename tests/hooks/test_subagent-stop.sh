#!/usr/bin/env bash
. "$(dirname "$0")/helpers.sh"

# H6 · SubagentStop hook — when a background sub-agent finishes, if THIS session's active board has
# >=1 in_flight task, nudge the main line to reconcile/integrate/verify. Pure bash, read-only board,
# no sidecar, self-gates silent on every not-applicable condition (no active board / no in_flight).

# mkactive HOME NAME JSON — drop a board file into the home
mkactive() { mkdir -p "$1"; printf '%s' "$3" > "$1/$2.board.json"; }

# run_substop_sid HOME SID — run the SubagentStop hook with stdin JSON carrying session_id=SID
# (plus the SubagentStop-shaped fields the runtime sends). Sets HOOK_OUT / HOOK_RC.
run_substop_sid() {
  HOOK_OUT="$(printf '{"session_id":"%s","hook_event_name":"SubagentStop","agent_id":"a1","agent_type":"general-purpose"}' "$2" \
             | CLAUDE_PROJECT_DIR="/nonexistent-proj" CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" CC_MASTER_HOME="$1" \
               bash "$PLUGIN_ROOT/hooks/scripts/subagent-stop.sh" 2>/dev/null)"; HOOK_RC=$?
}
# run_substop_json HOME JSON — arbitrary stdin (e.g. without session_id → degraded full-home scan).
run_substop_json() {
  HOOK_OUT="$(printf '%s' "$2" \
             | CLAUDE_PROJECT_DIR="/nonexistent-proj" CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" CC_MASTER_HOME="$1" \
               bash "$PLUGIN_ROOT/hooks/scripts/subagent-stop.sh" 2>/dev/null)"; HOOK_RC=$?
}

# ── Case 1: active board (active:true + owner.session_id == stdin sid) with 1 in_flight task →
#            inject additionalContext nudging integrate + endpoint verify; rc 0. ──────────────────
H="$(make_project)"
SID="sess-substop-1"
mkactive "$H" "b1" "{\"schema\":\"cc-master/v1\",\"goal\":\"g\",\"owner\":{\"active\":true,\"session_id\":\"$SID\"},\"git\":{},\"tasks\":[{\"id\":\"T1\",\"status\":\"in_flight\",\"deps\":[]},{\"id\":\"T2\",\"status\":\"done\",\"deps\":[]}]}"
run_substop_sid "$H" "$SID"
assert_eq 0 "$HOOK_RC" "in_flight present → rc 0"
assert_contains "$HOOK_OUT" "SubagentStop" "in_flight present → hookEventName is SubagentStop"
assert_contains "$HOOK_OUT" "additionalContext" "in_flight present → injects additionalContext"
assert_contains "$HOOK_OUT" "integrate" "in_flight present → reason says integrate"
assert_contains "$HOOK_OUT" "gate-green" "in_flight present → reason carries gate-green ≠ passed"
rm -rf "$H"

# ── Case 2: no active board belonging to this session → silent (empty out), rc 0. ─────────────────
# (a) home with NO board at all
H="$(make_project)"
run_substop_sid "$H" "sess-none"
assert_eq 0 "$HOOK_RC" "no board → rc 0"
assert_eq "" "$HOOK_OUT" "no board → silent (empty out)"
rm -rf "$H"

# (b) an active board, but it belongs to ANOTHER session → not mine → silent
H="$(make_project)"
mkactive "$H" "other" '{"schema":"cc-master/v1","goal":"g","owner":{"active":true,"session_id":"sess-other"},"git":{},"tasks":[{"id":"T1","status":"in_flight","deps":[]}]}'
run_substop_sid "$H" "sess-mine"
assert_eq 0 "$HOOK_RC" "other session's board → rc 0"
assert_eq "" "$HOOK_OUT" "other session's active board → silent (not mine)"
rm -rf "$H"

# (c) an ARCHIVED board (owner.active:false) with an in_flight task → ignored → silent
H="$(make_project)"
mkactive "$H" "arch" '{"schema":"cc-master/v1","goal":"g","owner":{"active":false,"session_id":"sess-arch"},"git":{},"tasks":[{"id":"T1","status":"in_flight","deps":[]}]}'
run_substop_sid "$H" "sess-arch"
assert_eq 0 "$HOOK_RC" "archived board → rc 0"
assert_eq "" "$HOOK_OUT" "archived board with in_flight → silent (not active)"
rm -rf "$H"

# ── Case 3: active board but ZERO in_flight (all done) → silent (nothing to integrate). ───────────
H="$(make_project)"
SID="sess-substop-3"
mkactive "$H" "b1" "{\"schema\":\"cc-master/v1\",\"goal\":\"g\",\"owner\":{\"active\":true,\"session_id\":\"$SID\"},\"git\":{},\"tasks\":[{\"id\":\"T1\",\"status\":\"done\",\"deps\":[]},{\"id\":\"T2\",\"status\":\"done\",\"deps\":[]}]}"
run_substop_sid "$H" "$SID"
assert_eq 0 "$HOOK_RC" "all done → rc 0"
assert_eq "" "$HOOK_OUT" "all done (0 in_flight) → silent (nothing to integrate)"
rm -rf "$H"

# ── Extra A: degraded scan — stdin has NO session_id → match any active board; in_flight present
#             → inject. Verifies degraded matching mirrors verify-board.sh. ────────────────────────
H="$(make_project)"
mkactive "$H" "b1" '{"schema":"cc-master/v1","goal":"g","owner":{"active":true,"session_id":"whatever"},"git":{},"tasks":[{"id":"T1","status":"in_flight","deps":[]}]}'
run_substop_json "$H" '{"hook_event_name":"SubagentStop","agent_id":"a1"}'
assert_eq 0 "$HOOK_RC" "no session_id → rc 0"
assert_contains "$HOOK_OUT" "integrate" "no session_id → degraded scan finds active board with in_flight → inject"
rm -rf "$H"

# ── Extra B: in_flight only inside a task-local "log" must NOT count (format-agnostic region scope,
#             mirrors verify-board.sh). All tasks done; a log entry carries status:"in_flight". ────
H="$(make_project)"
SID="sess-substop-log"
mkactive "$H" "b1" "{\"schema\":\"cc-master/v1\",\"goal\":\"g\",\"owner\":{\"active\":true,\"session_id\":\"$SID\"},\"git\":{},\"tasks\":[{\"id\":\"T1\",\"status\":\"done\",\"deps\":[],\"log\":[{\"id\":\"L1\",\"status\":\"in_flight\"}]}],\"log\":[{\"id\":\"L9\",\"status\":\"in_flight\"}]}"
run_substop_sid "$H" "$SID"
assert_eq "" "$HOOK_OUT" "in_flight only in log fields → not counted → silent (region-scoped, mirrors verify-board)"
rm -rf "$H"

finish
