#!/usr/bin/env bash
# Tests for usage-pacing.js PostToolBatch MID-TURN SAMPLING (hooks-enhancements-v2 ③). The hook now serves
# BOTH Stop and PostToolBatch. On PostToolBatch it runs a LIGHT sample path: read the account-authoritative
# rate-cache sidecar (cheap, no spawn), compute a "band" (normal / throttle / hard_stop), and inject a
# NON-BLOCKING mid-turn advisory ONLY when (A band escalated) OR (B cooldown elapsed AND still critical).
# A 5h window reset clears the band memory. Mid-turn reports ONLY the critical side (throttle / hard_stop),
# NEVER underuse, and does NO autoswitch (that stays Stop-only). Sub-agent context (stdin top-level
# agent_id) → silent early-return. Throttle sidecar: <home>/.cc-master-pacing-sample.json.
#
# All cases force the LOCAL account-authoritative path by default (CCM_BIN nonexistent → adviseViaCcm null →
# decideAccountWarning produces the critical text). The Stop path is covered by test_usage-pacing.sh.
. "$(dirname "$0")/helpers.sh"

HOOK="$PLUGIN_ROOT/hooks/scripts/usage-pacing.js"
export CCM_BIN="/nonexistent-ccm-bin-force-local-fallback"

NOW="2026-06-10T12:00:00Z"
NOW_SEC=$(date -u -d "$NOW" +%s 2>/dev/null || date -u -j -f '%Y-%m-%dT%H:%M:%SZ' "$NOW" +%s 2>/dev/null)

# seed_armed_home SID -> echo a fresh home holding an active board owned by SID (arms the hook).
seed_armed_home() {
  local h; h="$(make_project)"; mkdir -p "$h/boards"
  printf '{"schema":"cc-master/v2","goal":"g","owner":{"active":true,"session_id":"%s"},"git":{"worktree":"","branch":""},"tasks":[{"id":"T1","status":"in_flight","deps":[]}]}' "$1" > "$h/boards/armed.board.json"
  echo "$h"
}
# write_rate_cache FILE P5 P7 RESETS_AT CAPTURED_AT -> seed the account-authoritative sidecar.
write_rate_cache() {
  printf '{"five_hour":{"used_percentage":%s,"resets_at":%s},"seven_day":{"used_percentage":%s},"captured_at":%s}\n' \
    "$2" "$4" "$3" "$5" > "$1"
}
# write_sample_state FILE LAST_INJECT_AT LAST_BAND WINDOW_RESETS_AT -> pre-seed the throttle sidecar.
write_sample_state() {
  printf '{"last_inject_at":%s,"last_band":"%s","window_resets_at":%s}\n' "$2" "$3" "$4" > "$1"
}
# run_sample HOME SID RATE_CACHE SAMPLE_STATE [EXTRA_ENV...] -> drive a PostToolBatch event; HOOK_OUT/HOOK_RC.
run_sample() {
  local home="$1" sid="$2" rc="$3" ss="$4"; shift 4
  HOOK_OUT="$(printf '{"session_id":"%s","hook_event_name":"PostToolBatch"}' "$sid" \
    | CC_MASTER_HOME="$home" CC_MASTER_NOW="$NOW" CC_MASTER_RATE_CACHE="$rc" \
      CC_MASTER_PACING_SAMPLE_STATE="$ss" "$@" \
      "$HOOK" 2>/dev/null)"; HOOK_RC=$?
}
# sample_band SS -> echo the persisted last_band from the throttle sidecar.
sample_band() {
  node -e 'const fs=require("fs");try{const o=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(String(o.last_band||""));}catch(e){}' "$1"
}
sample_inject_at() {
  node -e 'const fs=require("fs");try{const o=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(String(o.last_inject_at||""));}catch(e){}' "$1"
}

FUTURE_RESET=$((NOW_SEC + 3600))   # 5h window still valid (resets 1h from now)

