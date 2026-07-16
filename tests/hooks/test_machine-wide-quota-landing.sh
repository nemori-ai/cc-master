#!/usr/bin/env bash
. "$(dirname "$0")/helpers.sh"

CLAUDE_INBOX="$PLUGIN_ROOT/hooks/scripts/coordination-inbox.js"
CODEX_LAUNCHER="$REPO_ROOT/plugin/src/hooks/_hosts/codex/launcher.js"
CURSOR_LAUNCHER="$REPO_ROOT/plugin/src/hooks/_hosts/cursor/launcher.js"
CODEX_INBOX="$REPO_ROOT/plugin/src/hooks/coordination-inbox/implementations/codex/coordination-inbox-core.js"
CURSOR_INBOX="$REPO_ROOT/plugin/src/hooks/coordination-inbox/implementations/cursor/coordination-inbox-core.js"
CLAUDE_CONTEXT="$PLUGIN_ROOT/hooks/scripts/orchestrator-context-core.js"
CODEX_CONTEXT="$REPO_ROOT/plugin/src/hooks/orchestrator-context/implementations/codex/orchestrator-context-core.js"
CURSOR_CONTEXT="$REPO_ROOT/plugin/src/hooks/orchestrator-context/implementations/cursor/orchestrator-context-core.js"
CODEX_PACING="$REPO_ROOT/plugin/src/hooks/usage-pacing/implementations/codex/usage-pacing-core.js"
CURSOR_PACING="$REPO_ROOT/plugin/src/hooks/usage-pacing/implementations/cursor/usage-pacing-core.js"

NOW="2026-07-16T12:00:00Z"

seed_board() {
  mkdir -p "$1/boards"
  printf '{"schema":"cc-master/v2","goal":"g","owner":{"active":true,"session_id":"%s"},"tasks":[{"id":"T1","status":"in_flight","deps":[]}]}' "$2" >"$1/boards/armed.board.json"
}

quota_payload() {
  node -e '
const bad = process.argv[1] === "bad";
const payload = {
  schema: "ccm/machine-quota-decision-delta/v1",
  producer: "machine-wide-quota-observer",
  delta_revision: `sha256:${"d".repeat(64)}`,
  scope_digest: `sha256:${"b".repeat(64)}`,
  target: {
    harness_id: "cursor", surface_id: "cursor-agent-cli", provider_id: "cursor",
    window: { kind: "billing-cycle", name: "billing_period", duration_sec: 2592000 },
  },
  quota_scope_digest: `sha256:${"e".repeat(64)}`,
  source: {
    collector_id: "cursor-agent-dashboard",
    source_schema: "cursor/GetCurrentPeriodUsage/v1",
    auth_source: "cursor-agent-current-login",
  },
  previous_state: "healthy",
  current_state: "tight",
  edge: "entered_tight",
  decision_revision: `sha256:${"c".repeat(64)}`,
  observation_revision: `sha256:${"0".repeat(64)}`,
  freshness: "fresh",
  reason_codes: ["QUOTA_TIGHT"],
  reset_marker: null,
  observed_at: "2026-07-16T11:59:00Z",
  valid_until: "2026-07-16T12:04:00Z",
};
if (bad) payload.credential_token = "sk-this-must-never-land";
process.stdout.write(JSON.stringify(payload));
' "$1"
}

codex_hostile_payload() {
  node -e '
const kind = process.argv[1];
const payload = {
  schema: "ccm/machine-quota-decision-delta/v1",
  producer: "machine-wide-quota-observer",
  delta_revision: `sha256:${(kind === "five-hour" ? "5" : "7").repeat(64)}`,
  scope_digest: `sha256:${(kind === "five-hour" ? "6" : "8").repeat(64)}`,
  target: {
    harness_id: "codex", surface_id: "codex-cli", provider_id: "codex",
    window: { kind: "rolling", name: kind === "five-hour" ? "five_hour" : "seven_day", duration_sec: kind === "five-hour" ? 18000 : 604800 },
  },
  quota_scope_digest: null,
  source: { collector_id: "codex-app-server", source_schema: "codex/account-rate-limits/v1", auth_source: "codex-cli-current-login" },
  previous_state: "healthy", current_state: "tight", edge: "entered_tight",
  decision_revision: `sha256:${(kind === "five-hour" ? "9" : "a").repeat(64)}`,
  observation_revision: `sha256:${"0".repeat(64)}`,
  freshness: "fresh",
  reason_codes: [kind === "switch" ? "QUOTA_SWITCH" : "QUOTA_TIGHT"],
  reset_marker: null,
  observed_at: "2026-07-16T11:59:00Z",
  valid_until: "2026-07-16T12:04:00Z",
};
process.stdout.write(JSON.stringify(payload));
' "$1"
}

