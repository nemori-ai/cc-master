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

# ── (6) **codex round#2 — corrupt accounts.json → FAIL-SAFE degrade (exit 0·空池), NOT exit 1** ──
# 契约（SKILL「缺失/坏 JSON 一律 fail-safe 降级单账号·绝不崩」+ select-account.js 同款优雅降级）：list 是诊断/恢复
#   UI——registry 坏掉时正是最需要它能跑的时候。旧码坏 JSON 直接 exit 1 → list 在此刻不可用、且与 select-account.js
#   降级不一致。修：坏 JSON 当空池处理（warn 提示坏 + 怎么修），exit 0。teeth：写一个坏 JSON registry → 断言 exit 0
#   + 输出提示「降级 / 坏 / 修复」+ 不崩、不泄。
echo "-- (6) corrupt registry → fail-safe degrade (exit 0·空池·不崩) --"
BADREG="$TEST_HOME_DIR/bad-accounts.json"
printf '%s' '{ this is not valid JSON ]]' > "$BADREG"
OUT6="$(CC_MASTER_HOME="$TEST_HOME_DIR" bash "$SCRIPT" --registry "$BADREG" 2>&1)"; RC6=$?
assert_eq "0" "$RC6" "(6) corrupt registry → exit 0 (fail-safe degrade·不崩·与 select-account.js 一致)"
assert_contains "$OUT6" "降级" "(6) surfaces 降级 (treats corrupt as empty pool, doesn't hard-fail)"
# does NOT print the old hard-fail ✗ 读取失败 + exit 1 shape.
case "$OUT6" in
  *"✗ accounts.json 读取失败"*) FAILED=$((FAILED+1)); _red "FAIL: (6) still uses the old hard-fail message (should degrade now)";;
  *) PASS=$((PASS+1));;
esac
# token-blind even on the corrupt path.
case "$OUT6" in
  *sk-ant-*) FAILED=$((FAILED+1)); _red "FAIL: (6) corrupt-path output contains sk-ant- (token-blind violated)";;
  *) PASS=$((PASS+1));;
esac

# ── (7) **codex round#7 Finding B — file-vault TOKEN=ok 必须先确认 <email>_TOKEN= 行真的在（token-blind 存在性）** ──
# 病根：file 形态旧码只按 future token_expires_at 判 ok——若 vault 行被删/移走/fallback 登记后从没写 token，list 仍
#   显示 ok、而 switch 实际读不到 blob 会失败，骗了用户（list 是恢复 UI·必须如实）。修：file 形态判 ok 前先**只检查
#   <email>_TOKEN= 行存在性**（行首前缀·绝不读值·token-blind），不存在 → no-token。
# teeth：两个 file-vault 号·同一 future expiry——hasvault@x.com 在 vault 里有 _TOKEN= 行（→ ok）；novault@x.com 的
#   _TOKEN= 行**缺失**（registry entry 在·vault 行不在·→ 必须 no-token·不冒充 ok）。
echo "-- (7) file-vault TOKEN=ok requires the <email>_TOKEN= line to actually exist (token-blind existence) --"
F7DIR="$(make_project)"; F7_VF="$F7DIR/accounts.env"; F7_REG="$F7DIR/accounts.json"
F7_FUTURE="2099-01-01T00:00:00Z"
# vault file has a _TOKEN line ONLY for hasvault@x.com (novault@x.com is registered but its vault line is missing).
printf 'hasvault@x.com_TOKEN={"accessToken":"x","refreshToken":"y","expiresAt":1}\n' > "$F7_VF"; chmod 600 "$F7_VF"
node -e '
  "use strict";
  const lib = require(process.argv[1]);
  const regPath = process.argv[2], vf = process.argv[3], future = process.argv[4];
  let reg = lib.emptyRegistry();
  lib.upsertAccount(reg, "hasvault@x.com", { vault:{kind:"file", path: vf, key:"hasvault@x.com"}, token_expires_at: future });
  lib.upsertAccount(reg, "novault@x.com",  { vault:{kind:"file", path: vf, key:"novault@x.com"}, token_expires_at: future });
  lib.saveRegistry(reg, regPath);
' "$LIB_JS_REAL" "$F7_REG" "$F7_VF" "$F7_FUTURE" || { _red "FAIL: (7) could not build fixture"; finish; }
OUT7="$(CC_MASTER_HOME="$F7DIR" bash "$SCRIPT" --registry "$F7_REG" 2>&1)"; RC7=$?
assert_eq "0" "$RC7" "(7) file-vault list exits 0"
HAS_ROW="$(printf '%s\n' "$OUT7" | grep -m1 -- 'hasvault@x.com')"
NO_ROW="$(printf '%s\n' "$OUT7" | grep -m1 -- 'novault@x.com')"
# hasvault: _TOKEN line present → TOKEN=ok.
assert_contains "$HAS_ROW" "ok" "(7a) hasvault@x.com (vault line present) → TOKEN=ok"
# **CORE**: novault: _TOKEN line ABSENT → must be no-token, NOT健康 ok (the round#7 fix).
assert_contains "$NO_ROW" "no-token" "(7b) CORE: novault@x.com (vault line MISSING) → TOKEN=no-token (NOT健康 ok·list 不骗用户)"
case " $NO_ROW " in
  *" ok "*) FAILED=$((FAILED+1)); _red "FAIL: (7c) novault row STILL shows健康 'ok' despite missing vault line (the round#7 bug)";;
  *) PASS=$((PASS+1));;
