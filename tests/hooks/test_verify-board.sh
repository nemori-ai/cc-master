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

# fp_of BOARD — compute the completion-state fingerprint of a board exactly as the hook does
# (id+status+blocked_on triples inside the tasks region, file order, no sort), so tests can seed
# the sidecar's last_handshook_fp field deterministically. MUST mirror status_fingerprint() +
# tasks_region() in verify-board.sh.
fp_of() { local c r; c="$(cat "$1" 2>/dev/null)"; r="${c#*\"tasks\"}"; [ "$r" = "$c" ] && r=""; r="${r%%\"log\"*}"; printf '%s' "$r" | grep -oE '"(id|status|blocked_on)"[[:space:]]*:[[:space:]]*"[^"]*"' | cksum | awk '{print $1}'; }

# Case H (NEW): completion state (in_flight/blocked/done), no sidecar mark → BLOCK with self-check
#                checklist, AND sidecar's last_handshook_fp set to the current fingerprint.
H="$(make_project)"
SID="sess-handshake-1"
mkactive "$H" "b1" "{\"schema\":\"cc-master/v1\",\"goal\":\"g\",\"owner\":{\"active\":true,\"session_id\":\"$SID\"},\"tasks\":[{\"id\":\"T1\",\"status\":\"done\",\"deps\":[]},{\"id\":\"T2\",\"status\":\"in_flight\",\"deps\":[]},{\"id\":\"T3\",\"status\":\"blocked\",\"deps\":[]}]}"
run_stop_sid "$H" "$SID"
assert_contains "$HOOK_OUT" "block" "first completion → block"
assert_contains "$HOOK_OUT" "self-check" "first completion → reason has self-check keyword"
assert_contains "$HOOK_OUT" "original goal" "first completion → reason cites original goal"
assert_file "$H/.$SID.stopcheck" "first completion → sidecar created"
# sidecar now records last_handshook_fp = current fingerprint (second field)
EXP_FP="$(fp_of "$H/b1.board.json")"
GOT_FP="$(awk '{print $2}' "$H/.$SID.stopcheck")"
assert_eq "$EXP_FP" "$GOT_FP" "first completion → last_handshook_fp set to current fingerprint"
rm -rf "$H"

# Case I (NEW): completion state, sidecar's last_handshook_fp == current fingerprint → ALLOW, and the
#                fingerprint is KEPT (streak reset to 0) so the SAME state keeps allowing on later Stops.
H="$(make_project)"
SID="sess-handshake-2"
mkactive "$H" "b1" "{\"schema\":\"cc-master/v1\",\"goal\":\"g\",\"owner\":{\"active\":true,\"session_id\":\"$SID\"},\"tasks\":[{\"id\":\"T1\",\"status\":\"done\",\"deps\":[]}]}"
EXP_FP="$(fp_of "$H/b1.board.json")"
printf '0 %s\n' "$EXP_FP" > "$H/.$SID.stopcheck"   # streak=0, fp already handshook
run_stop_sid "$H" "$SID"
assert_eq 0 "$HOOK_RC" "second completion → rc 0"
assert_not_contains "$HOOK_OUT" "block" "second completion → allow (no block)"
assert_file "$H/.$SID.stopcheck" "second completion → sidecar kept (fingerprint persists)"
KEPT_FP="$(awk '{print $2}' "$H/.$SID.stopcheck")"
assert_eq "$EXP_FP" "$KEPT_FP" "second completion → handshook fingerprint retained"
KEPT_STREAK="$(awk '{print $1}' "$H/.$SID.stopcheck")"
assert_eq 0 "$KEPT_STREAK" "second completion → streak reset to 0 on allow"
rm -rf "$H"

# Case J (NEW): handshake reset — sidecar carried a handshook fingerprint, but board now has a ready
#                task again → BLOCK (actionable). Actionable is not a handshake, so it does not write a
#                fingerprint; the next completion state must self-check anew.
H="$(make_project)"
SID="sess-reset"
mkactive "$H" "b1" "{\"schema\":\"cc-master/v1\",\"owner\":{\"active\":true,\"session_id\":\"$SID\"},\"tasks\":[{\"id\":\"T1\",\"status\":\"ready\",\"deps\":[]}]}"
printf '0 12345\n' > "$H/.$SID.stopcheck"   # pretend a previous completion-state handshake happened
run_stop_sid "$H" "$SID"
assert_contains "$HOOK_OUT" "block" "actionable again → block"
SCFP="$(awk '{print $2}' "$H/.$SID.stopcheck")"
assert_eq "-" "$SCFP" "actionable again → no fingerprint written (handshake state reset)"
rm -rf "$H"

