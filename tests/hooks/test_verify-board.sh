#!/usr/bin/env bash
. "$(dirname "$0")/helpers.sh"

# mkactive HOME NAME JSON — drop a board file into <home>/boards/ (board-v2 layout)
mkactive() { mkdir -p "$1/boards"; printf '%s' "$3" > "$1/boards/$2.board.json"; }
# run_stop HOME — run the Stop hook against a home dir with EMPTY stdin (no session_id).
# Empty sid → hook degrades to full-home scan (degraded-defense contract). Sets HOOK_OUT / HOOK_RC.
run_stop() {
  HOOK_OUT="$(CLAUDE_PROJECT_DIR="/nonexistent-proj" CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" CC_MASTER_HOME="$1" \
             node "$PLUGIN_ROOT/hooks/scripts/verify-board.js" </dev/null 2>/dev/null)"; HOOK_RC=$?
}
# run_stop_sid HOME SID — run the Stop hook with stdin JSON carrying session_id=SID.
run_stop_sid() {
  HOOK_OUT="$(printf '{"session_id":"%s","hook_event_name":"Stop"}' "$2" \
             | CLAUDE_PROJECT_DIR="/nonexistent-proj" CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" CC_MASTER_HOME="$1" \
               node "$PLUGIN_ROOT/hooks/scripts/verify-board.js" 2>/dev/null)"; HOOK_RC=$?
}
# run_stop_json HOME JSON — run the Stop hook with arbitrary stdin JSON (e.g. one WITHOUT session_id).
run_stop_json() {
  HOOK_OUT="$(printf '%s' "$2" \
             | CLAUDE_PROJECT_DIR="/nonexistent-proj" CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" CC_MASTER_HOME="$1" \
               node "$PLUGIN_ROOT/hooks/scripts/verify-board.js" 2>/dev/null)"; HOOK_RC=$?
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
mkactive "$H" "20260101T000000Z-1" '{"schema":"cc-master/v2","goal":"g","owner":{"active":true},"tasks":[]}'
run_stop "$H"
assert_contains "$HOOK_OUT" "block" "empty active board → block"
rm -rf "$H"

# Case E: an ARCHIVED board (owner.active:false) with 0 tasks → ignored → allow
H="$(make_project)"
mkactive "$H" "b1" '{"schema":"cc-master/v2","owner":{"active":false},"tasks":[]}'
run_stop "$H"
assert_eq 0 "$HOOK_RC" "archived empty board → rc 0"
assert_not_contains "$HOOK_OUT" "block" "archived board ignored → no block"
rm -rf "$H"

# Case F: two active boards — one filled (in_flight), one empty → still blocks (any empty active blocks)
H="$(make_project)"
mkactive "$H" "filled" '{"schema":"cc-master/v2","owner":{"active":true},"tasks":[{"id":"T1","status":"in_flight","deps":[]}]}'
mkactive "$H" "empty"  '{"schema":"cc-master/v2","owner":{"active":true},"tasks":[]}'
run_stop "$H"
assert_contains "$HOOK_OUT" "block" "an empty active board among others → block"
rm -rf "$H"

# ─── CHANGED CONTRACTS (ready / uncertain now BLOCK) ──────────────────────────────────────────────

# Case C (CHANGED): active board WITH a ready task → BLOCK (still-ready work remains)
H="$(make_project)"
mkactive "$H" "b1" '{"schema":"cc-master/v2","owner":{"active":true},"tasks":[{"id":"T1","status":"ready","deps":[]}]}'
run_stop "$H"
assert_contains "$HOOK_OUT" "block" "ready task → block"
rm -rf "$H"

# Case G (NEW): active board WITH an uncertain task → BLOCK (output pending verification)
H="$(make_project)"
mkactive "$H" "b1" '{"schema":"cc-master/v2","owner":{"active":true},"tasks":[{"id":"T1","status":"uncertain","deps":[]}]}'
run_stop "$H"
assert_contains "$HOOK_OUT" "block" "uncertain task → block"
rm -rf "$H"

# ─── SELF-CHECK HANDSHAKE (completion state: all in_flight/blocked/done) ───────────────────────────

