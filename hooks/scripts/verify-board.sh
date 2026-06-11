#!/usr/bin/env bash
# Stop hook — the goal-hook. It reads the Stop event's stdin JSON, filters this session's ACTIVE board
# (a *.board.json with owner.active:true AND owner.session_id == this session's id), and decides
# whether to let the agent stop. Pure bash, NO jq/node, ship-anywhere (Bedrock/Vertex/Foundry).
#
# A Stop hook cannot soft-nudge — only block (decision:block) or allow (exit 0). So it gates on the
# board's status enum distribution (it never reads the conversation or rebuilds the deps graph), and
# forces ONE self-check handshake per DISTINCT completion state before releasing it. State for the
# handshake and the anti-deadlock fuse lives in a sidecar file the hook owns — the board stays the
# agent's single source of truth and is NEVER written here.
#
# Decision table (on THIS session's active board):
#   no matching active board   → allow (dormant)
#   empty (0 tasks)            → block (DAG never filled)
#   has ready / uncertain      → block (actionable work / output pending verification) + reset handshake
#   else (all in_flight/blocked/done/failed/escalated/stale) → fingerprint-keyed self-check handshake
# Handshake key: a fingerprint of the status multiset. If the current completion state was already
# handshook (fp unchanged), allow — DON'T re-ask. Only a CHANGED completion state re-forces the
# self-check. This stops the same board state being re-self-checked over a long background wait.
# Fuse: every block bumps block_streak; >= FUSE forces allow; every allow clears the sidecar.
set -uo pipefail

FUSE=5
HOME_DIR="${CC_MASTER_HOME:-${CLAUDE_PROJECT_DIR:-$(pwd)}/.claude/cc-master}"

# ── stdin → session_id (pure bash, no jq) ─────────────────────────────────────────────────────────
input="$(cat)"
sid="$(printf '%s' "$input" | sed -n 's/.*"session_id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)"

# Sidecar: one line "<block_streak> <last_handshook_fp>". last_handshook_fp is the status-multiset
# fingerprint we last forced a self-check on ("-" = none yet). Empty sid → degraded full-home scan +
# a stable .nosession sidecar so the fuse still works.
sc_name=".nosession.stopcheck"
[ -n "$sid" ] && sc_name=".${sid}.stopcheck"
SIDECAR="$HOME_DIR/$sc_name"

block_streak=0; last_handshook_fp="-"
if [ -f "$SIDECAR" ]; then
  read -r block_streak last_handshook_fp < "$SIDECAR" 2>/dev/null || true
  case "$block_streak"      in ''|*[!0-9]*) block_streak=0;;       esac
  case "$last_handshook_fp" in '') last_handshook_fp="-";; esac
fi

# ── board matching = THE ARMING GATE ────────────────────────────────────────────────────────────────
# A board is "mine" when active AND (sid empty → degraded: any active board; else owner.session_id==sid).
# This board_matches IS this hook's arming gate: every cc-master hook stays dormant until THIS session
# is armed (an active board it owns), and only a matched board drives any behavior below. (Unified
# armed-hook discipline — same gate in reinject.sh / posttool-batch.sh and the node
# usage-pacing.js; bootstrap-board.sh is the ARM action and is the sole gate-exempt hook.)
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
# string- and escape-aware double-depth scan ([ ] and { }) in POSIX awk (a shell tool, like the
# cksum|awk below — NOT a jq/node runtime). FORMAT-AGNOSTIC: multi-line and compact single-line
# JSON behave identically — no per-line layout assumption. Only characters at task-object top level
# (bracket depth 1 inside the array, curly depth 1 inside the task) are emitted: nested flexible
# fields — a task-local "log" array, structured entries like {"id":"L1","status":"ready"} inside it
# (codex review catches, rounds 1+2) — are dropped wholesale, so they can neither truncate the scan
# nor masquerade as task id/status/blocked_on state. Sole remaining caveat: the first quoted
# literal `"tasks"` token in the file must be the tasks key itself (true for the pinned waist;
# goal/log prose never needs that exact quoted token).
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

