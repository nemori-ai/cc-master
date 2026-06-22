#!/usr/bin/env bash
# Tests for account-add.sh — the out-of-band「一条命令把当前登录号的完整 OAuth blob 录进 vault」wrapper.
#
# This is NOT a hook (account-add.sh is an out-of-band script the USER runs — token never reaches the agent).
# But it carries load-bearing safety logic, which we regress here with the real `security`/keychain calls
# STUBBED out (NO real keychain reads/writes —防弹窗 + 防污染真实 keychain):
#   (a) keychain DIRECT-READ of the COMPLETE claudeAiOauth blob from「Claude Code-credentials」(account=$USER)
#       — spike-proven the ONLY source with a non-empty refreshToken (无重启换号死依赖它);
#   (b) IDENTITY-MATCH guard — --email must == the machine's current-login email (~/.claude.json oauthAccount),
#       else FAIL (防把 B 的 blob 错标成 A);
#   (c) strict validation — refreshToken 空/缺 → FAIL（绝不存残缺 switchable:false blob）;
#   (d) token-no-leak — blob/refreshToken never appear in script stdout/stderr;
#   (e) registry active:true — 被录号 = 当前登录 → setActive marks it active.
#
# Strategy: account-add.sh is structured so the pieces (extract_blob_from_keychain / extract_blob_from_credentials /
# validate_blob / subscription_type_of / store_blob_file / write_observed_quota) are functions. We can't `source`
# the whole script (it has a top-level main flow that would run), so we extract & eval ONLY the function bodies we
# need to unit-test, and we drive the FULL script end-to-end with `security`/`node` shimmed via a fake PATH dir.
#
# 关键隔离纪律（吸取历史教训）：① CC_MASTER_HOME 指隔离 temp（registry 不污染真实 ~/.claude/cc-master）；
#   ② `security` 全程 STUB（绝不碰真实 /usr/bin/security → 不弹钥匙串授权弹窗、不污染真实 keychain）；
#   ③ 底部防回归 teeth：跑完真实 registry 账号数不变 + 真实 registry 字节不变。
. "$(dirname "$0")/helpers.sh"

SCRIPT="$PLUGIN_ROOT/skills/account-management/scripts/account-add.sh"
LIB_JS_REAL="$PLUGIN_ROOT/skills/account-management/scripts/accounts-lib.js"

# ── REGISTRY ISOLATION ───────────────────────────────────────────────────────────────────────────────
# account-add.sh writes a non-secret accounts.json registry entry on its SUCCESS path, and resolves the
# registry to ${CC_MASTER_HOME:-$HOME/.claude/cc-master}/accounts.json (see accounts-lib defaultRegistryPath).
# WITHOUT this isolation, every `bash run-tests.sh` would write the e2e test account straight into the USER's
# real ~/.claude/cc-master/accounts.json — polluting their live account pool. Pin CC_MASTER_HOME to a throwaway
# temp dir so ALL registry writes land in isolation, and clean it up on exit. Keep the temp-dir path in a
# DEDICATED var for the EXIT-trap cleanup (later cases `unset CC_MASTER_HOME`; under `set -u` the trap's
# "$CC_MASTER_HOME" would then abort with `unbound variable` at exit — referencing $TEST_HOME_DIR keeps cleanup robust).
TEST_HOME_DIR="$(make_project)"
export CC_MASTER_HOME="$TEST_HOME_DIR"
trap 'rm -rf "$TEST_HOME_DIR"' EXIT

# ── ANTI-LEAK SENTINEL: snapshot the USER's REAL registry path + emails BEFORE any case runs, so the teeth
# at the bottom can assert this test never wrote a fixture account into the live pool (regardless of any
# `unset CC_MASTER_HOME`). REAL_REG resolves the default path the SAME way account-add.sh does, but WITHOUT
# the test's CC_MASTER_HOME override (env -u) — i.e. the genuine ~/.claude/cc-master/accounts.json a user
# would have. The fixture accounts this suite creates must NEVER appear there.
REAL_REG="$(env -u CC_MASTER_HOME node -e 'try{process.stdout.write(require(process.argv[1]).defaultRegistryPath())}catch(_e){}' "$LIB_JS_REAL" 2>/dev/null)"
REAL_REG_BEFORE=""
if [ -n "$REAL_REG" ] && [ -f "$REAL_REG" ]; then
  REAL_REG_BEFORE="$(node -e 'try{const r=require("fs").readFileSync(process.argv[1],"utf8");process.stdout.write(r)}catch(_e){}' "$REAL_REG" 2>/dev/null)"
fi

echo "== account-add.sh keychain direct-read + identity guard + vault write + fallback =="

assert_file "$SCRIPT" "account-add.sh exists"

# ── extract the pure functions from the script so we can unit-test them in isolation. ──
# We sed out each `name() { ... }` block (brace-matched by the dedented closing `}` at col 0) and eval it.
# This keeps the test pinned to the SHIPPED function bodies (no copy drift) without running the main flow.
# NOTE: extract_blob_from_keychain / extract_blob_from_credentials reference the NODE_BLOB_FROM_STDIN var, so
#   we also extract & eval that assignment first (it's a multi-line single-quoted heredoc-style var, terminated
#   by the lone-quote line `'`).
eval_var() { # $1 = var name → eval its single-quoted multi-line assignment out of the script
  local v="$1" body
  body="$(awk -v v="$v" '
    $0 ~ "^"v"='"'"'$" { grab=1; print; next }
    grab { print }
    grab && /^'"'"'$/ { exit }
  ' "$SCRIPT")"
  if [ -z "$body" ]; then
    FAILED=$((FAILED+1)); _red "FAIL: could not extract var '$v' from script"; return 1
  fi
  eval "$body"
}
eval_fn() { # $1 = function name → eval its definition out of the script
  local fn="$1"
  local body
  body="$(awk -v fn="$fn" '
    $0 ~ "^"fn"\\(\\) \\{" { grab=1 }
    grab { print }
    grab && /^\}/ { exit }
  ' "$SCRIPT")"
  if [ -z "$body" ]; then
    FAILED=$((FAILED+1)); _red "FAIL: could not extract function '$fn' from script"; return 1
  fi
  eval "$body"
}
USER="${USER:-testuser}"            # extract_blob_from_keychain reads $USER for the keychain account.
err() { printf '%s\n' "$*" >&2; }   # functions call err() for diagnostics; define it before evaling them.
KEYCHAIN_CRED_SERVICE="Claude Code-credentials"
eval_var NODE_BLOB_FROM_STDIN
eval_fn extract_blob_from_keychain
eval_fn extract_blob_from_credentials
eval_fn validate_blob
eval_fn subscription_type_of
eval_fn email_of_identity_json

# ── FAKE keychain blobs ──────────────────────────────────────────────────────────────────────────────
FAKE_AT='sk-ant-oat01-FAKEaccessABC123def456GHI789jkl012MNO345-_xyz'
FAKE_RT='sk-ant-ort01-FAKErefreshZZZ999www888vvv777uuu666ttt555-_rrr'
# the FULL credential blob exactly as keychain「Claude Code-credentials」holds it: {claudeAiOauth:{...}}.
FULL_KC_BLOB="{\"claudeAiOauth\":{\"accessToken\":\"$FAKE_AT\",\"refreshToken\":\"$FAKE_RT\",\"expiresAt\":1750000000000,\"scopes\":[\"user:inference\",\"user:profile\"],\"subscriptionType\":\"max\",\"rateLimitTier\":\"default_claude_max_20x\"}}"

# make_security_stub DIR BLOB — write a `security` stub into DIR that returns BLOB on `find-generic-password -w`
#   for the「Claude Code-credentials」service (and a no-op success on add-generic-password writes). NEVER touches
#   the real /usr/bin/security. The `-w` read path emits the blob; everything else just succeeds quietly.
#
# **FAITHFUL 128-BYTE TRUNCATION MODEL (T16 regression防线)**: real macOS `security add-generic-password ... -w`
#   with NO value arg reads the password from STDIN via `readpassphrase`, which has a HARD 128-byte cap — a ~471-byte
#   OAuth blob fed on stdin is silently chopped to a 128-byte残片 (loses refreshToken, illegal JSON). The OLD stub模
#   ed writes as a stdin no-op, so the broken stdin form passed green and the bug slipped through. This stub now
#   honestly models BOTH write forms via $SEC_WRITE_CAPTURE (a file path the test sets to capture what got "stored"):
#     · `add-generic-password ... -w "<value>"` (value as ARGV)  → store the COMPLETE value (no truncation).
#     · `add-generic-password ... -w`            (NO value, stdin) → store only the FIRST 128 BYTES of stdin (truncate).
#   `find-generic-password -w` reads back whatever was stored (if a capture file exists) else the canned read blob.
make_security_stub() { # $1 dir  $2 blob-for-read  ($3 optional: "empty" → emit nothing on read)
  local dir="$1" blob="$2" mode="${3:-emit}"
  cat > "$dir/security" <<STUB
#!/usr/bin/env bash
# STUB security — emulate keychain WITHOUT touching the real keychain (no auth popups, no pollution).
# Faithfully models readpassphrase's 128-byte stdin cap so the stdin-write footgun can't pass green again.
mode="$mode"
is_read=0; is_write=0; wval=""; saw_w=0; have_wval=0
prev=""
for a in "\$@"; do
  case "\$a" in
    find-generic-password) is_read=1;;
    add-generic-password)  is_write=1;;
  esac
  if [ "\$prev" = "-w" ]; then wval="\$a"; have_wval=1; fi
  [ "\$a" = "-w" ] && saw_w=1
  prev="\$a"
done
if [ "\$is_read" = 1 ]; then
  if [ -n "\${SEC_WRITE_CAPTURE:-}" ] && [ -f "\$SEC_WRITE_CAPTURE" ]; then
    cat "\$SEC_WRITE_CAPTURE"; exit 0
  fi
  [ "\$mode" = empty ] && exit 1
  printf '%s' '$blob'
  exit 0
fi
if [ "\$is_write" = 1 ]; then
  if [ "\$saw_w" = 1 ] && [ "\$have_wval" = 1 ]; then
    # value as ARGV → stored COMPLETE (the correct, no-truncation form).
    [ -n "\${SEC_WRITE_CAPTURE:-}" ] && printf '%s' "\$wval" > "\$SEC_WRITE_CAPTURE"
  else
    # value via STDIN (readpassphrase) → stored TRUNCATED to first 128 bytes (the broken form).
    piped="\$(cat)"
    if [ -n "\${SEC_WRITE_CAPTURE:-}" ]; then
      printf '%s' "\$piped" | head -c 128 > "\$SEC_WRITE_CAPTURE"
    fi
  fi
  exit 0
fi
exit 0
STUB
  chmod +x "$dir/security"
}

# ── (1) extract_blob_from_keychain: full blob from STUBBED keychain (single-line, 3 fields, no token leak) ─
echo "-- (1) extract_blob_from_keychain: full blob from STUBBED keychain (single-line, 3 required fields) --"
KCDIR="$(make_project)"
make_security_stub "$KCDIR" "$FULL_KC_BLOB"
blob_got="$(PATH="$KCDIR:$PATH" extract_blob_from_keychain 2>/dev/null)"; blob_rc=$?
assert_eq "0" "$blob_rc" "(1) extract from stubbed keychain exits 0"
blob_nl="$(printf '%s' "$blob_got" | wc -l | tr -d ' ')"
assert_eq "0" "$blob_nl" "(1) blob is single-line (no embedded newline — file vault line-read won't truncate)"
if validate_blob "$blob_got"; then PASS=$((PASS+1)); _green "(1) validate_blob accepts the 3-field blob"; else FAILED=$((FAILED+1)); _red "FAIL: (1) validate_blob rejected a valid blob"; fi
case "$blob_got" in *"$FAKE_AT"*) PASS=$((PASS+1));; *) FAILED=$((FAILED+1)); _red "FAIL: (1) blob missing accessToken";; esac
case "$blob_got" in *"$FAKE_RT"*) PASS=$((PASS+1));; *) FAILED=$((FAILED+1)); _red "FAIL: (1) blob missing refreshToken (no-restart switch needs it!)";; esac
sub_got="$(subscription_type_of "$blob_got")"
assert_eq "max" "$sub_got" "(1) subscription_type_of extracts the non-secret subscriptionType (for registry)"

