#!/usr/bin/env bash
# Tests for identity-nudge.js (IDNUDGE — node Stop hook, ADR-020). The hook periodically (default 6h)
# re-asserts "you are a master orchestrator" via a NON-BLOCKING <advisory strength="weak"> additionalContext
# (hookEventName "Stop"). It reads board.runtime.last_identity_remind to gate the interval, and on a due
# Stop writes the timestamp BACK via `ccm board set-param` (process boundary) — injecting ONLY when the
# write-back succeeds (no spam when ccm is absent). It is armed-gated (dormant until this session owns an
# active board), silent on Stop re-entry (stop_hook_active), and degrades silently when ccm is unavailable.
#
# helpers.sh::run_hook is bash-only; we invoke the .js by its shebang and inject fixtures via the env
# override points the hook exposes (CC_MASTER_NOW / CC_MASTER_IDNUDGE_INTERVAL_SEC / CCM_BIN). We do NOT
# modify helpers.sh.
. "$(dirname "$0")/helpers.sh"

HOOK="$PLUGIN_ROOT/hooks/scripts/identity-nudge.js"

# ── STUB ccm: a tiny shell that emulates `ccm board set-param <key> <value> --board <path> --home <home>`
# by writing runtime.<key>=<value> into the board file (via node JSON read/modify/write) and exit 0. This
# lets us drive the write-back path WITHOUT building the real ccm SEA. The default driver points CCM_BIN at
# it; a dedicated "ccm-absent" case points CCM_BIN at a nonexistent path (→ spawn fails → no inject).
STUB_DIR="$(make_project)"
STUB_CCM="$STUB_DIR/ccm-stub.sh"
cat > "$STUB_CCM" <<'STUB'
#!/usr/bin/env bash
# Emulate: ccm board set-param <key> <value> --board <path> [--home <home>]
key=""; val=""; board=""
# positionals: $1=board $2=set-param $3=key $4=value, then flags
shift 2   # drop "board" "set-param"
key="$1"; val="$2"; shift 2
while [ $# -gt 0 ]; do
  case "$1" in
    --board) board="$2"; shift 2;;
    --home) shift 2;;
    *) shift;;
  esac
done
# only the whitelisted key is accepted (mirror exit 2 on others)
if [ "$key" != "last_identity_remind" ]; then echo "error: not whitelisted" >&2; exit 2; fi
node -e '
  const fs=require("fs"); const [b,k,v]=process.argv.slice(1);
  const o=JSON.parse(fs.readFileSync(b,"utf8")); o.runtime=o.runtime||{}; o.runtime[k]=v;
  fs.writeFileSync(b, JSON.stringify(o,null,2)+"\n");
' "$board" "$key" "$val"
exit 0
STUB
chmod +x "$STUB_CCM"

# seed_home SID [LAST_REMIND] -> echo a fresh home holding an active board owned by SID, with optional
# runtime.last_identity_remind seeded. board-v2 layout: board lives under <home>/boards/.
seed_home() {
  local h; h="$(make_project)"; mkdir -p "$h/boards"
  local rt=""
  if [ -n "${2:-}" ]; then rt=",\"runtime\":{\"last_identity_remind\":\"$2\"}"; fi
  printf '{"schema":"cc-master/v2","goal":"g","owner":{"active":true,"session_id":"%s","heartbeat":"2026-06-01T00:00:00Z"},"git":{"worktree":"","branch":""},"tasks":[{"id":"T1","status":"in_flight","deps":[]}]%s}' "$1" "$rt" > "$h/boards/mine.board.json"
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

rm -rf "$STUB_DIR"
finish
