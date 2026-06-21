#!/usr/bin/env bash
# Tests for switch-account.sh —— **无重启换号（no-restart credential overwrite）** 重构后的换号机制。
#
# switch-account.sh 是 out-of-band 脚本（NOT a hook）——主线在 pacing 决策点 deliberately 跑它换号，凭证全程
# 只活在脚本子进程 / vault / refresh POST body / 三存储写，绝不进 agent / registry / argv。
#
# ★无重启换号（设计审查已过）：换号不再 exec claude / 不重启进程，而是覆写官方共享凭证三存储（$USER 视角）——
#   运行中的 claude 在 access token 临近过期时惰性 refresh、重读被覆写的存储 → 新号接管。下半身流程（全 token-blind）：
#     ① 从 vault 读完整 claudeAiOauth blob（含 refresh token）；② node https 主动 refresh（refresh token 放 POST
#     body·不进 argv）；③ 回写 cc-master vault 保 refresh token 新鲜；④ 覆写官方三存储（① credentials.json
#     .claudeAiOauth ② ~/.claude.json oauthAccount ③ keychain "Claude Code-credentials"/$USER·先非权威后权威·原子写）；
#     ⑤ snapshot + setActive（覆写成功后才翻 registry active·P2-2 解耦）。
#
# 本测试 hermetic：无真 token（fake `sk-ant-oat01-…`/`sk-ant-ort01-…` 占位）、无真网络（stub oauth endpoint）、
#   无真 keychain（stub `security` no-op）、isolated 官方三存储（CRED_PATH/CLAUDE_JSON_PATH env 覆写到临时文件、
#   keychain ③ 经 stub security 拦）。回归：选号集成 / 主动 refresh + vault 轮转回写 / 覆写三存储 / refresh 失败
#   分流（oauth 失效硬失败 vs 网络不通 force-refresh 兜底）/ token no-leak / P2-1/P2-2 解耦。
. "$(dirname "$0")/helpers.sh"

SCRIPT="$PLUGIN_ROOT/skills/account-management/scripts/switch-account.sh"
LIB_JS="$PLUGIN_ROOT/skills/account-management/scripts/accounts-lib.js"
SELECT_JS="$PLUGIN_ROOT/skills/account-management/scripts/select-account.js"

echo "== switch-account.sh 无重启换号: 选号 + 主动 refresh + 覆写三存储 + vault 轮转 + token no-leak =="

assert_file "$SCRIPT" "switch-account.sh exists"
assert_file "$LIB_JS" "accounts-lib.js exists (cross-skill dep)"
assert_file "$SELECT_JS" "select-account.js exists (cross-skill dep)"

# bash -n syntax gate (regression for the CJK-after-$VAR unbound-var footgun).
if bash -n "$SCRIPT" 2>/dev/null; then PASS=$((PASS+1)); else FAILED=$((FAILED+1)); _red "FAIL: switch-account.sh bash -n syntax error"; fi

# Fake (NON-REAL) OAuth blob tokens — sk-ant-oat/ort prefixes, well-formed-looking, NOT real credentials.
ALICE_AT='sk-ant-oat01-ALICEoldACCESS000000000000000000000aaaaaa-_aaa'
ALICE_RT='sk-ant-ort01-ALICErefresh00000000000000000000000aaaaaa-_aaa'
FRESH_AT='sk-ant-oat01-FRESHaccessNEW00000000000000000000fffff-_fff'
FRESH_RT='sk-ant-ort01-FRESHrefreshNEW0000000000000000000fffff-_fff'
DECOY_TOK='sk-ant-oat01-DECOYsubstringtrap00000000000000000000ddddddd-_ddd'

# ── a stub `security` (no-op success) so keychore writes ③ never touch the REAL keychain. ──
SECSTUB="$(make_project)"
cat > "$SECSTUB/security" <<'SEC'
#!/usr/bin/env bash
# stub security: consume stdin (blob piped in), succeed without touching the real keychain.
cat >/dev/null 2>&1
exit 0
SEC
chmod +x "$SECSTUB/security"

# ── a stub `security` that CAPTURES the value written to "Claude Code-credentials" into $SEC_CAPTURE_FILE. ──
#   Used by (5d) to inspect the ③ keychain write SHAPE: `add-generic-password ... -w "<value>"` passes the value
#   as an ARGV positional (用户拍板抉择 A·128-byte fix — the value MUST be argv, not stdin, or readpassphrase's
#   128-byte cap truncates the wrapped blob into a brick). We capture the ARGV value to a file so the test can assert
#   it's a {"claudeAiOauth":{...}} WRAPPED object (claude's official format) and NOT the flat {accessToken,...} blob
#   (the P1 bug). Service-scoped so only the official-entry ③ write is captured (cc-master vault writes use a
#   different service name → not captured here). Still consumes stdin so a piped-in form never blocks.
SECSTUB_CAPTURE="$(make_project)"
cat > "$SECSTUB_CAPTURE/security" <<'SEC'
#!/usr/bin/env bash
# stub security: on `add-generic-password` for service "Claude Code-credentials", capture the `-w <value>` ARGV
# positional to $SEC_CAPTURE_FILE; always succeed. Consume any stdin so a piped form never blocks the pipe.
cat >/dev/null 2>&1
is_add=0; is_official=0; wval=""; have_wval=0; prev=""
for a in "$@"; do
  [ "$a" = "add-generic-password" ] && is_add=1
  [ "$prev" = "-s" ] && [ "$a" = "Claude Code-credentials" ] && is_official=1
  [ "$prev" = "-w" ] && { wval="$a"; have_wval=1; }
  prev="$a"
done
if [ "$is_add" = "1" ] && [ "$is_official" = "1" ] && [ "$have_wval" = "1" ] && [ -n "${SEC_CAPTURE_FILE:-}" ]; then
  printf '%s' "$wval" > "$SEC_CAPTURE_FILE"
fi
exit 0
SEC
chmod +x "$SECSTUB_CAPTURE/security"

# ── a stub `security` that FAILS on `add-generic-password` (③ keychain overwrite) but succeeds otherwise. ──
#   Used by (5c) to simulate ③ keychain failure AFTER ①② already wrote the new account → exercise the all-or-
#   nothing rollback (P2-C). `command -v security` still resolves (stub on PATH), but the write returns非0.
SECSTUB_FAIL="$(make_project)"
cat > "$SECSTUB_FAIL/security" <<'SEC'
#!/usr/bin/env bash
# stub security: fail specifically on add-generic-password (the ③ keychain overwrite); consume stdin first.
cat >/dev/null 2>&1
for a in "$@"; do
  if [ "$a" = "add-generic-password" ]; then exit 1; fi
done
exit 0
SEC
chmod +x "$SECSTUB_FAIL/security"

# ── start_refresh_endpoint MODE PORTFILE → starts a node http stub oauth endpoint, writes its URL to PORTFILE.
#   MODE=ok → returns a fresh access/refresh token; MODE=401 → returns HTTP 401 (refresh token invalid).
#   Echoes the bg PID (caller kills it). The fresh tokens are FRESH_AT/FRESH_RT (fake).
ENDPOINT_PIDS=()
start_refresh_endpoint() {
  local mode="$1" portfile="$2"
  node -e '
    const http = require("http");
    const mode = process.argv[1];
    const fresh_at = process.argv[2], fresh_rt = process.argv[3];
    const s = http.createServer((req, res) => {
      let b = ""; req.on("data", d => b += d).on("end", () => {
        if (mode === "401") { res.writeHead(401, {"Content-Type":"application/json"}); res.end("{}"); return; }
        res.writeHead(200, {"Content-Type":"application/json"});
        res.end(JSON.stringify({ access_token: fresh_at, expires_in: 28800, refresh_token: fresh_rt, scope: "user:inference user:profile" }));
      });
    });
    s.listen(0, () => { require("fs").writeFileSync(process.argv[4], "http://127.0.0.1:" + s.address().port + "/v1/oauth/token"); });
    setTimeout(() => process.exit(0), 20000); // self-reap so a leaked test never hangs the suite.
  ' "$mode" "$FRESH_AT" "$FRESH_RT" "$portfile" 2>/dev/null &
  local pid=$!
  ENDPOINT_PIDS+=("$pid")
  disown "$pid" 2>/dev/null || true   # detach from job table so kill doesn't print a "Terminated" line.
  # wait for the URL file to appear (endpoint bound).
  local i=0
  while [ ! -s "$portfile" ] && [ "$i" -lt 50 ]; do sleep 0.1; i=$((i+1)); done
}

make_fixture() { make_project; }

# ──────────────────────────────────────────────────────────────────────────────────────────────────
# (1) 选号集成：自动选号 dry-run 选出最优切入号（alice 低用量 > carol 高用量；bob active 跳过）。
# ──────────────────────────────────────────────────────────────────────────────────────────────────
FX1="$(make_fixture)"; REG1="$FX1/accounts.json"
cat > "$REG1" <<JSON
{ "schema": "cc-master/accounts/v1", "accounts": {
  "bob@y.com":   { "vault": {"kind":"keychain","service":"cc-master-oauth","account":"bob@y.com"}, "active": true, "last_switch_out": null },
  "alice@x.com": { "vault": {"kind":"keychain","service":"cc-master-oauth","account":"alice@x.com"}, "token_expires_at":"2027-06-17T10:40:00Z", "active": false,
                   "last_switch_out": {"at":"2026-06-17T05:00:00Z","5h":{"used_pct":20,"resets_at":"2026-06-17T10:00:00Z","source":"account"},"7d":{"used_pct":30,"resets_at":"2026-06-24T05:00:00Z","source":"account"}} },
  "carol@z.io":  { "vault": {"kind":"keychain","service":"cc-master-oauth","account":"carol@z.io"}, "token_expires_at":"2027-06-17T10:40:00Z", "active": false,
                   "last_switch_out": {"at":"2026-06-17T05:00:00Z","5h":{"used_pct":90,"resets_at":"2026-06-17T11:00:00Z","source":"account"},"7d":{"used_pct":80,"resets_at":"2026-06-24T05:00:00Z","source":"account"}} }
} }
JSON
out1="$(CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" bash "$SCRIPT" --registry "$REG1" --now "2026-06-17T09:00:00Z" --dry-run --skip-token-check 2>&1)"; rc1=$?
assert_eq "0" "$rc1" "(1) auto-select dry-run exits 0"
assert_contains "$out1" "select-account.js → alice@x.com" "(1) auto-select picks alice (low used%, bob active skipped, carol higher)"
assert_contains "$out1" "WOULD recordSwitchOut for bob@y.com" "(1) plan records switch-out for the active account bob"
assert_contains "$out1" "would overwrite" "(1) plan describes overwriting the 3 official stores (no-restart switch)"

# ──────────────────────────────────────────────────────────────────────────────────────────────────
# (1b) **P2-14 teeth — 选号成功时 select-account.js 的 stderr 警告必须透传给用户（绝不 2>/dev/null 吞掉）**.
# ──────────────────────────────────────────────────────────────────────────────────────────────────
FX1B="$(make_fixture)"; REG1B="$FX1B/accounts.json"
cat > "$REG1B" <<JSON
{ "schema": "cc-master/accounts/v1", "accounts": {
  "bob@y.com":   { "vault": {"kind":"keychain","service":"cc-master-oauth","account":"bob@y.com"}, "active": true, "last_switch_out": null },
  "alice@x.com": { "vault": {"kind":"keychain","service":"cc-master-oauth","account":"alice@x.com"}, "token_expires_at":"2026-06-20T10:00:00Z", "active": false, "last_switch_out": null }
} }
JSON
out1b="$(CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" bash "$SCRIPT" --registry "$REG1B" --now "2026-06-17T09:00:00Z" --dry-run --skip-token-check 2>&1)"; rc1b=$?
assert_eq "0" "$rc1b" "(1b) P2-14 near-expiry auto-select dry-run exits 0 (alice still selected, just warned)"
assert_contains "$out1b" "select-account.js → alice@x.com" "(1b) P2-14 select still picks alice (warning does NOT exclude)"
assert_contains "$out1b" "天后到期" "(1b) P2-14: select's near-expiry stderr warning is PASSED THROUGH (not swallowed by 2>/dev/null)"