write_inbox() {
  local file="$1" origin="$2" sid="$3" epoch="$4" items="$5"
  ORIGIN="$origin" SID="$sid" EPOCH="$epoch" ITEMS="$items" node - "$file" <<'NODE'
const fs = require('node:fs');
const subscription = {
  subscription_id: `sub-${process.env.ORIGIN}`,
  session_id: process.env.SID,
  session_epoch: process.env.EPOCH,
  origin: process.env.ORIGIN,
  capability: 'coordination-inbox',
};
const inbox = JSON.parse(process.env.ITEMS).map((item) => ({
  status: 'unconsumed',
  created_at: '2026-07-16T11:59:00Z',
  expires_at: '2026-07-16T13:00:00Z',
  consumed_at: null,
  consumed_note: null,
  ...item,
  delivery_provenance: {
    ...subscription,
    source_policy_revision: 'ccm/machine-wide-quota-notification/v1',
    consent_provenance_ref: 'ccm://coordination/subscriptions/cached-only',
  },
}));
for (const item of inbox) {
  if (item.inject_bad_provenance) {
    delete item.inject_bad_provenance;
    item.delivery_provenance.credential_token = 'sk-provenance-must-not-land';
  }
}
fs.writeFileSync(process.argv[2], JSON.stringify({ ok: true, data: { count: inbox.length, subscription, inbox } }));
NODE
}

mk_inbox_stub() {
  local dir="$1" origin="$2" sid="$3" epoch="$4"
  cat >"$dir/ccm" <<STUB
#!/usr/bin/env bash
if [ "\$1 \$2 \$3" = "coordination subscription current" ]; then
  printf '{"ok":true,"data":{"subscription":{"subscription_id":"sub-$origin","session_id":"$sid","session_epoch":"$epoch","origin":"$origin","capability":"coordination-inbox","state":"current"}}}\n'
  exit 0
fi
if [ "\$1 \$2 \$3" = "coordination inbox list" ]; then
  cat "$dir/inbox.json"
  exit 0
fi
printf '%s\n' "\$*" >>"$dir/forbidden-calls"
exit 23
STUB
  chmod +x "$dir/ccm"
}

run_inbox() {
  local origin="$1" home="$2" stub="$3" state="$4" sid="$5"
  case "$origin" in
    claude-code)
      printf '{"session_id":"%s","hook_event_name":"Stop"}' "$sid" |
        CC_MASTER_HOME="$home" CC_MASTER_NOW="$NOW" CC_MASTER_INBOX_SURFACE_STATE="$state" CCM_BIN="$stub" node "$CLAUDE_INBOX" 2>/dev/null
      ;;
    codex)
      printf '{"session_id":"%s","hook_event_name":"Stop"}' "$sid" |
        CC_MASTER_HOME="$home" CC_MASTER_NOW="$NOW" CC_MASTER_INBOX_SURFACE_STATE="$state" CCM_BIN="$stub" \
        node "$CODEX_LAUNCHER" --event Stop --core "$CODEX_INBOX" 2>/dev/null
      ;;
    cursor)
      printf '{"conversation_id":"%s","session_id":"%s","hook_event_name":"stop"}' "$sid" "$sid" |
        CC_MASTER_HOME="$home" CC_MASTER_NOW="$NOW" CC_MASTER_INBOX_SURFACE_STATE="$state" CCM_BIN="$stub" \
        node "$CURSOR_LAUNCHER" --event stop --core "$CURSOR_INBOX" 2>/dev/null
      ;;
  esac
}

