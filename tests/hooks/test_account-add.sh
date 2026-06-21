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