# ──────────────────────────────────────────────────────────────────────────────────────────────────
# (2) 选号 exit 3：全员逼顶（7d 硬闸）→ switch surface 用户、退出码 3、绝不硬切。
# ──────────────────────────────────────────────────────────────────────────────────────────────────
FX2="$(make_fixture)"; REG2="$FX2/accounts.json"
cat > "$REG2" <<JSON
{ "schema": "cc-master/accounts/v1", "accounts": {
  "bob@y.com":   { "vault": {"kind":"keychain","service":"cc-master-oauth","account":"bob@y.com"}, "active": true, "last_switch_out": null },
  "alice@x.com": { "vault": {"kind":"keychain","service":"cc-master-oauth","account":"alice@x.com"}, "active": false,
                   "last_switch_out": {"at":"2026-06-17T05:00:00Z","5h":{"used_pct":95,"resets_at":"2026-06-17T20:00:00Z","source":"account"},"7d":{"used_pct":90,"resets_at":"2026-06-24T05:00:00Z","source":"account"}} },
  "carol@z.io":  { "vault": {"kind":"keychain","service":"cc-master-oauth","account":"carol@z.io"}, "active": false,
                   "last_switch_out": {"at":"2026-06-17T05:00:00Z","5h":{"used_pct":92,"resets_at":"2026-06-17T20:00:00Z","source":"account"},"7d":{"used_pct":88,"resets_at":"2026-06-24T05:00:00Z","source":"account"}} }
} }
JSON
out2="$(CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" bash "$SCRIPT" --registry "$REG2" --now "2026-06-17T09:00:00Z" --dry-run --skip-token-check 2>&1)"; rc2=$?
assert_eq "3" "$rc2" "(2) all-maxed → exit 3 (surface user, blocked_on:user)"
assert_contains "$out2" "未切换" "(2) all-maxed message says NOT switched"

# ──────────────────────────────────────────────────────────────────────────────────────────────────
# (3) 无候选（只有 active bob，无备号）→ exit 1，保持现状。
# ──────────────────────────────────────────────────────────────────────────────────────────────────
FX3="$(make_fixture)"; REG3="$FX3/accounts.json"
cat > "$REG3" <<'JSON'
{"schema":"cc-master/accounts/v1","accounts":{"bob@y.com":{"vault":{"kind":"keychain","service":"cc-master-oauth","account":"bob@y.com"},"active":true,"last_switch_out":null}}}
JSON
out3="$(CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" bash "$SCRIPT" --registry "$REG3" --dry-run --skip-token-check 2>&1)"; rc3=$?
assert_eq "1" "$rc3" "(3) no backup candidate → exit 1 (single-account, stay)"

# ──────────────────────────────────────────────────────────────────────────────────────────────────
# (4) **§A.4 / P2-5: file vault 取 blob 用 awk index==1 行首锚定（对 email 含 . / @ + 重叠标识免疫）**.
#     vault 放 decoy 行（裸 BRE / grep -F 会误匹配）+ 真 alice blob 行；dry-run 断言读到的 blob 长度 == 真 alice
#     blob 长度（不是 decoy、不是畸形整行）。blob 是完整 JSON，长度更长。
# ──────────────────────────────────────────────────────────────────────────────────────────────────
FX4="$(make_fixture)"; REG4="$FX4/accounts.json"; VFILE4="$FX4/accounts.env"
cat > "$REG4" <<JSON
{ "schema": "cc-master/accounts/v1", "accounts": {
  "bob@y.com":   { "vault": {"kind":"keychain","service":"cc-master-oauth","account":"bob@y.com"}, "active": true, "last_switch_out": null },
  "alice@x.com": { "vault": {"kind":"file","path":"$VFILE4","key":"alice@x.com"}, "token_expires_at":"2027-06-17T10:40:00Z", "active": false, "last_switch_out": null }
} }
JSON
ALICE_BLOB="{\"accessToken\":\"$ALICE_AT\",\"refreshToken\":\"$ALICE_RT\",\"expiresAt\":1700000000000,\"subscriptionType\":\"max\"}"
DECOY_BLOB="{\"accessToken\":\"$DECOY_TOK\",\"refreshToken\":\"sk-ant-ort01-DECOYr0000000000000000000000-_d\",\"expiresAt\":1}"
umask 077
# DECOY line first: key `xalice@x.com_TOKEN=` (starts with x, CONTAINS alice@x.com_TOKEN= as substring) — a
# buggy grep -F / BRE would grab it first.
printf 'xalice@x.com_TOKEN=%s\n' "$DECOY_BLOB" > "$VFILE4"
printf 'alice@x.com_TOKEN=%s\n'  "$ALICE_BLOB" >> "$VFILE4"
chmod 600 "$VFILE4"
out4="$(CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" bash "$SCRIPT" --registry "$REG4" --email "alice@x.com" --now "2026-06-17T09:00:00Z" --dry-run 2>&1)"; rc4=$?
assert_eq "0" "$rc4" "(4) file-vault dry-run with email key exits 0"
exp_len=${#ALICE_BLOB}
assert_contains "$out4" "长度=${exp_len}" "(4) awk index==1 read the RIGHT alice blob (len=$exp_len), not the decoy / malformed whole line"
# blob value (either) must NEVER appear in output.
assert_not_contains "$out4" "$ALICE_AT" "(4) real alice access token does NOT leak to output"
assert_not_contains "$out4" "$ALICE_RT" "(4) real alice refresh token does NOT leak to output"
assert_not_contains "$out4" "$DECOY_TOK" "(4) decoy token does NOT leak to output"

# ──────────────────────────────────────────────────────────────────────────────────────────────────
# (5) **真切（无重启换号）：主动 refresh + 回写 vault + 覆写三存储 + setActive**（hermetic·stub endpoint/security）.
#     切入 alice（file vault·有完整 blob）→ refresh（stub 返回 FRESH 凭证）→ 回写 vault（FRESH refresh token）→
#     覆写 isolated credentials.json（.claudeAiOauth 换成 FRESH·保留其它键）+ ~/.claude.json oauthAccount + keychain
#     ③（stub）→ registry alice active=true / bob active=false + bob.last_switch_out 真落盘。NO exec claude。
# ──────────────────────────────────────────────────────────────────────────────────────────────────
FX5="$(make_fixture)"; REG5="$FX5/accounts.json"; VFILE5="$FX5/accounts.env"
CRED5="$FX5/credentials.json"; CJSON5="$FX5/claude.json"
# alice carries a registry `identity` (= ~/.claude.json oauthAccount 原样·非密身份) → ② must FULLY replace oauthAccount.
cat > "$REG5" <<JSON
{ "schema": "cc-master/accounts/v1", "accounts": {
  "bob@y.com":   { "vault": {"kind":"keychain","service":"cc-master-oauth","account":"bob@y.com"}, "active": true, "last_switch_out": null },
  "alice@x.com": { "vault": {"kind":"file","path":"$VFILE5","key":"alice@x.com"}, "token_expires_at":"2027-06-17T10:40:00Z", "active": false, "last_switch_out": null, "identity": {"emailAddress":"new@y.com","accountUuid":"uuid-new","organizationName":"NewOrg","subscriptionType":"max"} }
} }
JSON
umask 077
printf 'alice@x.com_TOKEN=%s\n' "{\"accessToken\":\"$ALICE_AT\",\"refreshToken\":\"$ALICE_RT\",\"expiresAt\":1700000000000,\"subscriptionType\":\"max\"}" > "$VFILE5"
# P3 (codex §7 round-4·已坐实)：pre-seed a non-secret `_EXPIRES=` sidecar line. 病根：旧 writeback awk 用 `.prefix`
#   (`alice@x.com_`) 删**所有** `alice@x.com_` 行 → 首次换号回写就把这条 _EXPIRES sidecar 也删了 → 后续 file-vault
#   到期巡检读不到 _EXPIRES 无法告警。修后 writeback 只删 `_TOKEN=` 行 → _EXPIRES 必须存活到回写之后。
printf 'alice@x.com_EXPIRES=%s\n' "2027-12-31" >> "$VFILE5"; chmod 600 "$VFILE5"
# pre-seed isolated official stores (OLD account) — assert they get overwritten + other keys preserved.
cat > "$CRED5" <<'JSON'
{"claudeAiOauth":{"accessToken":"sk-ant-oat01-OLDcred000000000000000000000-_o","refreshToken":"sk-ant-ort01-OLDcredr0000000000000000000-_o","expiresAt":1700000000000,"subscriptionType":"pro"},"keepThisKey":"keepme"}
JSON
cat > "$CJSON5" <<'JSON'
{"oauthAccount":{"emailAddress":"old@x.com","subscriptionType":"pro","organizationName":"OldOrg"},"numStartups":42,"theme":"dark"}
JSON
# FAST cc-usage stub via a stub plugin root (the script resolves CC_USAGE_SH from CLAUDE_PLUGIN_ROOT). Without
# this, (5) invokes the REAL cc-usage.sh, which reads the live session's huge JSONL — under the new record_switch_out
# timeout (codex round#2 Finding 3) a slow real cc-usage gets KILLED → snapshot rejected → bob.last_switch_out stays
# null and this test's snapshot assertion flakes by machine. A fast deterministic stub keeps (5) hermetic + green.
STUB_ROOT5="$(make_project)"
mkdir -p "$STUB_ROOT5/skills/account-management/scripts" "$STUB_ROOT5/skills/orchestrating-to-completion/scripts"
ln -s "$PLUGIN_ROOT/skills/account-management/scripts/switch-account.sh" "$STUB_ROOT5/skills/account-management/scripts/switch-account.sh"
ln -s "$PLUGIN_ROOT/skills/account-management/scripts/accounts-lib.js"   "$STUB_ROOT5/skills/account-management/scripts/accounts-lib.js"
ln -s "$PLUGIN_ROOT/skills/account-management/scripts/select-account.js" "$STUB_ROOT5/skills/account-management/scripts/select-account.js"
cat > "$STUB_ROOT5/skills/orchestrating-to-completion/scripts/cc-usage.sh" <<'CU'
#!/usr/bin/env bash
printf '%s\n' '{"source":"account","five_hour":{"used_percentage":42,"resets_at":4102444800},"seven_day":{"used_percentage":17,"resets_at":4102444800}}'
CU
chmod +x "$STUB_ROOT5/skills/orchestrating-to-completion/scripts/cc-usage.sh"
PORT5="$FX5/url.txt"; start_refresh_endpoint ok "$PORT5"; RURL5="$(cat "$PORT5")"
out5="$(PATH="$SECSTUB:$PATH" CLAUDE_PLUGIN_ROOT="$STUB_ROOT5" REFRESH_TOKEN_URL="$RURL5" CRED_PATH="$CRED5" CLAUDE_JSON_PATH="$CJSON5" \
        bash "$STUB_ROOT5/skills/account-management/scripts/switch-account.sh" --registry "$REG5" --email "alice@x.com" --now "2026-06-17T09:00:00Z" 2>&1)"; rc5=$?
assert_eq "0" "$rc5" "(5) real no-restart switch exits 0"
assert_contains "$out5" "无重启换号完成" "(5) reports no-restart switch completed (overwrote stores, did NOT exec claude)"
assert_not_contains "$out5" "STUB-CLAUDE-EXEC-REACHED" "(5) NO exec claude happened (no-restart — process not replaced)"
# ① credentials.json overwritten with FRESH token, other top-level key preserved.
cred5_at="$(node -e 'const j=require(process.argv[1]);process.stdout.write(j.claudeAiOauth.accessToken)' "$CRED5" 2>/dev/null)"
assert_eq "$FRESH_AT" "$cred5_at" "(5) credentials.json .claudeAiOauth.accessToken overwritten with FRESH token"
cred5_keep="$(node -e 'const j=require(process.argv[1]);process.stdout.write(j.keepThisKey||"GONE")' "$CRED5" 2>/dev/null)"
assert_eq "keepme" "$cred5_keep" "(5) credentials.json other top-level key preserved (not whole-file rewrite)"
# ② ~/.claude.json oauthAccount FULLY replaced by registry identity (真切身份), other top-level keys preserved.
cj5_email="$(node -e 'const j=require(process.argv[1]);process.stdout.write(j.oauthAccount.emailAddress||"NONE")' "$CJSON5" 2>/dev/null)"
assert_eq "new@y.com" "$cj5_email" "(5) ~/.claude.json oauthAccount.emailAddress FULLY replaced new@y.com (身份被完整替换·不再 old@x.com)"
cj5_uuid="$(node -e 'const j=require(process.argv[1]);process.stdout.write(j.oauthAccount.accountUuid||"NONE")' "$CJSON5" 2>/dev/null)"
assert_eq "uuid-new" "$cj5_uuid" "(5) ~/.claude.json oauthAccount.accountUuid replaced with切入号 uuid-new"
cj5_sub="$(node -e 'const j=require(process.argv[1]);process.stdout.write(j.oauthAccount.subscriptionType||"NONE")' "$CJSON5" 2>/dev/null)"
assert_eq "max" "$cj5_sub" "(5) ~/.claude.json oauthAccount.subscriptionType from identity = max"
cj5_keep="$(node -e 'const j=require(process.argv[1]);process.stdout.write(String(j.numStartups)+"/"+j.theme)' "$CJSON5" 2>/dev/null)"
assert_eq "42/dark" "$cj5_keep" "(5) ~/.claude.json other top-level keys (numStartups/theme) preserved (no config loss)"
# vault writeback: alice line now carries the FRESH refresh token.
if grep -q "$FRESH_RT" "$VFILE5" 2>/dev/null; then PASS=$((PASS+1)); _green "(5) vault writeback: alice blob refreshed to FRESH refresh token"; else FAILED=$((FAILED+1)); _red "FAIL: (5) vault writeback missing FRESH refresh token"; fi
# P3: the non-secret _EXPIRES sidecar line MUST survive the writeback (writeback only deletes the _TOKEN= line,
#   not all <email>_ lines). If it's gone, file-vault expiry巡检 can no longer warn — that's the bug we fixed.
if grep -q '^alice@x.com_EXPIRES=2027-12-31$' "$VFILE5" 2>/dev/null; then PASS=$((PASS+1)); _green "(5) P3: _EXPIRES sidecar survives writeback (only _TOKEN line replaced, not _EXPIRES)"; else FAILED=$((FAILED+1)); _red "FAIL: (5) P3 _EXPIRES sidecar deleted by writeback (regression: expiry巡检 loses its source)"; fi
# exactly one _TOKEN line after writeback (no stale dup — old token line deleted, fresh appended).
n5_tok="$(grep -c '^alice@x.com_TOKEN=' "$VFILE5" 2>/dev/null)"
assert_eq "1" "$n5_tok" "(5) P3: exactly one _TOKEN line after writeback (old replaced, no dup)"
# registry: alice active, bob inactive, bob.last_switch_out written.
alice5="$(node -e 'const r=require(process.argv[1]).loadRegistry(process.argv[2]);process.stdout.write(String(r.accounts["alice@x.com"].active))' "$LIB_JS" "$REG5" 2>/dev/null)"
bob5="$(node -e 'const r=require(process.argv[1]).loadRegistry(process.argv[2]);process.stdout.write(String(r.accounts["bob@y.com"].active))' "$LIB_JS" "$REG5" 2>/dev/null)"
assert_eq "true"  "$alice5" "(5) setActive flipped alice → active=true (switch-in)"
assert_eq "false" "$bob5"   "(5) setActive flipped bob → active=false (switch-out, uniqueness)"
bob5_lso="$(node -e 'const r=require(process.argv[1]).loadRegistry(process.argv[2]);process.stdout.write(r.accounts["bob@y.com"].last_switch_out?"SET":"null")' "$LIB_JS" "$REG5" 2>/dev/null)"
assert_eq "SET" "$bob5_lso" "(5) recordSwitchOut wrote bob.last_switch_out"
# tokens never leaked anywhere in the run.
assert_not_contains "$out5" "$ALICE_RT" "(5) alice refresh token does NOT leak in the real switch run"
assert_not_contains "$out5" "$FRESH_RT" "(5) fresh refresh token does NOT leak in the real switch run"
assert_not_contains "$out5" "$FRESH_AT" "(5) fresh access token does NOT leak in the real switch run"

# ──────────────────────────────────────────────────────────────────────────────────────────────────
# (5b) **DEGRADE — 切入号 registry entry 无 identity → ②段降级到 subscriptionType-only**.
#      alice entry 不带 identity → 完整替换不发生 → oauthAccount.emailAddress 仍是 old@x.com、subscriptionType 被同步。
# ──────────────────────────────────────────────────────────────────────────────────────────────────
FX5B="$(make_fixture)"; REG5B="$FX5B/accounts.json"; VFILE5B="$FX5B/accounts.env"
CRED5B="$FX5B/credentials.json"; CJSON5B="$FX5B/claude.json"
cat > "$REG5B" <<JSON
{ "schema": "cc-master/accounts/v1", "accounts": {
  "bob@y.com":   { "vault": {"kind":"keychain","service":"cc-master-oauth","account":"bob@y.com"}, "active": true, "last_switch_out": null },
  "alice@x.com": { "vault": {"kind":"file","path":"$VFILE5B","key":"alice@x.com"}, "token_expires_at":"2027-06-17T10:40:00Z", "active": false, "last_switch_out": null }
} }
JSON
umask 077
printf 'alice@x.com_TOKEN=%s\n' "{\"accessToken\":\"$ALICE_AT\",\"refreshToken\":\"$ALICE_RT\",\"expiresAt\":1700000000000,\"subscriptionType\":\"max\"}" > "$VFILE5B"; chmod 600 "$VFILE5B"
cat > "$CRED5B" <<'JSON'
{"claudeAiOauth":{"accessToken":"sk-ant-oat01-OLDcred000000000000000000000-_o","refreshToken":"sk-ant-ort01-OLDcredr0000000000000000000-_o","expiresAt":1700000000000,"subscriptionType":"pro"},"keepThisKey":"keepme"}
JSON
cat > "$CJSON5B" <<'JSON'
{"oauthAccount":{"emailAddress":"old@x.com","subscriptionType":"pro","organizationName":"OldOrg"},"numStartups":42,"theme":"dark"}
JSON
PORT5B="$FX5B/url.txt"; start_refresh_endpoint ok "$PORT5B"; RURL5B="$(cat "$PORT5B")"
out5b="$(PATH="$SECSTUB:$PATH" CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" REFRESH_TOKEN_URL="$RURL5B" CRED_PATH="$CRED5B" CLAUDE_JSON_PATH="$CJSON5B" \
        bash "$SCRIPT" --registry "$REG5B" --email "alice@x.com" --now "2026-06-17T09:00:00Z" 2>&1)"; rc5b=$?
