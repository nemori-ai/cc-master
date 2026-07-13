#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cp "$ROOT/tests/fixtures/orchestrator-context-secret-vectors.json" "$TMP/token-vectors.json"
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
const tokenVectors = JSON.parse(fs.readFileSync(`${__dirname}/token-vectors.json`, 'utf8'));
const allTokenVectors = Object.entries(tokenVectors.families).flatMap(([family, vectors]) =>
  vectors.map((vector) => ({ family, ...vector })),
);
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
if (fs.existsSync(`${__dirname}/malicious-jwt`)) {
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJzZW50aW5lbCJ9.signature_1234567890';
  payload.candidates[0].candidate_id = jwt;
  payload.routes[0].selected.candidate_id = jwt;
}
const tokenVector = allTokenVectors.find((vector) =>
  fs.existsSync(
    `${__dirname}/${vector.private ? 'malicious' : 'positive'}-secret-${vector.family}-${vector.id}`,
  ),
);
if (tokenVector) {
  payload.candidates[0].candidate_id = tokenVector.value;
  payload.routes[0].selected.candidate_id = tokenVector.value;
}
if (fs.existsSync(`${__dirname}/malicious-stale-selected`)) {
  payload.available = false;
  payload.freshness.state = 'stale';
  payload.candidates[0].availability = 'unavailable';
  payload.candidates[0].quota = 'exhausted';
  payload.candidates[0].runtime = 'unhealthy';
  payload.candidates[0].qualifications[0].status = 'fail';
}
if (fs.existsSync(`${__dirname}/malicious-global-unavailable`)) payload.available = false;
if (fs.existsSync(`${__dirname}/malicious-stale`)) payload.freshness.state = 'stale';
if (fs.existsSync(`${__dirname}/malicious-freshness-unknown`)) payload.freshness.state = 'unknown';
if (fs.existsSync(`${__dirname}/malicious-candidate-unavailable`)) payload.candidates[0].availability = 'unavailable';
if (fs.existsSync(`${__dirname}/malicious-quota-exhausted`)) payload.candidates[0].quota = 'exhausted';
if (fs.existsSync(`${__dirname}/malicious-quota-unknown`)) payload.candidates[0].quota = 'unknown';
if (fs.existsSync(`${__dirname}/malicious-cli-quota-tight`)) payload.candidates[0].quota = 'tight';
if (fs.existsSync(`${__dirname}/malicious-auth-unauthenticated`)) payload.candidates[0].auth = 'unauthenticated';
if (fs.existsSync(`${__dirname}/malicious-model-unavailable`)) payload.candidates[0].model = 'unavailable';
if (fs.existsSync(`${__dirname}/malicious-runtime-unhealthy`)) payload.candidates[0].runtime = 'unhealthy';
if (fs.existsSync(`${__dirname}/malicious-qualification-fail`)) payload.candidates[0].qualifications[0].status = 'fail';
if (fs.existsSync(`${__dirname}/malicious-effect-fail`)) {
  payload.candidates[0].qualifications.push({ predicate: 'effect-floor', status: 'fail' });
}
if (fs.existsSync(`${__dirname}/malicious-permission-fail`)) {
  payload.candidates[0].qualifications.push({ predicate: 'permission-compatible', status: 'fail' });
}
if (fs.existsSync(`${__dirname}/malicious-selected-missing-candidate`)) {
  payload.routes[0].selected.candidate_id = 'missing-candidate';
}
if (fs.existsSync(`${__dirname}/positive-native-tight`)) {
  const nativeId = `${harness}-native`;
  payload.candidates[0].candidate_id = nativeId;
  payload.candidates[0].harness = harness;
  payload.candidates[0].surface = 'host-native';
  payload.candidates[0].quota = 'tight';
  payload.routes[0].outcome = 'same-native';
  payload.routes[0].selected = { candidate_id: nativeId, harness, surface: 'host-native' };
}
let inner = JSON.stringify(payload);
if (fs.existsSync(`${__dirname}/malicious-duplicate`)) {
  inner = inner.replace(
    '"candidate_id":"codex-cli"',
    '"candidate_id":"ghp_DUPLICATE_SECRET_SENTINEL","candidate_id":"codex-cli"',
  );
}
const content = `<ambient source="orchestrator-context">${inner}</ambient>`;
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
mapfile -t PRIVATE_VALUE_MODES < <(node - "$TMP/token-vectors.json" <<'NODE'
const fs = require('fs');
const vectors = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const safeId = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
for (const [family, entries] of Object.entries(vectors.families)) {
  for (const vector of entries.filter((entry) => entry.private && safeId.test(entry.value))) {
    process.stdout.write(`malicious-secret-${family}-${vector.id}\n`);
  }
}
NODE
)
NEGATIVE_MODES=( \
  malicious-unknown malicious-value malicious-duplicate malicious-jwt malicious-stale-selected \
  malicious-global-unavailable malicious-stale malicious-freshness-unknown malicious-candidate-unavailable \
  malicious-quota-exhausted malicious-quota-unknown malicious-cli-quota-tight malicious-auth-unauthenticated \
  malicious-model-unavailable malicious-runtime-unhealthy malicious-qualification-fail \
  malicious-effect-fail malicious-permission-fail malicious-selected-missing-candidate \
)
for MODE in "${NEGATIVE_MODES[@]}" "${PRIVATE_VALUE_MODES[@]}"; do
  rm -f "$HOME_DIR/hooks/orchestrator-context"/*.json 2>/dev/null || true
  touch "$TMP/$MODE"
  "$CCM_BIN" orchestrator context --cached-only --agent-visible --harness codex >"$TMP/$MODE-fixture.json"
  node - "$MODE" "$TMP/$MODE-fixture.json" <<'NODE'
const fs = require('fs');
const assert = require('assert');
const path = require('path');
const mode = process.argv[2];
const outer = JSON.parse(fs.readFileSync(process.argv[3], 'utf8')).data;
assert.strictEqual(outer.schema, 'ccm/origin-context-delivery/v1');
assert.match(outer.content, /^<ambient source="orchestrator-context">/);
if (mode === 'malicious-duplicate') {
  assert.match(outer.content, /ghp_DUPLICATE_SECRET_SENTINEL/);
  assert.match(outer.content, /"candidate_id":"ghp_DUPLICATE_SECRET_SENTINEL","candidate_id":"codex-cli"/);
}
if (mode === 'malicious-jwt') {
  assert.match(outer.content, /eyJhbGciOiJIUzI1NiJ9\.eyJzdWIiOiJzZW50aW5lbCJ9\.signature_1234567890/);
}
if (mode.startsWith('malicious-secret-')) {
  const vectors = JSON.parse(fs.readFileSync(path.join(path.dirname(process.argv[3]), 'token-vectors.json'), 'utf8'));
  const vector = Object.entries(vectors.families)
    .flatMap(([family, entries]) => entries.map((entry) => ({ family, ...entry })))
    .find((entry) => mode === `malicious-secret-${entry.family}-${entry.id}`);
  assert(vector && vector.private === true, mode);
  assert.match(vector.value, /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/);
  const payload = JSON.parse(outer.content.replace(/^<ambient source="orchestrator-context">/, '').replace(/<\/ambient>$/, ''));
  assert.strictEqual(payload.candidates[0].candidate_id, vector.value);
  assert.strictEqual(payload.routes[0].selected.candidate_id, vector.value);
}
if (mode === 'malicious-stale-selected') {
  const payload = JSON.parse(outer.content.replace(/^<ambient source="orchestrator-context">/, '').replace(/<\/ambient>$/, ''));
  assert.strictEqual(payload.available, false);
  assert.strictEqual(payload.freshness.state, 'stale');
  assert.strictEqual(payload.candidates[0].quota, 'exhausted');
  assert.strictEqual(payload.candidates[0].runtime, 'unhealthy');
  assert.strictEqual(payload.candidates[0].qualifications[0].status, 'fail');
  assert.strictEqual(payload.routes[0].eligible, true);
  assert.strictEqual(payload.routes[0].selected.candidate_id, 'codex-cli');
}
const selectedInvariant = {
  'malicious-global-unavailable': ['available', false],
  'malicious-stale': ['freshness.state', 'stale'],
  'malicious-freshness-unknown': ['freshness.state', 'unknown'],
  'malicious-candidate-unavailable': ['candidates.0.availability', 'unavailable'],
  'malicious-quota-exhausted': ['candidates.0.quota', 'exhausted'],
  'malicious-quota-unknown': ['candidates.0.quota', 'unknown'],
  'malicious-cli-quota-tight': ['candidates.0.quota', 'tight'],
  'malicious-auth-unauthenticated': ['candidates.0.auth', 'unauthenticated'],
  'malicious-model-unavailable': ['candidates.0.model', 'unavailable'],
  'malicious-runtime-unhealthy': ['candidates.0.runtime', 'unhealthy'],
  'malicious-qualification-fail': ['candidates.0.qualifications.0.status', 'fail'],
};
if (selectedInvariant[mode]) {
  const payload = JSON.parse(outer.content.replace(/^<ambient source="orchestrator-context">/, '').replace(/<\/ambient>$/, ''));
  const [path, expected] = selectedInvariant[mode];
  const actual = path.split('.').reduce((value, key) => value[Number.isInteger(Number(key)) ? Number(key) : key], payload);
  assert.strictEqual(actual, expected);
  assert.strictEqual(payload.routes[0].eligible, true);
  assert.notStrictEqual(payload.routes[0].selected, null);
}
if (mode === 'malicious-effect-fail' || mode === 'malicious-permission-fail') {
  const payload = JSON.parse(outer.content.replace(/^<ambient source="orchestrator-context">/, '').replace(/<\/ambient>$/, ''));
  const predicate = mode === 'malicious-effect-fail' ? 'effect-floor' : 'permission-compatible';
  assert.deepStrictEqual(payload.candidates[0].qualifications.at(-1), { predicate, status: 'fail' });
  assert.strictEqual(payload.routes[0].eligible, true);
  assert.notStrictEqual(payload.routes[0].selected, null);
}
if (mode === 'malicious-selected-missing-candidate') {
  const payload = JSON.parse(outer.content.replace(/^<ambient source="orchestrator-context">/, '').replace(/<\/ambient>$/, ''));
  assert.strictEqual(payload.routes[0].selected.candidate_id, 'missing-candidate');
  assert.strictEqual(payload.candidates.some((entry) => entry.candidate_id === 'missing-candidate'), false);
}
NODE
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
  ! rg -n 'ghp_|alice@example|private\.txt|Bearer |eyJhbGciOiJIUzI1NiJ9|sk-[A-Za-z0-9_-]{16,}|"state":"stale"' \
    "$TMP/$MODE-claude" "$TMP/$MODE-codex" "$TMP/$MODE-cursor"
  rm -f "$TMP/$MODE"
done

# Tight quota is legal for an otherwise eligible origin-local host-native candidate; the stricter
# ample-only rule belongs only to cli-headless. This positive guard prevents overfitting the
# selected-route rejection matrix into a blanket tight-quota ban.
rm -f "$HOME_DIR/hooks/orchestrator-context"/*.json 2>/dev/null || true
touch "$TMP/positive-native-tight"
printf '%s\n' '{"hook_event_name":"SessionStart","session_id":"sid-context"}' |
  CC_MASTER_HARNESS=claude-code node "$CLAUDE" >"$TMP/native-tight-claude"
printf '%s\n' '{"hook_event_name":"SessionStart","session_id":"sid-context"}' |
  CC_MASTER_PLUGIN_ROOT="$ROOT/plugin/src" node "$CODEX_LAUNCHER" --event SessionStart --core "$CODEX" >"$TMP/native-tight-codex"
(
  cd "$ROOT/plugin/src"
  printf '%s\n' '{"hook_event_name":"postToolUse","conversation_id":"sid-context","tool_name":"Shell"}' |
    node "$CURSOR_LAUNCHER" --event postToolUse --core './hooks/orchestrator-context/implementations/cursor/orchestrator-context-core.js' >"$TMP/native-tight-cursor"
)
node - "$TMP" <<'NODE'
const fs = require('fs');
const assert = require('assert');
const root = process.argv[2];
const contexts = [
  ['claude-code', JSON.parse(fs.readFileSync(`${root}/native-tight-claude`, 'utf8')).hookSpecificOutput.additionalContext],
  ['codex', JSON.parse(fs.readFileSync(`${root}/native-tight-codex`, 'utf8')).systemMessage],
  ['cursor', JSON.parse(fs.readFileSync(`${root}/native-tight-cursor`, 'utf8')).additional_context],
];
for (const [harness, content] of contexts) {
  const payload = JSON.parse(content.replace(/^<ambient source="orchestrator-context">/, '').replace(/<\/ambient>$/, ''));
  assert.strictEqual(payload.candidates[0].quota, 'tight');
  assert.strictEqual(payload.routes[0].selected.harness, harness);
  assert.strictEqual(payload.routes[0].selected.surface, 'host-native');
  assert.strictEqual(payload.routes[0].eligible, true);
}
NODE
rm -f "$TMP/positive-native-tight"

# Counterexamples from the same producer/consumer conformance table must stay public. Each vector is
# self-checked, then crosses Claude additionalContext, Codex systemMessage, and Cursor
# additional_context so boundary hardening cannot become a blanket token-family ban.
mapfile -t PUBLIC_VALUE_MODES < <(node - "$TMP/token-vectors.json" <<'NODE'
const fs = require('fs');
const vectors = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const safeId = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
for (const [family, entries] of Object.entries(vectors.families)) {
  for (const vector of entries.filter((entry) => !entry.private && safeId.test(entry.value))) {
    process.stdout.write(`positive-secret-${family}-${vector.id}\n`);
  }
}
NODE
)
for MODE in "${PUBLIC_VALUE_MODES[@]}"; do
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
  node - "$MODE" "$TMP" <<'NODE'
const fs = require('fs');
const assert = require('assert');
const mode = process.argv[2];
const root = process.argv[3];
const vectors = JSON.parse(fs.readFileSync(`${root}/token-vectors.json`, 'utf8'));
const vector = Object.entries(vectors.families)
  .flatMap(([family, entries]) => entries.map((entry) => ({ family, ...entry })))
  .find((entry) => mode === `positive-secret-${entry.family}-${entry.id}`);
assert(vector && vector.private === false);
assert.match(vector.value, /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/);
const contexts = [
  JSON.parse(fs.readFileSync(`${root}/${mode}-claude`, 'utf8')).hookSpecificOutput.additionalContext,
  JSON.parse(fs.readFileSync(`${root}/${mode}-codex`, 'utf8')).systemMessage,
  JSON.parse(fs.readFileSync(`${root}/${mode}-cursor`, 'utf8')).additional_context,
];
for (const content of contexts) {
  assert(Buffer.byteLength(content, 'utf8') <= 4096);
  const payload = JSON.parse(content.replace(/^<ambient source="orchestrator-context">/, '').replace(/<\/ambient>$/, ''));
  assert.strictEqual(payload.candidates[0].candidate_id, vector.value);
  assert.strictEqual(payload.routes[0].selected.candidate_id, vector.value);
}
NODE
  rm -f "$TMP/$MODE"
done

# The shared executable classifier is the one consumer used by all three origin envelopes. The
# same family table also drives producer and endpoint cases above, so a new family cannot silently
# acquire a second expected-value list.
node - "$ROOT" "$TMP/token-vectors.json" <<'NODE'
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const root = process.argv[2];
const vectors = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
const { secretShapedValue } = require(path.join(
  root,
  'plugin/src/hooks/_shared/orchestrator-context-private-value.js',
));
for (const [family, entries] of Object.entries(vectors.families)) {
  assert(entries.some((entry) => entry.private), `${family}: private boundary missing`);
  assert(entries.some((entry) => !entry.private), `${family}: public boundary missing`);
  for (const vector of entries) {
    assert.strictEqual(secretShapedValue(vector.value), vector.private, `${family}/${vector.id}`);
  }
}
NODE

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