# fp_of BOARD — compute the completion-state fingerprint of a board exactly as the hook does
# (id+status+blocked_on triples inside the bracket-matched tasks array, file order, no sort), so
# tests can seed the sidecar's last_handshook_fp field deterministically. MUST mirror
# status_fingerprint() + tasks_region() in verify-board.sh.
tasks_region_t() {
  awk '
    { s = s $0 "\n" }
    END {
      i = index(s, "\"tasks\""); if (!i) exit
      s = substr(s, i + 7)
      j = index(s, "["); if (!j) exit
      s = substr(s, j + 1)
      bd = 1; cd = 0; instr = 0; esc = 0; out = ""
      n = length(s)
      for (k = 1; k <= n; k++) {
        ch = substr(s, k, 1)
        if (instr) {
          if (bd == 1 && cd == 1) out = out ch
          if (esc) esc = 0
          else if (ch == "\\") esc = 1
          else if (ch == "\"") instr = 0
          continue
        }
        if (ch == "\"") { instr = 1; if (bd == 1 && cd == 1) out = out ch; continue }
        if (ch == "[") { bd++; continue }
        if (ch == "]") { bd--; if (bd == 0) break; continue }
        if (ch == "{") { cd++; continue }
        if (ch == "}") { cd--; continue }
        if (bd == 1 && cd == 1) out = out ch
      }
      printf "%s", out
    }' "$1" 2>/dev/null
}
# wakeup_is_object_t BOARD — mirror of verify-board.sh's wakeup_is_object(): exit 0 iff the board has a
# ROOT-depth `"wakeup"` key whose value is an OBJECT. Needed so fp_of can replicate watchdog_needed.
wakeup_is_object_t() {
  awk '
    { s = s $0 "\n" }
    END {
      n = length(s)
      cd = 0; bd = 0; instr = 0; esc = 0
      capkey = 0; key = ""; pendKey = ""
      afterColon = 0
      for (k = 1; k <= n; k++) {
        ch = substr(s, k, 1)
        if (instr) {
          if (esc) { esc = 0; if (capkey) key = key ch; continue }
          if (ch == "\\") { esc = 1; if (capkey) key = key ch; continue }
          if (ch == "\"") { instr = 0; if (capkey) { capkey = 0; pendKey = key } continue }
          if (capkey) key = key ch
          continue
        }
        if (afterColon) {
          if (ch == " " || ch == "\t" || ch == "\n" || ch == "\r" || ch == ":") continue
          if (ch == "{") { print "yes"; exit }
          exit
        }
        if (ch == "\"") { instr = 1; if (cd == 1 && bd == 0) { capkey = 1; key = "" } else capkey = 0; continue }
        if (ch == "[") { bd++; pendKey = ""; continue }
        if (ch == "]") { if (bd > 0) bd--; continue }
        if (ch == "{") { cd++; pendKey = ""; continue }
        if (ch == "}") { if (cd > 0) cd--; pendKey = ""; continue }
        if (ch == ":") { if (cd == 1 && bd == 0 && pendKey == "wakeup") afterColon = 1; continue }
        if (ch == ",") pendKey = ""
      }
    }' "$1" 2>/dev/null | grep -q "yes"
}
# fp_of BOARD — MUST mirror status_fingerprint() in verify-board.sh. Since codex round-2's P2 fix, the
# fingerprint folds in the watchdog_needed bit (0/1) as a leading "watchdog_needed:<v>" line BEFORE the
# task id+status+blocked_on+parent quads (D3 added `parent` to the fold: a child's status flip changes the
# owner sub-graph fingerprint; an old board with no `parent` token hashes exactly as the pre-D3 formula).
# (so a state needing a watchdog hashes differently, AND a stale
# pre-upgrade .stopcheck can never collide). watchdog_needed = (board has an in_flight task in the tasks
# region) AND (no root-depth wakeup OBJECT) — replicated here exactly. Single-board mirror (the seed/assert
# tests below each use ONE matched board), matching the loop the hook runs over $matched_boards.
fp_of() { # $1 = board path
  local wn=0
  if tasks_region_t "$1" | grep -qE '"status"[[:space:]]*:[[:space:]]*"in_flight"'; then
    wakeup_is_object_t "$1" || wn=1
  fi
  { printf 'watchdog_needed:%s\n' "$wn"
    tasks_region_t "$1" | grep -oE '"(id|status|blocked_on|parent)"[[:space:]]*:[[:space:]]*"[^"]*"'
  } | cksum | awk '{print $1}'
}

# Case H (NEW): completion state (in_flight/blocked/done), no sidecar mark → BLOCK with self-check
#                checklist, AND sidecar's last_handshook_fp set to the current fingerprint.
H="$(make_project)"
SID="sess-handshake-1"
mkactive "$H" "b1" "{\"schema\":\"cc-master/v2\",\"goal\":\"g\",\"owner\":{\"active\":true,\"session_id\":\"$SID\"},\"tasks\":[{\"id\":\"T1\",\"status\":\"done\",\"deps\":[]},{\"id\":\"T2\",\"status\":\"in_flight\",\"deps\":[]},{\"id\":\"T3\",\"status\":\"blocked\",\"deps\":[]}]}"
run_stop_sid "$H" "$SID"
assert_contains "$HOOK_OUT" "block" "first completion → block"
assert_contains "$HOOK_OUT" "self-check" "first completion → reason has self-check keyword"
assert_contains "$HOOK_OUT" "original goal" "first completion → reason cites original goal"
assert_file "$H/.$SID.stopcheck" "first completion → sidecar created"
# sidecar now records last_handshook_fp = current fingerprint (second field)
EXP_FP="$(fp_of "$H/boards/b1.board.json")"
GOT_FP="$(awk '{print $2}' "$H/.$SID.stopcheck")"
assert_eq "$EXP_FP" "$GOT_FP" "first completion → last_handshook_fp set to current fingerprint"
rm -rf "$H"

# Case I (NEW): completion state, sidecar's last_handshook_fp == current fingerprint → ALLOW, and the
#                fingerprint is KEPT (streak reset to 0) so the SAME state keeps allowing on later Stops.
H="$(make_project)"
SID="sess-handshake-2"
mkactive "$H" "b1" "{\"schema\":\"cc-master/v2\",\"goal\":\"g\",\"owner\":{\"active\":true,\"session_id\":\"$SID\"},\"tasks\":[{\"id\":\"T1\",\"status\":\"done\",\"deps\":[]}]}"
EXP_FP="$(fp_of "$H/boards/b1.board.json")"
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
mkactive "$H" "b1" "{\"schema\":\"cc-master/v2\",\"owner\":{\"active\":true,\"session_id\":\"$SID\"},\"tasks\":[{\"id\":\"T1\",\"status\":\"ready\",\"deps\":[]}]}"
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
mkactive "$H" "b1" "{\"schema\":\"cc-master/v2\",\"owner\":{\"active\":true,\"session_id\":\"$SID\"},\"tasks\":[{\"id\":\"T1\",\"status\":\"in_flight\",\"deps\":[]},{\"id\":\"T2\",\"status\":\"blocked\",\"deps\":[]}]}"
printf '0 %s\n' "$(fp_of "$H/boards/b1.board.json")" > "$H/.$SID.stopcheck"   # seed: this state already handshook
mkactive "$H" "b1" "{\"schema\":\"cc-master/v2\",\"owner\":{\"active\":true,\"session_id\":\"$SID\"},\"tasks\":[{\"id\":\"T1\",\"status\":\"blocked\",\"deps\":[]},{\"id\":\"T2\",\"status\":\"in_flight\",\"deps\":[]}]}"
run_stop_sid "$H" "$SID"
assert_contains "$HOOK_OUT" "block" "status swap (same multiset, different identity) → re-handshake block (codex catch #21)"
rm -rf "$H"