assert_eq "0" "$rc5b" "(5b) no-identity switch still exits 0 (② degrade non-fatal)"
# ② degraded: oauthAccount.emailAddress UNCHANGED (still old@x.com), subscriptionType synced to max.
cj5b_email="$(node -e 'const j=require(process.argv[1]);process.stdout.write(j.oauthAccount.emailAddress||"NONE")' "$CJSON5B" 2>/dev/null)"
assert_eq "old@x.com" "$cj5b_email" "(5b) DEGRADE: oauthAccount.emailAddress UNCHANGED old@x.com (no identity → no full replace)"
cj5b_sub="$(node -e 'const j=require(process.argv[1]);process.stdout.write(j.oauthAccount.subscriptionType||"NONE")' "$CJSON5B" 2>/dev/null)"
assert_eq "max" "$cj5b_sub" "(5b) DEGRADE: subscriptionType still synced to max (blob.subscriptionType)"
assert_contains "$out5b" "降级" "(5b) DEGRADE: stderr surfaces 无 registry identity → 降级提示"
# no token leak in the degraded run either.
assert_not_contains "$out5b" "$ALICE_RT" "(5b) alice refresh token does NOT leak in the degraded run"
assert_not_contains "$out5b" "$FRESH_RT" "(5b) fresh refresh token does NOT leak in the degraded run"

# ──────────────────────────────────────────────────────────────────────────────────────────────────
# (5c) **③ keychain FAILS after ①② already wrote new account → ALL-OR-NOTHING rollback (codex P2-C)**.
#      Same fixture as (5) (alice file-vault·有 identity) but `security add-generic-password` returns非0 (SECSTUB_FAIL).
#      Without the fix → split-brain: ①② = new号 (FRESH/new@y.com), ③+registry = old号. With the fix → ①② rolled
#      back to OLD (credentials.json.accessToken still OLD·~/.claude.json.emailAddress still old@x.com), registry
#      active NOT flipped (alice stays false / bob stays true), stderr says 回滚, exit非0, no token leak.
# ──────────────────────────────────────────────────────────────────────────────────────────────────
FX5C="$(make_fixture)"; REG5C="$FX5C/accounts.json"; VFILE5C="$FX5C/accounts.env"
CRED5C="$FX5C/credentials.json"; CJSON5C="$FX5C/claude.json"
cat > "$REG5C" <<JSON
{ "schema": "cc-master/accounts/v1", "accounts": {
  "bob@y.com":   { "vault": {"kind":"keychain","service":"cc-master-oauth","account":"bob@y.com"}, "active": true, "last_switch_out": null },
  "alice@x.com": { "vault": {"kind":"file","path":"$VFILE5C","key":"alice@x.com"}, "token_expires_at":"2027-06-17T10:40:00Z", "active": false, "last_switch_out": null, "identity": {"emailAddress":"new@y.com","accountUuid":"uuid-new","organizationName":"NewOrg","subscriptionType":"max"} }
} }
JSON
umask 077
printf 'alice@x.com_TOKEN=%s\n' "{\"accessToken\":\"$ALICE_AT\",\"refreshToken\":\"$ALICE_RT\",\"expiresAt\":1700000000000,\"subscriptionType\":\"max\"}" > "$VFILE5C"; chmod 600 "$VFILE5C"
# pre-seed OLD official stores — the rollback must restore THESE exact values.
OLD_CRED_AT='sk-ant-oat01-OLDcred000000000000000000000-_o'
cat > "$CRED5C" <<'JSON'
{"claudeAiOauth":{"accessToken":"sk-ant-oat01-OLDcred000000000000000000000-_o","refreshToken":"sk-ant-ort01-OLDcredr0000000000000000000-_o","expiresAt":1700000000000,"subscriptionType":"pro"},"keepThisKey":"keepme"}
JSON
cat > "$CJSON5C" <<'JSON'
{"oauthAccount":{"emailAddress":"old@x.com","subscriptionType":"pro","organizationName":"OldOrg"},"numStartups":42,"theme":"dark"}
JSON
PORT5C="$FX5C/url.txt"; start_refresh_endpoint ok "$PORT5C"; RURL5C="$(cat "$PORT5C")"
# NOTE: SECSTUB_FAIL on PATH → `security add-generic-password` (③) returns非0.
out5c="$(PATH="$SECSTUB_FAIL:$PATH" CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" REFRESH_TOKEN_URL="$RURL5C" CRED_PATH="$CRED5C" CLAUDE_JSON_PATH="$CJSON5C" \
        bash "$SCRIPT" --registry "$REG5C" --email "alice@x.com" --now "2026-06-17T09:00:00Z" 2>&1)"; rc5c=$?
assert_eq "1" "$rc5c" "(5c) ③ keychain failure → switch did NOT succeed → exit非0 (caller won't flip registry)"
# ① credentials.json ROLLED BACK to OLD access token (not FRESH).
cred5c_at="$(node -e 'const j=require(process.argv[1]);process.stdout.write(j.claudeAiOauth.accessToken)' "$CRED5C" 2>/dev/null)"
assert_eq "$OLD_CRED_AT" "$cred5c_at" "(5c) ① credentials.json ROLLED BACK to OLD access token (全或无·not split-brain)"
assert_not_contains "$cred5c_at" "$FRESH_AT" "(5c) ① credentials.json is NOT the FRESH token (rollback undid the new写)"
# ② ~/.claude.json oauthAccount ROLLED BACK to old@x.com (not new@y.com).
cj5c_email="$(node -e 'const j=require(process.argv[1]);process.stdout.write(j.oauthAccount.emailAddress||"NONE")' "$CJSON5C" 2>/dev/null)"
assert_eq "old@x.com" "$cj5c_email" "(5c) ② ~/.claude.json oauthAccount.emailAddress ROLLED BACK to old@x.com (not new@y.com)"
cj5c_keep="$(node -e 'const j=require(process.argv[1]);process.stdout.write(String(j.numStartups)+"/"+j.theme)' "$CJSON5C" 2>/dev/null)"
assert_eq "42/dark" "$cj5c_keep" "(5c) ② ~/.claude.json other keys preserved through rollback (numStartups/theme)"
# registry active NOT flipped — alice stays false, bob stays true (caller saw return 1, didn't setActive).
alice5c="$(node -e 'const r=require(process.argv[1]).loadRegistry(process.argv[2]);process.stdout.write(String(r.accounts["alice@x.com"].active))' "$LIB_JS" "$REG5C" 2>/dev/null)"
bob5c="$(node -e 'const r=require(process.argv[1]).loadRegistry(process.argv[2]);process.stdout.write(String(r.accounts["bob@y.com"].active))' "$LIB_JS" "$REG5C" 2>/dev/null)"
assert_eq "false" "$alice5c" "(5c) registry alice active NOT flipped (stays false — switch aborted)"
assert_eq "true"  "$bob5c"   "(5c) registry bob still active=true (no split-brain in registry either)"
# stderr surfaces the rollback.
assert_contains "$out5c" "回滚" "(5c) stderr surfaces ①② 回滚 (换号未发生·可重试)"
# tokens never leak even on the failed/rolled-back path.
assert_not_contains "$out5c" "$ALICE_RT" "(5c) alice refresh token does NOT leak on the rollback path"
assert_not_contains "$out5c" "$FRESH_RT" "(5c) fresh refresh token does NOT leak on the rollback path"
assert_not_contains "$out5c" "$FRESH_AT" "(5c) fresh access token does NOT leak on the rollback path"

