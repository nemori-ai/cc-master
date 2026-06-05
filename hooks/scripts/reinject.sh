#!/usr/bin/env bash
# SessionStart hook (startup|resume|compact): re-establish the orchestrator ROLE after a fresh
# start / resume / compaction. Compaction can drop "I am an orchestrator" entirely — which the
# agent cannot re-inject for itself — so this hook does it from outside. It points the agent at
# its HOME and lists the active boards (with goals) but does NOT bind to a specific board: the
# agent re-identifies its own board by goal. Self-gates on "is there any active board in home".
set -uo pipefail
cat >/dev/null  # drain stdin

HOME_DIR="${CC_MASTER_HOME:-${CLAUDE_PROJECT_DIR:-$(pwd)}/.claude/cc-master}"

# Collect active boards (owner.active:true) into a single-line listing "<name> [<goal>]".
listing=""
active_found=0
for b in "$HOME_DIR"/*.board.json; do
  [ -e "$b" ] || continue
  grep -qE '"active"[[:space:]]*:[[:space:]]*true' "$b" 2>/dev/null || continue
  active_found=1
  goal="$(sed -n 's/.*"goal"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$b" | head -1)"
  [ -n "$goal" ] || goal="(goal not recorded yet)"
  listing="${listing} • $(basename "$b") [${goal}]"
done

[ "$active_found" -eq 0 ] && exit 0   # no active orchestration → dormant, stay silent

ctx="You are a cc-master master orchestrator. Your orchestration board(s) live in ${HOME_DIR}. Active:${listing}. Re-read the board for the task you are working on (recognise it by its goal), then invoke the orchestrating-to-completion skill and continue the decision program. Do not restart work already done/verified; integrate any completed background results first."
printf '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":%s}}\n' "$(printf '%s' "$ctx" | sed 's/\\/\\\\/g; s/"/\\"/g; s/^/"/; s/$/"/')"
exit 0