# Case R (codex review catch, Finding #22): fingerprint is scoped to TASK rows (lines carrying
#  `"deps"`). A multi-line board whose flexible `log` entries use id/status as keys must NOT affect
#  the fingerprint — only the task waist counts (narrow-waist contract). Two boards with identical
#  tasks but different log id/status → SAME fingerprint.
H="$(make_project)"; mkdir -p "$H/boards"
printf '%s\n' '{"owner":{"active":true,"session_id":"s"},' '"tasks":[ {"id":"T1","status":"done","deps":[]} ],' '"log":[ {"id":"L1","status":"alpha"} ]}' > "$H/boards/a.board.json"
printf '%s\n' '{"owner":{"active":true,"session_id":"s"},' '"tasks":[ {"id":"T1","status":"done","deps":[]} ],' '"log":[ {"id":"L9","status":"omega"} ]}' > "$H/boards/b.board.json"
assert_eq "$(fp_of "$H/boards/a.board.json")" "$(fp_of "$H/boards/b.board.json")" "fingerprint scoped to task rows — log id/status does not change fp (codex catch #22)"
rm -rf "$H"

# ─── SESSION FILTERING (Finding #4) ───────────────────────────────────────────────────────────────

# Case K (NEW): two active boards in home — only the OTHER session's board is empty. The current
#                session's board is a healthy completion state. Current session must NOT be blocked
#                by the other session's empty board. (Directly verifies Finding #4.)
H="$(make_project)"
MINE="sess-mine"
OTHER="sess-other"
mkactive "$H" "mine"  "{\"schema\":\"cc-master/v2\",\"goal\":\"g\",\"owner\":{\"active\":true,\"session_id\":\"$MINE\"},\"tasks\":[{\"id\":\"T1\",\"status\":\"done\",\"deps\":[]}]}"
mkactive "$H" "other" "{\"schema\":\"cc-master/v2\",\"owner\":{\"active\":true,\"session_id\":\"$OTHER\"},\"tasks\":[]}"
# pre-mark MINE's completion state as already handshook (seed its fingerprint) so it allows
# (isolate: we are testing it is NOT blocked by OTHER's empty board).
printf '0 %s\n' "$(fp_of "$H/boards/mine.board.json")" > "$H/.$MINE.stopcheck"
run_stop_sid "$H" "$MINE"
assert_eq 0 "$HOOK_RC" "session filter → rc 0 (other session's empty board ignored)"
assert_not_contains "$HOOK_OUT" "block" "session filter → my session not blocked by other's empty board"
rm -rf "$H"

# Case L (NEW): session filter the OTHER way — MY board is empty, other session's board is fine.
#                Running as MY session → block (my own empty board is mine to fix).
H="$(make_project)"
MINE="sess-mine2"
OTHER="sess-other2"
mkactive "$H" "mine"  "{\"schema\":\"cc-master/v2\",\"owner\":{\"active\":true,\"session_id\":\"$MINE\"},\"tasks\":[]}"
mkactive "$H" "other" "{\"schema\":\"cc-master/v2\",\"owner\":{\"active\":true,\"session_id\":\"$OTHER\"},\"tasks\":[{\"id\":\"T1\",\"status\":\"in_flight\",\"deps\":[]}]}"
run_stop_sid "$H" "$MINE"
assert_contains "$HOOK_OUT" "block" "session filter → my own empty board blocks me"
rm -rf "$H"

# Case M (NEW): stdin has NO session_id → degrade to full-home scan, do not crash.
#                Home has one empty active board → block (full scan finds it).
H="$(make_project)"
mkactive "$H" "b1" '{"schema":"cc-master/v2","owner":{"active":true,"session_id":"whatever"},"tasks":[]}'
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
mkactive "$H" "b1" "{\"schema\":\"cc-master/v2\",\"goal\":\"g\",\"owner\":{\"active\":true,\"session_id\":\"$SID\"},\"tasks\":[{\"id\":\"T1\",\"status\":\"done\",\"deps\":[]}]}"
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
mkactive "$H" "b1" "{\"schema\":\"cc-master/v2\",\"owner\":{\"active\":true,\"session_id\":\"$SID\"},\"tasks\":[{\"id\":\"T1\",\"status\":\"ready\",\"deps\":[]}]}"
printf '4 0\n' > "$H/.$SID.stopcheck"
run_stop_sid "$H" "$SID"
assert_not_contains "$HOOK_OUT" "\"decision\":\"block\"" "fuse over ready task → not a block decision"
rm -rf "$H"

