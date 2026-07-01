#!/usr/bin/env bash
# Tests for usage-pacing.js (H8 — node Stop/PostToolBatch hook, ADR-006 / ADR-024). The Stop path shells out to
# `ccm usage advise --json` for the (now SINGLE-SIDED) corridor verdict and maps it to a NON-BLOCKING
# additionalContext pacing prompt. **ADR-024 flip**: the verdict enum is now {hold, throttle, switch, stop_5h,
# stop_7d} (accelerate/hard_stop retired) and the ~200-line LOCAL fallback (computeFiveHour /
# decideAccountWarning / decideAccountUnderuse) is RETIRED — when `ccm` is absent / fails / returns
# available:false, adviseViaCcm returns null and the hook is SILENT (no local反推 fallback; ADR-021 makes ccm a
# hard prerequisite so the fallback premise is gone). It NEVER emits decision:block, and on any failure degrades
# silently (empty out, rc 0) so it can never pollute Stop.
#
# These tests are HERMETIC via a STUB `ccm` injected through CCM_BIN — no real ccm binary needed. The stub echoes
# a canned {"ok":true,"data":{…}} for `usage advise` (new enum) and a canned exit+JSON for `account switch`.
# helpers.sh::run_hook is bash-only; we invoke the .js by its `#!/usr/bin/env node` shebang and inject fixtures
# through the hook's env override points. We do NOT modify helpers.sh.
. "$(dirname "$0")/helpers.sh"

HOOK="$PLUGIN_ROOT/hooks/scripts/usage-pacing.js"

NOW="2026-06-10T12:00:00Z"
NOW_SEC=$(date -u -d "$NOW" +%s 2>/dev/null || date -u -j -f '%Y-%m-%dT%H:%M:%SZ' "$NOW" +%s 2>/dev/null)
NOW_MS=$((NOW_SEC * 1000))
R5F=$((NOW_SEC + 3600))   # a 5h resets_at 1h in the future

# seed_armed_home SID -> echo a fresh home holding ONE active board owned by SID (arms the hook).
seed_armed_home() {
  local h; h="$(make_project)"; mkdir -p "$h/boards"
  printf '{"schema":"cc-master/v2","goal":"g","owner":{"active":true,"session_id":"%s"},"git":{"worktree":"","branch":""},"tasks":[{"id":"T1","status":"in_flight","deps":[]}]}' "$1" > "$h/boards/armed.board.json"
  echo "$h"
}
# mk_ccm_stub ADVISE_DATA_JSON [SWITCH_EXIT] [SWITCH_STDOUT] -> path to an executable stub `ccm` that prints
#   {"ok":true,"data":ADVISE_DATA_JSON} on `usage advise`, and (if given) SWITCH_STDOUT + exit SWITCH_EXIT on
#   `account switch`. Payloads written to sibling files the stub cat's (no interpolation fragility). Any other
#   subcommand → empty (defensive). The stub dir is the caller's to clean up (dirname "$stub").
mk_ccm_stub() {
  local dir; dir="$(make_project)"; local stub="$dir/ccm"
  local advise="$dir/advise.json"; printf '%s' "$1" > "$advise"
  local swexit="${2:-0}"; local swout="$dir/switch.out"; printf '%s' "${3:-}" > "$swout"
  cat > "$stub" <<STUB
#!/usr/bin/env bash
if [ "\$1" = "usage" ] && [ "\$2" = "advise" ]; then
  printf '{"ok":true,"data":%s}\n' "\$(cat "$advise")"
  exit 0
fi
if [ "\$1" = "account" ] && [ "\$2" = "switch" ]; then
  cat "$swout"
  exit $swexit
fi
exit 0
STUB
  chmod +x "$stub"
  echo "$stub"
}
# run_ccm HOME SID ADVISE_JSON [EXTRA_ENV...] -> drive a Stop through a stub ccm (CCM_BIN=stub). Sets HOOK_OUT/RC.
#   The rate-cache is pointed at a nonexistent path (Stop-path verdict comes from ccm, not the sidecar pre-gate).
run_ccm() {
  local home="$1" sid="$2" advise="$3"; shift 3
  local stub; stub="$(mk_ccm_stub "$advise")"
  HOOK_OUT="$(printf '{"session_id":"%s","hook_event_name":"Stop"}' "$sid" \
    | env CC_MASTER_NOW="$NOW" CC_MASTER_HOME="$home" CC_MASTER_RATE_CACHE="/nonexistent-rate-cache" \
        CCM_BIN="$stub" "$@" \
      "$HOOK" 2>/dev/null)"; HOOK_RC=$?
  rm -rf "$(dirname "$stub")"
}
# run_stdin HOME STDIN_JSON ADVISE_JSON -> arbitrary stdin (e.g. no sid / stop_hook_active) through a stub ccm.
run_stdin() {
  local home="$1" stdin="$2" advise="$3"
  local stub; stub="$(mk_ccm_stub "$advise")"
  HOOK_OUT="$(printf '%s' "$stdin" \
    | env CC_MASTER_NOW="$NOW" CC_MASTER_HOME="$home" CC_MASTER_RATE_CACHE="/nonexistent-rate-cache" \
        CCM_BIN="$stub" \
      "$HOOK" 2>/dev/null)"; HOOK_RC=$?
  rm -rf "$(dirname "$stub")"
}