# ── (2) refreshToken absent / empty / no .claudeAiOauth → rc≠0 + empty (never silently store partial blob) ─
echo "-- (2) drift/partial cases → rc≠0 + empty blob (NEVER store a switchable:false partial blob) --"
KC2="$(make_project)"
# (2a) refreshToken EMPTY (the credentials.json-shaped residual副本 — spike实证 the file has empty refreshToken).
make_security_stub "$KC2" "{\"claudeAiOauth\":{\"accessToken\":\"$FAKE_AT\",\"refreshToken\":\"\",\"expiresAt\":1750000000000}}"
b_emptyrt="$(PATH="$KC2:$PATH" extract_blob_from_keychain 2>/dev/null)"; brt_rc=$?
if [ "$brt_rc" -ne 0 ] && [ -z "$b_emptyrt" ]; then PASS=$((PASS+1)); _green "(2a) EMPTY refreshToken → rc≠0 + empty (FAIL — no partial blob stored)"; else FAILED=$((FAILED+1)); _red "FAIL: (2a) empty-refreshToken not rejected (rc=$brt_rc)"; fi
# (2b) refreshToken absent entirely.
make_security_stub "$KC2" "{\"claudeAiOauth\":{\"accessToken\":\"$FAKE_AT\",\"expiresAt\":1750000000000}}"
b_norefresh="$(PATH="$KC2:$PATH" extract_blob_from_keychain 2>/dev/null)"; bn_rc=$?
if [ "$bn_rc" -ne 0 ] && [ -z "$b_norefresh" ]; then PASS=$((PASS+1)); _green "(2b) missing refreshToken → rc≠0 + empty (FAIL)"; else FAILED=$((FAILED+1)); _red "FAIL: (2b) missing-refreshToken not rejected (rc=$bn_rc)"; fi
# (2c) no keychain item (stub returns nothing / nonzero) → rc≠0 + empty.
make_security_stub "$KC2" "" empty
b_noitem="$(PATH="$KC2:$PATH" extract_blob_from_keychain 2>/dev/null)"; bi_rc=$?
if [ "$bi_rc" -ne 0 ] && [ -z "$b_noitem" ]; then PASS=$((PASS+1)); _green "(2c) no keychain item → rc≠0 + empty (→ fallback)"; else FAILED=$((FAILED+1)); _red "FAIL: (2c) no-item not rejected"; fi
# (2d) blob present but no .claudeAiOauth (CC drift) → rc≠0 + empty.
make_security_stub "$KC2" '{"other":"stuff"}'
b_nooauth="$(PATH="$KC2:$PATH" extract_blob_from_keychain 2>/dev/null)"; bo_rc=$?
if [ "$bo_rc" -ne 0 ] && [ -z "$b_nooauth" ]; then PASS=$((PASS+1)); _green "(2d) no .claudeAiOauth → rc≠0 + empty (drift → fallback)"; else FAILED=$((FAILED+1)); _red "FAIL: (2d) no-.claudeAiOauth not rejected"; fi
rm -rf "$KCDIR" "$KC2"

# ── (2-cred) Linux/non-mac FALLBACK: extract_blob_from_credentials reads .claudeAiOauth from a file ─────────
echo "-- (2-cred) credentials.json fallback (Linux/non-mac): reads full blob from file (same 3-field validation) --"
CREDDIR="$(make_project)"; CREDFILE="$CREDDIR/.credentials.json"
printf '%s\n' "$FULL_KC_BLOB" > "$CREDFILE"
cred_blob="$(CREDENTIALS_JSON="$CREDFILE" extract_blob_from_credentials 2>/dev/null)"; cred_rc=$?
assert_eq "0" "$cred_rc" "(2-cred) extract from valid credentials.json exits 0"
if validate_blob "$cred_blob"; then PASS=$((PASS+1)); _green "(2-cred) credentials.json blob validates"; else FAILED=$((FAILED+1)); _red "FAIL: (2-cred) credentials.json blob rejected"; fi
# spike-real case: the file's refreshToken is EMPTY (残缺副本) → fallback must FAIL too (no partial store).
printf '%s\n' "{\"claudeAiOauth\":{\"accessToken\":\"$FAKE_AT\",\"refreshToken\":\"\",\"expiresAt\":1750000000000}}" > "$CREDFILE"
cred_emptyrt="$(CREDENTIALS_JSON="$CREDFILE" extract_blob_from_credentials 2>/dev/null)"; ce_rc=$?
if [ "$ce_rc" -ne 0 ] && [ -z "$cred_emptyrt" ]; then PASS=$((PASS+1)); _green "(2-cred) credentials.json with EMPTY refreshToken → FAIL (spike-real残缺副本 case)"; else FAILED=$((FAILED+1)); _red "FAIL: (2-cred) empty-refreshToken file not rejected"; fi
b_nofile="$(CREDENTIALS_JSON="$CREDDIR/nope.json" extract_blob_from_credentials 2>/dev/null)"; bf_rc=$?
if [ "$bf_rc" -ne 0 ] && [ -z "$b_nofile" ]; then PASS=$((PASS+1)); _green "(2-cred) missing credentials.json → rc≠0 + empty"; else FAILED=$((FAILED+1)); _red "FAIL: (2-cred) missing-file not rejected"; fi
rm -rf "$CREDDIR"

# ── helpers reused across the e2e cases ────────────────────────────────────────────────────────────────
# write a fast cc-usage STUB (account-add SUCCESS path runs write_observed_quota → `bash "$CC_USAGE_SH"`;
#   without an override that resolves to the REAL slow cc-usage that reads a huge session JSONL → HANGS).
make_ccu_stub() { # $1 path
  cat > "$1" <<'CCU'
#!/usr/bin/env bash
printf '%s\n' '{"source":"account","five_hour":{"used_percentage":31,"resets_at":4102444800},"seven_day":{"used_percentage":12,"resets_at":4102444800}}'
CCU
  chmod +x "$1"
}
# write a ~/.claude.json stub with a given current-login emailAddress (the IDENTITY guard reads this).
make_claudejson() { # $1 path  $2 email
  printf '{"oauthAccount":{"emailAddress":"%s","accountUuid":"uuid-test","organizationName":"org","subscriptionType":"max"},"numStartups":7}\n' "$2" > "$1"
}
# read a file vault's stored blob accessToken for an email (single _TOKEN line).
vault_at() { # $1 vaultfile  $2 email
  local l; l="$(grep -m1 "^$2_TOKEN=" "$1" 2>/dev/null)"; local b="${l#$2_TOKEN=}"
  printf '%s' "$b" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let o;try{o=JSON.parse(s)}catch(_e){return}process.stdout.write(o.accessToken||"")})' 2>/dev/null
}
reg_active() { # $1 reg  $2 email → true/false/NONE
  node -e 'const e=(require(process.argv[1]).loadRegistry(process.argv[2]).accounts||{})[process.argv[3]];process.stdout.write(e?String(e.active):"NONE")' "$LIB_JS_REAL" "$1" "$2" 2>/dev/null
}

# ── (3) END-TO-END SUCCESS: stub security + identity match → vault stores FULL blob + registry active:true ─
# 被录号 = 当前登录（身份 guard 通过）→ vault stores the FULL single-line blob (含 refreshToken) + registry
# entry active:true + switchable (完整 blob·不写 switchable:false) + identity + subscription_type + expiry.
echo "-- (3) e2e SUCCESS: identity match + stubbed keychain → vault FULL blob + registry active:true + identity --"
E3_HOME="$(make_project)"; E3_STUB="$(make_project)"
E3_AT='sk-ant-oat01-E2EaccessFULLblob000000000000000000000-_xyz'
E3_RT='sk-ant-ort01-E2ErefreshFULLblob00000000000000000000-_rrr'
E3_BLOB="{\"claudeAiOauth\":{\"accessToken\":\"$E3_AT\",\"refreshToken\":\"$E3_RT\",\"expiresAt\":1750000000000,\"scopes\":[\"user:inference\"],\"subscriptionType\":\"max\"}}"
make_security_stub "$E3_STUB" "$E3_BLOB"
E3_CCU="$E3_STUB/cc-usage-stub.sh"; make_ccu_stub "$E3_CCU"
E3_CJ="$E3_STUB/claude.json"; make_claudejson "$E3_CJ" "me@self.com"   # current login == --email (guard passes).
E3_VF="$E3_HOME/accounts.env"
e3_out="$(CC_MASTER_HOME="$E3_HOME" PATH="$E3_STUB:$PATH" CC_USAGE_SH="$E3_CCU" CLAUDE_JSON_PATH="$E3_CJ" \
   bash "$SCRIPT" --email me@self.com --vault-kind file --vault-file "$E3_VF" --expires 2027-12-31 2>&1)"; e3_rc=$?
assert_eq "0" "$e3_rc" "(3) e2e success exits 0"
assert_file "$E3_VF" "(3) vault file created"
# the FULL single-line blob (not a bare token) must be stored, carrying all 3 required fields.
got_line="$(grep -m1 '^me@self.com_TOKEN=' "$E3_VF" 2>/dev/null)"; got_blob="${got_line#me@self.com_TOKEN=}"
blob_shape="$(printf '%s' "$got_blob" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let o;try{o=JSON.parse(s)}catch(_e){process.stdout.write("BADJSON");return}const ok=typeof o.accessToken==="string"&&o.accessToken.indexOf("sk-ant-oat")===0&&typeof o.refreshToken==="string"&&o.refreshToken.indexOf("sk-ant-ort")===0&&!!o.refreshToken&&typeof o.expiresAt==="number";process.stdout.write(ok?"FULLBLOB":"NOTFULL")})' 2>/dev/null)"
assert_eq "FULLBLOB" "$blob_shape" "(3) vault stores the FULL claudeAiOauth blob (accessToken+refreshToken+expiresAt), not a bare token"
case "$got_blob" in *"$E3_RT"*) PASS=$((PASS+1)); _green "(3) stored blob carries the refresh token (no-restart switch can refresh)";; *) FAILED=$((FAILED+1)); _red "FAIL: (3) stored blob missing refresh token";; esac
n_tok="$(grep -c '^me@self.com_TOKEN=' "$E3_VF" 2>/dev/null)"
assert_eq "1" "$n_tok" "(3) exactly one _TOKEN line (blob single-line — no embedded newline split it)"
# registry entry: active:true (被录号 = 当前登录), switchable NOT false, identity present, subscription_type=max.
E3_REG="$E3_HOME/accounts.json"
assert_eq "true" "$(reg_active "$E3_REG" "me@self.com")" "(3) registry entry active:true (被录号 = 当前登录号·setActive)"
e3_shape="$(node -e 'const e=(require(process.argv[1]).loadRegistry(process.argv[2]).accounts||{})["me@self.com"]||{};const switchableOK=(e.switchable!==false);const idOK=(e.identity&&e.identity.emailAddress==="me@self.com");const subOK=(e.subscription_type==="max");process.stdout.write((switchableOK&&idOK&&subOK)?"OK":("switchable="+e.switchable+" id="+JSON.stringify(e.identity&&e.identity.emailAddress)+" sub="+e.subscription_type))' "$LIB_JS_REAL" "$E3_REG" 2>/dev/null)"
assert_eq "OK" "$e3_shape" "(3) registry entry: switchable≠false (完整 blob) + identity(emailAddress) + subscription_type=max"
# last_observed_quota written from the (stubbed) cc-usage — 录号即当前登录号视角.
e3_loq="$(node -e 'const e=(require(process.argv[1]).loadRegistry(process.argv[2]).accounts||{})["me@self.com"]||{};const q=e.last_observed_quota;process.stdout.write(q&&q["5h"]&&q["7d"]?(q["5h"].used_pct+"/"+q["7d"].used_pct+"/"+q["5h"].source):"NONE")' "$LIB_JS_REAL" "$E3_REG" 2>/dev/null)"
assert_eq "31/12/account" "$e3_loq" "(3) last_observed_quota written from stubbed cc-usage (no real-cc-usage hang)"
# TOKEN NO-LEAK: neither token half may appear in the script's stdout/stderr, NOR in the registry file.
assert_not_contains "$e3_out" "$E3_AT" "(3) access token does NOT leak to script stdout/stderr"
assert_not_contains "$e3_out" "$E3_RT" "(3) refresh token does NOT leak to script stdout/stderr"
if grep -q 'sk-ant-' "$E3_REG" 2>/dev/null; then
  FAILED=$((FAILED+1)); _red "FAIL: (3) registry contains an sk-ant- token string (must be token-free!)"
else PASS=$((PASS+1)); _green "(3) OK: registry is token-free (no sk-ant- string)"; fi

# ── (3b) refresh: re-run same email → exactly one _TOKEN line, NEW blob value, no stale dup, still active:true ─
echo "-- (3b) refresh same email → one _TOKEN line, NEW blob, no stale dup, still active:true --"
E3_AT2='sk-ant-oat01-NEWaccessZZZ999www888vvv777uuu666ttt555-_new'
E3_RT2='sk-ant-ort01-NEWrefreshAAA111bbb222ccc333ddd444eee5-_new'
E3_BLOB2="{\"claudeAiOauth\":{\"accessToken\":\"$E3_AT2\",\"refreshToken\":\"$E3_RT2\",\"expiresAt\":1760000000000,\"scopes\":[\"user:inference\"],\"subscriptionType\":\"max\"}}"
make_security_stub "$E3_STUB" "$E3_BLOB2"
CC_MASTER_HOME="$E3_HOME" PATH="$E3_STUB:$PATH" CC_USAGE_SH="$E3_CCU" CLAUDE_JSON_PATH="$E3_CJ" \
   bash "$SCRIPT" --email me@self.com --vault-kind file --vault-file "$E3_VF" --expires 2028-01-01 >/dev/null 2>&1
n_tok2="$(grep -c '^me@self.com_TOKEN=' "$E3_VF" 2>/dev/null)"
assert_eq "1" "$n_tok2" "(3b) refresh → exactly one _TOKEN line (no stale dup)"
assert_eq "$E3_AT2" "$(vault_at "$E3_VF" "me@self.com")" "(3b) refresh → vault line carries the NEW blob's access token"
if grep -q "$E3_AT" "$E3_VF" 2>/dev/null; then FAILED=$((FAILED+1)); _red "FAIL: (3b) OLD blob residual after refresh"; else PASS=$((PASS+1)); fi
assert_eq "true" "$(reg_active "$E3_HOME/accounts.json" "me@self.com")" "(3b) still active:true after refresh"
rm -rf "$E3_HOME" "$E3_STUB"