# Case Q (codex review catch, Finding #21): identity-preserving status SWAP must re-handshake. Two
#  tasks swap in_flight<->blocked, so the status MULTISET is unchanged. A status-only fingerprint
#  would match the seeded handshook fp and wrongly ALLOW Stop, skipping the self-check for the new
#  state; the id+status+blocked_on fingerprint changes → BLOCK anew.
H="$(make_project)"
SID="sess-swap"
mkactive "$H" "b1" "{\"schema\":\"cc-master/v1\",\"owner\":{\"active\":true,\"session_id\":\"$SID\"},\"tasks\":[{\"id\":\"T1\",\"status\":\"in_flight\",\"deps\":[]},{\"id\":\"T2\",\"status\":\"blocked\",\"deps\":[]}]}"
printf '0 %s\n' "$(fp_of "$H/b1.board.json")" > "$H/.$SID.stopcheck"   # seed: this state already handshook
mkactive "$H" "b1" "{\"schema\":\"cc-master/v1\",\"owner\":{\"active\":true,\"session_id\":\"$SID\"},\"tasks\":[{\"id\":\"T1\",\"status\":\"blocked\",\"deps\":[]},{\"id\":\"T2\",\"status\":\"in_flight\",\"deps\":[]}]}"
run_stop_sid "$H" "$SID"
assert_contains "$HOOK_OUT" "block" "status swap (same multiset, different identity) → re-handshake block (codex catch #21)"
rm -rf "$H"

# Case R (codex review catch, Finding #22): fingerprint is scoped to TASK rows (lines carrying
#  `"deps"`). A multi-line board whose flexible `log` entries use id/status as keys must NOT affect
#  the fingerprint — only the task waist counts (narrow-waist contract). Two boards with identical
#  tasks but different log id/status → SAME fingerprint.
H="$(make_project)"
printf '%s\n' '{"owner":{"active":true,"session_id":"s"},' '"tasks":[ {"id":"T1","status":"done","deps":[]} ],' '"log":[ {"id":"L1","status":"alpha"} ]}' > "$H/a.board.json"
printf '%s\n' '{"owner":{"active":true,"session_id":"s"},' '"tasks":[ {"id":"T1","status":"done","deps":[]} ],' '"log":[ {"id":"L9","status":"omega"} ]}' > "$H/b.board.json"
assert_eq "$(fp_of "$H/a.board.json")" "$(fp_of "$H/b.board.json")" "fingerprint scoped to task rows — log id/status does not change fp (codex catch #22)"
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
# pre-mark MINE's completion state as already handshook (seed its fingerprint) so it allows
# (isolate: we are testing it is NOT blocked by OTHER's empty board).
printf '0 %s\n' "$(fp_of "$H/mine.board.json")" > "$H/.$MINE.stopcheck"
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
#                Seed sidecar at block_streak=4, last_handshook_fp=0 (won't match the real cksum
#                fingerprint, so the completion branch takes the block path). The next block would push
#                streak to 5 (>= FUSE) → force allow + warning keyword.
H="$(make_project)"
SID="sess-fuse"
mkactive "$H" "b1" "{\"schema\":\"cc-master/v1\",\"goal\":\"g\",\"owner\":{\"active\":true,\"session_id\":\"$SID\"},\"tasks\":[{\"id\":\"T1\",\"status\":\"done\",\"deps\":[]}]}"
printf '4 0\n' > "$H/.$SID.stopcheck"   # block_streak=4, fp=0 (mismatch) — one more block trips the fuse
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

# ─── FINGERPRINT HANDSHAKE (P4: same completion-state fingerprint must NOT re-self-check) ──────────
# Root cause (this round): a completion state (only in_flight/blocked/done) went through the same
# handshake as a true completion, and the sidecar zeroed on every allow → the SAME board state got
# re-asked to self-check during a long background wait. Fix: sidecar second field becomes the last
# handshook status-multiset fingerprint. Same fingerprint → allow (already handshook); changed
# fingerprint → block + re-handshake.

