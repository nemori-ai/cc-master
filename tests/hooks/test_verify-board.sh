#!/usr/bin/env bash
. "$(dirname "$0")/helpers.sh"

# mkactive HOME NAME JSON — drop a board file into the home
mkactive() { mkdir -p "$1"; printf '%s' "$3" > "$1/$2.board.json"; }
# run_stop HOME — run the Stop hook against a home dir with EMPTY stdin (no session_id).
# Empty sid → hook degrades to full-home scan (degraded-defense contract). Sets HOOK_OUT / HOOK_RC.
run_stop() {
  HOOK_OUT="$(CLAUDE_PROJECT_DIR="/nonexistent-proj" CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" CC_MASTER_HOME="$1" \
             bash "$PLUGIN_ROOT/hooks/scripts/verify-board.sh" </dev/null 2>/dev/null)"; HOOK_RC=$?
}
# run_stop_sid HOME SID — run the Stop hook with stdin JSON carrying session_id=SID.
run_stop_sid() {
  HOOK_OUT="$(printf '{"session_id":"%s","hook_event_name":"Stop"}' "$2" \
             | CLAUDE_PROJECT_DIR="/nonexistent-proj" CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" CC_MASTER_HOME="$1" \
               bash "$PLUGIN_ROOT/hooks/scripts/verify-board.sh" 2>/dev/null)"; HOOK_RC=$?
}
# run_stop_json HOME JSON — run the Stop hook with arbitrary stdin JSON (e.g. one WITHOUT session_id).
run_stop_json() {
  HOOK_OUT="$(printf '%s' "$2" \
             | CLAUDE_PROJECT_DIR="/nonexistent-proj" CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" CC_MASTER_HOME="$1" \
               bash "$PLUGIN_ROOT/hooks/scripts/verify-board.sh" 2>/dev/null)"; HOOK_RC=$?
}

# ─── RETAINED CONTRACTS (run with empty stdin → degraded full-home scan) ──────────────────────────

# Case A: no active board (empty home) → allow, no block
H="$(make_project)"
run_stop "$H"
assert_eq 0 "$HOOK_RC" "empty home → rc 0"
assert_not_contains "$HOOK_OUT" "block" "empty home → no block"
rm -rf "$H"

# Case B: an active board with 0 tasks → hard block (bootstrap backstop)
H="$(make_project)"
mkactive "$H" "20260101T000000Z-1" '{"schema":"cc-master/v1","goal":"g","owner":{"active":true},"tasks":[]}'
run_stop "$H"
assert_contains "$HOOK_OUT" "block" "empty active board → block"
rm -rf "$H"

# Case E: an ARCHIVED board (owner.active:false) with 0 tasks → ignored → allow
H="$(make_project)"
mkactive "$H" "b1" '{"schema":"cc-master/v1","owner":{"active":false},"tasks":[]}'
run_stop "$H"
assert_eq 0 "$HOOK_RC" "archived empty board → rc 0"
assert_not_contains "$HOOK_OUT" "block" "archived board ignored → no block"
rm -rf "$H"

# Case F: two active boards — one filled (in_flight), one empty → still blocks (any empty active blocks)
H="$(make_project)"
mkactive "$H" "filled" '{"schema":"cc-master/v1","owner":{"active":true},"tasks":[{"id":"T1","status":"in_flight","deps":[]}]}'
mkactive "$H" "empty"  '{"schema":"cc-master/v1","owner":{"active":true},"tasks":[]}'
run_stop "$H"
assert_contains "$HOOK_OUT" "block" "an empty active board among others → block"
rm -rf "$H"

# ─── CHANGED CONTRACTS (ready / uncertain now BLOCK) ──────────────────────────────────────────────

# Case C (CHANGED): active board WITH a ready task → BLOCK (still-ready work remains)
H="$(make_project)"
mkactive "$H" "b1" '{"schema":"cc-master/v1","owner":{"active":true},"tasks":[{"id":"T1","status":"ready","deps":[]}]}'
run_stop "$H"
assert_contains "$HOOK_OUT" "block" "ready task → block"
rm -rf "$H"

# Case G (NEW): active board WITH an uncertain task → BLOCK (output pending verification)
H="$(make_project)"
mkactive "$H" "b1" '{"schema":"cc-master/v1","owner":{"active":true},"tasks":[{"id":"T1","status":"uncertain","deps":[]}]}'
run_stop "$H"
assert_contains "$HOOK_OUT" "block" "uncertain task → block"
rm -rf "$H"