# Case P (NEW): block streak increments — completion-state first block on a fresh (no sidecar)
#                session writes block_streak=1.
H="$(make_project)"
SID="sess-streak"
mkactive "$H" "b1" "{\"schema\":\"cc-master/v2\",\"goal\":\"g\",\"owner\":{\"active\":true,\"session_id\":\"$SID\"},\"tasks\":[{\"id\":\"T1\",\"status\":\"done\",\"deps\":[]}]}"
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
BOARD="$H/boards/20260101T000000Z-1.board.json"
mkdir -p "$H/boards"
printf '%s' '{"schema":"cc-master/v2","goal":"g","owner":{"active":true,"session_id":"sess-fp"},"tasks":[{"id":"T1","status":"in_flight","deps":[]}]}' > "$BOARD"
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
printf '%s' '{"schema":"cc-master/v2","goal":"g","owner":{"active":true,"session_id":"sess-fp"},"tasks":[{"id":"T1","status":"done","deps":[]},{"id":"T2","status":"in_flight","deps":[]}]}' > "$BOARD"
run_stop_sid "$H" "$SID"
assert_contains "$HOOK_OUT" "block" "P4: fingerprint changed → re-block handshake"
rm -rf "$H"

# ─── SINGLE-LINE BOARD (format-agnostic tasks-region scoping) ─────────────────────────────────────
# The hook must behave identically on compact single-line JSON and on pretty-printed multi-line
# JSON — the old line-based grep scoping silently assumed "one task object per line".

# Case S: SINGLE-LINE board, empty tasks[] but log[] carries "id" entries → must still be detected
#          as EMPTY and block. (Line-based grep -c '"id"' saw the whole line and miscounted.)
H="$(make_project)"
mkactive "$H" "b1" '{"schema":"cc-master/v2","owner":{"active":true},"tasks":[],"log":[{"id":"L1","status":"note"}]}'
run_stop "$H"
assert_contains "$HOOK_OUT" "no tasks" "single-line: empty tasks + log ids → still detected EMPTY (not mistaken for a filled board)"
rm -rf "$H"

# Case T: SINGLE-LINE board, all tasks done, log entry carries status:"ready" → log must NOT count
#          as actionable. First Stop = completion handshake (self-check), and a LOG APPEND between
#          Stops must not change the fingerprint → second Stop allows.
H="$(make_project)"; SID="sess-slog"
mkactive "$H" "b1" "{\"schema\":\"cc-master/v2\",\"goal\":\"g\",\"owner\":{\"active\":true,\"session_id\":\"$SID\"},\"tasks\":[{\"id\":\"T1\",\"status\":\"done\",\"deps\":[]}],\"log\":[{\"id\":\"L1\",\"status\":\"ready\"}]}"
run_stop_sid "$H" "$SID"
assert_contains "$HOOK_OUT" "self-check" "single-line: log status=ready ignored → completion handshake, not actionable block"
mkactive "$H" "b1" "{\"schema\":\"cc-master/v2\",\"goal\":\"g\",\"owner\":{\"active\":true,\"session_id\":\"$SID\"},\"tasks\":[{\"id\":\"T1\",\"status\":\"done\",\"deps\":[]}],\"log\":[{\"id\":\"L1\",\"status\":\"ready\"},{\"id\":\"L2\",\"status\":\"appended\"}]}"
run_stop_sid "$H" "$SID"
assert_not_contains "$HOOK_OUT" "block" "single-line: log append does not change fingerprint → same state allows"
rm -rf "$H"

# Case V (codex review catch): a TASK-LOCAL flexible "log" field must not truncate the region.
#          T1 carries tasks[0].log (allowed agent-shaped field); T2 after it is ready. The hook must
#          still see T2 as actionable and block with the ACTIONABLE message (not a self-check
#          handshake on a truncated prefix).
H="$(make_project)"
mkactive "$H" "b1" '{"schema":"cc-master/v2","owner":{"active":true},"tasks":[{"id":"T1","status":"done","deps":[],"log":["did x"]},{"id":"T2","status":"ready","deps":[]}],"log":[]}'
run_stop "$H"
assert_contains "$HOOK_OUT" "still has" "task-local log field does not truncate region → later ready task still actionable (codex catch)"
rm -rf "$H"

# Case W (codex review catch, round 2): STRUCTURED task-local log entries must not read as task
#          state. A done task carrying "log":[{"id":"L1","status":"ready"}] is a COMPLETION state —
#          first Stop must be the self-check handshake (not an actionable block), and the same
#          state must allow on the second Stop instead of blocking until the fuse trips.
H="$(make_project)"; SID="sess-tlog"
mkactive "$H" "b1" "{\"schema\":\"cc-master/v2\",\"goal\":\"g\",\"owner\":{\"active\":true,\"session_id\":\"$SID\"},\"tasks\":[{\"id\":\"T1\",\"status\":\"done\",\"deps\":[],\"log\":[{\"id\":\"L1\",\"status\":\"ready\"}]}],\"log\":[]}"
run_stop_sid "$H" "$SID"
assert_contains "$HOOK_OUT" "self-check" "structured task-local log status=ready ignored → completion handshake (codex catch r2)"
run_stop_sid "$H" "$SID"
assert_not_contains "$HOOK_OUT" "block" "structured task-local log → same completion state allows on second Stop"
rm -rf "$H"

# Case U: SINGLE-LINE fingerprint scoped to tasks region — identical tasks, different log → SAME fp.
H="$(make_project)"; mkdir -p "$H/boards"
printf '%s' '{"owner":{"active":true,"session_id":"s"},"tasks":[{"id":"T1","status":"done","deps":[]}],"log":[{"id":"L1","status":"alpha"}]}' > "$H/boards/a.board.json"
printf '%s' '{"owner":{"active":true,"session_id":"s"},"tasks":[{"id":"T1","status":"done","deps":[]}],"log":[{"id":"L9","status":"omega"}]}' > "$H/boards/b.board.json"
assert_eq "$(fp_of "$H/boards/a.board.json")" "$(fp_of "$H/boards/b.board.json")" "single-line fingerprint scoped to tasks region (log excluded)"
rm -rf "$H"

