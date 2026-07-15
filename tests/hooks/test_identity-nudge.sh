#!/usr/bin/env bash
# Tests for identity-nudge.js (PERIODIC PROMPTS — node Stop hook, ADR-020 + hooks-enhancements-v2 ②). The
# hook runs a periodic-prompt table [identity, critpath]:
#   ① IDENTITY (default 6h): re-asserts "you are a master orchestrator" via a NON-BLOCKING
#      <advisory source="identity-nudge" strength="weak"> additionalContext (hookEventName "Stop"). Reads
#      board.runtime.last_identity_remind to gate the interval.
#   ② CRITPATH (default 2h): reports the critical-path progress X/Y (+ ccm estimate on-track/behind verdict,
#      degraded to no-verdict when no baseline) via <advisory source="critpath-nudge" strength="weak">. Reads
#      board.runtime.last_critpath_remind to gate. X/Y = chain ∩ tasks[].status pure count (red line 2/3:
#      ccm出图 critical-path, hook just counts). spawns ccm only when due.
# Both write their timestamp BACK via `ccm board set-param` (process boundary) and inject ONLY when the
# write-back succeeds (no spam when ccm absent). Both armed-gated, silent on Stop re-entry, ccm-absent silent.
#
# helpers.sh::run_hook is bash-only; we invoke the .js by its shebang and inject fixtures via the env
# override points the hook exposes (CC_MASTER_NOW / CC_MASTER_IDNUDGE_INTERVAL_SEC /
# CC_MASTER_CRITPATH_INTERVAL_SEC / CCM_BIN). We do NOT modify helpers.sh.
. "$(dirname "$0")/helpers.sh"

HOOK="$PLUGIN_ROOT/hooks/scripts/identity-nudge.js"