# Canned advise payloads (new ADR-024 enum). `available:true` is required — else adviseViaCcm returns null.
ADV_HOLD='{"verdict":"hold","strength":"weak","reason":"r","levers":[],"window_5h_pct":78,"window_7d_pct":40,"effective_n":1,"switch_candidate":null,"confidence":"high","source":"account","available":true}'
ADV_THROTTLE='{"verdict":"throttle","strength":"strong","reason":"r","levers":["downgrade_model"],"window_5h_pct":92,"window_7d_pct":50,"effective_n":1,"switch_candidate":null,"confidence":"high","source":"account","available":true}'
ADV_SWITCH='{"verdict":"switch","strength":"weak","reason":"r","levers":["switch_account"],"window_5h_pct":92,"window_7d_pct":20,"effective_n":2,"switch_candidate":"b@x.com","confidence":"high","source":"account","available":true}'
ADV_STOP5H='{"verdict":"stop_5h","strength":"strong","reason":"r","levers":["arm_wakeup"],"nearest_reset":"2026-06-10T14:00:00Z","stop_dimension":"5h","window_5h_pct":99,"window_7d_pct":70,"effective_n":1,"switch_candidate":null,"confidence":"high","source":"account","available":true}'
ADV_STOP7D='{"verdict":"stop_7d","strength":"strong","reason":"r","levers":["pause_dispatch","surface_user"],"stop_dimension":"7d","window_5h_pct":40,"window_7d_pct":88,"effective_n":1,"switch_candidate":null,"confidence":"high","source":"account","available":true}'

# ── (A) VERDICT MAPPINGS (ccm-driven, single-sided ADR-024 enum) ───────────────────────────────────────
AH="$(seed_armed_home "sess-a")"

# (A-hold) hold → silent (corridor 内·no prompt·no spam).
run_ccm "$AH" "sess-a" "$ADV_HOLD"
assert_eq 0 "$HOOK_RC" "(A-hold) verdict hold → rc 0"
assert_eq "" "$HOOK_OUT" "(A-hold) verdict hold (corridor 内) → silent"

# (A-throttle) throttle → SLOWDOWN advisory (降到更便宜的模型档) + carries 5h%, non-blocking, strength=strong.
run_ccm "$AH" "sess-a" "$ADV_THROTTLE"
assert_eq 0 "$HOOK_RC" "(A-throttle) verdict throttle → rc 0"
assert_contains "$HOOK_OUT" "additionalContext" "(A-throttle) throttle → injects prompt"
assert_contains "$HOOK_OUT" "降到更便宜的模型档" "(A-throttle) throttle → SLOWDOWN levers (本 skill vocabulary)"
assert_contains "$HOOK_OUT" "92" "(A-throttle) carries ccm window_5h_pct"
assert_contains "$HOOK_OUT" '<advisory source=\"usage-pacing\" strength=\"strong\">' "(A-throttle) throttle → advisory strong (ADR-018)"
assert_not_contains "$HOOK_OUT" '"decision":"block"' "(A-throttle) NEVER blocks"

# (A-switch) switch → 切到下一份配额 signal (5h critical + 7d headroom + n>1), advisory weak. (No autoswitch here:
#   no accounts.json registry → pool.switchable=0 → LBHOOK does not fire; falls to advise-only lever wording.)
run_ccm "$AH" "sess-a" "$ADV_SWITCH"
assert_eq 0 "$HOOK_RC" "(A-switch) verdict switch → rc 0"
assert_contains "$HOOK_OUT" "切到下一份配额" "(A-switch) switch → 切下一份配额 signal"
assert_contains "$HOOK_OUT" "2 份" "(A-switch) names the effective_n (2 份)"
assert_contains "$HOOK_OUT" '<advisory source=\"usage-pacing\" strength=\"weak\">' "(A-switch) switch → advisory weak (ADR-018)"