esac
# token-blind: list never printed a token value even while existence-probing the file vault.
case "$OUT7" in
  *'"accessToken"'*|*'refreshToken'*) FAILED=$((FAILED+1)); _red "FAIL: (7d) list output leaked a vault token value (existence probe must be token-blind)";;
  *) PASS=$((PASS+1));;
esac
rm -rf "$F7DIR"

# ── (8) **codex round#8 Finding B — 空 <email>_TOKEN= 行也算缺（中断/手动编辑残留·switch 会读到空 blob 失败）** ──
# 病根：round#7 的存在性查只看「行在不在」——一行 `<email>_TOKEN=`（前缀在·等号右侧空·中断/手动编辑残留）会被当
#   present、token_expires_at future 时显示 ok，而 switch 取 blob 得空、读不到、换号失败。修：还要查前缀后**非空**
#   （token-blind·只判 length>0·绝不打印那段值）。teeth：file vault 里 emptytok@x.com 的 _TOKEN= 行**值为空** →
#   必须 no-token（不冒充 ok）；同文件 fulltok@x.com 有非空 blob → ok。
echo "-- (8) empty <email>_TOKEN= line counts as missing (no-token·switch would fail on empty blob) --"
F8DIR="$(make_project)"; F8_VF="$F8DIR/accounts.env"; F8_REG="$F8DIR/accounts.json"
F8_FUTURE="2099-01-01T00:00:00Z"
{
  printf 'fulltok@x.com_TOKEN={"accessToken":"a","refreshToken":"b","expiresAt":1}\n'
  printf 'emptytok@x.com_TOKEN=\n'   # EMPTY value after the prefix (interrupted/manual-edit residue).
} > "$F8_VF"; chmod 600 "$F8_VF"
node -e '
  "use strict";
  const lib = require(process.argv[1]);
  const regPath = process.argv[2], vf = process.argv[3], future = process.argv[4];
  let reg = lib.emptyRegistry();
  lib.upsertAccount(reg, "fulltok@x.com",  { vault:{kind:"file", path: vf, key:"fulltok@x.com"}, token_expires_at: future });
  lib.upsertAccount(reg, "emptytok@x.com", { vault:{kind:"file", path: vf, key:"emptytok@x.com"}, token_expires_at: future });
  lib.saveRegistry(reg, regPath);
' "$LIB_JS_REAL" "$F8_REG" "$F8_VF" "$F8_FUTURE" || { _red "FAIL: (8) could not build fixture"; finish; }
OUT8="$(CC_MASTER_HOME="$F8DIR" bash "$SCRIPT" --registry "$F8_REG" 2>&1)"; RC8=$?
assert_eq "0" "$RC8" "(8) list exits 0"
FULL_ROW="$(printf '%s\n' "$OUT8" | grep -m1 -- 'fulltok@x.com')"
EMPTY_ROW="$(printf '%s\n' "$OUT8" | grep -m1 -- 'emptytok@x.com')"
assert_contains "$FULL_ROW" "ok" "(8a) fulltok@x.com (non-empty _TOKEN value) → TOKEN=ok"
# **CORE**: empty _TOKEN= value → no-token, NOT ok (the round#8 fix).
assert_contains "$EMPTY_ROW" "no-token" "(8b) CORE: emptytok@x.com (EMPTY _TOKEN= value) → TOKEN=no-token (NOT ok·switch 会读到空 blob 失败)"
case " $EMPTY_ROW " in
  *" ok "*) FAILED=$((FAILED+1)); _red "FAIL: (8c) empty-token row STILL shows健康 'ok' (the round#8 bug — empty line treated as present)";;
  *) PASS=$((PASS+1));;
esac
rm -rf "$F8DIR"

