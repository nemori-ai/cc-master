#!/usr/bin/env bash
. "$(dirname "$0")/helpers.sh"

CLAUDE_HOOK="$PLUGIN_ROOT/hooks/scripts/coordination-inbox.js"
CODEX_LAUNCHER="$REPO_ROOT/plugin/src/hooks/_hosts/codex/launcher.js"
CODEX_CORE="$REPO_ROOT/plugin/src/hooks/coordination-inbox/implementations/codex/coordination-inbox-core.js"
CURSOR_LAUNCHER="$REPO_ROOT/plugin/src/hooks/_hosts/cursor/launcher.js"
CURSOR_CORE="$REPO_ROOT/plugin/src/hooks/coordination-inbox/implementations/cursor/coordination-inbox-core.js"

NOW="2026-07-09T12:00:00Z"

seed_board() {
  mkdir -p "$1/boards"
  printf '{"schema":"cc-master/v2","goal":"g","owner":{"active":true,"session_id":"%s"},"tasks":[{"id":"T1","status":"in_flight","deps":[]}]}' "$2" >"$1/boards/armed.board.json"
}

mk_ccm_stub() {
  local dir stub payload current marker origin sid
  dir="$(make_project)"
  stub="$dir/ccm"
  payload="$dir/inbox.json"
  current="$dir/current.json"
  marker="$dir/ack-called"
  origin="$2"
  sid="$3"
  printf '%s' "$1" >"$payload"
  ORIGIN="$origin" SID="$sid" node - "$payload" <<'NODE'
const fs = require('node:fs');
const file = process.argv[2];
const value = JSON.parse(fs.readFileSync(file, 'utf8'));
const subscription = {
  subscription_id: 'sub-fixture',
  session_id: process.env.SID,
  session_epoch: 'epoch-fixture',
  origin: process.env.ORIGIN,
  capability: 'coordination-inbox',
};
value.data.subscription = subscription;
for (const item of value.data.inbox) {
  item.delivery_provenance = {
    ...subscription,
    source_policy_revision: 'ccm/cached-board-inbox/v1',
    consent_provenance_ref: 'ccm://coordination/subscriptions/cached-only',
  };
}
fs.writeFileSync(file, JSON.stringify(value));
NODE
  printf '{"ok":true,"data":{"subscription":{"subscription_id":"sub-fixture","session_id":"%s","session_epoch":"epoch-fixture","origin":"%s","capability":"coordination-inbox","state":"current"}}}' \
    "$sid" "$origin" >"$current"
  cat >"$stub" <<STUB
#!/usr/bin/env bash
if [ "\$1" = "coordination" ] && [ "\$2" = "subscription" ] && [ "\$3" = "current" ]; then
  cat "$current"
  exit 0
fi
if [ "\$1" = "coordination" ] && [ "\$2" = "inbox" ] && [ "\$3" = "list" ]; then
  cat "$payload"
  exit 0
fi
if [ "\$1" = "coordination" ] && [ "\$2" = "inbox" ] && [ "\$3" = "ack" ]; then
  touch "$marker"
  exit 0
fi
exit 0
STUB
  chmod +x "$stub"
  echo "$stub"
}

INBOX_JSON='{"ok":true,"data":{"count":2,"inbox":[{"id":"ntf-1","kind":"pacing_throttle","status":"unconsumed","created_at":"2026-07-09T11:59:00Z","expires_at":"2026-07-09T13:00:00Z","strength":"strong","summary":"Slow down this board","payload":{"verdict":"throttle"},"consumed_at":null,"consumed_note":null},{"id":"ntf-2","kind":"pacing_stop","status":"unconsumed","created_at":"2026-07-09T11:59:00Z","expires_at":"2026-07-09T13:00:00Z","strength":"strong","summary":"Pause dispatch","payload":{"verdict":"stop_7d"},"consumed_at":null,"consumed_note":null}]}}'