# (A-stop5h) stop_5h → 本窗口烧穿 + arm watchdog 守到 nearest_reset (carries the reset timestamp), strength strong.
run_ccm "$AH" "sess-a" "$ADV_STOP5H"
assert_eq 0 "$HOOK_RC" "(A-stop5h) verdict stop_5h → rc 0"
assert_contains "$HOOK_OUT" "arm" "(A-stop5h) stop_5h → guides arm a watchdog wakeup"
assert_contains "$HOOK_OUT" "watchdog" "(A-stop5h) stop_5h → names watchdog self-wakeup"
assert_contains "$HOOK_OUT" "2026-06-10T14:00:00Z" "(A-stop5h) stop_5h → carries data.nearest_reset (arm wakeup 等 reset)"
assert_contains "$HOOK_OUT" '<advisory source=\"usage-pacing\" strength=\"strong\">' "(A-stop5h) stop_5h → advisory strong (ADR-018)"
assert_not_contains "$HOOK_OUT" '"decision":"block"' "(A-stop5h) NEVER blocks"

# (A-stop7d) stop_7d → 暂停 dispatch 新节点 + blocked_on:user + surface 用户 + 硬总闸, strength strong, non-blocking.
run_ccm "$AH" "sess-a" "$ADV_STOP7D"
assert_eq 0 "$HOOK_RC" "(A-stop7d) verdict stop_7d → rc 0"
assert_contains "$HOOK_OUT" "暂停 dispatch 新节点" "(A-stop7d) stop_7d → pause dispatch wording"
assert_contains "$HOOK_OUT" "blocked_on:" "(A-stop7d) stop_7d → frames blocked_on:user"
assert_contains "$HOOK_OUT" "surface 给用户" "(A-stop7d) stop_7d → surfaces to user"
assert_contains "$HOOK_OUT" "硬总闸" "(A-stop7d) stop_7d → names the 7d hard total gate"
assert_contains "$HOOK_OUT" "88" "(A-stop7d) carries ccm window_7d_pct"
assert_contains "$HOOK_OUT" '<advisory source=\"usage-pacing\" strength=\"strong\">' "(A-stop7d) stop_7d → advisory strong, NOT directive (hook can't真 block dispatch, red line 4)"
assert_not_contains "$HOOK_OUT" '"decision":"block"' "(A-stop7d) NEVER blocks"

# (A-strength) data.strength is CONSUMED (ccm 出 strength·hook 直接用). A throttle whose data says strength=weak
#   must render weak — proving the hook takes data.strength over its own kind default (throttle default strong).
ADV_THROTTLE_WEAK='{"verdict":"throttle","strength":"weak","reason":"r","levers":["downgrade_model"],"window_5h_pct":91,"window_7d_pct":50,"effective_n":1,"switch_candidate":null,"confidence":"high","source":"account","available":true}'
run_ccm "$AH" "sess-a" "$ADV_THROTTLE_WEAK"
assert_contains "$HOOK_OUT" '<advisory source=\"usage-pacing\" strength=\"weak\">' "(A-strength) data.strength=weak overrides kind default → advisory weak (ccm 出 strength)"
rm -rf "$AH"

# ── (B) CCM-ONLY: absent / available:false / garbage → SILENT (no local fallback·ADR-024) ───────────────
BH="$(seed_armed_home "sess-b")"

# (B-absent) ccm absent (CCM_BIN nonexistent) + a CRITICAL local sidecar present → STILL SILENT. ADR-024
#   retired the local反推/account-authoritative fallback: no ccm verdict = no pacing prompt.
BCACHE_DIR="$(make_project)"; BCACHE="$BCACHE_DIR/rate.json"
printf '{"five_hour":{"used_percentage":95,"resets_at":%d},"seven_day":{"used_percentage":95},"captured_at":%d}' "$R5F" "$NOW_SEC" > "$BCACHE"
HOOK_OUT="$(printf '{"session_id":"sess-b","hook_event_name":"Stop"}' \
  | env CC_MASTER_NOW="$NOW" CC_MASTER_HOME="$BH" CC_MASTER_RATE_CACHE="$BCACHE" CCM_BIN="/nonexistent-ccm-absent" \
    "$HOOK" 2>/dev/null)"; HOOK_RC=$?