# ── STUB ccm: a tiny shell emulating the THREE ccm verbs this hook spawns:
#   · `ccm board set-param <key> <value> --board <path>` → write runtime.<key>=<value>, exit 0 (whitelist
#     = last_identity_remind + last_critpath_remind; others exit 2 like the real verb).
#   · `ccm board critical-path --json --board <path>` → emit {ok,data:{chain,...}} where chain = the board's
#     task ids in dependency order (a deterministic stub: just lists tasks[].id). Empty tasks → empty chain.
#   · `ccm estimate evm --json --board <path>` → emit {ok,data:{has_baseline:false,...}} (no baseline →
#     critpath nudge degrades to no-verdict). A separate "behind" stub variant is built inline per-case.
# Driving via this stub lets us exercise BOTH nudges WITHOUT building the real ccm SEA. ccm-absent cases
# point CCM_BIN at a nonexistent path (→ spawn fails → no inject).
STUB_DIR="$(make_project)"
STUB_CCM="$STUB_DIR/ccm-stub.sh"
cat > "$STUB_CCM" <<'STUB'
#!/usr/bin/env bash
# Demux: $1=noun ($1=board|estimate), $2=verb.
noun="$1"; verb="$2"
if [ "$noun" = "board" ] && [ "$verb" = "set-param" ]; then
  shift 2; key="$1"; val="$2"; shift 2; board=""
  while [ $# -gt 0 ]; do case "$1" in --board) board="$2"; shift 2;; --home) shift 2;; *) shift;; esac; done
  # whitelist mirrors the real verb (identity + critpath + goal); others exit 2.
  if [ "$key" != "last_identity_remind" ] && [ "$key" != "last_critpath_remind" ] && [ "$key" != "last_goal_remind" ]; then
    echo "error: not whitelisted" >&2; exit 2; fi
  node -e 'const fs=require("fs");const [b,k,v]=process.argv.slice(1);const o=JSON.parse(fs.readFileSync(b,"utf8"));o.runtime=o.runtime||{};o.runtime[k]=v;fs.writeFileSync(b,JSON.stringify(o,null,2)+"\n");' "$board" "$key" "$val"
  exit 0
fi
if [ "$noun" = "board" ] && [ "$verb" = "critical-path" ]; then
  board=""; while [ $# -gt 0 ]; do case "$1" in --board) board="$2"; shift 2;; *) shift;; esac; done
  # chain = the board's task ids (deterministic stub — exercises the X/Y count path).
  node -e 'const fs=require("fs");const b=process.argv[1];let chain=[];try{const o=JSON.parse(fs.readFileSync(b,"utf8"));chain=(o.tasks||[]).map(t=>t&&t.id).filter(Boolean);}catch(e){}process.stdout.write(JSON.stringify({ok:true,data:{chain,makespan:null,weight_source:"unit"}}));' "$board"
  exit 0
fi
if [ "$noun" = "estimate" ] && [ "$verb" = "evm" ]; then
  # default: no baseline (critpath nudge degrades to no-verdict). CCM_STUB_EVM env overrides the data blob.
  if [ -n "${CCM_STUB_EVM:-}" ]; then printf '%s' "$CCM_STUB_EVM"; else printf '%s' '{"ok":true,"data":{"has_baseline":false,"spi_t":null,"sv_t":null}}'; fi
  exit 0
fi
echo "stub: unhandled $*" >&2; exit 2
STUB
chmod +x "$STUB_CCM"

# seed_home SID [LAST_IDENTITY] [LAST_CRITPATH] -> echo a fresh home holding an active board owned by SID,
# with optional runtime timestamps seeded. board-v2 layout: board under <home>/boards/. By default seeds a
# RECENT last_critpath_remind (== NOW-ish baseline 2026-06-29T11:55:00Z) so critpath is NOT due in the
# identity-focused cases (they only want to exercise the identity nudge). Pass an explicit 3rd arg to drive
# critpath due/not-due deliberately.
seed_home() {
  local h; h="$(make_project)"; mkdir -p "$h/boards"
  local lastid="${2:-}" lastcp="${3:-2026-06-29T11:55:00Z}"   # default critpath: 5min ago < 2h → not due
  local rt=""
  rt="$rt\"last_identity_remind\":\"$lastid\""
  rt="$rt,\"last_critpath_remind\":\"$lastcp\",\"last_goal_remind\":\"2026-06-29T11:55:00Z\""
  # if lastid empty, drop the identity key entirely (first-time case wants it ABSENT).
  if [ -z "$lastid" ]; then rt="\"last_critpath_remind\":\"$lastcp\",\"last_goal_remind\":\"2026-06-29T11:55:00Z\""; fi
  printf '{"schema":"cc-master/v2","goal":"g","goal_contract":{"schema":"ccm/goal-contract/v1","revision":3,"assurance":"confirmed","updated_at":"2026-06-29T00:00:00Z"},"owner":{"active":true,"session_id":"%s","heartbeat":"2026-06-01T00:00:00Z"},"git":{"worktree":"","branch":""},"tasks":[{"id":"T1","status":"in_flight","deps":[]}],"runtime":{%s}}' "$1" "$rt" > "$h/boards/mine.board.json"
  echo "$h"
}

# run_idnudge HOME SID NOW [STDIN_JSON] [CCM_BIN_OVERRIDE] -> sets HOOK_OUT / HOOK_RC.
run_idnudge() {
  local stdin="${4:-}"; [ -n "$stdin" ] || stdin="$(printf '{"session_id":"%s","hook_event_name":"Stop"}' "$2")"
  local ccm="${5:-$STUB_CCM}"
  HOOK_OUT="$(printf '%s' "$stdin" \
    | CC_MASTER_HOME="$1" CC_MASTER_NOW="$3" CCM_BIN="$ccm" \
      "$HOOK" 2>/dev/null)"; HOOK_RC=$?
}

# board_runtime_remind HOME -> echo the persisted runtime.last_identity_remind (empty if absent).
board_runtime_remind() {
  node -e 'const fs=require("fs");const b=process.argv[1];try{const o=JSON.parse(fs.readFileSync(b,"utf8"));process.stdout.write(String((o.runtime&&o.runtime.last_identity_remind)||""));}catch(e){}' "$1/boards/mine.board.json"
}
# board_runtime_critpath HOME -> echo the persisted runtime.last_critpath_remind (empty if absent).
board_runtime_critpath() {
  node -e 'const fs=require("fs");const b=process.argv[1];try{const o=JSON.parse(fs.readFileSync(b,"utf8"));process.stdout.write(String((o.runtime&&o.runtime.last_critpath_remind)||""));}catch(e){}' "$1/boards/mine.board.json"
}
board_runtime_goal() {
  node -e 'const o=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(String((o.runtime&&o.runtime.last_goal_remind)||""));' "$1/boards/mine.board.json"
}

NOW="2026-06-29T12:00:00Z"

# ── (a) DUE (last remind > 6h ago) → injects weak advisory + writes timestamp back, non-blocking, rc 0 ──
H="$(seed_home "sess-a" "2026-06-29T05:00:00Z")"   # 7h ago > 6h interval → due
run_idnudge "$H" "sess-a" "$NOW"
assert_eq 0 "$HOOK_RC" "(a) due → rc 0"
assert_contains "$HOOK_OUT" "additionalContext" "(a) due → injects additionalContext"
assert_contains "$HOOK_OUT" '"hookEventName":"Stop"' "(a) hookEventName is Stop"
assert_contains "$HOOK_OUT" "master orchestrator" "(a) carries the identity-nudge text"
assert_contains "$HOOK_OUT" '<advisory source=\"identity-nudge\" strength=\"weak\">' "(a) tag-wrapped advisory weak (ADR-018)"
assert_not_contains "$HOOK_OUT" '"decision":"block"' "(a) NEVER blocks — non-blocking only"
assert_valid_json "$HOOK_OUT" "(a) emits a single well-formed JSON object"
assert_eq "$NOW" "$(board_runtime_remind "$H")" "(a) writes last_identity_remind BACK to now (via ccm set-param)"
rm -rf "$H"

# Goal alignment has an independent cadence and names the immutable revision.
H="$(seed_home "sess-goal" "2026-06-29T11:55:00Z")"
node -e 'const fs=require("fs"),p=process.argv[1],o=JSON.parse(fs.readFileSync(p,"utf8"));delete o.runtime.last_goal_remind;fs.writeFileSync(p,JSON.stringify(o));' "$H/boards/mine.board.json"
run_idnudge "$H" "sess-goal" "$NOW"
assert_contains "$HOOK_OUT" "目标对齐周期提示" "goal cadence emits alignment reminder"
assert_contains "$HOOK_OUT" "r3 confirmed" "goal reminder names revision and assurance"
assert_contains "$HOOK_OUT" "有用不等于相关" "goal reminder rejects useful-but-unrelated drift"
assert_eq "$NOW" "$(board_runtime_goal "$H")" "goal cadence writes last_goal_remind"
rm -rf "$H"

# ── (b) NOT DUE (last remind 1h ago < 6h interval) → silent, rc 0, no write ─────────────────────────
H="$(seed_home "sess-b" "2026-06-29T11:00:00Z")"   # 1h ago < 6h → not due
run_idnudge "$H" "sess-b" "$NOW"
assert_eq 0 "$HOOK_RC" "(b) not due → rc 0"
assert_eq "" "$HOOK_OUT" "(b) within interval → silent (no nudge)"
assert_eq "2026-06-29T11:00:00Z" "$(board_runtime_remind "$H")" "(b) not due → timestamp unchanged"
rm -rf "$H"

# ── (c) FIRST-TIME (no runtime.last_identity_remind at all) → due (treat as never reminded) → injects ──
H="$(seed_home "sess-c")"   # no runtime field
run_idnudge "$H" "sess-c" "$NOW"
assert_eq 0 "$HOOK_RC" "(c) first-time → rc 0"
assert_contains "$HOOK_OUT" "additionalContext" "(c) missing last_identity_remind → first Stop nudges (seeds timestamp)"
assert_eq "$NOW" "$(board_runtime_remind "$H")" "(c) first-time → seeds last_identity_remind=now"
rm -rf "$H"

# ── (d) UNARMED (board owned by another session) → silent even when due (armed gate, red line 6) ──────
H="$(seed_home "sess-other" "2026-06-29T05:00:00Z")"
run_idnudge "$H" "sess-mine" "$NOW"   # stdin sid != board owner sid
assert_eq 0 "$HOOK_RC" "(d) unarmed → rc 0"
assert_eq "" "$HOOK_OUT" "(d) other session's board → silent even when due (dormant-until-armed)"
rm -rf "$H"

# (d2) UNARMED — empty home (no board at all) → silent.
H="$(make_project)"; mkdir -p "$H/boards"
run_idnudge "$H" "sess-empty" "$NOW"
assert_eq 0 "$HOOK_RC" "(d2) empty home → rc 0"
assert_eq "" "$HOOK_OUT" "(d2) no board → silent (not armed)"
rm -rf "$H"

# ── (e) CCM ABSENT (CCM_BIN → nonexistent) → due but write-back fails → silent, NO spam, no inject ────
H="$(seed_home "sess-e" "2026-06-29T05:00:00Z")"   # due
run_idnudge "$H" "sess-e" "$NOW" "" "/nonexistent-ccm-bin-xyz"
assert_eq 0 "$HOOK_RC" "(e) ccm absent → rc 0"
assert_eq "" "$HOOK_OUT" "(e) ccm absent → write-back fails → silent (no inject, no spam)"
assert_eq "2026-06-29T05:00:00Z" "$(board_runtime_remind "$H")" "(e) ccm absent → timestamp NOT changed"
rm -rf "$H"

# ── (f) STOP RE-ENTRY (stop_hook_active:true) + due → silent (re-entry guard, no Stop loop) ───────────
H="$(seed_home "sess-f" "2026-06-29T05:00:00Z")"   # due
run_idnudge "$H" "sess-f" "$NOW" '{"session_id":"sess-f","hook_event_name":"Stop","stop_hook_active":true}'
assert_eq 0 "$HOOK_RC" "(f) re-entry → rc 0"
assert_eq "" "$HOOK_OUT" "(f) stop_hook_active:true → silent (re-entry guard)"
assert_eq "2026-06-29T05:00:00Z" "$(board_runtime_remind "$H")" "(f) re-entry → no write-back"
rm -rf "$H"

# ── (g) MULTIPLE active boards for my session → ambiguous target → silent (no write to wrong board) ───
H="$(make_project)"; mkdir -p "$H/boards"
printf '{"schema":"cc-master/v2","goal":"g1","owner":{"active":true,"session_id":"sess-g","heartbeat":"2026-06-01T00:00:00Z"},"git":{"worktree":"","branch":""},"tasks":[{"id":"T1","status":"in_flight","deps":[]}]}' > "$H/boards/b1.board.json"
printf '{"schema":"cc-master/v2","goal":"g2","owner":{"active":true,"session_id":"sess-g","heartbeat":"2026-06-01T00:00:00Z"},"git":{"worktree":"","branch":""},"tasks":[{"id":"T2","status":"in_flight","deps":[]}]}' > "$H/boards/b2.board.json"
run_idnudge "$H" "sess-g" "$NOW"
assert_eq 0 "$HOOK_RC" "(g) multi active boards → rc 0"
assert_eq "" "$HOOK_OUT" "(g) ≥2 active boards (target ambiguous) → silent (no write to wrong board)"
rm -rf "$H"

# ── (h) INVALID CC_MASTER_NOW → silent (does not guess time), rc 0 ───────────────────────────────────
H="$(seed_home "sess-h" "2026-06-29T05:00:00Z")"
run_idnudge "$H" "sess-h" "not-a-date"
assert_eq 0 "$HOOK_RC" "(h) invalid CC_MASTER_NOW → rc 0"
assert_eq "" "$HOOK_OUT" "(h) invalid now → silent (no guessing)"
rm -rf "$H"

# ── (i) custom interval (CC_MASTER_IDNUDGE_INTERVAL_SEC) honored: 1h interval, last 90min ago → due ───
H="$(seed_home "sess-i" "2026-06-29T10:30:00Z")"   # 90min ago
HOOK_OUT="$(printf '{"session_id":"sess-i","hook_event_name":"Stop"}' \
  | CC_MASTER_HOME="$H" CC_MASTER_NOW="$NOW" CCM_BIN="$STUB_CCM" CC_MASTER_IDNUDGE_INTERVAL_SEC="3600" \
    "$HOOK" 2>/dev/null)"; HOOK_RC=$?
assert_eq 0 "$HOOK_RC" "(i) custom interval → rc 0"
assert_contains "$HOOK_OUT" "additionalContext" "(i) 90min > 1h custom interval → due → nudges"
rm -rf "$H"

# ════════════════════════════════════════════════════════════════════════════════════════════════════
# CRITPATH periodic nudge (hooks-enhancements-v2 ②) — runtime.last_critpath_remind gated, default 2h.
# ════════════════════════════════════════════════════════════════════════════════════════════════════

# ── (cp-a) DUE critpath (last_critpath_remind > 2h ago) + recent identity → ONLY critpath nudge fires.
#    Reports X/Y (chain ∩ tasks[].status). seed: 1 task in_flight → chain [T1], X=0/Y=1. No baseline →
#    no on-track/behind verdict (degraded). Writes last_critpath_remind BACK to now.
H="$(seed_home "sess-cpa" "2026-06-29T11:55:00Z" "2026-06-29T09:00:00Z")"   # critpath 3h ago > 2h → due; identity 5min ago → not due
run_idnudge "$H" "sess-cpa" "$NOW"
assert_eq 0 "$HOOK_RC" "(cp-a) critpath due → rc 0"
assert_contains "$HOOK_OUT" "临界路径周期提示" "(cp-a) critpath due → injects critpath advisory"
assert_contains "$HOOK_OUT" "0/1 关键任务" "(cp-a) reports X/Y = 0/1 (chain ∩ tasks status, pure count)"
assert_contains "$HOOK_OUT" '<advisory source=\"critpath-nudge\" strength=\"weak\">' "(cp-a) tag-wrapped advisory weak source=critpath-nudge"
assert_not_contains "$HOOK_OUT" "master orchestrator" "(cp-a) identity not due → only critpath fired (no identity text)"
assert_not_contains "$HOOK_OUT" "schedule" "(cp-a) no baseline → no on-track/behind verdict clause (degraded honestly)"
assert_valid_json "$HOOK_OUT" "(cp-a) single well-formed JSON object"
assert_eq "$NOW" "$(board_runtime_critpath "$H")" "(cp-a) writes last_critpath_remind BACK to now"
assert_eq "2026-06-29T11:55:00Z" "$(board_runtime_remind "$H")" "(cp-a) identity timestamp untouched (not due)"
rm -rf "$H"

# ── (cp-b) NOT DUE critpath (recent) → no critpath nudge. With identity also not due → fully silent.
H="$(seed_home "sess-cpb" "2026-06-29T11:50:00Z" "2026-06-29T11:50:00Z")"   # both 10min ago → neither due
run_idnudge "$H" "sess-cpb" "$NOW"
assert_eq 0 "$HOOK_RC" "(cp-b) neither due → rc 0"
assert_eq "" "$HOOK_OUT" "(cp-b) both within interval → fully silent"
assert_eq "2026-06-29T11:50:00Z" "$(board_runtime_critpath "$H")" "(cp-b) critpath timestamp unchanged"
rm -rf "$H"

# ── (cp-c) FIRST-TIME critpath (no last_critpath_remind) → due → nudges + seeds timestamp. Seed a board
#    with NO critpath key but a recent identity key (identity not due).
H="$(make_project)"; mkdir -p "$H/boards"
printf '{"schema":"cc-master/v2","goal":"g","owner":{"active":true,"session_id":"sess-cpc","heartbeat":"2026-06-01T00:00:00Z"},"git":{"worktree":"","branch":""},"tasks":[{"id":"T1","status":"done","deps":[]},{"id":"T2","status":"in_flight","deps":["T1"]}],"runtime":{"last_identity_remind":"2026-06-29T11:55:00Z"}}' > "$H/boards/mine.board.json"
run_idnudge "$H" "sess-cpc" "$NOW"
assert_eq 0 "$HOOK_RC" "(cp-c) first-time critpath → rc 0"
assert_contains "$HOOK_OUT" "临界路径周期提示" "(cp-c) missing last_critpath_remind → first Stop nudges critpath"
assert_contains "$HOOK_OUT" "1/2 关键任务" "(cp-c) X/Y = 1/2 (T1 done counts, T2 in_flight does not)"
assert_eq "$NOW" "$(board_runtime_critpath "$H")" "(cp-c) first-time → seeds last_critpath_remind=now"
rm -rf "$H"

# ── (cp-d) BOTH due → both nudges injected in the same round (independent timers, weak each, orthogonal).
H="$(seed_home "sess-cpd" "2026-06-29T05:00:00Z" "2026-06-29T09:00:00Z")"   # identity 7h ago + critpath 3h ago → both due
run_idnudge "$H" "sess-cpd" "$NOW"
assert_eq 0 "$HOOK_RC" "(cp-d) both due → rc 0"
assert_contains "$HOOK_OUT" "master orchestrator" "(cp-d) identity advisory present"
assert_contains "$HOOK_OUT" "临界路径周期提示" "(cp-d) critpath advisory present"
assert_valid_json "$HOOK_OUT" "(cp-d) both advisories in one well-formed JSON object"
assert_eq "$NOW" "$(board_runtime_remind "$H")" "(cp-d) identity timestamp written back"
assert_eq "$NOW" "$(board_runtime_critpath "$H")" "(cp-d) critpath timestamp written back"
rm -rf "$H"

# ── (cp-e) BEHIND-schedule verdict (ccm estimate evm → spi_t<1) → critpath advisory carries the behind clause.
H="$(seed_home "sess-cpe" "2026-06-29T11:55:00Z" "2026-06-29T09:00:00Z")"   # critpath due
HOOK_OUT="$(printf '{"session_id":"sess-cpe","hook_event_name":"Stop"}' \
  | CC_MASTER_HOME="$H" CC_MASTER_NOW="$NOW" CCM_BIN="$STUB_CCM" \
    CCM_STUB_EVM='{"ok":true,"data":{"has_baseline":true,"spi_t":0.7,"sv_t":-3.2}}' \
    "$HOOK" 2>/dev/null)"; HOOK_RC=$?
assert_eq 0 "$HOOK_RC" "(cp-e) behind verdict → rc 0"
assert_contains "$HOOK_OUT" "behind schedule" "(cp-e) ccm estimate spi_t<1 → behind schedule verdict clause"
assert_contains "$HOOK_OUT" "瓶颈" "(cp-e) behind → action clause (升档/补派/重排 float)"
rm -rf "$H"

# ── (cp-f) ON-TRACK verdict (spi_t≥1, sv_t≥0) → on-track clause, no behind action.
H="$(seed_home "sess-cpf" "2026-06-29T11:55:00Z" "2026-06-29T09:00:00Z")"   # critpath due
HOOK_OUT="$(printf '{"session_id":"sess-cpf","hook_event_name":"Stop"}' \
  | CC_MASTER_HOME="$H" CC_MASTER_NOW="$NOW" CCM_BIN="$STUB_CCM" \
    CCM_STUB_EVM='{"ok":true,"data":{"has_baseline":true,"spi_t":1.1,"sv_t":2.0}}' \
    "$HOOK" 2>/dev/null)"; HOOK_RC=$?
assert_contains "$HOOK_OUT" "on-track" "(cp-f) spi_t≥1 → on-track verdict clause"
rm -rf "$H"

# ── (cp-g) EMPTY graph (no tasks → chain empty) → critpath build ABSTAINS → no critpath inject (but the
#    timestamp WAS written back, so it won't re-fire next round — accepted: nothing to report this period).
H="$(make_project)"; mkdir -p "$H/boards"
printf '{"schema":"cc-master/v2","goal":"g","owner":{"active":true,"session_id":"sess-cpg","heartbeat":"2026-06-01T00:00:00Z"},"git":{"worktree":"","branch":""},"tasks":[],"runtime":{"last_identity_remind":"2026-06-29T11:55:00Z"}}' > "$H/boards/mine.board.json"
run_idnudge "$H" "sess-cpg" "$NOW"
assert_eq 0 "$HOOK_RC" "(cp-g) empty graph → rc 0"
assert_not_contains "$HOOK_OUT" "临界路径周期提示" "(cp-g) empty chain → critpath build abstains → no inject"
rm -rf "$H"

# ── (cp-h) ccm ABSENT (CCM_BIN nonexistent) + critpath due → write-back fails → silent, no inject, no spam.
H="$(seed_home "sess-cph" "2026-06-29T11:55:00Z" "2026-06-29T09:00:00Z")"   # critpath due
run_idnudge "$H" "sess-cph" "$NOW" "" "/nonexistent-ccm-bin-xyz"
assert_eq 0 "$HOOK_RC" "(cp-h) ccm absent → rc 0"
assert_eq "" "$HOOK_OUT" "(cp-h) ccm absent → write-back fails → silent (no inject)"
assert_eq "2026-06-29T09:00:00Z" "$(board_runtime_critpath "$H")" "(cp-h) ccm absent → critpath timestamp NOT changed"
rm -rf "$H"

# ── (cp-i) custom critpath interval (CC_MASTER_CRITPATH_INTERVAL_SEC) honored: 1h interval, last 90min ago → due.
H="$(seed_home "sess-cpi" "2026-06-29T11:55:00Z" "2026-06-29T10:30:00Z")"   # critpath 90min ago
HOOK_OUT="$(printf '{"session_id":"sess-cpi","hook_event_name":"Stop"}' \
  | CC_MASTER_HOME="$H" CC_MASTER_NOW="$NOW" CCM_BIN="$STUB_CCM" CC_MASTER_CRITPATH_INTERVAL_SEC="3600" \
    "$HOOK" 2>/dev/null)"; HOOK_RC=$?
assert_contains "$HOOK_OUT" "临界路径周期提示" "(cp-i) 90min > 1h custom critpath interval → due → nudges"
rm -rf "$H"

rm -rf "$STUB_DIR"
finish
