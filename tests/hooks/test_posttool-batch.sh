#!/usr/bin/env bash
. "$(dirname "$0")/helpers.sh"

# Tests for posttool-batch.sh (H5 — WIP soft-warning on parallel-batch parse). The hook reads THIS
# session's active board, counts in_flight (N) vs top-level wip_limit (M), and injects a NON-BLOCKING
# additionalContext warning when N > M. It NEVER emits decision:block and is read-only on the board.

# mkactive HOME NAME JSON — drop a board file into the home
mkactive() { mkdir -p "$1"; printf '%s' "$3" > "$1/$2.board.json"; }
# run_batch HOME SID — run the PostToolBatch hook with stdin JSON carrying session_id=SID.
run_batch() {
  HOOK_OUT="$(printf '{"session_id":"%s","hook_event_name":"PostToolBatch","tool_results":[]}' "$2" \
             | CLAUDE_PROJECT_DIR="/nonexistent-proj" CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" CC_MASTER_HOME="$1" \
               bash "$PLUGIN_ROOT/hooks/scripts/posttool-batch.sh" 2>/dev/null)"; HOOK_RC=$?
}

# Case 1: active board, in_flight=5, wip_limit=4 → warn. HOOK_OUT contains "WIP", "5", "4", rc 0,
#          and MUST NOT contain a block decision.
H="$(make_project)"; SID="sess-over"
mkactive "$H" "b1" "{\"schema\":\"cc-master/v1\",\"goal\":\"g\",\"wip_limit\":4,\"owner\":{\"active\":true,\"session_id\":\"$SID\"},\"tasks\":[{\"id\":\"T1\",\"status\":\"in_flight\",\"deps\":[]},{\"id\":\"T2\",\"status\":\"in_flight\",\"deps\":[]},{\"id\":\"T3\",\"status\":\"in_flight\",\"deps\":[]},{\"id\":\"T4\",\"status\":\"in_flight\",\"deps\":[]},{\"id\":\"T5\",\"status\":\"in_flight\",\"deps\":[]}]}"
run_batch "$H" "$SID"
assert_eq 0 "$HOOK_RC" "over-cap → rc 0"
assert_contains "$HOOK_OUT" "WIP" "over-cap → warning mentions WIP"
assert_contains "$HOOK_OUT" "5" "over-cap → warning carries N=5"
assert_contains "$HOOK_OUT" "4" "over-cap → warning carries M=4"
assert_contains "$HOOK_OUT" "additionalContext" "over-cap → injects additionalContext"
assert_not_contains "$HOOK_OUT" "\"decision\":\"block\"" "over-cap → NEVER a block decision"
rm -rf "$H"

# Case 2: in_flight=2, wip_limit=4 → within cap → silent (empty out), rc 0.
H="$(make_project)"; SID="sess-under"
mkactive "$H" "b1" "{\"schema\":\"cc-master/v1\",\"goal\":\"g\",\"wip_limit\":4,\"owner\":{\"active\":true,\"session_id\":\"$SID\"},\"tasks\":[{\"id\":\"T1\",\"status\":\"in_flight\",\"deps\":[]},{\"id\":\"T2\",\"status\":\"in_flight\",\"deps\":[]}]}"
run_batch "$H" "$SID"
assert_eq 0 "$HOOK_RC" "within cap → rc 0"
assert_eq "" "$HOOK_OUT" "within cap → silent (no output)"
rm -rf "$H"

# Case 3: board has NO wip_limit field → graceful degrade → silent (empty out), rc 0 (must not crash).
H="$(make_project)"; SID="sess-nolimit"
mkactive "$H" "b1" "{\"schema\":\"cc-master/v1\",\"goal\":\"g\",\"owner\":{\"active\":true,\"session_id\":\"$SID\"},\"tasks\":[{\"id\":\"T1\",\"status\":\"in_flight\",\"deps\":[]},{\"id\":\"T2\",\"status\":\"in_flight\",\"deps\":[]},{\"id\":\"T3\",\"status\":\"in_flight\",\"deps\":[]},{\"id\":\"T4\",\"status\":\"in_flight\",\"deps\":[]},{\"id\":\"T5\",\"status\":\"in_flight\",\"deps\":[]}]}"
run_batch "$H" "$SID"
assert_eq 0 "$HOOK_RC" "no wip_limit → rc 0 (graceful degrade, no crash)"
assert_eq "" "$HOOK_OUT" "no wip_limit → silent (no threshold → no warning)"
rm -rf "$H"

# Case 4: no active board for this session → silent (empty out), rc 0.
H="$(make_project)"
run_batch "$H" "sess-absent"
assert_eq 0 "$HOOK_RC" "no active board → rc 0"
assert_eq "" "$HOOK_OUT" "no active board → silent"
rm -rf "$H"

# ── extra guards ──────────────────────────────────────────────────────────────────────────────────

# Case 5: non-numeric wip_limit (e.g. "auto") → graceful degrade → silent.
H="$(make_project)"; SID="sess-badlimit"
mkactive "$H" "b1" "{\"schema\":\"cc-master/v1\",\"wip_limit\":\"auto\",\"owner\":{\"active\":true,\"session_id\":\"$SID\"},\"tasks\":[{\"id\":\"T1\",\"status\":\"in_flight\",\"deps\":[]},{\"id\":\"T2\",\"status\":\"in_flight\",\"deps\":[]},{\"id\":\"T3\",\"status\":\"in_flight\",\"deps\":[]}]}"
run_batch "$H" "$SID"
assert_eq 0 "$HOOK_RC" "non-numeric wip_limit → rc 0"
assert_eq "" "$HOOK_OUT" "non-numeric wip_limit → silent (graceful degrade)"
rm -rf "$H"