# ── (1) ESCALATE: band normal→throttle (5h 87% ≥ floor) + last_band normal → inject (A·跨阈值升档) ─────
H="$(seed_armed_home "sess-1")"; RC="$H/rate.json"; SS="$H/sample.json"
write_rate_cache "$RC" 87 40 "$FUTURE_RESET" "$NOW_SEC"
write_sample_state "$SS" 0 "normal" "$FUTURE_RESET"
run_sample "$H" "sess-1" "$RC" "$SS"
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
run_sample "$H" "sess-2" "$RC" "$SS"
assert_eq 0 "$HOOK_RC" "(2) same band within cooldown → rc 0"
assert_eq "" "$HOOK_OUT" "(2) same throttle band, cooldown not elapsed → silent"
rm -rf "$H"

# ── (3) SAME BAND, cooldown elapsed → inject (B·满冷却同带仍临界) ──────────────────────────────────────
H="$(seed_armed_home "sess-3")"; RC="$H/rate.json"; SS="$H/sample.json"
write_rate_cache "$RC" 87 40 "$FUTURE_RESET" "$NOW_SEC"
write_sample_state "$SS" $((NOW_SEC - 1000)) "throttle" "$FUTURE_RESET"   # injected ~16min ago > 15min cooldown
run_sample "$H" "sess-3" "$RC" "$SS"
assert_eq 0 "$HOOK_RC" "(3) cooldown elapsed → rc 0"
assert_contains "$HOOK_OUT" "回合中途采样" "(3) same band but cooldown elapsed → injects"
assert_eq "$NOW_SEC" "$(sample_inject_at "$SS")" "(3) refreshes last_inject_at to now"
rm -rf "$H"

# ── (4) WINDOW RESET clears band memory → escalation re-detected → inject ─────────────────────────────
# New window (resets_at differs from the seeded window_resets_at) → last_band cleared to normal → 87% ≥
# floor re-escalates normal→throttle → injects even though the seeded last_band was already throttle.
H="$(seed_armed_home "sess-4")"; RC="$H/rate.json"; SS="$H/sample.json"
NEW_RESET=$((NOW_SEC + 7200))
write_rate_cache "$RC" 87 40 "$NEW_RESET" "$NOW_SEC"
write_sample_state "$SS" $((NOW_SEC - 60)) "throttle" "$FUTURE_RESET"   # OLD window; recent inject (would block w/o reset)
run_sample "$H" "sess-4" "$RC" "$SS"
assert_eq 0 "$HOOK_RC" "(4) window reset → rc 0"
assert_contains "$HOOK_OUT" "回合中途采样" "(4) 5h window reset clears band → escalation re-fires (not suppressed by stale cooldown)"
rm -rf "$H"

# ── (5) SUB-AGENT gate: stdin carries top-level agent_id → silent early-return (红线4) ────────────────
H="$(seed_armed_home "sess-5")"; RC="$H/rate.json"; SS="$H/sample.json"
write_rate_cache "$RC" 92 40 "$FUTURE_RESET" "$NOW_SEC"
write_sample_state "$SS" 0 "normal" "$FUTURE_RESET"
HOOK_OUT="$(printf '{"session_id":"sess-5","hook_event_name":"PostToolBatch","agent_id":"sub-123"}' \
  | CC_MASTER_HOME="$H" CC_MASTER_NOW="$NOW" CC_MASTER_RATE_CACHE="$RC" CC_MASTER_PACING_SAMPLE_STATE="$SS" \
    "$HOOK" 2>/dev/null)"; HOOK_RC=$?
assert_eq 0 "$HOOK_RC" "(5) sub-agent → rc 0"
assert_eq "" "$HOOK_OUT" "(5) sub-agent context (agent_id present) → silent (WIP/pacing not leaked to leaf·红线4)"
rm -rf "$H"

# ── (6) ccm ABSENT → local account-authoritative fallback still produces the critical text ────────────
# (CCM_BIN already nonexistent globally.) 92% 5h → throttle band, escalation from normal → injects via the
# LOCAL decideAccountWarning path (no ccm). Proves graceful degrade keeps mid-turn warning ability.
H="$(seed_armed_home "sess-6")"; RC="$H/rate.json"; SS="$H/sample.json"
write_rate_cache "$RC" 92 40 "$FUTURE_RESET" "$NOW_SEC"
write_sample_state "$SS" 0 "normal" "$FUTURE_RESET"
run_sample "$H" "sess-6" "$RC" "$SS"
assert_contains "$HOOK_OUT" "回合中途采样" "(6) ccm absent → local fallback still produces mid-turn critical warning"
rm -rf "$H"