# ──────────────────────────────────────────────────────────────────────────────────────────────────
# (5d) **codex P1 teeth — ③ keychain "Claude Code-credentials" write must be a WRAPPED {"claudeAiOauth":{...}} object**.
#      病根：③ 写扁平 $blob（{accessToken,...}）→ claude 读 keychain 找不到 .claudeAiOauth → 当 corrupt/drift →
#      无重启换号不生效。修：③ 写前把 blob 包成 {"claudeAiOauth":<blob>}（与 credentials.json ① 写 / account-add 的
#      keychain 读一致）。用 capturing security stub 截下 ③ 写的值，断言它是 WRAPPED 且 .claudeAiOauth.accessToken
#      == 切入号 FRESH token（逮 flat-vs-wrapped），且 wrapped/refreshToken 绝不泄漏到输出。
# ──────────────────────────────────────────────────────────────────────────────────────────────────
FX5D="$(make_fixture)"; REG5D="$FX5D/accounts.json"; VFILE5D="$FX5D/accounts.env"
CRED5D="$FX5D/credentials.json"; CJSON5D="$FX5D/claude.json"; CAP5D="$FX5D/keychain-capture.json"
cat > "$REG5D" <<JSON
{ "schema": "cc-master/accounts/v1", "accounts": {
  "bob@y.com":   { "vault": {"kind":"keychain","service":"cc-master-oauth","account":"bob@y.com"}, "active": true, "last_switch_out": null },
  "alice@x.com": { "vault": {"kind":"file","path":"$VFILE5D","key":"alice@x.com"}, "token_expires_at":"2027-06-17T10:40:00Z", "active": false, "last_switch_out": null, "identity": {"emailAddress":"new@y.com","accountUuid":"uuid-new","organizationName":"NewOrg","subscriptionType":"max"} }
} }
JSON
umask 077
printf 'alice@x.com_TOKEN=%s\n' "{\"accessToken\":\"$ALICE_AT\",\"refreshToken\":\"$ALICE_RT\",\"expiresAt\":1700000000000,\"subscriptionType\":\"max\"}" > "$VFILE5D"; chmod 600 "$VFILE5D"
cat > "$CRED5D" <<'JSON'
{"claudeAiOauth":{"accessToken":"sk-ant-oat01-OLDcred000000000000000000000-_o","refreshToken":"sk-ant-ort01-OLDcredr0000000000000000000-_o","expiresAt":1700000000000,"subscriptionType":"pro"},"keepThisKey":"keepme"}
JSON
cat > "$CJSON5D" <<'JSON'
{"oauthAccount":{"emailAddress":"old@x.com","subscriptionType":"pro","organizationName":"OldOrg"},"numStartups":42,"theme":"dark"}
JSON
PORT5D="$FX5D/url.txt"; start_refresh_endpoint ok "$PORT5D"; RURL5D="$(cat "$PORT5D")"
# SECSTUB_CAPTURE on PATH + SEC_CAPTURE_FILE set → ③ keychain "Claude Code-credentials" write value captured.
out5d="$(PATH="$SECSTUB_CAPTURE:$PATH" SEC_CAPTURE_FILE="$CAP5D" CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" REFRESH_TOKEN_URL="$RURL5D" CRED_PATH="$CRED5D" CLAUDE_JSON_PATH="$CJSON5D" \
        bash "$SCRIPT" --registry "$REG5D" --email "alice@x.com" --now "2026-06-17T09:00:00Z" --no-snapshot 2>&1)"; rc5d=$?
assert_eq "0" "$rc5d" "(5d) P1 keychain-shape switch exits 0"
# the capture file must exist and be a {"claudeAiOauth":{...}} WRAPPED object (not flat {accessToken,...}).
assert_file "$CAP5D" "(5d) P1: ③ keychain write was captured"
cap5d_wrapped="$(node -e 'const j=require(process.argv[1]);process.stdout.write(j.claudeAiOauth&&typeof j.claudeAiOauth==="object"?"WRAPPED":"FLAT")' "$CAP5D" 2>/dev/null)"
assert_eq "WRAPPED" "$cap5d_wrapped" "(5d) P1: ③ keychain value is WRAPPED {\"claudeAiOauth\":{...}} (NOT flat blob)"
cap5d_at="$(node -e 'const j=require(process.argv[1]);process.stdout.write(j.claudeAiOauth.accessToken||"NONE")' "$CAP5D" 2>/dev/null)"
assert_eq "$FRESH_AT" "$cap5d_at" "(5d) P1: wrapped .claudeAiOauth.accessToken == 切入号 FRESH token"
# a FLAT write would have .accessToken at top level — assert it does NOT (proves wrap is load-bearing).
cap5d_flat="$(node -e 'const j=require(process.argv[1]);process.stdout.write(j.accessToken?"FLAT-LEAK":"OK")' "$CAP5D" 2>/dev/null)"
assert_eq "OK" "$cap5d_flat" "(5d) P1: NO top-level accessToken (not the flat-blob bug shape)"
# token no-leak: the wrapped blob / refresh token must NOT appear in stdout/stderr.
assert_not_contains "$out5d" "$FRESH_RT" "(5d) P1: fresh refresh token does NOT leak in the keychain-shape run"
assert_not_contains "$out5d" "$FRESH_AT" "(5d) P1: fresh access token does NOT leak in the keychain-shape run"
assert_not_contains "$out5d" "$ALICE_RT" "(5d) P1: alice refresh token does NOT leak in the keychain-shape run"

# ──────────────────────────────────────────────────────────────────────────────────────────────────
# (5e) **codex P2 teeth — ③ keychain FAILS + credentials.json did NOT pre-exist → rollback DELETES the新建 file**.
#      病根：snapshot 只在文件存在时做；文件原本不存在则 node 块会新建（写新号 token），③ 失败时从空 snapshot 恢复=
#      没东西恢复 → 新建的带新号 token 的 credentials.json 留下 = split-brain。修：track CRED_PREEXISTED=0 → rollback
#      rm -f 删回无此文件状态。断言：credentials.json 被删除（不留新 blob）、registry 未翻、exit非0、无 split-brain。
# ──────────────────────────────────────────────────────────────────────────────────────────────────
FX5E="$(make_fixture)"; REG5E="$FX5E/accounts.json"; VFILE5E="$FX5E/accounts.env"
# credentials.json / claude.json paths point at files that DO NOT EXIST yet (node block will CREATE them).
CRED5E="$FX5E/new-credentials.json"; CJSON5E="$FX5E/new-claude.json"
[ -e "$CRED5E" ] && rm -f "$CRED5E"; [ -e "$CJSON5E" ] && rm -f "$CJSON5E"   # ensure non-existent pre-switch.
cat > "$REG5E" <<JSON
{ "schema": "cc-master/accounts/v1", "accounts": {
  "bob@y.com":   { "vault": {"kind":"keychain","service":"cc-master-oauth","account":"bob@y.com"}, "active": true, "last_switch_out": null },
  "alice@x.com": { "vault": {"kind":"file","path":"$VFILE5E","key":"alice@x.com"}, "token_expires_at":"2027-06-17T10:40:00Z", "active": false, "last_switch_out": null, "identity": {"emailAddress":"new@y.com","accountUuid":"uuid-new","organizationName":"NewOrg","subscriptionType":"max"} }
} }
JSON
umask 077
printf 'alice@x.com_TOKEN=%s\n' "{\"accessToken\":\"$ALICE_AT\",\"refreshToken\":\"$ALICE_RT\",\"expiresAt\":1700000000000,\"subscriptionType\":\"max\"}" > "$VFILE5E"; chmod 600 "$VFILE5E"
PORT5E="$FX5E/url.txt"; start_refresh_endpoint ok "$PORT5E"; RURL5E="$(cat "$PORT5E")"
# SECSTUB_FAIL on PATH → ③ keychain add-generic-password returns非0 AFTER ①② already CREATED the new files.
out5e="$(PATH="$SECSTUB_FAIL:$PATH" CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" REFRESH_TOKEN_URL="$RURL5E" CRED_PATH="$CRED5E" CLAUDE_JSON_PATH="$CJSON5E" \
        bash "$SCRIPT" --registry "$REG5E" --email "alice@x.com" --now "2026-06-17T09:00:00Z" --no-snapshot 2>&1)"; rc5e=$?
assert_eq "1" "$rc5e" "(5e) P2: ③ keychain failure on新建文件 → exit非0 (switch did NOT succeed)"
# the newly-created credentials.json must be DELETED (not left holding the new blob) — back to no-such-file.
if [ ! -e "$CRED5E" ]; then PASS=$((PASS+1)); _green "(5e) P2: 换号新建的 credentials.json DELETED on rollback (回到无此文件·no split-brain)"; else FAILED=$((FAILED+1)); _red "FAIL: (5e) P2 新建 credentials.json STILL EXISTS after rollback (split-brain — new blob left behind)"; fi
# the newly-created claude.json must likewise be deleted (it gets created by ② node write).
if [ ! -e "$CJSON5E" ]; then PASS=$((PASS+1)); _green "(5e) P2: 换号新建的 claude.json DELETED on rollback too"; else FAILED=$((FAILED+1)); _red "FAIL: (5e) P2 新建 claude.json STILL EXISTS after rollback"; fi
# registry active NOT flipped — alice stays false, bob stays true (caller saw return 1).
alice5e="$(node -e 'const r=require(process.argv[1]).loadRegistry(process.argv[2]);process.stdout.write(String(r.accounts["alice@x.com"].active))' "$LIB_JS" "$REG5E" 2>/dev/null)"
bob5e="$(node -e 'const r=require(process.argv[1]).loadRegistry(process.argv[2]);process.stdout.write(String(r.accounts["bob@y.com"].active))' "$LIB_JS" "$REG5E" 2>/dev/null)"
assert_eq "false" "$alice5e" "(5e) P2: registry alice active NOT flipped (switch aborted, no split-brain in registry)"
assert_eq "true"  "$bob5e"   "(5e) P2: registry bob still active=true"
assert_contains "$out5e" "回滚" "(5e) P2: stderr surfaces 回滚 (删除新建文件)"
assert_not_contains "$out5e" "$FRESH_RT" "(5e) P2: no token leak on the新建-file rollback path"
assert_not_contains "$out5e" "$ALICE_RT" "(5e) P2: alice refresh token does NOT leak on the rollback path"

# ──────────────────────────────────────────────────────────────────────────────────────────────────
# (5f) **codex §7 round-3 P2-c — credentials.json PRE-EXISTS but its SNAPSHOT FAILED → rollback must report
#      FAILURE (split-brain risk), NOT silently skip the branch leaving ok=0 (谎报「已回滚」)**.
#      病根：rollback_official_stores_12 的 ① 分支只有 (PREEXISTED=1 && snapshot存在) → 恢复 / (PREEXISTED=0) → 删；
#      若 PREEXISTED=1 但 SNAP_CRED_TMP 空（换号前 cp 快照失败），两条都不命中、整段被跳过、ok 维持 0 → ③ keychain
#      失败时 caller 报「①② 已回滚」而新号 token 仍在原地 = 正是这段要防的 split-brain。修：补 else 分支标 ok=1
#      (回滚失败)，让 caller 如实报 split-brain / 需手动对账。
#      复现手法（hermetic·deterministic）：装一个 `mktemp` STUB——对 BARE `mktemp`（snapshot 用·无模板 arg）返回一个
#      指向 chmod 000 不可写目录的路径（exit 0）→ 脚本把它当 SNAP_*_TMP → 随后 `cp` 写不进去 → snapshot 失败 →
#      SNAP_*_TMP 置空，而 *_PREEXISTED 仍=1（官方三存储在 fixture 可写目录里照常被覆写）。对**带模板**的 mktemp
#      （如 select 的 `.ccm-sel-err.XXXXXX`）委派给真 mktemp（本 case 显式 --email·不触发 select·稳妥起见仍委派）。
#      再用 SECSTUB_FAIL 让 ③ keychain 失败触发回滚。断言：stderr 报 split-brain / 无法回滚（NOT 「已回滚·可重试」
#      的谎报）、exit非0、registry 未翻。
# ──────────────────────────────────────────────────────────────────────────────────────────────────
FX5F="$(make_fixture)"; REG5F="$FX5F/accounts.json"; VFILE5F="$FX5F/accounts.env"
CRED5F="$FX5F/credentials.json"; CJSON5F="$FX5F/claude.json"
cat > "$REG5F" <<JSON
{ "schema": "cc-master/accounts/v1", "accounts": {
  "bob@y.com":   { "vault": {"kind":"keychain","service":"cc-master-oauth","account":"bob@y.com"}, "active": true, "last_switch_out": null },
  "alice@x.com": { "vault": {"kind":"file","path":"$VFILE5F","key":"alice@x.com"}, "token_expires_at":"2027-06-17T10:40:00Z", "active": false, "last_switch_out": null, "identity": {"emailAddress":"new@y.com","accountUuid":"uuid-new","organizationName":"NewOrg","subscriptionType":"max"} }
} }
JSON
umask 077
printf 'alice@x.com_TOKEN=%s\n' "{\"accessToken\":\"$ALICE_AT\",\"refreshToken\":\"$ALICE_RT\",\"expiresAt\":1700000000000,\"subscriptionType\":\"max\"}" > "$VFILE5F"; chmod 600 "$VFILE5F"
# Official stores PRE-EXIST in the (writable) fixture dir — they get overwritten normally; the SNAPSHOT is what fails.
OLD_CRED_AT_5F='sk-ant-oat01-OLD5Fcred0000000000000000000-_o'
cat > "$CRED5F" <<'JSON'
{"claudeAiOauth":{"accessToken":"sk-ant-oat01-OLD5Fcred0000000000000000000-_o","refreshToken":"sk-ant-ort01-OLD5Fcredr000000000000000000-_o","expiresAt":1700000000000,"subscriptionType":"pro"},"keepThisKey":"keepme"}
JSON
cat > "$CJSON5F" <<'JSON'
{"oauthAccount":{"emailAddress":"old@x.com","subscriptionType":"pro","organizationName":"OldOrg"},"numStartups":42,"theme":"dark"}
JSON
# An UNWRITABLE (chmod 000) dir; the mktemp stub points snapshots here so their `cp` fails (snapshot empty·PREEXISTED=1).
BADTMP_5F="$FX5F/badtmp"; mkdir -p "$BADTMP_5F"; chmod 000 "$BADTMP_5F"
# mktemp STUB dir: BARE `mktemp` (snapshot's no-template form) → echo a path inside the unwritable dir + exit 0 (so the
#   script accepts it as SNAP_*_TMP, then its `cp` into the chmod-000 dir fails → snapshot empty). TEMPLATED `mktemp …
#   XXXXXX` (e.g. select) → delegate to the REAL mktemp (only the bare snapshot form must be sabotaged).
MTSTUB_5F="$(make_project)"
cat > "$MTSTUB_5F/mktemp" <<MT
#!/usr/bin/env bash
# stub mktemp: bare (no args) → return an unwritable-dir path (snapshot cp will fail); templated → real mktemp.
if [ "\$#" -eq 0 ]; then printf '%s\n' "$BADTMP_5F/snap.\$\$.\$RANDOM"; exit 0; fi
exec /usr/bin/mktemp "\$@"
MT
chmod +x "$MTSTUB_5F/mktemp"
PORT5F="$FX5F/url.txt"; start_refresh_endpoint ok "$PORT5F"; RURL5F="$(cat "$PORT5F")"
# SECSTUB_FAIL + mktemp stub on PATH → ③ keychain fails AFTER ①② overwritten → rollback finds PREEXISTED=1 but no snapshot.
out5f="$(PATH="$MTSTUB_5F:$SECSTUB_FAIL:$PATH" CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" REFRESH_TOKEN_URL="$RURL5F" CRED_PATH="$CRED5F" CLAUDE_JSON_PATH="$CJSON5F" \
        bash "$SCRIPT" --registry "$REG5F" --email "alice@x.com" --now "2026-06-17T09:00:00Z" 2>&1)"; rc5f=$?
