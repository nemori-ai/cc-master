#!/usr/bin/env bash
# Tests for usage-pacing.js PostToolBatch MID-TURN SAMPLING (hooks-enhancements-v2 ③ · ADR-024). The hook serves
# BOTH Stop and PostToolBatch. On PostToolBatch it runs a LIGHT sample path: read the account-authoritative
# rate-cache sidecar (cheap, no spawn), compute a "band" (normal / throttle / stop_7d), and — only when (A band
# escalated) OR (B cooldown elapsed AND still critical) — spawn `ccm usage advise` for the authoritative verdict
# and inject a NON-BLOCKING mid-turn advisory. Mid-turn reports ONLY the critical side (throttle / stop_5h /
# stop_7d), NEVER switch (autoswitch stays Stop-only), and does NO autoswitch.
#
# **ADR-024**: the local账户-authoritative fallback (decideAccountWarning) is RETIRED — when the cheap band pre-gate
# says "inject" but ccm is absent / non-critical, the mid-turn is SILENT (no local fallback). Sub-agent context
# (stdin top-level agent_id) → silent early-return. A 5h window reset clears the band memory.
#
# All cases inject a STUB `ccm` via CCM_BIN answering `usage advise` with a canned new-enum verdict; the band
# pre-gate is driven independently by the seeded rate-cache sidecar. Throttle sidecar: <home>/sample.json.
. "$(dirname "$0")/helpers.sh"

HOOK="$PLUGIN_ROOT/hooks/scripts/usage-pacing.js"

NOW="2026-06-10T12:00:00Z"
NOW_SEC=$(date -u -d "$NOW" +%s 2>/dev/null || date -u -j -f '%Y-%m-%dT%H:%M:%SZ' "$NOW" +%s 2>/dev/null)
FUTURE_RESET=$((NOW_SEC + 3600))   # 5h window still valid (resets 1h from now)

# seed_armed_home SID -> echo a fresh home holding an active board owned by SID (arms the hook).
seed_armed_home() {
  local h; h="$(make_project)"; mkdir -p "$h/boards"
  printf '{"schema":"cc-master/v2","goal":"g","owner":{"active":true,"session_id":"%s"},"git":{"worktree":"","branch":""},"tasks":[{"id":"T1","status":"in_flight","deps":[]}]}' "$1" > "$h/boards/armed.board.json"
  echo "$h"
}
# write_rate_cache FILE P5 P7 RESETS_AT CAPTURED_AT -> seed the account-authoritative sidecar (band pre-gate reads it).
write_rate_cache() {
  printf '{"five_hour":{"used_percentage":%s,"resets_at":%s},"seven_day":{"used_percentage":%s},"captured_at":%s}\n' \
    "$2" "$4" "$3" "$5" > "$1"
}
# write_sample_state FILE LAST_INJECT_AT LAST_BAND WINDOW_RESETS_AT -> pre-seed the throttle sidecar.
write_sample_state() {
  printf '{"last_inject_at":%s,"last_band":"%s","window_resets_at":%s}\n' "$2" "$3" "$4" > "$1"
}
# mk_ccm_stub ADVISE_DATA_JSON -> path to an executable stub `ccm` that prints {"ok":true,"data":ADVISE} on
#   `usage advise`. Dir is the caller's to clean (dirname "$stub").
mk_ccm_stub() {
  local dir; dir="$(make_project)"; local stub="$dir/ccm"; local advise="$dir/advise.json"
  printf '%s' "$1" > "$advise"
  cat > "$stub" <<STUB
#!/usr/bin/env bash
if [ "\$1" = "usage" ] && [ "\$2" = "advise" ]; then
  printf '{"ok":true,"data":%s}\n' "\$(cat "$advise")"
fi
exit 0
STUB
  chmod +x "$stub"
  echo "$stub"
}
# run_sample HOME SID RATE_CACHE SAMPLE_STATE ADVISE_JSON [EXTRA_ENV...] -> drive a PostToolBatch event.
run_sample() {
  local home="$1" sid="$2" rc="$3" ss="$4" advise="$5"; shift 5
  local stub; stub="$(mk_ccm_stub "$advise")"
  HOOK_OUT="$(printf '{"session_id":"%s","hook_event_name":"PostToolBatch"}' "$sid" \
    | env CC_MASTER_HOME="$home" CC_MASTER_NOW="$NOW" CC_MASTER_RATE_CACHE="$rc" \
        CC_MASTER_PACING_SAMPLE_STATE="$ss" CCM_BIN="$stub" "$@" \
      "$HOOK" 2>/dev/null)"; HOOK_RC=$?
  rm -rf "$(dirname "$stub")"
}
sample_band() {
  node -e 'const fs=require("fs");try{const o=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(String(o.last_band||""));}catch(e){}' "$1"
}
sample_inject_at() {
  node -e 'const fs=require("fs");try{const o=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(String(o.last_inject_at||""));}catch(e){}' "$1"
}