chmod +x "$CODEX_CORE" "$CURSOR_CORE"

# Claude Code: additionalContext, advisory+directive tags, no ack, repeat suppression by sidecar.
H="$(make_project)"
seed_board "$H" "sess-i"
STUB="$(mk_ccm_stub "$INBOX_JSON" "claude-code" "sess-i")"
STATE="$H/inbox-state.json"
HOOK_OUT="$(printf '{"session_id":"sess-i","hook_event_name":"Stop"}' |
  CC_MASTER_HOME="$H" CC_MASTER_NOW="$NOW" CC_MASTER_INBOX_SURFACE_STATE="$STATE" CCM_BIN="$STUB" node "$CLAUDE_HOOK" 2>/dev/null)"
HOOK_RC=$?
assert_eq 0 "$HOOK_RC" "claude coordination-inbox -> rc 0"
assert_contains "$HOOK_OUT" '"additionalContext"' "claude coordination-inbox -> additionalContext"
assert_contains "$HOOK_OUT" '<advisory source=\"coordination-inbox\" strength=\"strong\">' "pacing_throttle -> advisory strong"
assert_contains "$HOOK_OUT" '<directive source=\"coordination-inbox\">' "pacing_stop -> directive"
assert_contains "$HOOK_OUT" "acknowledge it explicitly with ccm coordination inbox ack using the id above" "explicit ack guidance present"
assert_no_file "$(dirname "$STUB")/ack-called" "coordination-inbox must not call ack"
HOOK_OUT="$(printf '{"session_id":"sess-i","hook_event_name":"Stop"}' |
  CC_MASTER_HOME="$H" CC_MASTER_NOW="$NOW" CC_MASTER_INBOX_SURFACE_STATE="$STATE" CCM_BIN="$STUB" node "$CLAUDE_HOOK" 2>/dev/null)"
assert_eq "" "$HOOK_OUT" "same ids inside cooldown -> suppressed"
rm -rf "$H" "$(dirname "$STUB")"

# Codex: launcher maps core kind:system to systemMessage.
H="$(make_project)"
seed_board "$H" "sess-cx"
STUB="$(mk_ccm_stub "$INBOX_JSON" "codex" "sess-cx")"
HOOK_OUT="$(printf '{"session_id":"sess-cx","hook_event_name":"Stop"}' |
  CC_MASTER_HOME="$H" CC_MASTER_NOW="$NOW" CC_MASTER_INBOX_SURFACE_STATE="$H/state.json" CCM_BIN="$STUB" \
    node "$CODEX_LAUNCHER" --event Stop --core "$CODEX_CORE" 2>/dev/null)"
assert_contains "$HOOK_OUT" '"systemMessage"' "codex coordination-inbox -> systemMessage"
assert_contains "$HOOK_OUT" 'source=\"coordination-inbox\"' "codex coordination-inbox -> tagged source"
rm -rf "$H" "$(dirname "$STUB")"

# Cursor: launcher maps core kind:system to followup_message.
H="$(make_project)"
seed_board "$H" "sess-cur"
STUB="$(mk_ccm_stub "$INBOX_JSON" "cursor" "sess-cur")"
HOOK_OUT="$(printf '{"conversation_id":"sess-cur","session_id":"sess-cur","hook_event_name":"stop"}' |
  CC_MASTER_HOME="$H" CC_MASTER_NOW="$NOW" CC_MASTER_INBOX_SURFACE_STATE="$H/state.json" CCM_BIN="$STUB" \
    node "$CURSOR_LAUNCHER" --event stop --core "$CURSOR_CORE" 2>/dev/null)"
assert_contains "$HOOK_OUT" '"followup_message"' "cursor coordination-inbox -> followup_message"
assert_contains "$HOOK_OUT" 'source=\"coordination-inbox\"' "cursor coordination-inbox -> tagged source"
rm -rf "$H" "$(dirname "$STUB")"

finish