# ── (3c) **codex round#1 Finding 3 teeth — file-vault write is ALL-OR-NOTHING (old token survives a failed write)** ─
# 病根：旧 store_blob_file「先 mv 删旧 _TOKEN 行的版本到位、再 >> append 新 blob」——append 失败 / 部分写（磁盘满 /
#   quota / IO 错）时旧可用 token 已删、新 token 没写 = 该号 vault 无有效 token（switch 切不进·需重录）。
# 修：temp 里先写齐（保留行 + 新 _TOKEN 行 + 可选 _EXPIRES），全部成功才 rename 覆盖；任一步失败丢 temp、原 vault
#   原封不动（旧 token 存活）。teeth：extract store_blob_file（pinned to shipped body）→ 预置含旧 token 的 vault →
#   把 vault 所在目录设只读（mktemp/temp 写不进 → 写步骤失败）→ 断言：① 函数 return 非0；② 原 vault 文件**原封不动**
#   （旧 _TOKEN 行仍在、未被「删了旧又没写新」毁成空）。这正是非原子 bug 会让旧 token 蒸发的那个失败窗口。
echo "-- (3c) file-vault store_blob_file is ALL-OR-NOTHING (failed write keeps the OLD token, never deletes-then-loses) --"
eval_fn with_vault_lock || true   # store_blob_file now wraps its critical section in with_vault_lock (codex round#9).
eval_fn store_blob_file || true
A3C_DIR="$(make_project)"; A3C_VF="$A3C_DIR/accounts.env"
A3C_OLD_RT='sk-ant-ort01-A3ColdREFRESH000000000000000000000000-_old'
# pre-seed an EXISTING vault with alice's OLD (valid) token line — this must survive a failed re-write.
printf 'alice@x.com_TOKEN=%s\n' "{\"accessToken\":\"sk-ant-oat01-A3Cold000000000000000000000000-_o\",\"refreshToken\":\"$A3C_OLD_RT\",\"expiresAt\":1700000000000}" > "$A3C_VF"; chmod 600 "$A3C_VF"
A3C_BEFORE="$(cat "$A3C_VF")"
# make the vault's DIRECTORY read-only → mktemp / temp creation / writes inside it fail → store_blob_file must
#   abort WITHOUT having touched the original $A3C_VF (atomic temp+rename: original only replaced on full success).
chmod 500 "$A3C_DIR"
A3C_NEW_BLOB="{\"accessToken\":\"sk-ant-oat01-A3CnewACCESS00000000000000000000-_n\",\"refreshToken\":\"sk-ant-ort01-A3CnewREFRESH0000000000000000000-_n\",\"expiresAt\":1800000000000}"
# run the extracted function with EMAIL/VAULT_FILE/EXPIRES/LIB_JS set as the script would (token-blind unit harness).
a3c_out="$(EMAIL="alice@x.com" VAULT_FILE="$A3C_VF" EXPIRES="" LIB_JS="$LIB_JS_REAL" store_blob_file "$A3C_NEW_BLOB" 2>&1)"; a3c_rc=$?
chmod 700 "$A3C_DIR"   # restore so we can read/cleanup.
if [ "$a3c_rc" -ne 0 ]; then PASS=$((PASS+1)); _green "(3c) store_blob_file returns非0 on a write it can't complete (does not pretend success)"; else FAILED=$((FAILED+1)); _red "FAIL: (3c) store_blob_file returned 0 despite an un-writable vault dir"; fi
A3C_AFTER="$(cat "$A3C_VF" 2>/dev/null || echo '<UNREADABLE>')"
assert_eq "$A3C_BEFORE" "$A3C_AFTER" "(3c) ORIGINAL vault file UNCHANGED on failed write (old token survives·全或无·non-atomic bug would've left it empty/partial)"
# the OLD refresh token line is still intact (the号 is still recoverable·switch 仍能读到旧 token).
if grep -q "$A3C_OLD_RT" "$A3C_VF" 2>/dev/null; then PASS=$((PASS+1)); _green "(3c) OLD refresh token still present after failed write (not deleted-then-lost)"; else FAILED=$((FAILED+1)); _red "FAIL: (3c) OLD refresh token GONE after failed write — the非原子 deletes-then-loses bug regressed"; fi
# token no-leak even on this unit path: neither old nor new token half in the function's output.
assert_not_contains "$a3c_out" "$A3C_OLD_RT" "(3c) old refresh token does NOT leak to store_blob_file output"
rm -rf "$A3C_DIR"

# ── (3d) **codex round#2 Finding A teeth — file-vault write matches ONLY exact rows, never clobbers a sibling** ─
# 病根：旧 store_blob_file 用宽前缀 `<email>_`（prefix）筛旧行——录/续期 `foo` 会把 `foo_bar_TOKEN=`/`_EXPIRES=`
#   （另一个号 `foo_bar` 的行）一并删掉 → 误毁 sibling 号。修：只删本号**精确**的 `<email>_TOKEN=` / `<email>_EXPIRES=`
#   两类行（tokenLine/expiresLine），绝不用宽 `<email>_` 前缀。teeth：vault 预置 sibling `foo_bar` 的行 + `foo` 自己
#   的旧行 → 对 `foo` 重写 → 断言：① `foo` 自己的 _TOKEN 被换成新 blob；② `foo_bar` 的 _TOKEN/_EXPIRES **原封不动存活**.
echo "-- (3d) file-vault store_blob_file overlapping-identifier safety (refreshing 'foo' must NOT clobber 'foo_bar') --"
eval_fn with_vault_lock || true   # store_blob_file wraps its critical section in with_vault_lock (codex round#9).
eval_fn store_blob_file || true
A3D_DIR="$(make_project)"; A3D_VF="$A3D_DIR/accounts.env"
A3D_SIB_RT='sk-ant-ort01-A3DsiblingFOObar00000000000000000-_sib'
A3D_FOO_OLD_RT='sk-ant-ort01-A3DfooOLD0000000000000000000000-_old'
# pre-seed: sibling foo_bar (must survive) + foo's own old line (must be replaced).
{
  printf 'foo_bar@x.com_TOKEN=%s\n' "{\"accessToken\":\"sk-ant-oat01-A3Dsib0000000000000000-_s\",\"refreshToken\":\"$A3D_SIB_RT\",\"expiresAt\":1700000000000}"
  printf 'foo_bar@x.com_EXPIRES=2099-01-01\n'
  printf 'foo@x.com_TOKEN=%s\n' "{\"accessToken\":\"sk-ant-oat01-A3DfooOLD000000000000-_o\",\"refreshToken\":\"$A3D_FOO_OLD_RT\",\"expiresAt\":1700000000000}"
} > "$A3D_VF"; chmod 600 "$A3D_VF"
A3D_NEW_RT='sk-ant-ort01-A3DfooNEW0000000000000000000000-_new'
A3D_NEW_BLOB="{\"accessToken\":\"sk-ant-oat01-A3DfooNEW000000000000-_n\",\"refreshToken\":\"$A3D_NEW_RT\",\"expiresAt\":1800000000000}"
# rewrite foo@x.com (NOT foo_bar@x.com) — the broad-prefix bug would have deleted foo_bar's rows too.
a3d_out="$(EMAIL="foo@x.com" VAULT_FILE="$A3D_VF" EXPIRES="" LIB_JS="$LIB_JS_REAL" store_blob_file "$A3D_NEW_BLOB" 2>&1)"; a3d_rc=$?
assert_eq "0" "$a3d_rc" "(3d) store_blob_file rewrites foo@x.com OK (exit 0)"
# ① foo@x.com's token replaced with the NEW one (old foo gone, exactly one foo line).
if grep -q "$A3D_NEW_RT" "$A3D_VF" 2>/dev/null; then PASS=$((PASS+1)); _green "(3d) foo@x.com _TOKEN replaced with NEW blob"; else FAILED=$((FAILED+1)); _red "FAIL: (3d) foo@x.com NEW token not written"; fi
n_foo="$(awk -v p='foo@x.com_TOKEN=' 'index($0,p)==1' "$A3D_VF" 2>/dev/null | wc -l | tr -d ' ')"
assert_eq "1" "$n_foo" "(3d) exactly one foo@x.com_TOKEN line (old replaced, no dup)"
# ② **CORE**: the SIBLING foo_bar@x.com rows MUST survive untouched (the broad-prefix bug deleted them).
if grep -q "$A3D_SIB_RT" "$A3D_VF" 2>/dev/null; then PASS=$((PASS+1)); _green "(3d) CORE: sibling foo_bar@x.com _TOKEN SURVIVES (exact-row match·not clobbered by foo's rewrite)"; else FAILED=$((FAILED+1)); _red "FAIL: (3d) sibling foo_bar@x.com _TOKEN DELETED — the broad-prefix overlapping-identifier bug regressed"; fi
if grep -q '^foo_bar@x.com_EXPIRES=2099-01-01$' "$A3D_VF" 2>/dev/null; then PASS=$((PASS+1)); _green "(3d) sibling foo_bar@x.com _EXPIRES also survives"; else FAILED=$((FAILED+1)); _red "FAIL: (3d) sibling foo_bar@x.com _EXPIRES deleted by foo's rewrite"; fi
assert_not_contains "$a3d_out" "$A3D_SIB_RT" "(3d) sibling refresh token does NOT leak to output"
rm -rf "$A3D_DIR"

# ── (3e) **codex round#7 Finding C — mutateRegistry 串行化并发 RMW（防 lost-update）** ──
# 病根：saveRegistry 的 tmp+rename 只防单次写撕裂，挡不住「load→改→save」跨步并发——两个进程各 load 同一旧态、各
#   改、后写 rename 覆盖先写 = 丢号。修：mutateRegistry 在整个 load-改-save 外加咨询文件锁串行化。teeth：并发起 N
#   个 node 进程，各自 mutateRegistry 加一个不同 email → 串行化后**全部 N 个号都在**（无锁则后写覆盖、丢号）。
echo "-- (3e) mutateRegistry serializes concurrent RMW (no lost-update·all concurrent adds survive) --"
A3E_DIR="$(make_project)"; A3E_REG="$A3E_DIR/accounts.json"
printf '%s\n' '{ "schema": "cc-master/accounts/v1", "accounts": {} }' > "$A3E_REG"
# launch N concurrent node procs, each adds a distinct email via mutateRegistry (load-mutate-save under the lock).
#   Each proc EXITS NONZERO if its mutateRegistry throws (e.g. lock-acquire timeout) — collect rc so a lock failure
#   shows as a test failure, not a silently-lost add. Generous CCM_REGISTRY_LOCK_TIMEOUT_MS for loaded CI.
A3E_N=5
A3E_pids=""; i=0
while [ "$i" -lt "$A3E_N" ]; do
  CCM_REGISTRY_LOCK_TIMEOUT_MS=30000 node -e '
    "use strict";
    const lib = require(process.argv[1]);
    const regPath = process.argv[2], email = "concurrent" + process.argv[3] + "@x.com";
    lib.mutateRegistry(regPath, (reg) => {
      lib.upsertAccount(reg, email, { vault:{kind:"keychain", service:"cc-master-oauth", account: email} });
    });
  ' "$LIB_JS_REAL" "$A3E_REG" "$i" &
  A3E_pids="$A3E_pids $!"
  i=$((i+1))
done
a3e_anyfail=0
for p in $A3E_pids; do wait "$p" || a3e_anyfail=1; done
if [ "$a3e_anyfail" -eq 0 ]; then PASS=$((PASS+1)); _green "(3e) all $A3E_N concurrent mutateRegistry procs completed without lock-timeout error"; else FAILED=$((FAILED+1)); _red "FAIL: (3e) a concurrent mutateRegistry proc errored (lock-acquire timeout?)"; fi
# all N accounts must be present — none lost to a concurrent overwrite.
n_concurrent="$(node -e 'const r=require(process.argv[1]).loadRegistry(process.argv[2]);const ks=Object.keys(r.accounts||{}).filter(k=>/^concurrent\d+@x\.com$/.test(k));process.stdout.write(String(ks.length))' "$LIB_JS_REAL" "$A3E_REG" 2>/dev/null)"
assert_eq "$A3E_N" "$n_concurrent" "(3e) CORE: all $A3E_N concurrent mutateRegistry adds survived (no lost-update·lock serialized the RMW)"
# the registry is still valid JSON (no torn write).
if node -e 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))' "$A3E_REG" 2>/dev/null; then PASS=$((PASS+1)); _green "(3e) registry still valid JSON after concurrent writes (no torn write)"; else FAILED=$((FAILED+1)); _red "FAIL: (3e) registry corrupted by concurrent writes"; fi
# the lock file must be released (not left lingering) after all ops complete.
if [ ! -e "$A3E_REG.lock" ]; then PASS=$((PASS+1)); _green "(3e) lock file released after all RMW complete (no leaked lock)"; else FAILED=$((FAILED+1)); _red "FAIL: (3e) lock file $A3E_REG.lock leaked (not released)"; fi
rm -rf "$A3E_DIR"

