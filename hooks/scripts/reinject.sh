#!/usr/bin/env bash
# SessionStart hook (startup|resume|compact): re-anchor the orchestrator role after compaction/resume.
set -uo pipefail
cat >/dev/null  # drain stdin

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"
BOARD_DIR="$PROJECT_DIR/.claude/cc-master"
MARKER="$BOARD_DIR/active"
BOARD="$BOARD_DIR/board.json"

[ -f "$MARKER" ] || exit 0   # self-gate

# Best-effort goal extraction (jq-free): pull the first "goal":"..." value.
goal=""
[ -f "$BOARD" ] && goal="$(sed -n 's/.*"goal"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$BOARD" | head -1)"
[ -n "$goal" ] || goal="(see board)"

ctx="You are the cc-master master orchestrator for: ${goal}. Your board is at .claude/cc-master/board.json — re-read it now to recover task state, then invoke the orchestrating-to-completion skill and continue the decision program. Do not restart work that is already done/verified; integrate any completed background results first."
printf '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":%s}}\n' "$(printf '%s' "$ctx" | sed 's/\\/\\\\/g; s/"/\\"/g' | sed 's/^/"/; s/$/"/')"
exit 0
