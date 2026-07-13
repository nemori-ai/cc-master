#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
HOME_DIR="$TMP/home"
mkdir -p "$HOME_DIR/boards" "$HOME_DIR/cache"
cat >"$HOME_DIR/boards/test.board.json" <<'JSON'
{"schema":"cc-master/v2","goal":"fixture","owner":{"active":true,"session_id":"sid-context"},"tasks":[]}
JSON
printf '%s\n' '{"schema":"ccm/machine-context-cache/v1"}' >"$HOME_DIR/cache/machine-context-cache.json"
BOARD_BEFORE="$(sha256sum "$HOME_DIR/boards/test.board.json")"

cat >"$TMP/fake-ccm.js" <<'NODE'
#!/usr/bin/env node
const crypto = require('crypto');
const fs = require('fs');
const args = process.argv.slice(2);
fs.appendFileSync(`${__dirname}/calls.jsonl`, `${JSON.stringify(args)}\n`);
if (fs.existsSync(`${__dirname}/slow`)) {
  const until = Date.now() + 2000;
  while (Date.now() < until) {}
}
if (fs.existsSync(`${__dirname}/corrupt`)) {
  process.stdout.write('{bad');
  process.exit(0);
}
const harness = args[args.indexOf('--harness') + 1];
const payload = {
  schema: 'ccm/origin-context/v1', cached_only: true, shadow_only: true,
  dispatch_enabled: false, origin_harness: harness, available: true,
  revisions: { board: 'sha256:fixture', machine: 'machine-r1' },
  freshness: { state: 'fresh', valid_until: '2026-07-13T09:00:00Z' },
  contract_activation: 'enabled',
  candidates: [{ candidate_id: 'codex-cli', harness: 'codex', surface: 'cli-headless', availability: 'available', quota: 'ample', auth: 'authenticated', model: 'available', runtime: 'healthy', qualifications: [{ predicate: 'runtime-healthy', status: 'pass' }] }],
  routes: [{ task_id: 'T1', status: 'ready', eligible: true, outcome: harness === 'codex' ? 'same-harness-cli' : 'other-harness-cli', selected: { candidate_id: 'codex-cli', harness: 'codex', surface: 'cli-headless' }, reason_codes: ['shadow-first-eligible'] }],
  warnings: [], truncation: { applied: false, omitted_candidates: 0, omitted_routes: 0, omitted_warnings: 0, max_bytes: 4096 },
};
if (fs.existsSync(`${__dirname}/malicious-unknown`)) {
  payload.extension = {
    api_key: 'ghp_abcdefghijklmnopqrstuv',
    email: 'alice@example.com',
    artifact: '../../private.txt',
    authorization: 'Bearer abcdefghijklmnopqrstuvwxyz',
  };
}
if (fs.existsSync(`${__dirname}/malicious-value`)) {
  payload.candidates[0].candidate_id = 'ghp_abcdefghijklmnopqrstuv';
  payload.routes[0].selected.candidate_id = 'ghp_abcdefghijklmnopqrstuv';
}
const content = `<ambient source="orchestrator-context">${JSON.stringify(payload)}</ambient>`;
const data = {
  schema: 'ccm/origin-context-delivery/v1', cached_only: true, shadow_only: true,
  dispatch_enabled: false, origin_harness: harness, revisions: payload.revisions,
  content_sha256: `sha256:${crypto.createHash('sha256').update(content).digest('hex')}`,
  content_bytes: Buffer.byteLength(content), content,
};
process.stdout.write(`${JSON.stringify({ ok: true, data })}\n`);
NODE
chmod +x "$TMP/fake-ccm.js"
export CCM_BIN="$TMP/fake-ccm.js" CALL_LOG="$TMP/calls.jsonl" CC_MASTER_HOME="$HOME_DIR"

CLAUDE="$ROOT/plugin/src/hooks/orchestrator-context/implementations/claude-code/orchestrator-context-core.js"
CODEX="$ROOT/plugin/src/hooks/orchestrator-context/implementations/codex/orchestrator-context-core.js"
CURSOR="$ROOT/plugin/src/hooks/orchestrator-context/implementations/cursor/orchestrator-context-core.js"
CODEX_LAUNCHER="$ROOT/plugin/src/hooks/_hosts/codex/launcher.js"
CURSOR_LAUNCHER="$ROOT/plugin/src/hooks/_hosts/cursor/launcher.js"

printf '%s\n' '{"hook_event_name":"SessionStart","session_id":"sid-context"}' |
  CC_MASTER_HARNESS=claude-code node "$CLAUDE" >"$TMP/claude.json"
printf '%s\n' '{"hook_event_name":"SessionStart","session_id":"sid-context"}' |
  CC_MASTER_PLUGIN_ROOT="$ROOT/plugin/src" node "$CODEX_LAUNCHER" --event SessionStart --core "$CODEX" >"$TMP/codex.json"
