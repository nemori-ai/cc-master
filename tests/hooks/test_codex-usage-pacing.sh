#!/usr/bin/env bash
. "$(dirname "$0")/helpers.sh"

LAUNCHER="$REPO_ROOT/plugin/src/hooks/_hosts/codex/launcher.js"
CORE="$REPO_ROOT/plugin/src/hooks/usage-pacing/implementations/codex/usage-pacing-core.js"

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
    printf '{"session_id":"%s","hook_event_name":"Stop","stop_hook_active":%s}' "$sid" "$active" |
      CC_MASTER_HOME="$home" CCM_BIN="$stub" node "$LAUNCHER" --event Stop --core "$CORE" 2>/dev/null
  )"
  HOOK_RC=$?
  rm -rf "$(dirname "$stub")"
}

chmod +x "$CORE"

ADV_HOLD='{"verdict":"hold","strength":"weak","reason":"r","levers":[],"window_5h_pct":50,"window_7d_pct":20,"effective_n":1,"available":true}'
ADV_THROTTLE='{"verdict":"throttle","strength":"strong","reason":"r","levers":[],"window_5h_pct":92,"window_7d_pct":40,"effective_n":1,"available":true}'
ADV_SWITCH='{"verdict":"switch","strength":"weak","reason":"r","levers":[],"window_5h_pct":92,"window_7d_pct":20,"effective_n":2,"switch_candidate":"b@example.com","available":true}'
ADV_STOP5='{"verdict":"stop_5h","strength":"strong","reason":"r","levers":[],"window_5h_pct":99,"window_7d_pct":70,"nearest_reset":"2026-07-03T12:00:00Z","available":true}'
ADV_STOP7='{"verdict":"stop_7d","strength":"strong","reason":"r","levers":[],"window_5h_pct":40,"window_7d_pct":88,"available":true}'
ADV_UNAVAILABLE='{"verdict":"hold","strength":"weak","reason":"r","levers":[],"available":false}'

H="$(make_project)"
seed_board "$H" "sess-u"

run_stop "$H" "sess-u" "$ADV_HOLD"
assert_eq "" "$HOOK_OUT" "hold -> silent"

run_stop "$H" "sess-u" "$ADV_THROTTLE"
assert_contains "$HOOK_OUT" '"systemMessage"' "throttle -> systemMessage"
assert_contains "$HOOK_OUT" "Slow down" "throttle -> slowdown wording"
assert_contains "$HOOK_OUT" "5h 92%" "throttle -> includes 5h pct"

run_stop "$H" "sess-u" "$ADV_SWITCH"
assert_contains "$HOOK_OUT" "not implemented" "switch -> no autoswitch in Codex"
assert_contains "$HOOK_OUT" "b@example.com" "switch -> candidate included"

run_stop "$H" "sess-u" "$ADV_STOP5"
assert_contains "$HOOK_OUT" "Pause new dispatch until reset at 2026-07-03T12:00:00Z" "stop_5h -> reset advice"

run_stop "$H" "sess-u" "$ADV_STOP7"
assert_contains "$HOOK_OUT" "surface the decision to the user" "stop_7d -> surface user"

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