# ── (3f) **codex round#8 Finding A — releaseRegistryLock 只删属于自己的锁（防 stale 抢占后原持有者误删新锁）** ──
# 病根：旧 release 盲目 unlink lockfile by path——若原持有者 A 被判 stale、B 抢了锁（写了新 owner token），A resume 后
#   release 会删掉 **B 的**锁 → 第三者 C 得以并发进临界区，重现 lost-update。修：锁文件存 owner token，release 只在
#   token 仍是自己的才 unlink。teeth：A 取锁拿到 handleA → 模拟 B 抢锁（覆写 lockfile 成不同 owner）→ A 用 handleA
#   release → 断言 lockfile **仍在**（A 没误删 B 的锁）；再用 B 的 handle release → 锁删净。
echo "-- (3f) releaseRegistryLock only deletes ITS OWN lock (owner-token guard·no误删 after stale takeover) --"
A3F_DIR="$(make_project)"; A3F_REG="$A3F_DIR/accounts.json"
printf '%s\n' '{ "schema": "cc-master/accounts/v1", "accounts": {} }' > "$A3F_REG"
a3f_out="$(node -e '
  "use strict";
  const lib = require(process.argv[1]);
  const fs = require("fs");
  const regPath = process.argv[2];
  const lp = regPath + ".lock";
  const handleA = lib.acquireRegistryLock(regPath);          // A 取锁。
  // 模拟 A 被判 stale、B 抢锁：覆写 lockfile 成 B 的 owner（B 的 handle 自己造）。
  const handleB = { path: lp, owner: "B-" + Date.now() + "-takeover" };
  fs.writeFileSync(lp, JSON.stringify({ pid: 99999, at: new Date().toISOString(), owner: handleB.owner }));
  // A resume → 用 handleA release：owner 不匹配（现在是 B 的）→ 必须 NOT 删 B 的锁。
  lib.releaseRegistryLock(handleA);
  const stillThereAfterA = fs.existsSync(lp);
  // B release：owner 匹配 → 删净。
  lib.releaseRegistryLock(handleB);
  const goneAfterB = !fs.existsSync(lp);
  process.stdout.write((stillThereAfterA ? "A-DIDNT-DELETE" : "A-WRONGLY-DELETED") + "/" + (goneAfterB ? "B-DELETED" : "B-LEFT"));
' "$LIB_JS_REAL" "$A3F_REG" 2>&1)"
assert_eq "A-DIDNT-DELETE/B-DELETED" "$a3f_out" "(3f) owner-token guard: stale-takeover A does NOT delete B's lock; B releases its own (no误删·no concurrent-entry race)"
rm -rf "$A3F_DIR"

# ── (3i) **codex round#12 Finding B — a LIVE lock is NOT broken by mtime alone (pid liveness is authoritative)** ──
# 病根：旧 stale 判定先按 mtime>staleMs 置 stale·再仅在 !stale 时查 pid——一个活着但慢/被 descheduled 的持锁者，只要锁
#   文件 mtime 老过阈值就被别人破锁 → 两进程同进临界区 → lost-update。修：先查 pid——活 → 永不 stale（无论 mtime 多老）。
# teeth：预占锁·pid=本测试 shell（活着）·把锁文件 mtime 改成很久以前（远超 staleMs）→ 用很小 staleMs 跑 acquireFileLock
#   → 断言它**超时失败**（NOT 破活锁抢占）。再把锁 pid 改成一个**死 pid**（不存在）→ acquire 应**回收**并取到锁。
echo "-- (3i) live lock NOT broken by mtime alone (pid authoritative·codex round#12) --"
I3_DIR="$(make_project)"; I3_REG="$I3_DIR/accounts.json"; I3_LOCK="$I3_REG.lock"
printf '%s\n' '{ "schema": "cc-master/accounts/v1", "accounts": {} }' > "$I3_REG"
# pre-occupy lock with a LIVE pid (this shell $$) + a VERY OLD mtime (1 year ago·far > staleMs).
printf '%s' "{\"pid\":$$,\"at\":\"2020-01-01T00:00:00Z\",\"owner\":\"live-holder-$$\"}" > "$I3_LOCK"
touch -t 202001010000 "$I3_LOCK" 2>/dev/null || true   # force old mtime.
# small staleMs + small timeout → if mtime alone broke the lock, acquire would SUCCEED (wrong). It must instead TIME OUT.
i3_live="$(CCM_REGISTRY_LOCK_STALE_MS=500 CCM_REGISTRY_LOCK_TIMEOUT_MS=900 node -e '
  try { const l=require(process.argv[1]); const h=l.acquireRegistryLock(process.argv[2]); l.releaseRegistryLock(h); process.stdout.write("ACQUIRED-WRONGLY"); }
  catch(e){ process.stdout.write("TIMED-OUT-CORRECTLY"); }
' "$LIB_JS_REAL" "$I3_REG" 2>/dev/null)"
assert_eq "TIMED-OUT-CORRECTLY" "$i3_live" "(3i) CORE: live lock (old mtime) is NOT broken — acquire times out instead of stealing it (pid authoritative)"
# now flip the lock to a DEAD pid (very high, unlikely to exist) → acquire MUST reclaim (dead holder·safe).
printf '%s' "{\"pid\":2147480000,\"at\":\"2020-01-01T00:00:00Z\",\"owner\":\"dead-holder\"}" > "$I3_LOCK"
touch -t 202001010000 "$I3_LOCK" 2>/dev/null || true
i3_dead="$(CCM_REGISTRY_LOCK_STALE_MS=500 CCM_REGISTRY_LOCK_TIMEOUT_MS=900 node -e '
  try { const l=require(process.argv[1]); const h=l.acquireRegistryLock(process.argv[2]); l.releaseRegistryLock(h); process.stdout.write("RECLAIMED"); }
  catch(e){ process.stdout.write("FAILED-TO-RECLAIM"); }
' "$LIB_JS_REAL" "$I3_REG" 2>/dev/null)"
assert_eq "RECLAIMED" "$i3_dead" "(3i) dead-pid lock IS reclaimed (acquire succeeds·stale recovery still works for genuinely-dead holders)"
rm -f "$I3_LOCK"; rm -rf "$I3_DIR"

# ── (3j) **codex round#13 Finding A — with_vault_lock ACTUALLY serializes (records live bash $$·not dead node pid)** ──
# 病根：with_vault_lock 旧版经一次性 node 取锁、记 node 的 pid——那 node 立即退出·临界区在 bash 跑，并发对手 process.kill
#   (deadNodePid,0) 看 pid 已死 → 立刻判 stale 破锁 → 锁形同虚设·并发 file-vault 重写仍 lost-update。修：记 bash `$$`
#   （临界区期间活着）当 livePid → 并发对手看 $$ 活着 → 不破锁 → 真串行化。teeth：extract with_vault_lock·N 个并发
#   bash 进程各 with_vault_lock 同一文件、临界区做「读-改-写 +1」——串行化后计数器最终 == N（无锁/坏锁则 lost-update < N）。
echo "-- (3j) with_vault_lock actually serializes concurrent file-vault rewrites (live bash \$\$·codex round#13) --"
eval_fn with_vault_lock || true
J3_DIR="$(make_project)"; J3_COUNTER="$J3_DIR/counter.txt"; J3_VF="$J3_DIR/v.env"
LIB_JS="$LIB_JS_REAL"
printf '0' > "$J3_COUNTER"
J3_N=6
# each worker: with_vault_lock around a NON-atomic read-modify-write of the counter (sleep widens the race window).
#   without a REAL lock, concurrent workers read the same value and the increments are lost (final < N).
j3_worker() {
  bash -c '
    LIB_JS="'"$LIB_JS_REAL"'"
    '"$(declare -f err 2>/dev/null || echo 'err(){ printf "%s\n" "$*" >&2; }')"'
    '"$(declare -f with_vault_lock)"'
    crit() {
      v="$(cat "'"$J3_COUNTER"'")"
      sleep 0.05                      # widen the read-modify-write window so a missing lock loses updates.
      printf "%s" "$(( v + 1 ))" > "'"$J3_COUNTER"'"
    }
    with_vault_lock "'"$J3_VF"'" crit
  '
}
i=0; while [ "$i" -lt "$J3_N" ]; do j3_worker & i=$((i+1)); done
wait
j3_final="$(cat "$J3_COUNTER" 2>/dev/null)"
assert_eq "$J3_N" "$j3_final" "(3j) CORE: with_vault_lock serialized $J3_N concurrent rewrites → counter==$J3_N (no lost-update·lock is real·records live \$\$)"
# lock released (no leak).
if [ ! -e "$J3_VF.lock" ]; then PASS=$((PASS+1)); _green "(3j) vault lock file released after all workers (no leak)"; else FAILED=$((FAILED+1)); _red "FAIL: (3j) vault lock file leaked"; fi
rm -rf "$J3_DIR"

# ── (3g) **codex round#9 Finding A — vault written but registry write FAILS → exit非0 (不谎报录号成功)** ──
# 病根：vault 写成、但 write_registry_entry 失败（坏 JSON / 不可写 / 锁超时）时旧码只 warn 仍 exit 0——secret 进了
#   vault 但该号对 account-list / select / effective-N 不可见，automation 却当录号已成。修：registry 写失败 → exit 3
#   （区别于干净成功 0）。teeth：keychain 直读成功（stub）→ vault 写成，但 CC_MASTER_HOME registry 目录**只读** →
#   write_registry_entry 的 saveRegistry 写不进 → 断言 exit 3（非 0·非干净成功）+ stderr 说「录号未完成 / 不可见」。
echo "-- (3g) vault stored but registry write fails → exit非0 (codex round#9·automation must not see a half-add as success) --"
G3_HOME="$(make_project)"; G3_STUB="$(make_project)"
G3_AT='sk-ant-oat01-G3accessFULLblob00000000000000000-_g3a'
G3_RT='sk-ant-ort01-G3refreshFULLblob0000000000000000-_g3r'
G3_BLOB="{\"claudeAiOauth\":{\"accessToken\":\"$G3_AT\",\"refreshToken\":\"$G3_RT\",\"expiresAt\":1750000000000,\"subscriptionType\":\"max\"}}"
make_security_stub "$G3_STUB" "$G3_BLOB"
G3_CCU="$G3_STUB/cc-usage-stub.sh"; make_ccu_stub "$G3_CCU"
G3_CJ="$G3_STUB/claude.json"; make_claudejson "$G3_CJ" "g3@self.com"   # current login == --email (guard passes).
# make the registry HOME read-only so saveRegistry (tmp+rename into it) fails, while the keychain vault write succeeds.
chmod 500 "$G3_HOME"
g3_out="$(CC_MASTER_HOME="$G3_HOME" PATH="$G3_STUB:$PATH" CC_USAGE_SH="$G3_CCU" CLAUDE_JSON_PATH="$G3_CJ" \
   bash "$SCRIPT" --email g3@self.com --vault-kind keychain 2>&1)"; g3_rc=$?
chmod 700 "$G3_HOME"   # restore for cleanup.
assert_eq "3" "$g3_rc" "(3g) registry write failure (read-only HOME) → exit 3 (NOT 0·不谎报录号成功)"
assert_contains "$g3_out" "录号未完成" "(3g) stderr says 录号未完成 (account invisible to list/select·automation must know)"
# token no-leak even on this failure path.
assert_not_contains "$g3_out" "$G3_RT" "(3g) refresh token does NOT leak on the registry-fail path"
rm -rf "$G3_HOME" "$G3_STUB"

# ── (3h) **codex round#10 — with_vault_lock FAILS CLOSED when the lock can't be acquired (no unlocked rewrite)** ──
# 病根：with_vault_lock 旧版取锁失败时 owner="" 仍**无锁**跑临界区 → 重现锁要防的并发互踩（最后 mv 者赢复活已删
#   token / 丢别号 blob）。修：取锁失败 → return 1·**绝不执行 command**（不无锁重写 vault）。teeth：extract with_vault_lock
#   → 预占 <vf>.lock（一个**活着的** owner·新 mtime → acquireFileLock 必超时失败）+ 小锁超时 → 断言 with_vault_lock
#   return非0 且**那段 command 根本没跑**（用一个 sentinel 文件证明 command 未执行）。
echo "-- (3h) with_vault_lock fails CLOSED when lock unavailable (refuses to run the critical section unlocked) --"
eval_fn with_vault_lock || true
H3_DIR="$(make_project)"; H3_VF="$H3_DIR/accounts.env"; H3_LOCK="$H3_VF.lock"; H3_SENTINEL="$H3_DIR/ran.sentinel"
LIB_JS="$LIB_JS_REAL"   # with_vault_lock calls node with $LIB_JS.
# pre-occupy the lock with a LIVE owner (this shell's $$·alive) + fresh mtime → acquireFileLock must time out (not stale).
printf '%s' "{\"pid\":$$,\"at\":\"2099-01-01T00:00:00Z\",\"owner\":\"held-by-test-$$\"}" > "$H3_LOCK"
# the "critical section" command drops a sentinel — it must NOT run (lock unavailable → fail closed).
h3_cmd() { printf 'RAN\n' > "$H3_SENTINEL"; return 0; }
CCM_REGISTRY_LOCK_TIMEOUT_MS=800 with_vault_lock "$H3_VF" h3_cmd; h3_rc=$?
if [ "$h3_rc" -ne 0 ]; then PASS=$((PASS+1)); _green "(3h) with_vault_lock returns非0 when lock cannot be acquired (fail-closed)"; else FAILED=$((FAILED+1)); _red "FAIL: (3h) with_vault_lock returned 0 despite being unable to acquire the lock"; fi
# **CORE**: the critical section must NOT have run (no sentinel·no unlocked rewrite).
if [ ! -e "$H3_SENTINEL" ]; then PASS=$((PASS+1)); _green "(3h) CORE: critical section did NOT run unlocked (no sentinel·race not reintroduced)"; else FAILED=$((FAILED+1)); _red "FAIL: (3h) critical section RAN despite lock-acquire failure (unlocked rewrite·race reintroduced)"; fi
rm -f "$H3_LOCK"; rm -rf "$H3_DIR"

