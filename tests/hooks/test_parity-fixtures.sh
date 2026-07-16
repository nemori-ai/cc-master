#!/usr/bin/env bash
# test_parity-fixtures.sh — HOOKPAR-DEC / ADR-028 behavioral parity tests (§3.3 layer②).
#
# Structural anchors (hook-injection-contracts.test.mjs) only prove both hosts' source *mentions* a
# rule; they cannot catch "both hosts declare the rule, but their judgment tables disagree" (the
# exact shape of the board-guard bashWritesBoard bug found in design_docs/plans/2026-07-07-hook-
# parity-system.md §2.5). This file drives the SAME host-neutral fixture stdin through BOTH hosts'
# real implementations and asserts the decision falls in the expected equivalence class.
#
# Normalization bridge (HOOKPAR-DEC): the Codex `_hosts/codex/launcher.js` already accepts
# Claude-Code-native raw stdin JSON (session_id/hook_event_name/tool_name/tool_input) and normalizes
# it before invoking `*-core.js` (see existing tests/hooks/test_codex-*.sh, which all feed this same
# native shape through the launcher). This means a SINGLE fixture, written once in Claude-Code-native
# stdin shape, can be fed unmodified to:
#   (a) the claude-code hook script directly (plugin/dist/claude-code/hooks/scripts/<hook>.js), and
#   (b) the codex launcher + core (plugin/src/hooks/_hosts/codex/launcher.js --core <core.js>),
# which is exactly the "收敛在 runHook harness 单点" bridge point recorded in
# hook-common.js's normalizePayload()/ctx.normalized (an additive, zero-behavior-change view used by
# production code only for this kind of cross-host fixture comparison — no existing hook body reads
# it, so there is no behavior change to the hooks themselves from adding it).
#
# Covers the three HIGH-RISK rules the HOOKPAR-DEC decision named as first-batch fixtures:
#   1. rule-board-guard-segment-touches-real-board (board-guard)
#   2. rule-verify-board-fuse (verify-board)
#   3. rule-verify-board-self-check-handshake / verify-board-fingerprint-dedup (verify-board) —
#      this one is a DECLARED protocol-capability-gap (not required to be identical across hosts,
#      see verify-board/CONTRACT.md), so this fixture locks in the DECLARED divergent behavior on
#      each host as a regression guard, rather than asserting byte-identical decisions.

. "$(dirname "$0")/helpers.sh"

CODEX_LAUNCHER="$REPO_ROOT/plugin/src/hooks/_hosts/codex/launcher.js"
CURSOR_LAUNCHER="$REPO_ROOT/plugin/src/hooks/_hosts/cursor/launcher.js"
KIMI_LAUNCHER="$REPO_ROOT/plugin/src/hooks/_hosts/kimi-code/launcher.js"
BOARD_GUARD_CLAUDE="$PLUGIN_ROOT/hooks/scripts/board-guard.js"
BOARD_GUARD_CODEX_CORE="$REPO_ROOT/plugin/src/hooks/board-guard/implementations/codex/board-guard-core.js"
BOARD_GUARD_CURSOR_CORE="$REPO_ROOT/plugin/src/hooks/board-guard/implementations/cursor/board-guard-core.js"
BOARD_GUARD_KIMI_CORE="$REPO_ROOT/plugin/src/hooks/board-guard/implementations/kimi-code/board-guard-core.js"
VERIFY_BOARD_CLAUDE="$PLUGIN_ROOT/hooks/scripts/verify-board.js"
VERIFY_BOARD_CODEX_CORE="$REPO_ROOT/plugin/src/hooks/verify-board/implementations/codex/verify-board-core.js"
VERIFY_BOARD_KIMI_CORE="$REPO_ROOT/plugin/src/hooks/verify-board/implementations/kimi-code/verify-board-core.js"

seed_board() { mkdir -p "$1/boards"; printf '%s' "$3" >"$1/boards/$2.board.json"; }

