#!/usr/bin/env bash
# Tests for account-list.sh — the out-of-band「只读列号池对账」wrapper (NOT a hook).
#
# Focus (codex §7 round-? P2-2 regression): the `--list` recovery UI must NEVER present a `switchable:false`
# entry (fallback / manual-record 残缺号 — registry entry written WITHOUT a vault token) as a HEALTHY `ok`
# TOKEN state. Before the fix, the TOKEN/expired column was computed PURELY from `token_expires_at`
# (`expired = expires < now ? "EXPIRED" : "ok"`) — ignoring `switchable` and whether the vault actually holds
# a token. So a fallback entry (switchable:false, FUTURE token_expires_at placeholder, NO vault token) showed
# TOKEN=ok / looked healthy — yet select-account & pacing exclude it (no token to switch into). `--list` is the
# user's recovery UI; it must surface「this号 has no usable token, needs补录」at a glance.
#
# This suite drives the REAL account-list.sh against a FIXTURE registry built via accounts-lib (schema-valid),
# with FULL isolation:
#   · CC_MASTER_HOME pinned to a throwaway temp dir → registry writes/reads NEVER touch the user's real pool;
#   · NO keychain / NO --probe-keychain → no real `security` calls, no auth popups, no token reads;
#   · token-blind: account-list never reads a token value — this suite only asserts the NON-secret对账表 shape.
. "$(dirname "$0")/helpers.sh"

SCRIPT="$PLUGIN_ROOT/skills/account-management/scripts/account-list.sh"
LIB_JS_REAL="$PLUGIN_ROOT/skills/account-management/scripts/accounts-lib.js"

# ── REGISTRY ISOLATION ───────────────────────────────────────────────────────────────────────────────
# account-list.sh resolves the registry to ${CC_MASTER_HOME:-$HOME/.claude/cc-master}/accounts.json. Pin
# CC_MASTER_HOME to a throwaway temp so the fixture registry never collides with the user's live pool.
TEST_HOME_DIR="$(make_project)"
export CC_MASTER_HOME="$TEST_HOME_DIR"
mkdir -p "$TEST_HOME_DIR"
trap 'rm -rf "$TEST_HOME_DIR"' EXIT

REG="$TEST_HOME_DIR/accounts.json"

echo "== account-list.sh: switchable:false 残缺号 surfaced as no-token, NOT健康 ok =="

assert_file "$SCRIPT" "account-list.sh exists"

# ── build a schema-valid fixture registry via accounts-lib (guarantees窄腰 + schema) ──
# Three accounts, each with a FUTURE token_expires_at (so a naive expires-only check would call ALL of them
# `ok`):
#   · healthy@x.com   — switchable absent (= 可切) → should render TOKEN=ok, SWITCHABLE=yes
#   · fallback@x.com  — switchable:false (残缺号·vault 无 token) → MUST render TOKEN=no-token, SWITCHABLE=no(补录)
#   · expiredtok@x.com— switchable absent + PAST token_expires_at → TOKEN=EXPIRED (regression guard for真过期号)
FUTURE="2099-01-01T00:00:00Z"
PAST="2000-01-01T00:00:00Z"
node -e '
  "use strict";
  const lib = require(process.argv[1]);
  const regPath = process.argv[2];
  const future = process.argv[3], past = process.argv[4];
  let reg = lib.emptyRegistry();
  lib.upsertAccount(reg, "healthy@x.com",   { vault:{kind:"keychain", service:"cc-master-oauth", account:"healthy@x.com"}, token_expires_at: future });
  lib.upsertAccount(reg, "fallback@x.com",  { vault:{kind:"keychain", service:"cc-master-oauth", account:"fallback@x.com"}, token_expires_at: future, switchable: false });
  lib.upsertAccount(reg, "expiredtok@x.com",{ vault:{kind:"keychain", service:"cc-master-oauth", account:"expiredtok@x.com"}, token_expires_at: past });
  lib.saveRegistry(reg, regPath);
' "$LIB_JS_REAL" "$REG" "$FUTURE" "$PAST" || { _red "FAIL: could not build fixture registry"; finish; }

assert_file "$REG" "fixture registry written"

# ── run account-list.sh (no --probe-keychain → no real security calls) ──
OUT="$(CC_MASTER_HOME="$TEST_HOME_DIR" bash "$SCRIPT" --registry "$REG" 2>&1)"; RC=$?
assert_eq "0" "$RC" "account-list.sh exits 0 on a valid registry"

# ── extract the per-account display rows by email so column assertions are exact ──
row_of() { printf '%s\n' "$OUT" | grep -m1 -- "$1"; }
HEALTHY_ROW="$(row_of 'healthy@x.com')"
FALLBACK_ROW="$(row_of 'fallback@x.com')"
EXPIRED_ROW="$(row_of 'expiredtok@x.com')"

# (1) the new SWITCHABLE column is present in the header.
assert_contains "$OUT" "SWITCHABLE" "(1) header carries the new SWITCHABLE column"

# (2) THE CORE REGRESSION: the switchable:false 残缺号 row must NOT be presented as健康 ok, and MUST be
#     flagged no-token (TOKEN col) + not-switchable (SWITCHABLE col). Its token_expires_at is FUTURE — a
#     naive expires-only renderer (the pre-fix bug) would have shown `ok` here.
assert_contains "$FALLBACK_ROW" "no-token" "(2a) fallback (switchable:false) row shows TOKEN=no-token"
assert_contains "$FALLBACK_ROW" "no(补录)" "(2b) fallback row shows SWITCHABLE=no(补录)"
# The fallback row must NOT contain the bare healthy 'ok' token state. Strip the email (could in theory
# contain 'ok' as a substring — these fixtures don't, but be precise) then assert no ' ok ' health marker.
case " $FALLBACK_ROW " in
  *" ok "*) FAILED=$((FAILED+1)); _red "FAIL: (2c) fallback row STILL shows健康 'ok' (the P2-2 bug)";;
  *) PASS=$((PASS+1));;
esac

# (3) a genuinely switchable, unexpired号 still renders TOKEN=ok + SWITCHABLE=yes (no false negative).
assert_contains "$HEALTHY_ROW" "ok" "(3a) healthy号 shows TOKEN=ok"
case "$HEALTHY_ROW" in
  *no-token*) FAILED=$((FAILED+1)); _red "FAIL: (3b) healthy号 wrongly shows no-token";;
  *) PASS=$((PASS+1));;
esac

# (4) a switchable号 with a PAST expiry still renders EXPIRED (didn't get swallowed by the new branch).
assert_contains "$EXPIRED_ROW" "EXPIRED" "(4) switchable号 with past expiry still shows EXPIRED"

# (5) token-blind: account-list output never contains an sk-ant- token形态 (it never reads token values).
case "$OUT" in
  *sk-ant-*) FAILED=$((FAILED+1)); _red "FAIL: (5) output contains an sk-ant- token形态 (token-blind violated)";;
  *) PASS=$((PASS+1));;
esac

finish