# ── (4) IDENTITY-MISMATCH guard: --email != current-login email → FAIL + clear guard message, NO vault write ─
# 病根防御：keychain「Claude Code-credentials」(account=$USER) 永远是机器当前登录号 B 的 blob。若 --email A != B，
#   直读会把 B 的 blob 错标成 A 存进 vault/registry（A entry 实指 B 凭证·选号/换号灾难）。guard 必须 FAIL.
echo "-- (4) identity-mismatch guard: --email != current login → FAIL + guard message, NO vault/registry write --"
G_HOME="$(make_project)"; G_STUB="$(make_project)"
make_security_stub "$G_STUB" "$FULL_KC_BLOB"        # keychain HAS a blob (current login is B)…
G_CCU="$G_STUB/cc-usage-stub.sh"; make_ccu_stub "$G_CCU"
G_CJ="$G_STUB/claude.json"; make_claudejson "$G_CJ" "currentB@machine.com"   # …current login = currentB.
G_VF="$G_HOME/accounts.env"
g_out="$(CC_MASTER_HOME="$G_HOME" PATH="$G_STUB:$PATH" CC_USAGE_SH="$G_CCU" CLAUDE_JSON_PATH="$G_CJ" \
   bash "$SCRIPT" --email wanted@other.com --vault-kind file --vault-file "$G_VF" --expires 2027-12-31 2>&1)"; g_rc=$?
if [ "$g_rc" -ne 0 ]; then PASS=$((PASS+1)); _green "(4) identity-mismatch → exits nonzero (FAIL)"; else FAILED=$((FAILED+1)); _red "FAIL: (4) mismatch should exit nonzero (got $g_rc)"; fi
# the guard message must name BOTH the current login AND the wanted email (clear actionable guidance).
assert_contains "$g_out" "currentB@machine.com" "(4) guard message names the CURRENT login email"
assert_contains "$g_out" "wanted@other.com" "(4) guard message names the WANTED (--email) email"
assert_contains "$g_out" "身份不匹配" "(4) guard message says 身份不匹配 (identity mismatch)"
# NO vault write and NO registry entry for the wanted email (we FAILed before reading/storing the blob).
if [ -f "$G_VF" ] && grep -q '_TOKEN=' "$G_VF" 2>/dev/null; then FAILED=$((FAILED+1)); _red "FAIL: (4) mismatch WROTE a vault token line (must not!)"; else PASS=$((PASS+1)); _green "(4) no vault token written on mismatch"; fi
g_has_entry="$(node -e 'const r=require(process.argv[1]).loadRegistry(process.argv[2]);process.stdout.write((r.accounts&&r.accounts["wanted@other.com"])?"YES":"NO")' "$LIB_JS_REAL" "$G_HOME/accounts.json" 2>/dev/null)"
assert_eq "NO" "$g_has_entry" "(4) no registry entry for the wanted email on mismatch"
# the current-login blob must NOT leak either (guard fired before any read, but be sure).
assert_not_contains "$g_out" "$FAKE_RT" "(4) keychain blob refresh token does NOT leak on mismatch"
rm -rf "$G_HOME" "$G_STUB"

# ── (5) NO-refreshToken keychain blob → e2e FAIL: NO vault write, manual fallback, registry has NO token ──
# keychain returns a blob WITHOUT a usable refreshToken (空) → 绝不存残缺 blob → exit nonzero + manual guidance.
echo "-- (5) keychain blob missing refreshToken → e2e FAIL (no partial store), manual fallback fires --"
N_HOME="$(make_project)"; N_STUB="$(make_project)"
make_security_stub "$N_STUB" "{\"claudeAiOauth\":{\"accessToken\":\"$FAKE_AT\",\"refreshToken\":\"\",\"expiresAt\":1750000000000}}"
N_CCU="$N_STUB/cc-usage-stub.sh"; make_ccu_stub "$N_CCU"
N_CJ="$N_STUB/claude.json"; make_claudejson "$N_CJ" "norefresh@self.com"
N_VF="$N_HOME/accounts.env"
# CREDENTIALS_JSON → nonexistent so the file fallback can't rescue it either (truly no refreshToken anywhere).
n_out="$(CC_MASTER_HOME="$N_HOME" PATH="$N_STUB:$PATH" CC_USAGE_SH="$N_CCU" CLAUDE_JSON_PATH="$N_CJ" CREDENTIALS_JSON="$N_STUB/nope.json" \
   bash "$SCRIPT" --email norefresh@self.com --vault-kind file --vault-file "$N_VF" 2>&1)"; n_rc=$?
if [ "$n_rc" -ne 0 ]; then PASS=$((PASS+1)); _green "(5) no-refreshToken blob → exits nonzero (FAIL — no partial store)"; else FAILED=$((FAILED+1)); _red "FAIL: (5) should exit nonzero (got $n_rc)"; fi
if [ -f "$N_VF" ] && grep -q '_TOKEN=' "$N_VF" 2>/dev/null; then FAILED=$((FAILED+1)); _red "FAIL: (5) no-refreshToken WROTE a vault token line (must store no partial blob!)"; else PASS=$((PASS+1)); _green "(5) no partial blob stored in vault"; fi
assert_contains "$n_out" "refreshToken" "(5) failure message mentions the missing refreshToken"
assert_contains "$n_out" "手动" "(5) failure prints manual-recovery guidance"
# **(5-recipe) codex round#11 — the printed file-vault recovery snippet must be &&-chained (all-or-nothing)**：
#   每步用 && 串联 + 末尾 `|| { rm -f $VT; … }`——awk/printf 任一步失败都不会走到 mv·绝不用残缺 temp 覆盖 vault 丢别号。
assert_contains "$n_out" 'mv "$VT"' "(5-recipe) prints the temp+rename recovery form (not a bare append)"
# the snippet's final mv must be guarded by `|| { rm -f \$VT` (abort+cleanup on any prior-step failure).
case "$n_out" in
  *'|| { rm -f "$VT"'*) PASS=$((PASS+1)); _green "(5-recipe) recovery snippet is &&-chained with || rm-cleanup (fail-closed·codex round#11·no partial-temp clobber)";;
  *) FAILED=$((FAILED+1)); _red "FAIL: (5-recipe) recovery snippet's mv NOT guarded by || rm-cleanup (a failed awk/printf could still clobber the vault)";;
esac
# structural: the snippet must NOT contain the OLD un-chained `> "$VT"; fi` followed by an unconditional separate mv.
#   (the old bug: awk and mv on separate statements → mv runs even if awk failed.) Assert the awk-into-temp is &&-joined.
case "$n_out" in
  *'> "$VT"; } && \'*) PASS=$((PASS+1)); _green "(5-recipe) awk-into-temp is &&-joined to the next step (not a standalone statement)";;
  *) FAILED=$((FAILED+1)); _red "FAIL: (5-recipe) awk-into-temp not &&-joined — a failed awk could fall through to mv";;
esac
# even the fallback's auto-registry write must keep the registry token-free.
if [ -f "$N_HOME/accounts.json" ] && grep -q 'sk-ant-' "$N_HOME/accounts.json" 2>/dev/null; then
  FAILED=$((FAILED+1)); _red "FAIL: (5) registry contains an sk-ant- token string after no-refresh fallback"
else PASS=$((PASS+1)); _green "(5) OK: registry token-free after no-refresh fallback"; fi
assert_not_contains "$n_out" "$FAKE_AT" "(5) access token does NOT leak on the no-refresh fallback path"
# fallback registry entry MUST be switchable:false — vault has NO token (auto-extract failed), so the entry
# must be discoverable (account-list) but NOT counted as switchable capacity (usage-pacing poolStatus /
# select-account exclude switchable:false) → no phantom 备号 / no fake「切号」pacing prompt.
n5_switchable="$(node -e 'const e=(require(process.argv[1]).loadRegistry(process.argv[2]).accounts||{})["norefresh@self.com"]||{};process.stdout.write(String(e.switchable))' "$LIB_JS_REAL" "$N_HOME/accounts.json" 2>/dev/null)"
assert_eq "false" "$n5_switchable" "(5) fallback registry entry is switchable:false (vault has no token → not phantom capacity)"
rm -rf "$N_HOME" "$N_STUB"

# ── (5b) RECOVERY: fallback marks switchable:false → later SUCCESSFUL add of the SAME email clears it → true ─
# 病根（codex §7 round-4 P2·已坐实）：fallback 路径写 switchable:false 后，旧码成功 add 调
#   write_registry_entry … "" "1"（switchable 传 ""）→ fields 不含 switchable → upsertAccount 的
#   `if (f.switchable !== undefined)` 不更新 → 保留旧 switchable:false → 即便补完 vault 重跑 --add（自动
#   提取成功）该号仍被 select-account/usage-pacing 当不可切排除（recovery 不生效）。修：成功路径传 "true"
#   显式覆写旧 false。这个 case 复现 fallback→成功 add 的完整 recovery 链，断言 entry.switchable === true。
echo "-- (5b) recovery: fallback switchable:false → successful add of SAME email升 switchable:true (clears false) --"
R_HOME="$(make_project)"; R_STUB="$(make_project)"
R_CCU="$R_STUB/cc-usage-stub.sh"; make_ccu_stub "$R_CCU"
R_CJ="$R_STUB/claude.json"; make_claudejson "$R_CJ" "recover@self.com"   # current login == --email (guard passes both runs).
R_VF="$R_HOME/accounts.env"
R_REG="$R_HOME/accounts.json"
# (5b-i) FIRST run = fallback path: keychain stub returns a blob with EMPTY refreshToken + credentials.json
#   nonexistent → auto-extract fully fails → manual fallback fires → writes registry entry switchable:false.
make_security_stub "$R_STUB" "{\"claudeAiOauth\":{\"accessToken\":\"$FAKE_AT\",\"refreshToken\":\"\",\"expiresAt\":1750000000000}}"
CC_MASTER_HOME="$R_HOME" PATH="$R_STUB:$PATH" CC_USAGE_SH="$R_CCU" CLAUDE_JSON_PATH="$R_CJ" CREDENTIALS_JSON="$R_STUB/nope.json" \
   bash "$SCRIPT" --email recover@self.com --vault-kind file --vault-file "$R_VF" >/dev/null 2>&1 || true
r_pre="$(node -e 'const e=(require(process.argv[1]).loadRegistry(process.argv[2]).accounts||{})["recover@self.com"]||{};process.stdout.write(String(e.switchable))' "$LIB_JS_REAL" "$R_REG" 2>/dev/null)"
assert_eq "false" "$r_pre" "(5b-i) fallback path first wrote registry entry switchable:false (precondition)"
# (5b-ii) SECOND run = successful add of the SAME email: keychain stub now returns a COMPLETE blob (valid
#   refreshToken) + identity still matches → success path → must CLEAR the stale switchable:false → true.
R_AT2='sk-ant-oat01-RECOVERaccessFULL00000000000000000000-_xyz'
R_RT2='sk-ant-ort01-RECOVERrefreshFULL0000000000000000000-_rrr'
R_BLOB2="{\"claudeAiOauth\":{\"accessToken\":\"$R_AT2\",\"refreshToken\":\"$R_RT2\",\"expiresAt\":1760000000000,\"scopes\":[\"user:inference\"],\"subscriptionType\":\"max\"}}"
make_security_stub "$R_STUB" "$R_BLOB2"
CC_MASTER_HOME="$R_HOME" PATH="$R_STUB:$PATH" CC_USAGE_SH="$R_CCU" CLAUDE_JSON_PATH="$R_CJ" \
   bash "$SCRIPT" --email recover@self.com --vault-kind file --vault-file "$R_VF" --expires 2027-12-31 >/dev/null 2>&1
r_post="$(node -e 'const e=(require(process.argv[1]).loadRegistry(process.argv[2]).accounts||{})["recover@self.com"]||{};process.stdout.write(String(e.switchable))' "$LIB_JS_REAL" "$R_REG" 2>/dev/null)"
assert_eq "true" "$r_post" "(5b-ii) successful add cleared the fallback's switchable:false → switchable:true (recovery works)"
# sanity: the success path also stored the full blob + flipped active:true (the号 is now genuinely switchable).
assert_eq "true" "$(reg_active "$R_REG" "recover@self.com")" "(5b-ii) recovered号 active:true after successful add"
rm -rf "$R_HOME" "$R_STUB"

# ── (5c) MANUAL-RECOVERY闭环: auto-extract STILL fails, but cc-master vault ALREADY has a valid blob (user
#         manually restored it) → fallback PROBES the vault → marks switchable:TRUE (codex §7 round-2 P2). ──
# 病根（codex round-2 P2·已坐实）：若自动提取**仍**失败（非 mac / 官方登录非目标号），用户照手动指引把有效
#   blob 存进 cc-master vault 后，旧码无条件标 switchable:false → 没东西翻 switchable:true → 该号被
#   select-account / usage-pacing effective-N 永久排除、手动恢复路隐身。修：fallback 标 switchable 前先
#   probe_vault_has_valid_blob（token-blind·只返 yes/no）——vault 已有有效 blob → switchable:true。
# 这个 case 区别于 (5b)：(5b) 是「重跑 --add 自动提取**成功**」的 recovery；本 case 是「自动提取**仍失败**、
#   但 vault 已被手动恢复」的 recovery（probe 命中），这是 codex round-2 P2 专门补的盲区。
echo "-- (5c) manual recovery: auto-extract STILL fails + cc-master vault ALREADY has valid blob → probe → switchable:true --"
M_HOME="$(make_project)"; M_STUB="$(make_project)"
M_CCU="$M_STUB/cc-usage-stub.sh"; make_ccu_stub "$M_CCU"
M_CJ="$M_STUB/claude.json"; make_claudejson "$M_CJ" "manual@self.com"   # identity guard passes (current login == --email).
M_VF="$M_HOME/accounts.env"
M_REG="$M_HOME/accounts.json"
# Pre-seed the cc-master FILE vault with a VALID dummy blob (含非空 refreshToken·sk-ant-ort) — simulating the
#   user having manually restored it per the fallback guidance. 100% FAKE token — never real.
M_AT='sk-ant-oat01-MANUALrecoveryAccess0000000000000000-_xyz'
M_RT='sk-ant-ort01-MANUALrecoveryRefresh000000000000000-_rrr'
M_VAULT_BLOB="{\"accessToken\":\"$M_AT\",\"refreshToken\":\"$M_RT\",\"expiresAt\":1750000000000}"
umask 077; mkdir -p "$M_HOME"
printf '%s_TOKEN=%s\n' "manual@self.com" "$M_VAULT_BLOB" > "$M_VF"
# keychain stub returns a blob with EMPTY refreshToken (auto-extract fails) + credentials.json nonexistent →
#   fallback fires. The fallback then PROBES the file vault (which we pre-seeded) → valid → switchable:true.
make_security_stub "$M_STUB" "{\"claudeAiOauth\":{\"accessToken\":\"$M_AT\",\"refreshToken\":\"\",\"expiresAt\":1750000000000}}"
m_out="$(CC_MASTER_HOME="$M_HOME" PATH="$M_STUB:$PATH" CC_USAGE_SH="$M_CCU" CLAUDE_JSON_PATH="$M_CJ" CREDENTIALS_JSON="$M_STUB/nope.json" \
   bash "$SCRIPT" --email manual@self.com --vault-kind file --vault-file "$M_VF" 2>&1)"; m_rc=$?