# ─── SELF-CHECK HANDSHAKE (completion state: all in_flight/blocked/done) ───────────────────────────

# Case H (NEW): completion state (in_flight/blocked/done), no sidecar mark → BLOCK with self-check
#                checklist, AND sidecar selfcheck_done flipped to 1.
H="$(make_project)"
SID="sess-handshake-1"
mkactive "$H" "b1" "{\"schema\":\"cc-master/v1\",\"goal\":\"g\",\"owner\":{\"active\":true,\"session_id\":\"$SID\"},\"tasks\":[{\"id\":\"T1\",\"status\":\"done\",\"deps\":[]},{\"id\":\"T2\",\"status\":\"in_flight\",\"deps\":[]},{\"id\":\"T3\",\"status\":\"blocked\",\"deps\":[]}]}"
run_stop_sid "$H" "$SID"
assert_contains "$HOOK_OUT" "block" "first completion → block"
assert_contains "$HOOK_OUT" "self-check" "first completion → reason has self-check keyword"
assert_contains "$HOOK_OUT" "original goal" "first completion → reason cites original goal"
assert_file "$H/.$SID.stopcheck" "first completion → sidecar created"
# sidecar now records selfcheck_done=1 (second field)
SCDONE="$(awk '{print $2}' "$H/.$SID.stopcheck")"
assert_eq 1 "$SCDONE" "first completion → selfcheck_done set to 1"
rm -rf "$H"

# Case I (NEW): completion state, sidecar already selfcheck_done=1 → ALLOW + sidecar cleared
H="$(make_project)"
SID="sess-handshake-2"
mkactive "$H" "b1" "{\"schema\":\"cc-master/v1\",\"goal\":\"g\",\"owner\":{\"active\":true,\"session_id\":\"$SID\"},\"tasks\":[{\"id\":\"T1\",\"status\":\"done\",\"deps\":[]}]}"
printf '0 1\n' > "$H/.$SID.stopcheck"   # block_streak=0, selfcheck_done=1
run_stop_sid "$H" "$SID"
assert_eq 0 "$HOOK_RC" "second completion → rc 0"
assert_not_contains "$HOOK_OUT" "block" "second completion → allow (no block)"
assert_no_file "$H/.$SID.stopcheck" "second completion → sidecar cleared on allow"
rm -rf "$H"

# Case J (NEW): handshake reset — selfcheck_done was 1, but board now has a ready task again →
#                BLOCK (actionable) and selfcheck_done reset to 0 (next completion must self-check anew).
H="$(make_project)"
SID="sess-reset"
mkactive "$H" "b1" "{\"schema\":\"cc-master/v1\",\"owner\":{\"active\":true,\"session_id\":\"$SID\"},\"tasks\":[{\"id\":\"T1\",\"status\":\"ready\",\"deps\":[]}]}"
printf '0 1\n' > "$H/.$SID.stopcheck"   # pretend a previous self-check happened
run_stop_sid "$H" "$SID"
assert_contains "$HOOK_OUT" "block" "actionable again → block"
SCDONE="$(awk '{print $2}' "$H/.$SID.stopcheck")"
assert_eq 0 "$SCDONE" "actionable again → selfcheck_done reset to 0"
rm -rf "$H"

# ─── SESSION FILTERING (Finding #4) ───────────────────────────────────────────────────────────────

# Case K (NEW): two active boards in home — only the OTHER session's board is empty. The current
#                session's board is a healthy completion state. Current session must NOT be blocked
#                by the other session's empty board. (Directly verifies Finding #4.)
H="$(make_project)"
MINE="sess-mine"
OTHER="sess-other"
mkactive "$H" "mine"  "{\"schema\":\"cc-master/v1\",\"goal\":\"g\",\"owner\":{\"active\":true,\"session_id\":\"$MINE\"},\"tasks\":[{\"id\":\"T1\",\"status\":\"done\",\"deps\":[]}]}"
mkactive "$H" "other" "{\"schema\":\"cc-master/v1\",\"owner\":{\"active\":true,\"session_id\":\"$OTHER\"},\"tasks\":[]}"
# pre-mark MINE's self-check as done so it allows (isolate: we are testing it is NOT blocked by OTHER)
printf '0 1\n' > "$H/.$MINE.stopcheck"
run_stop_sid "$H" "$MINE"
assert_eq 0 "$HOOK_RC" "session filter → rc 0 (other session's empty board ignored)"
assert_not_contains "$HOOK_OUT" "block" "session filter → my session not blocked by other's empty board"
rm -rf "$H"

