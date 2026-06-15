#!/usr/bin/env bash
# Tests for usage-pacing.js (H8 — node Stop hook, ADR-006). The hook reads usage JSONL (same parse +
# 5h rolling-block + burn-rate logic as scripts/cc-usage.sh), and when it nears the 5h burn-rate wall
# injects a NON-BLOCKING additionalContext pacing warning (hookEventName "Stop"). It NEVER emits
# decision:block, is read-only on usage JSONL (never touches the board), and on any failure / no data
# degrades silently (empty out, rc 0) so it can never pollute Stop.
#
# helpers.sh::run_hook is bash-only (`bash "$1"`), so it can't drive a node shebang script — we invoke
# the .js directly via its shebang and inject fixtures through the env override points the hook exposes
# (CC_MASTER_USAGE_DIR / CC_MASTER_NOW / CC_MASTER_5H_BUDGET / CC_MASTER_5H_BURN_FLOOR), the node dual
# of cc-usage.sh's --dir/--now. We do NOT modify helpers.sh.
. "$(dirname "$0")/helpers.sh"

HOOK="$PLUGIN_ROOT/hooks/scripts/usage-pacing.js"

# run_pacing USAGE_DIR NOW [BUDGET] [BURN_FLOOR] -> sets HOOK_OUT / HOOK_RC.
# ARMED: stdin carries a Stop event whose session_id (sess-x) OWNS an active board in CC_MASTER_HOME
# (seeded below). The hook is now armed-gated — it only reads usage when this session is armed, so the
# default driver seeds a matching active board into a fresh home and points CC_MASTER_HOME at it.
# We invoke the .js by path so its `#!/usr/bin/env node` shebang runs node.
ARMED_HOME=""
_seed_armed_home() { # SID -> echo a fresh home dir holding an active board owned by SID
  local h; h="$(make_project)"
  mkdir -p "$h"
  printf '{"schema":"cc-master/v1","goal":"g","owner":{"active":true,"session_id":"%s"},"tasks":[{"id":"T1","status":"in_flight","deps":[]}]}' "$1" > "$h/armed.board.json"
  echo "$h"
}
run_pacing() {
  ARMED_HOME="$(_seed_armed_home "sess-x")"
  HOOK_OUT="$(printf '{"session_id":"sess-x","hook_event_name":"Stop"}' \
    | CC_MASTER_USAGE_DIR="$1" CC_MASTER_NOW="$2" \
      CC_MASTER_5H_BUDGET="${3:-}" CC_MASTER_5H_BURN_FLOOR="${4:-}" \
      CC_MASTER_HOME="$ARMED_HOME" CC_MASTER_RATE_CACHE="/nonexistent-pacing-rate-cache" \
      "$HOOK" 2>/dev/null)"; HOOK_RC=$?
  rm -rf "$ARMED_HOME"
}
# run_pacing_home USAGE_DIR NOW HOME SID [BUDGET] [BURN_FLOOR] -> drive with an explicit home + sid
# (for the armed-gate cases: unarmed home, other-session board, missing-session stdin, etc.).
run_pacing_home() {
  HOOK_OUT="$(printf '{"session_id":"%s","hook_event_name":"Stop"}' "$4" \
    | CC_MASTER_USAGE_DIR="$1" CC_MASTER_NOW="$2" CC_MASTER_HOME="$3" CC_MASTER_RATE_CACHE="/nonexistent-pacing-rate-cache" \
      CC_MASTER_5H_BUDGET="${5:-}" CC_MASTER_5H_BURN_FLOOR="${6:-}" \
      "$HOOK" 2>/dev/null)"; HOOK_RC=$?
}
# run_pacing_stdin USAGE_DIR NOW HOME STDIN_JSON [BUDGET] [BURN_FLOOR] -> arbitrary stdin (e.g. no sid).
run_pacing_stdin() {
  HOOK_OUT="$(printf '%s' "$4" \
    | CC_MASTER_USAGE_DIR="$1" CC_MASTER_NOW="$2" CC_MASTER_HOME="$3" CC_MASTER_RATE_CACHE="/nonexistent-pacing-rate-cache" \
      CC_MASTER_5H_BUDGET="${5:-}" CC_MASTER_5H_BURN_FLOOR="${6:-}" \
      "$HOOK" 2>/dev/null)"; HOOK_RC=$?
}

# mkjsonl DIR  — seed a single usage JSONL with the given heredoc-on-stdin content under DIR/.
mkjsonl() { mkdir -p "$1"; cat > "$1/usage.jsonl"; }

# Reuse the script-test fixtures for the dedup/window math (same algorithm, same fixtures).
FIX="$(cd "$(dirname "$0")/../scripts/fixtures" && pwd)"
SAMPLE="$FIX/sample"   # used=3400, window 10:00Z+5h, remaining 180min @ 12:00Z

