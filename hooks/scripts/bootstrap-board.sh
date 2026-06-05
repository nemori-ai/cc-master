#!/usr/bin/env bash
# UserPromptSubmit hook: when the as-master-orchestrator command is invoked, deterministically
# create the board skeleton + active marker, then inject context telling the agent to fill the DAG.
# Self-gating note: this hook is the ONE that activates the plugin, so it does NOT gate on the marker.
set -uo pipefail

stdin="$(cat)"
# Dual-sentinel: match either the raw command name OR the expanded-body comment (we don't know which we see).
case "$stdin" in
  *cc-master:as-master-orchestrator*|*"cc-master:bootstrap:v1"*) : ;;
  *) exit 0 ;;   # unrelated prompt → silent no-op
esac

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
BOARD_DIR="$PROJECT_DIR/.claude/cc-master"
BOARD="$BOARD_DIR/board.json"
MARKER="$BOARD_DIR/active"
TEMPLATE="$PLUGIN_ROOT/skills/orchestrating-to-completion/assets/board.template.json"

mkdir -p "$BOARD_DIR"
# Idempotent: never clobber an existing active board.
if [ ! -f "$BOARD" ]; then
  if [ -f "$TEMPLATE" ]; then cp "$TEMPLATE" "$BOARD"; else
    printf '{"schema":"cc-master/v1","goal":"","owner":{"active":true,"session_id":"","heartbeat":""},"git":{"worktree":"","branch":""},"wip_limit":4,"tasks":[],"log":[]}\n' > "$BOARD"
  fi
fi
touch "$MARKER"

# Inject context (UserPromptSubmit additionalContext form). The agent fills goal + DAG.
ctx='cc-master board is ready at .claude/cc-master/board.json. You are now the master orchestrator. Decompose the goal into a dependency DAG and write the tasks[] into the board, then invoke the orchestrating-to-completion skill and run the decision program.'
printf '{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":%s}}\n' "$(printf '%s' "$ctx" | sed 's/\\/\\\\/g; s/"/\\"/g' | sed 's/^/"/; s/$/"/')"
exit 0
