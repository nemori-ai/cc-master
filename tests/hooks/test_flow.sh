#!/usr/bin/env bash
# Integration: the three hooks must agree on the home + naming convention. bootstrap creates a
# board; reinject finds it; stop backstops it while empty, forces a self-check handshake once
# filled, then allows; archiving (owner.active:false) makes both go dormant.
. "$(dirname "$0")/helpers.sh"

H="$(make_project)"
PROJ="/nonexistent-proj"
ENV=(CLAUDE_PROJECT_DIR="$PROJ" CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" CC_MASTER_HOME="$H")

# 1. bootstrap creates exactly one board in the home
printf '%s' '{"prompt":"/cc-master:as-master-orchestrator demo goal"}' \
  | env "${ENV[@]}" bash "$PLUGIN_ROOT/hooks/scripts/bootstrap-board.sh" >/dev/null 2>&1
assert_eq 1 "$(ls "$H"/*.board.json 2>/dev/null | wc -l | tr -d ' ')" "bootstrap created exactly one board"
BOARD="$(ls "$H"/*.board.json)"

# 2. reinject finds the active board + re-anchors the role
OUT="$(env "${ENV[@]}" node "$PLUGIN_ROOT/hooks/scripts/reinject.js" </dev/null 2>/dev/null)"
assert_contains "$OUT" "$(basename "$BOARD")" "reinject lists the freshly-created board"
assert_contains "$OUT" "orchestrator" "reinject re-anchors the role"

# 3. stop backstops the still-empty board
OUT="$(env "${ENV[@]}" node "$PLUGIN_ROOT/hooks/scripts/verify-board.js" </dev/null 2>/dev/null)"
assert_contains "$OUT" "block" "stop blocks the unfilled bootstrap board"

# 4. fill the board with an in_flight task → completion state. The goal-hook forces ONE self-check
#    handshake: the first Stop blocks (self-check), the second Stop allows.
printf '%s' '{"schema":"cc-master/v1","goal":"demo goal","owner":{"active":true},"tasks":[{"id":"T1","status":"in_flight","deps":[]}]}' > "$BOARD"
OUT="$(env "${ENV[@]}" node "$PLUGIN_ROOT/hooks/scripts/verify-board.js" </dev/null 2>/dev/null)"
assert_contains "$OUT" "block" "stop forces a self-check on the first completion-state Stop"
OUT="$(env "${ENV[@]}" node "$PLUGIN_ROOT/hooks/scripts/verify-board.js" </dev/null 2>/dev/null)"
assert_not_contains "$OUT" "block" "stop allows after the self-check handshake"

# 5. archive (owner.active:false) → reinject goes dormant
printf '%s' '{"schema":"cc-master/v1","goal":"demo goal","owner":{"active":false},"tasks":[{"id":"T1","status":"done","deps":[]}]}' > "$BOARD"
OUT="$(env "${ENV[@]}" node "$PLUGIN_ROOT/hooks/scripts/reinject.js" </dev/null 2>/dev/null)"
assert_eq "" "$OUT" "reinject silent after archive"
rm -rf "$H"

finish
