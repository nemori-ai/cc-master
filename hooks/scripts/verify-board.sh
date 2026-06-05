#!/usr/bin/env bash
# Stop hook — the bootstrap backstop, and nothing else. It hard-blocks ONLY when the board is
# active (marker present) but missing or has zero tasks, i.e. the agent tried to end before
# decomposing the goal into a DAG. This is the plugin's ONLY hard block. Every other state
# (ready / in_flight / blocked / done) is ALLOWED to stop — "don't idle-stop while actionable
# work remains" is SOFT decision-program discipline (Skill A), not a hook block, per the design
# rule "hooks 软推, except the bootstrap guarantee".
set -uo pipefail
cat >/dev/null  # drain stdin

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"
BOARD_DIR="$PROJECT_DIR/.claude/cc-master"
MARKER="$BOARD_DIR/active"
BOARD="$BOARD_DIR/board.json"

[ -f "$MARKER" ] || exit 0   # self-gate: plugin dormant

# Count task objects by their "id" key. Robust against the words "status"/etc. appearing in the
# board's log/note text: a bare quoted "id": key only appears once per task ("session_id" and
# friends do not match). Keep the `|| fallback` OUTSIDE $(...): `grep -c` prints "0" AND exits 1
# on zero matches, so a `|| echo 0` *inside* the substitution appends a second "0" -> "0\n0" ->
# the integer test errors and the backstop silently fails. (Both hazards caught by dogfood review.)
task_count=0
if [ -f "$BOARD" ]; then
  task_count="$(grep -cE '"id"[[:space:]]*:' "$BOARD" 2>/dev/null)" || task_count=0
fi

if [ ! -f "$BOARD" ] || [ "$task_count" -eq 0 ]; then
  reason='cc-master board is active but has no tasks. Decompose the goal into a dependency DAG and write tasks[] into .claude/cc-master/board.json before ending.'
  esc="$(printf '%s' "$reason" | sed 's/\\/\\\\/g; s/"/\\"/g; s/^/"/; s/$/"/')"
  printf '{"decision":"block","reason":%s}\n' "$esc"
  exit 0
fi

exit 0   # board has tasks -> allow stop (idle-stop avoidance is soft, lives in the decision program)
