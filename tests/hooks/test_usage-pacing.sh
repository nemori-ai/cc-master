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
      CC_MASTER_HOME="$ARMED_HOME" \
      "$HOOK" 2>/dev/null)"; HOOK_RC=$?
  rm -rf "$ARMED_HOME"
}
# run_pacing_home USAGE_DIR NOW HOME SID [BUDGET] [BURN_FLOOR] -> drive with an explicit home + sid
# (for the armed-gate cases: unarmed home, other-session board, missing-session stdin, etc.).
run_pacing_home() {
  HOOK_OUT="$(printf '{"session_id":"%s","hook_event_name":"Stop"}' "$4" \
    | CC_MASTER_USAGE_DIR="$1" CC_MASTER_NOW="$2" CC_MASTER_HOME="$3" \
      CC_MASTER_5H_BUDGET="${5:-}" CC_MASTER_5H_BURN_FLOOR="${6:-}" \
      "$HOOK" 2>/dev/null)"; HOOK_RC=$?
}
# run_pacing_stdin USAGE_DIR NOW HOME STDIN_JSON [BUDGET] [BURN_FLOOR] -> arbitrary stdin (e.g. no sid).
run_pacing_stdin() {
  HOOK_OUT="$(printf '%s' "$4" \
    | CC_MASTER_USAGE_DIR="$1" CC_MASTER_NOW="$2" CC_MASTER_HOME="$3" \
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

finish