chmod 755 "$BADTMP_5F" 2>/dev/null || true   # restore perms so the fixture dir cleans up.
assert_eq "1" "$rc5f" "(5f) P2-c: ③ keychain failure → exit非0 (switch did NOT succeed)"
# CORE REGRESSION: stderr must HONESTLY report the split-brain / no-rollback (NOT the false「①② 已回滚·可重试」claim).
assert_contains "$out5f" "split-brain" "(5f) P2-c CORE: rollback HONESTLY reports split-brain risk (preexisted but no snapshot — NOT 谎报已回滚)"
assert_contains "$out5f" "手动对账" "(5f) P2-c: surfaces 需手动对账 (caller can't claim clean rollback)"
# the caller's false-success line「已回滚 … 可重试」must NOT appear (that was the bug — silent skip kept ok=0).
assert_not_contains "$out5f" "已回滚 ①②，三存储全留旧号" "(5f) P2-c: does NOT falsely claim ①② fully rolled back (the谎报 the bug produced)"
# registry active NOT flipped — the switch aborted (caller saw return 1 → never setActive).
alice5f="$(node -e 'const r=require(process.argv[1]).loadRegistry(process.argv[2]);process.stdout.write(String(r.accounts["alice@x.com"].active))' "$LIB_JS" "$REG5F" 2>/dev/null)"
bob5f="$(node -e 'const r=require(process.argv[1]).loadRegistry(process.argv[2]);process.stdout.write(String(r.accounts["bob@y.com"].active))' "$LIB_JS" "$REG5F" 2>/dev/null)"
assert_eq "false" "$alice5f" "(5f) P2-c: registry alice active NOT flipped (switch aborted)"
assert_eq "true"  "$bob5f"   "(5f) P2-c: registry bob still active=true"
# token no-leak on the split-brain-reported path.
assert_not_contains "$out5f" "$ALICE_RT" "(5f) P2-c: alice refresh token does NOT leak on the split-brain-reported path"
assert_not_contains "$out5f" "$FRESH_RT" "(5f) P2-c: fresh refresh token does NOT leak on the split-brain-reported path"
rm -rf "$FX5F" "$MTSTUB_5F"

# ──────────────────────────────────────────────────────────────────────────────────────────────────
# (6) cloud backend → no-op exit 0, registry untouched, token never read.
# ──────────────────────────────────────────────────────────────────────────────────────────────────
FX6="$(make_fixture)"; REG6="$FX6/accounts.json"
cp "$REG3" "$REG6"
out6="$(CLAUDE_CODE_USE_BEDROCK=1 CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" bash "$SCRIPT" --registry "$REG6" 2>&1)"; rc6=$?
assert_eq "0" "$rc6" "(6) cloud backend → no-op exit 0"
assert_contains "$out6" "换号不适用" "(6) cloud backend prints no-op message"

# ──────────────────────────────────────────────────────────────────────────────────────────────────
# (7) --board is now a DEPRECATED no-op (无重启换号不重启进程·不再 resume 板). Missing --board must NOT fail.
# ──────────────────────────────────────────────────────────────────────────────────────────────────
out7="$(CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" bash "$SCRIPT" --registry "$REG1" --now "2026-06-17T09:00:00Z" --dry-run --skip-token-check 2>&1)"; rc7=$?
assert_eq "0" "$rc7" "(7) missing --board → still works (--board deprecated no-op, not required)"
# and passing --board is harmless (only annotated as deprecated in dry-run plan).
out7b="$(CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" bash "$SCRIPT" --board "b.board.json" --registry "$REG1" --now "2026-06-17T09:00:00Z" --dry-run --skip-token-check 2>&1)"; rc7b=$?
assert_eq "0" "$rc7b" "(7b) passing --board still exits 0 (harmless deprecated arg)"
assert_contains "$out7b" "deprecated" "(7b) dry-run plan marks --board as deprecated"

# ──────────────────────────────────────────────────────────────────────────────────────────────────
# (8) **P2-1 teeth — blob 读失败时 registry active 绝不被翻转 + 三存储绝不被覆写**.
#     切入 alice 的 file vault 文件不存在 → 读 blob 必失败 → 脚本非 0 退出，registry active 未翻、stores 未写。
# ──────────────────────────────────────────────────────────────────────────────────────────────────
FX8="$(make_fixture)"; REG8="$FX8/accounts.json"; VFILE8="$FX8/does-not-exist.env"; CRED8="$FX8/credentials.json"
cat > "$REG8" <<JSON
{ "schema": "cc-master/accounts/v1", "accounts": {
  "bob@y.com":   { "vault": {"kind":"keychain","service":"cc-master-oauth","account":"bob@y.com"}, "active": true, "last_switch_out": null },
  "alice@x.com": { "vault": {"kind":"file","path":"$VFILE8","key":"alice@x.com"}, "active": false, "last_switch_out": null }
} }
JSON
cat > "$CRED8" <<'JSON'
{"claudeAiOauth":{"accessToken":"sk-ant-oat01-UNTOUCHED00000000000000000-_u","refreshToken":"sk-ant-ort01-UNTOUCHEDr0000000000000-_u","expiresAt":1700000000000}}
JSON
out8="$(PATH="$SECSTUB:$PATH" CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" CRED_PATH="$CRED8" bash "$SCRIPT" --registry "$REG8" --email "alice@x.com" --now "2026-06-17T09:00:00Z" 2>&1)"; rc8=$?
[ "$rc8" -ne 0 ] && PASS=$((PASS+1)) || { FAILED=$((FAILED+1)); _red "FAIL: (8) P2-1 blob-read failure must exit non-0 (got rc=$rc8)"; }
bob8="$(node -e 'const r=require(process.argv[1]).loadRegistry(process.argv[2]);process.stdout.write(String(r.accounts["bob@y.com"].active))' "$LIB_JS" "$REG8" 2>/dev/null)"
alice8="$(node -e 'const r=require(process.argv[1]).loadRegistry(process.argv[2]);process.stdout.write(String(r.accounts["alice@x.com"].active))' "$LIB_JS" "$REG8" 2>/dev/null)"
assert_eq "true"  "$bob8"   "(8) P2-1: blob-read failed → bob STILL active=true (active NOT flipped)"
assert_eq "false" "$alice8" "(8) P2-1: blob-read failed → alice STILL active=false (switch-in NOT mis-marked)"
cred8_at="$(node -e 'process.stdout.write(require(process.argv[1]).claudeAiOauth.accessToken.slice(0,20))' "$CRED8" 2>/dev/null)"
assert_eq "sk-ant-oat01-UNTOUCH" "$cred8_at" "(8) P2-1: credentials.json NOT overwritten on blob-read failure"

# ──────────────────────────────────────────────────────────────────────────────────────────────────
# (9) **P2-2 teeth — snapshot 降级（无 used_percentage）被拒写时，setActive 仍独立成功 + 换号仍完成**.
#     用一个只出 local fallback（无 used_percentage）的 cc-usage stub → snapshot 被拒写，但 refresh + 覆写
#     三存储仍发生、registry alice active=true / bob active=false（setActive 独立成功），bob.last_switch_out 仍 null.
# ──────────────────────────────────────────────────────────────────────────────────────────────────
FX9="$(make_fixture)"; REG9="$FX9/accounts.json"; VFILE9="$FX9/accounts.env"; CRED9="$FX9/credentials.json"; CJSON9="$FX9/claude.json"
cat > "$REG9" <<JSON
{ "schema": "cc-master/accounts/v1", "accounts": {
  "bob@y.com":   { "vault": {"kind":"keychain","service":"cc-master-oauth","account":"bob@y.com"}, "active": true, "last_switch_out": null },
  "alice@x.com": { "vault": {"kind":"file","path":"$VFILE9","key":"alice@x.com"}, "active": false, "last_switch_out": null }
} }
JSON
umask 077
printf 'alice@x.com_TOKEN=%s\n' "{\"accessToken\":\"$ALICE_AT\",\"refreshToken\":\"$ALICE_RT\",\"expiresAt\":1700000000000}" > "$VFILE9"; chmod 600 "$VFILE9"
cat > "$CRED9" <<'JSON'
{"claudeAiOauth":{"accessToken":"sk-ant-oat01-OLD9000000000000000000000-_o","refreshToken":"sk-ant-ort01-OLD9r000000000000000000-_o","expiresAt":1700000000000}}
JSON
printf '{}' > "$CJSON9"
# stub plugin root with a LOCAL-FALLBACK cc-usage (no used_percentage → snapshot.used_pct undefined → rejected).
STUB_ROOT9="$(make_project)"
mkdir -p "$STUB_ROOT9/skills/account-management/scripts" "$STUB_ROOT9/skills/orchestrating-to-completion/scripts"
ln -s "$PLUGIN_ROOT/skills/account-management/scripts/switch-account.sh" "$STUB_ROOT9/skills/account-management/scripts/switch-account.sh"
ln -s "$PLUGIN_ROOT/skills/account-management/scripts/accounts-lib.js"   "$STUB_ROOT9/skills/account-management/scripts/accounts-lib.js"
ln -s "$PLUGIN_ROOT/skills/account-management/scripts/select-account.js" "$STUB_ROOT9/skills/account-management/scripts/select-account.js"
cat > "$STUB_ROOT9/skills/orchestrating-to-completion/scripts/cc-usage.sh" <<'CU'
#!/usr/bin/env bash
printf '%s\n' '{"source":"local-derived-approx","five_hour":{"used_tokens":1234,"window_remaining_min":120},"seven_day":{"used_tokens":5678,"window_remaining_min":4000}}'
CU
chmod +x "$STUB_ROOT9/skills/orchestrating-to-completion/scripts/cc-usage.sh"
PORT9="$FX9/url.txt"; start_refresh_endpoint ok "$PORT9"; RURL9="$(cat "$PORT9")"
out9="$(PATH="$SECSTUB:$PATH" CLAUDE_PLUGIN_ROOT="$STUB_ROOT9" REFRESH_TOKEN_URL="$RURL9" CRED_PATH="$CRED9" CLAUDE_JSON_PATH="$CJSON9" \
        bash "$STUB_ROOT9/skills/account-management/scripts/switch-account.sh" --registry "$REG9" --email "alice@x.com" --now "2026-06-17T09:00:00Z" 2>&1)"; rc9=$?