# Case 6: N == M (exactly at cap, not over) → silent (warn only when strictly over).
H="$(make_project)"; SID="sess-atcap"
mkactive "$H" "b1" "{\"schema\":\"cc-master/v1\",\"wip_limit\":3,\"owner\":{\"active\":true,\"session_id\":\"$SID\"},\"tasks\":[{\"id\":\"T1\",\"status\":\"in_flight\",\"deps\":[]},{\"id\":\"T2\",\"status\":\"in_flight\",\"deps\":[]},{\"id\":\"T3\",\"status\":\"in_flight\",\"deps\":[]}]}"
run_batch "$H" "$SID"
assert_eq 0 "$HOOK_RC" "exactly at cap → rc 0"
assert_eq "" "$HOOK_OUT" "exactly at cap (N==M) → silent (warn only when strictly over)"
rm -rf "$H"

# Case 7: SINGLE-LINE board with a flexible log[] carrying status:"in_flight" → log must NOT inflate
#          the in_flight count. tasks has 2 in_flight, log has 1 → N=2 ≤ wip_limit=4 → silent.
H="$(make_project)"; SID="sess-log"
mkactive "$H" "b1" "{\"schema\":\"cc-master/v1\",\"wip_limit\":4,\"owner\":{\"active\":true,\"session_id\":\"$SID\"},\"tasks\":[{\"id\":\"T1\",\"status\":\"in_flight\",\"deps\":[]},{\"id\":\"T2\",\"status\":\"in_flight\",\"deps\":[]}],\"log\":[{\"id\":\"L1\",\"status\":\"in_flight\"},{\"id\":\"L2\",\"status\":\"in_flight\"},{\"id\":\"L3\",\"status\":\"in_flight\"}]}"
run_batch "$H" "$SID"
assert_eq 0 "$HOOK_RC" "log in_flight entries → rc 0"
assert_eq "" "$HOOK_OUT" "log in_flight entries excluded from count → N=2 ≤ cap → silent (narrow-waist scope)"
rm -rf "$H"

# Case 8: session filter — another session's over-cap board must NOT trigger a warning for MY session.
H="$(make_project)"; MINE="sess-mine"; OTHER="sess-other"
mkactive "$H" "other" "{\"schema\":\"cc-master/v1\",\"wip_limit\":1,\"owner\":{\"active\":true,\"session_id\":\"$OTHER\"},\"tasks\":[{\"id\":\"T1\",\"status\":\"in_flight\",\"deps\":[]},{\"id\":\"T2\",\"status\":\"in_flight\",\"deps\":[]}]}"
run_batch "$H" "$MINE"
assert_eq 0 "$HOOK_RC" "session filter → rc 0"
assert_eq "" "$HOOK_OUT" "session filter → other session's over-cap board does not warn me"
rm -rf "$H"

# Case 9: NO top-level wip_limit, but a TASK carries a nested "wip_limit":1 (agent-shaped payload).
#          in_flight=2 > 1. The nested cap must NOT be picked up — only a board-root top-level wip_limit
#          is a real cap, so this degrades gracefully to silent (no threshold → no warning). Guards
#          against the grep mis-catching a nested same-name key (codex round-2 finding).
H="$(make_project)"; SID="sess-nested"
mkactive "$H" "b1" "{\"schema\":\"cc-master/v1\",\"goal\":\"g\",\"owner\":{\"active\":true,\"session_id\":\"$SID\"},\"tasks\":[{\"id\":\"T1\",\"status\":\"in_flight\",\"deps\":[],\"wip_limit\":1},{\"id\":\"T2\",\"status\":\"in_flight\",\"deps\":[]}]}"
run_batch "$H" "$SID"
assert_eq 0 "$HOOK_RC" "nested wip_limit → rc 0"
assert_eq "" "$HOOK_OUT" "nested task wip_limit ignored → no top-level cap → silent (graceful degrade)"
rm -rf "$H"

# Case 10: REAL top-level wip_limit=1 AND a task ALSO carries nested "wip_limit":99 → the top-level cap
#           must still win. in_flight=2 > 1 → warn. Guards against over-correcting Case 9 into never
#           reading a genuine top-level cap when a nested same-name key is present.
H="$(make_project)"; SID="sess-toplevel-wins"
mkactive "$H" "b1" "{\"schema\":\"cc-master/v1\",\"goal\":\"g\",\"wip_limit\":1,\"owner\":{\"active\":true,\"session_id\":\"$SID\"},\"tasks\":[{\"id\":\"T1\",\"status\":\"in_flight\",\"deps\":[],\"wip_limit\":99},{\"id\":\"T2\",\"status\":\"in_flight\",\"deps\":[]}]}"
run_batch "$H" "$SID"
assert_eq 0 "$HOOK_RC" "top-level wip_limit with nested same-name → rc 0"
assert_contains "$HOOK_OUT" "WIP" "top-level wip_limit still read despite nested same-name key → warns"
assert_contains "$HOOK_OUT" "additionalContext" "top-level cap → injects additionalContext"
rm -rf "$H"

finish
