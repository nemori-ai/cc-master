#!/usr/bin/env bash
# UserPromptSubmit hook: when the as-master-orchestrator command is invoked, deterministically
# create a NEW uniquely-named board in the configurable home, then inject its path + the
# orchestrator role so the agent knows which board is its own. This hook does NOT self-gate on a
# marker (it is the activator) — it gates on a TIGHTENED dual sentinel so that text which merely
# *mentions* the command name (a task-notification, a sub-agent result, a user discussing the
# command) no longer false-triggers an empty board (Finding #15):
#   1. raw command  — the prompt field VALUE starts with /cc-master:as-master-orchestrator
#                     (leading whitespace tolerated); a mid-text mention does not qualify.
#   2. expanded body— the cc-master:bootstrap:v1 marker (an HTML comment that opens the expanded
#                     command body, right after the frontmatter) is the prompt's FIRST non-empty
#                     line. Kept as a safety backup in case UserPromptSubmit sees the expanded body,
#                     not the raw cmd. The marker MUST be the first non-empty line, not a bare
#                     substring anywhere in stdin — otherwise prose that merely *mentions* the marker
#                     mid-sentence (a sub-agent report quoting the command-file convention) would
#                     false-trigger an empty board (Finding #16).
# Pure bash extraction of the JSON prompt field — no jq/node (ship-anywhere).
#
# ARMING NOTE (hook armed-gate discipline): every OTHER cc-master hook stays fully dormant until this
# session is "armed" — armed ⟺ home holds a *.board.json with owner.active:true AND owner.session_id
# == this session's id. This bootstrap hook is the ARM ACTION ITSELF: it is the only hook EXEMPT from
# that gate (it cannot require a prior armed board — it creates the armed state). To make the
# session-scoped gate satisfiable the instant the board is born, it stamps owner.session_id from the
# stdin session_id below (instead of leaving it ""), so the creating session immediately owns its board.
set -uo pipefail

stdin="$(cat)"

# ── stdin → session_id (pure bash, no jq; same extraction as verify-board.sh / reinject.sh) ─────────
# This is the ARM identity stamped onto the new board's owner.session_id, so the armed gate
# (active:true AND owner.session_id==sid) is immediately true for the session that armed it.
sid="$(printf '%s' "$stdin" | sed -n 's/.*"session_id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)"

# Extract the value of the top-level "prompt" string field. Grab everything after `"prompt":"` up to
# the next unescaped double-quote. This is a best-effort extraction sufficient to test a prefix; if
# no prompt field is present, `prompt` stays empty and the prefix test simply fails.
prompt="${stdin#*\"prompt\":\"}"          # drop everything up to & including  "prompt":"
[ "$prompt" = "$stdin" ] && prompt=""     # no "prompt": field at all → empty
prompt="${prompt%%\"*}"                    # drop from the first " onward → the raw field value
trimmed="${prompt#"${prompt%%[![:space:]]*}"}"   # strip leading whitespace

# Expanded-body backup: unescape \n in the prompt field value, take the first non-empty line, and
# require the bootstrap marker to live ON that line. A mid-prose mention (marker quoted inside a
# sentence) leaves a non-marker first line and does not qualify (Finding #16).
first_line="$(printf '%s' "$prompt" | sed -e 's/\\n/\n/g' | grep -m1 -v '^[[:space:]]*$')"
first_line="${first_line#"${first_line%%[![:space:]]*}"}"   # strip leading whitespace
first_line="${first_line%"${first_line##*[![:space:]]}"}"   # strip trailing whitespace
marker_hit=0
case "$first_line" in
  '<!-- cc-master:bootstrap:v1 -->') marker_hit=1 ;;        # STANDALONE first line only — an inline
                                                            # mention on the first line is NOT enough
                                                            # (codex self-review catch, Finding #16)
esac

case "$trimmed" in
  /cc-master:as-master-orchestrator*) : ;;        # raw command: name is the prompt PREFIX
  *)
    [ "$marker_hit" -eq 1 ] || exit 0 ;;          # not the marker first-line → silent no-op
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
# Escape the sid for safe inclusion in the JSON string value (backslash + double-quote only; a
# session id is otherwise printable). Empty sid → stamps "" (degraded: armed gate falls back to
# any-active). Keep this pure bash (no jq) — ship-anywhere.
sid_esc="$(printf '%s' "$sid" | sed 's/\\/\\\\/g; s/"/\\"/g')"
if [ -f "$TEMPLATE" ]; then
  cp "$TEMPLATE" "$BOARD"
  # Stamp owner.session_id with the creating session's id (the ARM identity). The template ships the
  # field as `"session_id": ""`; replace ONLY that empty owner field. A literal-anchored sed on the
  # empty value keeps the substitution from ever touching a non-empty value (none exists in a fresh
  # template, but this stays safe if the template gains other session_id-shaped fields later).
  tmp="$BOARD.tmp.$$"
  sed "s/\"session_id\"[[:space:]]*:[[:space:]]*\"\"/\"session_id\": \"$sid_esc\"/" "$BOARD" > "$tmp" && mv -f "$tmp" "$BOARD"
else
  # Template-missing fallback: build the board inline, stamping the real sid into owner.session_id
  # (was a hardcoded empty "" before — that left every bootstrapped board unowned).
  printf '{"schema":"cc-master/v1","goal":"","owner":{"active":true,"session_id":"%s","heartbeat":""},"git":{"worktree":"","branch":""},"wip_limit":4,"tasks":[],"log":[]}\n' "$sid_esc" > "$BOARD"
fi

ctx="cc-master: a fresh orchestration board was created at ${BOARD}. You are now the master orchestrator for this task — remember that path, it is YOUR board. Decompose the goal into a dependency DAG and write tasks[] into that board file, set goal/owner/git, then invoke the orchestrating-to-completion skill and run the decision program."
printf '{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":%s}}\n' "$(printf '%s' "$ctx" | sed 's/\\/\\\\/g; s/"/\\"/g; s/^/"/; s/$/"/')"
exit 0