# ─── H3: COMPLETION HANDSHAKE NAMES UNANSWERED blocked_on:"user" DECISIONS ─────────────────────────
# When the board is in a completion state (no ready/uncertain) AND carries one or more
# status=blocked, blocked_on:"user" tasks, the self-check handshake must additionally list those
# open decisions by title (or id). Fresh PROJECT_DIR + fresh SID per case → no sidecar yet → the
# first Stop always reaches the completion-state handshake (block), so the appended text is testable.

# Case X1 (H3): one blocked_on:user task WITH a title → reason names that title.
H="$(make_project)"; SID="sess-h3-title"
mkactive "$H" "b1" "{\"schema\":\"cc-master/v2\",\"goal\":\"g\",\"owner\":{\"active\":true,\"session_id\":\"$SID\"},\"tasks\":[{\"id\":\"T1\",\"status\":\"done\",\"deps\":[]},{\"id\":\"T2\",\"status\":\"blocked\",\"blocked_on\":\"user\",\"title\":\"pick the deploy region\",\"deps\":[]}]}"
run_stop_sid "$H" "$SID"
assert_contains "$HOOK_OUT" "block" "H3 one user decision → completion handshake block"
assert_contains "$HOOK_OUT" "self-check" "H3 one user decision → still the self-check handshake"
assert_contains "$HOOK_OUT" "Unanswered user decisions still on this board" "H3 one user decision → reason lists unanswered user decisions"
assert_contains "$HOOK_OUT" "pick the deploy region" "H3 one user decision → reason names the task title"
rm -rf "$H"

# Case X2 (H3): two blocked_on:user tasks WITH titles → both titles listed.
H="$(make_project)"; SID="sess-h3-two"
mkactive "$H" "b1" "{\"schema\":\"cc-master/v2\",\"goal\":\"g\",\"owner\":{\"active\":true,\"session_id\":\"$SID\"},\"tasks\":[{\"id\":\"T1\",\"status\":\"done\",\"deps\":[]},{\"id\":\"T2\",\"status\":\"blocked\",\"blocked_on\":\"user\",\"title\":\"approve the migration\",\"deps\":[]},{\"id\":\"T3\",\"status\":\"blocked\",\"blocked_on\":\"user\",\"title\":\"confirm the rollback plan\",\"deps\":[]}]}"
run_stop_sid "$H" "$SID"
assert_contains "$HOOK_OUT" "approve the migration" "H3 two user decisions → first title listed"
assert_contains "$HOOK_OUT" "confirm the rollback plan" "H3 two user decisions → second title listed"
rm -rf "$H"

# Case X3 (H3): blocked_on:user task WITHOUT a title → its id is listed instead.
H="$(make_project)"; SID="sess-h3-noti"
mkactive "$H" "b1" "{\"schema\":\"cc-master/v2\",\"goal\":\"g\",\"owner\":{\"active\":true,\"session_id\":\"$SID\"},\"tasks\":[{\"id\":\"T1\",\"status\":\"done\",\"deps\":[]},{\"id\":\"DECISION-9\",\"status\":\"blocked\",\"blocked_on\":\"user\",\"deps\":[]}]}"
run_stop_sid "$H" "$SID"
assert_contains "$HOOK_OUT" "Unanswered user decisions still on this board" "H3 titleless user decision → still lists unanswered decisions"
assert_contains "$HOOK_OUT" "DECISION-9" "H3 titleless user decision → falls back to task id"
rm -rf "$H"

# Case X4 (H3): completion state with NO blocked_on:user task → reason identical to status quo
#               (must NOT contain the H3 sentence). A task blocked on something else (or a non-user
#               blocked_on) must not trip it.
H="$(make_project)"; SID="sess-h3-none"
mkactive "$H" "b1" "{\"schema\":\"cc-master/v2\",\"goal\":\"g\",\"owner\":{\"active\":true,\"session_id\":\"$SID\"},\"tasks\":[{\"id\":\"T1\",\"status\":\"done\",\"deps\":[]},{\"id\":\"T2\",\"status\":\"blocked\",\"blocked_on\":\"T1\",\"deps\":[]},{\"id\":\"T3\",\"status\":\"in_flight\",\"deps\":[]}]}"
run_stop_sid "$H" "$SID"
assert_contains "$HOOK_OUT" "self-check" "H3 no user decision → still the self-check handshake"
assert_not_contains "$HOOK_OUT" "Unanswered user decisions" "H3 no user decision → reason matches status quo (no H3 sentence)"
rm -rf "$H"

# Case X5 (H3, format-agnostic): blocked_on:user with a task-local log/object must not pollute the
#               per-object scan — the title is still read from the task's OWN top-level fields, and a
#               nested log carrying its own "title"/"blocked_on" must not leak in.
H="$(make_project)"; SID="sess-h3-nested"
mkactive "$H" "b1" "{\"schema\":\"cc-master/v2\",\"goal\":\"g\",\"owner\":{\"active\":true,\"session_id\":\"$SID\"},\"tasks\":[{\"id\":\"T1\",\"status\":\"blocked\",\"blocked_on\":\"user\",\"title\":\"real top-level title\",\"deps\":[],\"log\":[{\"id\":\"L1\",\"title\":\"nested decoy\",\"blocked_on\":\"user\"}]}]}"
run_stop_sid "$H" "$SID"
assert_contains "$HOOK_OUT" "real top-level title" "H3 nested log → reads the task's own top-level title"
assert_not_contains "$HOOK_OUT" "nested decoy" "H3 nested log → nested log title does not leak into the list"
rm -rf "$H"

