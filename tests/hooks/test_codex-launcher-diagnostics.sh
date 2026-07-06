#!/usr/bin/env bash

. "$(dirname "$0")/helpers.sh"

LAUNCHER="$REPO_ROOT/plugin/src/hooks/_hosts/codex/launcher.js"
CORE_STUB="$(mktemp)"
cat >"$CORE_STUB" <<'STUB'
#!/usr/bin/env node
const input = require('fs').readFileSync(0, 'utf8');
const normalized = JSON.parse(input);
process.stderr.write('token=supersecret-token-value\n');
process.stdout.write(JSON.stringify({
  kind: 'system',
  message: `Bearer supersecret-token-value ${'x'.repeat(7000)} ${normalized.event}`
}) + '\n');
STUB
chmod +x "$CORE_STUB"

mode_of() {
  node -e 'const fs=require("fs"); process.stdout.write((fs.statSync(process.argv[1]).mode & 0o777).toString(8));' "$1"
}

H="$(make_project)"
HOME_DIR="$H/home"
DIAG_DIR="$H/diag"
PAYLOAD='{"session_id":"diag-sess","hook_event_name":"PreToolUse","tool_name":"Bash","tool_use_id":"tool-1","tool_input":{"command":"echo supersecret-payload-value","password":"supersecret-payload-value"},"tool_response":{"stdout":"supersecret-response-value"}}'

printf '%s' "$PAYLOAD" | CC_MASTER_HOME="$HOME_DIR" node "$LAUNCHER" --event PreToolUse --core "$CORE_STUB" >/dev/null 2>/dev/null
assert_no_file "$HOME_DIR/hooks/diagnostics" "codex launcher diagnostics are disabled by default"

ENV_HOME="$H/env-home"
printf '%s' "$PAYLOAD" |
  CC_MASTER_HOME="$ENV_HOME" CC_MASTER_HOOK_DIAGNOSTIC=1 \
    node "$LAUNCHER" --event PreToolUse --core "$CORE_STUB" >/dev/null 2>/dev/null
ENV_DIAG_FILE="$(find "$ENV_HOME/hooks/diagnostics" -type f -name '*.json' | sort | head -n1)"
assert_file "$ENV_DIAG_FILE" "codex launcher writes diagnostics when CC_MASTER_HOOK_DIAGNOSTIC=1 is set"

(
  umask 000
  printf '%s' "$PAYLOAD" |
    CC_MASTER_HOME="$HOME_DIR" CC_MASTER_HOOK_DIAGNOSTIC_DIR="$DIAG_DIR" \
      node "$LAUNCHER" --event PreToolUse --core "$CORE_STUB" >/dev/null 2>/dev/null
)
DIAG_FILE="$(find "$DIAG_DIR" -type f -name '*.json' | sort | head -n1)"
assert_file "$DIAG_FILE" "codex launcher writes diagnostics when CC_MASTER_HOOK_DIAGNOSTIC_DIR is set"
assert_eq "700" "$(mode_of "$DIAG_DIR")" "codex launcher diagnostic dir mode is 0700"
assert_eq "600" "$(mode_of "$DIAG_FILE")" "codex launcher diagnostic file mode is 0600"
DIAG_TEXT="$(cat "$DIAG_FILE")"
assert_contains "$DIAG_TEXT" '"schema": "cc-master-codex-hook-diagnostic/v2"' "codex diagnostic uses v2 schema"
assert_contains "$DIAG_TEXT" '"raw_capture": "disabled"' "codex diagnostic raw capture is disabled by default"
assert_contains "$DIAG_TEXT" '"tool_name": "Bash"' "codex diagnostic keeps non-sensitive tool summary"
assert_contains "$DIAG_TEXT" '"input_keys"' "codex diagnostic keeps input key summary"
assert_not_contains "$DIAG_TEXT" "stdin_text" "codex diagnostic does not persist raw stdin by default"
assert_not_contains "$DIAG_TEXT" "payload_raw" "codex diagnostic does not persist raw payload by default"
assert_not_contains "$DIAG_TEXT" "payload_normalized" "codex diagnostic does not persist normalized payload by default"
assert_not_contains "$DIAG_TEXT" "supersecret-payload-value" "codex diagnostic redacts/omits tool input secrets"
assert_not_contains "$DIAG_TEXT" "supersecret-response-value" "codex diagnostic redacts/omits tool response secrets"
assert_not_contains "$DIAG_TEXT" "supersecret-token-value" "codex diagnostic redacts core stream secrets"
assert_contains "$DIAG_TEXT" "[REDACTED]" "codex diagnostic records redacted core stream preview"
assert_contains "$DIAG_TEXT" '"truncated": true' "codex diagnostic truncates oversized core stream preview"

RAW_DIR="$H/raw-diag"
printf '%s' "$PAYLOAD" |
  CC_MASTER_HOME="$HOME_DIR" CC_MASTER_HOOK_DIAGNOSTIC_DIR="$RAW_DIR" CC_MASTER_HOOK_DIAGNOSTIC_UNSAFE_RAW=1 \
    node "$LAUNCHER" --event PreToolUse --core "$CORE_STUB" >/dev/null 2>/dev/null
RAW_FILE="$(find "$RAW_DIR" -type f -name '*.json' | sort | head -n1)"
RAW_TEXT="$(cat "$RAW_FILE")"
assert_contains "$RAW_TEXT" '"raw_capture": "unsafe-opt-in"' "codex diagnostic unsafe raw capture requires explicit high-risk env"
assert_contains "$RAW_TEXT" '"unsafe_raw"' "codex diagnostic writes raw section only in unsafe mode"
assert_contains "$RAW_TEXT" "supersecret-payload-value" "codex diagnostic unsafe raw mode preserves raw payload for repro"

rm -f "$CORE_STUB"
finish
