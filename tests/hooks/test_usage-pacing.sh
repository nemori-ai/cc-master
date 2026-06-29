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

# ── P4 收口: the hook now prefers `ccm usage advise --json` for the corridor verdict and falls back to
# the local computation when ccm is unavailable. By DEFAULT we force the LOCAL fallback for every existing
# case (export CCM_BIN to a nonexistent binary → adviseViaCcm returns null → local path) so all the local
# account-authoritative / 本地反推 / num_account / registry cases below keep testing the FALLBACK exactly as
# before. A dedicated "── CCM SHELL-OUT ──" section near the end injects a stub `ccm` (CCM_BIN=<stub>) to
# test the ccm-driven path (present → use its verdict) and ccm-absent (→ fallback). The hook reads CCM_BIN
# from its env (mirrors board-lint.js); exporting it here propagates to every $HOOK subprocess.
export CCM_BIN="/nonexistent-ccm-bin-force-local-fallback"

# run_pacing USAGE_DIR NOW [BUDGET] [BURN_FLOOR] -> sets HOOK_OUT / HOOK_RC.
# ARMED: stdin carries a Stop event whose session_id (sess-x) OWNS an active board in CC_MASTER_HOME
# (seeded below). The hook is now armed-gated — it only reads usage when this session is armed, so the
# default driver seeds a matching active board into a fresh home and points CC_MASTER_HOME at it.
# We invoke the .js by path so its `#!/usr/bin/env node` shebang runs node.
ARMED_HOME=""
_seed_armed_home() { # SID -> echo a fresh home dir holding an active board owned by SID
  local h; h="$(make_project)"
  mkdir -p "$h/boards"   # board 落 <home>/boards/（board-v2 布局）
  printf '{"schema":"cc-master/v1","goal":"g","owner":{"active":true,"session_id":"%s"},"tasks":[{"id":"T1","status":"in_flight","deps":[]}]}' "$1" > "$h/boards/armed.board.json"
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
mkdir -p "$H/boards"; printf '{"schema":"cc-master/v1","goal":"g","owner":{"active":true,"session_id":"sess-other"},"tasks":[{"id":"T1","status":"in_flight","deps":[]}]}' > "$H/boards/other.board.json"
run_pacing_home "$SAMPLE" "2026-06-10T12:00:00Z" "$H" "sess-mine" "3000"
assert_eq 0 "$HOOK_RC" "(f2) other session's board → rc 0"
assert_eq "" "$HOOK_OUT" "(f2) other session's active board → silent (not armed for me)"
rm -rf "$H"

# (f3) UNARMED — home has only an ARCHIVED board (owner.active:false) for my session → not armed.
H="$(make_project)"
mkdir -p "$H/boards"; printf '{"schema":"cc-master/v1","goal":"g","owner":{"active":false,"session_id":"sess-arch"},"tasks":[{"id":"T1","status":"in_flight","deps":[]}]}' > "$H/boards/arch.board.json"
run_pacing_home "$SAMPLE" "2026-06-10T12:00:00Z" "$H" "sess-arch" "3000"
assert_eq 0 "$HOOK_RC" "(f3) archived board → rc 0"
assert_eq "" "$HOOK_OUT" "(f3) archived (inactive) board → silent (arming requires active)"
rm -rf "$H"

# (f4) ARMED — home has an active board owned by THIS session → gate opens → critical usage warns.
H="$(make_project)"
mkdir -p "$H/boards"; printf '{"schema":"cc-master/v1","goal":"g","owner":{"active":true,"session_id":"sess-armed"},"tasks":[{"id":"T1","status":"in_flight","deps":[]}]}' > "$H/boards/mine.board.json"
run_pacing_home "$SAMPLE" "2026-06-10T12:00:00Z" "$H" "sess-armed" "3000"
assert_eq 0 "$HOOK_RC" "(f4) armed session → rc 0"
assert_contains "$HOOK_OUT" "additionalContext" "(f4) armed + critical usage → warns (gate open)"
assert_contains "$HOOK_OUT" "3400" "(f4) armed → carries real used_tokens"
assert_not_contains "$HOOK_OUT" '"decision":"block"' "(f4) armed → still NEVER blocks"
rm -rf "$H"

# (f5) DEGRADED — stdin carries NO session_id, but home has an active board → degraded gate matches
#       any active board → armed → warns. (Compaction-boundary robustness, mirrors the bash hooks.)
H="$(make_project)"
mkdir -p "$H/boards"; printf '{"schema":"cc-master/v1","goal":"g","owner":{"active":true,"session_id":"sess-whatever"},"tasks":[{"id":"T1","status":"in_flight","deps":[]}]}' > "$H/boards/some.board.json"
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
mkdir -p "$H/boards"; printf '{"schema":"cc-master/v1","goal":"g","owner":{"active":true,"session_id":"sess-re"},"tasks":[{"id":"T1","status":"in_flight","deps":[]}]}' > "$H/boards/mine.board.json"
run_pacing_stdin "$SAMPLE" "2026-06-10T12:00:00Z" "$H" \
  '{"session_id":"sess-re","hook_event_name":"Stop","stop_hook_active":true}' "3000"
assert_eq 0 "$HOOK_RC" "(g1) re-entry → rc 0"
assert_eq "" "$HOOK_OUT" "(g1) stop_hook_active:true → silent (re-entry guard, no Stop loop)"
assert_not_contains "$HOOK_OUT" "additionalContext" "(g1) re-entry injects NO additionalContext"
rm -rf "$H"

# (g2) CONTROL — identical armed+critical case but stop_hook_active:false (a genuine new Stop) → warns.
#       Proves the guard keys on the re-entry flag, not on the armed/critical state itself.
H="$(make_project)"
mkdir -p "$H/boards"; printf '{"schema":"cc-master/v1","goal":"g","owner":{"active":true,"session_id":"sess-re"},"tasks":[{"id":"T1","status":"in_flight","deps":[]}]}' > "$H/boards/mine.board.json"
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
mkdir -p "$H/boards"; printf '{"schema":"cc-master/v1","goal":"g","owner":{"active":true,"session_id":""},"tasks":[{"id":"T1","status":"in_flight","deps":[]}]}' > "$H/boards/empty.board.json"
run_pacing_home "$SAMPLE" "2026-06-10T12:00:00Z" "$H" "sess-adopt" "3000"
assert_eq 0 "$HOOK_RC" "(h1) blank-session board + non-empty stdin sid → rc 0"
assert_eq "" "$HOOK_OUT" "(h1) blank-session active board (owner.session_id:\"\") + non-empty stdin sid → stays dormant, silent (CODEX14 revert, red line 6 fail-safe)"
rm -rf "$H"

# (h2) RED LINE 6 DEFENCE RETAINED — active board with owner.session_id:"OTHER" (non-empty) + a
#       DIFFERENT non-empty stdin sid "MINE", at critical usage → MUST stay silent. Proves the symmetric
#       degrade did NOT collapse into "any active board arms"; the true cross-session pollution defence
#       is unchanged.
H="$(make_project)"
mkdir -p "$H/boards"; printf '{"schema":"cc-master/v1","goal":"g","owner":{"active":true,"session_id":"OTHER"},"tasks":[{"id":"T1","status":"in_flight","deps":[]}]}' > "$H/boards/other.board.json"
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
mkdir -p "$ACCT_HOME/boards"; printf '{"schema":"cc-master/v1","goal":"g","owner":{"active":true,"session_id":"sess-acct"},"tasks":[{"id":"T1","status":"in_flight","deps":[]}]}' > "$ACCT_HOME/boards/mine.board.json"
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
# ADR-018：5h 临界减速 → advisory strong（临界侧·应认真权衡减速·P4 高风险→strong）。注入经 jsonEscape，标签 " → \"。
assert_contains "$HOOK_OUT" '<advisory source=\"usage-pacing\" strength=\"strong\">' "(acct-1) 5h wall → tag-wrapped advisory strong (ADR-018)"

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
mkdir -p "$U_HOME/boards"; printf '{"schema":"cc-master/v1","goal":"g","owner":{"active":true,"session_id":"sess-acct"},"tasks":[{"id":"T1","status":"in_flight","deps":[]}]}' > "$U_HOME/boards/mine.board.json"
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
# ADR-018：欠用加速 → advisory weak（低风险·可合理忽略·对齐 ADR-018 §2.2「欠用加速」例 = weak）。
assert_contains "$HOOK_OUT" '<advisory source=\"usage-pacing\" strength=\"weak\">' "(under-1) underuse → tag-wrapped advisory weak (ADR-018)"

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
mkdir -p "$U_LH/boards"; printf '{"schema":"cc-master/v1","goal":"g","owner":{"active":true,"session_id":"sess-local"},"tasks":[{"id":"T1","status":"in_flight","deps":[]}]}' > "$U_LH/boards/mine.board.json"
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

# ── NUM_ACCOUNT 缩放 (need ①): board top-level num_account → 把欠用催加速阈值抬高、撞墙侧按 n 分叉措辞 ────
# num_account = 真实可序列消费的 n 份配额(非名义心智数)。usage-pacing 读它(soft-observed,缺/坏 → 降级 1):
#   · 欠用侧 effective_ceil = min(95, ceil(60) × n) —— n 越大,同一剩余时间下「欠用」判定线越高、越积极催加速;
#   · 撞墙侧 7d 不随 n 变(总闸正交);5h 撞墙时 n>1 → 「切下一份配额」措辞、不减速,n=1 → 回落减速。
# 账户口径无绝对 token 分母 → 算不出 tok/min 精确速率,只缩放无量纲 used% 节奏(cost-and-pacing 诚实天花板)。
# 用 run_pacing_acct（armed Stop + sidecar）；num_account 经 env CC_MASTER_NUM_ACCOUNT 注入(board 缺则 env 兜底)。
N_HOME="$(make_project)"
mkdir -p "$N_HOME/boards"; printf '{"schema":"cc-master/v1","goal":"g","owner":{"active":true,"session_id":"sess-acct"},"num_account":3,"tasks":[{"id":"T1","status":"in_flight","deps":[]}]}' > "$N_HOME/boards/mine.board.json"
# run_pacing_nacct SIDECAR_JSON NOW HOME SID NUM_ACCOUNT -> drive armed Stop + sidecar + env num_account.
run_pacing_nacct() {
  local cdir; cdir="$(make_project)"; local cache="$cdir/rate.json"
  printf '%s' "$1" > "$cache"
  HOOK_OUT="$(printf '{"session_id":"%s","hook_event_name":"Stop"}' "$4" \
    | CC_MASTER_USAGE_DIR="$SAMPLE" CC_MASTER_NOW="$2" CC_MASTER_HOME="$3" CC_MASTER_RATE_CACHE="$cache" \
      CC_MASTER_NUM_ACCOUNT="$5" \
      "$HOOK" 2>/dev/null)"; HOOK_RC=$?
  rm -rf "$cdir"
}

# (nacct-1) 5h 70% would be NOT-underused at n=1 (70 ≥ ceil 60) → silent; but n=3 lifts effective_ceil to
#           min(95, 60×3)=95, so 70 < 95 → underused → accelerate prompt fires. Proves n scales the ceil.
run_pacing_nacct "{\"captured_at\":$U_FRESH,\"five_hour\":{\"used_percentage\":70,\"resets_at\":$U_NEAR},\"seven_day\":{\"used_percentage\":30}}" \
  "2026-06-10T12:00:00Z" "$N_HOME" "sess-acct" "3"
assert_eq 0 "$HOOK_RC" "(nacct-1) n=3 lifts underuse ceil → rc 0"
assert_contains "$HOOK_OUT" "additionalContext" "(nacct-1) 5h 70% < effective_ceil(95) at n=3 → accelerate fires"
assert_contains "$HOOK_OUT" "欠用" "(nacct-1) carries underuse signal (欠用)"
assert_contains "$HOOK_OUT" "3 份" "(nacct-1) accelerate note names the n (3 份可序列消费的配额)"

# (nacct-2) CONTROL — same sidecar but n=1 (default ceil 60): 70 ≥ 60 → NOT underused → silent. Proves
#           the n=3 case above fired BECAUSE of the scaling, not the raw 70%.
run_pacing_nacct "{\"captured_at\":$U_FRESH,\"five_hour\":{\"used_percentage\":70,\"resets_at\":$U_NEAR},\"seven_day\":{\"used_percentage\":30}}" \
  "2026-06-10T12:00:00Z" "$N_HOME" "sess-acct" "1"
assert_eq 0 "$HOOK_RC" "(nacct-2) n=1 control → rc 0"
assert_eq "" "$HOOK_OUT" "(nacct-2) 5h 70% ≥ ceil(60) at n=1 → silent (no scaling = original behavior)"

# (nacct-3) HIGH-BAND underuse — 5h 84% (just under the wall floor 85) at n=3 → effective_ceil=95, so
#           84 < 95 → underused → accelerate fires. Proves n lifts the underuse ceil right up toward the
#           wall (the n-scaled band reaches as high as min(95, ceil×n)). NB: the min(95,…) cap is purely
#           defensive — any 5h% ≥ 85 hits the WALL fork first (85 < 95), so the cap never gates a real
#           underuse decision; it only guards against ever calling a ≥95% window "underused".
run_pacing_nacct "{\"captured_at\":$U_FRESH,\"five_hour\":{\"used_percentage\":84,\"resets_at\":$U_NEAR},\"seven_day\":{\"used_percentage\":30}}" \
  "2026-06-10T12:00:00Z" "$N_HOME" "sess-acct" "3"
assert_eq 0 "$HOOK_RC" "(nacct-3) high-band underuse at n=3 → rc 0"
assert_contains "$HOOK_OUT" "欠用" "(nacct-3) 5h 84% < effective_ceil(95) at n=3 → accelerate fires (n lifts band to wall)"

# (nacct-4) REGISTRY-SOURCED n (no env override) — A2 T6: effective-N now comes from accounts.json
#           (NOT board num_account, which is砍'd). A registry with 1 active + 2 token-unexpired backups
#           → effective-N = switchable(2)+1 = 3. env unset → reads registry → 70% underused at n=3 →
#           accelerate. Proves the accounts.json pool (not env, not board) drives n.
run_pacing_acct() { # registry-sourced: NO CC_MASTER_NUM_ACCOUNT in env; accounts.json lives in $HOME/accounts.json
  local cdir; cdir="$(make_project)"; local cache="$cdir/rate.json"
  printf '%s' "$1" > "$cache"
  HOOK_OUT="$(printf '{"session_id":"%s","hook_event_name":"Stop"}' "$4" \
    | CC_MASTER_USAGE_DIR="$SAMPLE" CC_MASTER_NOW="$2" CC_MASTER_HOME="$3" CC_MASTER_RATE_CACHE="$cache" \
      "$HOOK" 2>/dev/null)"; HOOK_RC=$?
  rm -rf "$cdir"
}
# registry: 1 active + 2 unexpired backups (expires 2027) → effective-N = 3. CC_MASTER_HOME=$N_HOME so
#   ACCOUNTS_FILE resolves to $N_HOME/accounts.json (user-level fallback uses CC_MASTER_HOME).
printf '%s' '{"schema":"cc-master/accounts/v1","accounts":{"a@x.com":{"vault":{"kind":"keychain","service":"cc-master-oauth","account":"a@x.com"},"active":true},"b@x.com":{"vault":{"kind":"keychain","service":"cc-master-oauth","account":"b@x.com"},"active":false,"token_expires_at":"2027-06-17T10:40:00Z"},"c@x.com":{"vault":{"kind":"keychain","service":"cc-master-oauth","account":"c@x.com"},"active":false,"token_expires_at":"2027-06-17T10:40:00Z"}}}' > "$N_HOME/accounts.json"
run_pacing_acct "{\"captured_at\":$U_FRESH,\"five_hour\":{\"used_percentage\":70,\"resets_at\":$U_NEAR},\"seven_day\":{\"used_percentage\":30}}" \
  "2026-06-10T12:00:00Z" "$N_HOME" "sess-acct"
assert_eq 0 "$HOOK_RC" "(nacct-4) registry-sourced effective-N=3 → rc 0"
assert_contains "$HOOK_OUT" "欠用" "(nacct-4) accounts.json pool (1 active + 2 backups) drives n=3 (no env) → accelerate fires"
# ADR-018：号池粗粒度事实独立成块 → ambient（池/配额事实·塑模型·无 action·无 strength）。
assert_contains "$HOOK_OUT" '<ambient source=\"usage-pacing\">' "(nacct-4) pool fact → separate ambient block (ADR-018, no strength)"
assert_contains "$HOOK_OUT" "号池" "(nacct-4) ambient carries the pool fact (号池)"
rm -f "$N_HOME/accounts.json"

# (nacct-5) WALL FORK at n>1 — 5h 90% wall, 7d 20% (only 5h hits) + n=3 → 「切下一份配额」signal, NOT slowdown.
#           Proves撞墙侧 n>1 reframes the 5h wall as a switch-account trigger rather than a slow-down.
run_pacing_nacct "{\"five_hour\":{\"used_percentage\":90,\"resets_at\":$U_NEAR},\"seven_day\":{\"used_percentage\":20}}" \
  "2026-06-10T12:00:00Z" "$N_HOME" "sess-acct" "3"
assert_eq 0 "$HOOK_RC" "(nacct-5) wall fork n>1 → rc 0"
assert_contains "$HOOK_OUT" "切到下一份配额" "(nacct-5) n>1 + 5h wall → 切下一份配额 signal (not slowdown)"
assert_not_contains "$HOOK_OUT" "降到更便宜的模型档" "(nacct-5) n>1 5h wall → NOT the slowdown levers"
assert_not_contains "$HOOK_OUT" '"decision":"block"' "(nacct-5) never blocks"
# ADR-018：n>1 切下一份配额 → advisory weak（机会信号·可逆·低 stakes）。
assert_contains "$HOOK_OUT" '<advisory source=\"usage-pacing\" strength=\"weak\">' "(nacct-5) switch-account → tag-wrapped advisory weak (ADR-018)"

# (nacct-6) 7d WALL not reframed by n — 7d 88% wall while 5h low (10%) + n=3 → 7d 总闸 still bites (n
#           orthogonal to the cross-window total gate). Since 88 ≥ dispatch gate(85), it surfaces the
#           need-② DISPATCH GATE wording (暂停 dispatch), NOT the 切下一份配额 / accelerate framing —
#           proving 7d is not softened by n (the switch-account framing is 5h-only; 7d still halts派发).
run_pacing_nacct "{\"five_hour\":{\"used_percentage\":10,\"resets_at\":$U_NEAR},\"seven_day\":{\"used_percentage\":88}}" \
  "2026-06-10T12:00:00Z" "$N_HOME" "sess-acct" "3"
assert_eq 0 "$HOOK_RC" "(nacct-6) 7d wall at n>1 → rc 0"
assert_contains "$HOOK_OUT" "暂停 dispatch 新节点" "(nacct-6) 7d ≥85% at n=3 → dispatch gate wording (7d gate not softened by n)"
assert_contains "$HOOK_OUT" "88" "(nacct-6) carries 7d used_percentage"
rm -rf "$N_HOME"

# ── 7d≥85% DISPATCH 闸 (need ②): 7d 撞墙时撞墙提示从泛泛减速「升级措辞」为点名「暂停 dispatch 新节点」 ──────
# 需求②: hook 物理上不能真 block dispatch(红线4),故 7d≥85% 时只把**措辞**升级——点名「暂停 dispatch 新节点、把
# 『是否续耗 7d 配额』作 blocked_on:"user" surface 用户」,比泛泛的「降档/降WIP/defer」重得多。真正的暂停由
# orchestrator 在决策程序 dispatch 节点执行(心智轨)。**只在账户口径生效**(本地反推算不出 7d used%,不触发此闸)。
G_HOME="$(make_project)"
mkdir -p "$G_HOME/boards"; printf '{"schema":"cc-master/v1","goal":"g","owner":{"active":true,"session_id":"sess-acct"},"tasks":[{"id":"T1","status":"in_flight","deps":[]}]}' > "$G_HOME/boards/mine.board.json"
# run_pacing_acct (re-defined fresh here: armed Stop + sidecar, no stop_hook_active, no num_account env).
run_pacing_acct() {
  local cdir; cdir="$(make_project)"; local cache="$cdir/rate.json"
  printf '%s' "$1" > "$cache"
  HOOK_OUT="$(printf '{"session_id":"%s","hook_event_name":"Stop"}' "$4" \
    | CC_MASTER_USAGE_DIR="$SAMPLE" CC_MASTER_NOW="$2" CC_MASTER_HOME="$3" CC_MASTER_RATE_CACHE="$cache" \
      "$HOOK" 2>/dev/null)"; HOOK_RC=$?
  rm -rf "$cdir"
}

# (gate-1) 7d 87% (≥ gate 85), 5h fine (40%) → DISPATCH GATE wording: 「暂停 dispatch 新节点」+ blocked_on:"user"
#          + surface 用户 + ADR-010, NON-blocking. This is the headline need-② case (mirrors the RED baseline).
run_pacing_acct "{\"five_hour\":{\"used_percentage\":40,\"resets_at\":$A_R5F},\"seven_day\":{\"used_percentage\":87}}" \
  "2026-06-10T12:00:00Z" "$G_HOME" "sess-acct"
assert_eq 0 "$HOOK_RC" "(gate-1) 7d≥85% dispatch gate → rc 0"
assert_contains "$HOOK_OUT" "暂停 dispatch 新节点" "(gate-1) 7d 87% → 点名暂停 dispatch 新节点 (harder than slowdown)"
assert_contains "$HOOK_OUT" "blocked_on:" "(gate-1) frames it as a blocked_on:user decision to surface"
assert_contains "$HOOK_OUT" "surface 给用户" "(gate-1) surfaces the decision to the user"
assert_contains "$HOOK_OUT" "硬总闸" "(gate-1) names the 7d hard total gate"
assert_contains "$HOOK_OUT" "87" "(gate-1) carries the authoritative 7d used_percentage"
assert_not_contains "$HOOK_OUT" '"decision":"block"' "(gate-1) NEVER blocks — hook can't真 block dispatch, only software prompt"
# ADR-018：7d 硬总闸 → advisory strong（stakes 最高·跨窗口不可逆·对齐 ADR-018 §2.2「7d 逼顶」例 = strong）。
# 仍是 advisory 非 directive：hook 永不能真 block dispatch（红线4），决策最终归 orchestrator（活体印证·ADR-018 §3.1）。
assert_contains "$HOOK_OUT" '<advisory source=\"usage-pacing\" strength=\"strong\">' "(gate-1) 7d hard gate → tag-wrapped advisory strong, NOT directive (ADR-018)"

# (gate-2) 7d 84% (just UNDER gate) + 5h fine → NO wall at all (84 < floor 85) → silent. Proves the gate
#          keys on ≥85, not below; sub-gate 7d does not surface the dispatch wording.
run_pacing_acct "{\"five_hour\":{\"used_percentage\":40,\"resets_at\":$A_R5F},\"seven_day\":{\"used_percentage\":84}}" \
  "2026-06-10T12:00:00Z" "$G_HOME" "sess-acct"
assert_eq 0 "$HOOK_RC" "(gate-2) 7d 84% (<85) → rc 0"
assert_eq "" "$HOOK_OUT" "(gate-2) 7d 84% under gate → silent (no dispatch wording below the threshold)"

# (gate-3) 7d 90% AND 5h 92% (both wall) → 7d dispatch gate wins the framing (暂停 dispatch), and notes 5h too.
#          The 7d gate is the harder constraint — when both hit, the dispatch-halt framing dominates.
run_pacing_acct "{\"five_hour\":{\"used_percentage\":92,\"resets_at\":$A_R5F},\"seven_day\":{\"used_percentage\":90}}" \
  "2026-06-10T12:00:00Z" "$G_HOME" "sess-acct"
assert_eq 0 "$HOOK_RC" "(gate-3) both walls → rc 0"
assert_contains "$HOOK_OUT" "暂停 dispatch 新节点" "(gate-3) both walls → 7d dispatch gate dominates the framing"
assert_contains "$HOOK_OUT" "5h 也已 92%" "(gate-3) still notes the concurrent 5h wall"

# (gate-4) DISPATCH GATE at n>1 — 7d 87% + 5h 40% + num_account=3 → still 暂停 dispatch (7d gate orthogonal to
#          n) AND mentions 切账号刷新 7d as ONE user-selectable response (need-② num_account coupling, prose only).
run_pacing_nacct() {
  local cdir; cdir="$(make_project)"; local cache="$cdir/rate.json"
  printf '%s' "$1" > "$cache"
  HOOK_OUT="$(printf '{"session_id":"%s","hook_event_name":"Stop"}' "$4" \
    | CC_MASTER_USAGE_DIR="$SAMPLE" CC_MASTER_NOW="$2" CC_MASTER_HOME="$3" CC_MASTER_RATE_CACHE="$cache" \
      CC_MASTER_NUM_ACCOUNT="$5" \
      "$HOOK" 2>/dev/null)"; HOOK_RC=$?
  rm -rf "$cdir"
}
run_pacing_nacct "{\"five_hour\":{\"used_percentage\":40,\"resets_at\":$A_R5F},\"seven_day\":{\"used_percentage\":87}}" \
  "2026-06-10T12:00:00Z" "$G_HOME" "sess-acct" "3"
assert_eq 0 "$HOOK_RC" "(gate-4) 7d gate at n=3 → rc 0"
assert_contains "$HOOK_OUT" "暂停 dispatch 新节点" "(gate-4) 7d gate fires regardless of n (总闸 orthogonal)"
assert_contains "$HOOK_OUT" "切到下一份配额" "(gate-4) n>1 → mentions 切账号刷新 7d as ONE user-selectable response"
assert_contains "$HOOK_OUT" "用户" "(gate-4) still surfaces the decision to the user (parallel to switching)"

# (gate-5) LOCAL-REVERSAL path (no sidecar) → never emits the 7d dispatch gate. The local反推 path can't
#          compute 7d used% (no分母) so the gate is account-only (与加速侧反推禁用同精神). SAMPLE @12:00Z low burn.
G_LH="$(make_project)"
mkdir -p "$G_LH/boards"; printf '{"schema":"cc-master/v1","goal":"g","owner":{"active":true,"session_id":"sess-local"},"tasks":[{"id":"T1","status":"in_flight","deps":[]}]}' > "$G_LH/boards/mine.board.json"
run_pacing_home "$SAMPLE" "2026-06-10T12:00:00Z" "$G_LH" "sess-local"
assert_eq 0 "$HOOK_RC" "(gate-5) local fallback path → rc 0"
assert_not_contains "$HOOK_OUT" "暂停 dispatch 新节点" "(gate-5) local反推 path NEVER emits the 7d dispatch gate (account-only, no 7d%)"
rm -rf "$G_LH"

# (gate-6) FLOOR LIFTED PAST GATE (Finding 3): user sets CC_MASTER_PCT_FLOOR=90 (above the 7d dispatch
#          gate 85). 7d=87% sits in the band [gate 85, floor 90): the warning floor would NOT fire (87<90),
#          but the HARD 7d dispatch gate (≥85) MUST still fire — it is decoupled from the configurable
#          warning floor. Before the fix, sdHit=p7>=floor=false short-circuited the early return and the
#          gate never fired. Now sdGateHit=p7>=gate is judged independently → dispatch wording still fires.
run_pacing_acct_floor() { # SIDECAR_JSON NOW HOME SID FLOOR -> armed Stop + sidecar + CC_MASTER_PCT_FLOOR
  local cdir; cdir="$(make_project)"; local cache="$cdir/rate.json"
  printf '%s' "$1" > "$cache"
  HOOK_OUT="$(printf '{"session_id":"%s","hook_event_name":"Stop"}' "$4" \
    | CC_MASTER_USAGE_DIR="$SAMPLE" CC_MASTER_NOW="$2" CC_MASTER_HOME="$3" CC_MASTER_RATE_CACHE="$cache" \
      CC_MASTER_PCT_FLOOR="$5" \
      "$HOOK" 2>/dev/null)"; HOOK_RC=$?
  rm -rf "$cdir"
}
run_pacing_acct_floor "{\"five_hour\":{\"used_percentage\":40,\"resets_at\":$A_R5F},\"seven_day\":{\"used_percentage\":87}}" \
  "2026-06-10T12:00:00Z" "$G_HOME" "sess-acct" "90"
assert_eq 0 "$HOOK_RC" "(gate-6) floor lifted past gate, 7d 87% → rc 0"
assert_contains "$HOOK_OUT" "暂停 dispatch 新节点" "(gate-6) floor=90>gate=85, 7d 87% → hard dispatch gate STILL fires (decoupled from warning floor, Finding 3)"
assert_contains "$HOOK_OUT" "87" "(gate-6) carries the authoritative 7d used_percentage even with floor lifted"
assert_contains "$HOOK_OUT" "硬总闸" "(gate-6) names the 7d hard total gate"
assert_not_contains "$HOOK_OUT" '"decision":"block"' "(gate-6) never blocks"

# (gate-7) CONTROL — floor=90, 7d=84% (just UNDER the gate 85) → no wall (84<90 floor) AND no dispatch
#          gate (84<85) → silent. Proves the gate keys on ≥85 independently, not on the lifted floor.
run_pacing_acct_floor "{\"five_hour\":{\"used_percentage\":40,\"resets_at\":$A_R5F},\"seven_day\":{\"used_percentage\":84}}" \
  "2026-06-10T12:00:00Z" "$G_HOME" "sess-acct" "90"
assert_eq 0 "$HOOK_RC" "(gate-7) floor 90, 7d 84% (<gate 85) → rc 0"
assert_eq "" "$HOOK_OUT" "(gate-7) 7d 84% under the hard gate AND under lifted floor → silent (gate keys on ≥85, not on floor)"
rm -rf "$G_HOME"

# ── A2 T6: effective-N derived from accounts.json registry (replaces board num_account/accounts[].consumed) ──
# readNumAccount 现读号池 registry accounts.json（**不再**读 board num_account）算 effective-N =
#   switchable(非 active 且 token 未过期) + 1。撞墙侧 n 分叉据此走：剩余可切入 0 → effective-N=1 → 回落减速
#   (不喊切号)；仍有可切入 → n>1 → 切号信号。优雅降级：无文件 / 空池 / 坏 JSON → 1（天然单账号）。
# run_pacing_acct_home: armed Stop + sidecar，从 $HOME/accounts.json 读 registry（无 env num_account 覆写——
#   env 会绕过 registry；要测 registry 必须不设 CC_MASTER_NUM_ACCOUNT）。CC_MASTER_HOME=$HOME 使 ACCOUNTS_FILE
#   解析到 $HOME/accounts.json（用户级 fallback 用 CC_MASTER_HOME）。
run_pacing_acct_home() { # SIDECAR_JSON NOW HOME SID -> armed Stop + sidecar, accounts.json drives n (no env)
  local cdir; cdir="$(make_project)"; local cache="$cdir/rate.json"
  printf '%s' "$1" > "$cache"
  HOOK_OUT="$(printf '{"session_id":"%s","hook_event_name":"Stop"}' "$4" \
    | CC_MASTER_USAGE_DIR="$SAMPLE" CC_MASTER_NOW="$2" CC_MASTER_HOME="$3" CC_MASTER_RATE_CACHE="$cache" \
      "$HOOK" 2>/dev/null)"; HOOK_RC=$?
  rm -rf "$cdir"
}

# (regn-1) registry = 1 active + NO switchable backup → effective-N = switchable(0)+1 = 1. 5h 90% wall +
#   7d 20% low → at effective-N=1 this is a SLOWDOWN (回落减速), NOT a 切下一份配额 signal. Proves an empty
#   backup pool yields single-account pacing (the LAST/only quota does not falsely encourage切号).
C_HOME="$(make_project)"
mkdir -p "$C_HOME/boards"; printf '{"schema":"cc-master/v1","goal":"g","owner":{"active":true,"session_id":"sess-acct"},"tasks":[{"id":"T1","status":"in_flight","deps":[]}]}' > "$C_HOME/boards/mine.board.json"
printf '%s' '{"schema":"cc-master/accounts/v1","accounts":{"a@x.com":{"vault":{"kind":"keychain","service":"cc-master-oauth","account":"a@x.com"},"active":true}}}' > "$C_HOME/accounts.json"
run_pacing_acct_home "{\"five_hour\":{\"used_percentage\":90,\"resets_at\":$A_R5F},\"seven_day\":{\"used_percentage\":20}}" \
  "2026-06-10T12:00:00Z" "$C_HOME" "sess-acct"
assert_eq 0 "$HOOK_RC" "(regn-1) effective-N=1 (only active, 0 switchable) → rc 0"
assert_contains "$HOOK_OUT" "降到更便宜的模型档" "(regn-1) effective-N=1 → SLOWDOWN levers (not switch-account)"
assert_not_contains "$HOOK_OUT" "切到下一份配额" "(regn-1) no switchable backup → NO 切下一份配额"
rm -rf "$C_HOME"

# (regn-2) CONTROL — registry = 1 active + 1 token-unexpired backup → effective-N = switchable(1)+1 = 2 (>1).
#   Same 5h wall → 切下一份配额 signal fires (a fresh quota exists to switch to). Proves the n>1 fork keys on
#   the registry-derived effective-N. Also the pool fact (号池) rides along (switchable≥1).
C_HOME="$(make_project)"
mkdir -p "$C_HOME/boards"; printf '{"schema":"cc-master/v1","goal":"g","owner":{"active":true,"session_id":"sess-acct"},"tasks":[{"id":"T1","status":"in_flight","deps":[]}]}' > "$C_HOME/boards/mine.board.json"
printf '%s' '{"schema":"cc-master/accounts/v1","accounts":{"a@x.com":{"vault":{"kind":"keychain","service":"cc-master-oauth","account":"a@x.com"},"active":true},"b@x.com":{"vault":{"kind":"keychain","service":"cc-master-oauth","account":"b@x.com"},"active":false,"token_expires_at":"2027-06-17T10:40:00Z"}}}' > "$C_HOME/accounts.json"
run_pacing_acct_home "{\"five_hour\":{\"used_percentage\":90,\"resets_at\":$A_R5F},\"seven_day\":{\"used_percentage\":20}}" \
  "2026-06-10T12:00:00Z" "$C_HOME" "sess-acct"
assert_eq 0 "$HOOK_RC" "(regn-2) effective-N=2 (1 active + 1 switchable) → rc 0"
assert_contains "$HOOK_OUT" "切到下一份配额" "(regn-2) effective-N=2 (>1) → 切下一份配额 signal fires"
assert_contains "$HOOK_OUT" "2 份" "(regn-2) message names the effective-N (2 份)"
assert_contains "$HOOK_OUT" "号池" "(regn-2) pool fact rides along (switchable≥1 → 号池 line appended)"
assert_contains "$HOOK_OUT" "1 个 token 未过期" "(regn-2) pool fact names 1 switchable backup"
rm -rf "$C_HOME"

# (regn-3) EXPIRED-TOKEN backups don't count — registry = 1 active + 2 backups whose token已过期 (expires
#   2025, < now 2026) → switchable=0 → effective-N=1 → SLOWDOWN, no切号. Proves token_expires_at gates
#   switchable (an expired backup can't be switched into — auth would fail). Pool fact NOT appended (switchable=0).
C_HOME="$(make_project)"
mkdir -p "$C_HOME/boards"; printf '{"schema":"cc-master/v1","goal":"g","owner":{"active":true,"session_id":"sess-acct"},"tasks":[{"id":"T1","status":"in_flight","deps":[]}]}' > "$C_HOME/boards/mine.board.json"
printf '%s' '{"schema":"cc-master/accounts/v1","accounts":{"a@x.com":{"vault":{"kind":"keychain","service":"cc-master-oauth","account":"a@x.com"},"active":true},"b@x.com":{"vault":{"kind":"keychain","service":"cc-master-oauth","account":"b@x.com"},"active":false,"token_expires_at":"2025-06-17T10:40:00Z"},"c@x.com":{"vault":{"kind":"keychain","service":"cc-master-oauth","account":"c@x.com"},"active":false,"token_expires_at":"2025-06-17T10:40:00Z"}}}' > "$C_HOME/accounts.json"
run_pacing_acct_home "{\"five_hour\":{\"used_percentage\":90,\"resets_at\":$A_R5F},\"seven_day\":{\"used_percentage\":20}}" \
  "2026-06-10T12:00:00Z" "$C_HOME" "sess-acct"
assert_eq 0 "$HOOK_RC" "(regn-3) expired backups → switchable=0 → effective-N=1 → rc 0"
assert_contains "$HOOK_OUT" "降到更便宜的模型档" "(regn-3) all backups token-expired → SLOWDOWN (no switch)"
assert_not_contains "$HOOK_OUT" "切到下一份配额" "(regn-3) expired backups don't count → NO 切下一份配额"
assert_not_contains "$HOOK_OUT" "号池" "(regn-3) switchable=0 → pool fact NOT appended"
rm -rf "$C_HOME"

# (regn-4) NO registry at all → natural single account → effective-N=1 → SLOWDOWN (the --num_account砍 path:
#   no accounts.json = single account, behavior identical to old --num_account default 1). Pool fact NOT appended.
C_HOME="$(make_project)"
mkdir -p "$C_HOME/boards"; printf '{"schema":"cc-master/v1","goal":"g","owner":{"active":true,"session_id":"sess-acct"},"tasks":[{"id":"T1","status":"in_flight","deps":[]}]}' > "$C_HOME/boards/mine.board.json"
run_pacing_acct_home "{\"five_hour\":{\"used_percentage\":90,\"resets_at\":$A_R5F},\"seven_day\":{\"used_percentage\":20}}" \
  "2026-06-10T12:00:00Z" "$C_HOME" "sess-acct"
assert_eq 0 "$HOOK_RC" "(regn-4) no accounts.json → effective-N=1 (natural single account) → rc 0"
assert_contains "$HOOK_OUT" "降到更便宜的模型档" "(regn-4) no registry → single-account SLOWDOWN (== old --num_account default 1)"
assert_not_contains "$HOOK_OUT" "切到下一份配额" "(regn-4) no registry → NO 切下一份配额"
assert_not_contains "$HOOK_OUT" "号池" "(regn-4) no registry → pool fact NOT appended"
rm -rf "$C_HOME"

# (regn-5) BAD JSON registry → graceful degrade to effective-N=1 (never crash; failure must be silent per the
#   hook's总纪律). 5h wall → SLOWDOWN. Proves corrupt accounts.json degrades, not crashes.
C_HOME="$(make_project)"
mkdir -p "$C_HOME/boards"; printf '{"schema":"cc-master/v1","goal":"g","owner":{"active":true,"session_id":"sess-acct"},"tasks":[{"id":"T1","status":"in_flight","deps":[]}]}' > "$C_HOME/boards/mine.board.json"
printf '%s' '{ this is not valid json ::: ' > "$C_HOME/accounts.json"
run_pacing_acct_home "{\"five_hour\":{\"used_percentage\":90,\"resets_at\":$A_R5F},\"seven_day\":{\"used_percentage\":20}}" \
  "2026-06-10T12:00:00Z" "$C_HOME" "sess-acct"
assert_eq 0 "$HOOK_RC" "(regn-5) bad-JSON registry → degrades, rc still 0 (never crash)"
assert_contains "$HOOK_OUT" "降到更便宜的模型档" "(regn-5) bad JSON → effective-N=1 → SLOWDOWN (graceful degrade)"
assert_not_contains "$HOOK_OUT" "切到下一份配额" "(regn-5) bad JSON → degrade to 1 → NO 切下一份配额"
rm -rf "$C_HOME"

# (regn-6) UNARMED → registry read + pool injection MUST NOT happen (red line 6). NO board in home (unarmed),
#   but a fat registry (3 switchable) + a 5h wall sidecar present. Hook must be SILENT (no num_account read,
#   no pool fact, no pacing) because the armed gate short-circuits BEFORE any accounts.json read.
C_HOME="$(make_project)"
# deliberately NO *.board.json → unarmed
printf '%s' '{"schema":"cc-master/accounts/v1","accounts":{"a@x.com":{"vault":{"kind":"keychain","service":"cc-master-oauth","account":"a@x.com"},"active":true},"b@x.com":{"vault":{"kind":"keychain","service":"cc-master-oauth","account":"b@x.com"},"active":false,"token_expires_at":"2027-06-17T10:40:00Z"},"c@x.com":{"vault":{"kind":"keychain","service":"cc-master-oauth","account":"c@x.com"},"active":false,"token_expires_at":"2027-06-17T10:40:00Z"},"d@x.com":{"vault":{"kind":"keychain","service":"cc-master-oauth","account":"d@x.com"},"active":false,"token_expires_at":"2027-06-17T10:40:00Z"}}}' > "$C_HOME/accounts.json"
run_pacing_acct_home "{\"five_hour\":{\"used_percentage\":90,\"resets_at\":$A_R5F},\"seven_day\":{\"used_percentage\":20}}" \
  "2026-06-10T12:00:00Z" "$C_HOME" "sess-acct"
assert_eq 0 "$HOOK_RC" "(regn-6) unarmed (no board) → rc 0"
assert_eq "" "$HOOK_OUT" "(regn-6) unarmed → SILENT: no registry read, no pool fact, no pacing (red line 6 gate before accounts.json)"
rm -rf "$C_HOME"

# (regn-7) SWITCHABLE:FALSE backup doesn't count (P2-B) — registry = 1 active + 1 backup whose token is NOT
#   expired (2027) but marked switchable:false (残缺号·只有 access token·无 refresh token) → switchable=0 →
#   effective-N=1 → SLOWDOWN, no 切号. Proves poolStatus excludes switchable:false the same way select-account.js
#   does (existing-but-not-switchable → counts into backups, NOT switchable). Without the fix effective-N would
#   falsely be 2 and the hook would dangle a容量 lever (切到下一份配额) the选号 algorithm actually excludes.
#   Pool fact NOT appended (switchable=0).
C_HOME="$(make_project)"
mkdir -p "$C_HOME/boards"; printf '{"schema":"cc-master/v1","goal":"g","owner":{"active":true,"session_id":"sess-acct"},"tasks":[{"id":"T1","status":"in_flight","deps":[]}]}' > "$C_HOME/boards/mine.board.json"
printf '%s' '{"schema":"cc-master/accounts/v1","accounts":{"a@x.com":{"vault":{"kind":"keychain","service":"cc-master-oauth","account":"a@x.com"},"active":true},"b@x.com":{"vault":{"kind":"keychain","service":"cc-master-oauth","account":"b@x.com"},"active":false,"token_expires_at":"2027-06-17T10:40:00Z","switchable":false}}}' > "$C_HOME/accounts.json"
run_pacing_acct_home "{\"five_hour\":{\"used_percentage\":90,\"resets_at\":$A_R5F},\"seven_day\":{\"used_percentage\":20}}" \
  "2026-06-10T12:00:00Z" "$C_HOME" "sess-acct"
assert_eq 0 "$HOOK_RC" "(regn-7) switchable:false backup → switchable=0 → effective-N=1 → rc 0"
assert_contains "$HOOK_OUT" "降到更便宜的模型档" "(regn-7) switchable:false backup → effective-N=1 → SLOWDOWN (not switch-account)"
assert_not_contains "$HOOK_OUT" "切到下一份配额" "(regn-7) switchable:false backup don't count → NO 切下一份配额"
assert_not_contains "$HOOK_OUT" "号池" "(regn-7) switchable=0 → pool fact NOT appended"
rm -rf "$C_HOME"

# (regn-8) MIXED pool — 1 active + 1 switchable:false (excluded) + 1 normal token-unexpired backup → switchable=1 →
#   effective-N=2 (not 3). Proves the switchable:false号 is subtracted out of effective-N while the genuinely
#   switchable号 still counts. 5h wall → 切号 signal fires naming「2 份」(not 3), pool fact names 1 switchable.
C_HOME="$(make_project)"
mkdir -p "$C_HOME/boards"; printf '{"schema":"cc-master/v1","goal":"g","owner":{"active":true,"session_id":"sess-acct"},"tasks":[{"id":"T1","status":"in_flight","deps":[]}]}' > "$C_HOME/boards/mine.board.json"
printf '%s' '{"schema":"cc-master/accounts/v1","accounts":{"a@x.com":{"vault":{"kind":"keychain","service":"cc-master-oauth","account":"a@x.com"},"active":true},"b@x.com":{"vault":{"kind":"keychain","service":"cc-master-oauth","account":"b@x.com"},"active":false,"token_expires_at":"2027-06-17T10:40:00Z","switchable":false},"c@x.com":{"vault":{"kind":"keychain","service":"cc-master-oauth","account":"c@x.com"},"active":false,"token_expires_at":"2027-06-17T10:40:00Z"}}}' > "$C_HOME/accounts.json"
run_pacing_acct_home "{\"five_hour\":{\"used_percentage\":90,\"resets_at\":$A_R5F},\"seven_day\":{\"used_percentage\":20}}" \
  "2026-06-10T12:00:00Z" "$C_HOME" "sess-acct"
assert_eq 0 "$HOOK_RC" "(regn-8) 1 active + 1 switchable:false + 1 normal → effective-N=2 (not 3) → rc 0"
assert_contains "$HOOK_OUT" "切到下一份配额" "(regn-8) effective-N=2 (>1) → 切下一份配额 signal fires"
assert_contains "$HOOK_OUT" "2 份" "(regn-8) message names effective-N=2 (switchable:false号 subtracted, NOT 3)"
assert_not_contains "$HOOK_OUT" "3 份" "(regn-8) switchable:false号 NOT counted → never names 3 份"
assert_contains "$HOOK_OUT" "号池" "(regn-8) switchable≥1 → pool fact appended"
assert_contains "$HOOK_OUT" "1 个 token 未过期" "(regn-8) pool fact names 1 switchable backup (the switchable:false号 excluded)"
rm -rf "$C_HOME"

# ── Finding 2: 7d signal MISSING (p7===null) → 切下一份配额 branch must NOT fire (don't assume 7d headroom) ──
# When sidecar has 5h% but lacks seven_day.used_percentage, the n>1 「切到下一份配额」branch must NOT fire:
# 7d is UNKNOWN (not confirmed有余量). Switching refreshes 5h but 7d accumulates across accounts — blindly
# encouraging a switch could透支 an already-near-cap (but unmeasured) 7d. Fix: branch requires sdKnown
# (p7!==null). 7d missing → fall through to conservative SLOWDOWN wording, never claim 7d headroom.
S_HOME="$(make_project)"
mkdir -p "$S_HOME/boards"; printf '{"schema":"cc-master/v1","goal":"g","owner":{"active":true,"session_id":"sess-acct"},"tasks":[{"id":"T1","status":"in_flight","deps":[]}]}' > "$S_HOME/boards/mine.board.json"
# run_pacing_nacct_g: armed Stop + sidecar + env num_account (board has no num_account here, env drives n).
run_pacing_nacct_g() {
  local cdir; cdir="$(make_project)"; local cache="$cdir/rate.json"
  printf '%s' "$1" > "$cache"
  HOOK_OUT="$(printf '{"session_id":"%s","hook_event_name":"Stop"}' "$4" \
    | CC_MASTER_USAGE_DIR="$SAMPLE" CC_MASTER_NOW="$2" CC_MASTER_HOME="$3" CC_MASTER_RATE_CACHE="$cache" \
      CC_MASTER_NUM_ACCOUNT="$5" \
      "$HOOK" 2>/dev/null)"; HOOK_RC=$?
  rm -rf "$cdir"
}

# (sd-missing-1) n=3, 5h 90% wall, NO seven_day key → 切下一份配额 must NOT fire; falls to SLOWDOWN. The fix:
#   without sdKnown guard, !sdHit (=true when p7===null) would wrongly fire the switch branch claiming 7d余量.
run_pacing_nacct_g "{\"five_hour\":{\"used_percentage\":90,\"resets_at\":$A_R5F}}" \
  "2026-06-10T12:00:00Z" "$S_HOME" "sess-acct" "3"
assert_eq 0 "$HOOK_RC" "(sd-missing-1) 7d missing + n=3 + 5h wall → rc 0"
assert_not_contains "$HOOK_OUT" "切到下一份配额" "(sd-missing-1) 7d missing → NO 切下一份配额 (don't assume 7d headroom)"
assert_not_contains "$HOOK_OUT" "7d 总闸仍有余量" "(sd-missing-1) 7d missing → NEVER claim 7d headroom"
assert_contains "$HOOK_OUT" "降到更便宜的模型档" "(sd-missing-1) 7d missing → conservative SLOWDOWN wording instead"
assert_not_contains "$HOOK_OUT" '"decision":"block"' "(sd-missing-1) never blocks"

# (sd-present-1) CONTROL — same n=3 + 5h 90% wall but 7d PRESENT and low (20%) → 切下一份配额 DOES fire (7d
#   confirmed有余量). Proves the guard keys on 7d-missing specifically, not on n or the 5h wall.
run_pacing_nacct_g "{\"five_hour\":{\"used_percentage\":90,\"resets_at\":$A_R5F},\"seven_day\":{\"used_percentage\":20}}" \
  "2026-06-10T12:00:00Z" "$S_HOME" "sess-acct" "3"
assert_eq 0 "$HOOK_RC" "(sd-present-1) 7d present & low + n=3 + 5h wall → rc 0"
assert_contains "$HOOK_OUT" "切到下一份配额" "(sd-present-1) 7d present & low → 切下一份配额 DOES fire (7d confirmed余量)"
assert_contains "$HOOK_OUT" "7d 仅 20%" "(sd-present-1) names the confirmed 7d headroom value"
rm -rf "$S_HOME"

# ── CCM SHELL-OUT (P4 收口): hook prefers `ccm usage advise --json`; present → use its verdict; absent → fallback ──
# The corridor verdict math is收口'd into the ccm engine (pacing.ts SSOT); the hook shells out to it
# (adviseViaCcm → spawnSync `ccm usage advise --json`) and maps the verdict to a本 skill-vocabulary prompt.
# These cases inject a STUB `ccm` via CCM_BIN (hermetic — no real ccm binary needed): the stub echoes a fixed
# {"ok":true,"data":{…}} for each verdict. ccm-absent (CCM_BIN→nonexistent) must gracefully fall back to local.
# All cases run ARMED (the gate still runs BEFORE any shell-out) and assert NON-blocking.
CCM_HOME="$(make_project)"
mkdir -p "$CCM_HOME/boards"; printf '{"schema":"cc-master/v1","goal":"g","owner":{"active":true,"session_id":"sess-ccm"},"tasks":[{"id":"T1","status":"in_flight","deps":[]}]}' > "$CCM_HOME/boards/mine.board.json"

# mk_ccm_stub DATA_JSON -> path to an executable stub `ccm` that prints {"ok":true,"data":DATA_JSON} on
#   `usage advise`. The DATA_JSON is written to a sibling payload file the stub `cat`s — no sed/interpolation
#   fragility (DATA_JSON可含任意 JSON 字符). Mirrors the real `ccm usage advise --json` shape (ok+data).
#   Any other subcommand → empty (defensive). The stub dir is the caller's to clean up.
mk_ccm_stub() {
  local dir; dir="$(make_project)"; local stub="$dir/ccm"; local payload="$dir/payload.json"
  printf '%s' "$1" > "$payload"
  cat > "$stub" <<STUB
#!/usr/bin/env bash
# stub ccm: only answers \`usage advise\` with the canned data payload next to this script.
if [ "\$1" = "usage" ] && [ "\$2" = "advise" ]; then
  printf '{"ok":true,"data":%s}\n' "\$(cat "$payload")"
fi
STUB
  chmod +x "$stub"
  echo "$stub"
}

# run_pacing_ccm STUB_DATA_JSON HOME SID -> armed Stop driven through a stub ccm (CCM_BIN=stub).
run_pacing_ccm() {
  local stub; stub="$(mk_ccm_stub "$1")"
  HOOK_OUT="$(printf '{"session_id":"%s","hook_event_name":"Stop"}' "$3" \
    | CC_MASTER_USAGE_DIR="$SAMPLE" CC_MASTER_NOW="2026-06-10T12:00:00Z" CC_MASTER_HOME="$2" \
      CC_MASTER_RATE_CACHE="/nonexistent-ccm-section-rate-cache" CCM_BIN="$stub" \
      "$HOOK" 2>/dev/null)"; HOOK_RC=$?
  rm -rf "$(dirname "$stub")"
}

# (ccm-1) THROTTLE verdict from ccm → SLOWDOWN prompt (降到更便宜的模型档), non-blocking. Proves the hook
#         takes ccm's verdict (not local — local rate-cache is nonexistent here so local would be silent).
run_pacing_ccm '{"verdict":"throttle","reason":"r","levers":["downgrade_model"],"hard_stop_7d":false,"window_5h_pct":92,"window_7d_pct":50,"effective_n":1,"switch_candidate":null,"confidence":"high","source":"account","available":true}' \
  "$CCM_HOME" "sess-ccm"
assert_eq 0 "$HOOK_RC" "(ccm-1) ccm throttle → rc 0"
assert_contains "$HOOK_OUT" "additionalContext" "(ccm-1) ccm throttle → injects prompt"
assert_contains "$HOOK_OUT" "降到更便宜的模型档" "(ccm-1) ccm throttle → SLOWDOWN levers (本 skill vocabulary)"
assert_contains "$HOOK_OUT" "92" "(ccm-1) carries ccm window_5h_pct"
assert_not_contains "$HOOK_OUT" '"decision":"block"' "(ccm-1) NEVER blocks"

# (ccm-2) HARD_STOP verdict (7d hard total gate) → 暂停 dispatch 新节点 + blocked_on:user + 硬总闸. The hardest framing.
run_pacing_ccm '{"verdict":"hard_stop","reason":"r","levers":["pause_dispatch","surface_user"],"hard_stop_7d":true,"window_5h_pct":40,"window_7d_pct":87,"effective_n":1,"switch_candidate":null,"confidence":"high","source":"account","available":true}' \
  "$CCM_HOME" "sess-ccm"
assert_eq 0 "$HOOK_RC" "(ccm-2) ccm hard_stop → rc 0"
assert_contains "$HOOK_OUT" "暂停 dispatch 新节点" "(ccm-2) ccm hard_stop → dispatch gate wording"
assert_contains "$HOOK_OUT" "blocked_on:" "(ccm-2) frames blocked_on:user"
assert_contains "$HOOK_OUT" "硬总闸" "(ccm-2) names the 7d hard total gate"
assert_contains "$HOOK_OUT" "87" "(ccm-2) carries ccm window_7d_pct"
assert_not_contains "$HOOK_OUT" '"decision":"block"' "(ccm-2) NEVER blocks (hook can't真 block dispatch)"

# (ccm-3) ACCELERATE+switch_account lever (n>1 + 5h critical + 7d headroom) → 切到下一份配额 signal.
run_pacing_ccm '{"verdict":"accelerate","reason":"r","levers":["switch_account","continue_dispatch"],"hard_stop_7d":false,"window_5h_pct":92,"window_7d_pct":20,"effective_n":3,"switch_candidate":"b@x.com","confidence":"high","source":"account","available":true}' \
  "$CCM_HOME" "sess-ccm"
assert_eq 0 "$HOOK_RC" "(ccm-3) ccm accelerate-switch → rc 0"
assert_contains "$HOOK_OUT" "切到下一份配额" "(ccm-3) switch_account lever → 切下一份配额 signal"
assert_contains "$HOOK_OUT" "3 份" "(ccm-3) names the effective_n (3 份)"

# (ccm-4) ACCELERATE underuse (no switch lever) → 欠用 + 加速 prompt.
run_pacing_ccm '{"verdict":"accelerate","reason":"r","levers":["upgrade_model_critical_path","increase_parallelism"],"hard_stop_7d":false,"window_5h_pct":20,"window_7d_pct":30,"effective_n":1,"switch_candidate":null,"confidence":"medium","source":"account","available":true}' \
  "$CCM_HOME" "sess-ccm"
assert_eq 0 "$HOOK_RC" "(ccm-4) ccm accelerate-underuse → rc 0"
assert_contains "$HOOK_OUT" "欠用" "(ccm-4) underuse accelerate → carries 欠用 signal"
assert_contains "$HOOK_OUT" "加速" "(ccm-4) points at accelerate levers (加速)"

# (ccm-5) HOLD verdict → silent (corridor内·no prompt). Proves ccm hold suppresses output (no spam).
run_pacing_ccm '{"verdict":"hold","reason":"r","levers":[],"hard_stop_7d":false,"window_5h_pct":78,"window_7d_pct":40,"effective_n":1,"switch_candidate":null,"confidence":"high","source":"account","available":true}' \
  "$CCM_HOME" "sess-ccm"
assert_eq 0 "$HOOK_RC" "(ccm-5) ccm hold → rc 0"
assert_eq "" "$HOOK_OUT" "(ccm-5) ccm hold (corridor内) → silent (no prompt)"

# (ccm-6) ccm available:false → degrade to LOCAL fallback. Stub returns available:false; local rate-cache
#         is nonexistent + SAMPLE @12:00Z has 180min headroom → local path also silent. Proves available:false
#         → adviseViaCcm returns null → local path runs (here silent), NOT ccm's (would've been hold anyway).
run_pacing_ccm '{"verdict":"hold","reason":"r","levers":[],"hard_stop_7d":false,"window_5h_pct":null,"window_7d_pct":null,"effective_n":1,"switch_candidate":null,"confidence":"low","source":"local-derived-approx","available":false}' \
  "$CCM_HOME" "sess-ccm"
assert_eq 0 "$HOOK_RC" "(ccm-6) ccm available:false → rc 0"
assert_eq "" "$HOOK_OUT" "(ccm-6) ccm available:false → degrade to local (here silent), not ccm verdict"

# (ccm-7) ccm ABSENT (CCM_BIN→nonexistent) but a CRITICAL local account sidecar present → falls back to LOCAL
#         account-authoritative path → still warns (proves graceful degrade preserves the local capability).
CCM_CACHE_DIR="$(make_project)"; CCM_CACHE="$CCM_CACHE_DIR/rate.json"
A_R5F_CCM=$((A_NOWEP+3600))
printf '{"five_hour":{"used_percentage":90,"resets_at":%d},"seven_day":{"used_percentage":20}}' "$A_R5F_CCM" > "$CCM_CACHE"
HOOK_OUT="$(printf '{"session_id":"sess-ccm","hook_event_name":"Stop"}' \
  | CC_MASTER_USAGE_DIR="$SAMPLE" CC_MASTER_NOW="2026-06-10T12:00:00Z" CC_MASTER_HOME="$CCM_HOME" \
    CC_MASTER_RATE_CACHE="$CCM_CACHE" CCM_BIN="/nonexistent-ccm-absent" \
    "$HOOK" 2>/dev/null)"; HOOK_RC=$?
assert_eq 0 "$HOOK_RC" "(ccm-7) ccm absent + critical local sidecar → rc 0"
assert_contains "$HOOK_OUT" "additionalContext" "(ccm-7) ccm absent → LOCAL fallback path still warns (graceful degrade)"
assert_contains "$HOOK_OUT" "降到更便宜的模型档" "(ccm-7) local fallback emits its account-authoritative SLOWDOWN"
rm -rf "$CCM_CACHE_DIR"

# (ccm-8) ccm GARBAGE JSON → degrade to local. Stub emits non-JSON; adviseViaCcm returns null → local path
#         (nonexistent rate-cache + SAMPLE 180min headroom → silent). Proves bad JSON never crashes / never
#         injects garbage, just degrades.
GARBAGE_STUB_DIR="$(make_project)"; GARBAGE_STUB="$GARBAGE_STUB_DIR/ccm"
printf '#!/usr/bin/env bash\nprintf "not json at all {{{\\n"\n' > "$GARBAGE_STUB"; chmod +x "$GARBAGE_STUB"
HOOK_OUT="$(printf '{"session_id":"sess-ccm","hook_event_name":"Stop"}' \
  | CC_MASTER_USAGE_DIR="$SAMPLE" CC_MASTER_NOW="2026-06-10T12:00:00Z" CC_MASTER_HOME="$CCM_HOME" \
    CC_MASTER_RATE_CACHE="/nonexistent-ccm-section-rate-cache" CCM_BIN="$GARBAGE_STUB" \
    "$HOOK" 2>/dev/null)"; HOOK_RC=$?
assert_eq 0 "$HOOK_RC" "(ccm-8) ccm garbage JSON → rc 0 (no crash)"
assert_eq "" "$HOOK_OUT" "(ccm-8) ccm garbage JSON → degrade to local (silent here), never inject garbage"
rm -rf "$GARBAGE_STUB_DIR"

# (ccm-9) ARMED GATE still runs BEFORE shell-out — UNARMED + a hard_stop stub ccm → silent (no shell-out
#         leakage on unarmed sessions·red line 6). Proves the gate short-circuits before adviseViaCcm.
CCM_UNARMED="$(make_project)"  # no *.board.json → unarmed
run_pacing_ccm '{"verdict":"hard_stop","reason":"r","levers":["pause_dispatch"],"hard_stop_7d":true,"window_5h_pct":99,"window_7d_pct":99,"effective_n":1,"switch_candidate":null,"confidence":"high","source":"account","available":true}' \
  "$CCM_UNARMED" "sess-ccm-unarmed"
assert_eq 0 "$HOOK_RC" "(ccm-9) unarmed + hard_stop stub ccm → rc 0"
assert_eq "" "$HOOK_OUT" "(ccm-9) unarmed → silent even with a critical ccm verdict (armed gate before shell-out, red line 6)"
rm -rf "$CCM_UNARMED"
rm -rf "$CCM_HOME"

# ────────────────────────────────────────────────────────────────────────────────────────────────
# F3 (codex second-perspective): ACCOUNTS_FILE must resolve via the CANONICAL home (HOME_DIR =
# hook-common.resolveHome()), NOT a bare `process.env.HOME || ''`. When HOME AND CC_MASTER_HOME are both
# unset, the old code resolved accounts.json to a CWD-RELATIVE path ('' + '/.claude/cc-master/...')
# while arming used resolveHome()→os.homedir() (an absolute global home): a SILENT split → the registry
# is read from the wrong place → effective-N forced to 1 → the pool suggestion is lost. The fix routes
# ACCOUNTS_FILE through HOME_DIR so it is always the same root arming uses.
# ────────────────────────────────────────────────────────────────────────────────────────────────

# (F3a) source guard (the hermetic discriminator — a HOME-unset behavioral trigger inherently points at
#   the real os.homedir() and cannot be made hermetic): the hook derives ACCOUNTS_FILE from HOME_DIR and
#   no longer from a bare `process.env.HOME`. Extract just the `const ACCOUNTS_FILE = … ;` block.
F3_ACCT_BLOCK="$(awk '/const ACCOUNTS_FILE/{f=1} f{print} f&&/;/{exit}' "$HOOK")"
assert_contains "$F3_ACCT_BLOCK" "HOME_DIR" "(F3a) ACCOUNTS_FILE resolves via canonical HOME_DIR (resolveHome), same root as arming"
assert_not_contains "$F3_ACCT_BLOCK" "process.env.HOME" "(F3a) ACCOUNTS_FILE no longer built from a bare process.env.HOME (the cwd-relative footgun when HOME unset)"

# (F3b) behavioral: with CC_MASTER_HOME UNSET and home derived from HOME, accounts.json is read end-to-end
#   from <HOME>/.claude/cc-master/accounts.json — the SAME root arming used (proves HOME_DIR is actually
#   consulted, not just shaped right). 1 active + 1 token-unexpired backup → effective-N=2 → 切下一份配额 +
#   号池 fact. (The registry tests above all PIN CC_MASTER_HOME; this is the only one exercising the
#   CC_MASTER_HOME-unset → HOME-derived path the F3 fix unifies.)
F3H="$(make_project)"   # acts as a fake $HOME
mkdir -p "$F3H/.claude/cc-master/boards"
printf '{"schema":"cc-master/v1","goal":"g","owner":{"active":true,"session_id":"sess-acct"},"tasks":[{"id":"T1","status":"in_flight","deps":[]}]}' > "$F3H/.claude/cc-master/boards/mine.board.json"
printf '%s' '{"schema":"cc-master/accounts/v1","accounts":{"a@x.com":{"vault":{"kind":"keychain","service":"cc-master-oauth","account":"a@x.com"},"active":true},"b@x.com":{"vault":{"kind":"keychain","service":"cc-master-oauth","account":"b@x.com"},"active":false,"token_expires_at":"2027-06-17T10:40:00Z"}}}' > "$F3H/.claude/cc-master/accounts.json"
F3CDIR="$(make_project)"; F3CACHE="$F3CDIR/rate.json"
printf '%s' "{\"five_hour\":{\"used_percentage\":90,\"resets_at\":$A_R5F},\"seven_day\":{\"used_percentage\":20}}" > "$F3CACHE"
HOOK_OUT="$(printf '{"session_id":"sess-acct","hook_event_name":"Stop"}' \
  | env -u CC_MASTER_HOME HOME="$F3H" CC_MASTER_USAGE_DIR="$SAMPLE" CC_MASTER_NOW="2026-06-10T12:00:00Z" \
        CC_MASTER_RATE_CACHE="$F3CACHE" \
      "$HOOK" 2>/dev/null)"; HOOK_RC=$?
assert_eq 0 "$HOOK_RC" "(F3b) CC_MASTER_HOME-unset + HOME-derived home → rc 0"
assert_contains "$HOOK_OUT" "切到下一份配额" "(F3b) accounts.json read from <HOME>/.claude/cc-master (canonical home) → effective-N=2 → 切号 signal"
assert_contains "$HOOK_OUT" "号池" "(F3b) pool fact appended (accounts.json found at HOME-derived home root, same root as arming)"
rm -rf "$F3H" "$F3CDIR"

finish
