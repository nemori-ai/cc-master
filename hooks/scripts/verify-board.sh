#!/usr/bin/env bash
# Stop hook: backstop the bootstrap guarantee and nudge against abandoning actionable work.
# Soft by design: the ONLY hard block is "board missing/invalid right after bootstrap".
# Legitimate waiting (all tasks in_flight/blocked) is NEVER blocked (镜头4).
set -uo pipefail
cat >/dev/null  # drain stdin

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"
BOARD_DIR="$PROJECT_DIR/.claude/cc-master"
MARKER="$BOARD_DIR/active"
BOARD="$BOARD_DIR/board.json"

[ -f "$MARKER" ] || exit 0   # self-gate: plugin dormant

emit_block() { # $1 reason
  printf '{"decision":"block","reason":%s}\n' "$(printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g' | sed 's/^/"/; s/$/"/')"
  exit 0
}

# Bootstrap backstop: active marker but no board, or a board with zero tasks → hard block.
task_count=0
[ -f "$BOARD" ] && task_count="$(grep -cE '"status"[[:space:]]*:' "$BOARD" 2>/dev/null || echo 0)"
if [ ! -f "$BOARD" ] || [ "$task_count" -eq 0 ]; then
  emit_block 'cc-master board is active but has no tasks. Decompose the goal into a dependency DAG and write tasks[] into .claude/cc-master/board.json before ending.'
fi

# Permissive nudge: a ready (actionable, un-dispatched) task remains.
if grep -qE '"status"[[:space:]]*:[[:space:]]*"ready"' "$BOARD" 2>/dev/null; then
  emit_block 'You still have ready (actionable) tasks on the board. Run the decision program: dispatch them within the WIP limit, surface any user-decisions, or pick legitimate fill-work. If you have genuinely confirmed every remaining path is waiting on in-flight work or the user, end again to proceed.'
fi

exit 0   # all remaining work is in_flight/blocked/done → legitimate waiting, allow stop
