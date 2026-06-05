#!/usr/bin/env bash
# Stop hook — the bootstrap backstop, and nothing else. It hard-blocks ONLY when the home holds an
# ACTIVE board (a *.board.json with owner.active:true) that has zero tasks — i.e. a bootstrap that
# was never filled with a DAG. This is the plugin's ONLY hard block. Every other state allows the
# stop; "don't idle-stop while actionable work remains" is soft decision-program discipline
# (Skill A), since a Stop hook cannot soft-nudge (only block or allow). It operates on the HOME
# directory and never binds to a specific session/board — the agent owns which board is its own.
set -uo pipefail
cat >/dev/null  # drain stdin

HOME_DIR="${CC_MASTER_HOME:-${CLAUDE_PROJECT_DIR:-$(pwd)}/.claude/cc-master}"

active_found=0
empty_active=0
for b in "$HOME_DIR"/*.board.json; do
  [ -e "$b" ] || continue                                                       # no boards → unexpanded glob
  grep -qE '"active"[[:space:]]*:[[:space:]]*true' "$b" 2>/dev/null || continue  # archived → ignore
  active_found=1
  # Count task objects by their "id" key (robust vs the word "status" appearing in log/note text).
  # Keep the fallback OUTSIDE the substitution: grep -c prints "0" AND exits 1 on zero matches, so
  # a `|| echo 0` inside $(...) would append a second "0" → "0\n0" → integer test crash.
  tc="$(grep -cE '"id"[[:space:]]*:' "$b" 2>/dev/null)" || tc=0
  [ "$tc" -eq 0 ] && empty_active=1
done

[ "$active_found" -eq 0 ] && exit 0   # no active orchestration → dormant → allow stop

if [ "$empty_active" -eq 1 ]; then
  reason='cc-master: an active board in your home has no tasks. Decompose the goal into a dependency DAG and write tasks[] into it (or archive it with /cc-master:stop) before ending.'
  esc="$(printf '%s' "$reason" | sed 's/\\/\\\\/g; s/"/\\"/g; s/^/"/; s/$/"/')"
  printf '{"decision":"block","reason":%s}\n' "$esc"
  exit 0
fi

exit 0   # active board(s) all carry tasks → allow stop (idle-stop avoidance is soft, in the decision program)