assert_eq "0" "$rc9" "(9) P2-2: snapshot-rejected run STILL completes the no-restart switch (exit 0)"
assert_contains "$out9" "无重启换号完成" "(9) P2-2: switch proceeded despite snapshot rejection"
alice9="$(node -e 'const r=require(process.argv[1]).loadRegistry(process.argv[2]);process.stdout.write(String(r.accounts["alice@x.com"].active))' "$LIB_JS" "$REG9" 2>/dev/null)"
bob9="$(node -e 'const r=require(process.argv[1]).loadRegistry(process.argv[2]);process.stdout.write(String(r.accounts["bob@y.com"].active))' "$LIB_JS" "$REG9" 2>/dev/null)"
assert_eq "true"  "$alice9" "(9) P2-2: setActive flipped alice → active=true (decoupled, reliably landed)"
assert_eq "false" "$bob9"   "(9) P2-2: setActive flipped bob → active=false (NOT lost with the rejected snapshot)"
bob9_lso="$(node -e 'const r=require(process.argv[1]).loadRegistry(process.argv[2]);process.stdout.write(r.accounts["bob@y.com"].last_switch_out?"SET":"null")' "$LIB_JS" "$REG9" 2>/dev/null)"
assert_eq "null" "$bob9_lso" "(9) P2-2: rejected snapshot was NOT written (only the snapshot was lost, not setActive)"
assert_not_contains "$out9" "$ALICE_RT" "(9) P2-2: no token leak in the snapshot-rejected switch run"

# ──────────────────────────────────────────────────────────────────────────────────────────────────
# (10) **refresh 失败分流 — oauth 401（refresh token 失效）→ 硬失败、不覆写任何存储、registry 原封不动**.
#      （设计稿 step 6）。stub endpoint 返回 401 → switch 退非 0，credentials.json 仍 OLD、registry 未翻。
# ──────────────────────────────────────────────────────────────────────────────────────────────────
FX10="$(make_fixture)"; REG10="$FX10/accounts.json"; VFILE10="$FX10/accounts.env"; CRED10="$FX10/credentials.json"
cat > "$REG10" <<JSON
{ "schema": "cc-master/accounts/v1", "accounts": {
  "bob@y.com":   { "vault": {"kind":"keychain","service":"cc-master-oauth","account":"bob@y.com"}, "active": true, "last_switch_out": null },
  "alice@x.com": { "vault": {"kind":"file","path":"$VFILE10","key":"alice@x.com"}, "active": false, "last_switch_out": null }
} }
JSON
umask 077
printf 'alice@x.com_TOKEN=%s\n' "{\"accessToken\":\"$ALICE_AT\",\"refreshToken\":\"$ALICE_RT\",\"expiresAt\":1700000000000}" > "$VFILE10"; chmod 600 "$VFILE10"
cat > "$CRED10" <<'JSON'
{"claudeAiOauth":{"accessToken":"sk-ant-oat01-OLD10000000000000000000000-_o","refreshToken":"sk-ant-ort01-OLD10r00000000000000000-_o","expiresAt":1700000000000}}
JSON
PORT10="$FX10/url.txt"; start_refresh_endpoint 401 "$PORT10"; RURL10="$(cat "$PORT10")"
out10="$(PATH="$SECSTUB:$PATH" CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" REFRESH_TOKEN_URL="$RURL10" CRED_PATH="$CRED10" \
         bash "$SCRIPT" --registry "$REG10" --email "alice@x.com" --now "2026-06-17T09:00:00Z" --no-snapshot 2>&1)"; rc10=$?
[ "$rc10" -ne 0 ] && PASS=$((PASS+1)) || { FAILED=$((FAILED+1)); _red "FAIL: (10) oauth-401 refresh must HARD-fail (got rc=$rc10)"; }
assert_contains "$out10" "未覆写任何存储" "(10) oauth-401: surfaces 'no stores overwritten' (step 6 hard-fail)"
cred10_at="$(node -e 'process.stdout.write(require(process.argv[1]).claudeAiOauth.accessToken.slice(0,18))' "$CRED10" 2>/dev/null)"
assert_eq "sk-ant-oat01-OLD10" "$cred10_at" "(10) oauth-401: credentials.json NOT overwritten (refresh token invalid → don't trash the store)"
bob10="$(node -e 'const r=require(process.argv[1]).loadRegistry(process.argv[2]);process.stdout.write(String(r.accounts["bob@y.com"].active))' "$LIB_JS" "$REG10" 2>/dev/null)"
assert_eq "true" "$bob10" "(10) oauth-401: registry active NOT flipped (bob still active)"
assert_not_contains "$out10" "$ALICE_RT" "(10) oauth-401: no token leak on the hard-fail path"

# ──────────────────────────────────────────────────────────────────────────────────────────────────
# (11) **refresh 失败分流 — 网络不通 → force-refresh 兜底（覆写原 blob + 临近过期逼 claude 自己 refresh）**.
#      （设计稿 step 10）。指一个无人监听的端口 → 网络错误 → force-refresh 兜底：覆写三存储用原 blob、registry 翻。
# ──────────────────────────────────────────────────────────────────────────────────────────────────
FX11="$(make_fixture)"; REG11="$FX11/accounts.json"; VFILE11="$FX11/accounts.env"; CRED11="$FX11/credentials.json"; CJSON11="$FX11/claude.json"
cat > "$REG11" <<JSON
{ "schema": "cc-master/accounts/v1", "accounts": {
  "bob@y.com":   { "vault": {"kind":"keychain","service":"cc-master-oauth","account":"bob@y.com"}, "active": true, "last_switch_out": null },
  "alice@x.com": { "vault": {"kind":"file","path":"$VFILE11","key":"alice@x.com"}, "active": false, "last_switch_out": null }
} }
JSON
umask 077
printf 'alice@x.com_TOKEN=%s\n' "{\"accessToken\":\"$ALICE_AT\",\"refreshToken\":\"$ALICE_RT\",\"expiresAt\":1700000000000}" > "$VFILE11"; chmod 600 "$VFILE11"
cat > "$CRED11" <<'JSON'
{"claudeAiOauth":{"accessToken":"sk-ant-oat01-OLD11000000000000000000000-_o","refreshToken":"sk-ant-ort01-OLD11r00000000000000000-_o","expiresAt":1700000000000}}
JSON
printf '{}' > "$CJSON11"
# port 1 → nothing listening → ECONNREFUSED (network error rc=5) → force-refresh fallback.
out11="$(PATH="$SECSTUB:$PATH" CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" REFRESH_TOKEN_URL="http://127.0.0.1:1/v1/oauth/token" CRED_PATH="$CRED11" CLAUDE_JSON_PATH="$CJSON11" \
         bash "$SCRIPT" --registry "$REG11" --email "alice@x.com" --now "2026-06-17T09:00:00Z" --no-snapshot 2>&1)"; rc11=$?
assert_eq "0" "$rc11" "(11) network-unreachable → force-refresh fallback completes (exit 0)"
assert_contains "$out11" "force-refresh 兜底" "(11) force-refresh fallback engaged (network unreachable)"
assert_contains "$out11" "vault-stale 风险" "(11) force-refresh warns of vault-stale risk"
# stores overwritten with the (original) alice blob; registry flipped (the no-restart switch did happen).
cred11_at="$(node -e 'process.stdout.write(require(process.argv[1]).claudeAiOauth.accessToken)' "$CRED11" 2>/dev/null)"
assert_eq "$ALICE_AT" "$cred11_at" "(11) force-refresh: credentials.json overwritten with the original alice blob"
alice11="$(node -e 'const r=require(process.argv[1]).loadRegistry(process.argv[2]);process.stdout.write(String(r.accounts["alice@x.com"].active))' "$LIB_JS" "$REG11" 2>/dev/null)"
assert_eq "true" "$alice11" "(11) force-refresh: registry flipped alice → active=true (switch happened)"
assert_not_contains "$out11" "$ALICE_RT" "(11) force-refresh: no token leak"

# ──────────────────────────────────────────────────────────────────────────────────────────────────
# (11b) **codex round#2 Finding 3 teeth — record_switch_out 的 cc-usage 快照有 timeout（slow/hung 不 wedge 换号）**.
#      病根：切出快照里的 cc-usage 无 timeout，跑在覆写官方存储之后、setActive 之前——slow/hung 会让机器已切到
#      新号、但 accounts.json 还标旧号 active。修：照搬 account-add.sh 的可移植 timeout 包法。注入一个 HANG 的
#      cc-usage stub（sleep 远超 timeout）+ 小 CC_USAGE_TIMEOUT_S → 断言换号不 hang、setActive 仍翻 active、exit 0。
# ──────────────────────────────────────────────────────────────────────────────────────────────────
FX11B="$(make_fixture)"; REG11B="$FX11B/accounts.json"; VFILE11B="$FX11B/accounts.env"; CRED11B="$FX11B/credentials.json"; CJSON11B="$FX11B/claude.json"
cat > "$REG11B" <<JSON
{ "schema": "cc-master/accounts/v1", "accounts": {
  "bob@y.com":   { "vault": {"kind":"keychain","service":"cc-master-oauth","account":"bob@y.com"}, "active": true, "last_switch_out": null },
  "alice@x.com": { "vault": {"kind":"file","path":"$VFILE11B","key":"alice@x.com"}, "active": false, "last_switch_out": null }
} }
JSON
umask 077
printf 'alice@x.com_TOKEN=%s\n' "{\"accessToken\":\"$ALICE_AT\",\"refreshToken\":\"$ALICE_RT\",\"expiresAt\":1700000000000}" > "$VFILE11B"; chmod 600 "$VFILE11B"
cat > "$CRED11B" <<'JSON'
{"claudeAiOauth":{"accessToken":"sk-ant-oat01-OLD11B00000000000000000000-_o","refreshToken":"sk-ant-ort01-OLD11Br0000000000000000-_o","expiresAt":1700000000000}}
JSON
printf '{}' > "$CJSON11B"
# stub plugin root with a HANGING cc-usage (sleeps far beyond CC_USAGE_TIMEOUT_S → the timeout must kill it).
STUB_ROOT11B="$(make_project)"
mkdir -p "$STUB_ROOT11B/skills/account-management/scripts" "$STUB_ROOT11B/skills/orchestrating-to-completion/scripts"
ln -s "$PLUGIN_ROOT/skills/account-management/scripts/switch-account.sh" "$STUB_ROOT11B/skills/account-management/scripts/switch-account.sh"
ln -s "$PLUGIN_ROOT/skills/account-management/scripts/accounts-lib.js"   "$STUB_ROOT11B/skills/account-management/scripts/accounts-lib.js"
ln -s "$PLUGIN_ROOT/skills/account-management/scripts/select-account.js" "$STUB_ROOT11B/skills/account-management/scripts/select-account.js"
cat > "$STUB_ROOT11B/skills/orchestrating-to-completion/scripts/cc-usage.sh" <<'CU'
#!/usr/bin/env bash
# HANG stub cc-usage: sleep way past the timeout so the watchdog MUST kill it (simulates a giant-JSONL slow run).
sleep 30
printf '%s\n' '{"source":"account","five_hour":{"used_percentage":42,"resets_at":4102444800},"seven_day":{"used_percentage":17,"resets_at":4102444800}}'
CU
chmod +x "$STUB_ROOT11B/skills/orchestrating-to-completion/scripts/cc-usage.sh"
PORT11B="$FX11B/url.txt"; start_refresh_endpoint ok "$PORT11B"; RURL11B="$(cat "$PORT11B")"
sw_start=$(date +%s)
out11b="$(PATH="$SECSTUB:$PATH" CLAUDE_PLUGIN_ROOT="$STUB_ROOT11B" REFRESH_TOKEN_URL="$RURL11B" CRED_PATH="$CRED11B" CLAUDE_JSON_PATH="$CJSON11B" CC_USAGE_TIMEOUT_S=2 \
         bash "$STUB_ROOT11B/skills/account-management/scripts/switch-account.sh" --registry "$REG11B" --email "alice@x.com" --now "2026-06-17T09:00:00Z" 2>&1)"; rc11b=$?
sw_elapsed=$(( $(date +%s) - sw_start ))
assert_eq "0" "$rc11b" "(11b) Finding 3: hung cc-usage → switch STILL completes (exit 0, not wedged)"
# the run must NOT take the full 30s hang — the timeout (2s) must have bitten (generous ceiling: < 20s).
if [ "$sw_elapsed" -lt 20 ]; then PASS=$((PASS+1)); _green "(11b) Finding 3: cc-usage timeout bit (run took ${sw_elapsed}s, not the 30s hang)"; else FAILED=$((FAILED+1)); _red "FAIL: (11b) Finding 3 run took ${sw_elapsed}s — cc-usage timeout did NOT bite (hang not bounded)"; fi
assert_contains "$out11b" "未返回" "(11b) Finding 3: surfaces the cc-usage timeout notice (graceful degrade)"
# setActive STILL flipped despite the cc-usage hang (the decoupled active write is independent of the snapshot).
alice11b="$(node -e 'const r=require(process.argv[1]).loadRegistry(process.argv[2]);process.stdout.write(String(r.accounts["alice@x.com"].active))' "$LIB_JS" "$REG11B" 2>/dev/null)"
bob11b="$(node -e 'const r=require(process.argv[1]).loadRegistry(process.argv[2]);process.stdout.write(String(r.accounts["bob@y.com"].active))' "$LIB_JS" "$REG11B" 2>/dev/null)"
assert_eq "true"  "$alice11b" "(11b) Finding 3: setActive STILL flipped alice → active=true (no wedge: machine切了新号、registry 也翻了)"
assert_eq "false" "$bob11b"   "(11b) Finding 3: bob → active=false (no 'machine new号 / registry old号' half-state)"
assert_not_contains "$out11b" "$ALICE_RT" "(11b) Finding 3: no token leak on the cc-usage-timeout path"