# Canned advise payloads (new ADR-024 enum). The mid-turn path only surfaces critical verdicts.
ADV_THROTTLE='{"verdict":"throttle","strength":"strong","reason":"r","levers":["downgrade_model"],"window_5h_pct":87,"window_7d_pct":40,"effective_n":1,"switch_candidate":null,"confidence":"high","source":"account","available":true}'
ADV_STOP7D='{"verdict":"stop_7d","strength":"strong","reason":"r","levers":["pause_dispatch"],"stop_dimension":"7d","window_5h_pct":50,"window_7d_pct":90,"effective_n":1,"switch_candidate":null,"confidence":"high","source":"account","available":true}'

# ── (1) ESCALATE: band normal→throttle (5h 87% ≥ floor) + last_band normal → inject (A·跨阈值升档) ─────
H="$(seed_armed_home "sess-1")"; RC="$H/rate.json"; SS="$H/sample.json"
write_rate_cache "$RC" 87 40 "$FUTURE_RESET" "$NOW_SEC"
write_sample_state "$SS" 0 "normal" "$FUTURE_RESET"
run_sample "$H" "sess-1" "$RC" "$SS" "$ADV_THROTTLE"
assert_eq 0 "$HOOK_RC" "(1) escalate → rc 0"
assert_contains "$HOOK_OUT" "回合中途采样" "(1) band escalation → injects mid-turn advisory"
assert_contains "$HOOK_OUT" '"hookEventName":"PostToolBatch"' "(1) envelope hookEventName is PostToolBatch"
assert_contains "$HOOK_OUT" '<advisory source=\"usage-pacing\"' "(1) tag-wrapped advisory (ADR-018)"
assert_not_contains "$HOOK_OUT" '"decision":"block"' "(1) NEVER blocks"
assert_valid_json "$HOOK_OUT" "(1) single well-formed JSON object"
assert_eq "throttle" "$(sample_band "$SS")" "(1) persists last_band=throttle"
rm -rf "$H"

# ── (2) SAME BAND, within cooldown → silent (B 未满冷却·同带不重复刷屏) ───────────────────────────────
H="$(seed_armed_home "sess-2")"; RC="$H/rate.json"; SS="$H/sample.json"
write_rate_cache "$RC" 87 40 "$FUTURE_RESET" "$NOW_SEC"
write_sample_state "$SS" $((NOW_SEC - 60)) "throttle" "$FUTURE_RESET"   # injected 1min ago, default cooldown 15min
run_sample "$H" "sess-2" "$RC" "$SS" "$ADV_THROTTLE"
assert_eq 0 "$HOOK_RC" "(2) same band within cooldown → rc 0"
assert_eq "" "$HOOK_OUT" "(2) same throttle band, cooldown not elapsed → silent"
rm -rf "$H"