# Case X6 (codex catch): a task with stale `blocked_on:"user"` metadata that is ALREADY `status:"done"`
#               must NOT be listed as an unanswered user decision — an answered decision marked done
#               but still carrying its blocked_on:"user" tag would otherwise make the Stop handshake
#               re-warn forever. The predicate must require BOTH status:"blocked" AND blocked_on:"user"
#               (the `blocked(blocked_on:"user")` contract). A genuinely pending blocked task IS listed.
H="$(make_project)"; SID="sess-h3-stale"
mkactive "$H" "b1" "{\"schema\":\"cc-master/v2\",\"goal\":\"g\",\"owner\":{\"active\":true,\"session_id\":\"$SID\"},\"tasks\":[{\"id\":\"T1\",\"status\":\"done\",\"blocked_on\":\"user\",\"title\":\"already answered region pick\",\"deps\":[]},{\"id\":\"T2\",\"status\":\"blocked\",\"blocked_on\":\"user\",\"title\":\"genuinely pending approval\",\"deps\":[]}]}"
run_stop_sid "$H" "$SID"
assert_contains "$HOOK_OUT" "block" "H3 stale blocked_on → still completion handshake block"
assert_contains "$HOOK_OUT" "genuinely pending approval" "H3 stale blocked_on → genuinely blocked+user decision IS listed"
assert_not_contains "$HOOK_OUT" "already answered region pick" "H3 stale blocked_on → status:done task NOT listed (require status:blocked too)"
rm -rf "$H"

# ── 武装闸：active/session_id 只从 board 根的 owner 子对象读（CODEX7，破红线 6 修复回归用例）─────────
# 旧版 board_matches 用全文 grep 判 arming，会把归档板某个 flexible 载荷里的 `"active":true` 误读为 owner
# 的 active；head -1 取到的第一个 session_id 仍是 owner.session_id —— 若它 == 当前 sid，归档板被误判 armed，
# 已 /stop 归档的板 verify-board 仍会 block 住 stop。下面两例锁死「只从 owner 子对象读」。

# Case Y (CODEX7 回归)：归档板 owner.active:false、owner.session_id == 本 session sid，含一个 ready task
#          （若误判 armed 会触发 actionable block）+ log[] 嵌套对象塞 "active":true 与混淆 "session_id"。
#          owner 子对象本身 active:false → 必须 allow（dormant，不 block）。修前全文 grep 命中 → 误 block。
H="$(make_project)"; SID="sess-arch-stop"
mkactive "$H" "b1" "{\"schema\":\"cc-master/v2\",\"goal\":\"g\",\"owner\":{\"active\":false,\"session_id\":\"$SID\"},\"tasks\":[{\"id\":\"T1\",\"status\":\"ready\",\"deps\":[]}],\"log\":[{\"id\":\"L1\",\"snapshot\":{\"active\":true,\"session_id\":\"OTHER\"}}]}"
run_stop_sid "$H" "$SID"
assert_eq 0 "$HOOK_RC" "Y: 归档板含嵌套 active:true → rc 0"
assert_not_contains "$HOOK_OUT" "block" "Y: 归档板（owner.active:false）+ 嵌套 active:true → 休眠 allow（owner 子对象才算数，不 block stop）"
rm -rf "$H"

# Case Z (反向保活)：真 active 板（owner.active:true、owner.session_id == sid）含一个 ready task，某 task
#          嵌套 "active":false —— verify-board 仍照常 armed → ready 工作 → block。防过度修复。
H="$(make_project)"; SID="sess-real-stop"
mkactive "$H" "b1" "{\"schema\":\"cc-master/v2\",\"goal\":\"g\",\"owner\":{\"active\":true,\"session_id\":\"$SID\"},\"tasks\":[{\"id\":\"T1\",\"status\":\"ready\",\"deps\":[],\"meta\":{\"active\":false}}]}"
run_stop_sid "$H" "$SID"
assert_contains "$HOOK_OUT" "block" "Z: 真 active 板（owner.active:true）照常 armed → ready task → block stop"
rm -rf "$H"

# ── 非对称 degrade：blank-session 板（owner.session_id 空串）对非空 stdin sid 保持休眠（CODEX14 回退）──
# 上一轮（CODEX12）曾对称 degrade 收养空 board sid；本轮（CODEX14）回退：收养会武装任意不相关 session，破红线 6。
# 裁决（ADR-007 §2.3 / §4.5）：红线 6（非协商）优先于孤儿边缘 case。合法续跑因 resume/compaction 保留
# session_id、板带原 session_id 故照常匹配；异常 blank 板保持休眠（fail-safe），由显式 re-arm（重跑
# as-master-orchestrator → bootstrap 重盖 session_id）认领。「board sid 非空但 ≠ stdin sid」同样休眠（红线 6）。

# Case AA (CODEX14 回退：blank-session 板对非空 stdin sid 休眠)：active 板 owner.session_id:""（空串），含一个
#          ready task，stdin 带**非空** session_id。"" != "MINE" → 不武装 → 休眠 allow（不 block）。这正是红线 6
#          要的 fail-safe：blank 板不收养任意 session。
H="$(make_project)"; SID="sess-adopt-mine"
mkactive "$H" "b1" "{\"schema\":\"cc-master/v2\",\"goal\":\"g\",\"owner\":{\"active\":true,\"session_id\":\"\"},\"tasks\":[{\"id\":\"T1\",\"status\":\"ready\",\"deps\":[]}]}"
run_stop_sid "$H" "$SID"
assert_eq 0 "$HOOK_RC" "AA: blank-session 板 + 非空 stdin sid → rc 0"
assert_not_contains "$HOOK_OUT" "block" "AA: blank-session 板（owner.session_id:\"\"）对非空 stdin sid → 休眠 allow，不 block（CODEX14 回退，红线 6 fail-safe）"
rm -rf "$H"

