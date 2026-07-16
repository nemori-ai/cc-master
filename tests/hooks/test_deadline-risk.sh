#!/usr/bin/env bash
# Tests for the deadline-risk periodic entry of identity-nudge.js (交付 DDL 风险·issue #149·契约 §5·
# codex triage #6). The deadline-risk entry lives in the host-neutral _shared/deadline-risk-core.js, shared
# by all three host implementations; here we exercise it through the claude-code identity-nudge.js dist file.
#
# The entry fires ONLY when the board's goal_contract.deadline is settled (state ∈ {asserted,confirmed} + at).
# On a due check it spawns `ccm estimate deadline-risk --json` (RED LINE 3: hook only transports the verdict,
# never recomputes CPM/MC/RCPSP), writes runtime.last_deadline_risk_check + last_deadline_risk_fingerprint
# back via `ccm board set-param`, runs a hook-owned notification state machine (sidecar, not the board), and
# on a notify decision injects `<advisory source="deadline-risk" strength="weak|strong">` PLUS a durable
# deadline_risk coordination notification that it immediately self-acks (single delivery path). ccm absent /
# bad JSON / no DDL → silent (fail-safe). Never blocks Stop.
. "$(dirname "$0")/helpers.sh"

HOOK="$PLUGIN_ROOT/hooks/scripts/identity-nudge.js"

# ── STUB ccm emulating the verbs the deadline-risk entry (and the surrounding identity/critpath table) spawns.
#   · board set-param <key> <value> --board P            → write runtime.<key>=<value> (whitelist incl. the two
#                                                          new deadline-risk keys), exit 0.
#   · estimate deadline-risk --board P --json            → emit {ok,data:<CCM_STUB_DR>} (env drives the band).
#   · coordination notify --kind deadline_risk … --json  → emit a deterministic id, log the call to $CALL_LOG.
#   · coordination inbox ack <id> … --json               → emit {ok}, log the ack to $CALL_LOG.
#   · board critical-path --json --board P               → chain = board task ids (for the X/Y count).
#   · estimate evm --json --board P                      → log the call (should NOT happen when a DDL is settled).
STUB_DIR="$(make_project)"
STUB_CCM="$STUB_DIR/ccm-stub.sh"
CALL_LOG="$STUB_DIR/calls.log"
cat > "$STUB_CCM" <<'STUB'
#!/usr/bin/env bash
noun="$1"; verb="$2"
log() { [ -n "${CALL_LOG:-}" ] && printf '%s\n' "$*" >> "$CALL_LOG"; }
if [ "$noun" = "board" ] && [ "$verb" = "set-param" ]; then
  shift 2; key="$1"; val="$2"; shift 2; board=""
  while [ $# -gt 0 ]; do case "$1" in --board) board="$2"; shift 2;; --home) shift 2;; *) shift;; esac; done
  case "$key" in
    last_identity_remind|last_critpath_remind|last_goal_remind|last_deadline_risk_check|last_deadline_risk_fingerprint) ;;
    *) echo "error: not whitelisted: $key" >&2; exit 2;;
  esac
  node -e 'const fs=require("fs");const [b,k,v]=process.argv.slice(1);const o=JSON.parse(fs.readFileSync(b,"utf8"));o.runtime=o.runtime||{};o.runtime[k]=v;fs.writeFileSync(b,JSON.stringify(o,null,2)+"\n");' "$board" "$key" "$val"
  log "set-param $key=$val"
  exit 0
fi
if [ "$noun" = "estimate" ] && [ "$verb" = "deadline-risk" ]; then
  log "estimate-deadline-risk"
  if [ -n "${CCM_STUB_DR:-}" ]; then printf '{"ok":true,"data":%s}' "$CCM_STUB_DR"; else printf '{"ok":true,"data":{"risk_band":"unknown"}}'; fi
  exit 0
fi
if [ "$noun" = "coordination" ] && [ "$verb" = "notify" ]; then
  log "notify $*"
  printf '{"ok":true,"data":{"notification":{"id":"ntf-stub-1"}}}'
  exit 0