(
  cd "$ROOT/plugin/src"
  printf '%s\n' '{"hook_event_name":"postToolUse","conversation_id":"sid-context","tool_name":"Shell"}' |
    node "$CURSOR_LAUNCHER" --event postToolUse --core './hooks/orchestrator-context/implementations/cursor/orchestrator-context-core.js' >"$TMP/cursor.json"
)

node - "$TMP" <<'NODE'
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const root = process.argv[2];
const claude = JSON.parse(fs.readFileSync(path.join(root, 'claude.json'), 'utf8')).hookSpecificOutput.additionalContext;
const codex = JSON.parse(fs.readFileSync(path.join(root, 'codex.json'), 'utf8')).systemMessage;
const cursor = JSON.parse(fs.readFileSync(path.join(root, 'cursor.json'), 'utf8')).additional_context;
function payload(content) {
  assert(Buffer.byteLength(content) <= 4096);
  assert(!/cache:\/\/|credential|token|\/(?:home|Users|etc|tmp|var)\//i.test(content));
  return JSON.parse(content.replace(/^<ambient source="orchestrator-context">/, '').replace(/<\/ambient>$/, ''));
}
const values = [payload(claude), payload(codex), payload(cursor)];
const normalized = values.map((value) => ({
  ...value,
  origin_harness: '<origin>',
  routes: value.routes.map((route) => ({ ...route, outcome: '<origin-relative>' })),
}));
assert.deepStrictEqual(normalized[0], normalized[1]);
assert.deepStrictEqual(normalized[1], normalized[2]);
assert.strictEqual(values[1].routes[0].selected.surface, 'cli-headless');
NODE

# Generated adapters must resolve the projected shared core, not only source-tree relative paths.
rm -f "$HOME_DIR/hooks/orchestrator-context"/*.json 2>/dev/null || true
printf '%s\n' '{"hook_event_name":"SessionStart","session_id":"sid-context"}' |
  CC_MASTER_HARNESS=claude-code node "$ROOT/plugin/dist/claude-code/hooks/scripts/orchestrator-context-core.js" >"$TMP/dist-claude"
printf '%s\n' '{"hook_event_name":"SessionStart","session_id":"sid-context"}' |
  CC_MASTER_PLUGIN_ROOT="$ROOT/plugin/dist/codex" node "$ROOT/plugin/dist/codex/hooks/_hosts/codex/launcher.js" \
    --event SessionStart --core "$ROOT/plugin/dist/codex/hooks/orchestrator-context/implementations/codex/orchestrator-context-core.js" >"$TMP/dist-codex"
(
  cd "$ROOT/plugin/dist/cursor"
  printf '%s\n' '{"hook_event_name":"postToolUse","conversation_id":"sid-context","tool_name":"Shell"}' |
    node './hooks/_hosts/cursor/launcher.js' --event postToolUse \
      --core './hooks/orchestrator-context/implementations/cursor/orchestrator-context-core.js' >"$TMP/dist-cursor"
)
test -s "$TMP/dist-claude"
test -s "$TMP/dist-codex"
test -s "$TMP/dist-cursor"

# A correctly hashed delivery still fails closed at the content boundary for both unknown nested
# fields and private-shaped values in an otherwise allowlisted field. Exercise all three origins and
# the registered Codex/Cursor launcher envelopes.
for MODE in malicious-unknown malicious-value; do
  rm -f "$HOME_DIR/hooks/orchestrator-context"/*.json 2>/dev/null || true
  touch "$TMP/$MODE"
  printf '%s\n' '{"hook_event_name":"SessionStart","session_id":"sid-context"}' |
    CC_MASTER_HARNESS=claude-code node "$CLAUDE" >"$TMP/$MODE-claude"
  printf '%s\n' '{"hook_event_name":"SessionStart","session_id":"sid-context"}' |
    CC_MASTER_PLUGIN_ROOT="$ROOT/plugin/src" node "$CODEX_LAUNCHER" --event SessionStart --core "$CODEX" >"$TMP/$MODE-codex"
  (
    cd "$ROOT/plugin/src"
    printf '%s\n' '{"hook_event_name":"postToolUse","conversation_id":"sid-context","tool_name":"Shell"}' |
      node "$CURSOR_LAUNCHER" --event postToolUse --core './hooks/orchestrator-context/implementations/cursor/orchestrator-context-core.js' >"$TMP/$MODE-cursor"
  )
  test ! -s "$TMP/$MODE-claude"
  test ! -s "$TMP/$MODE-codex"
  test ! -s "$TMP/$MODE-cursor"
  ! rg -n 'ghp_|alice@example|private\.txt|Bearer ' \
    "$TMP/$MODE-claude" "$TMP/$MODE-codex" "$TMP/$MODE-cursor"
  rm -f "$TMP/$MODE"
done

# A session-state board symlink that resolves outside home/boards is never read as an armed board.
SYMLINK_HOME="$TMP/symlink-home"
mkdir -p "$SYMLINK_HOME/boards" "$SYMLINK_HOME/cache" "$SYMLINK_HOME/sessions"
printf '%s\n' '{"schema":"ccm/machine-context-cache/v1"}' >"$SYMLINK_HOME/cache/machine-context-cache.json"
cat >"$TMP/outside.board.json" <<'JSON'
{"schema":"cc-master/v2","goal":"outside","owner":{"active":true,"session_id":"sid-context"},"tasks":[]}
JSON
ln -s "$TMP/outside.board.json" "$SYMLINK_HOME/boards/escape.board.json"
cat >"$SYMLINK_HOME/sessions/sid-context.json" <<JSON
{"harness":"codex","session_id":"sid-context","board_path":"$SYMLINK_HOME/boards/escape.board.json"}
JSON
printf '%s\n' '{"hook_event_name":"SessionStart","session_id":"sid-context"}' |
  CC_MASTER_HOME="$SYMLINK_HOME" CC_MASTER_PLUGIN_ROOT="$ROOT/plugin/src" node "$CODEX_LAUNCHER" \
    --event SessionStart --core "$CODEX" >"$TMP/symlink-codex"
test ! -s "$TMP/symlink-codex"
cat >"$SYMLINK_HOME/sessions/sid-context.json" <<JSON
{"harness":"cursor","session_id":"sid-context","board_path":"$SYMLINK_HOME/boards/escape.board.json"}
JSON
(
  cd "$ROOT/plugin/src"
  printf '%s\n' '{"hook_event_name":"postToolUse","conversation_id":"sid-context","tool_name":"Shell"}' |
    CC_MASTER_HOME="$SYMLINK_HOME" node "$CURSOR_LAUNCHER" --event postToolUse \
      --core './hooks/orchestrator-context/implementations/cursor/orchestrator-context-core.js' >"$TMP/symlink-cursor"
)
test ! -s "$TMP/symlink-cursor"

# Delta events dedupe exact content hash; initial events intentionally re-emit.
(
  cd "$ROOT/plugin/src"
  printf '%s\n' '{"hook_event_name":"postToolUse","conversation_id":"sid-context","tool_name":"Shell"}' |
    node "$CURSOR_LAUNCHER" --event postToolUse --core './hooks/orchestrator-context/implementations/cursor/orchestrator-context-core.js' >"$TMP/cursor-prime"
  printf '%s\n' '{"hook_event_name":"postToolUse","conversation_id":"sid-context","tool_name":"Shell"}' |
    node "$CURSOR_LAUNCHER" --event postToolUse --core './hooks/orchestrator-context/implementations/cursor/orchestrator-context-core.js' >"$TMP/cursor-second"
)
test -s "$TMP/cursor-prime"
test ! -s "$TMP/cursor-second"

# Slow/malformed ccm is silent and fail-open; no collector/provider/account command appears.
rm -f "$HOME_DIR/hooks/orchestrator-context"/*.json 2>/dev/null || true
touch "$TMP/slow"
(
  cd "$ROOT/plugin/src"
  printf '%s\n' '{"hook_event_name":"postToolUse","conversation_id":"sid-context","tool_name":"Shell"}' |
    CC_MASTER_ORCHESTRATOR_CONTEXT_TIMEOUT_MS=50 node "$CURSOR_LAUNCHER" --event postToolUse \
      --core './hooks/orchestrator-context/implementations/cursor/orchestrator-context-core.js' >"$TMP/slow-output"
)
test ! -s "$TMP/slow-output"
rm -f "$TMP/slow"
touch "$TMP/corrupt"
(
  cd "$ROOT/plugin/src"
  printf '%s\n' '{"hook_event_name":"postToolUse","conversation_id":"sid-context","tool_name":"Shell"}' |
    node "$CURSOR_LAUNCHER" --event postToolUse \
      --core './hooks/orchestrator-context/implementations/cursor/orchestrator-context-core.js' >"$TMP/corrupt-output"
)
test ! -s "$TMP/corrupt-output"
node - "$CALL_LOG" <<'NODE'
const fs = require('fs');
const assert = require('assert');
for (const line of fs.readFileSync(process.argv[2], 'utf8').trim().split('\n')) {
  const args = JSON.parse(line);
  assert.deepStrictEqual(args.slice(0, 4), ['orchestrator', 'context', '--cached-only', '--agent-visible']);
  assert(!args.some((arg) => /collector|provider|account|reserve|attempt|spawn/.test(arg)));
}
NODE
test "$BOARD_BEFORE" = "$(sha256sum "$HOME_DIR/boards/test.board.json")"
echo "PASS: three-origin cached orchestrator context"