# ── fixture stdin builders (Claude-Code-native shape; also valid Codex launcher input) ─────────────
bash_payload() {
  # $1=session_id $2=command
  printf '{"session_id":"%s","hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":%s}}' \
    "$1" "$(node -e 'process.stdout.write(JSON.stringify(process.argv[1]))' "$2")"
}
stop_payload() {
  printf '{"session_id":"%s","hook_event_name":"Stop"}' "$1"
}

run_board_guard_claude() {
  HOOK_OUT="$(printf '%s' "$1" | CC_MASTER_HOME="$2" node "$BOARD_GUARD_CLAUDE" 2>/dev/null)"; HOOK_RC=$?
}
run_board_guard_codex() {
  HOOK_OUT="$(printf '%s' "$1" | CC_MASTER_HOME="$2" node "$CODEX_LAUNCHER" --event PreToolUse --core "$BOARD_GUARD_CODEX_CORE" 2>/dev/null)"; HOOK_RC=$?
}
run_board_guard_cursor() {
  local cursor_payload
  cursor_payload="$(printf '%s' "$1" | node -e '
    const fs = require("fs");
    const obj = JSON.parse(fs.readFileSync(0, "utf8"));
    obj.conversation_id = obj.session_id || "";
    obj.hook_event_name = "preToolUse";
    if (obj.tool_name === "Bash") obj.tool_name = "Shell";
    process.stdout.write(JSON.stringify(obj));
  ')"
  HOOK_OUT="$(printf '%s' "$cursor_payload" | CC_MASTER_HOME="$2" node "$CURSOR_LAUNCHER" --event preToolUse --core "$BOARD_GUARD_CURSOR_CORE" 2>/dev/null)"; HOOK_RC=$?
}
run_verify_board_claude() {
  HOOK_OUT="$(printf '%s' "$1" | CC_MASTER_HOME="$2" node "$VERIFY_BOARD_CLAUDE" 2>/dev/null)"; HOOK_RC=$?
}
run_verify_board_codex() {
  HOOK_OUT="$(printf '%s' "$1" | CC_MASTER_HOME="$2" node "$CODEX_LAUNCHER" --event Stop --core "$VERIFY_BOARD_CODEX_CORE" 2>/dev/null)"; HOOK_RC=$?
}
# kimi uses the same Bash tool name + snake_case stdin as the codex/claude-code native shape, so the
# host-neutral fixture feeds unmodified through the kimi launcher (unlike cursor's Shell rewrite).
run_board_guard_kimi() {
  HOOK_OUT="$(printf '%s' "$1" | CC_MASTER_HOME="$2" node "$KIMI_LAUNCHER" --event PreToolUse --core "$BOARD_GUARD_KIMI_CORE" 2>/dev/null)"; HOOK_RC=$?
}
run_verify_board_kimi() {
  HOOK_OUT="$(printf '%s' "$1" | CC_MASTER_HOME="$2" node "$KIMI_LAUNCHER" --event Stop --core "$VERIFY_BOARD_KIMI_CORE" 2>/dev/null)"; HOOK_RC=$?
}

# board-guard PreToolUse deny envelope differs by host (a declared, legitimate envelope-format
# difference, not a business-logic divergence): claude-code emits `permissionDecision:"deny"`
# directly; codex's core emits `{kind:'block'}` which the shared launcher.js converts to
# `decision:"block"` for pre-tool-use events (see _hosts/codex/launcher.js emitHostResult()). Both
# mean "this tool call is denied" — the equivalence class this fixture checks is DENY vs ALLOW, not
# the literal envelope shape.

# =====================================================================================================
# Fixture 1 — rule-board-guard-segment-touches-real-board: a board-looking token OUTSIDE boards/ must
# NOT be treated as a real board, even in a command that also contains a write-operator elsewhere.
# This is the exact §2.5 repro (design_docs/plans/2026-07-07-hook-parity-system.md).
# =====================================================================================================
H="$(make_project)"
seed_board "$H" "mine" '{"schema":"cc-master/v2","goal":"g","owner":{"active":true,"session_id":"sess-x"},"tasks":[{"id":"T0","status":"ready","deps":[]}]}'
FIXTURE1="$(bash_payload "sess-x" "echo hi > $H/scratch.txt; cat $H/notes.board.json")"

