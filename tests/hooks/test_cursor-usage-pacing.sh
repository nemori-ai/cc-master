#!/usr/bin/env bash
. "$(dirname "$0")/helpers.sh"

LAUNCHER="$REPO_ROOT/plugin/src/hooks/_hosts/cursor/launcher.js"
CORE="$REPO_ROOT/plugin/src/hooks/usage-pacing/implementations/cursor/usage-pacing-core.js"

seed_board() {
  mkdir -p "$1/boards"
  printf '{"schema":"cc-master/v2","goal":"g","owner":{"active":true,"session_id":"%s"},"tasks":[{"id":"T1","status":"in_flight","deps":[]}]}' "$2" >"$1/boards/armed.board.json"
}

status_json() {
  local state="$1" revision="$2" covered="$3" surface="$4"
  node -e '
const [state, revision, covered, surface] = process.argv.slice(1);
const decisions = state === "none" ? [] : [{
  scope_digest: `sha256:${"a".repeat(64)}`,
  target: {
    harness_id: "cursor", surface_id: surface, provider_id: "cursor",
    window: { kind: "billing-cycle", name: "billing_period", duration_sec: 2592000 },
  },
  quota_scope_digest: `sha256:${"e".repeat(64)}`,
  state,
  freshness: state === "unknown" ? "unknown" : "fresh",
  reason_codes: state === "healthy" ? [] : [`QUOTA_${state.toUpperCase()}`],
  source: { collector_id: surface === "cursor-agent-cli" ? "cursor-agent-dashboard" : "cursor-dashboard", source_schema: "cursor/GetCurrentPeriodUsage/v1", auth_source: surface === "cursor-agent-cli" ? "cursor-agent-current-login" : "cursor-ide-current-login" },
  decision_revision: `sha256:${revision.repeat(64)}`,
  observation_revision: `sha256:${"0".repeat(64)}`,
  fanout_covered: covered === "true",
}];
process.stdout.write(JSON.stringify({
  schema: "ccm/machine-quota-status/v1",
  summary: { schema: "ccm/machine-quota-summary/v1", decisions },
  readings: [],
  capacity_views: { schema: "ccm/machine-quota-capacity-views/v1", known_capacities: [], unresolved_scope_digests: [], unresolved_capacity_units: null },
}));
' "$state" "$revision" "$covered" "$surface"
}

write_stub() {
  local home="$1" response="$2"
  printf '%s' "$response" >"$home/status.json"
  cat >"$home/ccm" <<STUB
#!/usr/bin/env bash
printf '%s\n' "\$*" >>"$home/calls"
if [ -n "\${CCM_CURSOR_ACCESS_TOKEN:-}" ] || [ -n "\${CCM_CURSOR_API_BASE:-}" ] ||
   [ -n "\${CURSOR_API_KEY:-}" ] || [ -n "\${ANTHROPIC_API_KEY:-}" ] ||
   [ -n "\${OPENAI_API_KEY:-}" ] || [ -n "\${CLAUDE_CODE_OAUTH_TOKEN:-}" ] ||
   [ -n "\${HTTPS_PROXY:-}" ] || [ -n "\${HTTP_PROXY:-}" ] || [ -n "\${ALL_PROXY:-}" ] ||
   [ -n "\${CLAUDE_CONFIG_DIR:-}" ] || [ -n "\${CODEX_HOME:-}" ] ||
   [ -n "\${XDG_CONFIG_HOME:-}" ] || [ -n "\${NODE_OPTIONS:-}" ]; then
  printf '%s\n' credential-or-provider-endpoint-reached-cached-reader >"$home/credential-leak"
  exit 97
fi
if [ "\$1 \$2" = "quota status" ]; then cat "$home/status.json"; exit 0; fi
exit 29
STUB
  chmod +x "$home/ccm"
}