assert_eq 0 "$HOOK_RC" "(B-absent) ccm absent + critical local sidecar → rc 0"
assert_eq "" "$HOOK_OUT" "(B-absent) ccm absent → SILENT (ADR-024 retired the local fallback; no ccm = no prompt)"
rm -rf "$BCACHE_DIR"

# (B-unavail) ccm available:false (sidecar missing on ccm's side) → adviseViaCcm null → silent.
ADV_UNAVAIL='{"verdict":"hold","strength":"weak","reason":"r","levers":[],"window_5h_pct":null,"window_7d_pct":null,"effective_n":1,"switch_candidate":null,"confidence":"low","source":"local-derived-approx","available":false}'
run_ccm "$BH" "sess-b" "$ADV_UNAVAIL"
assert_eq 0 "$HOOK_RC" "(B-unavail) ccm available:false → rc 0"
assert_eq "" "$HOOK_OUT" "(B-unavail) available:false → silent (no authoritative corridor verdict)"

# (B-garbage) ccm emits non-JSON → adviseViaCcm null → silent (never crashes, never injects garbage).
GARB_DIR="$(make_project)"; GARB="$GARB_DIR/ccm"
printf '#!/usr/bin/env bash\nprintf "not json at all {{{\\n"\n' > "$GARB"; chmod +x "$GARB"
HOOK_OUT="$(printf '{"session_id":"sess-b","hook_event_name":"Stop"}' \
  | env CC_MASTER_NOW="$NOW" CC_MASTER_HOME="$BH" CC_MASTER_RATE_CACHE="/nonexistent-rate-cache" CCM_BIN="$GARB" \
    "$HOOK" 2>/dev/null)"; HOOK_RC=$?
assert_eq 0 "$HOOK_RC" "(B-garbage) ccm garbage JSON → rc 0 (no crash)"
assert_eq "" "$HOOK_OUT" "(B-garbage) ccm garbage JSON → silent (degrade, never inject garbage)"
rm -rf "$GARB_DIR" "$BH"

# ── (C) ARMED GATE (red line 6·the critical pollution fix): dormant until THIS session is armed ─────────
# Even at a CRITICAL ccm verdict (stop_7d), an UNARMED session must be SILENT (the harness arm:'boards' gate
# short-circuits BEFORE any ccm shell-out). Arming ⟺ home has an active board with owner.session_id == stdin sid
# (sid empty → degraded: any active board; blank board sid stays dormant for a non-empty sid·red line 6 fail-safe).

# (C1) UNARMED — empty home (no board) + stop_7d stub → silent (the pollution fix).
CU="$(make_project)"
run_ccm "$CU" "sess-unarmed" "$ADV_STOP7D"
assert_eq 0 "$HOOK_RC" "(C1) unarmed empty home → rc 0"
assert_eq "" "$HOOK_OUT" "(C1) unarmed (no board) → silent even at critical verdict (pollution fix, red line 6)"
rm -rf "$CU"

# (C2) UNARMED — active board owned by ANOTHER session → not mine → silent at critical.
CO="$(make_project)"; mkdir -p "$CO/boards"
printf '{"schema":"cc-master/v2","goal":"g","owner":{"active":true,"session_id":"sess-other"},"git":{"worktree":"","branch":""},"tasks":[{"id":"T1","status":"in_flight","deps":[]}]}' > "$CO/boards/other.board.json"
run_ccm "$CO" "sess-mine" "$ADV_STOP7D"
assert_eq 0 "$HOOK_RC" "(C2) other session's board → rc 0"
assert_eq "" "$HOOK_OUT" "(C2) other session's active board → silent (not armed for me)"
rm -rf "$CO"

# (C3) UNARMED — only an ARCHIVED board (owner.active:false) for my session → not armed → silent.
CA="$(make_project)"; mkdir -p "$CA/boards"
printf '{"schema":"cc-master/v2","goal":"g","owner":{"active":false,"session_id":"sess-arch"},"git":{"worktree":"","branch":""},"tasks":[{"id":"T1","status":"in_flight","deps":[]}]}' > "$CA/boards/arch.board.json"
run_ccm "$CA" "sess-arch" "$ADV_STOP7D"
assert_eq 0 "$HOOK_RC" "(C3) archived board → rc 0"
assert_eq "" "$HOOK_OUT" "(C3) archived (inactive) board → silent (arming requires active)"
rm -rf "$CA"