GOOD_PAYLOAD="$(quota_payload good)"
BAD_PAYLOAD="$(quota_payload bad)"
BAD_OUTER_PAYLOAD="$(node -e 'const p=JSON.parse(process.argv[1]); p.delta_revision=`sha256:${"1".repeat(64)}`; process.stdout.write(JSON.stringify(p));' "$GOOD_PAYLOAD")"
BAD_PROVENANCE_PAYLOAD="$(node -e 'const p=JSON.parse(process.argv[1]); p.delta_revision=`sha256:${"2".repeat(64)}`; process.stdout.write(JSON.stringify(p));' "$GOOD_PAYLOAD")"
CODEX_FIVE_HOUR_PAYLOAD="$(codex_hostile_payload five-hour)"
CODEX_SWITCH_PAYLOAD="$(codex_hostile_payload switch)"
OLD_ITEM='{"id":"ntf-old","kind":"pacing_throttle","strength":"strong","summary":"old pacing event","payload":{"verdict":"throttle"}}'
GOOD_ITEM="{\"id\":\"ntf-quota-good\",\"kind\":\"quota_state_change\",\"strength\":\"strong\",\"summary\":\"machine quota changed\",\"payload\":$GOOD_PAYLOAD}"
DUP_ITEM="{\"id\":\"ntf-quota-duplicate-id\",\"kind\":\"quota_state_change\",\"strength\":\"strong\",\"summary\":\"duplicate machine quota edge\",\"payload\":$GOOD_PAYLOAD}"
BAD_ITEM="{\"id\":\"ntf-quota-bad\",\"kind\":\"quota_state_change\",\"strength\":\"strong\",\"summary\":\"unsafe machine quota\",\"payload\":$BAD_PAYLOAD}"
BAD_OUTER_ITEM="{\"id\":\"ntf-quota-bad-outer\",\"kind\":\"quota_state_change\",\"strength\":\"strong\",\"summary\":\"unsafe outer machine quota\",\"credential_token\":\"sk-outer-must-not-land\",\"payload\":$BAD_OUTER_PAYLOAD}"
BAD_PROVENANCE_ITEM="{\"id\":\"ntf-quota-bad-provenance\",\"kind\":\"quota_state_change\",\"strength\":\"strong\",\"summary\":\"unsafe provenance machine quota\",\"inject_bad_provenance\":true,\"payload\":$BAD_PROVENANCE_PAYLOAD}"
CODEX_FIVE_HOUR_ITEM="{\"id\":\"ntf-codex-five-hour\",\"kind\":\"quota_state_change\",\"strength\":\"strong\",\"summary\":\"forbidden Codex five-hour quota\",\"payload\":$CODEX_FIVE_HOUR_PAYLOAD}"
CODEX_SWITCH_ITEM="{\"id\":\"ntf-codex-switch\",\"kind\":\"quota_state_change\",\"strength\":\"strong\",\"summary\":\"forbidden Codex switch quota\",\"payload\":$CODEX_SWITCH_PAYLOAD}"

