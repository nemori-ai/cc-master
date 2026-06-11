#!/usr/bin/env bash
# PostToolBatch hook — WIP soft-warning (H5, design 2026-06-11 §5.1). After a batch of parallel tool
# calls is fully parsed, this hook reads THIS session's ACTIVE board, counts in_flight tasks (N) and
# the board's top-level flexible `wip_limit` field (M). If N > M it injects a NON-BLOCKING
# additionalContext warning ("don't add more parallel work next round, defer high-float"). It NEVER
# blocks — parallel freedom is preserved; this only nudges (lens 5 ~75% utilization). Pure bash, NO
# jq/node, ship-anywhere (Bedrock/Vertex/Foundry).
#
# Self-gating (silent exit 0, no warning) on any of:
#   - no matching active board for this session (dormant)
#   - board has no `wip_limit` field, or it is non-numeric (graceful degradation — no threshold, no warn)
#   - N <= M (WIP within cap)
# It is READ-ONLY on the board, owns no sidecar, and emits ONLY additionalContext — never decision:block.
set -uo pipefail

HOME_DIR="${CC_MASTER_HOME:-${CLAUDE_PROJECT_DIR:-$(pwd)}/.claude/cc-master}"

# ── stdin → session_id (pure bash, no jq) ─────────────────────────────────────────────────────────
input="$(cat)"
sid="$(printf '%s' "$input" | sed -n 's/.*"session_id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)"

# ── board matching = THE ARMING GATE ────────────────────────────────────────────────────────────────
# A board is "mine" when active AND (sid empty → degraded: any active board; else owner.session_id==sid).
# This board_matches IS the arming gate: the hook stays dormant (no WIP warning) until THIS session is
# armed (owns an active board). (Unified armed-hook discipline — same gate across the cc-master hooks.)
# Mirrors verify-board.sh: never splice $sid into a grep -E pattern (regex metachars would mis-match);
# extract the board's session_id value with a fixed regex, then compare as a literal shell string.
board_matches() { # $1 = board path
  grep -qE '"active"[[:space:]]*:[[:space:]]*true' "$1" 2>/dev/null || return 1
  [ -z "$sid" ] && return 0
  board_sid="$(grep -oE '"session_id"[[:space:]]*:[[:space:]]*"[^"]*"' "$1" 2>/dev/null \
               | sed -n 's/.*"session_id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)"
  [ "$board_sid" = "$sid" ]
}

# board_root_stream BOARD — print the BOARD ROOT OBJECT's TOP-LEVEL FIELD STREAM only, via a string-
# and escape-aware depth scan ([ ] and { }) in POSIX awk. The board file is one root object; this emits
# only characters at root depth (curly depth 1, bracket depth 0) — every value nested inside an array
# (tasks[], log[], deps[]) or sub-object (owner{}) is dropped wholesale. FORMAT-AGNOSTIC: single-line
# and multi-line JSON behave identically. Used so a `wip_limit` cap is read ONLY from the board's
# top-level field — a `"wip_limit":N` buried in an agent-shaped task/log payload can never masquerade as
# the real cap (codex round-2 finding). Mirrors verify-board.sh's region/per-object isolation.
board_root_stream() {
  awk '
    { s = s $0 "\n" }
    END {
      n = length(s)
      bd = 0; cd = 0; instr = 0; esc = 0; out = ""
      for (k = 1; k <= n; k++) {
        ch = substr(s, k, 1)
        if (instr) {
          if (bd == 0 && cd == 1) out = out ch
          if (esc) esc = 0
          else if (ch == "\\") esc = 1
          else if (ch == "\"") instr = 0
          continue
        }
        if (ch == "\"") { instr = 1; if (bd == 0 && cd == 1) out = out ch; continue }
        if (ch == "[") { bd++; continue }
        if (ch == "]") { if (bd > 0) bd--; continue }
        if (ch == "{") { cd++; continue }
        if (ch == "}") { if (cd > 0) cd--; continue }
        if (bd == 0 && cd == 1) out = out ch
      }
      printf "%s", out
    }' "$1" 2>/dev/null
}

# tasks_region BOARD — print the TOP-LEVEL FIELD STREAM of each object in the "tasks" array via a
# string- and escape-aware double-depth scan ([ ] and { }) in POSIX awk. FORMAT-AGNOSTIC: single-line
# and multi-line JSON behave identically. Nested flexible fields (a task-local "log" array, structured
# entries like {"id":"L1","status":"ready"} inside it) are dropped wholesale, so they can neither
# truncate the scan nor masquerade as task id/status. (Copied verbatim from verify-board.sh — the
# narrow-waist-safe way to count task state without jq.)
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

# ── find this session's active board + count in_flight + read wip_limit ────────────────────────────
in_flight=0; wip_limit=""; matched=0
for b in "$HOME_DIR"/*.board.json; do
  [ -e "$b" ] || continue                 # no boards → unexpanded glob
  board_matches "$b" || continue          # archived or not this session's → ignore
  matched=1
  region="$(tasks_region "$b")"
  # Count in_flight tasks inside the tasks REGION only (log entries can't masquerade as task state).
  # Use `grep -oE | grep -c` (NOT a bare `grep -c`): the region is emitted as a SINGLE LINE, so a
  # line-counting `grep -c` would return 1 regardless of how many in_flight tasks there are. `grep -o`
  # prints one match per line first, so the second `grep -c` then counts OCCURRENCES. Keep the `|| n=0`
  # fallback OUTSIDE the substitution: grep prints "0" AND exits 1 on zero matches, so a `|| echo 0`
  # inside $(...) would append a second "0" → "0\n0" → integer-test crash (verify-board.sh caveat).
  # Accumulate across all of this session's active boards.
  n="$(printf '%s' "$region" | grep -oE '"status"[[:space:]]*:[[:space:]]*"in_flight"' | grep -c '')" || n=0
  in_flight=$((in_flight + n))
  # wip_limit: a board ROOT top-level flexible integer field. Take the FIRST board that carries one.
  # Read it from the board-root field stream ONLY (board_root_stream above) so a `"wip_limit":N` buried
  # in an agent-shaped task/log payload can never be mistaken for the cap — only the board's own
  # top-level field counts (narrow-waist scope; codex round-2 finding).
  if [ -z "$wip_limit" ]; then
    wl="$(board_root_stream "$b" \
          | grep -oE '"wip_limit"[[:space:]]*:[[:space:]]*[0-9]+' 2>/dev/null \
          | sed -n 's/.*"wip_limit"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p' | head -1)"
    [ -n "$wl" ] && wip_limit="$wl"
  fi
done

# ── self-gate ──────────────────────────────────────────────────────────────────────────────────────
[ "$matched" -eq 0 ] && exit 0                          # no active board for this session → dormant
case "$wip_limit" in ''|*[!0-9]*) exit 0;; esac         # no/non-numeric wip_limit → graceful degrade
[ "$in_flight" -le "$wip_limit" ] && exit 0             # WIP within cap → nothing to warn

# ── over-cap → inject NON-BLOCKING additionalContext warning (never decision:block) ────────────────
warn="cc-master: WIP is at/over the cap (${in_flight} in_flight, wip_limit ${wip_limit}). Don't add more parallel work next round — consider deferring high-float tasks to keep ~75% utilization (lens 5). This is a soft warning, not a block."
esc="$(printf '%s' "$warn" | sed 's/\\/\\\\/g; s/"/\\"/g; s/^/"/; s/$/"/')"
printf '{"hookSpecificOutput":{"hookEventName":"PostToolBatch","additionalContext":%s}}\n' "$esc"
exit 0