# ── (3) SAME BAND, cooldown elapsed → inject (B·满冷却同带仍临界) ──────────────────────────────────────
H="$(seed_armed_home "sess-3")"; RC="$H/rate.json"; SS="$H/sample.json"
write_rate_cache "$RC" 87 40 "$FUTURE_RESET" "$NOW_SEC"
write_sample_state "$SS" $((NOW_SEC - 1000)) "throttle" "$FUTURE_RESET"   # injected ~16min ago > 15min cooldown
run_sample "$H" "sess-3" "$RC" "$SS" "$ADV_THROTTLE"
assert_eq 0 "$HOOK_RC" "(3) cooldown elapsed → rc 0"
assert_contains "$HOOK_OUT" "回合中途采样" "(3) same band but cooldown elapsed → injects"
assert_eq "$NOW_SEC" "$(sample_inject_at "$SS")" "(3) refreshes last_inject_at to now"
rm -rf "$H"

# ── (4) WINDOW RESET clears band memory → escalation re-detected → inject ─────────────────────────────
H="$(seed_armed_home "sess-4")"; RC="$H/rate.json"; SS="$H/sample.json"
NEW_RESET=$((NOW_SEC + 7200))
write_rate_cache "$RC" 87 40 "$NEW_RESET" "$NOW_SEC"
write_sample_state "$SS" $((NOW_SEC - 60)) "throttle" "$FUTURE_RESET"   # OLD window; recent inject (would block w/o reset)
run_sample "$H" "sess-4" "$RC" "$SS" "$ADV_THROTTLE"
assert_eq 0 "$HOOK_RC" "(4) window reset → rc 0"
assert_contains "$HOOK_OUT" "回合中途采样" "(4) 5h window reset clears band → escalation re-fires (not suppressed by stale cooldown)"
rm -rf "$H"

# ── (5) SUB-AGENT gate: stdin carries top-level agent_id → silent early-return (红线4) ────────────────
H="$(seed_armed_home "sess-5")"; RC="$H/rate.json"; SS="$H/sample.json"
write_rate_cache "$RC" 92 40 "$FUTURE_RESET" "$NOW_SEC"
write_sample_state "$SS" 0 "normal" "$FUTURE_RESET"
STUB5="$(mk_ccm_stub "$ADV_THROTTLE")"
HOOK_OUT="$(printf '{"session_id":"sess-5","hook_event_name":"PostToolBatch","agent_id":"sub-123"}' \
  | env CC_MASTER_HOME="$H" CC_MASTER_NOW="$NOW" CC_MASTER_RATE_CACHE="$RC" CC_MASTER_PACING_SAMPLE_STATE="$SS" CCM_BIN="$STUB5" \
    "$HOOK" 2>/dev/null)"; HOOK_RC=$?
assert_eq 0 "$HOOK_RC" "(5) sub-agent → rc 0"
assert_eq "" "$HOOK_OUT" "(5) sub-agent context (agent_id present) → silent (WIP/pacing not leaked to leaf·红线4)"
rm -rf "$H" "$(dirname "$STUB5")"

# ── (6) ccm ABSENT (band says inject, but ccm unavailable) → SILENT (ADR-024 retired the local fallback) ──
H="$(seed_armed_home "sess-6")"; RC="$H/rate.json"; SS="$H/sample.json"
write_rate_cache "$RC" 92 40 "$FUTURE_RESET" "$NOW_SEC"
write_sample_state "$SS" 0 "normal" "$FUTURE_RESET"
HOOK_OUT="$(printf '{"session_id":"sess-6","hook_event_name":"PostToolBatch"}' \
  | env CC_MASTER_HOME="$H" CC_MASTER_NOW="$NOW" CC_MASTER_RATE_CACHE="$RC" CC_MASTER_PACING_SAMPLE_STATE="$SS" \
      CCM_BIN="/nonexistent-ccm-absent" \
    "$HOOK" 2>/dev/null)"; HOOK_RC=$?
assert_eq 0 "$HOOK_RC" "(6) ccm absent → rc 0"
assert_eq "" "$HOOK_OUT" "(6) band critical but ccm absent → SILENT (no local fallback·ADR-024)"
assert_eq "throttle" "$(sample_band "$SS")" "(6) still refreshes band memory (so a later escalation is detectable)"
rm -rf "$H"