run_board_guard_claude "$FIXTURE1" "$H"
assert_eq "" "$HOOK_OUT" "fixture1 (scratch write, board-looking token outside boards/) claude-code -> allow (silent)"
run_board_guard_codex "$FIXTURE1" "$H"
assert_eq "" "$HOOK_OUT" "fixture1 (scratch write, board-looking token outside boards/) codex -> allow (silent)"
run_board_guard_cursor "$FIXTURE1" "$H"
assert_eq "" "$HOOK_OUT" "fixture1 (scratch write, board-looking token outside boards/) cursor -> allow (silent)"

FIXTURE1B="$(bash_payload "sess-x" "echo '{}' > $H/boards/mine.board.json")"
run_board_guard_claude "$FIXTURE1B" "$H"
assert_contains "$HOOK_OUT" '"permissionDecision":"deny"' "fixture1b (real board write) claude-code -> deny"
run_board_guard_codex "$FIXTURE1B" "$H"
assert_contains "$HOOK_OUT" '"decision":"block"' "fixture1b (real board write) codex -> block"
run_board_guard_cursor "$FIXTURE1B" "$H"
assert_contains "$HOOK_OUT" '"permission":"deny"' "fixture1b (real board write) cursor -> deny"

FIXTURE1C="$(bash_payload "sess-x" "ccm task ls --board $H/boards/mine.board.json")"
run_board_guard_claude "$FIXTURE1C" "$H"
assert_eq "" "$HOOK_OUT" "fixture1c (plain ccm --board) claude-code -> allow"
run_board_guard_codex "$FIXTURE1C" "$H"
assert_eq "" "$HOOK_OUT" "fixture1c (plain ccm --board) codex -> allow"
run_board_guard_cursor "$FIXTURE1C" "$H"
assert_eq "" "$HOOK_OUT" "fixture1c (plain ccm --board) cursor -> allow"

FIXTURE1C2="$(bash_payload "sess-x" "ccm task update T0 --set 'note=a>b' --board $H/boards/mine.board.json")"
run_board_guard_claude "$FIXTURE1C2" "$H"
assert_eq "" "$HOOK_OUT" "fixture1c2 (quoted greater-than data, no redirect) claude-code -> allow"
run_board_guard_codex "$FIXTURE1C2" "$H"
assert_eq "" "$HOOK_OUT" "fixture1c2 (quoted greater-than data, no redirect) codex -> allow"
run_board_guard_cursor "$FIXTURE1C2" "$H"
assert_eq "" "$HOOK_OUT" "fixture1c2 (quoted greater-than data, no redirect) cursor -> allow"

for REDIRECT in '>' '>>'; do
  FIXTURE1D="$(bash_payload "sess-x" "ccm board show --board $H/boards/mine.board.json $REDIRECT $H/boards/mine.board.json")"
  run_board_guard_claude "$FIXTURE1D" "$H"
  assert_contains "$HOOK_OUT" '"permissionDecision":"deny"' "fixture1d (ccm $REDIRECT real board) claude-code -> deny"
  run_board_guard_codex "$FIXTURE1D" "$H"
  assert_contains "$HOOK_OUT" '"decision":"block"' "fixture1d (ccm $REDIRECT real board) codex -> block"
  run_board_guard_cursor "$FIXTURE1D" "$H"
  assert_contains "$HOOK_OUT" '"permission":"deny"' "fixture1d (ccm $REDIRECT real board) cursor -> deny"
done
rm -rf "$H"

# =====================================================================================================
# Fixture 2 — rule-verify-board-fuse: a board with a perpetually-actionable `ready` task blocks Stop
# every time (no dedup opportunity — actionable always resets fp on claude-code, and codex has no fp
# at all), so consecutive Stops must trip the fuse and force-allow at the SAME streak (5) on both hosts.
# =====================================================================================================
H="$(make_project)"
seed_board "$H" "mine" '{"schema":"cc-master/v2","goal":"g","owner":{"active":true,"session_id":"sess-x"},"tasks":[{"id":"T0","status":"ready","deps":[]}]}'
FIXTURE2="$(stop_payload "sess-x")"