# A new quota id surfaces immediately without replaying an older unconsumed batch. Unsafe quota
# payloads are suppressed before they reach any host envelope. Only exact current/list reads occur.
for ORIGIN in claude-code codex cursor; do
  H="$(make_project)"
  SID="sid-$ORIGIN"
  seed_board "$H" "$SID"
  mk_inbox_stub "$H" "$ORIGIN" "$SID" "epoch-1"
  write_inbox "$H/inbox.json" "$ORIGIN" "$SID" "epoch-1" "[$OLD_ITEM]"
  FIRST="$(run_inbox "$ORIGIN" "$H" "$H/ccm" "$H/state.json" "$SID")"
  assert_contains "$FIRST" "old pacing event" "$ORIGIN initial old item surfaces"

  write_inbox "$H/inbox.json" "$ORIGIN" "$SID" "epoch-1" "[$OLD_ITEM,$GOOD_ITEM,$DUP_ITEM]"
  SECOND="$(run_inbox "$ORIGIN" "$H" "$H/ccm" "$H/state.json" "$SID")"
  assert_contains "$SECOND" "quota_state_change" "$ORIGIN new quota edge surfaces"
  assert_contains "$SECOND" "cursor-agent-cli" "$ORIGIN preserves target surface"
  assert_not_contains "$SECOND" "old pacing event" "$ORIGIN new id does not replay old batch"
  QUOTA_COUNT="$(printf '%s' "$SECOND" | grep -o 'quota_state_change' | wc -l | tr -d ' ')"
  assert_eq "1" "$QUOTA_COUNT" "$ORIGIN duplicate scope/delta is collapsed"

  write_inbox "$H/inbox.json" "$ORIGIN" "$SID" "epoch-1" "[$OLD_ITEM,$GOOD_ITEM,$BAD_ITEM]"
  THIRD="$(run_inbox "$ORIGIN" "$H" "$H/ccm" "$H/state.json" "$SID")"
  assert_eq "" "$THIRD" "$ORIGIN unsafe quota payload is suppressed"
  assert_not_contains "$THIRD" "sk-this-must-never-land" "$ORIGIN secret never lands"

  write_inbox "$H/inbox.json" "$ORIGIN" "$SID" "epoch-1" "[$OLD_ITEM,$GOOD_ITEM,$BAD_OUTER_ITEM,$BAD_PROVENANCE_ITEM]"
  FOURTH="$(run_inbox "$ORIGIN" "$H" "$H/ccm" "$H/state.json" "$SID")"
  assert_eq "" "$FOURTH" "$ORIGIN unsafe outer/provenance quota items are suppressed"
  assert_not_contains "$FOURTH" "sk-outer-must-not-land" "$ORIGIN outer credential never lands"
  assert_not_contains "$FOURTH" "sk-provenance-must-not-land" "$ORIGIN provenance credential never lands"
  assert_not_contains "$(cat "$H/state.json")" "ntf-quota-bad-outer" "$ORIGIN unsafe outer id never enters sidecar"
  assert_not_contains "$(cat "$H/state.json")" "ntf-quota-bad-provenance" "$ORIGIN unsafe provenance id never enters sidecar"
  assert_no_file "$H/forbidden-calls" "$ORIGIN inbox performs current/list only"
  rm -rf "$H"
done

# Codex five-hour and switch-shaped deltas are invalid for every origin. Keeping one canonical item
# in the same list proves that rejecting the hostile rows neither emits them nor mutates dedupe state.
for ORIGIN in claude-code codex cursor; do
  H="$(make_project)"
  SID="sid-$ORIGIN-codex-hostile"
  seed_board "$H" "$SID"
  mk_inbox_stub "$H" "$ORIGIN" "$SID" "epoch-codex-hostile"
  write_inbox "$H/inbox.json" "$ORIGIN" "$SID" "epoch-codex-hostile" "[$GOOD_ITEM]"
  FIRST="$(run_inbox "$ORIGIN" "$H" "$H/ccm" "$H/state.json" "$SID")"
  assert_contains "$FIRST" "ntf-quota-good" "$ORIGIN primes canonical inbox dedupe state"
  STATE_BEFORE="$(sha256sum "$H/state.json")"
  write_inbox "$H/inbox.json" "$ORIGIN" "$SID" "epoch-codex-hostile" "[$GOOD_ITEM,$CODEX_FIVE_HOUR_ITEM,$CODEX_SWITCH_ITEM]"
  HOSTILE_OUT="$(run_inbox "$ORIGIN" "$H" "$H/ccm" "$H/state.json" "$SID")"
  assert_eq "" "$HOSTILE_OUT" "$ORIGIN Codex five-hour/switch deltas are silent"
  assert_eq "$STATE_BEFORE" "$(sha256sum "$H/state.json")" "$ORIGIN hostile deltas do not update inbox dedupe sidecar"
  assert_not_contains "$(cat "$H/state.json")" "ntf-codex-five-hour" "$ORIGIN five-hour id never enters sidecar"
  assert_not_contains "$(cat "$H/state.json")" "ntf-codex-switch" "$ORIGIN switch id never enters sidecar"
  rm -rf "$H"
done