# Case AB (红线 6 防线保活：board sid 非空且 ≠ stdin sid 仍休眠)：active 板 owner.session_id:"OTHER"
#          （非空），含一个 ready task，stdin sid "MINE"（不同）→ 必须休眠 allow（不 block）。证明对称
#          degrade **没有**退化成「任何 active 板即武装」—— 真跨会话污染防线（红线 6）原样保留。
H="$(make_project)"; SID="MINE"
mkactive "$H" "b1" '{"schema":"cc-master/v2","goal":"g","owner":{"active":true,"session_id":"OTHER"},"tasks":[{"id":"T1","status":"ready","deps":[]}]}'
run_stop_sid "$H" "$SID"
assert_eq 0 "$HOOK_RC" "AB: board sid 非空且 ≠ stdin sid → rc 0"
assert_not_contains "$HOOK_OUT" "block" "AB: board sid=OTHER（非空）≠ stdin sid=MINE → 仍休眠 allow（红线 6 防线未退化）"
rm -rf "$H"

# ─── D3 / ADR-012: ROLLUP-AWARE STOP GATE (parent container edge) ──────────────────────────────────
# verify-board now reads the pinned-waist `parent` edge: on a completion state, a `done` owner that
# still has a non-done child injects a NON-BLOCKING rollup-inconsistency reminder (path-ii, Q-N1 =
# soft reminder, not a hard block). Degrade: old boards with no `parent` keep the flat behavior. Red
# line 6: an unarmed session never injects it. The reminder rides the completion-state handshake.

# Case RU1 (D3): ARMED + done owner + NON-done child → completion handshake names the rollup
#                inconsistency (owner done, child still in flight). Still a block (the handshake),
#                exit code unchanged (rc 0 — block is emitted as JSON, hook exits 0).
H="$(make_project)"; SID="sess-rollup-bad"
mkactive "$H" "b1" "{\"schema\":\"cc-master/v2\",\"goal\":\"g\",\"owner\":{\"active\":true,\"session_id\":\"$SID\"},\"tasks\":[{\"id\":\"M1\",\"status\":\"done\",\"deps\":[],\"kind\":\"owner\"},{\"id\":\"M1.a\",\"status\":\"done\",\"deps\":[],\"parent\":\"M1\"},{\"id\":\"M1.b\",\"status\":\"in_flight\",\"deps\":[],\"parent\":\"M1\"}]}"
run_stop_sid "$H" "$SID"
assert_eq 0 "$HOOK_RC" "RU1 rollup violation → rc 0 (reminder is non-blocking JSON, hook exits 0)"
assert_contains "$HOOK_OUT" "block" "RU1 rollup violation → completion-state handshake block"
assert_contains "$HOOK_OUT" "Rollup inconsistency" "RU1 done owner + non-done child → rollup reminder injected"
assert_contains "$HOOK_OUT" "owner M1 is" "RU1 rollup reminder names the offending owner"
assert_contains "$HOOK_OUT" "child M1.b is" "RU1 rollup reminder names the non-done child"
rm -rf "$H"

# Case RU2 (D3): ARMED + done owner + ALL children done → NO rollup reminder (consistent rollup).
#                Still a completion handshake (self-check), just without the rollup sentence.
H="$(make_project)"; SID="sess-rollup-ok"
mkactive "$H" "b1" "{\"schema\":\"cc-master/v2\",\"goal\":\"g\",\"owner\":{\"active\":true,\"session_id\":\"$SID\"},\"tasks\":[{\"id\":\"M1\",\"status\":\"done\",\"deps\":[]},{\"id\":\"M1.a\",\"status\":\"done\",\"deps\":[],\"parent\":\"M1\"},{\"id\":\"M1.b\",\"status\":\"done\",\"deps\":[],\"parent\":\"M1\"}]}"
run_stop_sid "$H" "$SID"
assert_contains "$HOOK_OUT" "self-check" "RU2 done owner + all done children → still the self-check handshake"
assert_not_contains "$HOOK_OUT" "Rollup inconsistency" "RU2 done owner + all done children → NO rollup reminder (consistent)"
rm -rf "$H"

# Case RU3 (D3): the owner is NOT done (in_flight整合中) while a child is in_flight → NO rollup
#                violation (the gate only fires when the OWNER is `done` but a child is not — a
#                still-working owner is legitimate). Mirrors graph-core: statusOf(owner)!=='done' → skip.
H="$(make_project)"; SID="sess-rollup-owner-inflight"
mkactive "$H" "b1" "{\"schema\":\"cc-master/v2\",\"goal\":\"g\",\"owner\":{\"active\":true,\"session_id\":\"$SID\"},\"tasks\":[{\"id\":\"M1\",\"status\":\"in_flight\",\"deps\":[]},{\"id\":\"M1.b\",\"status\":\"in_flight\",\"deps\":[],\"parent\":\"M1\"}]}"
run_stop_sid "$H" "$SID"
assert_not_contains "$HOOK_OUT" "Rollup inconsistency" "RU3 owner in_flight (not done) + child in_flight → NO rollup reminder (owner not done)"
rm -rf "$H"