# ──────────────────────────────────────────────────────────────────────────────────────────────────
# (12) **P2-6 teeth (adapted) — 凭证绝不进 argv：refresh/覆写/回写全经 stdin / POST body**.
#      结构断言：脚本里 refresh token 经 node https POST body（不进 argv）；三存储覆写经 node stdin / security
#      stdin；绝无把 blob/token 当命令行实参（`security ... -w "$..."` 或 curl ... token 这类 argv 泄漏形态）。
# ──────────────────────────────────────────────────────────────────────────────────────────────────
echo "-- (12) P2-6 structural teeth: blob/token never placed in argv (stdin / POST body only) --"
# (12a) refresh uses node https (NOT curl) — no `curl` COMMAND INVOCATION in the script. We look for curl in a
#   command position (line start / after | ; & ( $( ), not the word "curl" inside a comment or a plan string.
curl_hits="$(grep -nE '(^|[|;&(]|\$\()[[:space:]]*curl[[:space:]]' "$SCRIPT" | grep -vE ':[[:space:]]*#' || true)"
if [ -z "$curl_hits" ]; then PASS=$((PASS+1)); _green "(12a) P2-6 OK: no curl command in script (refresh uses node https → refresh token in POST body, not argv)"; else FAILED=$((FAILED+1)); _red "FAIL: (12a) found curl invocation (could put token in argv):"; printf '%s\n' "$curl_hits" >&2; fi
# (12b) the official keychain ③ write passes the WRAPPED blob as an ARGV value (security ... -w "$wrapped"), NEVER stdin.
#   **INVERTED posture (用户拍板抉择 A·128-byte fix)**: stdin-fed `security -w` (no value arg)走 readpassphrase 有 128
#   字节硬上限 → wrapped 官方凭证会被截成 128 残片 brick 掉官方登录。必须用 `-w "$wrapped"`（值作 argv·存完整）。
if grep -qE 'security add-generic-password -U -s "Claude Code-credentials" -a "\$USER" -w "\$wrapped"' "$SCRIPT"; then
  PASS=$((PASS+1)); _green "(12b) P2-6 OK: keychain ③ write passes wrapped blob as argv (security … -w \"\$wrapped\" → avoids 128-byte stdin cap)"
else
  FAILED=$((FAILED+1)); _red "FAIL: (12b) keychain ③ official-entry write is NOT the argv -w \"\$wrapped\" form (128-byte stdin truncation risk)"
fi
# (12b-stdin-ban) the broken stdin double-feed keychain write must be GONE from LIVE code (comment/plan prose may
#   explain WHY — strip comment lines first, then ban a live `printf '%s\n%s\n' ... | security ... add-generic`).
if grep -vE '^[[:space:]]*#' "$SCRIPT" | grep -qE "printf '%s..n%s..n'.*\|.*security add-generic-password"; then
  FAILED=$((FAILED+1)); _red "FAIL: (12b-stdin-ban) a live stdin double-feed 'printf | security add-generic-password -w' survives (128-byte truncation regression!)"
else
  PASS=$((PASS+1)); _green "(12b-stdin-ban) no live stdin double-feed keychain write (the 128-byte-truncating form is gone)"
fi
# (12c) the keychain writes intentionally pass the blob/wrapped as a `-w "$..."` argv value (抉择 A: accepted
#   sub-second local exposure·避 128 截断). Token-blind still守: those values must NEVER be echoed/printed — only ever
#   handed to `security` as the -w argv positional. Assert every `-w "$VAR"` occurrence sits on a `security` line.
wargv_lines="$(grep -nE '\-w[[:space:]]+"\$(blob|wrapped)"' "$SCRIPT" | grep -vE ':[[:space:]]*#' || true)"
bad_wargv="$(printf '%s\n' "$wargv_lines" | grep -vE 'security add-generic-password' | grep -vE '^$' || true)"
if [ -z "$bad_wargv" ]; then PASS=$((PASS+1)); _green "(12c) P2-6 OK: every '-w \"\$blob/\$wrapped\"' is a security argv write (token-blind·no echo/print of the value)"; else FAILED=$((FAILED+1)); _red "FAIL: (12c) a '-w \"\$...\"' value appears off a security line (potential leak):"; printf '%s\n' "$bad_wargv" >&2; fi
# (12d) NO `exec claude` line remains (no-restart switch never restarts the process).
execclaude_hits="$(grep -nE '^[[:space:]]*exec claude' "$SCRIPT" | grep -vE ':[[:space:]]*#' || true)"
if [ -z "$execclaude_hits" ]; then PASS=$((PASS+1)); _green "(12d) no-restart: NO 'exec claude' line (process is not replaced — stores are overwritten instead)"; else FAILED=$((FAILED+1)); _red "FAIL: (12d) found an exec claude line (should be removed for no-restart switch):"; printf '%s\n' "$execclaude_hits" >&2; fi

# ── TOKEN-LEAK SOURCE AUDIT (static): the script must never echo/print the blob/token variables. ──
# Grep for any print path (echo/printf/plan/err) referencing the credential vars. Allowed: ${#VAR} (length only).
echo "-- token-leak source audit: no echo/print of \$VAULT_BLOB / \$NEW_BLOB --"
leak_lines="$(grep -nE '(echo|printf|plan|err)[^#]*\$(VAULT_BLOB|NEW_BLOB)([^}]|$)' "$SCRIPT" | grep -vE '\$\{#(VAULT_BLOB|NEW_BLOB)\}' || true)"
# note: printf '%s' "$blob" | node ...  (piping blob to a node stdin) is NOT a print-to-terminal leak — it feeds a
# subprocess stdin. Exclude those (printf '%s' "$VAR" |) explicitly.
leak_lines="$(printf '%s\n' "$leak_lines" | grep -vE "printf '%s' \"\\\$(VAULT_BLOB|NEW_BLOB)\" \\|" | grep -vE '^$' || true)"
if [ -z "$leak_lines" ]; then
  PASS=$((PASS+1)); _green "audit OK: no print path echoes the raw blob variable"
else
  FAILED=$((FAILED+1)); _red "FAIL: token leak — a print statement references the blob var:"; printf '%s\n' "$leak_lines" >&2
fi

# ── teeth: a buggy BRE ^alice.x.com_ would match the DECOY line (proving awk index==1 is load-bearing). ──
echo "-- teeth: old grep -F over the overlap vault would grab the DECOY whole-line (proving awk index==1 is load-bearing) --"
old_prefix='alice@x.com_TOKEN='
old_line="$(grep -F -- "$old_prefix" "$VFILE4" 2>/dev/null | head -1)"
old_tok="${old_line#"$old_prefix"}"
if [ "${#old_tok}" -ne "${#ALICE_BLOB}" ] && printf '%s' "$old_tok" | grep -q '^xalice@x.com_TOKEN='; then
  PASS=$((PASS+1)); _green "teeth OK: old grep -F grabbed the decoy as a MALFORMED whole-line (len=${#old_tok} != real ${#ALICE_BLOB}) → awk index==1 fixes it"
else
  FAILED=$((FAILED+1)); _red "FAIL: teeth setup weak — old grep -F path did NOT reproduce the decoy capture (old_tok len=${#old_tok})"
fi

# ──────────────────────────────────────────────────────────────────────────────────────────────────
# (13) **128-BYTE TRUNCATION ROUND-TRIP (T16 regression防线·dogfood 逮到的根因)**.
#      real macOS `security add-generic-password ... -w`（末位不带值·从 stdin 读）走 readpassphrase，有 128 字节
#      硬上限——`{"claudeAiOauth":{...}}` 包裹官方凭证 ~471 字节，stdin 写会被截成 128 残片（非法 JSON·brick 掉官方
#      登录）。`-w "$wrapped"`（值作 argv）存完整。旧 stub 没建模截断 → 破形态全绿漏过（T16 活体）。这组用一个
#      FAITHFUL stub（argv→存完整 / stdin→截 128）+ 纯假 >400 字节 dummy 跑 round-trip + 反向截断锁。
# ──────────────────────────────────────────────────────────────────────────────────────────────────
echo "-- (13) 128-byte truncation round-trip: argv -w stores WHOLE wrapped blob; stdin double-feed bricks it --"
TRDIR="$(make_project)"
# faithful security stub: argv -w "<value>" → store WHOLE; bare -w (stdin) → store first 128 bytes only.
cat > "$TRDIR/security" <<'SEC'
#!/usr/bin/env bash
# faithful keychain stub modeling readpassphrase's 128-byte stdin cap (no real keychain touch).
is_add=0; is_read=0; wval=""; have_wval=0; prev=""
for a in "$@"; do
  [ "$a" = "add-generic-password" ] && is_add=1
  [ "$a" = "find-generic-password" ] && is_read=1
  [ "$prev" = "-w" ] && { wval="$a"; have_wval=1; }
  prev="$a"
done
if [ "$is_read" = 1 ]; then
  [ -n "${SEC_WRITE_CAPTURE:-}" ] && [ -f "$SEC_WRITE_CAPTURE" ] && cat "$SEC_WRITE_CAPTURE"
  exit 0
fi
if [ "$is_add" = 1 ]; then
  if [ "$have_wval" = 1 ]; then
    [ -n "${SEC_WRITE_CAPTURE:-}" ] && printf '%s' "$wval" > "$SEC_WRITE_CAPTURE"     # argv → WHOLE.
  else
    piped="$(cat)"; [ -n "${SEC_WRITE_CAPTURE:-}" ] && printf '%s' "$piped" | head -c 128 > "$SEC_WRITE_CAPTURE"  # stdin → 128.
  fi
  exit 0
fi
exit 0
SEC
chmod +x "$TRDIR/security"
# pure-FAKE wrapped blob > 400 bytes (no real token — only FAKE- prefixes).
TR_PAD="$(printf 'X%.0s' $(seq 1 200))"
TR_INNER="{\"accessToken\":\"FAKE-oat-${TR_PAD}\",\"refreshToken\":\"FAKE-ort-${TR_PAD}\",\"expiresAt\":1750000000000,\"subscriptionType\":\"max\"}"
TR_WRAPPED="{\"claudeAiOauth\":${TR_INNER}}"   # mirrors switch-account.sh ③ `local wrapped="{\"claudeAiOauth\":${blob}}"`.
tr_len=${#TR_WRAPPED}
if [ "$tr_len" -gt 128 ]; then PASS=$((PASS+1)); _green "(13) precondition: wrapped dummy is ${tr_len} bytes (> 128, truncation observable)"; else FAILED=$((FAILED+1)); _red "FAIL: (13) wrapped dummy only ${tr_len} bytes — pad more"; fi
# (13a) ARGV form (the production ③ write form) → read-back FULL + valid WRAPPED JSON with refreshToken.
TR_CAP_A="$TRDIR/cap-argv.txt"; : > "$TR_CAP_A"
PATH="$TRDIR:$PATH" SEC_WRITE_CAPTURE="$TR_CAP_A" security add-generic-password -U -s "Claude Code-credentials" -a "$USER" -w "$TR_WRAPPED" >/dev/null 2>&1
tr_a="$(PATH="$TRDIR:$PATH" SEC_WRITE_CAPTURE="$TR_CAP_A" security find-generic-password -w -s "Claude Code-credentials" -a "$USER" 2>/dev/null)"
assert_eq "$tr_len" "${#tr_a}" "(13a) argv -w \"\$wrapped\" round-trip: read-back is FULL ${tr_len} bytes (no 128 truncation)"
tr_a_shape="$(printf '%s' "$tr_a" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let o;try{o=JSON.parse(s)}catch(_e){process.stdout.write("BADJSON");return}const ok=o.claudeAiOauth&&typeof o.claudeAiOauth.refreshToken==="string"&&o.claudeAiOauth.refreshToken.length>0;process.stdout.write(ok?"OK":"NOREFRESH")})' 2>/dev/null)"
assert_eq "OK" "$tr_a_shape" "(13a) argv round-trip: read-back is VALID WRAPPED JSON carrying refreshToken (官方登录不被 brick)"
# (13b) REVERSE lock: the broken stdin double-feed → truncated 128-byte残片 → SHORTER + invalid JSON (the brick).
TR_CAP_S="$TRDIR/cap-stdin.txt"; : > "$TR_CAP_S"
printf '%s\n%s\n' "$TR_WRAPPED" "$TR_WRAPPED" | PATH="$TRDIR:$PATH" SEC_WRITE_CAPTURE="$TR_CAP_S" security add-generic-password -U -s "Claude Code-credentials" -a "$USER" -w >/dev/null 2>&1
tr_s="$(PATH="$TRDIR:$PATH" SEC_WRITE_CAPTURE="$TR_CAP_S" security find-generic-password -w -s "Claude Code-credentials" -a "$USER" 2>/dev/null)"
if [ "${#tr_s}" -eq 128 ]; then PASS=$((PASS+1)); _green "(13b) reverse lock: stdin double-feed write TRUNCATED to exactly 128 bytes (faithful readpassphrase model)"; else FAILED=$((FAILED+1)); _red "FAIL: (13b) stdin write read-back was ${#tr_s} bytes, expected 128 (truncation model broken)"; fi
tr_s_shape="$(printf '%s' "$tr_s" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{JSON.parse(s);process.stdout.write("JSON-OK")}catch(_e){process.stdout.write("BADJSON")}})' 2>/dev/null)"
assert_eq "BADJSON" "$tr_s_shape" "(13b) reverse lock: the 128-byte残片 is INVALID JSON (the official-login brick the stdin form would cause)"
case "$TR_WRAPPED" in *sk-ant-*) FAILED=$((FAILED+1)); _red "FAIL: (13) wrapped dummy accidentally contains an sk-ant- token string";; *) PASS=$((PASS+1)); _green "(13) wrapped dummy is pure FAKE data (no sk-ant- token string)";; esac
rm -rf "$TRDIR"