run_stop() {
  local home="$1" sid="$2" active="${3:-false}"
  cat >"$home/deny-network.cjs" <<'JS'
const fs = require('fs');
const Module = require('module');
const marker = process.env.CC_MASTER_NETWORK_MARKER;
const denied = new Set(['http', 'https', 'net', 'tls', 'node:http', 'node:https', 'node:net', 'node:tls']);
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (denied.has(request)) {
    if (marker) fs.writeFileSync(marker, request);
    throw new Error(`provider network module denied: ${request}`);
  }
  return originalLoad.call(this, request, parent, isMain);
};
globalThis.fetch = async () => {
  if (marker) fs.writeFileSync(marker, 'fetch');
  throw new Error('provider fetch denied');
};
JS
  HOOK_OUT="$(
    printf '{"conversation_id":"%s","session_id":"%s","hook_event_name":"stop","stop_hook_active":%s}' "$sid" "$sid" "$active" |
      CC_MASTER_HOME="$home" CCM_BIN="$home/ccm" \
      CCM_CURSOR_ACCESS_TOKEN="cursor-secret-must-not-reach-cached-reader" \
      CCM_CURSOR_API_BASE="https://provider.invalid" \
      CURSOR_API_KEY="cursor-api-secret" ANTHROPIC_API_KEY="anthropic-secret" \
      OPENAI_API_KEY="openai-secret" CLAUDE_CODE_OAUTH_TOKEN="claude-secret" \
      HTTPS_PROXY="https://proxy.invalid" HTTP_PROXY="http://proxy.invalid" ALL_PROXY="socks5://proxy.invalid" \
      CLAUDE_CONFIG_DIR="$home/claude-config" CODEX_HOME="$home/codex-home" XDG_CONFIG_HOME="$home/xdg-config" \
      CC_MASTER_NETWORK_MARKER="$home/network-attempt" \
      NODE_OPTIONS="--require=$home/deny-network.cjs" \
      node "$LAUNCHER" --event stop --core "$CORE" 2>/dev/null
  )"
  HOOK_RC=$?
}

H="$(make_project)"
seed_board "$H" "sess-u"

write_stub "$H" "$(status_json healthy 1 true cursor-agent-cli)"
run_stop "$H" "sess-u"
assert_eq "" "$HOOK_OUT" "healthy covered status -> silent"

write_stub "$H" "$(status_json tight 2 false cursor-agent-cli)"
run_stop "$H" "sess-u"
assert_contains "$HOOK_OUT" '"followup_message"' "uncovered tight -> Cursor followup"
assert_contains "$HOOK_OUT" "cursor/cursor-agent-cli/cursor" "Cursor Agent target retained"
assert_contains "$HOOK_OUT" "state=tight" "state retained"
assert_contains "$HOOK_OUT" "never inferred" "dual-surface boundary is explicit"
assert_not_contains "$HOOK_OUT" "billing_period_pct" "no raw balance percentage"
assert_contains "$HOOK_OUT" "no account switch is performed" "no account-switch action is explicit"

run_stop "$H" "sess-u"
assert_eq "" "$HOOK_OUT" "same scope+revision -> sidecar dedupe"

write_stub "$H" "$(status_json unknown 3 false cursor-ide-plugin)"
run_stop "$H" "sess-u"
assert_contains "$HOOK_OUT" "cursor/cursor-ide-plugin/cursor" "Cursor IDE remains a distinct target"
assert_contains "$HOOK_OUT" "state=unknown" "unknown is not healthy"

write_stub "$H" "$(status_json exhausted 4 true cursor-agent-cli)"
run_stop "$H" "sess-u"
assert_eq "" "$HOOK_OUT" "machine fan-out covered revision -> direct floor silent"

run_stop "$H" "sess-u" "true"
assert_eq "" "$HOOK_OUT" "stop_hook_active -> silent"

CALLS="$(cat "$H/calls")"
assert_contains "$CALLS" "quota status --machine-wide --json" "cached machine-wide status is the only read"
assert_not_contains "$CALLS" "usage advise" "dashboard-backed legacy usage adapter is never invoked"
assert_not_contains "$CALLS" "coordination notify" "hook does not duplicate ccm fan-out"
assert_not_contains "$CALLS" "account switch" "Cursor never switches accounts"
assert_no_file "$H/network-attempt" "Cursor hook performs no direct provider network call"
assert_no_file "$H/credential-leak" "cached status child receives no Cursor credential or provider endpoint"
rm -rf "$H"