# pending_user_decisions BOARD — print, one per line, the human label of every task object that is
# GENUINELY parked on the user: its TOP-LEVEL fields carry BOTH `"status":"blocked"` AND
# `"blocked_on":"user"` (whitespace-tolerant) — the `blocked(blocked_on:"user")` contract. Requiring
# status:"blocked" (not just blocked_on) excludes ANSWERED decisions: a task already `status:"done"`
# that still carries stale `blocked_on:"user"` metadata is no longer pending, so it is not re-warned.
# Label = its "title" if present, else its "id". This is a PER-OBJECT scan (tasks_region above flattens every object's fields into one
# stream and so cannot bind a title back to the object whose blocked_on it belongs to). Same
# string/escape/double-depth ([ ] and { }) awareness as tasks_region, so it is FORMAT-AGNOSTIC:
# single-line and multi-line JSON behave identically. Only characters at the task-object top level
# (bracket depth 1 inside the tasks array, curly depth 1 inside the task) are buffered per object —
# nested flexible fields (a task-local "log" array, structured entries inside it) are dropped
# wholesale, so they can neither inject a spurious blocked_on:user nor masquerade as a title/id.
pending_user_decisions() {
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
    # emit OBJ — list OBJ as an unanswered user decision ONLY if it is genuinely parked on the user:
    # top-level status MUST be "blocked" AND blocked_on MUST be "user" (the blocked(blocked_on:"user")
    # contract). A task already status:"done" (etc.) that still carries stale blocked_on:"user"
    # metadata is an ANSWERED decision — excluding it stops the Stop handshake re-warning on it forever.
    # Read both fields from this object OWN top-level fields via field() (per-object, nested log cannot leak).
    function emit(o,   lbl) {
      if (field(o, "status") != "blocked") return
      if (field(o, "blocked_on") != "user") return
      lbl = field(o, "title")
      if (lbl == "") lbl = field(o, "id")
      if (lbl != "") print lbl
    }
    # field(O, NAME) — extract the string value of top-level key NAME from object buffer O ("" if absent).
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

active_found=0; empty_active=0; actionable=0
matched_boards=""                          # newline-separated paths of THIS session's active boards
for b in "$HOME_DIR"/*.board.json; do
  [ -e "$b" ] || continue                 # no boards → unexpanded glob
  board_matches "$b" || continue          # archived or not this session's → ignore
  active_found=1
  matched_boards="$matched_boards$b
"
  # All detection below is scoped to the tasks REGION, never the whole file — log/owner fields can
  # then never masquerade as tasks, regardless of how the JSON is line-wrapped.
  region="$(tasks_region "$b")"
  # Count task objects by their "id" key inside the region. Keep the fallback OUTSIDE the
  # substitution: grep -c prints "0" AND exits 1 on zero matches, so a `|| echo 0` inside $(...)
  # would append a second "0" → "0\n0" → integer test crash.
  tc="$(printf '%s' "$region" | grep -cE '"id"[[:space:]]*:')" || tc=0
  [ "$tc" -eq 0 ] && empty_active=1
  # Actionable = a ready or uncertain TASK remains (log entries excluded by the region scope).
  if printf '%s' "$region" | grep -qE '"status"[[:space:]]*:[[:space:]]*"(ready|uncertain)"'; then
    actionable=1
  fi
done

# Fingerprint of THIS session's matched boards' completion state (pure bash, no jq). cksum over the
# per-task id+status+blocked_on triples IN FILE ORDER (NOT sorted) → the digest binds each id to its
# status, so swapping two tasks' statuses or changing a task's blocked_on yields a DIFFERENT
# fingerprint and re-forces the self-check (Finding #21). Status-multiset-only hashing missed those.
# SCOPING (Finding #22 + format-agnostic rework): only the tasks REGION is fingerprinted (see
# tasks_region above), so audit-log prose or other non-task fields can never look like a changed
# completion state — and a log append between Stops never re-forces a handshake. Works identically
# on single-line and multi-line JSON; no per-line layout assumption remains.
status_fingerprint() {
  printf '%s' "$matched_boards" | while IFS= read -r bp; do
    [ -n "$bp" ] && tasks_region "$bp" \
      | grep -oE '"(id|status|blocked_on)"[[:space:]]*:[[:space:]]*"[^"]*"'
  done | cksum | awk '{print $1}'
}

# ── decision ──────────────────────────────────────────────────────────────────────────────────────
emit_block() { # $1 = reason text — bump streak, fuse-check, write sidecar, print decision or force-allow
  block_streak=$((block_streak+1))
  if [ "$block_streak" -ge "$FUSE" ]; then
    # Fuse tripped: force allow + warning, then clear the sidecar (streak resets).
    warn="cc-master: fuse tripped — blocked $block_streak times in a row. Releasing the stop. If you are stuck, check the board for a \`ready\` task that cannot actually proceed (mark it \`blocked\`/\`escalated\`) before continuing."
    esc="$(printf '%s' "$warn" | sed 's/\\/\\\\/g; s/"/\\"/g; s/^/"/; s/$/"/')"
    rm -f "$SIDECAR"
    printf '{"reason":%s}\n' "$esc"   # no decision:block → not a block; agent stops with a warning shown
    exit 0
  fi
  # Atomic write (tmp + mv): a concurrent Stop never observes a torn sidecar.
  printf '%s %s\n' "$block_streak" "$last_handshook_fp" > "$SIDECAR.tmp.$$" && mv -f "$SIDECAR.tmp.$$" "$SIDECAR"
  esc="$(printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g; s/^/"/; s/$/"/')"
  printf '{"decision":"block","reason":%s}\n' "$esc"
  exit 0
}
allow() { rm -f "$SIDECAR"; exit 0; }   # allow → clear sidecar (streak → 0)
# allow_handshook_fp — allow, but KEEP the handshook fingerprint so the SAME completion state keeps
# allowing on every subsequent Stop (it has already been self-checked). Streak resets to 0; only a
# CHANGED fingerprint (or actionable work, which writes "-") will re-force a self-check.
allow_handshook_fp() { printf '0 %s\n' "$last_handshook_fp" > "$SIDECAR.tmp.$$" && mv -f "$SIDECAR.tmp.$$" "$SIDECAR"; exit 0; }

# No matching active board → dormant → allow.
[ "$active_found" -eq 0 ] && allow

# Empty active board → bootstrap never filled → block.
if [ "$empty_active" -eq 1 ]; then
  emit_block 'cc-master: an active board in your home has no tasks. Decompose the goal into a dependency DAG and write tasks[] into it (or archive it with /cc-master:stop) before ending.'
fi

# Actionable work (ready/uncertain) → block. This is NOT a completion-state handshake, so it carries
# no fingerprint: reset last_handshook_fp to "-" so the NEXT completion state must self-check anew.
if [ "$actionable" -eq 1 ]; then
  last_handshook_fp="-"
  emit_block 'cc-master: this board still has a `ready` or `uncertain` task. A `ready` task can proceed now; an `uncertain` one has output awaiting verification. Resolve it (or mark it `blocked`/`escalated`) before stopping.'
fi

# Completion state (all in_flight/blocked/done/failed/escalated/stale) → fingerprint-keyed handshake.
# If THIS exact completion state was already handshook (fp unchanged), allow — don't re-ask. Only a
# changed completion state re-forces the self-check. (Fixes: same board state re-self-checked on a
# long background wait, since every allow used to zero the handshake flag.)
fp_now="$(status_fingerprint)"
if [ "$last_handshook_fp" = "$fp_now" ]; then
  allow_handshook_fp   # this completion-state fingerprint was already handshook → allow + KEEP fp
fi
# New (or changed) completion state → record the fingerprint we are handshaking on, then block.
last_handshook_fp="$fp_now"
handshake_reason='cc-master: before you stop, self-check against this board'\''s `goal`. (1) Is every point that needs the user surfaced / marked `blocked_on:"user"`? (2) Against the **original goal**, is every to-do actually done — including any NOT yet listed on the board? If something is missing, add it to `tasks[]` and keep going; only stop once the goal is truly met.'
# H3: if any task on a matched board is parked on the user (status blocked, `blocked_on:"user"`),
# name those open decisions in the handshake so the agent cannot silently exit on an unanswered one.
# Collect the human label (title, else id) of each across all of THIS session's matched boards.
pending_list=""
while IFS= read -r bp; do
  [ -n "$bp" ] || continue
  pending_list="$pending_list$(pending_user_decisions "$bp")
"
done <<EOF
$matched_boards
EOF
# Join the non-empty labels with "; " (pure bash; preserves file order, dedup not needed for naming).
pending_joined=""
while IFS= read -r lbl; do
  [ -n "$lbl" ] || continue
  if [ -z "$pending_joined" ]; then pending_joined="$lbl"; else pending_joined="$pending_joined; $lbl"; fi
done <<EOF
$pending_list
EOF
if [ -n "$pending_joined" ]; then
  handshake_reason="$handshake_reason Unanswered user decisions still on this board: $pending_joined. Confirm each is genuinely still pending (or resolve it) before you stop — don't silently exit on an open user decision."
fi
emit_block "$handshake_reason"