# Build one canonical cached delivery with a machine-wide summary. The same inner block must survive
# Claude, Codex, and Cursor envelopes unchanged; Cursor IDE and Agent remain separate target rows.
CTX="$(make_project)"
seed_board "$CTX" "sid-context"
mkdir -p "$CTX/cache"
printf '{}\n' >"$CTX/cache/machine-context-cache.json"
cat >"$CTX/context-response.mjs" <<'NODE'
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
const args = process.argv.slice(2);
const harness = args[args.indexOf('--harness') + 1];
const revisions = { board: `sha256:${'b'.repeat(64)}`, machine: `sha256:${'m'.repeat(64)}` };
const machine_quota = {
  schema: 'ccm/machine-quota-summary/v1',
  decisions: [
    { scope_digest: `sha256:${'a'.repeat(64)}`, target: { harness_id: 'cursor', surface_id: 'cursor-agent-cli', provider_id: 'cursor', window: { kind: 'billing-cycle', name: 'billing_period', duration_sec: 2592000 } }, quota_scope_digest: `sha256:${'6'.repeat(64)}`, state: 'tight', freshness: 'fresh', reason_codes: ['QUOTA_TIGHT'], source: { collector_id: 'cursor-agent-dashboard', source_schema: 'cursor/GetCurrentPeriodUsage/v1', auth_source: 'cursor-agent-current-login' }, decision_revision: `sha256:${'1'.repeat(64)}`, observation_revision: `sha256:${'2'.repeat(64)}`, fanout_covered: true },
    { scope_digest: `sha256:${'b'.repeat(64)}`, target: { harness_id: 'cursor', surface_id: 'cursor-ide-plugin', provider_id: 'cursor', window: { kind: 'billing-cycle', name: 'billing_period', duration_sec: 2592000 } }, quota_scope_digest: `sha256:${'6'.repeat(64)}`, state: 'unknown', freshness: 'unknown', reason_codes: ['QUOTA_UNSUPPORTED'], source: { collector_id: 'cursor-dashboard', source_schema: 'cursor/GetCurrentPeriodUsage/v1', auth_source: 'cursor-ide-current-login' }, decision_revision: `sha256:${'3'.repeat(64)}`, observation_revision: `sha256:${'4'.repeat(64)}`, fanout_covered: false },
  ],
};
if (existsSync(`${process.env.CC_MASTER_HOME}/inject-codex-five-hour`)) {
  machine_quota.decisions[0] = {
    scope_digest: `sha256:${'a'.repeat(64)}`,
    target: { harness_id: 'codex', surface_id: 'codex-cli', provider_id: 'codex', window: { kind: 'rolling', name: 'five_hour', duration_sec: 18000 } },
    quota_scope_digest: null,
    state: 'tight', freshness: 'fresh', reason_codes: ['QUOTA_TIGHT'],
    source: { collector_id: 'codex-app-server', source_schema: 'codex/account-rate-limits/v1', auth_source: 'codex-cli-current-login' },
    decision_revision: `sha256:${'1'.repeat(64)}`,
    observation_revision: `sha256:${'2'.repeat(64)}`,
    fanout_covered: false,
  };
}
if (existsSync(`${process.env.CC_MASTER_HOME}/inject-machine-quota-secret`)) {
  machine_quota.decisions[0].target.account_id = 'acct-must-not-land';
}
const payload = {
  schema: 'ccm/origin-context/v1', cached_only: true, shadow_only: true, dispatch_enabled: false,
  origin_harness: harness, available: true, revisions,
  freshness: { state: 'fresh', valid_until: '2026-07-16T12:05:00Z' }, contract_activation: 'enabled',
  candidates: [], machine_quota, routes: [], warnings: [],
  truncation: {
    applied: existsSync(`${process.env.CC_MASTER_HOME}/truncate-one-quota-scope`),
    omitted_candidates: 0, omitted_routes: 0, omitted_warnings: 0,
    omitted_quota_scopes: existsSync(`${process.env.CC_MASTER_HOME}/truncate-one-quota-scope`) || existsSync(`${process.env.CC_MASTER_HOME}/bad-truncation-applied`) ? 1 : 0,
    max_bytes: 4096,
  },
};
const content = `<ambient source="orchestrator-context">${JSON.stringify(payload)}</ambient>`;
process.stdout.write(JSON.stringify({ ok: true, data: {
  schema: 'ccm/origin-context-delivery/v1', cached_only: true, shadow_only: true, dispatch_enabled: false,
  origin_harness: harness, revisions,
  content_sha256: `sha256:${createHash('sha256').update(content).digest('hex')}`,
  content_bytes: Buffer.byteLength(content), content,
} }));
NODE
cat >"$CTX/ccm" <<STUB
#!/usr/bin/env bash
exec node "$CTX/context-response.mjs" "\$@"
STUB
chmod +x "$CTX/ccm"