# Case Q (NEW): first completion-state Stop on a fingerprint blocks; second Stop with the SAME
#                fingerprint allows; THIRD Stop with the SAME fingerprint STILL allows (the bug this
#                round fixes — previously the third would block again); then a CHANGED fingerprint
#                re-blocks the handshake.
H="$(make_project)"; SID="sess-fp"
BOARD="$H/20260101T000000Z-1.board.json"
mkdir -p "$H"
printf '%s' '{"schema":"cc-master/v1","goal":"g","owner":{"active":true,"session_id":"sess-fp"},"tasks":[{"id":"T1","status":"in_flight","deps":[]}]}' > "$BOARD"
# First completion-state Stop: should block (first handshake of this fingerprint)
run_stop_sid "$H" "$SID"
assert_contains "$HOOK_OUT" "block" "P4: first completion handshake → block"
# Second Stop (fingerprint unchanged): should allow
run_stop_sid "$H" "$SID"
assert_not_contains "$HOOK_OUT" "block" "P4: same fingerprint second Stop → allow"
# Third Stop (fingerprint STILL unchanged): should STILL allow (this round's fix)
run_stop_sid "$H" "$SID"
assert_not_contains "$HOOK_OUT" "block" "P4: same fingerprint third Stop → still allow (repeated self-check fixed)"
# Fingerprint changes (T1 in_flight→done plus a new in_flight T2) → re-block the handshake
printf '%s' '{"schema":"cc-master/v1","goal":"g","owner":{"active":true,"session_id":"sess-fp"},"tasks":[{"id":"T1","status":"done","deps":[]},{"id":"T2","status":"in_flight","deps":[]}]}' > "$BOARD"
run_stop_sid "$H" "$SID"
assert_contains "$HOOK_OUT" "block" "P4: fingerprint changed → re-block handshake"
rm -rf "$H"

# ─── SINGLE-LINE BOARD (format-agnostic tasks-region scoping) ─────────────────────────────────────
# The hook must behave identically on compact single-line JSON and on pretty-printed multi-line
# JSON — the old line-based grep scoping silently assumed "one task object per line".

# Case S: SINGLE-LINE board, empty tasks[] but log[] carries "id" entries → must still be detected
#          as EMPTY and block. (Line-based grep -c '"id"' saw the whole line and miscounted.)
H="$(make_project)"
mkactive "$H" "b1" '{"schema":"cc-master/v1","owner":{"active":true},"tasks":[],"log":[{"id":"L1","status":"note"}]}'
run_stop "$H"
assert_contains "$HOOK_OUT" "no tasks" "single-line: empty tasks + log ids → still detected EMPTY (not mistaken for a filled board)"
rm -rf "$H"

# Case T: SINGLE-LINE board, all tasks done, log entry carries status:"ready" → log must NOT count
#          as actionable. First Stop = completion handshake (self-check), and a LOG APPEND between
#          Stops must not change the fingerprint → second Stop allows.
H="$(make_project)"; SID="sess-slog"
mkactive "$H" "b1" "{\"schema\":\"cc-master/v1\",\"goal\":\"g\",\"owner\":{\"active\":true,\"session_id\":\"$SID\"},\"tasks\":[{\"id\":\"T1\",\"status\":\"done\",\"deps\":[]}],\"log\":[{\"id\":\"L1\",\"status\":\"ready\"}]}"
run_stop_sid "$H" "$SID"
assert_contains "$HOOK_OUT" "self-check" "single-line: log status=ready ignored → completion handshake, not actionable block"
mkactive "$H" "b1" "{\"schema\":\"cc-master/v1\",\"goal\":\"g\",\"owner\":{\"active\":true,\"session_id\":\"$SID\"},\"tasks\":[{\"id\":\"T1\",\"status\":\"done\",\"deps\":[]}],\"log\":[{\"id\":\"L1\",\"status\":\"ready\"},{\"id\":\"L2\",\"status\":\"appended\"}]}"
run_stop_sid "$H" "$SID"
assert_not_contains "$HOOK_OUT" "block" "single-line: log append does not change fingerprint → same state allows"
rm -rf "$H"

# Case U: SINGLE-LINE fingerprint scoped to tasks region — identical tasks, different log → SAME fp.
H="$(make_project)"
printf '%s' '{"owner":{"active":true,"session_id":"s"},"tasks":[{"id":"T1","status":"done","deps":[]}],"log":[{"id":"L1","status":"alpha"}]}' > "$H/a.board.json"
printf '%s' '{"owner":{"active":true,"session_id":"s"},"tasks":[{"id":"T1","status":"done","deps":[]}],"log":[{"id":"L9","status":"omega"}]}' > "$H/b.board.json"
assert_eq "$(fp_of "$H/a.board.json")" "$(fp_of "$H/b.board.json")" "single-line fingerprint scoped to tasks region (log excluded)"
rm -rf "$H"

finish