fi
if [ "$noun" = "coordination" ] && [ "$verb" = "inbox" ]; then
  # coordination inbox ack <id> … → after shift 2: $1=ack $2=<id>.
  shift 2; id="$2"; log "inbox-ack $id"
  printf '{"ok":true,"data":{"acked":["%s"]}}' "$id"
  exit 0
fi
if [ "$noun" = "board" ] && [ "$verb" = "critical-path" ]; then
  board=""; while [ $# -gt 0 ]; do case "$1" in --board) board="$2"; shift 2;; *) shift;; esac; done
  node -e 'const fs=require("fs");const b=process.argv[1];let chain=[];try{const o=JSON.parse(fs.readFileSync(b,"utf8"));chain=(o.tasks||[]).map(t=>t&&t.id).filter(Boolean);}catch(e){}process.stdout.write(JSON.stringify({ok:true,data:{chain,makespan:null,weight_source:"unit"}}));' "$board"
  exit 0
fi
if [ "$noun" = "estimate" ] && [ "$verb" = "evm" ]; then
  log "estimate-evm"   # a settled DDL should suppress this call
  printf '{"ok":true,"data":{"has_baseline":false,"spi_t":null,"sv_t":null}}'
  exit 0
fi
echo "stub: unhandled $*" >&2; exit 2
STUB
chmod +x "$STUB_CCM"

# NOW is a fixed clock; DDL is well in the future so time_remaining is large.
NOW="2026-07-16T12:00:00Z"
RECENT="2026-07-16T11:58:00Z"   # 2min ago → identity/critpath/goal NOT due (isolate deadline-risk)

# seed_home SID [LAST_DR_CHECK] [LAST_DR_FP] → home with an active board that has a SETTLED DDL and recent
#   identity/critpath/goal timestamps (so only the deadline-risk entry can fire).
seed_home() {
  local h; h="$(make_project)"; mkdir -p "$h/boards"
  local drcheck="${2:-}" drfp="${3:-}"
  local rt="\"last_identity_remind\":\"$RECENT\",\"last_critpath_remind\":\"$RECENT\",\"last_goal_remind\":\"$RECENT\""
  [ -n "$drcheck" ] && rt="$rt,\"last_deadline_risk_check\":\"$drcheck\""
  [ -n "$drfp" ] && rt="$rt,\"last_deadline_risk_fingerprint\":\"$drfp\""
  printf '{"schema":"cc-master/v2","goal":"ship DDL feature","goal_contract":{"schema":"ccm/goal-contract/v1","revision":1,"assurance":"confirmed","deadline":{"state":"confirmed","at":"2026-08-01T09:00:00Z","precision":"minute","kind":"hard","rev":1,"updated_at":"2026-07-16T00:00:00Z"},"updated_at":"2026-07-16T00:00:00Z"},"owner":{"active":true,"session_id":"%s","heartbeat":"2026-07-01T00:00:00Z"},"git":{"worktree":"","branch":""},"tasks":[{"id":"T1","status":"in_flight","deps":[]}],"runtime":{%s}}' "$1" "$rt" > "$h/boards/mine.board.json"
  echo "$h"
}

# dr_json BAND STRENGTH PROB → a deadline-risk `data` blob for the stub.
dr_json() {
  printf '{"deadline":"2026-08-01T09:00:00Z","deadline_state":"confirmed","as_of":"%s","time_remaining_hours":381.0,"on_time_probability":%s,"on_time_probability_source":"rcpsp-in-trial","risk_band":"%s","strength":"%s","margin":{"p50_h":40.0,"p80_h":12.0,"p95_h":-6.0,"basis":"x"},"channel_disagreement":0.12,"coverage_pct":60,"confidence":"medium","history_n":20,"calibration_status":"uncalibrated-conservative","top_drivers":[{"id":"T1","criticality":0.8,"sensitivity":0.6,"reason":"critical"}],"scope":"home","runs":2000,"seed":42,"source":"estimate","notes":[]}' "$NOW" "$3" "$1" "$2"
}

# run HOME SID [SIDECAR] [CCM_BIN] [DR_DATA] [STDIN] → sets HOOK_OUT / HOOK_RC (rm CALL_LOG first).
run() {
  local h="$1" sid="$2" sc="${3:-$STUB_DIR/notif.json}" ccm="${4:-$STUB_CCM}" dr="${5:-}" stdin="${6:-}"
  rm -f "$CALL_LOG"
  [ -n "$stdin" ] || stdin="$(printf '{"session_id":"%s","hook_event_name":"Stop"}' "$sid")"
  HOOK_OUT="$(printf '%s' "$stdin" \
    | CC_MASTER_HOME="$h" CC_MASTER_NOW="$NOW" CCM_BIN="$ccm" CALL_LOG="$CALL_LOG" \
      CC_MASTER_DEADLINE_RISK_SIDECAR="$sc" CCM_STUB_DR="$dr" \
      "$HOOK" 2>/dev/null)"; HOOK_RC=$?
}
seed_notif() { printf '%s' "$2" > "$1"; }   # $1 sidecar path, $2 JSON

# ════════════════════════════════════════════════════════════════════════════════════════════════════
# (1) green→watch: first entry into risk → weak advisory + write-back + durable self-ack.
H="$(seed_home s1)"; SC="$STUB_DIR/n1.json"
run "$H" s1 "$SC" "$STUB_CCM" "$(dr_json watch weak 0.85)"
assert_eq 0 "$HOOK_RC" "(1) watch → rc 0"
assert_contains "$HOOK_OUT" '<advisory source=\"deadline-risk\" strength=\"weak\">' "(1) watch → weak advisory tag"
assert_contains "$HOOK_OUT" "交付 DDL 风险周期提示" "(1) carries deadline-risk reminder text"
assert_contains "$HOOK_OUT" "risk band=watch" "(1) reports band=watch"
assert_contains "$HOOK_OUT" "首次进入风险" "(1) change reason = first entering risk"
assert_contains "$HOOK_OUT" "reconcile / replan" "(1) action prompt: global DAG reconcile/replan"
assert_not_contains "$HOOK_OUT" '"decision":"block"' "(1) NEVER blocks Stop"
assert_valid_json "$HOOK_OUT" "(1) single well-formed JSON object"
assert_eq "$NOW" "$(node -e 'const o=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(String(o.runtime.last_deadline_risk_check||""))' "$H/boards/mine.board.json")" "(1) writes last_deadline_risk_check=now"
assert_contains "$(cat "$CALL_LOG")" "notify" "(1) durable coordination notify emitted"
assert_contains "$(cat "$CALL_LOG")" "inbox-ack ntf-stub-1" "(1) durable notification immediately self-acked"
assert_not_contains "$(cat "$CALL_LOG")" "estimate-evm" "(1) settled DDL → critpath schedule suppressed → NO evm call"
rm -rf "$H" "$SC"

# (2) watch→at_risk: band worsened → strong advisory.
H="$(seed_home s2)"; SC="$STUB_DIR/n2.json"
seed_notif "$SC" '{"'"$H"'/boards/mine.board.json":{"last_band":"watch","last_prob":0.85,"last_fp":"watch|T1|0.85|2026-08-01T09:00:00Z","last_notified_at_ms":1,"last_top_driver":"T1"}}'
run "$H" s2 "$SC" "$STUB_CCM" "$(dr_json at_risk strong 0.55)"
assert_contains "$HOOK_OUT" '<advisory source=\"deadline-risk\" strength=\"strong\">' "(2) at_risk → strong advisory tag"
assert_contains "$HOOK_OUT" "risk band=at_risk" "(2) reports band=at_risk"
assert_contains "$HOOK_OUT" "band 恶化" "(2) change reason = band worsened"
rm -rf "$H" "$SC"

# (3) at_risk→likely_late: worsened again → strong.
H="$(seed_home s3)"; SC="$STUB_DIR/n3.json"
seed_notif "$SC" '{"'"$H"'/boards/mine.board.json":{"last_band":"at_risk","last_prob":0.55,"last_fp":"at_risk|T1|0.55|2026-08-01T09:00:00Z","last_notified_at_ms":1,"last_top_driver":"T1"}}'
run "$H" s3 "$SC" "$STUB_CCM" "$(dr_json likely_late strong 0.3)"
assert_contains "$HOOK_OUT" "risk band=likely_late" "(3) reports band=likely_late"
assert_contains "$HOOK_OUT" 'strength=\"strong\"' "(3) likely_late → strong"
rm -rf "$H" "$SC"

# (4) stable (dedup): re-checks (check 10min ago > 5min floor + fingerprint changed), but band+notif-fingerprint
#   match the sidecar's last delivered → dedup → SILENT (no spam), even though a fresh estimate ran.
STALE_CHECK="2026-07-16T11:50:00Z"   # 10min ago > 5min min-recheck floor
NOW_MS="$(node -e 'process.stdout.write(String(Date.parse("2026-07-16T12:00:00Z")-60000))')"   # 1min before NOW (reminder NOT due)
H="$(seed_home s4 "$STALE_CHECK" "PRIMEFP")"; SC="$STUB_DIR/n4.json"
seed_notif "$SC" '{"'"$H"'/boards/mine.board.json":{"last_band":"watch","last_prob":0.85,"last_fp":"watch|T1|0.85|2026-08-01T09:00:00Z","last_notified_at_ms":'"$NOW_MS"',"last_top_driver":"T1"}}'
run "$H" s4 "$SC" "$STUB_CCM" "$(dr_json watch weak 0.85)"
assert_eq "" "$HOOK_OUT" "(4) same band+fingerprint already delivered → silent (dedup, no spam)"
assert_contains "$(cat "$CALL_LOG")" "estimate-deadline-risk" "(4) still re-estimated (dedup is post-estimate, not skip-check)"
rm -rf "$H" "$SC"

# (5) recovery: last band at_risk → now on_track → ONE weak recovery notice.
H="$(seed_home s5)"; SC="$STUB_DIR/n5.json"
seed_notif "$SC" '{"'"$H"'/boards/mine.board.json":{"last_band":"at_risk","last_prob":0.5,"last_fp":"at_risk|T1|0.5|2026-08-01T09:00:00Z","last_notified_at_ms":1,"last_top_driver":"T1"}}'
run "$H" s5 "$SC" "$STUB_CCM" "$(dr_json on_track weak 0.95)"
assert_contains "$HOOK_OUT" "交付 DDL 风险恢复" "(5) recovery notice fired"
assert_contains "$HOOK_OUT" 'strength=\"weak\"' "(5) recovery is weak (good news)"
rm -rf "$H" "$SC"

# (6) unknown: low-confidence / no signal → NEVER false-green, no notify.
H="$(seed_home s6)"; SC="$STUB_DIR/n6.json"
run "$H" s6 "$SC" "$STUB_CCM" "$(dr_json unknown weak null)"
assert_eq "" "$HOOK_OUT" "(6) unknown band → silent (never maps to green, never notifies)"
rm -rf "$H" "$SC"

# (7) ccm absent → silent, no inject, no spam.
H="$(seed_home s7)"; SC="$STUB_DIR/n7.json"
run "$H" s7 "$SC" "/nonexistent-ccm-bin-xyz" "$(dr_json watch weak 0.85)"
assert_eq 0 "$HOOK_RC" "(7) ccm absent → rc 0"
assert_eq "" "$HOOK_OUT" "(7) ccm absent → silent (fail-safe)"
rm -rf "$H" "$SC"

# (8) no DDL: deadline pending → deadline-risk n/a → no inject; and critpath keeps its schedule clause.
H="$(make_project)"; mkdir -p "$H/boards"; SC="$STUB_DIR/n8.json"
printf '{"schema":"cc-master/v2","goal":"g","goal_contract":{"schema":"ccm/goal-contract/v1","revision":1,"assurance":"asserted","deadline":{"state":"pending"},"updated_at":"2026-07-16T00:00:00Z"},"owner":{"active":true,"session_id":"s8","heartbeat":"2026-07-01T00:00:00Z"},"git":{"worktree":"","branch":""},"tasks":[{"id":"T1","status":"in_flight","deps":[]}],"runtime":{"last_identity_remind":"%s","last_goal_remind":"%s","last_critpath_remind":"2026-07-16T05:00:00Z"}}' "$RECENT" "$RECENT" > "$H/boards/mine.board.json"
run "$H" s8 "$SC"
assert_not_contains "$HOOK_OUT" "deadline-risk" "(8) no settled DDL → deadline-risk n/a (no inject)"
assert_contains "$HOOK_OUT" "临界路径周期提示" "(8) critpath still fires (critpath was due)"
assert_not_contains "$HOOK_OUT" "本板有交付 DDL" "(8) no DDL → critpath keeps normal (non-suppressed) form"
rm -rf "$H" "$SC"

# (9) not due + fingerprint unchanged → no re-check (silent, no estimate call).
H="$(seed_home s9 "$RECENT")"; SC="$STUB_DIR/n9.json"
# Prime the board fingerprint to the CURRENT computed value so fingerprint is unchanged AND check is recent.
FP="$(node -e 'const c=require(process.argv[2]);const o=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(c.computeRiskFingerprint(o))' "$H/boards/mine.board.json" "$PWD/plugin/dist/claude-code/hooks/_shared/deadline-risk-core.js")"
node -e 'const fs=require("fs"),p=process.argv[1],fp=process.argv[2];const o=JSON.parse(fs.readFileSync(p,"utf8"));o.runtime.last_deadline_risk_fingerprint=fp;fs.writeFileSync(p,JSON.stringify(o));' "$H/boards/mine.board.json" "$FP"
run "$H" s9 "$SC" "$STUB_CCM" "$(dr_json at_risk strong 0.5)"
assert_eq "" "$HOOK_OUT" "(9) recent check + unchanged fingerprint → not due → silent"
assert_not_contains "$(cat "$CALL_LOG" 2>/dev/null || true)" "estimate-deadline-risk" "(9) not due → no estimate spawn"
rm -rf "$H" "$SC"

# (10) fingerprint change forces recheck within cadence (check 10min ago < 2h cadence but > 5min floor) → notifies.
H="$(seed_home s10 "2026-07-16T11:50:00Z" "STALE-FP")"; SC="$STUB_DIR/n10.json"
run "$H" s10 "$SC" "$STUB_CCM" "$(dr_json at_risk strong 0.5)"
assert_contains "$HOOK_OUT" "risk band=at_risk" "(10) changed fingerprint → re-checks + notifies within cadence"
rm -rf "$H" "$SC"

# (11) critpath suppression: with a settled DDL and critpath due, critpath reports X/Y but NO schedule verdict.
H="$(seed_home s11)"; SC="$STUB_DIR/n11.json"
node -e 'const fs=require("fs"),p=process.argv[1],o=JSON.parse(fs.readFileSync(p,"utf8"));o.runtime.last_critpath_remind="2026-07-16T05:00:00Z";fs.writeFileSync(p,JSON.stringify(o));' "$H/boards/mine.board.json"
run "$H" s11 "$SC" "$STUB_CCM" "$(dr_json watch weak 0.85)"
assert_contains "$HOOK_OUT" "临界路径周期提示" "(11) critpath fired"
assert_contains "$HOOK_OUT" "本板有交付 DDL" "(11) settled DDL → critpath shows dedup form (schedule verdict → deadline-risk)"
assert_not_contains "$(cat "$CALL_LOG")" "estimate-evm" "(11) settled DDL → critpath skips evm spawn (no duplicated compute)"
rm -rf "$H" "$SC"

# (12) Stop re-entry (stop_hook_active) → silent.
H="$(seed_home s12)"; SC="$STUB_DIR/n12.json"
run "$H" s12 "$SC" "$STUB_CCM" "$(dr_json at_risk strong 0.5)" '{"session_id":"s12","hook_event_name":"Stop","stop_hook_active":true}'
assert_eq "" "$HOOK_OUT" "(12) stop_hook_active:true → silent (re-entry guard, no Stop loop)"
rm -rf "$H" "$SC"

# (13) unarmed (board owned by another session) → silent even with risk.
H="$(seed_home other)"; SC="$STUB_DIR/n13.json"
run "$H" mine "$SC" "$STUB_CCM" "$(dr_json overdue strong 0.1)"
assert_eq "" "$HOOK_OUT" "(13) other session's board → silent (dormant-until-armed)"
rm -rf "$H" "$SC"

rm -rf "$STUB_DIR"
finish