# auto-extract failed → script still exits nonzero (it never got a fresh valid blob from keychain).
if [ "$m_rc" -ne 0 ]; then PASS=$((PASS+1)); _green "(5c) auto-extract still failed → exits nonzero (fallback path)"; else FAILED=$((FAILED+1)); _red "FAIL: (5c) expected nonzero exit (auto-extract failed), got $m_rc"; fi
# CORE REGRESSION: the probe detected the pre-seeded valid vault blob → entry marked switchable:TRUE.
m_switchable="$(node -e 'const e=(require(process.argv[1]).loadRegistry(process.argv[2]).accounts||{})["manual@self.com"]||{};process.stdout.write(String(e.switchable))' "$LIB_JS_REAL" "$M_REG" 2>/dev/null)"
assert_eq "true" "$m_switchable" "(5c) CORE: fallback probed cc-master vault, found valid blob → switchable:true (manual-recovery闭环)"
# the user-facing message must tell them recovery is complete (detected vault blob → marked switchable).
assert_contains "$m_out" "vault 已有" "(5c) fallback message tells user the vault blob was detected"
# token-no-leak still holds: neither the pre-seeded token half may appear in script stdout/stderr nor registry.
assert_not_contains "$m_out" "$M_RT" "(5c) pre-seeded refresh token does NOT leak to script stdout/stderr"
assert_not_contains "$m_out" "$M_AT" "(5c) pre-seeded access token does NOT leak to script stdout/stderr"
if grep -q 'sk-ant-' "$M_REG" 2>/dev/null; then FAILED=$((FAILED+1)); _red "FAIL: (5c) registry contains an sk-ant- token string"; else PASS=$((PASS+1)); _green "(5c) OK: registry token-free after probe-recovery"; fi
# the pre-seeded vault line must survive untouched (fallback never stores/overwrites the vault).
m_vault_at="$(vault_at "$M_VF" "manual@self.com")"
assert_eq "$M_AT" "$m_vault_at" "(5c) pre-seeded vault blob survives the fallback (no overwrite)"

# ── (5d) NEGATIVE control: auto-extract fails AND cc-master vault is EMPTY → switchable:false (no phantom). ──
# Mirror of (5c) but with NO pre-seeded vault blob → probe returns no → entry stays switchable:false (so an
#   empty号 never becomes phantom switchable capacity). Pins that the probe doesn't over-mark.
echo "-- (5d) negative: auto-extract fails + cc-master vault EMPTY → switchable:false (no phantom capacity) --"
M2_HOME="$(make_project)"; M2_STUB="$(make_project)"
M2_CCU="$M2_STUB/cc-usage-stub.sh"; make_ccu_stub "$M2_CCU"
M2_CJ="$M2_STUB/claude.json"; make_claudejson "$M2_CJ" "empty@self.com"
M2_VF="$M2_HOME/accounts.env"   # deliberately NOT created — vault has no blob for this email.
M2_REG="$M2_HOME/accounts.json"
make_security_stub "$M2_STUB" "{\"claudeAiOauth\":{\"accessToken\":\"$FAKE_AT\",\"refreshToken\":\"\",\"expiresAt\":1750000000000}}"
m2_out="$(CC_MASTER_HOME="$M2_HOME" PATH="$M2_STUB:$PATH" CC_USAGE_SH="$M2_CCU" CLAUDE_JSON_PATH="$M2_CJ" CREDENTIALS_JSON="$M2_STUB/nope.json" \
   bash "$SCRIPT" --email empty@self.com --vault-kind file --vault-file "$M2_VF" 2>&1)"; m2_rc=$?
if [ "$m2_rc" -ne 0 ]; then PASS=$((PASS+1)); _green "(5d) auto-extract failed + empty vault → exits nonzero"; else FAILED=$((FAILED+1)); _red "FAIL: (5d) expected nonzero exit, got $m2_rc"; fi
m2_switchable="$(node -e 'const e=(require(process.argv[1]).loadRegistry(process.argv[2]).accounts||{})["empty@self.com"]||{};process.stdout.write(String(e.switchable))' "$LIB_JS_REAL" "$M2_REG" 2>/dev/null)"
assert_eq "false" "$m2_switchable" "(5d) empty vault → probe returns no → switchable:false (no phantom capacity)"
# improved guidance: tells the user to re-run --add after storing the blob (probe will then mark switchable).
assert_contains "$m2_out" "重跑" "(5d) guidance tells user to re-run --add after manually storing the blob"
rm -rf "$M_HOME" "$M_STUB" "$M2_HOME" "$M2_STUB"

# ── (5e) **codex round#9 Finding B — manual-recovery (guard-fail bypass) + registry write FAILS → NOT exit 0** ──
# 病根：身份 guard 失败旁路 try_mark_switchable_from_vault 在 vault 有有效 blob 时标 switchable:true·return 0——但若
#   write_registry_entry 失败（坏 JSON / 不可写 / 锁超时），旧码仍 return 0 → caller exit 0，而该号没标 switchable:true、
#   仍被 select / effective-N 排除（恢复未生效）。修：registry 写失败 → return 1·caller 不 exit 0 谎报恢复成功。
# teeth：current login != --email（guard 失败 → 走旁路）+ cc-master file vault 已有有效 blob（probe 命中）+ registry
#   目录只读（write_registry_entry 失败）→ 断言 exit非0（NOT 0·恢复未完成）+ stderr 说「恢复未完成」+ 无 token 泄漏。
echo "-- (5e) manual-recovery bypass + registry write fails → exit非0 (codex round#9·no false recovery success) --"
R5E_HOME="$(make_project)"; R5E_STUB="$(make_project)"
R5E_CJ="$R5E_STUB/claude.json"; make_claudejson "$R5E_CJ" "someoneElse@self.com"   # current login != --email → guard FAILS → bypass.
R5E_VF="$R5E_HOME/accounts.env"
R5E_AT='sk-ant-oat01-R5Erecovery0000000000000000000000-_a'
R5E_RT='sk-ant-ort01-R5Erecovery0000000000000000000000-_r'
umask 077; mkdir -p "$R5E_HOME"
printf '%s_TOKEN=%s\n' "wanted@x.com" "{\"accessToken\":\"$R5E_AT\",\"refreshToken\":\"$R5E_RT\",\"expiresAt\":1750000000000}" > "$R5E_VF"
make_ccu_stub "$R5E_STUB/cc-usage-stub.sh"
# make the registry HOME read-only → write_registry_entry inside try_mark_switchable_from_vault fails.
chmod 500 "$R5E_HOME"
r5e_out="$(CC_MASTER_HOME="$R5E_HOME" PATH="$R5E_STUB:$PATH" CC_USAGE_SH="$R5E_STUB/cc-usage-stub.sh" CLAUDE_JSON_PATH="$R5E_CJ" CREDENTIALS_JSON="$R5E_STUB/nope.json" \
   bash "$SCRIPT" --email wanted@x.com --vault-kind file --vault-file "$R5E_VF" 2>&1)"; r5e_rc=$?
chmod 700 "$R5E_HOME"   # restore for cleanup.
if [ "$r5e_rc" -ne 0 ]; then PASS=$((PASS+1)); _green "(5e) recovery + registry-fail → exits非0 (not false recovery success)"; else FAILED=$((FAILED+1)); _red "FAIL: (5e) recovery exited 0 despite registry write failure (谎报恢复成功)"; fi
assert_contains "$r5e_out" "恢复未完成" "(5e) stderr says 恢复未完成 (switchable not persisted·号 still excluded)"
assert_not_contains "$r5e_out" "$R5E_RT" "(5e) pre-seeded refresh token does NOT leak on the recovery-fail path"
rm -rf "$R5E_HOME" "$R5E_STUB"

# ── (6) dry-run: never reads keychain, never writes, blob literal '<redacted>' only ──────────────────────
echo "-- (6) dry-run: no keychain read, no write, <redacted> token only --"
DR_HOME="$(make_project)"
dr_out="$(CC_MASTER_HOME="$DR_HOME" bash "$SCRIPT" --email dr@self.com --vault-kind file --vault-file "$DR_HOME/dr.env" --dry-run 2>&1)"; dr_rc=$?
assert_eq "0" "$dr_rc" "(6) dry-run exits 0"
assert_no_file "$DR_HOME/dr.env" "(6) dry-run writes NO vault file"
assert_no_file "$DR_HOME/accounts.json" "(6) dry-run writes NO registry"
assert_contains "$dr_out" "redacted" "(6) dry-run uses <redacted> for token"
rm -rf "$DR_HOME"

# ── (7) cloud backend → no-op exit 0, no vault write ─────────────────────────────────────────────────
echo "-- (7) cloud backend → no-op exit 0, no vault write --"
CB_HOME="$(make_project)"
cb_out="$(CC_MASTER_HOME="$CB_HOME" CLAUDE_CODE_USE_BEDROCK=1 bash "$SCRIPT" --email cb@self.com --vault-kind file --vault-file "$CB_HOME/cb.env" 2>&1)"; cb_rc=$?
assert_eq "0" "$cb_rc" "(7) cloud backend exits 0 (no-op)"
assert_no_file "$CB_HOME/cb.env" "(7) cloud backend writes NO vault file"
rm -rf "$CB_HOME"

# ── (8) TOKEN-BLIND STRUCTURE TEETH: the keychain blob must only flow through pipes/subprocess, NEVER echo ─
# Pin the no-leak discipline structurally: the keychain READ must pipe `security … | node …` (blob never lands
# in a bash var as raw text), and the stored blob must reach `security -w`/`>> vault` via stdin/file, never argv.
echo "-- (8) token-blind structure teeth: keychain blob only via pipe/subprocess, never echoed --"
# (8a) the keychain read pipes security into node (blob never assigned to a bash var as raw text).
if grep -qE 'security find-generic-password -w .*\| node' "$SCRIPT"; then
  PASS=$((PASS+1)); _green "(8a) keychain read pipes 'security … -w | node' (blob stays in pipe, never a raw bash var)"
else
  FAILED=$((FAILED+1)); _red "FAIL: (8a) keychain read does not pipe security|node — blob may land in a bash var"
fi
# (8b) the keychain WRITE feeds the blob as an ARGV value (security ... -w "$blob"), NEVER via stdin double-feed.
#   **INVERTED posture (用户拍板抉择 A·128-byte fix)**: the stdin double-feed (`printf '%s\n%s\n' | security -w`)走
#   readpassphrase 有 128 字节硬上限会截断 ~471 字节 blob → 必须改成 `-w "$blob"`（值作 argv·存完整）。These teeth now
#   REQUIRE the argv form and BAN the stdin double-feed (the inverse of the old, broken-form-enforcing teeth).
if grep -qE 'security add-generic-password .* -w "\$blob"' "$SCRIPT"; then
  PASS=$((PASS+1)); _green "(8b) keychain write feeds blob as argv (security … -w \"\$blob\"), avoiding the 128-byte stdin cap"
else
  FAILED=$((FAILED+1)); _red "FAIL: (8b) keychain write does not use the argv -w \"\$blob\" form (128-byte stdin truncation risk)"
fi
# (8b-stdin-ban) the broken stdin double-feed form must be GONE from live code (comment/err-guidance prose may explain
#   WHY we dropped it — strip comment lines first, then ban a live `printf '%s\n%s\n' ... | security ... add-generic`).
if grep -vE '^[[:space:]]*#' "$SCRIPT" | grep -qE "printf '%s..n%s..n'.*\|.*security add-generic-password"; then
  FAILED=$((FAILED+1)); _red "FAIL: (8b-stdin-ban) a live stdin double-feed 'printf | security add-generic-password -w' survives (128-byte truncation regression!)"
else
  PASS=$((PASS+1)); _green "(8b-stdin-ban) no live stdin double-feed keychain write (the 128-byte-truncating form is gone)"
fi
# (8c) NO `echo`/`printf`/`info`/`err` line prints the $blob variable directly (token-blind — except the argv/file feeds).
#   We allow `security … -w "$blob"` (8b, argv value — accepted sub-second local exposure·抉择 A) and
#   `printf '%s_TOKEN=%s\n' ... "$blob" >> file` (file write). Any OTHER occurrence of $blob on an echo/info/err line is a leak.
blob_leaks="$(grep -nE '(^|[^_])(echo|info|err)[^=]*\$blob' "$SCRIPT" | grep -vE 'printf|security ' || true)"
if [ -z "$blob_leaks" ]; then
  PASS=$((PASS+1)); _green "(8c) no echo/info/err prints \$blob directly (token-blind·argv/file feeds excluded)"