CLAUDE_OUT="$(printf '{"hook_event_name":"SessionStart","session_id":"sid-context"}' |
  CC_MASTER_HOME="$CTX" CC_MASTER_HARNESS=claude-code CCM_BIN="$CTX/ccm" node "$CLAUDE_CONTEXT" 2>/dev/null)"
CODEX_OUT="$(printf '{"hook_event_name":"SessionStart","session_id":"sid-context"}' |
  CC_MASTER_HOME="$CTX" CC_MASTER_PLUGIN_ROOT="$REPO_ROOT/plugin/src" CCM_BIN="$CTX/ccm" \
  node "$CODEX_LAUNCHER" --event SessionStart --core "$CODEX_CONTEXT" 2>/dev/null)"
CURSOR_OUT="$(cd "$REPO_ROOT/plugin/src" && printf '{"hook_event_name":"postToolUse","conversation_id":"sid-context","session_id":"sid-context","tool_name":"Shell"}' |
  CC_MASTER_HOME="$CTX" CCM_BIN="$CTX/ccm" node "$CURSOR_LAUNCHER" --event postToolUse --core './hooks/orchestrator-context/implementations/cursor/orchestrator-context-core.js' 2>/dev/null)"
for OUT in "$CLAUDE_OUT" "$CODEX_OUT" "$CURSOR_OUT"; do
  assert_contains "$OUT" 'ccm/machine-quota-summary/v1' "machine quota summary reaches origin"
  assert_contains "$OUT" 'cursor-agent-cli' "Cursor Agent quota row preserved"
  assert_contains "$OUT" 'cursor-ide-plugin' "Cursor IDE quota row preserved"
done

CONTEXT_STATE_BEFORE="$(find "$CTX/hooks/orchestrator-context" -type f -exec sha256sum {} + | sort | sha256sum)"
touch "$CTX/inject-codex-five-hour"
HOSTILE_CLAUDE_CONTEXT="$(printf '{"hook_event_name":"SessionStart","session_id":"sid-context"}' |
  CC_MASTER_HOME="$CTX" CC_MASTER_HARNESS=claude-code CCM_BIN="$CTX/ccm" node "$CLAUDE_CONTEXT" 2>/dev/null)"
HOSTILE_CODEX_CONTEXT="$(printf '{"hook_event_name":"SessionStart","session_id":"sid-context"}' |
  CC_MASTER_HOME="$CTX" CC_MASTER_PLUGIN_ROOT="$REPO_ROOT/plugin/src" CCM_BIN="$CTX/ccm" \
  node "$CODEX_LAUNCHER" --event SessionStart --core "$CODEX_CONTEXT" 2>/dev/null)"
HOSTILE_CURSOR_CONTEXT="$(cd "$REPO_ROOT/plugin/src" && printf '{"hook_event_name":"postToolUse","conversation_id":"sid-context","session_id":"sid-context","tool_name":"Shell"}' |
  CC_MASTER_HOME="$CTX" CCM_BIN="$CTX/ccm" node "$CURSOR_LAUNCHER" --event postToolUse --core './hooks/orchestrator-context/implementations/cursor/orchestrator-context-core.js' 2>/dev/null)"
for ORIGIN_OUT in "$HOSTILE_CLAUDE_CONTEXT" "$HOSTILE_CODEX_CONTEXT" "$HOSTILE_CURSOR_CONTEXT"; do
  assert_eq "" "$ORIGIN_OUT" "Codex five-hour summary is silent on every origin"
done
assert_eq "$CONTEXT_STATE_BEFORE" "$(find "$CTX/hooks/orchestrator-context" -type f -exec sha256sum {} + | sort | sha256sum)" "Codex five-hour summary does not update any origin context sidecar"
rm -f "$CTX/inject-codex-five-hour"