# ── (9) **codex §7 P2 — file-vault token 存在性是 bash 层 token-blind 预计算·密 blob 绝不进 node / 绝不进任何变量 / 绝不泄** ──
# 病根（P2 needs-attention）：旧码在 node 渲染脚本里 `fs.readFileSync(v.path)` 把整个 accounts.env（**所有号的完整 OAuth
#   blob**）读进 account-list 的 node 进程内存（`vf` 全文 + 含 blob 的整行 `line` 都被保留）——虽只用 .length 判存在性、
#   不打印，但把密值暴露面从换号路径扩到了纯诊断命令、违反 token-blind 契约。修：file-token 存在性判定挪到 **bash 层**用
#   `awk index($0,p)==1 && length($0)>length(p)`（行首锚定·定字符串前缀·只回布尔哨兵 1），blob 只过 awk buffer、绝不落
#   任何被捕获的变量 / stdout；node 不再 readFileSync vault。
# teeth：用一个**明显 FAKE 的完整 blob 形态** token（sk-ant-oat01-FAKE…）建 file vault 夹具，断言——
#   (9a) no-leak：account-list 输出**不含** FAKE token 任何片段（sk-ant- / FAKE / accessToken / refreshToken）；
#   (9b) 有非空 _TOKEN= 行 → 该号渲染为可切·ok（非 no-token·语义不丢）；
#   (9c) 缺行 → no-token；(9d) 空 `<email>_TOKEN=` 行 → no-token（round#7/#8 语义在 bash 路径下仍成立）。
echo "-- (9) file-vault existence is bash-layer token-blind precompute (blob never enters node / any var / output) --"
F9DIR="$(make_project)"; F9_VF="$F9DIR/accounts.env"; F9_REG="$F9DIR/accounts.json"
F9_FUTURE="2099-01-01T00:00:00Z"
# A FAKE full-blob token (safe to commit) — its fragments must NEVER appear in account-list output.
FAKE_TOKEN='sk-ant-oat01-FAKE-DO-NOT-USE-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
{
  printf 'goodfile@x.com_TOKEN={"accessToken":"%s","refreshToken":"sk-ant-ort01-FAKE","expiresAt":1}\n' "$FAKE_TOKEN"
  printf 'noexp@x.com_TOKEN={"accessToken":"%s","refreshToken":"sk-ant-ort01-FAKE","expiresAt":1}\n' "$FAKE_TOKEN"   # token present, but registered below w/o token_expires_at → expired '?'
  printf 'emptyfile@x.com_TOKEN=\n'   # empty value → no-token
  # missingfile@x.com is registered below but has NO _TOKEN line here → no-token
} > "$F9_VF"; chmod 600 "$F9_VF"
node -e '
  "use strict";
  const lib = require(process.argv[1]);
  const regPath = process.argv[2], vf = process.argv[3], future = process.argv[4];
  let reg = lib.emptyRegistry();
  lib.upsertAccount(reg, "goodfile@x.com",    { vault:{kind:"file", path: vf, key:"goodfile@x.com"},    token_expires_at: future });
  lib.upsertAccount(reg, "noexp@x.com",       { vault:{kind:"file", path: vf, key:"noexp@x.com"} });   // NO token_expires_at → expires renders '-' → expired must be '?'
  lib.upsertAccount(reg, "emptyfile@x.com",   { vault:{kind:"file", path: vf, key:"emptyfile@x.com"},   token_expires_at: future });
  lib.upsertAccount(reg, "missingfile@x.com", { vault:{kind:"file", path: vf, key:"missingfile@x.com"}, token_expires_at: future });
  lib.saveRegistry(reg, regPath);
' "$LIB_JS_REAL" "$F9_REG" "$F9_VF" "$F9_FUTURE" || { _red "FAIL: (9) could not build fixture"; finish; }
OUT9="$(CC_MASTER_HOME="$F9DIR" bash "$SCRIPT" --registry "$F9_REG" 2>&1)"; RC9=$?
assert_eq "0" "$RC9" "(9) file-vault list exits 0"
# (9a) NO-LEAK: output must contain NO fragment of the FAKE token / blob.
case "$OUT9" in
  *sk-ant-*|*FAKE*|*accessToken*|*refreshToken*)
    FAILED=$((FAILED+1)); _red "FAIL: (9a) account-list output leaked a FAKE token/blob fragment (token-blind violated — blob reached output)";;
  *) PASS=$((PASS+1));;
esac
G_ROW="$(printf '%s\n' "$OUT9" | grep -m1 -- 'goodfile@x.com')"
E_ROW="$(printf '%s\n' "$OUT9" | grep -m1 -- 'emptyfile@x.com')"
M_ROW="$(printf '%s\n' "$OUT9" | grep -m1 -- 'missingfile@x.com')"
N_ROW="$(printf '%s\n' "$OUT9" | grep -m1 -- 'noexp@x.com')"
# (9b) non-empty _TOKEN= line → switchable·ok (not no-token).
assert_contains "$G_ROW" "ok" "(9b) goodfile@x.com (non-empty _TOKEN line) → TOKEN=ok"
case " $G_ROW " in
  *no-token*) FAILED=$((FAILED+1)); _red "FAIL: (9b) goodfile wrongly shows no-token despite a present non-empty token line";;
  *) PASS=$((PASS+1));;
esac
# (9c) missing line → no-token.
assert_contains "$M_ROW" "no-token" "(9c) missingfile@x.com (no _TOKEN line) → TOKEN=no-token"
# (9d) empty value → no-token.
assert_contains "$E_ROW" "no-token" "(9d) emptyfile@x.com (empty _TOKEN= value) → TOKEN=no-token"
# (9e) token present but NO token_expires_at → expired must be ? (unknown·not 健康 ok)·与 keychain 行 / footer 同口径·codex §7 P3.
#   '?' ∉ base62 mktemp 路径 / email / 日期 → 整行仅 expired 列一处 '?'，断言含 '?' 即精确测该列（避子串 flake）。
assert_contains "$N_ROW" "?" "(9e) noexp@x.com (token present, no expiry record) → expired=? (unknown, not ok·codex §7 P3)"
rm -rf "$F9DIR"

finish
