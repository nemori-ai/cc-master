#!/usr/bin/env bash
. "$(dirname "$0")/helpers.sh"

count_boards() { ls "$1"/*.board.json 2>/dev/null | wc -l | tr -d ' '; }

# Case A: command-name sentinel → exactly one board in the default home, path + role injected
P="$(make_project)"
run_hook "hooks/scripts/bootstrap-board.sh" '{"prompt":"/cc-master:as-master-orchestrator migrate the thing"}' "$P"
assert_eq 0 "$HOOK_RC" "bootstrap exits 0"
assert_eq 1 "$(count_boards "$P/.claude/cc-master")" "exactly one board created in default home"
assert_contains "$HOOK_OUT" ".board.json" "injects the board path"
assert_contains "$HOOK_OUT" "orchestrator" "injects the orchestrator role"
rm -rf "$P"

# Case B: body sentinel (expanded-body case) → also creates a board
P="$(make_project)"
run_hook "hooks/scripts/bootstrap-board.sh" '{"prompt":"...\n<!-- cc-master:bootstrap:v1 -->\n..."}' "$P"
assert_eq 1 "$(count_boards "$P/.claude/cc-master")" "board created via body sentinel"
rm -rf "$P"

# Case C: unrelated prompt → no board, rc 0 (silent no-op)
P="$(make_project)"
run_hook "hooks/scripts/bootstrap-board.sh" '{"prompt":"what files changed today?"}' "$P"
assert_eq 0 "$HOOK_RC" "no-op exits 0"
assert_eq 0 "$(count_boards "$P/.claude/cc-master")" "no board for unrelated prompt"
rm -rf "$P"

# Case D: CC_MASTER_HOME override → board lands in the custom home, NOT the project default
P="$(make_project)"; H="$(make_project)"
HOOK_OUT="$(printf '%s' '{"prompt":"/cc-master:as-master-orchestrator x"}' \
  | CLAUDE_PROJECT_DIR="$P" CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" CC_MASTER_HOME="$H" \
    bash "$PLUGIN_ROOT/hooks/scripts/bootstrap-board.sh" 2>/dev/null)"
assert_eq 1 "$(count_boards "$H")" "board created in CC_MASTER_HOME"
assert_eq 0 "$(count_boards "$P/.claude/cc-master")" "nothing in project default when home overridden"
rm -rf "$P" "$H"

finish
