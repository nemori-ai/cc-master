#!/usr/bin/env bash
. "$(dirname "$0")/helpers.sh"

LAUNCHER="$REPO_ROOT/plugin/src/hooks/_hosts/cursor/launcher.js"
CORE="$REPO_ROOT/plugin/src/hooks/identity-nudge/implementations/cursor/identity-nudge-core.js"
NOW="2026-07-03T12:00:00Z"

mk_ccm_stub() {
  local dir stub
  dir="$(make_project)"
  stub="$dir/ccm"
  cat >"$stub" <<'STUB'
#!/usr/bin/env bash
if [ "$1" = "board" ] && [ "$2" = "set-param" ]; then
  shift 2; key="$1"; value="$2"; shift 2; board=""
  while [ $# -gt 0 ]; do case "$1" in --board) board="$2"; shift 2;; --home) shift 2;; *) shift;; esac; done
  node -e 'const fs=require("fs");const [b,k,v]=process.argv.slice(1);const o=JSON.parse(fs.readFileSync(b,"utf8"));o.runtime=o.runtime||{};o.runtime[k]=v;fs.writeFileSync(b,JSON.stringify(o,null,2)+"\n");' "$board" "$key" "$value"
  exit 0
fi
if [ "$1" = "board" ] && [ "$2" = "critical-path" ]; then
  board=""; while [ $# -gt 0 ]; do case "$1" in --board) board="$2"; shift 2;; *) shift;; esac; done
  node -e 'const fs=require("fs");const o=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));const chain=(o.tasks||[]).map(t=>t.id).filter(Boolean);process.stdout.write(JSON.stringify({ok:true,data:{chain}}));' "$board"
  exit 0
fi
if [ "$1" = "estimate" ] && [ "$2" = "evm" ]; then
  printf '{"ok":true,"data":{"has_baseline":true,"spi_t":0.8,"sv_t":-1}}'
  exit 0
fi
exit 2
STUB
  chmod +x "$stub"
  echo "$stub"
}

seed_board() {
  mkdir -p "$1/boards"
  printf '%s' "$2" >"$1/boards/mine.board.json"
}

runtime_value() {
  node -e 'const fs=require("fs");const o=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(String((o.runtime&&o.runtime[process.argv[2]])||""));' "$1/boards/mine.board.json" "$2"
}

run_stop() {
  local home="$1" sid="$2" active="${3:-false}" stub
  stub="$(mk_ccm_stub)"
  HOOK_OUT="$(
    printf '{"conversation_id":"%s","session_id":"%s","hook_event_name":"stop","stop_hook_active":%s}' "$sid" "$sid" "$active" |
      CC_MASTER_HOME="$home" CC_MASTER_NOW="$NOW" CCM_BIN="$stub" node "$LAUNCHER" --event stop --core "$CORE" 2>/dev/null
  )"
  HOOK_RC=$?
  rm -rf "$(dirname "$stub")"
}

chmod +x "$CORE"

# Both due: emits followup_message, writes both runtime timestamps, includes critpath.
H="$(make_project)"
seed_board "$H" '{"schema":"cc-master/v2","goal":"g","owner":{"active":true,"session_id":"sess-i"},"tasks":[{"id":"T1","status":"done","deps":[]},{"id":"T2","status":"in_flight","deps":["T1"]}],"runtime":{"last_identity_remind":"2026-07-03T00:00:00Z","last_critpath_remind":"2026-07-03T09:00:00Z"}}'
run_stop "$H" "sess-i"
assert_contains "$HOOK_OUT" '"followup_message"' "due -> followup_message"
assert_not_contains "$HOOK_OUT" '"additional_context"' "due -> not additional_context"
assert_contains "$HOOK_OUT" "身份周期提示" "identity nudge present"
assert_contains "$HOOK_OUT" "1/2 个任务" "critpath count present"
assert_contains "$HOOK_OUT" "behind schedule" "estimate verdict present"
assert_eq "$NOW" "$(runtime_value "$H" last_identity_remind)" "identity timestamp written"
assert_eq "$NOW" "$(runtime_value "$H" last_critpath_remind)" "critpath timestamp written"
rm -rf "$H"

# Not due: silent.
H="$(make_project)"
seed_board "$H" '{"schema":"cc-master/v2","goal":"g","owner":{"active":true,"session_id":"sess-i"},"tasks":[{"id":"T1","status":"in_flight","deps":[]}],"runtime":{"last_identity_remind":"2026-07-03T11:59:00Z","last_critpath_remind":"2026-07-03T11:59:00Z"}}'
run_stop "$H" "sess-i"
assert_eq "" "$HOOK_OUT" "not due -> silent"
rm -rf "$H"

# Re-entry and unarmed: silent.
H="$(make_project)"
seed_board "$H" '{"schema":"cc-master/v2","goal":"g","owner":{"active":true,"session_id":"sess-i"},"tasks":[{"id":"T1","status":"in_flight","deps":[]}],"runtime":{}}'
run_stop "$H" "sess-i" "true"
assert_eq "" "$HOOK_OUT" "stop_hook_active -> silent"
run_stop "$H" "sess-other"
assert_eq "" "$HOOK_OUT" "other session -> silent"
rm -rf "$H"

finish