# ── (7) RATE-CACHE absent/missing → band null → silent (中途宁可漏报不刷屏·不走本地反推) ───────────────
H="$(seed_armed_home "sess-7")"; SS="$H/sample.json"
write_sample_state "$SS" 0 "normal" "$FUTURE_RESET"
run_sample "$H" "sess-7" "/nonexistent-rate-cache-xyz" "$SS"
assert_eq 0 "$HOOK_RC" "(7) rate-cache absent → rc 0"
assert_eq "" "$HOOK_OUT" "(7) no account-authoritative sidecar → band null → silent (no 本地反推 mid-turn)"
rm -rf "$H"

# ── (8) NORMAL band (5h 50% < floor, 7d 40% < gate) → never out of sound + records band=normal ────────
H="$(seed_armed_home "sess-8")"; RC="$H/rate.json"; SS="$H/sample.json"
write_rate_cache "$RC" 50 40 "$FUTURE_RESET" "$NOW_SEC"
write_sample_state "$SS" 0 "normal" "$FUTURE_RESET"
run_sample "$H" "sess-8" "$RC" "$SS"
assert_eq 0 "$HOOK_RC" "(8) normal band → rc 0"
assert_eq "" "$HOOK_OUT" "(8) below floor (normal band) → silent (mid-turn only reports critical side)"
assert_eq "normal" "$(sample_band "$SS")" "(8) records band=normal (so a later escalation is detectable)"
rm -rf "$H"

# ── (9) UNDERUSE NOT reported mid-turn: low 5h% near reset → Stop path would consider underuse, but the
#    mid-turn sample path is normal-band → silent (中途只报临界侧·不报 underuse·方向性). ────────────────
H="$(seed_armed_home "sess-9")"; RC="$H/rate.json"; SS="$H/sample.json"
NEAR_RESET=$((NOW_SEC + 600))   # 10min to reset
write_rate_cache "$RC" 30 40 "$NEAR_RESET" "$NOW_SEC"   # underused + near reset → Stop would accelerate
write_sample_state "$SS" 0 "normal" "$NEAR_RESET"
run_sample "$H" "sess-9" "$RC" "$SS"
assert_eq "" "$HOOK_OUT" "(9) underuse condition → mid-turn STILL silent (never reports underuse·只报临界侧)"
rm -rf "$H"

# ── (10) HARD_STOP band (7d 90% ≥ gate) → escalates → injects with the dispatch-gate severity wording ──
H="$(seed_armed_home "sess-10")"; RC="$H/rate.json"; SS="$H/sample.json"
write_rate_cache "$RC" 50 90 "$FUTURE_RESET" "$NOW_SEC"   # 7d 90% ≥ 85 gate → hard_stop
write_sample_state "$SS" 0 "normal" "$FUTURE_RESET"
run_sample "$H" "sess-10" "$RC" "$SS"
assert_contains "$HOOK_OUT" "回合中途采样" "(10) 7d ≥ gate → hard_stop band escalates → injects"
assert_contains "$HOOK_OUT" "dispatch" "(10) hard_stop carries the dispatch-gate wording (pause dispatch)"
assert_eq "hard_stop" "$(sample_band "$SS")" "(10) persists last_band=hard_stop"
rm -rf "$H"

# ── (11) UNARMED (board owned by other session) → silent even when critical (red line 6) ──────────────
H="$(seed_armed_home "sess-other")"; RC="$H/rate.json"; SS="$H/sample.json"
write_rate_cache "$RC" 92 40 "$FUTURE_RESET" "$NOW_SEC"
write_sample_state "$SS" 0 "normal" "$FUTURE_RESET"
run_sample "$H" "sess-mine" "$RC" "$SS"   # stdin sid != board owner
assert_eq 0 "$HOOK_RC" "(11) unarmed → rc 0"
assert_eq "" "$HOOK_OUT" "(11) other session's board → silent even when critical (dormant-until-armed)"
rm -rf "$H"

finish