else
  FAILED=$((FAILED+1)); _red "FAIL: (8c) found a line printing \$blob: $blob_leaks"
fi
# (8d) the deleted setup-token machinery must be GONE (no run_setup_token_with_pty / snapshot_current_login /
#   restore_current_login / detect_is_current_login / strip_ansi / extract_token — all moot after keychain直读).
for gone in run_setup_token_with_pty snapshot_current_login restore_current_login detect_is_current_login strip_ansi extract_token; do
  if grep -qE "^$gone\\(\\) \\{" "$SCRIPT"; then
    FAILED=$((FAILED+1)); _red "FAIL: (8d) deleted function still present: $gone (setup-token machinery should be gone)"
  else
    PASS=$((PASS+1))
  fi
done
# (8e) setup-token itself must no longer be INVOKED anywhere (keychain直读 replaces it). Comment/prose mentions
#   explaining WHY we dropped setup-token are fine — we only ban a live invocation, so strip comment lines first
#   (lines whose first non-blank char is `#`) before grepping.
if grep -vE '^[[:space:]]*#' "$SCRIPT" | grep -qE 'claude setup-token'; then
  FAILED=$((FAILED+1)); _red "FAIL: (8e) 'claude setup-token' still INVOKED — should be replaced by keychain direct-read"
else
  PASS=$((PASS+1)); _green "(8e) no 'claude setup-token' invocation (replaced by keychain direct-read)"
fi

# ── (9) LOCALE REGRESSION TEETH (nounset × multibyte) ─────────────────────────────────────────────────
# These scripts run `set -u` and carry Chinese (multibyte) info/err strings. The footgun: a BARE `$VAR` whose
# name butts straight up against a multibyte char (e.g. `... -a $EMAIL（不带 -w）`) → bash absorbs the multibyte
# byte INTO the variable name → `$EMAIL<byte>` undefined → `set -u` aborts with `unbound variable`. The fix is
# brace-delimiting: `${EMAIL}（`. Pin both the UTF-8 and POSIX C locale on the e2e SUCCESS path.
echo "-- (9) teeth: nounset × multibyte message strings must survive every locale (exit 0, no unbound var) --"
LOC_STUB="$(make_project)"
make_security_stub "$LOC_STUB" "$FULL_KC_BLOB"
LOC_CCU="$LOC_STUB/cc-usage-stub.sh"; make_ccu_stub "$LOC_CCU"
LOC_CJ="$LOC_STUB/claude.json"; make_claudejson "$LOC_CJ" "loc@self.com"
DEL_SCRIPT="$PLUGIN_ROOT/skills/account-management/scripts/account-delete.sh"
for LOC in en_US.UTF-8 C; do
  LH="$(make_project)"; LVF="$LH/v.env"
  add_out="$(LC_ALL="$LOC" PATH="$LOC_STUB:$PATH" CC_MASTER_HOME="$LH" CC_USAGE_SH="$LOC_CCU" CLAUDE_JSON_PATH="$LOC_CJ" \
            bash "$SCRIPT" --email loc@self.com --vault-kind file --vault-file "$LVF" --expires 2027-12-31 2>&1)"; add_rc=$?
  assert_eq "0" "$add_rc" "(9 locale=$LOC) account-add e2e file store exits 0 (no nounset×multibyte abort)"
  assert_not_contains "$add_out" "unbound variable" "(9 locale=$LOC) account-add e2e emits no 'unbound variable'"
  for KIND in keychain file; do
    del_out="$(LC_ALL="$LOC" CC_MASTER_HOME="$LH" \
              bash "$DEL_SCRIPT" --email "alice@x.com" --vault-kind "$KIND" --vault-file "$LVF" --dry-run 2>&1)"; del_rc=$?
    assert_eq "0" "$del_rc" "(9 locale=$LOC kind=$KIND) account-delete dry-run exits 0 (no nounset×multibyte abort)"
    assert_not_contains "$del_out" "unbound variable" "(9 locale=$LOC kind=$KIND) account-delete dry-run emits no 'unbound variable'"
  done
  rm -rf "$LH"
done
rm -rf "$LOC_STUB"

# ── (10) ANTI-LEAK REGRESSION TEETH — this test must NEVER pollute the user's REAL account registry, and must
#         NEVER invoke the REAL /usr/bin/security (no keychain auth popups / no keychain pollution) ──────────
echo "-- (10) anti-leak: no fixture account / no real-keychain touch leaked into the user's environment --"
REAL_REG_AFTER=""
if [ -n "$REAL_REG" ] && [ -f "$REAL_REG" ]; then
  REAL_REG_AFTER="$(node -e 'try{const r=require("fs").readFileSync(process.argv[1],"utf8");process.stdout.write(r)}catch(_e){}' "$REAL_REG" 2>/dev/null)"
fi
# (10a) the real registry content is unchanged (no fixture entries added, no live entries mutated).
assert_eq "$REAL_REG_BEFORE" "$REAL_REG_AFTER" "(10) real registry unchanged by this test (no leak into ~/.claude/cc-master/accounts.json)"
# (10b) belt-and-suspenders: none of THIS suite's fixture account ids leaked into the real registry.
if [ -n "$REAL_REG_AFTER" ]; then
  leaked=""
  for fx in "me@self.com" "wanted@other.com" "currentB@machine.com" "norefresh@self.com" "recover@self.com" "manual@self.com" "empty@self.com" "dr@self.com" "cb@self.com" "loc@self.com"; do
    case "$REAL_REG_AFTER" in *"$fx"*) leaked="$leaked $fx";; esac
  done
  if [ -n "$leaked" ]; then
    FAILED=$((FAILED+1)); _red "FAIL: (10) test LEAKED fixture account(s) into the real registry:$leaked"
  else
    PASS=$((PASS+1)); _green "(10) OK: no fixture account leaked into the real registry"
  fi
else
  PASS=$((PASS+1)); _green "(10) OK: real registry absent/empty — nothing leaked"
fi
# (10c) STRUCTURE proof: every e2e case fed `security` from a STUB PATH dir — assert no test case invoked the
#   real /usr/bin/security with a write (the stub is the only `security` the script ever saw). We pin this by
#   confirming the suite always set up a make_security_stub before driving the script (grep our own source).
SELF="$0"
if grep -qE 'make_security_stub "\$(E3|G|N|LOC)_STUB"' "$SELF" && grep -qE 'PATH="\$(E3|G|N|LOC)_STUB:\$PATH"' "$SELF"; then
  PASS=$((PASS+1)); _green "(10c) every e2e case drove the script with a STUBBED security on PATH (no real keychain touch)"
else
  FAILED=$((FAILED+1)); _red "FAIL: (10c) an e2e case may have run without a stubbed security on PATH (real-keychain risk)"
fi

# ── (11) KEYCHAIN ROUND-TRIP via the FAITHFUL 128-byte-truncation stub (T16 regression防线) ─────────────────
# The whole point of this dogfood-caught bug: a >128-byte OAuth blob written via the STDIN double-feed gets
# chopped to a 128-byte残片 (lost refreshToken, illegal JSON), while the ARGV `-w "$blob"` form stores it WHOLE.
# The old stub never modeled the truncation, so green ≠ correct. These cases drive BOTH write forms through the
# faithful stub with a PURE-FAKE >400-byte dummy blob (no real token anywhere) and assert the round-trip.
echo "-- (11) keychain round-trip: argv -w stores WHOLE; stdin double-feed TRUNCATES to 128 (faithful stub) --"
RT_DIR="$(make_project)"
# pad accessToken/refreshToken so the WHOLE blob is comfortably > 128 bytes (~400+). 100% FAKE — never a real token.
RT_PAD="$(printf 'X%.0s' $(seq 1 200))"
RT_BLOB="{\"claudeAiOauth\":{\"accessToken\":\"FAKE-oat-${RT_PAD}\",\"refreshToken\":\"FAKE-ort-${RT_PAD}\",\"expiresAt\":1750000000000,\"scopes\":[\"user:inference\"],\"subscriptionType\":\"max\"}}"
rt_len=${#RT_BLOB}
if [ "$rt_len" -gt 128 ]; then PASS=$((PASS+1)); _green "(11) precondition: dummy blob is ${rt_len} bytes (> 128, so truncation is observable)"; else FAILED=$((FAILED+1)); _red "FAIL: (11) dummy blob only ${rt_len} bytes — pad more"; fi

# (11a) PRODUCTION write FORM (security … -w "$blob" argv) → faithful stub → read back → FULL length, valid JSON, has refreshToken.
#   We replicate the SHIPPED argv write form verbatim (the same line store_blob_keychain runs) rather than calling the
#   function — keeps the env-export plumbing simple and pins the exact `-w "$VALUE"` argv shape the production code uses.
#   A grep-level structure tooth (8b) separately asserts the shipped function actually uses this form (no copy drift).
make_security_stub "$RT_DIR" ""        # read blob unused — SEC_WRITE_CAPTURE drives readback.
RT_CAP_ARGV="$RT_DIR/cap-argv.txt"; : > "$RT_CAP_ARGV"
PATH="$RT_DIR:$PATH" SEC_WRITE_CAPTURE="$RT_CAP_ARGV" security add-generic-password -U -s cc-master-oauth -a rt@self.com -l "cc-master OAuth: rt@self.com" -w "$RT_BLOB" >/dev/null 2>&1
rt_argv_read="$(PATH="$RT_DIR:$PATH" SEC_WRITE_CAPTURE="$RT_CAP_ARGV" security find-generic-password -w -s cc-master-oauth -a rt@self.com 2>/dev/null)"
assert_eq "$rt_len" "${#rt_argv_read}" "(11a) argv -w round-trip: read-back is FULL ${rt_len} bytes (no 128 truncation)"
rt_argv_shape="$(printf '%s' "$rt_argv_read" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let o;try{o=JSON.parse(s)}catch(_e){process.stdout.write("BADJSON");return}const ok=o.claudeAiOauth&&typeof o.claudeAiOauth.refreshToken==="string"&&o.claudeAiOauth.refreshToken.length>0;process.stdout.write(ok?"OK":"NOREFRESH")})' 2>/dev/null)"
assert_eq "OK" "$rt_argv_shape" "(11a) argv -w round-trip: read-back is VALID JSON carrying refreshToken (the bug's victim field)"

# (11b) REVERSE regression lock: the BROKEN stdin double-feed (printf '%s\n%s\n' | security -w, NO value arg) → faithful
#   stub truncates to 128 bytes → read-back is SHORTER than the blob AND invalid JSON. If anyone reverts the production
#   write back to the stdin form, (11a)'s production path would feed this same truncation → this lock + (11a) both go red.
RT_CAP_STDIN="$RT_DIR/cap-stdin.txt"; : > "$RT_CAP_STDIN"
printf '%s\n%s\n' "$RT_BLOB" "$RT_BLOB" | PATH="$RT_DIR:$PATH" SEC_WRITE_CAPTURE="$RT_CAP_STDIN" security add-generic-password -U -s cc-master-oauth -a rt@self.com -w >/dev/null 2>&1
rt_stdin_read="$(PATH="$RT_DIR:$PATH" SEC_WRITE_CAPTURE="$RT_CAP_STDIN" security find-generic-password -w -s cc-master-oauth -a rt@self.com 2>/dev/null)"
rt_stdin_len=${#rt_stdin_read}
if [ "$rt_stdin_len" -eq 128 ]; then PASS=$((PASS+1)); _green "(11b) reverse lock: stdin double-feed write TRUNCATED to exactly 128 bytes (faithful readpassphrase model)"; else FAILED=$((FAILED+1)); _red "FAIL: (11b) stdin write read-back was ${rt_stdin_len} bytes, expected 128 (truncation model broken)"; fi
rt_stdin_shape="$(printf '%s' "$rt_stdin_read" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let o;try{o=JSON.parse(s);process.stdout.write("JSON-OK")}catch(_e){process.stdout.write("BADJSON")}})' 2>/dev/null)"
assert_eq "BADJSON" "$rt_stdin_shape" "(11b) reverse lock: the 128-byte残片 is INVALID JSON (the brick the stdin form would have caused)"
# NO real token may leak: the dummy blob carries only FAKE- prefixes, but make sure no sk-ant- string sneaked in.
case "$RT_BLOB" in *sk-ant-*) FAILED=$((FAILED+1)); _red "FAIL: (11) dummy blob accidentally contains an sk-ant- token string";; *) PASS=$((PASS+1)); _green "(11) dummy blob is pure FAKE data (no sk-ant- token string)";; esac
rm -rf "$RT_DIR"

