#!/usr/bin/env bash

. "$(dirname "$0")/helpers.sh"

LAUNCHER="$REPO_ROOT/plugin/src/hooks/_hosts/codex/launcher.js"
CORE_STUB="$(mktemp)"
cat >"$CORE_STUB" <<'STUB'
#!/usr/bin/env node
const input = require('fs').readFileSync(0, 'utf8');
const normalized = JSON.parse(input);
if (normalized.event === 'stop') {
  process.stdout.write(JSON.stringify({ kind: 'system', message: 'stop hook tolerated' }) + '\n');
}
process.exit(1);
STUB
chmod +x "$CORE_STUB"

# Stop event: non-zero exit from core should be tolerated and not fail the launcher.
HOOK_OUT="$(
  printf '{"session_id":"sess","hook_event_name":"Stop","stop_hook_active":false}' |
    node "$LAUNCHER" --event Stop --core "$CORE_STUB" 2>/dev/null
)"
HOOK_RC=$?
assert_eq 0 "$HOOK_RC" "Stop event tolerates child exit 1"
assert_contains "$HOOK_OUT" '"systemMessage"' "Stop event emits core system message"

# Non-stop event keeps fail-fast behavior when child exits non-zero.
HOOK_OUT="$(
  printf '{"session_id":"sess","hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"echo hi"}}' |
    node "$LAUNCHER" --event PreToolUse --core "$CORE_STUB" 2>/dev/null
)"
HOOK_RC=$?
assert_eq 1 "$HOOK_RC" "PreToolUse event preserves non-zero failure"

rm -f "$CORE_STUB"
finish