# (C4) ARMED — active board owned by THIS session → gate opens → critical verdict warns.
CM="$(seed_armed_home "sess-armed")"
run_ccm "$CM" "sess-armed" "$ADV_STOP7D"
assert_eq 0 "$HOOK_RC" "(C4) armed session → rc 0"
assert_contains "$HOOK_OUT" "additionalContext" "(C4) armed + critical verdict → warns (gate open)"
assert_contains "$HOOK_OUT" "暂停 dispatch 新节点" "(C4) armed → carries the stop_7d wording"
assert_not_contains "$HOOK_OUT" '"decision":"block"' "(C4) armed → still NEVER blocks"
rm -rf "$CM"

# (C5) DEGRADED — no session_id in stdin, but home has an active board → degraded gate matches any active board.
CD="$(make_project)"; mkdir -p "$CD/boards"
printf '{"schema":"cc-master/v2","goal":"g","owner":{"active":true,"session_id":"sess-whatever"},"git":{"worktree":"","branch":""},"tasks":[{"id":"T1","status":"in_flight","deps":[]}]}' > "$CD/boards/some.board.json"
run_stdin "$CD" '{"hook_event_name":"Stop"}' "$ADV_THROTTLE"
assert_eq 0 "$HOOK_RC" "(C5) no session_id, active board present → rc 0"
assert_contains "$HOOK_OUT" "additionalContext" "(C5) degraded gate (no sid → any active) → armed → warns"
rm -rf "$CD"

# (C6) BLANK-SID BOARD STAYS DORMANT — active board with owner.session_id:"" + a NON-empty stdin sid → strict
#   match "" != "sess-adopt" → unarmed → silent (red line 6 fail-safe·CODEX14 revert).
CB="$(make_project)"; mkdir -p "$CB/boards"
printf '{"schema":"cc-master/v2","goal":"g","owner":{"active":true,"session_id":""},"git":{"worktree":"","branch":""},"tasks":[{"id":"T1","status":"in_flight","deps":[]}]}' > "$CB/boards/empty.board.json"
run_ccm "$CB" "sess-adopt" "$ADV_STOP7D"
assert_eq 0 "$HOOK_RC" "(C6) blank-session board + non-empty stdin sid → rc 0"
assert_eq "" "$HOOK_OUT" "(C6) blank-session active board + non-empty stdin sid → dormant, silent (red line 6 fail-safe)"
rm -rf "$CB"

# ── (D) STOP RE-ENTRY GUARD: stop_hook_active:true → silent (never-blocks / no-loop contract) ───────────
DH="$(seed_armed_home "sess-re")"
# (D1) ARMED + critical + stop_hook_active:true → silent (re-entry guard runs before any shell-out).
run_stdin "$DH" '{"session_id":"sess-re","hook_event_name":"Stop","stop_hook_active":true}' "$ADV_STOP7D"
assert_eq 0 "$HOOK_RC" "(D1) re-entry → rc 0"
assert_eq "" "$HOOK_OUT" "(D1) stop_hook_active:true → silent (re-entry guard, no Stop loop)"
# (D2) CONTROL — identical but stop_hook_active:false → warns (guard keys on the flag, not the state).
run_stdin "$DH" '{"session_id":"sess-re","hook_event_name":"Stop","stop_hook_active":false}' "$ADV_STOP7D"
assert_eq 0 "$HOOK_RC" "(D2) genuine new Stop → rc 0"
assert_contains "$HOOK_OUT" "additionalContext" "(D2) stop_hook_active:false → warns (first Stop still fires)"
rm -rf "$DH"

# ── (E) POOL AMBIENT (A2 T6 §F): pacing warning + switchable backup → 号池 fact rides along as ambient ──
# A throttle verdict (advisory) + accounts.json with 1 token-unexpired backup → pool.switchable=1 → the 号池
# coarse fact is appended as a SEPARATE ambient block (ADR-018·池/配额事实·塑模型·无 action·no strength).
EH="$(seed_armed_home "sess-e")"
printf '%s' '{"schema":"cc-master/accounts/v1","accounts":{"a@x.com":{"vault":{"kind":"keychain","service":"cc-master-oauth","account":"a@x.com"},"active":true},"b@x.com":{"vault":{"kind":"keychain","service":"cc-master-oauth","account":"b@x.com"},"active":false,"token_expires_at":"2027-06-17T10:40:00Z"}}}' > "$EH/accounts.json"
run_ccm "$EH" "sess-e" "$ADV_THROTTLE"
assert_eq 0 "$HOOK_RC" "(E1) throttle + switchable backup → rc 0"
assert_contains "$HOOK_OUT" "降到更便宜的模型档" "(E1) throttle advisory present"
assert_contains "$HOOK_OUT" '<ambient source=\"usage-pacing\">' "(E1) pool fact → separate ambient block (ADR-018, no strength)"
assert_contains "$HOOK_OUT" "号池" "(E1) ambient carries the pool fact (号池)"
assert_contains "$HOOK_OUT" "1 个 token 未过期" "(E1) pool fact names 1 switchable backup"
rm -rf "$EH"

