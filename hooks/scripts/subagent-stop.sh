#!/usr/bin/env bash
# SubagentStop hook (H6) — when a background sub-agent finishes, the orchestrator must remember to
# go integrate its result and verify INDEPENDENTLY at its own endpoint. That "remember to harvest the
# done work" is fragile prose (the first thing compaction drops). This hook turns it into a
# deterministic runtime notification: it reads THIS session's active board and, if any task is still
# in_flight (i.e. there is dispatched work whose result is now landing), injects a nudge to reconcile
# the board, integrate, and verify at the orchestrator's own endpoint — gate-green ≠ passed.
#
# Pure bash, NO jq/node/python (red line 1, ship-anywhere). Board is READ-ONLY: this hook never
# writes the board, and it needs no sidecar (a stateless notification — re-firing is harmless).
# Self-gates SILENT (exit 0, no output) on every not-applicable condition:
#   no matching active board (dormant / not this session's) → silent
#   active board but 0 in_flight tasks (nothing to integrate) → silent
set -uo pipefail

HOME_DIR="${CC_MASTER_HOME:-${CLAUDE_PROJECT_DIR:-$(pwd)}/.claude/cc-master}"

# ── stdin → session_id (pure bash, no jq) ─────────────────────────────────────────────────────────
input="$(cat)"
sid="$(printf '%s' "$input" | sed -n 's/.*"session_id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)"

# ── board matching = THE ARMING GATE (mirrors verify-board.sh) ──────────────────────────────────────
# A board is "mine" when active AND (sid empty → degraded: any active board; else owner.session_id==sid).
# This board_matches IS the arming gate: the hook stays dormant until THIS session is armed (owns an
# active board). No matched board → no in_flight scan, no nudge. (Unified armed-hook discipline.)
board_matches() { # $1 = board path
  grep -qE '"active"[[:space:]]*:[[:space:]]*true' "$1" 2>/dev/null || return 1
  [ -z "$sid" ] && return 0
  # owner.session_id must equal $sid EXACTLY. Never splice $sid into a grep -E pattern: a session id
  # carrying regex metachars (., *, [, etc.) would otherwise match the wrong board. Instead extract the
  # board's session_id *value* with a fixed regex, then compare as a literal shell string.
  board_sid="$(grep -oE '"session_id"[[:space:]]*:[[:space:]]*"[^"]*"' "$1" 2>/dev/null \
               | sed -n 's/.*"session_id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)"
  [ "$board_sid" = "$sid" ]
}

# tasks_region BOARD — print the TOP-LEVEL FIELD STREAM of each object in the "tasks" array, via a
# string- and escape-aware double-depth scan ([ ] and { }) in POSIX awk (a shell tool, not jq/node).
# FORMAT-AGNOSTIC: multi-line and compact single-line JSON behave identically. Only characters at task-
# object top level (bracket depth 1 inside the array, curly depth 1 inside the task) are emitted: nested
# flexible fields — a task-local "log" array, structured entries like {"id":"L1","status":"in_flight"}
# inside it — are dropped wholesale, so a log status can neither truncate the scan nor masquerade as a
# task status. (Lifted verbatim from verify-board.sh's region scan — shared narrow-waist contract.)
tasks_region() {
  awk '
    { s = s $0 "\n" }
    END {
      i = index(s, "\"tasks\""); if (!i) exit
      s = substr(s, i + 7)
      j = index(s, "["); if (!j) exit
      s = substr(s, j + 1)                 # start INSIDE the tasks array
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

# ── scan THIS session's active board(s); count in_flight tasks in the region (never the whole file) ─
in_flight_found=0
for b in "$HOME_DIR"/*.board.json; do
  [ -e "$b" ] || continue                 # no boards → unexpanded glob
  board_matches "$b" || continue          # archived / not this session's → ignore
  region="$(tasks_region "$b")"
  if printf '%s' "$region" | grep -qE '"status"[[:space:]]*:[[:space:]]*"in_flight"'; then
    in_flight_found=1
  fi
done

# Self-gate: no matching active board, or no in_flight task → nothing to integrate → stay silent.
[ "$in_flight_found" -eq 0 ] && exit 0

# ── inject additionalContext (non-blocking nudge; emit pattern lifted from reinject.sh) ────────────
ctx="cc-master: a background sub-agent just finished. Reconcile your board: find the in_flight task(s) it maps to, integrate the result, and verify independently at your own endpoint before marking it done — gate-green ≠ passed. Then re-run the decision program."
printf '{"hookSpecificOutput":{"hookEventName":"SubagentStop","additionalContext":%s}}\n' "$(printf '%s' "$ctx" | sed 's/\\/\\\\/g; s/"/\\"/g; s/^/"/; s/$/"/')"
exit 0
