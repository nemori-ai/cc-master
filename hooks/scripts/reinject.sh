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
# Also surface the current self-driving phase (board.phase.current / phase.goal_condition) so the
# agent can re-recognise which segment it is mid-flight on after a compaction. /goal stays alive
# across compaction but the hook cannot read goal state, so we only remind the agent to self-check.
listing=""
phase_note=""
active_found=0
for b in "$HOME_DIR"/*.board.json; do
  [ -e "$b" ] || continue
  grep -qE '"active"[[:space:]]*:[[:space:]]*true' "$b" 2>/dev/null || continue
  active_found=1
  goal="$(sed -n 's/.*"goal"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$b" | head -1)"
  [ -n "$goal" ] || goal="(goal not recorded yet)"
  listing="${listing} • $(basename "$b") [${goal}]"
  # Anchor extraction to the phase OBJECT: flatten newlines, then carve out "phase":{ ... } (the
  # phase edge is flat — task_ids is its only array and carries no "}"), and pull current /
  # goal_condition from WITHIN it. This stops a stray "current"/"goal_condition" key on a task or
  # log line from fabricating a phase, and lets a multi-line board still match. (goal_condition must
  # be plain text with no literal '"' or '}' — see references/board.md; pure-bash extraction cannot
  # un-escape, so those characters are reserved.)
  phase_obj="$(tr -d '\n' < "$b" | sed -n 's/.*"phase"[[:space:]]*:[[:space:]]*{\([^}]*\)}.*/\1/p')"
  ph_cur="$(printf '%s' "$phase_obj" | sed -n 's/.*"current"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
  ph_cond="$(printf '%s' "$phase_obj" | sed -n 's/.*"goal_condition"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
  if [ -n "$ph_cur" ] || [ -n "$ph_cond" ]; then
    phase_note="${phase_note} Current phase ($(basename "$b")): ${ph_cur:-(unset)} — phase goal_condition on record: ${ph_cond:-(unset)}."
  fi
done

[ "$active_found" -eq 0 ] && exit 0   # no active orchestration → dormant, stay silent

ctx="You are a cc-master master orchestrator. Your orchestration board(s) live in ${HOME_DIR}. Active:${listing}. Re-read the board for the task you are working on (recognise it by its goal), then invoke the orchestrating-to-completion skill and continue the decision program. Do not restart work already done/verified; integrate any completed background results first."
if [ -n "$phase_note" ]; then
  ctx="${ctx}${phase_note} Re-recognise which self-driving phase you are in, then check whether the phase /goal is still attached (run /goal to inspect). /goal survives compaction but a --resume resets it: if it was dropped, re-set it from that board's recorded goal_condition. Note /goal is one-per-session — if several phases are listed, set or re-set it only for the board you are actively driving right now."
fi
printf '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":%s}}\n' "$(printf '%s' "$ctx" | sed 's/\\/\\\\/g; s/"/\\"/g; s/^/"/; s/$/"/')"
exit 0