# ──────────────────────────────────────────────────────────────────────────────────────────────────
# (14) **真 switch dogfood bug 2 teeth — cc-usage 降级（used_pct 缺失）→ 切出快照干净跳过、NO node stack trace**.
#      病根（实测现场）：切出快照的 used_pct 取自 cc-usage；降级/超时时 intPct → undefined，旧码把 undefined 塞进
#      snap → recordSwitchOut → saveRegistry 硬校验拒写 → **throw + 吐 node stack trace + 「saveRegistry 拒写：…
#      used_pct 必须是 0-100 整数（当前：undefined）」** 泄到用户面前（看着像崩，其实换号核心 active 已翻转）。
#      修：构造/落盘快照前先判 used_pct 有效——任一窗口非 0-100 整数 → **干净跳过**（exit 0·清爽一行提示·绝不调用
#      会 throw 的 saveRegistry）。case (9) 已断言 last_switch_out 仍 null + active 仍翻；本 case 加 **NO-STACK-TRACE**
#      的牙齿（这正是 dogfood 暴露、case (9) 没盯住的那一面）：① 清爽跳过提示在；② node stack trace / 「saveRegistry
#      拒写」/「used_pct 必须是」绝不出现；③ 换号核心仍完成。两个降级形态：(14a) cc-usage 出 local-fallback（无
#      used_percentage）；(14b) cc-usage 完全空输出（超时被 kill 的等价形态·usageRaw 空串）。
# ──────────────────────────────────────────────────────────────────────────────────────────────────
run_degraded_switch() { # $1 = cc-usage stub body → echo combined stdout+stderr of the switch run
  local cu_body="$1"
  local fx; fx="$(make_fixture)"
  local reg="$fx/accounts.json" vfile="$fx/accounts.env" cred="$fx/credentials.json" cjson="$fx/claude.json"
  cat > "$reg" <<JSON
{ "schema": "cc-master/accounts/v1", "accounts": {
  "bob@y.com":   { "vault": {"kind":"keychain","service":"cc-master-oauth","account":"bob@y.com"}, "active": true, "last_switch_out": null },
  "alice@x.com": { "vault": {"kind":"file","path":"$vfile","key":"alice@x.com"}, "active": false, "last_switch_out": null }
} }
JSON
  umask 077
  printf 'alice@x.com_TOKEN=%s\n' "{\"accessToken\":\"$ALICE_AT\",\"refreshToken\":\"$ALICE_RT\",\"expiresAt\":1700000000000}" > "$vfile"; chmod 600 "$vfile"
  cat > "$cred" <<'JSON'
{"claudeAiOauth":{"accessToken":"sk-ant-oat01-OLD14000000000000000000000-_o","refreshToken":"sk-ant-ort01-OLD14r00000000000000000-_o","expiresAt":1700000000000}}
JSON
  printf '{}' > "$cjson"
  local sroot; sroot="$(make_project)"
  mkdir -p "$sroot/skills/account-management/scripts" "$sroot/skills/orchestrating-to-completion/scripts"
  ln -s "$PLUGIN_ROOT/skills/account-management/scripts/switch-account.sh" "$sroot/skills/account-management/scripts/switch-account.sh"
  ln -s "$PLUGIN_ROOT/skills/account-management/scripts/accounts-lib.js"   "$sroot/skills/account-management/scripts/accounts-lib.js"
  ln -s "$PLUGIN_ROOT/skills/account-management/scripts/select-account.js" "$sroot/skills/account-management/scripts/select-account.js"
  printf '%s\n' "$cu_body" > "$sroot/skills/orchestrating-to-completion/scripts/cc-usage.sh"
  chmod +x "$sroot/skills/orchestrating-to-completion/scripts/cc-usage.sh"
  local port="$fx/url.txt"; start_refresh_endpoint ok "$port"; local rurl; rurl="$(cat "$port")"
  local out rc
  out="$(PATH="$SECSTUB:$PATH" CLAUDE_PLUGIN_ROOT="$sroot" REFRESH_TOKEN_URL="$rurl" CRED_PATH="$cred" CLAUDE_JSON_PATH="$cjson" \
         bash "$sroot/skills/account-management/scripts/switch-account.sh" --registry "$reg" --email "alice@x.com" --now "2026-06-17T09:00:00Z" 2>&1)"; rc=$?
  # stash for the asserts (registry path + rc + out via globals).
  DG_OUT="$out"; DG_RC="$rc"; DG_REG="$reg"; DG_FX="$fx"; DG_SROOT="$sroot"
}

# (14a) local-fallback cc-usage (no used_percentage) → snapshot.used_pct undefined → must SKIP cleanly, no trace.
run_degraded_switch '#!/usr/bin/env bash
printf "%s\n" "{\"source\":\"local-derived-approx\",\"five_hour\":{\"used_tokens\":1234,\"window_remaining_min\":120},\"seven_day\":{\"used_tokens\":5678,\"window_remaining_min\":4000}}"'
assert_eq "0" "$DG_RC" "(14a) bug2: degraded cc-usage (no used_pct) → switch STILL completes (exit 0)"
assert_contains "$DG_OUT" "无重启换号完成" "(14a) bug2: 换号核心仍完成（三存储覆写 + active 翻转）"
assert_contains "$DG_OUT" "跳过本次切出配额快照" "(14a) bug2: prints the CLEAN one-line skip notice (not a stack trace)"
# CORE TEETH — the node stack trace / saveRegistry-拒写 / used_pct-校验 message must NEVER leak to the user.
assert_not_contains "$DG_OUT" "saveRegistry 拒写"          "(14a) bug2 CORE: NO 'saveRegistry 拒写' node throw message leaks"
assert_not_contains "$DG_OUT" "used_pct 必须是 0-100"      "(14a) bug2 CORE: NO 'used_pct 必须是 0-100 整数（当前：undefined）' validation throw leaks"
assert_not_contains "$DG_OUT" "    at "                     "(14a) bug2 CORE: NO node stack-trace frame ('    at …') leaks to the user"
assert_not_contains "$DG_OUT" "写切出快照失败"            "(14a) bug2: the ugly snapshot-FAILED err path is NOT taken (clean skip instead)"
#换号核心未被快照跳过连累：active 仍翻、bob.last_switch_out 仍 null（快照本就被干净跳过、不写 undefined）。
dg14a_alice="$(node -e 'const r=require(process.argv[1]).loadRegistry(process.argv[2]);process.stdout.write(String(r.accounts["alice@x.com"].active))' "$LIB_JS" "$DG_REG" 2>/dev/null)"
dg14a_bob="$(node -e 'const r=require(process.argv[1]).loadRegistry(process.argv[2]);process.stdout.write(String(r.accounts["bob@y.com"].active))' "$LIB_JS" "$DG_REG" 2>/dev/null)"
assert_eq "true"  "$dg14a_alice" "(14a) bug2: setActive STILL flipped alice → active=true (snapshot skip never连累换号核心)"
assert_eq "false" "$dg14a_bob"   "(14a) bug2: bob → active=false (independent setActive save unaffected)"
dg14a_lso="$(node -e 'const r=require(process.argv[1]).loadRegistry(process.argv[2]);process.stdout.write(r.accounts["bob@y.com"].last_switch_out?"SET":"null")' "$LIB_JS" "$DG_REG" 2>/dev/null)"
assert_eq "null" "$dg14a_lso" "(14a) bug2: NO undefined-used_pct snapshot written (cleanly skipped, registry not polluted)"
assert_not_contains "$DG_OUT" "$ALICE_RT" "(14a) bug2: no token leak on the degraded-snapshot path"
rm -rf "$DG_FX" "$DG_SROOT"

# (14b) EMPTY cc-usage output (timeout-killed equivalent · usageRaw 空串 → usage null → win() used_pct undefined).
#       Doubles as the **set -u empty-array regression** teeth: this run takes the cc_args 空数组 + "${cu_args[@]:-}"
#       expansion path (NOW_OVERRIDE 透传, but the empty-array guard must not 崩) — if line-377 weren't guarded it
#       would die with `cu_args[@]: unbound variable` before even reaching the snapshot logic.
run_degraded_switch '#!/usr/bin/env bash
# empty output (models a cc-usage that produced nothing — e.g. killed by the watchdog timeout).
exit 0'
assert_eq "0" "$DG_RC" "(14b) bug2: empty-output cc-usage → switch STILL completes (exit 0)"
assert_contains "$DG_OUT" "无重启换号完成" "(14b) bug2: 换号核心仍完成 under empty cc-usage output"
assert_contains "$DG_OUT" "跳过本次切出配额快照" "(14b) bug2: clean skip notice on empty cc-usage output too"
assert_not_contains "$DG_OUT" "    at " "(14b) bug2 CORE: NO node stack-trace frame leaks on empty-output path"
assert_not_contains "$DG_OUT" "unbound variable" "(14b) bug1 set-u: NO 'unbound variable' crash (empty cu_args array guarded with \${cu_args[@]:-})"
rm -rf "$DG_FX" "$DG_SROOT"

# (14c) **set -u empty-array expansion regression (isolated · bug 1 root)**. Mirror the exact line-377 pattern under
#       `set -u` on bash 3.2 (macOS floor): an empty array expanded as "${arr[@]}" DIES (unbound variable); the
#       guarded "${arr[@]:-}" survives. This is the direct unit-teeth for the cu_args footgun (round-3 只扫了
#       `shift 2`、漏了数组展开).
echo "-- (14c) set -u empty-array expansion regression (bug 1 root: \"\${arr[@]}\" on empty array dies; \"\${arr[@]:-}\" survives) --"
if bash -c 'set -uo pipefail; a=(); printf "%s" "${a[@]}"' >/dev/null 2>&1; then
  # On a bash where empty "${a[@]}" does NOT die, the teeth are weak — note it but don't fail (newer bash 4.4+ relaxed this).
  PASS=$((PASS+1)); _green "(14c) note: this bash does not die on empty \"\${a[@]}\" (4.4+ relaxed) — guard still correct, teeth weaker here"
else
  PASS=$((PASS+1)); _green "(14c) confirmed: empty \"\${a[@]}\" DIES under set -u (the cu_args footgun) on this bash"
fi
# the guarded form must ALWAYS survive (this is what the fix uses).
if bash -c 'set -uo pipefail; a=(); printf "%s" "${a[@]:-}"' >/dev/null 2>&1; then
  PASS=$((PASS+1)); _green "(14c) guarded \"\${a[@]:-}\" survives empty-array expansion under set -u (the line-377 fix)"
else
  FAILED=$((FAILED+1)); _red "FAIL: (14c) guarded \"\${a[@]:-}\" unexpectedly died — the bug1 fix idiom is wrong"
fi
# structural lock: the LIVE cc_args expansion in the script must be the GUARDED form (not the bare "${cu_args[@]}").
if grep -vE '^[[:space:]]*#' "$SCRIPT" | grep -qE '"\$\{cu_args\[@\]\}"'; then
  FAILED=$((FAILED+1)); _red "FAIL: (14c) a LIVE bare \"\${cu_args[@]}\" expansion survives (set -u unbound-variable crash on empty array)"
else
  PASS=$((PASS+1)); _green "(14c) no live bare \"\${cu_args[@]}\" expansion (cu_args uses the \${cu_args[@]:-} guard)"
fi

# kill any lingering stub endpoints.
for p in "${ENDPOINT_PIDS[@]}"; do kill "$p" 2>/dev/null || true; done
rm -rf "$SECSTUB" "$SECSTUB_CAPTURE" "$SECSTUB_FAIL" "$FX1" "$FX1B" "$FX2" "$FX3" "$FX4" "$FX5" "$STUB_ROOT5" "$FX5D" "$FX5E" "$FX6" "$FX8" "$FX9" "$STUB_ROOT9" "$FX10" "$FX11" "$FX11B" "$STUB_ROOT11B"

finish