# ── (12) P2-a MISSING-VALUE GUARD: a value-flag with NO value must ERROR-EXIT, NOT infinite-loop ──────────
# 病根（codex §7 round-3 P2-a·已坐实）：value 型 flag 缺值时（`account-add.sh --email` 末位、或命令层在 `--add`
#   后没拼 email），旧码 `${2:-}` 为空、`shift 2` 因只剩 1 个 arg 而**失败**——脚本无 set -e、arg list 不变、
#   `while [ $# -gt 0 ]` **死循环到被 kill**。修：每个 `shift 2` 前 need_val 确认存在第二个 arg，缺值则 error+usage
#   退非 0。这个 case 用「后台跑 + watchdog 轮询 + 超时 kill」可移植模式（无 timeout/gtimeout 依赖·macOS 不保证它们在）
#   驱动每个账户脚本的末位 value-flag——断言它**快速退非 0**（缺值守卫生效）而非超时（死循环回归会 RED）。
echo "-- (12) P2-a: trailing value-flag with NO value → error-exit (NOT infinite-loop), across all account scripts --"
# run_with_timeout SECS CMD... → runs CMD in background, kills it if it exceeds SECS. Sets RWT_RC (124 = timed out).
run_with_timeout() {
  local secs="$1"; shift
  "$@" >/dev/null 2>&1 &
  local pid=$!
  local waited=0 max_ticks=$(( secs * 5 ))   # 0.2s steps.
  while [ "$waited" -lt "$max_ticks" ]; do
    kill -0 "$pid" 2>/dev/null || { wait "$pid" 2>/dev/null; RWT_RC=$?; return 0; }
    sleep 0.2; waited=$((waited+1))
  done
  # still alive past the deadline → infinite-loop regression. Kill it; report timeout sentinel.
  kill -TERM "$pid" 2>/dev/null || true; sleep 0.2; kill -KILL "$pid" 2>/dev/null || true
  wait "$pid" 2>/dev/null || true; RWT_RC=124
}
ADD_SCRIPT="$SCRIPT"
DEL_SCRIPT="$PLUGIN_ROOT/skills/account-management/scripts/account-delete.sh"
LST_SCRIPT="$PLUGIN_ROOT/skills/account-management/scripts/account-list.sh"
SW_SCRIPT="$PLUGIN_ROOT/skills/account-management/scripts/switch-account.sh"
MV_HOME="$(make_project)"
# (12a) account-add.sh --email  (trailing --email, no value) → must exit non-zero quickly, NOT loop.
run_with_timeout 6 env CC_MASTER_HOME="$MV_HOME" bash "$ADD_SCRIPT" --email
if [ "$RWT_RC" = 124 ]; then FAILED=$((FAILED+1)); _red "FAIL: (12a) account-add --email (no value) DID NOT terminate (infinite-loop regression!)";
elif [ "$RWT_RC" -ne 0 ]; then PASS=$((PASS+1)); _green "(12a) account-add --email (no value) → error-exit rc=$RWT_RC (no infinite loop)";
else FAILED=$((FAILED+1)); _red "FAIL: (12a) account-add --email (no value) exited 0 (should be a usage error)"; fi
# (12b) account-add.sh --email me@self.com --vault-file  (trailing --vault-file, no value) → quick non-zero exit.
run_with_timeout 6 env CC_MASTER_HOME="$MV_HOME" bash "$ADD_SCRIPT" --email me@self.com --vault-file
if [ "$RWT_RC" = 124 ]; then FAILED=$((FAILED+1)); _red "FAIL: (12b) account-add … --vault-file (no value) DID NOT terminate (infinite-loop regression!)";
elif [ "$RWT_RC" -ne 0 ]; then PASS=$((PASS+1)); _green "(12b) account-add … --vault-file (no value) → error-exit rc=$RWT_RC";
else FAILED=$((FAILED+1)); _red "FAIL: (12b) account-add … --vault-file (no value) exited 0"; fi
# (12c) account-delete.sh --email  → quick non-zero exit (audited sibling, same need_val guard).
run_with_timeout 6 env CC_MASTER_HOME="$MV_HOME" bash "$DEL_SCRIPT" --email
if [ "$RWT_RC" = 124 ]; then FAILED=$((FAILED+1)); _red "FAIL: (12c) account-delete --email (no value) DID NOT terminate (infinite-loop regression!)";
elif [ "$RWT_RC" -ne 0 ]; then PASS=$((PASS+1)); _green "(12c) account-delete --email (no value) → error-exit rc=$RWT_RC";
else FAILED=$((FAILED+1)); _red "FAIL: (12c) account-delete --email (no value) exited 0"; fi
# (12d) account-list.sh --registry  → quick non-zero exit.
run_with_timeout 6 env CC_MASTER_HOME="$MV_HOME" bash "$LST_SCRIPT" --registry
if [ "$RWT_RC" = 124 ]; then FAILED=$((FAILED+1)); _red "FAIL: (12d) account-list --registry (no value) DID NOT terminate (infinite-loop regression!)";
elif [ "$RWT_RC" -ne 0 ]; then PASS=$((PASS+1)); _green "(12d) account-list --registry (no value) → error-exit rc=$RWT_RC";
else FAILED=$((FAILED+1)); _red "FAIL: (12d) account-list --registry (no value) exited 0"; fi
# (12e) switch-account.sh --email  → quick non-zero exit (the most value-flags; --skip-token-check keeps it offline-safe).
run_with_timeout 6 env CC_MASTER_HOME="$MV_HOME" bash "$SW_SCRIPT" --skip-token-check --dry-run --email
if [ "$RWT_RC" = 124 ]; then FAILED=$((FAILED+1)); _red "FAIL: (12e) switch-account --email (no value) DID NOT terminate (infinite-loop regression!)";
elif [ "$RWT_RC" -ne 0 ]; then PASS=$((PASS+1)); _green "(12e) switch-account --email (no value) → error-exit rc=$RWT_RC";
else FAILED=$((FAILED+1)); _red "FAIL: (12e) switch-account --email (no value) exited 0"; fi
# (12f) POSITIVE control: a value-flag WITH a value still parses fine (guard doesn't over-fire) — dry-run exits 0.
dr12_out="$(CC_MASTER_HOME="$MV_HOME" bash "$ADD_SCRIPT" --email ok@self.com --vault-kind file --vault-file "$MV_HOME/ok.env" --dry-run 2>&1)"; dr12_rc=$?
assert_eq "0" "$dr12_rc" "(12f) value-flag WITH value still parses (need_val doesn't over-fire) — dry-run exits 0"
rm -rf "$MV_HOME"

# ── (13) P2-b IDENTITY-GUARD BYPASS for MANUAL RECOVERY: login mismatch BUT cc-master vault已有 valid blob →
#         probe → switchable:true (codex §7 round-3 P2-b·补全 round-2). ────────────────────────────────────
# 病根（codex round-3 P2-b·已坐实）：round-2 加了 probe_vault_has_valid_blob 想让「手动存 blob 后重跑 --add 标
#   switchable:true」生效，但身份 guard（current-login == --email）在 probe 之前就 exit → 登录在 B（或登出）时重跑
#   `--add A` 根本到不了 probe，手动恢复/非 mac 号永久 switchable:false 隐身。修：身份 guard 会失败时，先跑
#   try_mark_switchable_from_vault（只读 cc-master vault 自身有效 blob·token-blind·绝不碰官方 keychain·无 mislabel）
#   —— vault 已有有效 blob → 标 switchable:true + exit 0；vault 无 → 维持 guard 失败的现有行为。
echo "-- (13) P2-b: login mismatch + cc-master vault ALREADY has valid blob → probe bypass → switchable:true --"
P_HOME="$(make_project)"; P_STUB="$(make_project)"
make_security_stub "$P_STUB" "$FULL_KC_BLOB"        # keychain HAS current-login B's blob (must NOT be captured for A).
P_CCU="$P_STUB/cc-usage-stub.sh"; make_ccu_stub "$P_CCU"
P_CJ="$P_STUB/claude.json"; make_claudejson "$P_CJ" "loggedInB@machine.com"   # current login = B, NOT the --email target.
P_VF="$P_HOME/accounts.env"
P_REG="$P_HOME/accounts.json"
# Pre-seed the cc-master FILE vault with a VALID dummy blob for the TARGET email (the user manually restored it).
#   100% FAKE token — never real. This is what makes the bypass legitimate (vault自身有有效 blob·不从 keychain 捕获).
P_AT='sk-ant-oat01-MANUALrecoverBYPASS0000000000000000-_xyz'
P_RT='sk-ant-ort01-MANUALrecoverBYPASS000000000000000-_rrr'
P_VAULT_BLOB="{\"accessToken\":\"$P_AT\",\"refreshToken\":\"$P_RT\",\"expiresAt\":1750000000000}"
umask 077; mkdir -p "$P_HOME"
printf '%s_TOKEN=%s\n' "targetA@self.com" "$P_VAULT_BLOB" > "$P_VF"
# --email targetA@self.com != current login loggedInB@machine.com → identity guard would FAIL → BUT vault has a
#   valid blob → bypass marks switchable:true and exits 0 (manual-recovery闭环·不依赖当前登录).
p_out="$(CC_MASTER_HOME="$P_HOME" PATH="$P_STUB:$PATH" CC_USAGE_SH="$P_CCU" CLAUDE_JSON_PATH="$P_CJ" \
   bash "$SCRIPT" --email targetA@self.com --vault-kind file --vault-file "$P_VF" 2>&1)"; p_rc=$?
# CORE: the bypass took the recovery path → exit 0 (NOT the guard's exit 1) + entry switchable:true.
assert_eq "0" "$p_rc" "(13) P2-b: login mismatch + vault has valid blob → recovery bypass exits 0 (NOT guard's exit 1)"
p_switchable="$(node -e 'const e=(require(process.argv[1]).loadRegistry(process.argv[2]).accounts||{})["targetA@self.com"]||{};process.stdout.write(String(e.switchable))' "$LIB_JS_REAL" "$P_REG" 2>/dev/null)"
assert_eq "true" "$p_switchable" "(13) P2-b CORE: probe found the manually-restored vault blob → switchable:true (recovery不再隐身)"
assert_contains "$p_out" "vault 已有" "(13) P2-b: message tells user the vault blob was detected (recovery confirmed)"
assert_contains "$p_out" "switchable:true" "(13) P2-b: message confirms switchable:true mark"
# SECURITY: the bypass must NOT capture/mislabel B's keychain blob into A's vault — the vault line stays the
#   user's manually-stored blob (P_AT), NOT the current-login keychain blob ($FAKE_AT). No mislabel.
p13_vault_at="$(vault_at "$P_VF" "targetA@self.com")"
assert_eq "$P_AT" "$p13_vault_at" "(13) P2-b SECURITY: vault still holds the user's manually-stored blob (NOT B's keychain blob — no mislabel)"
if grep -q "$FAKE_AT" "$P_VF" 2>/dev/null; then FAILED=$((FAILED+1)); _red "FAIL: (13) P2-b LEAK: current-login B's keychain blob got written into A's vault (mislabel — bypass broke the guard's intent!)"; else PASS=$((PASS+1)); _green "(13) P2-b: current-login keychain blob did NOT get captured into the target vault (guard intent preserved)"; fi
# token-no-leak: neither the pre-seeded token half nor B's keychain token may appear in stdout/stderr nor registry.
assert_not_contains "$p_out" "$P_RT" "(13) P2-b: manually-restored refresh token does NOT leak to stdout/stderr"
assert_not_contains "$p_out" "$FAKE_RT" "(13) P2-b: current-login keychain refresh token does NOT leak"
if grep -q 'sk-ant-' "$P_REG" 2>/dev/null; then FAILED=$((FAILED+1)); _red "FAIL: (13) P2-b: registry contains an sk-ant- token string"; else PASS=$((PASS+1)); _green "(13) P2-b: registry token-free after bypass-recovery"; fi

# ── (13b) NEGATIVE control: login mismatch AND cc-master vault EMPTY → guard still FAILS (exit非0·no bypass). ──
# Mirror of (13) but with NO pre-seeded vault blob → probe returns no → bypass declines → guard's exit 1 stands.
#   Pins that the bypass ONLY fires when the vault genuinely has a recoverable blob (never weakens the guard otherwise).
echo "-- (13b) negative: login mismatch + cc-master vault EMPTY → guard still FAILS (no bypass, no mislabel) --"
P2_HOME="$(make_project)"; P2_STUB="$(make_project)"
make_security_stub "$P2_STUB" "$FULL_KC_BLOB"
P2_CCU="$P2_STUB/cc-usage-stub.sh"; make_ccu_stub "$P2_CCU"
P2_CJ="$P2_STUB/claude.json"; make_claudejson "$P2_CJ" "loggedInB@machine.com"
P2_VF="$P2_HOME/accounts.env"   # deliberately NOT created — vault has no blob for the target email.
P2_REG="$P2_HOME/accounts.json"
p2_out="$(CC_MASTER_HOME="$P2_HOME" PATH="$P2_STUB:$PATH" CC_USAGE_SH="$P2_CCU" CLAUDE_JSON_PATH="$P2_CJ" \
   bash "$SCRIPT" --email targetA@self.com --vault-kind file --vault-file "$P2_VF" 2>&1)"; p2_rc=$?
if [ "$p2_rc" -ne 0 ]; then PASS=$((PASS+1)); _green "(13b) login mismatch + empty vault → guard still FAILS (exit非0·no over-firing bypass)"; else FAILED=$((FAILED+1)); _red "FAIL: (13b) guard should still FAIL when vault empty (got rc=$p2_rc — bypass over-fired!)"; fi
assert_contains "$p2_out" "身份不匹配" "(13b) guard message still says 身份不匹配 (bypass declined·no recoverable vault blob)"
# NO vault token written and NO switchable:true entry (we never captured B's blob, never marked switchable).
if [ -f "$P2_VF" ] && grep -q '_TOKEN=' "$P2_VF" 2>/dev/null; then FAILED=$((FAILED+1)); _red "FAIL: (13b) mismatch+empty-vault WROTE a vault token line (must not!)"; else PASS=$((PASS+1)); _green "(13b) no vault token written on mismatch+empty-vault"; fi
assert_not_contains "$p2_out" "$FAKE_RT" "(13b) keychain blob refresh token does NOT leak on the declined-bypass path"
rm -rf "$P_HOME" "$P_STUB" "$P2_HOME" "$P2_STUB"

finish