touch "$CTX/truncate-one-quota-scope"
TRUNCATED_CONTEXT_OUT="$(printf '{"hook_event_name":"SessionStart","session_id":"sid-context"}' |
  CC_MASTER_HOME="$CTX" CC_MASTER_HARNESS=claude-code CCM_BIN="$CTX/ccm" node "$CLAUDE_CONTEXT" 2>/dev/null)"
assert_contains "$TRUNCATED_CONTEXT_OUT" 'omitted_quota_scopes' "quota-scope truncation metadata reaches the origin"
rm -f "$CTX/truncate-one-quota-scope"
touch "$CTX/bad-truncation-applied"
BAD_TRUNCATION_OUT="$(printf '{"hook_event_name":"SessionStart","session_id":"sid-context"}' |
  CC_MASTER_HOME="$CTX" CC_MASTER_HARNESS=claude-code CCM_BIN="$CTX/ccm" node "$CLAUDE_CONTEXT" 2>/dev/null)"
assert_eq "" "$BAD_TRUNCATION_OUT" "truncation applied=false rejects omitted quota scopes"
rm -f "$CTX/bad-truncation-applied"

touch "$CTX/inject-machine-quota-secret"
SECRET_CONTEXT_OUT="$(printf '{"hook_event_name":"SessionStart","session_id":"sid-context"}' |
  CC_MASTER_HOME="$CTX" CC_MASTER_HARNESS=claude-code CCM_BIN="$CTX/ccm" node "$CLAUDE_CONTEXT" 2>/dev/null)"
assert_eq "" "$SECRET_CONTEXT_OUT" "unknown identity/account fields reject the complete cached context"
assert_not_contains "$SECRET_CONTEXT_OUT" "acct-must-not-land" "cached context never emits account identity"
rm -rf "$CTX"

# Codex and Cursor Stop hooks must not call the legacy live usage adapter. Their only pacing read is
# the cached machine-wide quota status; a legacy 5h verdict cannot produce output or account action.
for ORIGIN in codex cursor; do
  H="$(make_project)"
  SID="sid-$ORIGIN-pacing"
  seed_board "$H" "$SID"
  cat >"$H/ccm" <<STUB
#!/usr/bin/env bash
printf '%s\n' "\$*" >>"$H/calls"
if [ "\$1 \$2" = "quota status" ]; then
  printf '{"schema":"ccm/machine-quota-status/v1","summary":{"schema":"ccm/machine-quota-summary/v1","decisions":[]},"readings":[],"capacity_views":{"schema":"ccm/machine-quota-capacity-views/v1","known_capacities":[],"unresolved_scope_digests":[],"unresolved_capacity_units":null}}\n'
  exit 0
fi
if [ "\$1 \$2" = "usage advise" ]; then
  printf '{"ok":true,"data":{"available":true,"verdict":"stop_5h","strength":"strong","window_5h_pct":100,"window_7d_pct":1}}\n'
  exit 0
fi
exit 17
STUB
  chmod +x "$H/ccm"
  if [ "$ORIGIN" = codex ]; then
    OUT="$(printf '{"session_id":"%s","hook_event_name":"Stop"}' "$SID" |
      CC_MASTER_HOME="$H" CCM_BIN="$H/ccm" node "$CODEX_LAUNCHER" --event Stop --core "$CODEX_PACING" 2>/dev/null)"
  else
    OUT="$(printf '{"conversation_id":"%s","session_id":"%s","hook_event_name":"stop"}' "$SID" "$SID" |
      CC_MASTER_HOME="$H" CCM_BIN="$H/ccm" node "$CURSOR_LAUNCHER" --event stop --core "$CURSOR_PACING" 2>/dev/null)"
  fi
  assert_eq "" "$OUT" "$ORIGIN empty cached summary is silent"
  assert_contains "$(cat "$H/calls")" "quota status --machine-wide" "$ORIGIN reads cached machine-wide quota"
  assert_not_contains "$(cat "$H/calls")" "usage advise" "$ORIGIN never invokes live legacy usage adapter"
  rm -rf "$H"
done

finish