# (E2) NO registry → no pool fact appended (throttle advisory only). Proves the 号池 line is gated on switchable≥1.
EN="$(seed_armed_home "sess-e2")"
run_ccm "$EN" "sess-e2" "$ADV_THROTTLE"
assert_contains "$HOOK_OUT" "降到更便宜的模型档" "(E2) throttle advisory present"
assert_not_contains "$HOOK_OUT" "号池" "(E2) no registry → switchable=0 → pool fact NOT appended"
rm -rf "$EN"

# ── (F) 换号检测 ambient (ADR-024·task 1d): board.runtime.last_account_switch newer than watermark + not the
#    hook's own auto-switch → inject an ambient「检测到换号(可能手动)」. Read runtime = read-only (red line 2). ──
# (F1) A board with runtime.last_account_switch set + a HOLD verdict (no pacing warning) + no switch sidecar
#   watermark → the switch-detect ambient STILL fires (independent of pacing warning). Names current active.
FH="$(make_project)"; mkdir -p "$FH/boards"
printf '{"schema":"cc-master/v2","goal":"g","owner":{"active":true,"session_id":"sess-f"},"git":{"worktree":"","branch":""},"runtime":{"last_account_switch":"2026-06-10T11:00:00Z"},"tasks":[{"id":"T1","status":"in_flight","deps":[]}]}' > "$FH/boards/mine.board.json"
printf '%s' '{"schema":"cc-master/accounts/v1","accounts":{"b@x.com":{"vault":{"kind":"keychain","service":"cc-master-oauth","account":"b@x.com"},"active":true}}}' > "$FH/accounts.json"
FSW="$FH/switch.json"   # switch sidecar path; absent → no watermark → detection fires
run_ccm "$FH" "sess-f" "$ADV_HOLD" CC_MASTER_SWITCH_STATE="$FSW"
assert_eq 0 "$HOOK_RC" "(F1) runtime.last_account_switch + hold verdict → rc 0"
assert_contains "$HOOK_OUT" "检测到换号" "(F1) external/manual switch detected → injects switch-detect ambient (even with no pacing warning)"
assert_contains "$HOOK_OUT" "b@x.com" "(F1) ambient names the current active account (from registry)"
assert_contains "$HOOK_OUT" '<ambient source=\"usage-pacing\">' "(F1) switch-detect → ambient block (ADR-018·塑模型·no action)"
# (F2) SECOND Stop after the watermark advanced (F1 wrote last_seen) → already surfaced → silent (no re-report).
run_ccm "$FH" "sess-f" "$ADV_HOLD" CC_MASTER_SWITCH_STATE="$FSW"
assert_eq "" "$HOOK_OUT" "(F2) same switch already surfaced (watermark advanced) → silent (no re-report)"
# (F3) HOOK'S-OWN auto-switch is NOT re-reported: watermark last_switch_at_ms ≈ board ts (within 60s) → own → skip.
FH2="$(make_project)"; mkdir -p "$FH2/boards"
printf '{"schema":"cc-master/v2","goal":"g","owner":{"active":true,"session_id":"sess-f2"},"git":{"worktree":"","branch":""},"runtime":{"last_account_switch":"2026-06-10T12:00:00Z"},"tasks":[{"id":"T1","status":"in_flight","deps":[]}]}' > "$FH2/boards/mine.board.json"
FSW2="$FH2/switch.json"; printf '{"last_switch_at_ms":%d}' "$NOW_MS" > "$FSW2"   # hook switched at ~board ts (own)
run_ccm "$FH2" "sess-f2" "$ADV_HOLD" CC_MASTER_SWITCH_STATE="$FSW2"
assert_eq "" "$HOOK_OUT" "(F3) board switch ts within 60s of hook's own last_switch_at_ms → own auto-switch → NOT re-reported (switchAmbient already covers it)"
rm -rf "$FH" "$FH2"

