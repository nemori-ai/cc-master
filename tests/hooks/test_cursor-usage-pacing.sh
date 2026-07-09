#!/usr/bin/env bash
. "$(dirname "$0")/helpers.sh"

LAUNCHER="$REPO_ROOT/plugin/src/hooks/_hosts/cursor/launcher.js"
CORE="$REPO_ROOT/plugin/src/hooks/usage-pacing/implementations/cursor/usage-pacing-core.js"

seed_board() {
  mkdir -p "$1/boards"
  printf '{"schema":"cc-master/v2","goal":"g","owner":{"active":true,"session_id":"%s"},"tasks":[{"id":"T1","status":"in_flight","deps":[]}]}' "$2" >"$1/boards/armed.board.json"
}

mk_ccm_stub() {
  local dir stub payload
  dir="$(make_project)"
  stub="$dir/ccm"
  payload="$dir/payload.json"
  printf '%s' "$1" >"$payload"
  cat >"$stub" <<STUB
#!/usr/bin/env bash
if [ "\$1" = "usage" ] && [ "\$2" = "advise" ]; then
  printf '{"ok":true,"data":%s}\\n' "\$(cat "$payload")"
  exit 0
fi
exit 0
STUB
  chmod +x "$stub"
  echo "$stub"
}

run_stop() {
  local home="$1" sid="$2" payload="$3" active="${4:-false}" stub
  stub="$(mk_ccm_stub "$payload")"
  HOOK_OUT="$(
    printf '{"conversation_id":"%s","session_id":"%s","hook_event_name":"stop","stop_hook_active":%s}' "$sid" "$sid" "$active" |
      CC_MASTER_HOME="$home" CCM_BIN="$stub" node "$LAUNCHER" --event stop --core "$CORE" 2>/dev/null
  )"
  HOOK_RC=$?
  rm -rf "$(dirname "$stub")"
}

chmod +x "$CORE"

ADV_HOLD='{"verdict":"hold","strength":"weak","reason":"r","levers":[],"window_billing_period_pct":40,"window_5h_pct":null,"window_7d_pct":null,"effective_n":1,"available":true}'
ADV_THROTTLE='{"verdict":"throttle","strength":"strong","reason":"r","levers":[],"window_billing_period_pct":82,"window_5h_pct":null,"window_7d_pct":null,"effective_n":1,"available":true}'
ADV_STOP_BP='{"verdict":"stop_billing_period","strength":"strong","reason":"r","levers":[],"window_billing_period_pct":90,"window_5h_pct":null,"window_7d_pct":null,"nearest_reset":"2026-08-01T00:00:00Z","available":true}'
ADV_SWITCH='{"verdict":"switch","strength":"weak","reason":"r","levers":[],"window_5h_pct":92,"window_7d_pct":20,"effective_n":2,"switch_candidate":"b@example.com","available":true}'
ADV_STOP5='{"verdict":"stop_5h","strength":"strong","reason":"r","levers":[],"window_5h_pct":99,"window_7d_pct":70,"nearest_reset":"2026-07-03T12:00:00Z","available":true}'
ADV_STOP7='{"verdict":"stop_7d","strength":"strong","reason":"r","levers":[],"window_5h_pct":40,"window_7d_pct":88,"available":true}'
ADV_UNAVAILABLE='{"verdict":"hold","strength":"weak","reason":"r","levers":[],"available":false}'

H="$(make_project)"
seed_board "$H" "sess-u"

run_stop "$H" "sess-u" "$ADV_HOLD"
assert_eq "" "$HOOK_OUT" "hold -> silent"

run_stop "$H" "sess-u" "$ADV_THROTTLE"
assert_contains "$HOOK_OUT" '"followup_message"' "throttle -> followup_message"
assert_not_contains "$HOOK_OUT" '"additional_context"' "throttle -> not additional_context"
assert_contains "$HOOK_OUT" "Slow down" "throttle -> slowdown wording"
assert_contains "$HOOK_OUT" "billing_period" "throttle -> billing_period wording"
assert_contains "$HOOK_OUT" "82%" "throttle -> includes billing_period pct"
assert_not_contains "$HOOK_OUT" "5h" "throttle -> no 5h"
assert_not_contains "$HOOK_OUT" "7d" "throttle -> no 7d"
assert_not_contains "$HOOK_OUT" "switch" "throttle -> no switch"

run_stop "$H" "sess-u" "$ADV_STOP_BP"
assert_contains "$HOOK_OUT" '"followup_message"' "stop_billing_period -> followup_message"
assert_contains "$HOOK_OUT" "Pause new dispatch until billing reset at 2026-08-01T00:00:00Z" "stop_billing_period -> reset advice"
assert_not_contains "$HOOK_OUT" "5h" "stop_billing_period -> no 5h"
assert_not_contains "$HOOK_OUT" "7d" "stop_billing_period -> no 7d"
assert_not_contains "$HOOK_OUT" "switch" "stop_billing_period -> no switch"

run_stop "$H" "sess-u" "$ADV_SWITCH"
assert_eq "" "$HOOK_OUT" "switch verdict -> silent (defensive)"

run_stop "$H" "sess-u" "$ADV_STOP5"
assert_eq "" "$HOOK_OUT" "stop_5h verdict -> silent (defensive)"

run_stop "$H" "sess-u" "$ADV_STOP7"
assert_eq "" "$HOOK_OUT" "stop_7d verdict -> silent (defensive)"

run_stop "$H" "sess-u" "$ADV_UNAVAILABLE"
assert_eq "" "$HOOK_OUT" "available false -> silent"

run_stop "$H" "sess-u" "$ADV_THROTTLE" "true"
assert_eq "" "$HOOK_OUT" "stop_hook_active true -> silent"

rm -rf "$H"

H="$(make_project)"
run_stop "$H" "sess-unarmed" "$ADV_THROTTLE"
assert_eq "" "$HOOK_OUT" "unarmed -> silent"
rm -rf "$H"

finish
