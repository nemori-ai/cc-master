#!/usr/bin/env bash
# SessionStart hook (startup|resume|compact): re-establish the orchestrator ROLE after a fresh
# start / resume / compaction. Compaction can drop "I am an orchestrator" entirely — which the
# agent cannot re-inject for itself — so this hook does it from outside. It points the agent at
# its HOME and lists THIS session's active boards (with goals) but does NOT bind to a specific
# board: the agent re-identifies its own board by goal.
#
# ARMED GATE (session-scoped — the armed-hook discipline): this hook re-anchors ONLY when THIS
# session is armed — armed ⟺ home holds a *.board.json with owner.active:true AND owner.session_id
# == this session's stdin id (board_matches below). Previously it activated on ANY active board in
# home (home-scoped) and discarded stdin — so a brand-new session that never ran
# as-master-orchestrator got falsely re-anchored as an orchestrator just because some OTHER session
# left an active board behind (false-activation gap). It now reads the stdin session_id and gates on
# it. DEGRADED PATH: an empty sid (e.g. a compaction that drops session_id) falls back to matching
# any active board, preserving compaction-boundary robustness.
set -uo pipefail

# ── stdin → session_id (pure bash, no jq; same extraction as verify-board.sh) ───────────────────────
input="$(cat)"
sid="$(printf '%s' "$input" | sed -n 's/.*"session_id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)"

HOME_DIR="${CC_MASTER_HOME:-${CLAUDE_PROJECT_DIR:-$(pwd)}/.claude/cc-master}"

# ── board matching (the arming gate; mirrors verify-board.sh) ───────────────────────────────────────
# A board is "mine" when active AND (sid empty → degraded: any active board; else owner.session_id==sid).
board_matches() { # $1 = board path
  grep -qE '"active"[[:space:]]*:[[:space:]]*true' "$1" 2>/dev/null || return 1
  [ -z "$sid" ] && return 0
  # owner.session_id must equal $sid EXACTLY. Never splice $sid into a grep -E pattern: a session id
  # carrying regex metachars (., *, [, etc.) would otherwise match the wrong board. Extract the board's
  # session_id *value* with a fixed regex, then compare as a literal shell string.
  board_sid="$(grep -oE '"session_id"[[:space:]]*:[[:space:]]*"[^"]*"' "$1" 2>/dev/null \
               | sed -n 's/.*"session_id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)"
  [ "$board_sid" = "$sid" ]
}

# dangling_nodes BOARD — print, one per line, the "id" of every task object whose TOP-LEVEL "status"
# is `stale` or `escalated` (the unresolved nodes left over from a prior, un-reconciled plan update).
# PER-OBJECT scan (same string/escape/double-depth [ ] and { } awareness as verify-board.sh's
# pending_user_decisions / tasks_region) → FORMAT-AGNOSTIC: single-line and multi-line JSON behave
# identically. Only characters at the task-object top level (bracket depth 1 inside the tasks array,
# curly depth 1 inside the task) are buffered per object — nested flexible fields (a task-local "log"
# array, structured entries inside it) are dropped wholesale, so a log entry's stale/escalated
# status can neither masquerade as a task status nor inject a spurious id.
dangling_nodes() {
  awk '
    { s = s $0 "\n" }
    END {
      i = index(s, "\"tasks\""); if (!i) exit
      s = substr(s, i + 7)
      j = index(s, "["); if (!j) exit
      s = substr(s, j + 1)                 # start INSIDE the tasks array
      bd = 1; cd = 0; instr = 0; esc = 0; obj = ""
      n = length(s)
      for (k = 1; k <= n; k++) {
        ch = substr(s, k, 1)
        if (instr) {
          if (bd == 1 && cd == 1) obj = obj ch
          if (esc) esc = 0
          else if (ch == "\\") esc = 1
          else if (ch == "\"") instr = 0
          continue
        }
        if (ch == "\"") { instr = 1; if (bd == 1 && cd == 1) obj = obj ch; continue }
        if (ch == "[") { bd++; continue }
        if (ch == "]") { bd--; if (bd == 0) break; continue }
        if (ch == "{") { cd++; if (bd == 1 && cd == 1) obj = ""; continue }   # open a task object → fresh buffer
        if (ch == "}") {
          cd--
          if (bd == 1 && cd == 0) emit(obj)   # closed a task object → decide on its top-level fields
          continue
        }
        if (bd == 1 && cd == 1) obj = obj ch
      }
    }
    # emit OBJ — if OBJ has a top-level "status":"stale"|"escalated", print its "id".
    function emit(o,   id) {
      if (o !~ /"status"[ \t]*:[ \t]*"(stale|escalated)"/) return
      id = field(o, "id")
      if (id != "") print id
    }
    # field(O, NAME) — string value of top-level key NAME from object buffer O ("" if absent).
    function field(o, name,   re, m) {
      re = "\"" name "\"[ \t]*:[ \t]*\""
      if (match(o, re)) {
        m = substr(o, RSTART + RLENGTH)
        sub(/".*/, "", m)
        return m
      }
      return ""
    }' "$1" 2>/dev/null
}

# Collect THIS session's active boards (armed gate: board_matches) into a single-line listing
# "<name> [<goal>]", and gather the ids of any unresolved (stale/escalated) nodes across THEM (only)
# for the resume note (H4). Boards owned by other sessions are skipped — they are not this session's
# to re-anchor or reconcile.
listing=""
active_found=0
dangling_ids=""
for b in "$HOME_DIR"/*.board.json; do
  [ -e "$b" ] || continue
  board_matches "$b" || continue          # not this session's active board → ignore (arming gate)
  active_found=1
  goal="$(sed -n 's/.*"goal"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$b" | head -1)"
  [ -n "$goal" ] || goal="(goal not recorded yet)"
  listing="${listing} • $(basename "$b") [${goal}]"
  while IFS= read -r did; do
    [ -n "$did" ] || continue
    if [ -z "$dangling_ids" ]; then dangling_ids="$did"; else dangling_ids="$dangling_ids, $did"; fi
  done <<EOF
$(dangling_nodes "$b")
EOF
done

[ "$active_found" -eq 0 ] && exit 0   # no active orchestration → dormant, stay silent

ctx="You are a cc-master master orchestrator. Your orchestration board(s) live in ${HOME_DIR}. Active:${listing}. Re-read the board for the task you are working on (recognise it by its goal), then invoke the orchestrating-to-completion skill and continue the decision program. Do not restart work already done/verified; integrate any completed background results first."

# H4: name any unresolved (stale/escalated) nodes left from a prior, un-reconciled plan update so the
# transaction break is called out on resume. Empty → ctx stays byte-for-byte identical to before.
if [ -n "$dangling_ids" ]; then
  ctx="$ctx Note on resume: your board has unresolved node(s) needing attention — stale/escalated: ${dangling_ids}. Reconcile these (re-run stale, re-altitude escalated) before scheduling new work."
fi
printf '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":%s}}\n' "$(printf '%s' "$ctx" | sed 's/\\/\\\\/g; s/"/\\"/g; s/^/"/; s/$/"/')"
exit 0