# ── (G) LBHOOK (LOADBAL §3.2/3.3 + ADR-016): switch verdict → 机械调 ccm account switch (policy gate + idempotent) ─
# On kind:'switch' (verdict switch·5h critical + n>1 + 7d headroom + a switchable backup + single board), the hook
# MECHANICALLY calls `ccm account switch`. ccm self-gates (policy deny→exit7, exhausted→exit3). Token-blind.
seed_lb_home() {
  local h; h="$(make_project)"; mkdir -p "$h/boards"
  printf '{"schema":"cc-master/v2","goal":"g","owner":{"active":true,"session_id":"sess-lb"},"git":{"worktree":"","branch":""},"policy":{"autonomous_account_switch":"allow"},"tasks":[{"id":"T1","status":"in_flight","deps":[]}]}' > "$h/boards/mine.board.json"
  printf '%s' '{"schema":"cc-master/accounts/v1","accounts":{"a@x.com":{"vault":{"kind":"keychain","service":"cc-master-oauth","account":"a@x.com"},"active":true},"b@x.com":{"vault":{"kind":"keychain","service":"cc-master-oauth","account":"b@x.com"},"active":false,"token_expires_at":"2027-06-17T10:40:00Z"}}}' > "$h/accounts.json"
  echo "$h"
}
# run_lb HOME STUB [EXTRA_ENV...] -> armed Stop (sess-lb) through the given stub. Sets HOOK_OUT/HOOK_RC.
run_lb() {
  local home="$1" stub="$2"; shift 2
  HOOK_OUT="$(printf '{"session_id":"sess-lb","hook_event_name":"Stop"}' \
    | env CC_MASTER_NOW="$NOW" CC_MASTER_HOME="$home" CC_MASTER_RATE_CACHE="/nonexistent-rate-cache" \
        CCM_BIN="$stub" "$@" \
      "$HOOK" 2>/dev/null)"; HOOK_RC=$?
}

# (G1) SWITCH SUCCESS — account switch exits 0 + {switched:true,email:b@x.com}. Hook mechanically switches →
#   single ambient "已自动换号" naming new active; NO advisory block; cooldown sidecar written; rc 0.
LB="$(seed_lb_home)"; LB_STUB="$(mk_ccm_stub "$ADV_SWITCH" 0 '{"ok":true,"data":{"email":"b@x.com","switched":true}}')"
run_lb "$LB" "$LB_STUB" CC_MASTER_SWITCH_STATE="$LB/switch.json"
assert_eq 0 "$HOOK_RC" "(G1) mechanical switch success → rc 0"
assert_contains "$HOOK_OUT" "已自动换号" "(G1) success → auto-switch ambient (已自动换号)"
assert_contains "$HOOK_OUT" "b@x.com" "(G1) ambient names the new active (from ccm switch JSON)"
assert_contains "$HOOK_OUT" '<ambient source=\"usage-pacing\">' "(G1) success → ambient block (ADR-018)"
assert_not_contains "$HOOK_OUT" "<advisory" "(G1) success → NO advisory (switch done, agent only adjusts pacing)"
assert_not_contains "$HOOK_OUT" '"decision":"block"' "(G1) NEVER blocks"
assert_file "$LB/switch.json" "(G1) success → cooldown sidecar written (anti-thrash)"
# (G1b) COOLDOWN — a second identical Stop (cooldown sidecar fresh) → no re-switch; advise-only lever wording.
run_lb "$LB" "$LB_STUB" CC_MASTER_SWITCH_STATE="$LB/switch.json"
assert_not_contains "$HOOK_OUT" "已自动换号" "(G1b) within cooldown → does NOT auto-switch again (anti-thrash)"
assert_contains "$HOOK_OUT" "切到下一份配额" "(G1b) cooldown → falls back to advise-only lever wording"
rm -rf "$LB" "$(dirname "$LB_STUB")"

# (G2) POLICY DENY — account switch exits 7 (board.policy deny hard gate) → no switch → advisory with deny note,
#   strength STRONG, names exit 7 + blocked_on:user. rc 0.
LB="$(seed_lb_home)"; LB_STUB="$(mk_ccm_stub "$ADV_SWITCH" 7 '')"
run_lb "$LB" "$LB_STUB" CC_MASTER_SWITCH_STATE="$LB/switch.json"
assert_eq 0 "$HOOK_RC" "(G2) policy deny (exit 7) → rc 0"
assert_not_contains "$HOOK_OUT" "已自动换号" "(G2) deny → did NOT switch"
assert_contains "$HOOK_OUT" "deny" "(G2) deny → advisory names the policy deny"
assert_contains "$HOOK_OUT" "exit 7" "(G2) deny → names ccm exit 7 hard gate"
assert_contains "$HOOK_OUT" "blocked_on:" "(G2) deny → surfaces as blocked_on:user decision"
assert_contains "$HOOK_OUT" '<advisory source=\"usage-pacing\" strength=\"strong\">' "(G2) deny → advisory STRONG (surface to user)"
rm -rf "$LB" "$(dirname "$LB_STUB")"

