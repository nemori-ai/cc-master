#!/usr/bin/env bash
# UserPromptSubmit hook: when the as-master-orchestrator command is invoked, deterministically
# create a NEW uniquely-named board in the configurable home, then inject its path + the
# orchestrator role so the agent knows which board is its own. This hook does NOT self-gate on a
# marker (it is the activator) — it gates on the dual sentinel (command name OR body comment, so
# it fires whether UserPromptSubmit sees the raw command or the expanded command body).
set -uo pipefail

stdin="$(cat)"
case "$stdin" in
  *cc-master:as-master-orchestrator*|*"cc-master:bootstrap:v1"*) : ;;
  *) exit 0 ;;   # unrelated prompt → silent no-op
esac

# Home is configurable (storage preference); default to the project's .claude/cc-master.
HOME_DIR="${CC_MASTER_HOME:-${CLAUDE_PROJECT_DIR:-$(pwd)}/.claude/cc-master}"
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
TEMPLATE="$PLUGIN_ROOT/skills/orchestrating-to-completion/assets/board.template.json"

mkdir -p "$HOME_DIR"
# Unique, time-sortable name: a UTC timestamp prefix + the pid keeps concurrent bootstraps
# distinct (the human-readable identity lives in the board's "goal" field). Each invocation
# starts a NEW orchestration; archive stale ones with /cc-master:stop.
BOARD="$HOME_DIR/$(date -u +%Y%m%dT%H%M%SZ)-$$.board.json"
if [ -f "$TEMPLATE" ]; then
  cp "$TEMPLATE" "$BOARD"
else
  printf '{"schema":"cc-master/v1","goal":"","owner":{"active":true,"session_id":"","heartbeat":""},"git":{"worktree":"","branch":""},"wip_limit":4,"phase":{"current":"","goal_condition":"","task_ids":[]},"tasks":[],"log":[]}\n' > "$BOARD"
fi

ctx="cc-master: a fresh orchestration board was created at ${BOARD}. You are now the master orchestrator for this task — remember that path, it is YOUR board. Decompose the goal into a dependency DAG and write tasks[] into that board file, set goal/owner/git, then invoke the orchestrating-to-completion skill and run the decision program."
printf '{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":%s}}\n' "$(printf '%s' "$ctx" | sed 's/\\/\\\\/g; s/"/\\"/g; s/^/"/; s/$/"/')"
exit 0