for i in 1 2 3 4; do
  run_verify_board_claude "$FIXTURE2" "$H"
  assert_contains "$HOOK_OUT" '"decision":"block"' "fixture2 claude-code round $i -> block"
done
run_verify_board_claude "$FIXTURE2" "$H"
assert_not_contains "$HOOK_OUT" '"decision":"block"' "fixture2 claude-code round 5 -> fuse trips, no longer a block decision"
assert_contains "$HOOK_OUT" "fuse tripped" "fixture2 claude-code round 5 -> fuse-tripped advisory text"
rm -rf "$H"

H="$(make_project)"
seed_board "$H" "mine" '{"schema":"cc-master/v2","goal":"g","owner":{"active":true,"session_id":"sess-x"},"tasks":[{"id":"T0","status":"ready","deps":[]}]}'
for i in 1 2 3 4; do
  run_verify_board_codex "$FIXTURE2" "$H"
  assert_contains "$HOOK_OUT" '"decision":"block"' "fixture2 codex round $i -> block"
done
run_verify_board_codex "$FIXTURE2" "$H"
assert_not_contains "$HOOK_OUT" '"decision":"block"' "fixture2 codex round 5 -> fuse trips, no longer a block decision"
assert_contains "$HOOK_OUT" "fuse tripped" "fixture2 codex round 5 -> fuse-tripped advisory text"
rm -rf "$H"

# =====================================================================================================
# Fixture 3 — handshake dedup on a SETTLED completion state (no ready/uncertain/in_flight/user-blocked
# tasks — everything `done`). This is a DECLARED protocol-capability-gap (verify-board/CONTRACT.md
# rule-verify-board-fingerprint-dedup): claude-code dedups the SAME completion state across repeated
# Stops (fingerprint-keyed handshake, only re-asks on a CHANGED completion state); codex has no
# fingerprint dedup and instead requires an explicit `runtime.stop_allow_until` release valve. This
# fixture locks in BOTH declared behaviors as regression guards (not asserting they are identical —
# they are intentionally not).
# =====================================================================================================
H="$(make_project)"
seed_board "$H" "mine" '{"schema":"cc-master/v2","goal":"g","owner":{"active":true,"session_id":"sess-x"},"tasks":[{"id":"T0","status":"done","deps":[]}]}'
FIXTURE3="$(stop_payload "sess-x")"

run_verify_board_claude "$FIXTURE3" "$H"
assert_contains "$HOOK_OUT" '"decision":"block"' "fixture3 claude-code first Stop on settled board -> block (self-check handshake)"
run_verify_board_claude "$FIXTURE3" "$H"
assert_eq "" "$HOOK_OUT" "fixture3 claude-code second Stop on SAME settled state -> allow (fingerprint dedup, already handshaken)"
rm -rf "$H"

H="$(make_project)"
seed_board "$H" "mine" '{"schema":"cc-master/v2","goal":"g","owner":{"active":true,"session_id":"sess-x"},"tasks":[{"id":"T0","status":"done","deps":[]}]}'
run_verify_board_codex "$FIXTURE3" "$H"
assert_contains "$HOOK_OUT" '"decision":"block"' "fixture3 codex first Stop on settled board -> block"
run_verify_board_codex "$FIXTURE3" "$H"
assert_contains "$HOOK_OUT" '"decision":"block"' "fixture3 codex second Stop on SAME settled state (no stop_allow_until) -> STILL block (declared: no fp dedup)"
# Now grant the explicit release valve and confirm it (not fingerprint dedup) is what unblocks Codex.
FUTURE="$(node -e 'process.stdout.write(new Date(Date.now()+3600000).toISOString().replace(/\.\d{3}Z$/,"Z"))')"
node -e '
const fs = require("fs");
const p = process.argv[1], until = process.argv[2];
const b = JSON.parse(fs.readFileSync(p, "utf8"));
b.runtime = Object.assign({}, b.runtime, { stop_allow_until: until });
fs.writeFileSync(p, JSON.stringify(b));
' "$H/boards/mine.board.json" "$FUTURE"
run_verify_board_codex "$FIXTURE3" "$H"
assert_eq "" "$HOOK_OUT" "fixture3 codex third Stop WITH future stop_allow_until -> allow (explicit release valve, the declared compensating mechanism)"
rm -rf "$H"