# (G3) EXHAUSTED — account switch exits 3 (NONE_ALL_EXHAUSTED) → no switch → advisory with exhausted note (等 reset).
LB="$(seed_lb_home)"; LB_STUB="$(mk_ccm_stub "$ADV_SWITCH" 3 '')"
run_lb "$LB" "$LB_STUB" CC_MASTER_SWITCH_STATE="$LB/switch.json"
assert_eq 0 "$HOOK_RC" "(G3) exhausted (exit 3) → rc 0"
assert_not_contains "$HOOK_OUT" "已自动换号" "(G3) exhausted → did NOT switch"
assert_contains "$HOOK_OUT" "exit 3" "(G3) exhausted → names ccm exit 3 (NONE_ALL_EXHAUSTED)"
assert_contains "$HOOK_OUT" "等 reset" "(G3) exhausted → surfaces 等 reset 决策 to user"
rm -rf "$LB" "$(dirname "$LB_STUB")"

# (G4) AUTOSWITCH=0 KILL-SWITCH — success-capable stub but CC_MASTER_AUTOSWITCH=0 → never switches; advise-only.
LB="$(seed_lb_home)"; LB_STUB="$(mk_ccm_stub "$ADV_SWITCH" 0 '{"ok":true,"data":{"email":"b@x.com","switched":true}}')"
run_lb "$LB" "$LB_STUB" CC_MASTER_AUTOSWITCH=0 CC_MASTER_SWITCH_STATE="$LB/switch.json"
assert_not_contains "$HOOK_OUT" "已自动换号" "(G4) kill-switch → no mechanical switch"
assert_contains "$HOOK_OUT" "切到下一份配额" "(G4) kill-switch → advise-only lever wording (old behavior)"
rm -rf "$LB" "$(dirname "$LB_STUB")"

# (G5) AMBIGUOUS BOARD CONTEXT — TWO active boards for this session → conservatively do NOT auto-switch → advise-only.
LB="$(make_project)"; mkdir -p "$LB/boards"
printf '{"schema":"cc-master/v2","goal":"g1","owner":{"active":true,"session_id":"sess-lb"},"git":{"worktree":"","branch":""},"tasks":[{"id":"T1","status":"in_flight","deps":[]}]}' > "$LB/boards/a.board.json"
printf '{"schema":"cc-master/v2","goal":"g2","owner":{"active":true,"session_id":"sess-lb"},"git":{"worktree":"","branch":""},"tasks":[{"id":"T2","status":"in_flight","deps":[]}]}' > "$LB/boards/b.board.json"
printf '%s' '{"schema":"cc-master/accounts/v1","accounts":{"a@x.com":{"vault":{"kind":"keychain","service":"cc-master-oauth","account":"a@x.com"},"active":true},"b@x.com":{"vault":{"kind":"keychain","service":"cc-master-oauth","account":"b@x.com"},"active":false,"token_expires_at":"2027-06-17T10:40:00Z"}}}' > "$LB/accounts.json"
LB_STUB="$(mk_ccm_stub "$ADV_SWITCH" 0 '{"ok":true,"data":{"email":"b@x.com","switched":true}}')"
run_lb "$LB" "$LB_STUB" CC_MASTER_SWITCH_STATE="$LB/switch.json"
assert_not_contains "$HOOK_OUT" "已自动换号" "(G5) ambiguous board context → conservatively does NOT auto-switch"
assert_contains "$HOOK_OUT" "切到下一份配额" "(G5) ambiguous → advise-only fallback (which board's policy is unclear)"
rm -rf "$LB" "$(dirname "$LB_STUB")"

# ── (H) F3 source guard: ACCOUNTS_FILE resolves via canonical HOME_DIR (resolveHome), NOT a bare process.env.HOME ─
F3_ACCT_BLOCK="$(awk '/const ACCOUNTS_FILE/{f=1} f{print} f&&/;/{exit}' "$HOOK")"
assert_contains "$F3_ACCT_BLOCK" "HOME_DIR" "(H) ACCOUNTS_FILE resolves via canonical HOME_DIR (resolveHome), same root as arming"
assert_not_contains "$F3_ACCT_BLOCK" "process.env.HOME" "(H) ACCOUNTS_FILE not built from a bare process.env.HOME (cwd-relative footgun)"

finish