H="$(make_project)"
seed_board "$H" "sess-shared-capacity"
node -e '
const make = (scope, surface, revision) => ({
  scope_digest: `sha256:${scope.repeat(64)}`,
  target: {
    harness_id: "cursor", surface_id: surface, provider_id: "cursor",
    window: { kind: "billing-cycle", name: "billing_period", duration_sec: 2592000 },
  },
  quota_scope_digest: `sha256:${"e".repeat(64)}`, state: "tight", freshness: "fresh",
  reason_codes: ["QUOTA_TIGHT"], decision_revision: `sha256:${revision.repeat(64)}`,
  source: { collector_id: surface === "cursor-agent-cli" ? "cursor-agent-dashboard" : "cursor-dashboard", source_schema: "cursor/GetCurrentPeriodUsage/v1", auth_source: surface === "cursor-agent-cli" ? "cursor-agent-current-login" : "cursor-ide-current-login" },
  observation_revision: `sha256:${"0".repeat(64)}`, fanout_covered: false,
});
process.stdout.write(JSON.stringify({
  schema: "ccm/machine-quota-status/v1",
  summary: { schema: "ccm/machine-quota-summary/v1", decisions: [make("a", "cursor-agent-cli", "6"), make("b", "cursor-ide-plugin", "7")] },
  readings: [],
  capacity_views: { schema: "ccm/machine-quota-capacity-views/v1", known_capacities: [], unresolved_scope_digests: [], unresolved_capacity_units: null },
}));
' >"$H/shared-capacity.json"
write_stub "$H" "$(cat "$H/shared-capacity.json")"
run_stop "$H" "sess-shared-capacity"
assert_contains "$HOOK_OUT" "scope=sha256:aaaaaaaa" "fallback line retains scope digest"
assert_contains "$HOOK_OUT" "quota_scope=sha256:eeeeeeee" "collector-proven shared capacity digest is retained"
assert_contains "$HOOK_OUT" "cursor/cursor-agent-cli/cursor" "Cursor Agent target remains visible"
assert_contains "$HOOK_OUT" "cursor/cursor-ide-plugin/cursor" "Cursor IDE target remains visible"
assert_contains "$HOOK_OUT" "window=billing-cycle/billing_period/2592000s" "fallback line retains canonical window"
assert_not_contains "$HOOK_OUT" "account_id" "fallback line never emits raw account identity"
TARGET_LINE_COUNT="$(printf '%s' "$HOOK_OUT" | grep -o 'cursor/cursor-[a-z-]*/cursor' | wc -l | tr -d ' ')"
assert_eq "2" "$TARGET_LINE_COUNT" "shared capacity keeps both surface-scoped lines"
rm -rf "$H"

H="$(make_project)"
write_stub "$H" "$(status_json tight 5 false cursor-agent-cli)"
run_stop "$H" "sess-unarmed"
assert_eq "" "$HOOK_OUT" "unarmed -> silent"
assert_no_file "$H/calls" "unarmed -> no ccm read"
rm -rf "$H"

META="$(cat "$REPO_ROOT/plugin/src/hooks/usage-pacing/implementations/cursor/meta.yaml")"
STRATEGY="$(sed -n '/^  usage-pacing:/,/^  [a-z-]*:/p' "$REPO_ROOT/plugin/src/hooks/_hosts/cursor/strategy.yaml")"
assert_contains "$META" "quota status --machine-wide --json" "Cursor adapter metadata names cached machine-wide status"
assert_not_contains "$META" "usage advise" "Cursor adapter metadata does not advertise dashboard-backed usage advise"
assert_contains "$STRATEGY" "cached" "Cursor host strategy declares cached pacing input"
assert_contains "$STRATEGY" "cursor-agent-cli" "Cursor host strategy preserves Cursor Agent surface"
assert_contains "$STRATEGY" "cursor-ide-plugin" "Cursor host strategy preserves Cursor IDE surface"

finish