# =====================================================================================================
# Fixture K — kimi-code (FULLY SELF-CONTAINED). Deliberately NOT interleaved into the fixtures above:
# its own make_project home(s) AND its own session_id ("sess-kimi", distinct from "sess-x") so the
# FUSE / self-check sidecars (home-scoped: verify-board sidecarPath(homeDir,sid)) can never share
# mutable state with the claude-code/codex/cursor rounds. kimi feeds the same host-neutral Bash /
# Stop stdin (kimi uses the same Bash tool name + snake_case shape as codex/claude-code native).
# =====================================================================================================
KSID="sess-kimi"

# board-guard equivalence class: DENY on a real board write, ALLOW otherwise (stateless).
HK="$(make_project)"
seed_board "$HK" "mine" '{"schema":"cc-master/v2","goal":"g","owner":{"active":true,"session_id":"sess-kimi"},"tasks":[{"id":"T0","status":"ready","deps":[]}]}'
run_board_guard_kimi "$(bash_payload "$KSID" "echo hi > $HK/scratch.txt; cat $HK/notes.board.json")" "$HK"
assert_eq "" "$HOOK_OUT" "fixtureK (scratch write, board-looking token outside boards/) kimi-code -> allow (silent)"
run_board_guard_kimi "$(bash_payload "$KSID" "echo '{}' > $HK/boards/mine.board.json")" "$HK"
assert_contains "$HOOK_OUT" '"permissionDecision":"deny"' "fixtureK (real board write) kimi-code -> deny"
run_board_guard_kimi "$(bash_payload "$KSID" "ccm task ls --board $HK/boards/mine.board.json")" "$HK"
assert_eq "" "$HOOK_OUT" "fixtureK (plain ccm --board) kimi-code -> allow"
for REDIRECT in '>' '>>'; do
  run_board_guard_kimi "$(bash_payload "$KSID" "ccm board show --board $HK/boards/mine.board.json $REDIRECT $HK/boards/mine.board.json")" "$HK"
  assert_contains "$HOOK_OUT" '"permissionDecision":"deny"' "fixtureK (ccm $REDIRECT real board) kimi-code -> deny"
done
rm -rf "$HK"

# verify-board FUSE: same streak (5). Rounds 1-4 block via permissionDecision:"deny" (kimi Stop-deny →
# continue once + reason injected). Round 5 trips the fuse and RELEASES; the fuse-tripped advisory is a
# kind:system message which kimi cannot surface on Stop (no non-blocking Stop advisory channel — the
# declared verify-board-kimi-stop-envelope divergence), so the release is a silent allow. Equivalence
# class: rounds 1-4 = DENY, round 5 = ALLOW (same fuse streak as claude-code/codex).
HK="$(make_project)"
seed_board "$HK" "mine" '{"schema":"cc-master/v2","goal":"g","owner":{"active":true,"session_id":"sess-kimi"},"tasks":[{"id":"T0","status":"ready","deps":[]}]}'
FIXTUREK_STOP="$(stop_payload "$KSID")"
for i in 1 2 3 4; do
  run_verify_board_kimi "$FIXTUREK_STOP" "$HK"
  assert_contains "$HOOK_OUT" '"permissionDecision":"deny"' "fixtureK verify-board round $i -> deny (continue + reason)"
done
run_verify_board_kimi "$FIXTUREK_STOP" "$HK"
assert_eq "" "$HOOK_OUT" "fixtureK verify-board round 5 -> fuse trips, release is silent (no non-blocking Stop advisory channel — declared divergence)"
rm -rf "$HK"

finish
