#!/usr/bin/env bash
# Stop hook — the goal-hook. It reads the Stop event's stdin JSON, filters this session's ACTIVE board
# (a *.board.json with owner.active:true AND owner.session_id == this session's id), and decides
# whether to let the agent stop. Pure bash, NO jq/node, ship-anywhere (Bedrock/Vertex/Foundry).
#
# A Stop hook cannot soft-nudge — only block (decision:block) or allow (exit 0). So it gates on the
# board's status enum distribution (it never reads the conversation or rebuilds the deps graph), and
# forces ONE self-check handshake before releasing a "completion" state. State for the handshake and
# the anti-deadlock fuse lives in a sidecar file the hook owns — the board stays the agent's single
# source of truth and is NEVER written here.
#
# Decision table (on THIS session's active board):
#   no matching active board   → allow (dormant)
#   empty (0 tasks)            → block (DAG never filled)
#   has ready / uncertain      → block (actionable work / output pending verification) + reset handshake
#   else (all in_flight/blocked/done/failed/escalated/stale) → self-check handshake
# Fuse: every block bumps block_streak; >= FUSE forces allow; every allow clears the sidecar.
set -uo pipefail

FUSE=5
HOME_DIR="${CC_MASTER_HOME:-${CLAUDE_PROJECT_DIR:-$(pwd)}/.claude/cc-master}"

# ── stdin → session_id (pure bash, no jq) ─────────────────────────────────────────────────────────
input="$(cat)"
sid="$(printf '%s' "$input" | sed -n 's/.*"session_id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)"

# Sidecar: one line "<block_streak> <selfcheck_done>". Empty sid → degraded full-home scan + a stable
# .nosession sidecar so the fuse still works.
sc_name=".nosession.stopcheck"
[ -n "$sid" ] && sc_name=".${sid}.stopcheck"
SIDECAR="$HOME_DIR/$sc_name"

block_streak=0; selfcheck_done=0
if [ -f "$SIDECAR" ]; then
  read -r block_streak selfcheck_done < "$SIDECAR" 2>/dev/null || true
  case "$block_streak"   in ''|*[!0-9]*) block_streak=0;;   esac
  case "$selfcheck_done" in ''|*[!0-9]*) selfcheck_done=0;; esac
fi

# ── board matching ────────────────────────────────────────────────────────────────────────────────
# A board is "mine" when active AND (sid empty → degraded: any active board; else owner.session_id==sid).
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

active_found=0; empty_active=0; actionable=0
for b in "$HOME_DIR"/*.board.json; do
  [ -e "$b" ] || continue                 # no boards → unexpanded glob
  board_matches "$b" || continue          # archived or not this session's → ignore
  active_found=1
  # Count task objects by their "id" key (robust vs the word "status" appearing in log/note text).
  # Keep the fallback OUTSIDE the substitution: grep -c prints "0" AND exits 1 on zero matches, so a
  # `|| echo 0` inside $(...) would append a second "0" → "0\n0" → integer test crash.
  tc="$(grep -cE '"id"[[:space:]]*:' "$b" 2>/dev/null)" || tc=0
  [ "$tc" -eq 0 ] && empty_active=1
  # Actionable = a ready or uncertain task remains (still-ready work / output pending verification).
  if grep -qE '"status"[[:space:]]*:[[:space:]]*"(ready|uncertain)"' "$b" 2>/dev/null; then
    actionable=1
  fi
done

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
  printf '%s %s\n' "$block_streak" "$selfcheck_done" > "$SIDECAR"
  esc="$(printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g; s/^/"/; s/$/"/')"
  printf '{"decision":"block","reason":%s}\n' "$esc"
  exit 0
}
allow() { rm -f "$SIDECAR"; exit 0; }   # allow → clear sidecar (streak → 0)

# No matching active board → dormant → allow.
[ "$active_found" -eq 0 ] && allow

# Empty active board → bootstrap never filled → block.
if [ "$empty_active" -eq 1 ]; then
  emit_block 'cc-master: an active board in your home has no tasks. Decompose the goal into a dependency DAG and write tasks[] into it (or archive it with /cc-master:stop) before ending.'
fi

# Actionable work (ready/uncertain) → block + reset the self-check handshake (new work appeared).
if [ "$actionable" -eq 1 ]; then
  selfcheck_done=0
  emit_block 'cc-master: this board still has a `ready` or `uncertain` task. A `ready` task can proceed now; an `uncertain` one has output awaiting verification. Resolve it (or mark it `blocked`/`escalated`) before stopping.'
fi

# Completion state (all in_flight/blocked/done/failed/escalated/stale) → self-check handshake.
if [ "$selfcheck_done" -eq 0 ]; then
  selfcheck_done=1   # record that we forced the self-check this round
  emit_block 'cc-master: before you stop, self-check against this board'\''s `goal`. (1) Is every point that needs the user surfaced / marked `blocked_on:"user"`? (2) Against the **original goal**, is every to-do actually done — including any NOT yet listed on the board? If something is missing, add it to `tasks[]` and keep going; only stop once the goal is truly met.'
fi

# selfcheck_done == 1 → agent was forced to self-check and still judges it complete → allow.
allow
