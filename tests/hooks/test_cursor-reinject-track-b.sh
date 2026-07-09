#!/usr/bin/env bash
. "$(dirname "$0")/helpers.sh"

LAUNCHER="$REPO_ROOT/plugin/src/hooks/_hosts/cursor/launcher.js"
CORE="$REPO_ROOT/plugin/src/hooks/reinject/implementations/cursor/precompact-observe-core.js"
RULE_SRC="$REPO_ROOT/plugin/src/rules/cursor/cc-master-orchestrator.mdc"
RULE_DIST="$REPO_ROOT/plugin/dist/cursor/rules/cc-master-orchestrator.mdc"

chmod +x "$CORE"

# Source alwaysApply rule exists (Track B main load).
assert_file "$RULE_SRC" "src alwaysApply rule present"
assert_contains "$(cat "$RULE_SRC")" "alwaysApply: true" "src rule alwaysApply"
assert_contains "$(cat "$RULE_SRC")" "master orchestrator" "src rule role anchor"
assert_contains "$(cat "$RULE_SRC")" "master-orchestrator-guide" "src rule points at SKILL A"
assert_not_contains "$(cat "$RULE_SRC")" "七镜头" "src rule does not paste SKILL A body"

# Dist projection (after sync-plugin-dist --host cursor).
assert_file "$RULE_DIST" "dist alwaysApply rule after sync"
assert_contains "$(cat "$RULE_DIST")" "alwaysApply: true" "dist rule alwaysApply"

# preCompact core: silent no-op (empty stdout, exit 0) — Cursor cannot inject on this event.
run_precompact() {
  local home="$1" sid="$2"
  HOOK_OUT="$(
    printf '{"conversation_id":"%s","session_id":"%s","hook_event_name":"preCompact"}' "$sid" "$sid" |
      CC_MASTER_HOME="$home" node "$LAUNCHER" --event preCompact --core "$CORE" 2>/dev/null
  )"
  HOOK_RC=$?
}

H="$(make_project)"
mkdir -p "$H/boards"
printf '%s' '{"schema":"cc-master/v2","goal":"g","owner":{"active":true,"session_id":"sess-r"},"tasks":[]}' >"$H/boards/mine.board.json"
run_precompact "$H" "sess-r"
assert_eq "0" "$HOOK_RC" "preCompact armed -> exit 0"
assert_eq "" "$HOOK_OUT" "preCompact armed -> silent (no agent injection)"
rm -rf "$H"

# Unarmed / no boards: still silent.
H="$(make_project)"
run_precompact "$H" "sess-r"
assert_eq "0" "$HOOK_RC" "preCompact unarmed -> exit 0"
assert_eq "" "$HOOK_OUT" "preCompact unarmed -> silent"
rm -rf "$H"

echo "PASS=$PASS FAILED=$FAILED"
[ "$FAILED" -eq 0 ]