# Case L (NEW): session filter the OTHER way — MY board is empty, other session's board is fine.
#                Running as MY session → block (my own empty board is mine to fix).
H="$(make_project)"
MINE="sess-mine2"
OTHER="sess-other2"
mkactive "$H" "mine"  "{\"schema\":\"cc-master/v1\",\"owner\":{\"active\":true,\"session_id\":\"$MINE\"},\"tasks\":[]}"
mkactive "$H" "other" "{\"schema\":\"cc-master/v1\",\"owner\":{\"active\":true,\"session_id\":\"$OTHER\"},\"tasks\":[{\"id\":\"T1\",\"status\":\"in_flight\",\"deps\":[]}]}"
run_stop_sid "$H" "$MINE"
assert_contains "$HOOK_OUT" "block" "session filter → my own empty board blocks me"
rm -rf "$H"

# Case M (NEW): stdin has NO session_id → degrade to full-home scan, do not crash.
#                Home has one empty active board → block (full scan finds it).
H="$(make_project)"
mkactive "$H" "b1" '{"schema":"cc-master/v1","owner":{"active":true,"session_id":"whatever"},"tasks":[]}'
run_stop_json "$H" '{"hook_event_name":"Stop"}'
assert_eq 0 "$HOOK_RC" "no session_id → does not crash (rc 0)"
assert_contains "$HOOK_OUT" "block" "no session_id → full-home scan finds empty active board → block"
rm -rf "$H"

# ─── FUSE (anti-deadlock) ─────────────────────────────────────────────────────────────────────────

# Case N (NEW): fuse — after FUSE (5) consecutive blocks, the hook force-allows with a warning.
#                Seed sidecar at block_streak=4, selfcheck_done=0, board in completion state. The next
#                block would push streak to 5 (>= FUSE) → force allow + warning keyword.
H="$(make_project)"
SID="sess-fuse"
mkactive "$H" "b1" "{\"schema\":\"cc-master/v1\",\"goal\":\"g\",\"owner\":{\"active\":true,\"session_id\":\"$SID\"},\"tasks\":[{\"id\":\"T1\",\"status\":\"done\",\"deps\":[]}]}"
printf '4 0\n' > "$H/.$SID.stopcheck"   # block_streak=4 — one more block trips the fuse
run_stop_sid "$H" "$SID"
assert_eq 0 "$HOOK_RC" "fuse → rc 0"
# Force-allow = no block DECISION (the warning text itself legitimately contains the word "blocked").
assert_not_contains "$HOOK_OUT" "\"decision\":\"block\"" "fuse tripped → force allow (no block decision)"
assert_contains "$HOOK_OUT" "fuse" "fuse tripped → warning keyword present"
assert_no_file "$H/.$SID.stopcheck" "fuse tripped → sidecar cleared on force allow"
rm -rf "$H"

# Case O (NEW): fuse warning keyword — capture the warning text. Use a ready task to force a block
#                path, seeded at streak=4 so the fuse trips this round. Hook must emit the 'fuse'
#                warning rather than a normal block.
H="$(make_project)"
SID="sess-fuse2"
mkactive "$H" "b1" "{\"schema\":\"cc-master/v1\",\"owner\":{\"active\":true,\"session_id\":\"$SID\"},\"tasks\":[{\"id\":\"T1\",\"status\":\"ready\",\"deps\":[]}]}"
printf '4 0\n' > "$H/.$SID.stopcheck"
run_stop_sid "$H" "$SID"
assert_not_contains "$HOOK_OUT" "\"decision\":\"block\"" "fuse over ready task → not a block decision"
rm -rf "$H"

# Case P (NEW): block streak increments — completion-state first block on a fresh (no sidecar)
#                session writes block_streak=1.
H="$(make_project)"
SID="sess-streak"
mkactive "$H" "b1" "{\"schema\":\"cc-master/v1\",\"goal\":\"g\",\"owner\":{\"active\":true,\"session_id\":\"$SID\"},\"tasks\":[{\"id\":\"T1\",\"status\":\"done\",\"deps\":[]}]}"
run_stop_sid "$H" "$SID"
assert_contains "$HOOK_OUT" "block" "fresh completion → block"
STREAK="$(awk '{print $1}' "$H/.$SID.stopcheck")"
assert_eq 1 "$STREAK" "fresh block → block_streak incremented to 1"
rm -rf "$H"

finish