# ── (a) CRITICAL via budget overshoot → warn with REAL numbers, NON-blocking, rc 0 ──────────────────
# SAMPLE used=3400 already exceeds a 3000 budget → projected breach → must warn.
run_pacing "$SAMPLE" "2026-06-10T12:00:00Z" "3000"
assert_eq 0 "$HOOK_RC" "(a) budget overshoot → rc 0"
assert_contains "$HOOK_OUT" "additionalContext" "(a) injects additionalContext"
assert_contains "$HOOK_OUT" '"hookEventName":"Stop"' "(a) hookEventName is Stop"
assert_contains "$HOOK_OUT" "3400" "(a) carries real used_tokens (3400)"
assert_contains "$HOOK_OUT" "3000" "(a) carries the budget ceiling (3000)"
assert_contains "$HOOK_OUT" "downgrade model" "(a) points at pacing levers (downgrade model)"
assert_not_contains "$HOOK_OUT" '"decision":"block"' "(a) NEVER blocks — non-blocking only"

# ── (a') CRITICAL no-budget: near wall + burn over floor → warn, non-blocking, rc 0 ─────────────────
# block start 07:00Z, used 10000, now 11:55Z → elapsed 295min, burn≈34/min, remaining 5min. With a low
# burn floor (30) the "near wall AND fast burn" heuristic fires. No CC_MASTER_5H_BUDGET set.
H="$(make_project)"
mkjsonl "$H" <<'JL'
{"type":"assistant","message":{"id":"a1","usage":{"input_tokens":10000}},"timestamp":"2026-06-10T07:00:00Z"}
JL
run_pacing "$H" "2026-06-10T11:55:00Z" "" "30"
assert_eq 0 "$HOOK_RC" "(a') no-budget critical → rc 0"
assert_contains "$HOOK_OUT" "additionalContext" "(a') injects additionalContext"
assert_contains "$HOOK_OUT" "10000" "(a') carries real used_tokens"
assert_contains "$HOOK_OUT" "5 min" "(a') carries real window_remaining (5 min)"
assert_not_contains "$HOOK_OUT" '"decision":"block"' "(a') NEVER blocks"
rm -rf "$H"

# ── (b) PLENTY of headroom → silent (no spam), rc 0 ─────────────────────────────────────────────────
# (b1) SAMPLE @ 12:00Z, no budget: remaining 180min > 60 → silent regardless of burn.
run_pacing "$SAMPLE" "2026-06-10T12:00:00Z"
assert_eq 0 "$HOOK_RC" "(b1) plenty headroom (no budget) → rc 0"
assert_eq "" "$HOOK_OUT" "(b1) plenty headroom → silent (no output)"

# (b2) budget set but projection stays under it → silent. Low burn fixture, generous budget.
H="$(make_project)"
mkjsonl "$H" <<'JL'
{"type":"assistant","message":{"id":"b1","usage":{"input_tokens":500}},"timestamp":"2026-06-10T11:00:00Z"}
JL
run_pacing "$H" "2026-06-10T11:30:00Z" "1000000"
assert_eq 0 "$HOOK_RC" "(b2) under-budget projection → rc 0"
assert_eq "" "$HOOK_OUT" "(b2) projection stays under budget → silent"
rm -rf "$H"

# (b3) no budget, near wall but burn UNDER the default floor (5000) → silent (anti-spam default).
# Same shape as (a') but WITHOUT lowering the floor → default 5000 keeps it quiet (burn≈34 < 5000).
H="$(make_project)"
mkjsonl "$H" <<'JL'
{"type":"assistant","message":{"id":"b3","usage":{"input_tokens":10000}},"timestamp":"2026-06-10T07:00:00Z"}
JL
run_pacing "$H" "2026-06-10T11:55:00Z"
assert_eq 0 "$HOOK_RC" "(b3) near wall but burn under default floor → rc 0"
assert_eq "" "$HOOK_OUT" "(b3) default high burn floor keeps normal use silent (no spam)"
rm -rf "$H"

# (b4) closed/stale window → remaining 0 → silent (no wall to hit). SAMPLE @ 20:00Z (block closed 15:00Z).
run_pacing "$SAMPLE" "2026-06-10T20:00:00Z" "1"
assert_eq 0 "$HOOK_RC" "(b4) stale window → rc 0"
assert_eq "" "$HOOK_OUT" "(b4) closed window (remaining 0) → silent even with tiny budget"

# ── (c) JSONL missing / corrupt → silent, rc 0, never throws ─────────────────────────────────────────
# (c1) usage dir does not exist at all → silent.
run_pacing "/nonexistent-usage-dir-xyz" "2026-06-10T12:00:00Z" "1"
assert_eq 0 "$HOOK_RC" "(c1) missing usage dir → rc 0 (no throw)"
assert_eq "" "$HOOK_OUT" "(c1) missing usage dir → silent"