# ── (7) RATE-CACHE absent → band null → silent (中途宁可漏报不刷屏) ────────────────────────────────────
H="$(seed_armed_home "sess-7")"; SS="$H/sample.json"
write_sample_state "$SS" 0 "normal" "$FUTURE_RESET"
run_sample "$H" "sess-7" "/nonexistent-rate-cache-xyz" "$SS" "$ADV_THROTTLE"
assert_eq 0 "$HOOK_RC" "(7) rate-cache absent → rc 0"
assert_eq "" "$HOOK_OUT" "(7) no account-authoritative sidecar → band null → silent (no ccm spawn even)"
rm -rf "$H"

# ── (8) NORMAL band (5h 50% < floor, 7d 40% < gate) → silent + records band=normal ───────────────────
H="$(seed_armed_home "sess-8")"; RC="$H/rate.json"; SS="$H/sample.json"
write_rate_cache "$RC" 50 40 "$FUTURE_RESET" "$NOW_SEC"
write_sample_state "$SS" 0 "normal" "$FUTURE_RESET"
run_sample "$H" "sess-8" "$RC" "$SS" "$ADV_THROTTLE"
assert_eq 0 "$HOOK_RC" "(8) normal band → rc 0"
assert_eq "" "$HOOK_OUT" "(8) below floor (normal band) → silent (mid-turn only reports critical side)"
assert_eq "normal" "$(sample_band "$SS")" "(8) records band=normal (so a later escalation is detectable)"
rm -rf "$H"

# ── (9) UNDERUSE-shaped (low 5h% near reset) NOT reported mid-turn: normal band → silent (只报临界侧) ──
H="$(seed_armed_home "sess-9")"; RC="$H/rate.json"; SS="$H/sample.json"
NEAR_RESET=$((NOW_SEC + 600))
write_rate_cache "$RC" 30 40 "$NEAR_RESET" "$NOW_SEC"
write_sample_state "$SS" 0 "normal" "$NEAR_RESET"
run_sample "$H" "sess-9" "$RC" "$SS" "$ADV_THROTTLE"
assert_eq "" "$HOOK_OUT" "(9) underuse-shaped 5h → normal band → mid-turn STILL silent (never accelerate·只报临界侧)"
rm -rf "$H"

# ── (10) STOP_7D band (7d 90% ≥ gate) → escalates → injects with the dispatch-gate severity wording ──
H="$(seed_armed_home "sess-10")"; RC="$H/rate.json"; SS="$H/sample.json"
write_rate_cache "$RC" 50 90 "$FUTURE_RESET" "$NOW_SEC"   # 7d 90% ≥ 85 gate → stop_7d band
write_sample_state "$SS" 0 "normal" "$FUTURE_RESET"
run_sample "$H" "sess-10" "$RC" "$SS" "$ADV_STOP7D"
assert_contains "$HOOK_OUT" "回合中途采样" "(10) 7d ≥ gate → stop_7d band escalates → injects"
assert_contains "$HOOK_OUT" "dispatch" "(10) stop_7d carries the dispatch-gate wording (pause dispatch)"
assert_eq "stop_7d" "$(sample_band "$SS")" "(10) persists last_band=stop_7d (renamed from hard_stop·ADR-024)"
rm -rf "$H"

# ── (11) UNARMED (board owned by other session) → silent even when critical (red line 6) ──────────────
H="$(seed_armed_home "sess-other")"; RC="$H/rate.json"; SS="$H/sample.json"
write_rate_cache "$RC" 92 40 "$FUTURE_RESET" "$NOW_SEC"
write_sample_state "$SS" 0 "normal" "$FUTURE_RESET"
run_sample "$H" "sess-mine" "$RC" "$SS" "$ADV_THROTTLE"   # stdin sid != board owner
assert_eq 0 "$HOOK_RC" "(11) unarmed → rc 0"
assert_eq "" "$HOOK_OUT" "(11) other session's board → silent even when critical (dormant-until-armed)"
rm -rf "$H"

finish