# Case RU4 (D3 DEGRADE): an OLD board with NO `parent` edges (all flat top-level tasks, one done one
#                in_flight) → degrades to flat behavior: no rollup reminder, no crash, the existing
#                completion-state self-check handshake still fires (block). Proves rollup never breaks
#                a pre-D3 board.
H="$(make_project)"; SID="sess-rollup-degrade"
mkactive "$H" "b1" "{\"schema\":\"cc-master/v2\",\"goal\":\"g\",\"owner\":{\"active\":true,\"session_id\":\"$SID\"},\"tasks\":[{\"id\":\"T1\",\"status\":\"done\",\"deps\":[]},{\"id\":\"T2\",\"status\":\"in_flight\",\"deps\":[]}]}"
run_stop_sid "$H" "$SID"
assert_eq 0 "$HOOK_RC" "RU4 degrade (no parent) → rc 0 (no crash)"
assert_contains "$HOOK_OUT" "block" "RU4 degrade (no parent) → existing completion handshake still blocks"
assert_contains "$HOOK_OUT" "self-check" "RU4 degrade (no parent) → existing self-check handshake preserved"
assert_not_contains "$HOOK_OUT" "Rollup inconsistency" "RU4 degrade (no parent) → no rollup reminder (flat behavior)"
rm -rf "$H"

# Case RU5 (D3 DEGRADE): a `parent` pointing at a NON-EXISTENT owner id → no violation (we only flag a
#                child against an owner that is BOTH a real task AND status:"done", exactly like
#                graph-core statusOf(owner)===undefined). Malformed parent never breaks the Stop gate.
H="$(make_project)"; SID="sess-rollup-dangling-parent"
mkactive "$H" "b1" "{\"schema\":\"cc-master/v2\",\"goal\":\"g\",\"owner\":{\"active\":true,\"session_id\":\"$SID\"},\"tasks\":[{\"id\":\"T1\",\"status\":\"done\",\"deps\":[]},{\"id\":\"T2\",\"status\":\"in_flight\",\"deps\":[],\"parent\":\"GHOST\"}]}"
run_stop_sid "$H" "$SID"
assert_eq 0 "$HOOK_RC" "RU5 dangling parent → rc 0 (no crash)"
assert_not_contains "$HOOK_OUT" "Rollup inconsistency" "RU5 parent → non-existent owner → no rollup violation (degrade)"
rm -rf "$H"

# Case RU6 (D3 RED LINE 6): UNARMED session (archived board, owner.active:false) with a clear rollup
#                violation (done owner + in_flight child) → hook stays DORMANT: allow, NO block, and
#                CRUCIALLY no rollup reminder is ever injected on an unarmed path.
H="$(make_project)"; SID="sess-rollup-unarmed"
mkactive "$H" "b1" "{\"schema\":\"cc-master/v2\",\"goal\":\"g\",\"owner\":{\"active\":false,\"session_id\":\"$SID\"},\"tasks\":[{\"id\":\"M1\",\"status\":\"done\",\"deps\":[]},{\"id\":\"M1.b\",\"status\":\"in_flight\",\"deps\":[],\"parent\":\"M1\"}]}"
run_stop_sid "$H" "$SID"
assert_eq 0 "$HOOK_RC" "RU6 unarmed (archived) → rc 0 (dormant)"
assert_not_contains "$HOOK_OUT" "block" "RU6 unarmed → dormant allow (no block)"
assert_not_contains "$HOOK_OUT" "Rollup inconsistency" "RU6 unarmed → NO rollup reminder on unarmed path (red line 6)"
rm -rf "$H"

# Case RU7 (D3 FINGERPRINT): folding `parent` into the fingerprint means a CHILD's status change
#                re-forces the self-check across Stops. Seed the sidecar with the fp of the
#                child-in_flight state, then flip the child to done → fingerprint differs → re-block.
H="$(make_project)"; SID="sess-rollup-fp"
mkactive "$H" "b1" "{\"schema\":\"cc-master/v2\",\"goal\":\"g\",\"owner\":{\"active\":true,\"session_id\":\"$SID\"},\"tasks\":[{\"id\":\"M1\",\"status\":\"done\",\"deps\":[]},{\"id\":\"M1.b\",\"status\":\"in_flight\",\"deps\":[],\"parent\":\"M1\"}]}"
printf '0 %s\n' "$(fp_of "$H/boards/b1.board.json")" > "$H/.$SID.stopcheck"   # seed: child-in_flight state handshook
# Flip the child in_flight → done: the parent-folded fingerprint must change → re-block the handshake.
mkactive "$H" "b1" "{\"schema\":\"cc-master/v2\",\"goal\":\"g\",\"owner\":{\"active\":true,\"session_id\":\"$SID\"},\"tasks\":[{\"id\":\"M1\",\"status\":\"done\",\"deps\":[]},{\"id\":\"M1.b\",\"status\":\"done\",\"deps\":[],\"parent\":\"M1\"}]}"
run_stop_sid "$H" "$SID"
assert_contains "$HOOK_OUT" "block" "RU7 child status flip (in_flight→done) → fingerprint changes (parent folded) → re-block handshake"
rm -rf "$H"

# Case RU8 (D3 FINGERPRINT graceful-degrade): a board with NO `parent` field must hash IDENTICALLY to
#                the pre-D3 (id|status|blocked_on) formula — no spurious handshake churn on the flat
#                majority. Verify fp_of (which now includes parent) equals the old formula on a no-parent
#                board.
H="$(make_project)"
mkactive "$H" "b1" '{"schema":"cc-master/v2","owner":{"active":true,"session_id":"s"},"tasks":[{"id":"T1","status":"done","deps":[]},{"id":"T2","status":"in_flight","deps":[]}]}'
PRE_D3_FP="$(tasks_region_t "$H/boards/b1.board.json" | grep -oE '"(id|status|blocked_on)"[[:space:]]*:[[:space:]]*"[^"]*"' | { printf 'watchdog_needed:1\n'; cat; } | cksum | awk '{print $1}')"
NOW_FP="$(fp_of "$H/boards/b1.board.json")"
assert_eq "$PRE_D3_FP" "$NOW_FP" "RU8 no-parent board → parent-folded fp == pre-D3 fp (graceful-degrade, no churn)"
rm -rf "$H"

finish