# (c2) corrupt JSONL (garbage lines, no parseable rows) → silent.
H="$(make_project)"
mkjsonl "$H" <<'JL'
this is not json {{{
}}}{ broken
JL
run_pacing "$H" "2026-06-10T12:00:00Z" "1"
assert_eq 0 "$HOOK_RC" "(c2) corrupt JSONL → rc 0 (graceful degrade, no throw)"
assert_eq "" "$HOOK_OUT" "(c2) corrupt JSONL → silent"
rm -rf "$H"

# (c3) corrupt line MIXED with a valid row → bad line skipped, valid one still parsed, no throw.
# Valid row at 11:59Z, now 12:00Z, no budget, remaining huge → silent, but must NOT crash on the bad line.
H="$(make_project)"
mkjsonl "$H" <<'JL'
total garbage line not json
{"type":"assistant","message":{"id":"c3","usage":{"input_tokens":5}},"timestamp":"2026-06-10T11:59:00Z"}
JL
run_pacing "$H" "2026-06-10T12:00:00Z"
assert_eq 0 "$HOOK_RC" "(c3) corrupt+valid mix → rc 0 (bad line skipped, no throw)"
assert_eq "" "$HOOK_OUT" "(c3) corrupt+valid mix → silent (plenty headroom)"
rm -rf "$H"

# ── extra guards ────────────────────────────────────────────────────────────────────────────────────

# (d) non-numeric / non-positive budget → treated as 'no budget' → degrades to heuristic, not a crash.
# SAMPLE @ 12:00Z, budget "abc": falls back to heuristic; remaining 180>60 → silent.
run_pacing "$SAMPLE" "2026-06-10T12:00:00Z" "abc"
assert_eq 0 "$HOOK_RC" "(d) non-numeric budget → rc 0 (no crash)"
assert_eq "" "$HOOK_OUT" "(d) non-numeric budget → falls back to heuristic → silent (180>60)"

# (e) invalid --now (CC_MASTER_NOW) → silent (does not guess a time), rc 0.
run_pacing "$SAMPLE" "not-a-date" "1"
assert_eq 0 "$HOOK_RC" "(e) invalid CC_MASTER_NOW → rc 0"
assert_eq "" "$HOOK_OUT" "(e) invalid CC_MASTER_NOW → silent (no guessing)"

# ── ARMED GATE (the critical fix): usage-pacing must stay DORMANT until this session is armed ────────
# Before this gate, usage-pacing read host-global usage and warned in EVERY session — polluting
# sessions that never ran as-master-orchestrator. It must now only fire when THIS session is armed:
# home holds an active board with owner.session_id == stdin session_id (sid empty → degraded: any
# active board). Even at a CRITICAL usage threshold, an UNARMED session must be SILENT.

# (f1) UNARMED — empty home (no board at all). SAMPLE @ 12:00Z with a tiny budget (3000) would
#       normally warn (used 3400 > 3000), but with no armed board → MUST be silent.
H="$(make_project)"
run_pacing_home "$SAMPLE" "2026-06-10T12:00:00Z" "$H" "sess-unarmed" "3000"
assert_eq 0 "$HOOK_RC" "(f1) unarmed empty home → rc 0"
assert_eq "" "$HOOK_OUT" "(f1) unarmed (no board) → silent even at critical usage (the pollution fix)"
rm -rf "$H"

# (f2) UNARMED — home has an active board owned by ANOTHER session → not mine → silent at critical.
H="$(make_project)"
printf '{"schema":"cc-master/v1","goal":"g","owner":{"active":true,"session_id":"sess-other"},"tasks":[{"id":"T1","status":"in_flight","deps":[]}]}' > "$H/other.board.json"
run_pacing_home "$SAMPLE" "2026-06-10T12:00:00Z" "$H" "sess-mine" "3000"
assert_eq 0 "$HOOK_RC" "(f2) other session's board → rc 0"
assert_eq "" "$HOOK_OUT" "(f2) other session's active board → silent (not armed for me)"
rm -rf "$H"

# (f3) UNARMED — home has only an ARCHIVED board (owner.active:false) for my session → not armed.
H="$(make_project)"
printf '{"schema":"cc-master/v1","goal":"g","owner":{"active":false,"session_id":"sess-arch"},"tasks":[{"id":"T1","status":"in_flight","deps":[]}]}' > "$H/arch.board.json"
run_pacing_home "$SAMPLE" "2026-06-10T12:00:00Z" "$H" "sess-arch" "3000"
assert_eq 0 "$HOOK_RC" "(f3) archived board → rc 0"
assert_eq "" "$HOOK_OUT" "(f3) archived (inactive) board → silent (arming requires active)"
rm -rf "$H"

# (f4) ARMED — home has an active board owned by THIS session → gate opens → critical usage warns.
H="$(make_project)"
printf '{"schema":"cc-master/v1","goal":"g","owner":{"active":true,"session_id":"sess-armed"},"tasks":[{"id":"T1","status":"in_flight","deps":[]}]}' > "$H/mine.board.json"
run_pacing_home "$SAMPLE" "2026-06-10T12:00:00Z" "$H" "sess-armed" "3000"
assert_eq 0 "$HOOK_RC" "(f4) armed session → rc 0"
assert_contains "$HOOK_OUT" "additionalContext" "(f4) armed + critical usage → warns (gate open)"
assert_contains "$HOOK_OUT" "3400" "(f4) armed → carries real used_tokens"
assert_not_contains "$HOOK_OUT" '"decision":"block"' "(f4) armed → still NEVER blocks"
rm -rf "$H"

# (f5) DEGRADED — stdin carries NO session_id, but home has an active board → degraded gate matches
#       any active board → armed → warns. (Compaction-boundary robustness, mirrors the bash hooks.)
H="$(make_project)"
printf '{"schema":"cc-master/v1","goal":"g","owner":{"active":true,"session_id":"sess-whatever"},"tasks":[{"id":"T1","status":"in_flight","deps":[]}]}' > "$H/some.board.json"
run_pacing_stdin "$SAMPLE" "2026-06-10T12:00:00Z" "$H" '{"hook_event_name":"Stop"}' "3000"
assert_eq 0 "$HOOK_RC" "(f5) no session_id, active board present → rc 0"
assert_contains "$HOOK_OUT" "additionalContext" "(f5) degraded gate (no sid → any active) → armed → warns"
rm -rf "$H"

# (f6) DEGRADED — no session_id AND no active board → NOT armed → silent (degraded path doesn't fire
#       on an empty home; the gate still requires SOME active board).
H="$(make_project)"
run_pacing_stdin "$SAMPLE" "2026-06-10T12:00:00Z" "$H" '{"hook_event_name":"Stop"}' "3000"
assert_eq 0 "$HOOK_RC" "(f6) no session_id, no board → rc 0"
assert_eq "" "$HOOK_OUT" "(f6) degraded path with no active board → silent (not armed)"
rm -rf "$H"

# ── STOP RE-ENTRY GUARD: stop_hook_active:true → silent (the never-blocks / no-loop contract) ─────────
# Claude Code re-fires a Stop hook with stop_hook_active:true when a prior Stop hook's additionalContext
# continued the conversation and the agent tries to Stop again. If usage is still over budget, re-injecting
# the same pacing warning every Stop creates a "session can never stop" loop (no decision:block, but the
# effect is a hang) — violating the never-blocks contract. On re-entry the hook MUST stay silent so the
# warning shows at most once per genuine new Stop.

# (g1) ARMED + CRITICAL (used 3400 > budget 3000) + stop_hook_active:true → MUST be silent (re-entry guard).
H="$(make_project)"
printf '{"schema":"cc-master/v1","goal":"g","owner":{"active":true,"session_id":"sess-re"},"tasks":[{"id":"T1","status":"in_flight","deps":[]}]}' > "$H/mine.board.json"
run_pacing_stdin "$SAMPLE" "2026-06-10T12:00:00Z" "$H" \
  '{"session_id":"sess-re","hook_event_name":"Stop","stop_hook_active":true}' "3000"
assert_eq 0 "$HOOK_RC" "(g1) re-entry → rc 0"
assert_eq "" "$HOOK_OUT" "(g1) stop_hook_active:true → silent (re-entry guard, no Stop loop)"
assert_not_contains "$HOOK_OUT" "additionalContext" "(g1) re-entry injects NO additionalContext"
rm -rf "$H"

# (g2) CONTROL — identical armed+critical case but stop_hook_active:false (a genuine new Stop) → warns.
#       Proves the guard keys on the re-entry flag, not on the armed/critical state itself.
H="$(make_project)"
printf '{"schema":"cc-master/v1","goal":"g","owner":{"active":true,"session_id":"sess-re"},"tasks":[{"id":"T1","status":"in_flight","deps":[]}]}' > "$H/mine.board.json"
run_pacing_stdin "$SAMPLE" "2026-06-10T12:00:00Z" "$H" \
  '{"session_id":"sess-re","hook_event_name":"Stop","stop_hook_active":false}' "3000"
assert_eq 0 "$HOOK_RC" "(g2) genuine new Stop → rc 0"
assert_contains "$HOOK_OUT" "additionalContext" "(g2) stop_hook_active:false → warns (first Stop still fires)"
rm -rf "$H"

# ── ASYMMETRIC DEGRADE: a blank-session active board stays DORMANT for a non-empty stdin sid (CODEX14) ─
# A symmetric degrade adopting empty-board-sid boards was tried (CODEX12) and REVERTED (CODEX14): adopting
# a blank board would arm EVERY unrelated session, re-introducing the cross-session pollution red line 6
# forbids. Ruling (ADR-007 §2.3 / §4.5): red line 6 (non-negotiable) outranks the orphan edge-case.
# Legitimate resume/compaction PRESERVE session_id, so a legitimately-resumed board carries its original
# session_id and matches normally; the anomalous blank board stays dormant (fail-safe), claimed by an
# explicit re-arm. "board sid non-empty yet != stdin sid" likewise stays dormant (red line 6).

# (h1) BLANK-SID BOARD STAYS DORMANT — active board with owner.session_id:"" + a NON-empty stdin sid, at a
#       CRITICAL usage threshold. Strict match "" != "sess-adopt" → unarmed → silent. This is exactly the
#       red line 6 fail-safe: a blank board does NOT auto-adopt an arbitrary session.
H="$(make_project)"
printf '{"schema":"cc-master/v1","goal":"g","owner":{"active":true,"session_id":""},"tasks":[{"id":"T1","status":"in_flight","deps":[]}]}' > "$H/empty.board.json"
run_pacing_home "$SAMPLE" "2026-06-10T12:00:00Z" "$H" "sess-adopt" "3000"
assert_eq 0 "$HOOK_RC" "(h1) blank-session board + non-empty stdin sid → rc 0"
assert_eq "" "$HOOK_OUT" "(h1) blank-session active board (owner.session_id:\"\") + non-empty stdin sid → stays dormant, silent (CODEX14 revert, red line 6 fail-safe)"
rm -rf "$H"

# (h2) RED LINE 6 DEFENCE RETAINED — active board with owner.session_id:"OTHER" (non-empty) + a
#       DIFFERENT non-empty stdin sid "MINE", at critical usage → MUST stay silent. Proves the symmetric
#       degrade did NOT collapse into "any active board arms"; the true cross-session pollution defence
#       is unchanged.
H="$(make_project)"
printf '{"schema":"cc-master/v1","goal":"g","owner":{"active":true,"session_id":"OTHER"},"tasks":[{"id":"T1","status":"in_flight","deps":[]}]}' > "$H/other.board.json"
run_pacing_home "$SAMPLE" "2026-06-10T12:00:00Z" "$H" "MINE" "3000"
assert_eq 0 "$HOOK_RC" "(h2) board sid non-empty & != stdin sid → rc 0"
assert_eq "" "$HOOK_OUT" "(h2) board sid=OTHER (non-empty) != stdin sid=MINE → still silent (red line 6 defence intact)"
rm -rf "$H"

# ── ACCOUNT 口径 (Finding #37): sidecar 的权威 5h/7d used_percentage 判墙,脱钩失真反推,纳入 7d ──────────
# 账户权威 used_percentage(+resets_at)由 statusline-capture.js 落到 sidecar(status-line 是唯一来源)。sidecar
# 可用且窗口有效时,撞墙判据改用账户 % —— 不再依赖会失真到数量级的本地反推 window_remaining_min(Finding #37);
# 并第一次把 7d 纳入(此前 hook 只看 5h、对 7d 全盲,Finding #31)。sidecar 不可用 → 降级本地反推(上面的 cases)。
# run_pacing_acct SIDECAR_JSON NOW HOME SID -> drive an armed Stop carrying a rate-limit sidecar.
run_pacing_acct() {
  local cdir; cdir="$(make_project)"; local cache="$cdir/rate.json"
  printf '%s' "$1" > "$cache"
  HOOK_OUT="$(printf '{"session_id":"%s","hook_event_name":"Stop"}' "$4" \
    | CC_MASTER_USAGE_DIR="$SAMPLE" CC_MASTER_NOW="$2" CC_MASTER_HOME="$3" CC_MASTER_RATE_CACHE="$cache" \
      "$HOOK" 2>/dev/null)"; HOOK_RC=$?
  rm -rf "$cdir"
}
ACCT_HOME="$(make_project)"
printf '{"schema":"cc-master/v1","goal":"g","owner":{"active":true,"session_id":"sess-acct"},"tasks":[{"id":"T1","status":"in_flight","deps":[]}]}' > "$ACCT_HOME/mine.board.json"
A_NOWEP="$(python3 -c 'import datetime as d;print(int(d.datetime(2026,6,10,12,0,0,tzinfo=d.timezone.utc).timestamp()))')"
A_R5F=$((A_NOWEP+3600))  # 5h resets 1h in the future → window valid
A_R5FAR=$((A_NOWEP+18000))  # 5h resets 5h out → window valid but NOT nearReset (keeps underuse branch quiet)

# (acct-1) high 5h used% (90 ≥ floor 85) → warns, carries account 5h %, non-blocking.
run_pacing_acct "{\"five_hour\":{\"used_percentage\":90,\"resets_at\":$A_R5F},\"seven_day\":{\"used_percentage\":20}}" \
  "2026-06-10T12:00:00Z" "$ACCT_HOME" "sess-acct"
assert_eq 0 "$HOOK_RC" "(acct-1) high 5h% → rc 0"
assert_contains "$HOOK_OUT" "additionalContext" "(acct-1) high account 5h used% → warns"
assert_contains "$HOOK_OUT" "90" "(acct-1) carries account 5h used_percentage (authoritative, not反推)"
assert_not_contains "$HOOK_OUT" '"decision":"block"' "(acct-1) never blocks"

# (acct-2) high 7d used% (88) while 5h low (10) → warns on 7d (Finding #31: 7d now in scope).
run_pacing_acct "{\"five_hour\":{\"used_percentage\":10,\"resets_at\":$A_R5F},\"seven_day\":{\"used_percentage\":88}}" \
  "2026-06-10T12:00:00Z" "$ACCT_HOME" "sess-acct"
assert_eq 0 "$HOOK_RC" "(acct-2) high 7d% → rc 0"
assert_contains "$HOOK_OUT" "additionalContext" "(acct-2) high account 7d used% → warns (7d now in scope)"
assert_contains "$HOOK_OUT" "88" "(acct-2) carries account 7d used_percentage"

# (acct-3) both windows under wall floor + reset NOT near (5h out) → silent (no wall warning, and the
#          underuse branch stays quiet because nearReset is not satisfied — isolates the WALL path).
run_pacing_acct "{\"five_hour\":{\"used_percentage\":30,\"resets_at\":$A_R5FAR},\"seven_day\":{\"used_percentage\":40}}" \
  "2026-06-10T12:00:00Z" "$ACCT_HOME" "sess-acct"
assert_eq 0 "$HOOK_RC" "(acct-3) both low → rc 0"
assert_eq "" "$HOOK_OUT" "(acct-3) both account windows under wall floor (reset far) → silent (no wall warning)"

# (acct-4) UNARMED + critical account sidecar → still silent (armed gate runs BEFORE reading cache).
A_UH="$(make_project)"
run_pacing_acct "{\"five_hour\":{\"used_percentage\":99,\"resets_at\":$A_R5F},\"seven_day\":{\"used_percentage\":99}}" \
  "2026-06-10T12:00:00Z" "$A_UH" "sess-unarmed-acct"
assert_eq "" "$HOOK_OUT" "(acct-4) unarmed → silent even at critical account % (armed gate intact)"
rm -rf "$A_UH"
rm -rf "$ACCT_HOME"

# ── UNDERUSE 口径 (对偶于撞墙侧): 欠用 + 临近 reset + 7d 有余量 → 对称的「加速」非阻断提示 ──────────────
# decideAccountUnderuse 与 decideAccountWarning 对称：撞墙问「快烧到墙了要不要减速」，欠用问「窗口快 reset
# 了却没怎么用、再不烧就白白蒸发，要不要加速」。三条 AND 判据（缺一静默，保守不乱催）：① 5h used% <
# UNDERUSE_PCT_CEIL(默认60)；② 5h resets_at 有效且距 reset 剩余 ≤ UNDERUSE_REMAIN_MIN(默认60)；③ 7d used% <
# SEVEN_DAY_HEADROOM(默认80)，**7d 缺失即静默**(总闸未知不开闸)。账户分支才有欠用提示——本地反推路径禁。
# 用 run_pacing_acct（armed Stop + sidecar 注入）；nearReset 用「resets_at = now + 30min」(<60 默认窗)。
U_HOME="$(make_project)"
printf '{"schema":"cc-master/v1","goal":"g","owner":{"active":true,"session_id":"sess-acct"},"tasks":[{"id":"T1","status":"in_flight","deps":[]}]}' > "$U_HOME/mine.board.json"
U_NEAR=$((A_NOWEP+1800))   # 5h reset 30min in the future → nearReset 满足(≤60)
U_FAR=$((A_NOWEP+9000))    # 5h reset 150min in the future → nearReset 不满足(>60)
# Freshness gate (④): sidecar carries captured_at (epoch sec, written by statusline-capture.js). The
# underuse→accelerate branch now requires captured_at fresh (≤ CC_MASTER_UNDERUSE_MAX_STALE_MIN, default
# 15min) — stale/missing → silent (idle-waiting on background烧配额 → stale-low p5 不可信，绝不据陈值误催加速).
U_FRESH=$((A_NOWEP-300))    # captured 5min ago → fresh (≤15min) → gate open
U_STALE=$((A_NOWEP-3600))   # captured 60min ago → stale (>15min) → gate shut → silent

# (under-1) 三条 AND 全真（5h 20% < 60、reset 30min ≤ 60、7d 30% < 80）+ 新鲜 captured_at → 出加速提示，非阻断，rc 0。
run_pacing_acct "{\"captured_at\":$U_FRESH,\"five_hour\":{\"used_percentage\":20,\"resets_at\":$U_NEAR},\"seven_day\":{\"used_percentage\":30}}" \
  "2026-06-10T12:00:00Z" "$U_HOME" "sess-acct"
assert_eq 0 "$HOOK_RC" "(under-1) underuse all-AND → rc 0"
assert_contains "$HOOK_OUT" "additionalContext" "(under-1) underuse → injects additionalContext"
assert_contains "$HOOK_OUT" "欠用" "(under-1) carries the underuse signal phrase (欠用)"
assert_contains "$HOOK_OUT" "加速" "(under-1) points at accelerate levers (加速)"
assert_contains "$HOOK_OUT" "20" "(under-1) carries account 5h used_percentage (20)"
assert_not_contains "$HOOK_OUT" '"decision":"block"' "(under-1) NEVER blocks — non-blocking only"

# (under-fresh) 三条 AND 全真 + captured_at 新鲜（now-300s ≤ 15min）→ 仍出加速提示（新鲜度闸放行）。
run_pacing_acct "{\"captured_at\":$U_FRESH,\"five_hour\":{\"used_percentage\":20,\"resets_at\":$U_NEAR},\"seven_day\":{\"used_percentage\":30}}" \
  "2026-06-10T12:00:00Z" "$U_HOME" "sess-acct"
assert_eq 0 "$HOOK_RC" "(under-fresh) fresh sidecar → rc 0"
assert_contains "$HOOK_OUT" "additionalContext" "(under-fresh) fresh captured_at → accelerate prompt still fires (gate open)"
assert_contains "$HOOK_OUT" "欠用" "(under-fresh) fresh → carries the underuse signal (欠用)"

# (under-stale) 三条 AND 全真 + captured_at 过旧（now-3600s > 15min）→ 静默（新鲜度闸拦住，stale-low p5 不可信）。
run_pacing_acct "{\"captured_at\":$U_STALE,\"five_hour\":{\"used_percentage\":20,\"resets_at\":$U_NEAR},\"seven_day\":{\"used_percentage\":30}}" \
  "2026-06-10T12:00:00Z" "$U_HOME" "sess-acct"
assert_eq 0 "$HOOK_RC" "(under-stale) stale sidecar → rc 0"
assert_eq "" "$HOOK_OUT" "(under-stale) captured_at 过旧(>15min) → silent (freshness gate, no误催加速)"
assert_not_contains "$HOOK_OUT" "欠用" "(under-stale) stale → injects NO accelerate prompt"

# (under-nocap) 三条 AND 全真 + sidecar 无 captured_at 字段 → 静默（缺失 = 保守静默，不据无新鲜度证据催加速）。
run_pacing_acct "{\"five_hour\":{\"used_percentage\":20,\"resets_at\":$U_NEAR},\"seven_day\":{\"used_percentage\":30}}" \
  "2026-06-10T12:00:00Z" "$U_HOME" "sess-acct"
assert_eq 0 "$HOOK_RC" "(under-nocap) sidecar without captured_at → rc 0"
assert_eq "" "$HOOK_OUT" "(under-nocap) no captured_at field → silent (missing = conservative silence)"
assert_not_contains "$HOOK_OUT" "欠用" "(under-nocap) missing captured_at → injects NO accelerate prompt"

# (under-2) UNARMED + underuse-shaped sidecar → still silent (armed gate runs BEFORE reading cache).
U_UH="$(make_project)"
run_pacing_acct "{\"five_hour\":{\"used_percentage\":20,\"resets_at\":$U_NEAR},\"seven_day\":{\"used_percentage\":30}}" \
  "2026-06-10T12:00:00Z" "$U_UH" "sess-unarmed-under"
assert_eq 0 "$HOOK_RC" "(under-2) unarmed → rc 0"
assert_eq "" "$HOOK_OUT" "(under-2) unarmed → silent even on underuse-shaped sidecar (armed gate intact)"
rm -rf "$U_UH"

# (under-3) WALL (5h 90% ≥ floor 85) → still the SLOWDOWN warning, NOT the accelerate one (mutually
#           exclusive: 撞墙优先，到墙只发减速；欠用区间 used%<60 与撞墙 used%≥85 天然不重叠).
run_pacing_acct "{\"five_hour\":{\"used_percentage\":90,\"resets_at\":$U_NEAR},\"seven_day\":{\"used_percentage\":20}}" \
  "2026-06-10T12:00:00Z" "$U_HOME" "sess-acct"
assert_eq 0 "$HOOK_RC" "(under-3) wall → rc 0"
assert_contains "$HOOK_OUT" "临界" "(under-3) wall → emits the SLOWDOWN warning (临界)"
assert_contains "$HOOK_OUT" "降到更便宜的模型档" "(under-3) wall → points at slowdown levers (降到更便宜的模型档)"
assert_not_contains "$HOOK_OUT" "欠用" "(under-3) wall → does NOT emit accelerate (mutually exclusive)"

# (under-4) 7d MISSING (no seven_day key) while 5h underused + nearReset → silent (保守：总闸未知不开闸).
run_pacing_acct "{\"five_hour\":{\"used_percentage\":20,\"resets_at\":$U_NEAR}}" \
  "2026-06-10T12:00:00Z" "$U_HOME" "sess-acct"
assert_eq 0 "$HOOK_RC" "(under-4) 7d missing → rc 0"
assert_eq "" "$HOOK_OUT" "(under-4) 7d signal missing → silent (总闸状态未知就别开闸)"

# (under-5) 7d NEAR-CAP — 7d 82% sits in the band [headroom 80, wall floor 85): the wall branch does NOT
#           fire (82 < 85) so we reach the underuse branch, where 82 ≥ headroom(80) blocks acceleration →
#           silent. Isolates the 7d 总闸 gate of the underuse branch (not the wall path).
run_pacing_acct "{\"five_hour\":{\"used_percentage\":20,\"resets_at\":$U_NEAR},\"seven_day\":{\"used_percentage\":82}}" \
  "2026-06-10T12:00:00Z" "$U_HOME" "sess-acct"
assert_eq 0 "$HOOK_RC" "(under-5) 7d near cap → rc 0"
assert_eq "" "$HOOK_OUT" "(under-5) 7d ≥ headroom(80) but < wall floor(85) → silent (7d 总闸拦住加速，别把 5h 余量烧成 7d 透支)"

# (under-6) WINDOW JUST OPENED (reset 150min out, ≫60) + 5h underused + 7d ok → silent (nearReset 不满足).
run_pacing_acct "{\"five_hour\":{\"used_percentage\":20,\"resets_at\":$U_FAR},\"seven_day\":{\"used_percentage\":30}}" \
  "2026-06-10T12:00:00Z" "$U_HOME" "sess-acct"
assert_eq 0 "$HOOK_RC" "(under-6) window just opened → rc 0"
assert_eq "" "$HOOK_OUT" "(under-6) reset far out (>60min) → silent (nearReset not satisfied)"

# (under-7) LOCAL-REVERSAL path (no sidecar) shaped like underuse → must NOT emit accelerate. The local
#           fallback (computeFiveHour) only does WALL detection; the underuse branch is account-only because
#           反推的 reset 倒计时会失真到数量级 (Finding #37). Here SAMPLE @ 12:00Z has remaining 180min and
#           low burn → local path stays silent and crucially emits no accelerate prompt.
U_LH="$(make_project)"
printf '{"schema":"cc-master/v1","goal":"g","owner":{"active":true,"session_id":"sess-local"},"tasks":[{"id":"T1","status":"in_flight","deps":[]}]}' > "$U_LH/mine.board.json"
run_pacing_home "$SAMPLE" "2026-06-10T12:00:00Z" "$U_LH" "sess-local"
assert_eq 0 "$HOOK_RC" "(under-7) local fallback path → rc 0"
assert_eq "" "$HOOK_OUT" "(under-7) no sidecar (local 反推 path) → silent"
assert_not_contains "$HOOK_OUT" "欠用" "(under-7) local 反推 path NEVER emits accelerate (反推 reset 失真，禁欠用提示)"
rm -rf "$U_LH"

# (under-8) STOP RE-ENTRY (stop_hook_active:true) + underuse-shaped sidecar → silent (re-entry guard
#           runs before reading cache, mirrors the wall side). No accelerate-loop on re-fired Stop.
run_pacing_acct() { # re-define inline to thread stop_hook_active for this one case
  local cdir; cdir="$(make_project)"; local cache="$cdir/rate.json"
  printf '%s' "$1" > "$cache"
  HOOK_OUT="$(printf '{"session_id":"sess-acct","hook_event_name":"Stop","stop_hook_active":true}' \
    | CC_MASTER_USAGE_DIR="$SAMPLE" CC_MASTER_NOW="$2" CC_MASTER_HOME="$3" CC_MASTER_RATE_CACHE="$cache" \
      "$HOOK" 2>/dev/null)"; HOOK_RC=$?
  rm -rf "$cdir"
}
run_pacing_acct "{\"five_hour\":{\"used_percentage\":20,\"resets_at\":$U_NEAR},\"seven_day\":{\"used_percentage\":30}}" \
  "2026-06-10T12:00:00Z" "$U_HOME"
assert_eq 0 "$HOOK_RC" "(under-8) re-entry → rc 0"
assert_eq "" "$HOOK_OUT" "(under-8) stop_hook_active:true → silent (re-entry guard, no accelerate loop)"
assert_not_contains "$HOOK_OUT" "欠用" "(under-8) re-entry injects NO accelerate prompt"
rm -rf "$U_HOME"

finish
