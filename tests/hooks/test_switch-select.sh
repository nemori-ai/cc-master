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

# **refresh 端点白名单（codex round#7 Finding A）**：生产里 refresh_blob 只向授权 Claude/Anthropic 主机（或显式 opt-in
#   的 loopback）发 refresh token，防污染 env 把 token exfiltrate 到任意端点。本套件全用 loopback stub endpoint
#   （http://127.0.0.1:PORT/…）→ 需显式 opt-in 才放行。在此**统一 export** 让所有真切 case 的 stub refresh 通过白名单。
#   （专测白名单**拒绝**未授权端点的 case 会在自己作用域内 unset / 覆盖它·见 (23)。）
export CCM_ALLOW_LOOPBACK_REFRESH=1

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
# (5f) **codex round#2 — credentials.json PRE-EXISTS but its SNAPSHOT can't be created → FAIL-CLOSED: abort
#      BEFORE overwriting ANY store (全或无前提硬化·split-brain 防于未然)**.
#      演进：round-3 P2-c 让「快照失败后 ③ 又失败」时如实报 split-brain（不谎报已回滚）。codex round#2 更进一步——
#      全或无的前提是「能回滚」，而能回滚的前提是「快照成功」；故快照 cp 失败时**根本不该开始覆写**。修：必需快照
#      （pre-existing 文件）cp 失败 → 在覆写任何存储之前 return 1 中止——三存储原封不动、换号未发生·可重试，绝不进
#      「覆写了却回不去」的险态（连 split-brain 风险都不进，而非进了再如实报）。
#      复现手法（hermetic·deterministic）：装一个 `mktemp` STUB——对 BARE `mktemp`（snapshot 用·无模板 arg）返回一个
#      指向 chmod 000 不可写目录的路径（exit 0）→ 脚本把它当 SNAP_*_TMP → 随后 `cp` 写不进去 → snapshot 失败 →
#      新行为：立刻中止、不覆写。对**带模板**的 mktemp（如 select 的 `.ccm-sel-err.XXXXXX`）委派给真 mktemp。
#      断言：exit非0、stderr 报「中止换号」+ 仍提示 split-brain（说明为何中止）、**三存储原封不动（OLD·从未被覆写）**、
#      registry 未翻、无 token 泄漏。（注意：SECSTUB_FAIL 仍在 PATH，但新代码在快照阶段就 abort·根本到不了 ③ keychain。）
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
# Official stores PRE-EXIST in the (writable) fixture dir — the SNAPSHOT is what fails, so (new fail-closed behavior)
#   the switch ABORTS before overwriting them: these OLD values must remain INTACT (never overwritten).
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
# mktemp stub on PATH → snapshot cp fails → NEW fail-closed: abort BEFORE overwrite (never reaches ③·SECSTUB_FAIL moot).
out5f="$(PATH="$MTSTUB_5F:$SECSTUB_FAIL:$PATH" CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" REFRESH_TOKEN_URL="$RURL5F" CRED_PATH="$CRED5F" CLAUDE_JSON_PATH="$CJSON5F" \
        bash "$SCRIPT" --registry "$REG5F" --email "alice@x.com" --now "2026-06-17T09:00:00Z" 2>&1)"; rc5f=$?
chmod 755 "$BADTMP_5F" 2>/dev/null || true   # restore perms so the fixture dir cleans up.
assert_eq "1" "$rc5f" "(5f) fail-closed: snapshot failure → exit非0 (switch did NOT proceed)"
# stderr says ABORTED换号 + explains it's to avoid split-brain (no rollback needed because nothing was overwritten).
assert_contains "$out5f" "中止换号" "(5f) fail-closed: surfaces 中止换号 (aborts BEFORE overwriting any store)"
assert_contains "$out5f" "split-brain" "(5f) fail-closed: explains WHY it aborts (无快照则后续失败无法回滚·会 split-brain)"
# **CORE**: the OLD official stores must be UNCHANGED — abort happened BEFORE any overwrite (the new fail-closed win).
cred5f_at="$(node -e 'const j=require(process.argv[1]);process.stdout.write(j.claudeAiOauth.accessToken)' "$CRED5F" 2>/dev/null)"
assert_eq "$OLD_CRED_AT_5F" "$cred5f_at" "(5f) fail-closed CORE: ① credentials.json UNCHANGED (OLD token·never overwritten — abort前置于覆写)"
assert_not_contains "$cred5f_at" "$FRESH_AT" "(5f) fail-closed: ① is NOT the FRESH token (no overwrite happened at all)"
cj5f_email="$(node -e 'const j=require(process.argv[1]);process.stdout.write(j.oauthAccount.emailAddress||"NONE")' "$CJSON5F" 2>/dev/null)"
assert_eq "old@x.com" "$cj5f_email" "(5f) fail-closed: ② ~/.claude.json oauthAccount UNCHANGED old@x.com (never overwritten)"
# registry active NOT flipped — the switch aborted (caller saw return 1 → never setActive).
alice5f="$(node -e 'const r=require(process.argv[1]).loadRegistry(process.argv[2]);process.stdout.write(String(r.accounts["alice@x.com"].active))' "$LIB_JS" "$REG5F" 2>/dev/null)"
bob5f="$(node -e 'const r=require(process.argv[1]).loadRegistry(process.argv[2]);process.stdout.write(String(r.accounts["bob@y.com"].active))' "$LIB_JS" "$REG5F" 2>/dev/null)"
assert_eq "false" "$alice5f" "(5f) fail-closed: registry alice active NOT flipped (switch aborted)"
assert_eq "true"  "$bob5f"   "(5f) fail-closed: registry bob still active=true"
# token no-leak on the aborted path.
assert_not_contains "$out5f" "$ALICE_RT" "(5f) fail-closed: alice refresh token does NOT leak on the aborted path"
assert_not_contains "$out5f" "$FRESH_RT" "(5f) fail-closed: fresh refresh token does NOT leak on the aborted path"
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
# (7) --board no longer drives board resume (无重启换号不重启进程) and stays OPTIONAL; it is now repurposed
#     as the policy 闸的确定性目标板 selector (codex P1·见下方 37 系列). Missing --board must NOT fail.
# ──────────────────────────────────────────────────────────────────────────────────────────────────
out7="$(CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" bash "$SCRIPT" --registry "$REG1" --now "2026-06-17T09:00:00Z" --dry-run --skip-token-check 2>&1)"; rc7=$?
assert_eq "0" "$rc7" "(7) missing --board → still works (--board optional, not required)"
# and passing --board is harmless (annotated as policy selector in dry-run plan; never resumes a board).
out7b="$(CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" bash "$SCRIPT" --board "b.board.json" --registry "$REG1" --now "2026-06-17T09:00:00Z" --dry-run --skip-token-check 2>&1)"; rc7b=$?
assert_eq "0" "$rc7b" "(7b) passing --board still exits 0 (harmless·policy selector·never resumes)"
assert_contains "$out7b" "policy selector" "(7b) dry-run plan marks --board as policy selector (不再 resume·codex P1)"

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

# ──────────────────────────────────────────────────────────────────────────────────────────────────
# (15) **codex round#1 Finding 2 teeth — split-brain 窗口收口：setActive 在（可慢/可挂的）切出快照之前翻**.
#      病根：旧顺序「先 best-effort 快照（内含可挂的 cc-usage·timeout 默认已调到 60s）再 setActive」——三存储已覆写
#      成新号、但 registry active 要等快照那一长段之后才翻；这段窗口里中断/被 kill = 机器在新号、registry 仍旧号
#      （split-brain）。修：把关键态 setActive 提到快照之前——三存储一覆写成功就立刻翻 active。切出号身份在翻 active
#      之前先钉进 CURRENT_ACTIVE（翻后 registry active 已是切入号·不先钉会把切入号误当切出号跳过快照）。
#      teeth：用 FAST cc-usage stub（快照真跑、真写）→ 断言 ① alice 已 active=true（关键态翻了）；② bob 的
#      last_switch_out 快照仍被正确写出（证明 CURRENT_ACTIVE 在翻 active **之前**钉对了 = bob，没被翻成 alice 后
#      误判 current==switch-in 而跳过快照）；③ 结构锁：脚本里 set_active_in 调用必须排在 record_switch_out **之前**.
# ──────────────────────────────────────────────────────────────────────────────────────────────────
FX15="$(make_fixture)"; REG15="$FX15/accounts.json"; VFILE15="$FX15/accounts.env"; CRED15="$FX15/credentials.json"; CJSON15="$FX15/claude.json"
cat > "$REG15" <<JSON
{ "schema": "cc-master/accounts/v1", "accounts": {
  "bob@y.com":   { "vault": {"kind":"keychain","service":"cc-master-oauth","account":"bob@y.com"}, "active": true, "last_switch_out": null },
  "alice@x.com": { "vault": {"kind":"file","path":"$VFILE15","key":"alice@x.com"}, "active": false, "last_switch_out": null }
} }
JSON
umask 077
printf 'alice@x.com_TOKEN=%s\n' "{\"accessToken\":\"$ALICE_AT\",\"refreshToken\":\"$ALICE_RT\",\"expiresAt\":1700000000000}" > "$VFILE15"; chmod 600 "$VFILE15"
cat > "$CRED15" <<'JSON'
{"claudeAiOauth":{"accessToken":"sk-ant-oat01-OLD1500000000000000000000-_o","refreshToken":"sk-ant-ort01-OLD15r0000000000000000-_o","expiresAt":1700000000000}}
JSON
printf '{}' > "$CJSON15"
# stub plugin root with a FAST cc-usage (returns immediately with valid used_percentage → snapshot actually writes).
STUB_ROOT15="$(make_project)"
mkdir -p "$STUB_ROOT15/skills/account-management/scripts" "$STUB_ROOT15/skills/orchestrating-to-completion/scripts"
ln -s "$PLUGIN_ROOT/skills/account-management/scripts/switch-account.sh" "$STUB_ROOT15/skills/account-management/scripts/switch-account.sh"
ln -s "$PLUGIN_ROOT/skills/account-management/scripts/accounts-lib.js"   "$STUB_ROOT15/skills/account-management/scripts/accounts-lib.js"
ln -s "$PLUGIN_ROOT/skills/account-management/scripts/select-account.js" "$STUB_ROOT15/skills/account-management/scripts/select-account.js"
cat > "$STUB_ROOT15/skills/orchestrating-to-completion/scripts/cc-usage.sh" <<'CU'
#!/usr/bin/env bash
printf '%s\n' '{"source":"account","five_hour":{"used_percentage":42,"resets_at":4102444800},"seven_day":{"used_percentage":17,"resets_at":4102444800}}'
CU
chmod +x "$STUB_ROOT15/skills/orchestrating-to-completion/scripts/cc-usage.sh"
PORT15="$FX15/url.txt"; start_refresh_endpoint ok "$PORT15"; RURL15="$(cat "$PORT15")"
out15="$(PATH="$SECSTUB:$PATH" CLAUDE_PLUGIN_ROOT="$STUB_ROOT15" REFRESH_TOKEN_URL="$RURL15" CRED_PATH="$CRED15" CLAUDE_JSON_PATH="$CJSON15" \
         bash "$STUB_ROOT15/skills/account-management/scripts/switch-account.sh" --registry "$REG15" --email "alice@x.com" --now "2026-06-17T09:00:00Z" 2>&1)"; rc15=$?
assert_eq "0" "$rc15" "(15) Finding 2: switch completes exit 0"
# ① 关键态 setActive 翻了（alice active=true / bob false）—— 三存储覆写成功就立刻翻、不等快照.
alice15="$(node -e 'const r=require(process.argv[1]).loadRegistry(process.argv[2]);process.stdout.write(String(r.accounts["alice@x.com"].active))' "$LIB_JS" "$REG15" 2>/dev/null)"
bob15="$(node -e 'const r=require(process.argv[1]).loadRegistry(process.argv[2]);process.stdout.write(String(r.accounts["bob@y.com"].active))' "$LIB_JS" "$REG15" 2>/dev/null)"
assert_eq "true"  "$alice15" "(15) Finding 2: setActive flipped alice → active=true (关键态先翻·split-brain 窗口收口)"
assert_eq "false" "$bob15"   "(15) Finding 2: bob → active=false"
# ② bob 的 last_switch_out 快照仍被写出——证明切出号身份在翻 active **之前**就钉对了（=bob），否则翻成 alice 后
#    record_switch_out 会 detect 到 active==alice==switch-in → 误判「已是该号」跳过快照。这是 reorder 正确性的硬证.
bob15_snap="$(node -e 'const e=(require(process.argv[1]).loadRegistry(process.argv[2]).accounts||{})["bob@y.com"]||{};const q=e.last_switch_out;process.stdout.write(q&&q["5h"]?String(q["5h"].used_pct):"NONE")' "$LIB_JS" "$REG15" 2>/dev/null)"
assert_eq "42" "$bob15_snap" "(15) Finding 2: bob's last_switch_out STILL recorded (CURRENT_ACTIVE 在翻 active 前钉对=bob·没被翻成 alice 后误跳过快照)"
assert_not_contains "$out15" "$ALICE_RT" "(15) Finding 2: no token leak"
# ③ 结构锁：set_active_in 的调用必须排在 record_switch_out 的调用之前（reorder 是 load-bearing·防回归）.
#    在去注释后的脚本里抓 step-4 这两个调用的行号——set_active_in 行号 < record_switch_out 行号才算修对.
sa_line="$(grep -vE '^[[:space:]]*#' "$SCRIPT" | grep -nE '^[[:space:]]*set_active_in[[:space:]]*$|^[[:space:]]*set_active_in[[:space:]]+#' | tail -1 | cut -d: -f1)"
rso_line="$(grep -vE '^[[:space:]]*#' "$SCRIPT" | grep -nE '^[[:space:]]*record_switch_out([[:space:]]|$)' | tail -1 | cut -d: -f1)"
if [ -n "$sa_line" ] && [ -n "$rso_line" ] && [ "$sa_line" -lt "$rso_line" ]; then
  PASS=$((PASS+1)); _green "(15) Finding 2 structural lock: set_active_in CALLED before record_switch_out (reorder is load-bearing)"
else
  FAILED=$((FAILED+1)); _red "FAIL: (15) Finding 2 set_active_in (line $sa_line) NOT before record_switch_out (line $rso_line) — split-brain window reopened"
fi

# ──────────────────────────────────────────────────────────────────────────────────────────────────
# (16) **codex round#1 Finding 1 teeth — ② 身份切换写真失败 → 回滚 ① 到旧号（避免 split-identity·三存储全或无）**.
#      病根：身份切换路（identity 在·② 文件在·合法 JSON）若 atomicWrite 真失败（权限/锁/IO），旧码静默吞、仍让 ①③
#      切到新号 → ① 是新号 token、② oauthAccount 仍旧号 = split-identity。修：身份切换路的 atomicWrite 失败 exit 2 →
#      caller 回滚 ① 到旧号，三存储全留旧号、换号未发生·可重试。复现（hermetic·deterministic）：把 ② ~/.claude.json
#      所在**目录设只读**（文件预存合法 JSON·existsSync/read 成功，但 atomicWrite 的 tmp 写不进去 → throw → exit 2）。
#      断言：① credentials.json 回滚到旧 token（非 FRESH）；② emailAddress 仍旧号；registry active 未翻；exit非0；
#      stderr 报回滚；无 token 泄漏。
# ──────────────────────────────────────────────────────────────────────────────────────────────────
FX16="$(make_fixture)"; REG16="$FX16/accounts.json"; VFILE16="$FX16/accounts.env"
CRED16="$FX16/credentials.json"; CJDIR16="$FX16/cjdir"; CJSON16="$CJDIR16/claude.json"
mkdir -p "$CJDIR16"
cat > "$REG16" <<JSON
{ "schema": "cc-master/accounts/v1", "accounts": {
  "bob@y.com":   { "vault": {"kind":"keychain","service":"cc-master-oauth","account":"bob@y.com"}, "active": true, "last_switch_out": null },
  "alice@x.com": { "vault": {"kind":"file","path":"$VFILE16","key":"alice@x.com"}, "token_expires_at":"2027-06-17T10:40:00Z", "active": false, "last_switch_out": null, "identity": {"emailAddress":"new@y.com","accountUuid":"uuid-new","organizationName":"NewOrg","subscriptionType":"max"} }
} }
JSON
umask 077
printf 'alice@x.com_TOKEN=%s\n' "{\"accessToken\":\"$ALICE_AT\",\"refreshToken\":\"$ALICE_RT\",\"expiresAt\":1700000000000,\"subscriptionType\":\"max\"}" > "$VFILE16"; chmod 600 "$VFILE16"
OLD_CRED_AT_16='sk-ant-oat01-OLD16cred0000000000000000000-_o'
cat > "$CRED16" <<'JSON'
{"claudeAiOauth":{"accessToken":"sk-ant-oat01-OLD16cred0000000000000000000-_o","refreshToken":"sk-ant-ort01-OLD16credr000000000000000-_o","expiresAt":1700000000000,"subscriptionType":"pro"},"keepThisKey":"keepme"}
JSON
# ② ~/.claude.json PRE-EXISTS with valid JSON (existsSync true·read OK)—but its DIR is made read-only so the
#   identity-switch atomicWrite (tmp write+rename inside that dir) FAILS → 触发 exit 2 → rollback ①.
cat > "$CJSON16" <<'JSON'
{"oauthAccount":{"emailAddress":"old@x.com","subscriptionType":"pro","organizationName":"OldOrg"},"numStartups":42,"theme":"dark"}
JSON
chmod 500 "$CJDIR16"   # read-only dir → atomicWrite tmp creation fails → ② identity write throws.
PORT16="$FX16/url.txt"; start_refresh_endpoint ok "$PORT16"; RURL16="$(cat "$PORT16")"
out16="$(PATH="$SECSTUB:$PATH" CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" REFRESH_TOKEN_URL="$RURL16" CRED_PATH="$CRED16" CLAUDE_JSON_PATH="$CJSON16" \
        bash "$SCRIPT" --registry "$REG16" --email "alice@x.com" --now "2026-06-17T09:00:00Z" --no-snapshot 2>&1)"; rc16=$?
chmod 700 "$CJDIR16"   # restore so we can read/cleanup.
assert_eq "1" "$rc16" "(16) Finding 1: ② identity write failure → switch did NOT succeed → exit非0"
# ① credentials.json ROLLED BACK to OLD access token (NOT the FRESH one) — all-or-nothing prevented split-identity.
cred16_at="$(node -e 'const j=require(process.argv[1]);process.stdout.write(j.claudeAiOauth.accessToken)' "$CRED16" 2>/dev/null)"
assert_eq "$OLD_CRED_AT_16" "$cred16_at" "(16) Finding 1: ① credentials.json ROLLED BACK to OLD token (not FRESH·避免 split-identity)"
assert_not_contains "$cred16_at" "$FRESH_AT" "(16) Finding 1: ① is NOT the FRESH token (rollback undid the ①写)"
# ② emailAddress still old号 (the failed write never landed new@y.com).
cj16_email="$(node -e 'const j=require(process.argv[1]);process.stdout.write(j.oauthAccount.emailAddress||"NONE")' "$CJSON16" 2>/dev/null)"
assert_eq "old@x.com" "$cj16_email" "(16) Finding 1: ② oauthAccount.emailAddress still old@x.com (身份写失败·没切成新号)"
# registry active NOT flipped — caller saw return 1, never setActive.
alice16="$(node -e 'const r=require(process.argv[1]).loadRegistry(process.argv[2]);process.stdout.write(String(r.accounts["alice@x.com"].active))' "$LIB_JS" "$REG16" 2>/dev/null)"
bob16="$(node -e 'const r=require(process.argv[1]).loadRegistry(process.argv[2]);process.stdout.write(String(r.accounts["bob@y.com"].active))' "$LIB_JS" "$REG16" 2>/dev/null)"
assert_eq "false" "$alice16" "(16) Finding 1: registry alice active NOT flipped (switch aborted·no split-brain in registry)"
assert_eq "true"  "$bob16"   "(16) Finding 1: registry bob still active=true"
assert_contains "$out16" "回滚" "(16) Finding 1: stderr surfaces ① 回滚 (换号未发生·可重试·避免 split-identity)"
assert_not_contains "$out16" "$FRESH_RT" "(16) Finding 1: no token leak on the ②-failure rollback path"
assert_not_contains "$out16" "$ALICE_RT" "(16) Finding 1: alice refresh token does NOT leak on rollback path"

# ──────────────────────────────────────────────────────────────────────────────────────────────────
# (17) **codex round#2 Finding D teeth — 临近到期降权不该伪装成「全员逼顶」（quota-healthy 仍被选中·只警告续期）**.
#      病根：单个 quota-健康但临近到期的候选——70%/70% 配额分 = 0.4*30+0.6*30 = 30，减 EXPIRY_PENALTY(默认40) = -10
#      ≤ 地板(0) → 旧码 best.score 判地板 → 误报 NONE_ALL_EXHAUSTED·exit 3，白挡一次合法换号（违背「到期只降权不
#      排除」文档语义）。修：地板判**到期降权之前的配额分**（scoreForExhaustionFloor），故该号仍 SELECTED·exit 0、
#      只附「将到期·建议 --refresh」警告。teeth：直接跑 select-account.js CLI（带 --now·确定性）断言 exit 0 + 选中.
# ──────────────────────────────────────────────────────────────────────────────────────────────────
FX17="$(make_fixture)"; REG17="$FX17/accounts.json"
# alice: 70%/70% used (quota分=30·健康·远高于地板) BUT token_expires_at 仅 5 天后（≤14 天预警·触发 EXPIRY_PENALTY）.
#   now=2026-06-17 → expires=2026-06-22（5 天后）. 7d 70% < 85% 硬闸（非 gated·确保走到期降权分支而非硬闸分支）.
cat > "$REG17" <<JSON
{ "schema": "cc-master/accounts/v1", "accounts": {
  "bob@y.com":   { "vault": {"kind":"keychain","service":"cc-master-oauth","account":"bob@y.com"}, "active": true, "last_switch_out": null },
  "alice@x.com": { "vault": {"kind":"keychain","service":"cc-master-oauth","account":"alice@x.com"}, "token_expires_at":"2026-06-22T00:00:00Z", "active": false,
                   "last_switch_out": {"at":"2026-06-17T05:00:00Z","5h":{"used_pct":70,"resets_at":"2026-06-24T05:00:00Z","source":"account"},"7d":{"used_pct":70,"resets_at":"2026-06-24T05:00:00Z","source":"account"}} }
} }
JSON
# run select-account.js CLI directly (deterministic --now). Default (no --json) → prints selected email + exit code.
sel17="$(node "$SELECT_JS" --registry "$REG17" --now "2026-06-17T09:00:00Z" 2>/tmp/.ccm17err.$$)"; sel17_rc=$?
sel17_err="$(cat /tmp/.ccm17err.$$ 2>/dev/null || true)"; rm -f /tmp/.ccm17err.$$ 2>/dev/null || true
assert_eq "0" "$sel17_rc" "(17) Finding D: quota-健康 but expiring-soon号 is SELECTED (exit 0·NOT exit 3 false-exhausted)"
assert_eq "alice@x.com" "$sel17" "(17) Finding D: selected = alice@x.com (到期降权只降排名·不排除·不误报全员逼顶)"
assert_contains "$sel17_err" "天后到期" "(17) Finding D: still warns it's expiring soon (建议 --refresh·降权不静默)"
# negative control via --json: reason must be SELECTED, not NONE_ALL_EXHAUSTED.
sel17j="$(node "$SELECT_JS" --registry "$REG17" --now "2026-06-17T09:00:00Z" --json 2>/dev/null)"
sel17_reason="$(printf '%s' "$sel17j" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(JSON.parse(s).reason||"NONE")}catch(_e){process.stdout.write("PARSEERR")}})' 2>/dev/null)"
assert_eq "SELECTED" "$sel17_reason" "(17) Finding D: reason=SELECTED (not NONE_ALL_EXHAUSTED·地板判配额分·非含到期降权的分)"
rm -rf "$FX17"

# ──────────────────────────────────────────────────────────────────────────────────────────────────
# (18) **codex round#2 Finding B teeth — setActive saveRegistry 失败 → 不谎报干净成功（exit 4·如实标注 registry 滞后）**.
#      病根：set_active_in 落盘失败时 return 0 + 主流程仍打印「✓ 换号完成」——三存储已是新号、registry active 没翻 =
#      registry 与现实脱节（后续选号 / 切出快照从 stale active 推理·split-brain 复现），却谎报干净成功。修：置
#      ACTIVE_WRITE_FAILED=1，最终消息标注「换号已生效·但 registry 需手动对账」+ exit 4（≠干净成功的 0）。
#      复现（hermetic·deterministic）：registry 放进一个独立目录，三存储覆写成功**之后**把该目录设只读 → setActive 的
#      saveRegistry（写 tmp+rename 进该目录）失败。用 `--email`（跳过 select·不提前写 registry）+ `--no-snapshot`
#      （跳过 record_switch_out·set_active_in 是唯一 registry 写）确保只在 setActive 处失败。注意：registry 在只读目录里
#      仍可**读**（loadRegistry / detect 不受影响），只有**写**失败。
# ──────────────────────────────────────────────────────────────────────────────────────────────────
FX18="$(make_fixture)"; REGDIR18="$FX18/regdir"; mkdir -p "$REGDIR18"; REG18="$REGDIR18/accounts.json"; VFILE18="$FX18/accounts.env"
CRED18="$FX18/credentials.json"; CJSON18="$FX18/claude.json"
cat > "$REG18" <<JSON
{ "schema": "cc-master/accounts/v1", "accounts": {
  "bob@y.com":   { "vault": {"kind":"keychain","service":"cc-master-oauth","account":"bob@y.com"}, "active": true, "last_switch_out": null },
  "alice@x.com": { "vault": {"kind":"file","path":"$VFILE18","key":"alice@x.com"}, "token_expires_at":"2027-06-17T10:40:00Z", "active": false, "last_switch_out": null, "identity": {"emailAddress":"new@y.com","accountUuid":"uuid-new","organizationName":"NewOrg","subscriptionType":"max"} }
} }
JSON
umask 077
printf 'alice@x.com_TOKEN=%s\n' "{\"accessToken\":\"$ALICE_AT\",\"refreshToken\":\"$ALICE_RT\",\"expiresAt\":1700000000000,\"subscriptionType\":\"max\"}" > "$VFILE18"; chmod 600 "$VFILE18"
cat > "$CRED18" <<'JSON'
{"claudeAiOauth":{"accessToken":"sk-ant-oat01-OLD1800000000000000000000-_o","refreshToken":"sk-ant-ort01-OLD18r0000000000000000-_o","expiresAt":1700000000000}}
JSON
printf '{"oauthAccount":{"emailAddress":"old@x.com"},"x":1}' > "$CJSON18"
PORT18="$FX18/url.txt"; start_refresh_endpoint ok "$PORT18"; RURL18="$(cat "$PORT18")"
# A `security` stub that succeeds (③ keychain overwrite OK) AND, on the official-creds add, makes the registry DIR
#   read-only — so by the time set_active_in runs (right after stores overwritten), saveRegistry's tmp write fails.
#   Service-scoped: only chmod on the official "Claude Code-credentials" write (the LAST store write before setActive).
SECSTUB_LOCKREG18="$(make_project)"
cat > "$SECSTUB_LOCKREG18/security" <<SEC
#!/usr/bin/env bash
cat >/dev/null 2>&1
is_add=0; is_official=0; prev=""
for a in "\$@"; do
  [ "\$a" = "add-generic-password" ] && is_add=1
  [ "\$prev" = "-s" ] && [ "\$a" = "Claude Code-credentials" ] && is_official=1
  prev="\$a"
done
# after the official ③ keychain overwrite succeeds, lock the registry dir so the upcoming setActive saveRegistry fails.
if [ "\$is_add" = "1" ] && [ "\$is_official" = "1" ]; then chmod 500 "$REGDIR18" 2>/dev/null || true; fi
exit 0
SEC
chmod +x "$SECSTUB_LOCKREG18/security"
out18="$(PATH="$SECSTUB_LOCKREG18:$PATH" CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" REFRESH_TOKEN_URL="$RURL18" CRED_PATH="$CRED18" CLAUDE_JSON_PATH="$CJSON18" \
        bash "$SCRIPT" --registry "$REG18" --email "alice@x.com" --now "2026-06-17T09:00:00Z" --no-snapshot 2>&1)"; rc18=$?
chmod 700 "$REGDIR18" 2>/dev/null || true   # restore so we can read/cleanup.
assert_eq "4" "$rc18" "(18) Finding B: setActive write failure → exit 4 (NOT 0·区别于干净成功)"
# the message must NOT be the clean ✓ success line, and MUST say registry needs reconciliation.
case "$out18" in
  *"✓ 无重启换号完成"*) FAILED=$((FAILED+1)); _red "FAIL: (18) Finding B still prints the CLEAN ✓ success line despite stale registry (谎报)";;
  *) PASS=$((PASS+1)); _green "(18) Finding B: does NOT print the clean ✓ success line (no谎报)";;
esac
assert_contains "$out18" "手动对账" "(18) Finding B: surfaces registry 需手动对账 (honest about the stale active state)"
assert_contains "$out18" "已生效" "(18) Finding B: still tells user the switch DID take effect (三存储已是新号·别让用户以为没切)"
assert_not_contains "$out18" "$ALICE_RT" "(18) Finding B: no token leak on the active-write-failure path"
assert_not_contains "$out18" "$FRESH_RT" "(18) Finding B: fresh refresh token does NOT leak on this path"
rm -rf "$FX18" "$SECSTUB_LOCKREG18"

# ──────────────────────────────────────────────────────────────────────────────────────────────────
# (19) **codex round#3 Finding A teeth — 切入号不在 registry → 不谎报干净成功（exit 4·registry active 未对齐）**.
#      病根：`--email` 指一个**不在 accounts.json** 的号（显式 --vault-file 取到 token）→ set_active_in 的 else 分支
#      只警告、return 0 → 主流程打印「✓ 换号完成」，但 registry 没这个号 entry、active 仍指旧号（三存储已覆写）=
#      registry 与现实脱节（后续选号 / 切出快照从 stale active 推理）。修：else 分支 exit 5 → 主流程置
#      ACTIVE_WRITE_FAILED=1·exit 4·如实标注「换号已生效但 registry 需对齐·建议 --add 录号」，不谎报干净成功。
#      复现：registry 只有 bob（active）；用 --email mallory@x.com（不在 registry）+ 显式 --vault-file 指向含 mallory
#      有效 blob 的 file vault → token 读成功、三存储覆写成功，但 mallory 不在 registry → setActive else 分支.
# ──────────────────────────────────────────────────────────────────────────────────────────────────
FX19="$(make_fixture)"; REG19="$FX19/accounts.json"; VFILE19="$FX19/accounts.env"; CRED19="$FX19/credentials.json"; CJSON19="$FX19/claude.json"
# registry has ONLY bob (active) — mallory@x.com is NOT in the pool.
cat > "$REG19" <<JSON
{ "schema": "cc-master/accounts/v1", "accounts": {
  "bob@y.com": { "vault": {"kind":"keychain","service":"cc-master-oauth","account":"bob@y.com"}, "active": true, "last_switch_out": null }
} }
JSON
umask 077
# mallory's valid blob lives in the explicit file vault (token read will succeed) — but mallory has no registry entry.
printf 'mallory@x.com_TOKEN=%s\n' "{\"accessToken\":\"$ALICE_AT\",\"refreshToken\":\"$ALICE_RT\",\"expiresAt\":1700000000000}" > "$VFILE19"; chmod 600 "$VFILE19"
cat > "$CRED19" <<'JSON'
{"claudeAiOauth":{"accessToken":"sk-ant-oat01-OLD1900000000000000000000-_o","refreshToken":"sk-ant-ort01-OLD19r0000000000000000-_o","expiresAt":1700000000000}}
JSON
printf '{}' > "$CJSON19"
PORT19="$FX19/url.txt"; start_refresh_endpoint ok "$PORT19"; RURL19="$(cat "$PORT19")"
out19="$(PATH="$SECSTUB:$PATH" CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" REFRESH_TOKEN_URL="$RURL19" CRED_PATH="$CRED19" CLAUDE_JSON_PATH="$CJSON19" \
        bash "$SCRIPT" --registry "$REG19" --email "mallory@x.com" --vault-kind file --vault-file "$VFILE19" --now "2026-06-17T09:00:00Z" --no-snapshot 2>&1)"; rc19=$?
assert_eq "4" "$rc19" "(19) Finding A: switch-in not in registry → exit 4 (NOT 0·registry active 未对齐·不谎报干净成功)"
# must NOT print the clean ✓ success line.
case "$out19" in
  *"✓ 无重启换号完成"*) FAILED=$((FAILED+1)); _red "FAIL: (19) Finding A still prints CLEAN ✓ success despite not-in-registry switch-in (谎报)";;
  *) PASS=$((PASS+1)); _green "(19) Finding A: does NOT print clean ✓ success (registry not aligned)";;
esac
assert_contains "$out19" "不在 registry" "(19) Finding A: surfaces 切入号不在 registry (honest about misalignment)"
assert_contains "$out19" "已生效" "(19) Finding A: still tells user the switch took effect (三存储已覆写·别让用户以为没切)"
# registry bob still active (mallory not added·active not flipped to a non-existent entry).
bob19="$(node -e 'const r=require(process.argv[1]).loadRegistry(process.argv[2]);process.stdout.write(String(r.accounts["bob@y.com"].active))' "$LIB_JS" "$REG19" 2>/dev/null)"
assert_eq "true" "$bob19" "(19) Finding A: registry bob still active=true (no active flip to a non-existent号)"
mallory19="$(node -e 'const r=require(process.argv[1]).loadRegistry(process.argv[2]);const a=r.accounts["mallory@x.com"];process.stdout.write(a?"PRESENT":"ABSENT")' "$LIB_JS" "$REG19" 2>/dev/null)"
assert_eq "ABSENT" "$mallory19" "(19) Finding A: mallory still NOT in registry (switch didn't fabricate an entry)"
assert_not_contains "$out19" "$ALICE_RT" "(19) Finding A: no token leak on the not-in-registry path"
rm -rf "$FX19"

# ──────────────────────────────────────────────────────────────────────────────────────────────────
# (20) **codex round#4 — 7d 硬闸号永不被选中（混合池下硬闸是硬的·不被到期降权的可用号拖累成 best）**.
#      病根（我 round#2 Finding D 修复的回归）：旧码 gated 号只给低分 score=-1、仍留在 candidates 里。混合池下——
#      一个 7d-gated 号（score=-1）+ 一个 quota 健康但临近到期被 EXPIRY_PENALTY 压到 score<-1 的可用号——cmpRows 按
#      score 排序时 gated 的 -1 反而排在到期号前面成了 best，于是**硬闸号被选中**，违背 7d 硬闸不变式。修：candidates
#      过滤器加 `!r.gated`——gated 号永不进可选集。teeth：直接跑 select-account.js·混合池→断言选中的是**到期号**（非 gated）.
# ──────────────────────────────────────────────────────────────────────────────────────────────────
FX20="$(make_fixture)"; REG20="$FX20/accounts.json"
# gated@x.com: 7d 90% (> 85% 硬闸)·token 不临近到期；expiring@x.com: 7d 70%(健康·未触闸) 但 5 天后到期(触 EXPIRY_PENALTY).
cat > "$REG20" <<JSON
{ "schema": "cc-master/accounts/v1", "accounts": {
  "bob@y.com":      { "vault": {"kind":"keychain","service":"cc-master-oauth","account":"bob@y.com"}, "active": true, "last_switch_out": null },
  "gated@x.com":    { "vault": {"kind":"keychain","service":"cc-master-oauth","account":"gated@x.com"}, "token_expires_at":"2027-06-17T00:00:00Z", "active": false,
                      "last_switch_out": {"at":"2026-06-17T05:00:00Z","5h":{"used_pct":50,"resets_at":"2026-06-24T05:00:00Z","source":"account"},"7d":{"used_pct":90,"resets_at":"2026-06-24T05:00:00Z","source":"account"}} },
  "expiring@x.com": { "vault": {"kind":"keychain","service":"cc-master-oauth","account":"expiring@x.com"}, "token_expires_at":"2026-06-22T00:00:00Z", "active": false,
                      "last_switch_out": {"at":"2026-06-17T05:00:00Z","5h":{"used_pct":70,"resets_at":"2026-06-24T05:00:00Z","source":"account"},"7d":{"used_pct":70,"resets_at":"2026-06-24T05:00:00Z","source":"account"}} }
} }
JSON
sel20="$(node "$SELECT_JS" --registry "$REG20" --now "2026-06-17T09:00:00Z" 2>/dev/null)"; sel20_rc=$?
assert_eq "0" "$sel20_rc" "(20) round#4: mixed pool (gated + expiring) still selects SOMETHING (exit 0)"
assert_eq "expiring@x.com" "$sel20" "(20) round#4 CORE: selects the EXPIRING-but-usable号, NOT the 7d-gated号 (硬闸是硬的·gated 永不被选)"
# negative control: the gated号 must NEVER be the selection.
case "$sel20" in
  *gated@x.com*) FAILED=$((FAILED+1)); _red "FAIL: (20) round#4 selected the 7d-GATED account (hard gate violated)";;
  *) PASS=$((PASS+1)); _green "(20) round#4: 7d-gated account is NOT selected (hard gate holds in mixed pool)";;
esac
# --json: gated号 still appears in candidates output (visibility) but with gated:true; selection reason SELECTED.
sel20j="$(node "$SELECT_JS" --registry "$REG20" --now "2026-06-17T09:00:00Z" --json 2>/dev/null)"
sel20_reason="$(printf '%s' "$sel20j" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(JSON.parse(s).reason||"NONE")}catch(_e){process.stdout.write("PARSEERR")}})' 2>/dev/null)"
assert_eq "SELECTED" "$sel20_reason" "(20) round#4: reason=SELECTED (a usable候选 exists·not全员逼顶)"
gated20_visible="$(printf '%s' "$sel20j" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const c=JSON.parse(s).candidates||[];const g=c.find(r=>r.email==="gated@x.com");process.stdout.write(g&&g.gated===true?"GATED-VISIBLE":"MISSING")}catch(_e){process.stdout.write("ERR")}})' 2>/dev/null)"
assert_eq "GATED-VISIBLE" "$gated20_visible" "(20) round#4: gated号 still in candidates output w/ gated:true (excluded from selection·not from visibility)"
rm -rf "$FX20"

# ──────────────────────────────────────────────────────────────────────────────────────────────────
# (21) **codex round#5 — OAuth refresh 请求超时（端点接受连接却挂死不响应）→ force-refresh 兜底·不 wedge**.
#      病根：refresh 的 node https.request 默认无超时——captive proxy / 端点 stall（接了连接却迟迟不回）会让换号
#      在读完 vault blob 后无限挂等、既不硬失败也不进 force-refresh 兜底。修：加 socket-inactivity timeout（默认
#      15s·REFRESH_TIMEOUT_MS 可覆写）→ 到时 destroy 请求 → 当网络不通处理（exit 5 → force-refresh 兜底·文档承诺的
#      优雅降级）。teeth：装一个**接受连接但永不响应**的 stall 端点 + 小 REFRESH_TIMEOUT_MS → 断言换号不 hang、
#      在合理时间内走完 force-refresh 兜底（exit 0），且超时提示出现。
# ──────────────────────────────────────────────────────────────────────────────────────────────────
FX21="$(make_fixture)"; REG21="$FX21/accounts.json"; VFILE21="$FX21/accounts.env"; CRED21="$FX21/credentials.json"; CJSON21="$FX21/claude.json"
cat > "$REG21" <<JSON
{ "schema": "cc-master/accounts/v1", "accounts": {
  "bob@y.com":   { "vault": {"kind":"keychain","service":"cc-master-oauth","account":"bob@y.com"}, "active": true, "last_switch_out": null },
  "alice@x.com": { "vault": {"kind":"file","path":"$VFILE21","key":"alice@x.com"}, "active": false, "last_switch_out": null }
} }
JSON
umask 077
printf 'alice@x.com_TOKEN=%s\n' "{\"accessToken\":\"$ALICE_AT\",\"refreshToken\":\"$ALICE_RT\",\"expiresAt\":1700000000000}" > "$VFILE21"; chmod 600 "$VFILE21"
cat > "$CRED21" <<'JSON'
{"claudeAiOauth":{"accessToken":"sk-ant-oat01-OLD21000000000000000000000-_o","refreshToken":"sk-ant-ort01-OLD21r00000000000000000-_o","expiresAt":1700000000000}}
JSON
printf '{}' > "$CJSON21"
# STALL endpoint: accepts the TCP connection but NEVER writes a response (simulates captive proxy / hung endpoint).
STALL21="$FX21/stall_url.txt"
node -e '
  const http = require("http");
  const s = http.createServer((req, res) => { /* accept connection, NEVER respond */ });
  s.listen(0, () => { require("fs").writeFileSync(process.argv[1], "http://127.0.0.1:" + s.address().port + "/v1/oauth/token"); });
  setTimeout(() => process.exit(0), 20000); // self-reap.
' "$STALL21" 2>/dev/null &
STALL21_PID=$!; ENDPOINT_PIDS+=("$STALL21_PID"); disown "$STALL21_PID" 2>/dev/null || true
i=0; while [ ! -s "$STALL21" ] && [ "$i" -lt 50 ]; do sleep 0.1; i=$((i+1)); done
RURL21="$(cat "$STALL21")"
sw21_start=$(date +%s)
# small REFRESH_TIMEOUT_MS=1500 → the stall must trip the timeout fast → exit-5 → force-refresh fallback (exit 0).
out21="$(PATH="$SECSTUB:$PATH" CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" REFRESH_TOKEN_URL="$RURL21" REFRESH_TIMEOUT_MS=1500 CRED_PATH="$CRED21" CLAUDE_JSON_PATH="$CJSON21" \
         bash "$SCRIPT" --registry "$REG21" --email "alice@x.com" --now "2026-06-17T09:00:00Z" --no-snapshot 2>&1)"; rc21=$?
sw21_elapsed=$(( $(date +%s) - sw21_start ))
assert_eq "0" "$rc21" "(21) round#5: refresh-stall → timeout → force-refresh fallback completes (exit 0·NOT wedged)"
# must NOT hang: the timeout (1.5s) must trip; generous ceiling < 15s (the default no-timeout would hang ~indefinitely).
if [ "$sw21_elapsed" -lt 15 ]; then PASS=$((PASS+1)); _green "(21) round#5: refresh timeout bit (run took ${sw21_elapsed}s, not an indefinite hang)"; else FAILED=$((FAILED+1)); _red "FAIL: (21) round#5 run took ${sw21_elapsed}s — refresh timeout did NOT bite (wedged)"; fi
assert_contains "$out21" "force-refresh 兜底" "(21) round#5: stall → force-refresh fallback engaged (graceful degrade·not wedge)"
assert_not_contains "$out21" "$ALICE_RT" "(21) round#5: no token leak on the refresh-stall path"
kill "$STALL21_PID" 2>/dev/null || true
rm -rf "$FX21"

# ──────────────────────────────────────────────────────────────────────────────────────────────────
# (22) **codex round#6 — 混合排除（gated + expired/not_switchable）→ NONE_NO_CANDIDATES(exit 1·修号池)·非 NONE_ALL_EXHAUSTED(exit 3·等 reset)**.
#      病根（我 round#4 引入 gated 排除后的 over-classification）：anyGated 分支只要 ranked 里有 gated 就报 exit 3
#      （「等 reset」）——但若另一些备号是因 expired / switchable:false 被排除（可操作 fix = --refresh / --add，非等
#      reset），exit 3 把用户引向错的恢复路。修：仅当**非 active 备号全 gated**（纯配额逼顶）才 exit 3；混合 →
#      NONE_NO_CANDIDATES(exit 1)。teeth：池 = bob(active) + gated(7d 90%) + expired(token 过期)·无可用候选 →
#      断言 reason=NONE_NO_CANDIDATES·exit 1（非 3），且 warning 指向 --refresh/--add 而非纯等 reset.
# ──────────────────────────────────────────────────────────────────────────────────────────────────
FX22="$(make_fixture)"; REG22="$FX22/accounts.json"
cat > "$REG22" <<JSON
{ "schema": "cc-master/accounts/v1", "accounts": {
  "bob@y.com":     { "vault": {"kind":"keychain","service":"cc-master-oauth","account":"bob@y.com"}, "active": true, "last_switch_out": null },
  "gated@x.com":   { "vault": {"kind":"keychain","service":"cc-master-oauth","account":"gated@x.com"}, "token_expires_at":"2027-06-17T00:00:00Z", "active": false,
                     "last_switch_out": {"at":"2026-06-17T05:00:00Z","5h":{"used_pct":50,"resets_at":"2026-06-24T05:00:00Z","source":"account"},"7d":{"used_pct":90,"resets_at":"2026-06-24T05:00:00Z","source":"account"}} },
  "expired@x.com": { "vault": {"kind":"keychain","service":"cc-master-oauth","account":"expired@x.com"}, "token_expires_at":"2020-01-01T00:00:00Z", "active": false,
                     "last_switch_out": {"at":"2026-06-17T05:00:00Z","5h":{"used_pct":10,"resets_at":"2026-06-24T05:00:00Z","source":"account"},"7d":{"used_pct":10,"resets_at":"2026-06-24T05:00:00Z","source":"account"}} }
} }
JSON
sel22="$(node "$SELECT_JS" --registry "$REG22" --now "2026-06-17T09:00:00Z" 2>/dev/null)"; sel22_rc=$?
# mixed exclusion → NONE_NO_CANDIDATES → exit 1 (NOT exit 3 ALL_EXHAUSTED).
assert_eq "1" "$sel22_rc" "(22) round#6: mixed gated+expired → exit 1 (NONE_NO_CANDIDATES·可 --refresh/--add·NOT exit 3 等 reset)"
assert_eq "" "$sel22" "(22) round#6: no email selected (empty stdout·no usable candidate)"
sel22j="$(node "$SELECT_JS" --registry "$REG22" --now "2026-06-17T09:00:00Z" --json 2>/dev/null)"
sel22_reason="$(printf '%s' "$sel22j" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(JSON.parse(s).reason||"NONE")}catch(_e){process.stdout.write("PARSEERR")}})' 2>/dev/null)"
assert_eq "NONE_NO_CANDIDATES" "$sel22_reason" "(22) round#6 CORE: reason=NONE_NO_CANDIDATES (mixed exclusion·not misclassified as ALL_EXHAUSTED)"
# negative control: a PURE all-gated pool MUST still be NONE_ALL_EXHAUSTED (round#4 regression guard).
FX22B="$FX22/b"; mkdir -p "$FX22B"; REG22B="$FX22B/accounts.json"
cat > "$REG22B" <<JSON
{ "schema": "cc-master/accounts/v1", "accounts": {
  "bob@y.com":   { "vault": {"kind":"keychain","service":"cc-master-oauth","account":"bob@y.com"}, "active": true, "last_switch_out": null },
  "g1@x.com":    { "vault": {"kind":"keychain","service":"cc-master-oauth","account":"g1@x.com"}, "token_expires_at":"2027-06-17T00:00:00Z", "active": false,
                   "last_switch_out": {"at":"2026-06-17T05:00:00Z","5h":{"used_pct":90,"resets_at":"2026-06-24T05:00:00Z","source":"account"},"7d":{"used_pct":90,"resets_at":"2026-06-24T05:00:00Z","source":"account"}} },
  "g2@x.com":    { "vault": {"kind":"keychain","service":"cc-master-oauth","account":"g2@x.com"}, "token_expires_at":"2027-06-17T00:00:00Z", "active": false,
                   "last_switch_out": {"at":"2026-06-17T05:00:00Z","5h":{"used_pct":88,"resets_at":"2026-06-24T05:00:00Z","source":"account"},"7d":{"used_pct":88,"resets_at":"2026-06-24T05:00:00Z","source":"account"}} }
} }
JSON
sel22b_rc=0; node "$SELECT_JS" --registry "$REG22B" --now "2026-06-17T09:00:00Z" >/dev/null 2>&1; sel22b_rc=$?
assert_eq "3" "$sel22b_rc" "(22) round#6 control: PURE all-gated pool STILL → exit 3 NONE_ALL_EXHAUSTED (round#4 behavior preserved)"
rm -rf "$FX22"

# ──────────────────────────────────────────────────────────────────────────────────────────────────
# (23) **codex round#7 Finding A teeth — REFRESH_TOKEN_URL 白名单：未授权端点 → 拒发 token·硬失败（防 exfiltration）**.
#      病根：refresh token 是 bearer secret——POST 到哪由 REFRESH_TOKEN_URL 控制，污染 env / 误抄测试值指到非 Claude
#      主机或明文 http 就把 token 发给攻击者（仍满足 token-blind 不进 argv/log，但实质泄漏）。修：发 body 之前先校验
#      host——授权 https Claude/Anthropic 主机 / 显式 opt-in 的 loopback 才放行，否则拒绝退出（exit 1·token 未上网）。
#      teeth：(a) loopback 但**没** opt-in（unset CCM_ALLOW_LOOPBACK_REFRESH）→ 拒绝；(b) 非 Claude 主机（即便 opt-in）
#      → 拒绝。两者都断言：exit非0、未覆写存储、registry 未翻、stderr 报「未授权/拒绝」、token 绝不泄漏。
# ──────────────────────────────────────────────────────────────────────────────────────────────────
FX23="$(make_fixture)"; REG23="$FX23/accounts.json"; VFILE23="$FX23/accounts.env"; CRED23="$FX23/credentials.json"; CJSON23="$FX23/claude.json"
cat > "$REG23" <<JSON
{ "schema": "cc-master/accounts/v1", "accounts": {
  "bob@y.com":   { "vault": {"kind":"keychain","service":"cc-master-oauth","account":"bob@y.com"}, "active": true, "last_switch_out": null },
  "alice@x.com": { "vault": {"kind":"file","path":"$VFILE23","key":"alice@x.com"}, "active": false, "last_switch_out": null }
} }
JSON
umask 077
printf 'alice@x.com_TOKEN=%s\n' "{\"accessToken\":\"$ALICE_AT\",\"refreshToken\":\"$ALICE_RT\",\"expiresAt\":1700000000000}" > "$VFILE23"; chmod 600 "$VFILE23"
OLD_CRED_AT_23='sk-ant-oat01-OLD23cred0000000000000000000-_o'
cat > "$CRED23" <<'JSON'
{"claudeAiOauth":{"accessToken":"sk-ant-oat01-OLD23cred0000000000000000000-_o","refreshToken":"sk-ant-ort01-OLD23credr000000000000000-_o","expiresAt":1700000000000}}
JSON
printf '{}' > "$CJSON23"
# real ok endpoint exists (would succeed IF host passed whitelist) — proves rejection is the WHITELIST, not a dead endpoint.
PORT23="$FX23/url.txt"; start_refresh_endpoint ok "$PORT23"; RURL23="$(cat "$PORT23")"
# (23a) loopback endpoint but NO opt-in (env -u CCM_ALLOW_LOOPBACK_REFRESH) → reject.
out23a="$(env -u CCM_ALLOW_LOOPBACK_REFRESH PATH="$SECSTUB:$PATH" CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" REFRESH_TOKEN_URL="$RURL23" CRED_PATH="$CRED23" CLAUDE_JSON_PATH="$CJSON23" \
          bash "$SCRIPT" --registry "$REG23" --email "alice@x.com" --now "2026-06-17T09:00:00Z" --no-snapshot 2>&1)"; rc23a=$?
assert_eq "1" "$rc23a" "(23a) loopback refresh WITHOUT opt-in → rejected (exit非0·token 未发)"
assert_contains "$out23a" "未授权" "(23a) stderr says 未授权 refresh 端点 (rejected before sending token)"
# stores UNCHANGED (token never sent → no refresh → no overwrite).
cred23a_at="$(node -e 'process.stdout.write(require(process.argv[1]).claudeAiOauth.accessToken)' "$CRED23" 2>/dev/null)"
assert_eq "$OLD_CRED_AT_23" "$cred23a_at" "(23a) ① credentials.json UNCHANGED (no token sent·no overwrite)"
alice23a="$(node -e 'const r=require(process.argv[1]).loadRegistry(process.argv[2]);process.stdout.write(String(r.accounts["alice@x.com"].active))' "$LIB_JS" "$REG23" 2>/dev/null)"
assert_eq "false" "$alice23a" "(23a) registry alice active NOT flipped (switch aborted at whitelist)"
assert_not_contains "$out23a" "$ALICE_RT" "(23a) alice refresh token does NOT leak on the rejected path"
# (23b) a NON-Claude host (with opt-in still set·proves opt-in only covers loopback) → reject.
out23b="$(PATH="$SECSTUB:$PATH" CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" REFRESH_TOKEN_URL="https://evil.example.com/v1/oauth/token" CRED_PATH="$CRED23" CLAUDE_JSON_PATH="$CJSON23" \
          bash "$SCRIPT" --registry "$REG23" --email "alice@x.com" --now "2026-06-17T09:00:00Z" --no-snapshot 2>&1)"; rc23b=$?
assert_eq "1" "$rc23b" "(23b) non-Claude host (evil.example.com) → rejected (exit非0·even with loopback opt-in set)"
assert_contains "$out23b" "未授权" "(23b) stderr says 未授权 for the non-Claude host"
cred23b_at="$(node -e 'process.stdout.write(require(process.argv[1]).claudeAiOauth.accessToken)' "$CRED23" 2>/dev/null)"
assert_eq "$OLD_CRED_AT_23" "$cred23b_at" "(23b) ① credentials.json UNCHANGED (token never sent to evil host)"
assert_not_contains "$out23b" "$ALICE_RT" "(23b) alice refresh token does NOT leak to / via the evil-host path"
rm -rf "$FX23"

# ──────────────────────────────────────────────────────────────────────────────────────────────────
# (24) **codex round#12/#18 — SIGTERM during the ③ keychain-write window → FORWARD-align (not rollback·no split-brain)**.
#      演进：round#12 让中断在覆写窗口回滚 ①②。round#18 收口「keychain 已提交但 flag 未设」的盲窗——**在 security 调用
#      之前**就置 STORES_COMMITTED=1，故中断落在 keychain 写窗口（keychain 提交与否不确定·①② 已是新号·① 是 claude 主
#      认证源）时，最小伤害恢复是**前向对齐**（registry/① 都新·keychain 滞后由后续 reconcile），绝非回滚 ①②（回滚也是可
#      被中断的 mutation·且 keychain 若已提交就回不去 → 反而 split-brain）。复现：security stub 在 ③ 写时 sleep（给中断窗口）；
#      switch 在 ③ sleep（已过 STORES_COMMITTED=1）期间被 SIGTERM → 断言 registry **前向对齐**到 alice + ① 仍 FRESH（不回滚）。
# ──────────────────────────────────────────────────────────────────────────────────────────────────
FX24="$(make_fixture)"; REG24="$FX24/accounts.json"; VFILE24="$FX24/accounts.env"; CRED24="$FX24/credentials.json"; CJSON24="$FX24/claude.json"
cat > "$REG24" <<JSON
{ "schema": "cc-master/accounts/v1", "accounts": {
  "bob@y.com":   { "vault": {"kind":"keychain","service":"cc-master-oauth","account":"bob@y.com"}, "active": true, "last_switch_out": null },
  "alice@x.com": { "vault": {"kind":"file","path":"$VFILE24","key":"alice@x.com"}, "token_expires_at":"2027-06-17T10:40:00Z", "active": false, "last_switch_out": null, "identity": {"emailAddress":"new@y.com","accountUuid":"uuid-new"} }
} }
JSON
umask 077
printf 'alice@x.com_TOKEN=%s\n' "{\"accessToken\":\"$ALICE_AT\",\"refreshToken\":\"$ALICE_RT\",\"expiresAt\":1700000000000}" > "$VFILE24"; chmod 600 "$VFILE24"
OLD_CRED_AT_24='sk-ant-oat01-OLD24cred0000000000000000000-_o'
cat > "$CRED24" <<'JSON'
{"claudeAiOauth":{"accessToken":"sk-ant-oat01-OLD24cred0000000000000000000-_o","refreshToken":"sk-ant-ort01-OLD24credr000000000000000-_o","expiresAt":1700000000000},"keepThisKey":"keepme"}
JSON
cat > "$CJSON24" <<'JSON'
{"oauthAccount":{"emailAddress":"old@x.com"},"numStartups":42}
JSON
# security stub: the FIRST official ③ keychain write SLEEPS (killed mid-sleep → never commits·simulates interrupt during
#   the keychain write). The SECOND official ③ write (the trap's forward-align RE-COMMIT·codex round#19) CAPTURES the
#   wrapped value to $SEC_CAPTURE_FILE so the test can verify the forward-align actually re-wrote keychain to the new account.
SECSTUB_SLOW24="$(make_project)"
cat > "$SECSTUB_SLOW24/security" <<'SEC'
#!/usr/bin/env bash
is_add=0; is_official=0; prev=""; wval=""; have_wval=0
for a in "$@"; do
  [ "$a" = "add-generic-password" ] && is_add=1
  [ "$prev" = "-s" ] && [ "$a" = "Claude Code-credentials" ] && is_official=1
  [ "$prev" = "-w" ] && { wval="$a"; have_wval=1; }
  prev="$a"
done
if [ "$is_add" = "1" ] && [ "$is_official" = "1" ]; then
  CNT_FILE="${SEC_CALL_COUNT_FILE:-/dev/null}"
  n=0; [ -f "$CNT_FILE" ] && n="$(cat "$CNT_FILE" 2>/dev/null || echo 0)"; n=$((n+1)); printf '%s' "$n" > "$CNT_FILE" 2>/dev/null || true
  if [ "$n" = "1" ]; then
    # first ③ write (mid-overwrite): signal ready, then sleep → harness SIGTERMs it before it commits.
    [ -n "${SEC_READY_FILE:-}" ] && printf 'ready\n' > "$SEC_READY_FILE"
    sleep 8
  else
    # subsequent ③ write = the trap's forward-align re-commit: capture the wrapped value (proves keychain re-written to new号).
    [ "$have_wval" = "1" ] && [ -n "${SEC_CAPTURE_FILE:-}" ] && printf '%s' "$wval" > "$SEC_CAPTURE_FILE"
  fi
fi
exit 0
SEC
chmod +x "$SECSTUB_SLOW24/security"
PORT24="$FX24/url.txt"; start_refresh_endpoint ok "$PORT24"; RURL24="$(cat "$PORT24")"
SEC_READY24="$FX24/sec.ready"; SEC_CAP24="$FX24/kc-recommit.json"; SEC_CNT24="$FX24/kc.count"
# run switch in the background; SIGTERM it once the ③ keychain sleep begins (= ①② already written).
( PATH="$SECSTUB_SLOW24:$PATH" CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" REFRESH_TOKEN_URL="$RURL24" SEC_READY_FILE="$SEC_READY24" SEC_CAPTURE_FILE="$SEC_CAP24" SEC_CALL_COUNT_FILE="$SEC_CNT24" CRED_PATH="$CRED24" CLAUDE_JSON_PATH="$CJSON24" \
  bash "$SCRIPT" --registry "$REG24" --email "alice@x.com" --now "2026-06-17T09:00:00Z" --no-snapshot >/dev/null 2>&1 ) &
sw24_pid=$!
# wait for the ③ keychain sleep to begin (①② already overwritten by now), then SIGTERM.
i=0; while [ ! -s "$SEC_READY24" ] && [ "$i" -lt 100 ]; do sleep 0.1; i=$((i+1)); done
sleep 0.3   # ensure we're inside the ③ sleep window (①② written, not yet committed).
kill -TERM "$sw24_pid" 2>/dev/null || true
wait "$sw24_pid" 2>/dev/null || true
# **CORE INVARIANT (robust to exactly-which-window the SIGTERM landed in·timing-resilient)**：无论中断落在覆写前
#   （回滚 → ① OLD + registry old）还是 keychain 窗口（前向对齐 → ① FRESH + registry alice），结果都必须**内部一致·
#   绝不 split-brain**——① credentials.json（claude 主认证源·new=alice / old=bob）与 registry active 必须指向**同一个号**。
cred24_at="$(node -e 'const j=require(process.argv[1]);process.stdout.write(j.claudeAiOauth&&j.claudeAiOauth.accessToken||"NONE")' "$CRED24" 2>/dev/null)"
active24="$(node -e 'const r=require(process.argv[1]).loadRegistry(process.argv[2]);const a=Object.entries(r.accounts||{}).find(([k,e])=>e.active===true);process.stdout.write(a?a[0]:"NONE")' "$LIB_JS" "$REG24" 2>/dev/null)"
# map ① cred token → which account it points at; assert registry active points at the SAME account (no split-brain).
case "$cred24_at" in
  "$FRESH_AT")     assert_eq "alice@x.com" "$active24" "(24) CORE: ① credentials.json=alice(FRESH) ⟹ registry active=alice (consistent·forward-recovery·no split-brain)";;
  "$OLD_CRED_AT_24") assert_eq "bob@y.com"  "$active24" "(24) CORE: ① credentials.json=bob(OLD·rolled back) ⟹ registry active=bob (consistent·rollback·no split-brain)";;
  *) FAILED=$((FAILED+1)); _red "FAIL: (24) ① credentials.json in an unexpected state '$cred24_at' (neither clean FRESH nor clean OLD)";;
esac
# ① other keys preserved regardless of which branch (the node ① write / the snapshot rollback both keep them).
cred24_keep="$(node -e 'const j=require(process.argv[1]);process.stdout.write(j.keepThisKey||"NONE")' "$CRED24" 2>/dev/null)"
assert_eq "keepme" "$cred24_keep" "(24) ① other keys (keepThisKey) preserved through the interrupt (either branch)"
# exactly one active (uniqueness held regardless of which window the interrupt hit).
nactive24="$(node -e 'const r=require(process.argv[1]).loadRegistry(process.argv[2]);process.stdout.write(String(Object.values(r.accounts||{}).filter(e=>e.active===true).length))' "$LIB_JS" "$REG24" 2>/dev/null)"
assert_eq "1" "$nactive24" "(24) exactly ONE active account after the interrupt (active-uniqueness held)"
# **(24-R19) codex round#19 — when forward-align happened (① FRESH), the trap RE-COMMITTED the keychain ③ to the new号**：
#   the first ③ write was killed mid-sleep (never committed·keychain would be OLD); the trap's forward-align re-writes it →
#   keychain ends up = new号 too (no keychain-lag split-brain). Verify only on the forward-align branch (① FRESH).
if [ "$cred24_at" = "$FRESH_AT" ]; then
  if [ -f "$SEC_CAP24" ]; then
    cap24_at="$(node -e 'try{const j=require(process.argv[1]);process.stdout.write(j.claudeAiOauth&&j.claudeAiOauth.accessToken||"NONE")}catch(_e){process.stdout.write("PARSEERR")}' "$SEC_CAP24" 2>/dev/null)"
    assert_eq "$FRESH_AT" "$cap24_at" "(24-R19) forward-align RE-COMMITTED keychain ③ to the new号 (FRESH·no keychain-lag split-brain·codex round#19)"
  else
    FAILED=$((FAILED+1)); _red "FAIL: (24-R19) forward-align did NOT re-commit the keychain (keychain left OLD while ①/registry new = split-brain)"
  fi
fi
rm -rf "$FX24" "$SECSTUB_SLOW24"

# ──────────────────────────────────────────────────────────────────────────────────────────────────
# (25) **codex round#14 Finding A — 跨进程换号锁串行化并发 switch（官方三存储 + registry 不交错）**.
#      病根：registry/vault 锁只各保护自己那个文件，挡不住两个并发 switch 的官方三存储覆写交错 → 文件归 A、
#      keychain/registry 归 B 的 split-brain。修：换号级锁（键在 credentials.json 路径）罩住覆写+setActive 整段。
#      teeth：两个并发 switch（切到不同号 alice / carol·各自 file vault 有 blob）→ 串行化后**最终三存储 + registry
#      一致指向同一个号**（不交错）。security capture stub 记 ③ keychain 写的号·与 ① credentials.json + registry active 比对。
# ──────────────────────────────────────────────────────────────────────────────────────────────────
FX25="$(make_fixture)"; REG25="$FX25/accounts.json"; VF_A25="$FX25/a.env"; VF_C25="$FX25/c.env"
CRED25="$FX25/credentials.json"; CJSON25="$FX25/claude.json"; CAP25="$FX25/kc-capture.json"
cat > "$REG25" <<JSON
{ "schema": "cc-master/accounts/v1", "accounts": {
  "bob@y.com":   { "vault": {"kind":"keychain","service":"cc-master-oauth","account":"bob@y.com"}, "active": true, "last_switch_out": null },
  "alice@x.com": { "vault": {"kind":"file","path":"$VF_A25","key":"alice@x.com"}, "token_expires_at":"2027-06-17T10:40:00Z", "active": false, "last_switch_out": null, "identity": {"emailAddress":"alice@x.com","accountUuid":"uuid-alice"} },
  "carol@z.io":  { "vault": {"kind":"file","path":"$VF_C25","key":"carol@z.io"}, "token_expires_at":"2027-06-17T10:40:00Z", "active": false, "last_switch_out": null, "identity": {"emailAddress":"carol@z.io","accountUuid":"uuid-carol"} }
} }
JSON
umask 077
printf 'alice@x.com_TOKEN=%s\n' "{\"accessToken\":\"$ALICE_AT\",\"refreshToken\":\"$ALICE_RT\",\"expiresAt\":1700000000000}" > "$VF_A25"; chmod 600 "$VF_A25"
printf 'carol@z.io_TOKEN=%s\n' "{\"accessToken\":\"sk-ant-oat01-CAROLaccess00000000000000000-_c\",\"refreshToken\":\"sk-ant-ort01-CAROLrefresh0000000000000000-_c\",\"expiresAt\":1700000000000}" > "$VF_C25"; chmod 600 "$VF_C25"
cat > "$CRED25" <<'JSON'
{"claudeAiOauth":{"accessToken":"sk-ant-oat01-OLD25000000000000000000000-_o","refreshToken":"sk-ant-ort01-OLD25r0000000000000000-_o","expiresAt":1700000000000}}
JSON
printf '{"oauthAccount":{"emailAddress":"old@x.com"}}' > "$CJSON25"
PORT25="$FX25/url.txt"; start_refresh_endpoint ok "$PORT25"; RURL25="$(cat "$PORT25")"
# run two switches concurrently (alice and carol); the switch lock must serialize them so the final state is consistent.
( PATH="$SECSTUB:$PATH" CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" REFRESH_TOKEN_URL="$RURL25" CRED_PATH="$CRED25" CLAUDE_JSON_PATH="$CJSON25" \
  bash "$SCRIPT" --registry "$REG25" --email "alice@x.com" --now "2026-06-17T09:00:00Z" --no-snapshot >/dev/null 2>&1 ) &
sw25a=$!
( PATH="$SECSTUB:$PATH" CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" REFRESH_TOKEN_URL="$RURL25" CRED_PATH="$CRED25" CLAUDE_JSON_PATH="$CJSON25" \
  bash "$SCRIPT" --registry "$REG25" --email "carol@z.io" --now "2026-06-17T09:00:00Z" --no-snapshot >/dev/null 2>&1 ) &
sw25c=$!
wait "$sw25a" 2>/dev/null || true; wait "$sw25c" 2>/dev/null || true
# CORE: the registry's active account must be EXACTLY ONE of {alice, carol} (the serialized winner), and ② claude.json
#   oauthAccount.emailAddress must MATCH that same winner — NOT a split (files for one, registry for the other).
active25="$(node -e 'const r=require(process.argv[1]).loadRegistry(process.argv[2]);const a=Object.entries(r.accounts||{}).find(([k,e])=>e.active===true);process.stdout.write(a?a[0]:"NONE")' "$LIB_JS" "$REG25" 2>/dev/null)"
cj25_email="$(node -e 'const j=require(process.argv[1]);process.stdout.write(j.oauthAccount&&j.oauthAccount.emailAddress||"NONE")' "$CJSON25" 2>/dev/null)"
# winner is whichever the registry marks active; the ② store identity must agree (consistency·no interleave).
case "$active25" in
  alice@x.com) assert_eq "alice@x.com" "$cj25_email" "(25) CORE: serialized → registry active=alice AND ② oauthAccount=alice (consistent·no interleave)";;
  carol@z.io)  assert_eq "carol@z.io"  "$cj25_email" "(25) CORE: serialized → registry active=carol AND ② oauthAccount=carol (consistent·no interleave)";;
  *) FAILED=$((FAILED+1)); _red "FAIL: (25) registry active is '$active25' (expected exactly one of alice/carol — neither switch committed cleanly)";;
esac
# exactly ONE account active (uniqueness held through concurrency).
nactive25="$(node -e 'const r=require(process.argv[1]).loadRegistry(process.argv[2]);process.stdout.write(String(Object.values(r.accounts||{}).filter(e=>e.active===true).length))' "$LIB_JS" "$REG25" 2>/dev/null)"
assert_eq "1" "$nactive25" "(25) exactly ONE active account after concurrent switches (active-uniqueness held·no double-active)"
# registry still valid JSON (no torn write from the two concurrent setActive RMW).
if node -e 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))' "$REG25" 2>/dev/null; then PASS=$((PASS+1)); _green "(25) registry valid JSON after concurrent switches (no torn write)"; else FAILED=$((FAILED+1)); _red "FAIL: (25) registry corrupted by concurrent switches"; fi
rm -rf "$FX25"

# ──────────────────────────────────────────────────────────────────────────────────────────────────
# (26) **codex round#15 Finding A — refresh token 轮转 + vault 回写失败 → 硬失败（不冒险丢轮转后的唯一 token）**.
#      病根：refresh 端点轮转 refresh token 时 NEW_BLOB 是新 token 唯一副本；若 vault 回写失败、再继续到覆写而覆写
#      回滚 → NEW_BLOB 被丢弃、vault 只剩已吊销旧 token = 该号 brick。修：轮转时把回写当硬前提——回写失败即硬失败、
#      **不覆写任何官方存储**、registry 原封不动、exit非0 + 提示重 login。teeth：file vault 目录只读（writeback 失败）+
#      轮转的 ok 端点（FRESH_RT != ALICE_RT）→ 断言 exit非0 + ① credentials.json **未被覆写**（仍 OLD）+ registry 未翻 + 提示。
# ──────────────────────────────────────────────────────────────────────────────────────────────────
FX26="$(make_fixture)"; REG26="$FX26/accounts.json"; VFDIR26="$FX26/vdir"; mkdir -p "$VFDIR26"; VFILE26="$VFDIR26/accounts.env"
CRED26="$FX26/credentials.json"; CJSON26="$FX26/claude.json"
cat > "$REG26" <<JSON
{ "schema": "cc-master/accounts/v1", "accounts": {
  "bob@y.com":   { "vault": {"kind":"keychain","service":"cc-master-oauth","account":"bob@y.com"}, "active": true, "last_switch_out": null },
  "alice@x.com": { "vault": {"kind":"file","path":"$VFILE26","key":"alice@x.com"}, "token_expires_at":"2027-06-17T10:40:00Z", "active": false, "last_switch_out": null }
} }
JSON
umask 077
printf 'alice@x.com_TOKEN=%s\n' "{\"accessToken\":\"$ALICE_AT\",\"refreshToken\":\"$ALICE_RT\",\"expiresAt\":1700000000000}" > "$VFILE26"; chmod 600 "$VFILE26"
OLD_CRED_AT_26='sk-ant-oat01-OLD26cred0000000000000000000-_o'
cat > "$CRED26" <<'JSON'
{"claudeAiOauth":{"accessToken":"sk-ant-oat01-OLD26cred0000000000000000000-_o","refreshToken":"sk-ant-ort01-OLD26credr000000000000000-_o","expiresAt":1700000000000}}
JSON
printf '{}' > "$CJSON26"
# the `ok` endpoint ROTATES the refresh token (returns FRESH_RT != ALICE_RT) → REFRESH_ROTATED=1.
PORT26="$FX26/url.txt"; start_refresh_endpoint ok "$PORT26"; RURL26="$(cat "$PORT26")"
# CC_MASTER_HOME is a WRITABLE dir (recovery file lands here); the VAULT dir is read-only (writeback fails).
CCMHOME26="$FX26/ccmhome"; mkdir -p "$CCMHOME26"
chmod 500 "$VFDIR26"
out26="$(CC_MASTER_HOME="$CCMHOME26" PATH="$SECSTUB:$PATH" CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" REFRESH_TOKEN_URL="$RURL26" CRED_PATH="$CRED26" CLAUDE_JSON_PATH="$CJSON26" \
        bash "$SCRIPT" --registry "$REG26" --email "alice@x.com" --now "2026-06-17T09:00:00Z" --no-snapshot 2>&1)"; rc26=$?
chmod 700 "$VFDIR26"   # restore for cleanup.
assert_eq "1" "$rc26" "(26) rotated refresh token + writeback fail → HARD FAIL (exit 1·不冒险丢轮转 token)"
# ① credentials.json must be UNCHANGED (OLD·官方存储从未被覆写·硬失败发生在覆写之前).
cred26_at="$(node -e 'const j=require(process.argv[1]);process.stdout.write(j.claudeAiOauth.accessToken)' "$CRED26" 2>/dev/null)"
assert_eq "$OLD_CRED_AT_26" "$cred26_at" "(26) CORE: ① credentials.json UNCHANGED (未覆写任何官方存储·硬失败在覆写前)"
assert_not_contains "$cred26_at" "$FRESH_AT" "(26) ① is NOT the FRESH token (no overwrite happened)"
# registry active NOT flipped.
alice26="$(node -e 'const r=require(process.argv[1]).loadRegistry(process.argv[2]);process.stdout.write(String(r.accounts["alice@x.com"].active))' "$LIB_JS" "$REG26" 2>/dev/null)"
assert_eq "false" "$alice26" "(26) registry alice active NOT flipped (switch hard-failed before any store write)"
# message guides re-login / refresh (the actionable recovery for a rotated-but-unpersisted token).
assert_contains "$out26" "轮转" "(26) message explains the rotation + why it hard-failed (token-blind·no token value)"
# **(26-recovery) codex round#16 — the rotated NEW_BLOB must be RESCUED to a 0600 recovery file (not lost·no brick)**.
rec26="$(find "$CCMHOME26" -maxdepth 1 -name 'rotated-blob-recovery.alice@x.com.*.json' 2>/dev/null | head -1)"
if [ -n "$rec26" ] && [ -f "$rec26" ]; then PASS=$((PASS+1)); _green "(26-recovery) rotated blob RESCUED to a recovery file (not lost·codex round#16·no brick)"; else FAILED=$((FAILED+1)); _red "FAIL: (26-recovery) rotated NEW_BLOB was NOT persisted to a recovery file (token lost·account bricked)"; fi
# the recovery file must carry the FRESH rotated refresh token (so the account is actually recoverable).
if [ -n "$rec26" ] && grep -q "$FRESH_RT" "$rec26" 2>/dev/null; then PASS=$((PASS+1)); _green "(26-recovery) recovery file carries the FRESH rotated refresh token (recoverable)"; else FAILED=$((FAILED+1)); _red "FAIL: (26-recovery) recovery file missing the fresh rotated refresh token"; fi
# recovery file must be 0600 (token at rest·same floor as file vault).
if [ -n "$rec26" ]; then rec26_perm="$(stat -f '%Lp' "$rec26" 2>/dev/null || stat -c '%a' "$rec26" 2>/dev/null)"; assert_eq "600" "$rec26_perm" "(26-recovery) recovery file is 0600 (token-at-rest floor)"; fi
# the script must SURFACE the recovery file path (so the user can recover), and the token must NOT leak to stdout/stderr.
assert_contains "$out26" "recovery" "(26-recovery) script surfaces the recovery file path so the user can recover the rotated token"
assert_not_contains "$out26" "$FRESH_RT" "(26) rotated refresh token does NOT leak to script output (only into the 0600 file)"
assert_not_contains "$out26" "$ALICE_RT" "(26) old refresh token does NOT leak on the hard-fail path"
rm -rf "$FX26"

# ──────────────────────────────────────────────────────────────────────────────────────────────────
# (27) **codex round#17 — SIGTERM in the post-commit/pre-setActive window → FORWARD-align registry (not rollback)**.
#      病根：③ keychain 提交成功后、set_active_in 跑完前若被 SIGINT/TERM，旧 trap 只清 snapshot → 存储已新号、registry
#      active 仍旧号 = split-brain。修：STORES_COMMITTED=1 后 trap 走**前向对齐**（best-effort setActive 切入号·让 registry
#      追上已提交的存储），绝不回滚已提交存储。teeth（deterministic）：预占 registry 锁让 set_active_in 阻塞（此时 ③ 已提交·
#      STORES_COMMITTED=1·ACTIVE_ALIGNED=0）→ SIGTERM switch → 释放 registry 锁 → trap 的前向对齐 setActive 完成 →
#      断言 registry active **已翻到切入号**（前向对齐·非回滚）+ ① credentials.json 仍是 FRESH（已提交·没被回滚）。
# ──────────────────────────────────────────────────────────────────────────────────────────────────
FX27="$(make_fixture)"; CCMHOME27="$FX27/ccmhome"; mkdir -p "$CCMHOME27"; REG27="$CCMHOME27/accounts.json"
VFILE27="$FX27/accounts.env"; CRED27="$FX27/credentials.json"; CJSON27="$FX27/claude.json"
cat > "$REG27" <<JSON
{ "schema": "cc-master/accounts/v1", "accounts": {
  "bob@y.com":   { "vault": {"kind":"keychain","service":"cc-master-oauth","account":"bob@y.com"}, "active": true, "last_switch_out": null },
  "alice@x.com": { "vault": {"kind":"file","path":"$VFILE27","key":"alice@x.com"}, "token_expires_at":"2027-06-17T10:40:00Z", "active": false, "last_switch_out": null, "identity": {"emailAddress":"alice@x.com","accountUuid":"uuid-alice"} }
} }
JSON
umask 077
printf 'alice@x.com_TOKEN=%s\n' "{\"accessToken\":\"$ALICE_AT\",\"refreshToken\":\"$ALICE_RT\",\"expiresAt\":1700000000000}" > "$VFILE27"; chmod 600 "$VFILE27"
cat > "$CRED27" <<'JSON'
{"claudeAiOauth":{"accessToken":"sk-ant-oat01-OLD2700000000000000000000-_o","refreshToken":"sk-ant-ort01-OLD27r0000000000000000-_o","expiresAt":1700000000000}}
JSON
printf '{"oauthAccount":{"emailAddress":"old@x.com"}}' > "$CJSON27"
PORT27="$FX27/url.txt"; start_refresh_endpoint ok "$PORT27"; RURL27="$(cat "$PORT27")"
# pre-hold the REGISTRY lock with a LIVE holder so set_active_in's mutateRegistry blocks (post-commit·pre-active window).
REG27_LOCK="$REG27.lock"
( sleep 30 ) & HOLDER27=$!   # a live process whose pid we put in the lock (kept alive so the lock isn't stale).
printf '%s' "{\"pid\":$HOLDER27,\"at\":\"2099-01-01T00:00:00Z\",\"owner\":\"test-holder-27\"}" > "$REG27_LOCK"
# run switch; --no-snapshot so after ③ commit it goes straight to set_active_in (which blocks on the held registry lock).
( CC_MASTER_HOME="$CCMHOME27" PATH="$SECSTUB:$PATH" CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" REFRESH_TOKEN_URL="$RURL27" CRED_PATH="$CRED27" CLAUDE_JSON_PATH="$CJSON27" CCM_REGISTRY_LOCK_TIMEOUT_MS=8000 \
  bash "$SCRIPT" --registry "$REG27" --email "alice@x.com" --now "2026-06-17T09:00:00Z" --no-snapshot >/dev/null 2>&1 ) &
sw27=$!
# wait until ③ keychain committed (stores overwritten·STORES_COMMITTED=1) — detect via credentials.json now carrying FRESH.
i=0; while [ "$i" -lt 100 ]; do
  cur="$(node -e 'try{process.stdout.write(require(process.argv[1]).claudeAiOauth.accessToken||"")}catch(_e){}' "$CRED27" 2>/dev/null)"
  case "$cur" in *FRESHaccess*) break;; esac
  sleep 0.1; i=$((i+1))
done
sleep 0.2   # now in the post-commit window, set_active_in blocked on the held registry lock.
kill -TERM "$sw27" 2>/dev/null || true
# release the registry lock so the trap's forward-align setActive can proceed.
kill "$HOLDER27" 2>/dev/null || true; rm -f "$REG27_LOCK" 2>/dev/null || true
wait "$sw27" 2>/dev/null || true
# ① credentials.json stays FRESH (committed stores NOT rolled back·confirmed FRESH before the SIGTERM·deterministic).
cred27_at="$(node -e 'const j=require(process.argv[1]);process.stdout.write(j.claudeAiOauth.accessToken)' "$CRED27" 2>/dev/null)"
assert_eq "$FRESH_AT" "$cred27_at" "(27) ① credentials.json stays FRESH (committed stores not rolled back·post-commit·forward recovery)"
# CORE: registry active FORWARD-ALIGNED to alice to MATCH the committed ① (no split-brain). The trap's forward-align
#   setActive runs after the registry lock is released; give it a brief settle window (robust under load).
i=0; while [ "$i" -lt 50 ]; do
  active27="$(node -e 'const r=require(process.argv[1]).loadRegistry(process.argv[2]);const a=Object.entries(r.accounts||{}).find(([k,e])=>e.active===true);process.stdout.write(a?a[0]:"NONE")' "$LIB_JS" "$REG27" 2>/dev/null)"
  [ "$active27" = "alice@x.com" ] && break
  sleep 0.1; i=$((i+1))
done
assert_eq "alice@x.com" "$active27" "(27) CORE: post-commit SIGTERM → registry active FORWARD-aligned to alice (matches committed ①·no split-brain·not rolled back)"
rm -rf "$FX27"

# ──────────────────────────────────────────────────────────────────────────────────────────────────
# (28) **codex re-§7 P1 — forward-align 后第二次 trap 不再误回滚 ①②（trap 幂等·无 split-brain）**.
#      病根（codex 复现）：INT/TERM 落在「STORES_COMMITTED=1 已置、security 还没返回、OVERWRITE_IN_PROGRESS 还没清」
#        这个窗口 → INT/TERM trap 跑前向对齐分支（补写 keychain ③ + setActive·置 ACTIVE_ALIGNED=1）然后 `exit`，`exit`
#        又触发 EXIT trap **第二次** on_exit_or_interrupt。第二次：前向对齐被 ACTIVE_ALIGNED 跳过（对），但**仍为真的**
#        OVERWRITE_IN_PROGRESS 让 elif 回滚 ①② → keychain/registry 对齐**新号**、①② 回退**旧号** = split-brain。
#      **本 case 用「①② 换号前不存在」放大成真损坏**：(24) 用 pre-existing ①·第二次回滚因 snapshot 已被首次 trap 清掉
#        而落到「无快照」else（不实际改 ①·只虚报告警），掩盖了逻辑 bug。这里 ① 不存在 → node 块**新建** ①·第二次误回滚
#        走 CRED_PREEXISTED=0 的 `rm -f "$cred_path"` 分支（不依赖 snapshot）→ **真删掉前向对齐刚写的新号 credentials.json**
#        → registry=alice 但 ① 文件被删 = 真 split-brain / brick。修后 forward-align 清 OVERWRITE_IN_PROGRESS → 第二次
#        trap 不再回滚 → ① 新号文件存活 + registry=alice·三存储一致对齐新号。
#      复现：slow security stub（③ 写时 sleep·给中断窗口·此刻 OVERWRITE_IN_PROGRESS 仍=1）；① 路径指向不存在文件；
#        switch 在 ③ sleep（已过 STORES_COMMITTED=1）期间被 SIGTERM → 断言三存储一致对齐新号、不被第二次 trap 误删。
# ──────────────────────────────────────────────────────────────────────────────────────────────────
FX28="$(make_fixture)"; REG28="$FX28/accounts.json"; VFILE28="$FX28/accounts.env"
# ① / ② paths point at files that DO NOT EXIST yet (node block will CREATE them·CRED_PREEXISTED=0 → 误回滚走 rm -f 分支).
CRED28="$FX28/new-credentials.json"; CJSON28="$FX28/new-claude.json"
[ -e "$CRED28" ] && rm -f "$CRED28"; [ -e "$CJSON28" ] && rm -f "$CJSON28"
cat > "$REG28" <<JSON
{ "schema": "cc-master/accounts/v1", "accounts": {
  "bob@y.com":   { "vault": {"kind":"keychain","service":"cc-master-oauth","account":"bob@y.com"}, "active": true, "last_switch_out": null },
  "alice@x.com": { "vault": {"kind":"file","path":"$VFILE28","key":"alice@x.com"}, "token_expires_at":"2027-06-17T10:40:00Z", "active": false, "last_switch_out": null, "identity": {"emailAddress":"alice@x.com","accountUuid":"uuid-alice"} }
} }
JSON
umask 077
printf 'alice@x.com_TOKEN=%s\n' "{\"accessToken\":\"$ALICE_AT\",\"refreshToken\":\"$ALICE_RT\",\"expiresAt\":1700000000000}" > "$VFILE28"; chmod 600 "$VFILE28"
# slow security stub: the FIRST official ③ write SLEEPS (SIGTERM lands mid-sleep → OVERWRITE_IN_PROGRESS still=1·exactly
#   the P1 window); the SECOND ③ write = the trap's forward-align re-commit (succeeds·proves keychain re-written to new号).
SECSTUB_SLOW28="$(make_project)"
cat > "$SECSTUB_SLOW28/security" <<'SEC'
#!/usr/bin/env bash
is_add=0; is_official=0; prev=""
for a in "$@"; do
  [ "$a" = "add-generic-password" ] && is_add=1
  [ "$prev" = "-s" ] && [ "$a" = "Claude Code-credentials" ] && is_official=1
  prev="$a"
done
if [ "$is_add" = "1" ] && [ "$is_official" = "1" ]; then
  CNT_FILE="${SEC_CALL_COUNT_FILE:-/dev/null}"
  n=0; [ -f "$CNT_FILE" ] && n="$(cat "$CNT_FILE" 2>/dev/null || echo 0)"; n=$((n+1)); printf '%s' "$n" > "$CNT_FILE" 2>/dev/null || true
  if [ "$n" = "1" ]; then
    [ -n "${SEC_READY_FILE:-}" ] && printf 'ready\n' > "$SEC_READY_FILE"
    sleep 8   # SIGTERM lands here (OVERWRITE_IN_PROGRESS still=1·STORES_COMMITTED=1) → the double-trap window.
  fi
fi
exit 0
SEC
chmod +x "$SECSTUB_SLOW28/security"
PORT28="$FX28/url.txt"; start_refresh_endpoint ok "$PORT28"; RURL28="$(cat "$PORT28")"
SEC_READY28="$FX28/sec.ready"; SEC_CNT28="$FX28/kc.count"
( PATH="$SECSTUB_SLOW28:$PATH" CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" REFRESH_TOKEN_URL="$RURL28" SEC_READY_FILE="$SEC_READY28" SEC_CALL_COUNT_FILE="$SEC_CNT28" CRED_PATH="$CRED28" CLAUDE_JSON_PATH="$CJSON28" \
  bash "$SCRIPT" --registry "$REG28" --email "alice@x.com" --now "2026-06-17T09:00:00Z" --no-snapshot >/dev/null 2>&1 ) &
sw28_pid=$!
# wait for the ③ keychain sleep to begin (①② already CREATED·STORES_COMMITTED=1·OVERWRITE_IN_PROGRESS still=1), then SIGTERM.
i=0; while [ ! -s "$SEC_READY28" ] && [ "$i" -lt 100 ]; do sleep 0.1; i=$((i+1)); done
sleep 0.3   # ensure we're inside the ③ sleep window.
kill -TERM "$sw28_pid" 2>/dev/null || true
wait "$sw28_pid" 2>/dev/null || true
# CORE: after the double-trap, the three stores must be CONSISTENTLY aligned to the NEW account (alice) — NOT split-brain.
#   ① credentials.json must EXIST and carry the FRESH (alice) token (forward-align created/committed it; the buggy 2nd-pass
#   rollback would have rm -f'd it → registry=alice but ① missing = split-brain). registry active must = alice.
if [ -f "$CRED28" ]; then PASS=$((PASS+1)); _green "(28) P1: forward-aligned ① credentials.json SURVIVES the 2nd trap (not rm -f'd·no split-brain)"; else FAILED=$((FAILED+1)); _red "FAIL: (28) P1 forward-aligned ① credentials.json DELETED by the 2nd trap's误回滚 (split-brain: registry=alice·① gone)"; fi
cred28_at="$(node -e 'try{const j=require(process.argv[1]);process.stdout.write(j.claudeAiOauth&&j.claudeAiOauth.accessToken||"NONE")}catch(_e){process.stdout.write("MISSING")}' "$CRED28" 2>/dev/null)"
assert_eq "$FRESH_AT" "$cred28_at" "(28) P1: ① credentials.json carries FRESH (alice) token (forward-align committed·2nd trap did NOT roll it back to旧号)"
active28="$(node -e 'const r=require(process.argv[1]).loadRegistry(process.argv[2]);const a=Object.entries(r.accounts||{}).find(([k,e])=>e.active===true);process.stdout.write(a?a[0]:"NONE")' "$LIB_JS" "$REG28" 2>/dev/null)"
assert_eq "alice@x.com" "$active28" "(28) P1 CORE: registry active = alice (forward-aligned) ⟺ ① credentials.json = alice(FRESH) — three stores CONSISTENT·no split-brain"
# exactly one active (uniqueness held through the double-trap).
nactive28="$(node -e 'const r=require(process.argv[1]).loadRegistry(process.argv[2]);process.stdout.write(String(Object.values(r.accounts||{}).filter(e=>e.active===true).length))' "$LIB_JS" "$REG28" 2>/dev/null)"
assert_eq "1" "$nactive28" "(28) P1: exactly ONE active account after the double-trap (active-uniqueness held)"
# the ③ keychain re-commit (forward-align) ran (2nd security call) AND no double forward-align (idempotent): count must be ≥2.
#   (the 1st call slept-then-killed·the 2nd is the forward-align re-commit; a buggy 3rd would mean the EXIT-trap re-ran forward-align.)
seccnt28="$(cat "$SEC_CNT28" 2>/dev/null || echo 0)"
if [ "$seccnt28" -ge 2 ] && [ "$seccnt28" -le 2 ]; then PASS=$((PASS+1)); _green "(28) P1: forward-align re-committed keychain exactly once (2 ③ writes total·2nd trap did NOT repeat forward-align·idempotent)"; else FAILED=$((FAILED+1)); _red "FAIL: (28) P1 keychain ③ write count=$seccnt28 (expected 2: 1 killed + 1 forward-align re-commit; >2 ⟹ 2nd trap repeated forward-align·not idempotent)"; fi
rm -rf "$FX28" "$SECSTUB_SLOW28"

# ──────────────────────────────────────────────────────────────────────────────────────────────────
# (29) **codex re-§7 P2 — forward-align 时 registry 对齐失败 → 收尾消息据实报「对齐失败」，绝不谎称「registry 一致」**.
#      病根（codex 复现）：前向对齐分支里 node mutateRegistry 自身失败（registry 锁超时 / accounts.json 损坏 / 目录不可写）
#        曾被 node 内 try/catch 吞掉，可下面仍无条件打印「三存储与 registry 一致·避免 split-brain」——谎称一致：实际
#        ①②③ 存储已新号、registry active 仍旧号 = split-brain，消息却说已避免。修：移除 node 内吞异常 try/catch，
#        `if node…then REG_ALIGNED=1`，消息按 REG_ALIGNED 分支（失败→诚实「registry active 对齐失败·下次
#        detect_current_active 反向对账」）。语义不变（非永久 split-brain·可自愈），只让消息不撒谎。
#      复现（hermetic·deterministic·无 lock-timing）：registry 放独立子目录；slow security stub 在**第一次**官方 ③ 写时
#        先把该子目录 chmod 只读（forward-align 的 mutateRegistry 建不了 <reg>.lock → O_EXCL EACCES 立即抛·非 EEXIST 不重试
#        → REG_ALIGNED=0），再 sleep 8（SIGTERM 落在 sleep 中·OVERWRITE_IN_PROGRESS 仍=1·STORES_COMMITTED=1）。换号锁挂在
#        CRED_PATH（FX 根·可写·不受影响·line 1389），故只 registry 写失败。断言 stderr 走**诚实失败分支**（且不含过度声称）
#        + ① credentials.json 仍 FRESH（P1 不回滚·独立于 REG_ALIGNED）。
# ──────────────────────────────────────────────────────────────────────────────────────────────────
FX29="$(make_fixture)"; REGDIR29="$FX29/regdir"; mkdir -p "$REGDIR29"; REG29="$REGDIR29/accounts.json"; VFILE29="$FX29/accounts.env"
CRED29="$FX29/new-credentials.json"; CJSON29="$FX29/new-claude.json"
[ -e "$CRED29" ] && rm -f "$CRED29"; [ -e "$CJSON29" ] && rm -f "$CJSON29"
cat > "$REG29" <<JSON
{ "schema": "cc-master/accounts/v1", "accounts": {
  "bob@y.com":   { "vault": {"kind":"keychain","service":"cc-master-oauth","account":"bob@y.com"}, "active": true, "last_switch_out": null },
  "alice@x.com": { "vault": {"kind":"file","path":"$VFILE29","key":"alice@x.com"}, "token_expires_at":"2027-06-17T10:40:00Z", "active": false, "last_switch_out": null, "identity": {"emailAddress":"alice@x.com","accountUuid":"uuid-alice"} }
} }
JSON
umask 077
printf 'alice@x.com_TOKEN=%s\n' "{\"accessToken\":\"$ALICE_AT\",\"refreshToken\":\"$ALICE_RT\",\"expiresAt\":1700000000000}" > "$VFILE29"; chmod 600 "$VFILE29"
# slow security stub: on the 1st official ③ write, FIRST chmod the registry DIR read-only (forward-align mutateRegistry
#   cannot create <reg>.lock → throws → REG_ALIGNED=0), THEN sleep 8 (SIGTERM lands mid-sleep·the post-commit window).
#   The 2nd official ③ write (forward-align keychain re-commit) just exits 0.  `<<SEC` UNQUOTED so $REGDIR29 expands now;
#   runtime vars are \$-escaped to survive into the generated stub.
SECSTUB_RO29="$(make_project)"
cat > "$SECSTUB_RO29/security" <<SEC
#!/usr/bin/env bash
is_add=0; is_official=0; prev=""
for a in "\$@"; do
  [ "\$a" = "add-generic-password" ] && is_add=1
  [ "\$prev" = "-s" ] && [ "\$a" = "Claude Code-credentials" ] && is_official=1
  prev="\$a"
done
if [ "\$is_add" = "1" ] && [ "\$is_official" = "1" ]; then
  CNT_FILE="\${SEC_CALL_COUNT_FILE:-/dev/null}"
  n=0; [ -f "\$CNT_FILE" ] && n="\$(cat "\$CNT_FILE" 2>/dev/null || echo 0)"; n=\$((n+1)); printf '%s' "\$n" > "\$CNT_FILE" 2>/dev/null || true
  if [ "\$n" = "1" ]; then
    chmod 555 "$REGDIR29" 2>/dev/null || true
    [ -n "\${SEC_READY_FILE:-}" ] && printf 'ready\n' > "\$SEC_READY_FILE"
    sleep 8
  fi
fi
exit 0
SEC
chmod +x "$SECSTUB_RO29/security"
PORT29="$FX29/url.txt"; start_refresh_endpoint ok "$PORT29"; RURL29="$(cat "$PORT29")"
SEC_READY29="$FX29/sec.ready"; SEC_CNT29="$FX29/kc.count"; STDERR29="$FX29/switch.stderr"
( PATH="$SECSTUB_RO29:$PATH" CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" REFRESH_TOKEN_URL="$RURL29" SEC_READY_FILE="$SEC_READY29" SEC_CALL_COUNT_FILE="$SEC_CNT29" CRED_PATH="$CRED29" CLAUDE_JSON_PATH="$CJSON29" CCM_REGISTRY_LOCK_TIMEOUT_MS=2000 \
  bash "$SCRIPT" --registry "$REG29" --email "alice@x.com" --now "2026-06-17T09:00:00Z" --no-snapshot >/dev/null 2>"$STDERR29" ) &
sw29_pid=$!
i=0; while [ ! -s "$SEC_READY29" ] && [ "$i" -lt 100 ]; do sleep 0.1; i=$((i+1)); done
sleep 0.3   # inside the ③ sleep window·registry dir already read-only.
kill -TERM "$sw29_pid" 2>/dev/null || true
wait "$sw29_pid" 2>/dev/null || true
chmod 755 "$REGDIR29" 2>/dev/null || true   # restore writable for cleanup (rm -rf needs w+x on the dir).
# CORE: the trap's forward-align registry write FAILED → the wrap-up message must HONESTLY report 对齐失败, NOT over-claim一致.
if grep -q "registry active 对齐失败" "$STDERR29" 2>/dev/null; then PASS=$((PASS+1)); _green "(29) P2: registry-align failure → wrap-up message HONESTLY reports 「registry active 对齐失败」 (no over-claim)"; else FAILED=$((FAILED+1)); _red "FAIL: (29) P2 registry-align failed but message did NOT report 对齐失败 (stderr tail: $(tr '\n' ' ' < "$STDERR29" 2>/dev/null | tail -c 220))"; fi
if grep -q "三存储与 registry 一致" "$STDERR29" 2>/dev/null; then FAILED=$((FAILED+1)); _red "FAIL: (29) P2 message OVER-CLAIMS 「三存储与 registry 一致」 while registry-align actually FAILED (the lying-message bug)"; else PASS=$((PASS+1)); _green "(29) P2: message does NOT over-claim consistency when registry-align failed"; fi
# ① credentials.json must still be FRESH (P1 rollback-suppression holds independent of the registry-align outcome·no brick).
cred29_at="$(node -e 'try{const j=require(process.argv[1]);process.stdout.write(j.claudeAiOauth&&j.claudeAiOauth.accessToken||"NONE")}catch(_e){process.stdout.write("MISSING")}' "$CRED29" 2>/dev/null)"
assert_eq "$FRESH_AT" "$cred29_at" "(29) P2: ① credentials.json stays FRESH (forward-align committed stores NOT rolled back·even when registry-align fails)"
rm -rf "$FX29" "$SECSTUB_RO29"

# ──────────────────────────────────────────────────────────────────────────────────────────────────
# (30) **RC-P3 — forward-align 时切入号不在 registry → mutateRegistry 成功但 no-op → 绝不谎称「registry 一致」**.
#      病根（与 (29) 的失败模式互补·(29) 测 mutateRegistry 自身 throw·本 case 测 mutateRegistry 成功却 no-op）：
#        前向对齐分支的 mutator 形如 `if (reg.accounts[email]) setActive(...)`——当切入号**尚未录入 registry**
#        （accounts.json 无该 email entry）时，guard 为假 → mutator 啥也不做 → mutateRegistry 正常返回 →
#        `if node…then REG_ALIGNED=1` 误判 REG_ALIGNED=1 → 收尾打印「三存储与 registry 一致·避免 split-brain」。
#        实际：①②③ 存储已是切入号、registry active 仍指旧号（stale·与现实脱节）= 正是 set_active_in 正常路径
#        exit-5 处理的同一 stale-registry 情形（codex round#3 Finding A），却在 trap 路径被谎称已对齐。
#      修：mutator 在账号缺失时显式 exit 非零（throw）→ REG_ALIGNED=0 → 走 (29) 已有的诚实失败分支
#        （「registry active 对齐失败」消息），口径与 set_active_in exit-5 一致·绝不谎报一致。
#      复现（hermetic·deterministic·照搬 (29)/(28) 的 slow-③-stub + SIGTERM 套路·无 lock-timing）：registry **只含 bob**
#        （active·切出号），切入号 alice@x.com **不在 registry**（vault 形态/路径用显式 --vault-kind/--vault-file 给·
#        因 registry 无 alice entry 可读）。slow security stub 在第一次官方 ③ 写时 sleep（SIGTERM 落在 sleep 中·
#        STORES_COMMITTED=1·ACTIVE_ALIGNED=0·OVERWRITE_IN_PROGRESS 仍=1）。SIGTERM → trap 前向对齐 → mutateRegistry 找不到
#        alice → 修前 no-op + REG_ALIGNED=1（谎报一致·RED）；修后显式 throw → REG_ALIGNED=0（诚实失败·GREEN）。
#        断言：stderr **不含** 过度声称「三存储与 registry 一致」 + ① credentials.json 仍 FRESH（前向对齐已提交·不回滚）。
# ──────────────────────────────────────────────────────────────────────────────────────────────────
FX30="$(make_fixture)"; REG30="$FX30/accounts.json"; VFILE30="$FX30/accounts.env"
CRED30="$FX30/new-credentials.json"; CJSON30="$FX30/new-claude.json"
[ -e "$CRED30" ] && rm -f "$CRED30"; [ -e "$CJSON30" ] && rm -f "$CJSON30"
# registry 只有 bob（active·切出号）——切入号 alice@x.com **不在 registry**（这正是 RC-P3 的触发前提）。
cat > "$REG30" <<JSON
{ "schema": "cc-master/accounts/v1", "accounts": {
  "bob@y.com": { "vault": {"kind":"keychain","service":"cc-master-oauth","account":"bob@y.com"}, "active": true, "last_switch_out": null }
} }
JSON
umask 077
# alice 的 token 放 file vault（registry 无 alice entry → vault 形态/路径靠显式 --vault-kind file --vault-file 给）。
printf 'alice@x.com_TOKEN=%s\n' "{\"accessToken\":\"$ALICE_AT\",\"refreshToken\":\"$ALICE_RT\",\"expiresAt\":1700000000000}" > "$VFILE30"; chmod 600 "$VFILE30"
# slow security stub（同 (28)）：第一次官方 ③ 写 sleep → SIGTERM 落在 sleep 中（post-commit 窗口）；第二次 ③ 写（前向对齐补写）即返回。
SECSTUB_SLOW30="$(make_project)"
cat > "$SECSTUB_SLOW30/security" <<'SEC'
#!/usr/bin/env bash
is_add=0; is_official=0; prev=""
for a in "$@"; do
  [ "$a" = "add-generic-password" ] && is_add=1
  [ "$prev" = "-s" ] && [ "$a" = "Claude Code-credentials" ] && is_official=1
  prev="$a"
done
if [ "$is_add" = "1" ] && [ "$is_official" = "1" ]; then
  CNT_FILE="${SEC_CALL_COUNT_FILE:-/dev/null}"
  n=0; [ -f "$CNT_FILE" ] && n="$(cat "$CNT_FILE" 2>/dev/null || echo 0)"; n=$((n+1)); printf '%s' "$n" > "$CNT_FILE" 2>/dev/null || true
  if [ "$n" = "1" ]; then
    [ -n "${SEC_READY_FILE:-}" ] && printf 'ready\n' > "$SEC_READY_FILE"
    sleep 8   # SIGTERM lands here (post-commit window·forward-align trap will fire on the not-in-registry email).
  fi
fi
exit 0
SEC
chmod +x "$SECSTUB_SLOW30/security"
PORT30="$FX30/url.txt"; start_refresh_endpoint ok "$PORT30"; RURL30="$(cat "$PORT30")"
SEC_READY30="$FX30/sec.ready"; SEC_CNT30="$FX30/kc.count"; STDERR30="$FX30/switch.stderr"
# --email alice@x.com (EXPLICIT·skips auto-select) + explicit vault flags (registry has no alice entry to read vault from).
( PATH="$SECSTUB_SLOW30:$PATH" CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" REFRESH_TOKEN_URL="$RURL30" SEC_READY_FILE="$SEC_READY30" SEC_CALL_COUNT_FILE="$SEC_CNT30" CRED_PATH="$CRED30" CLAUDE_JSON_PATH="$CJSON30" \
  bash "$SCRIPT" --registry "$REG30" --email "alice@x.com" --vault-kind file --vault-file "$VFILE30" --now "2026-06-17T09:00:00Z" --no-snapshot >/dev/null 2>"$STDERR30" ) &
sw30_pid=$!
i=0; while [ ! -s "$SEC_READY30" ] && [ "$i" -lt 100 ]; do sleep 0.1; i=$((i+1)); done
sleep 0.3   # inside the ③ sleep window (post-commit·forward-align trap will run on SIGTERM).
kill -TERM "$sw30_pid" 2>/dev/null || true
wait "$sw30_pid" 2>/dev/null || true
# CORE: forward-align found the switch-in email NOT in registry → it MUST NOT over-claim「三存储与 registry 一致」.
#   修前：mutator no-op → REG_ALIGNED=1 → 谎报一致（RED）。修后：mutator throw → REG_ALIGNED=0 → 诚实失败分支（GREEN）。
if grep -q "三存储与 registry 一致" "$STDERR30" 2>/dev/null; then FAILED=$((FAILED+1)); _red "FAIL: (30) RC-P3 message OVER-CLAIMS 「三存储与 registry 一致」 while switch-in email NOT in registry (the no-op-mutator lying-message bug)"; else PASS=$((PASS+1)); _green "(30) RC-P3: not-in-registry forward-align does NOT over-claim consistency (no-op mutator → honest failure)"; fi
# and it MUST report the honest registry-align failure (same口径 as (29)·set_active_in exit-5).
if grep -q "registry active 对齐失败" "$STDERR30" 2>/dev/null; then PASS=$((PASS+1)); _green "(30) RC-P3: not-in-registry forward-align HONESTLY reports 「registry active 对齐失败」 (aligned with set_active_in exit-5)"; else FAILED=$((FAILED+1)); _red "FAIL: (30) RC-P3 switch-in not in registry but message did NOT report 对齐失败 (stderr tail: $(tr '\n' ' ' < "$STDERR30" 2>/dev/null | tail -c 240))"; fi
# ① credentials.json must still be FRESH (forward-align committed the stores·NOT rolled back·independent of REG_ALIGNED·no brick).
cred30_at="$(node -e 'try{const j=require(process.argv[1]);process.stdout.write(j.claudeAiOauth&&j.claudeAiOauth.accessToken||"NONE")}catch(_e){process.stdout.write("MISSING")}' "$CRED30" 2>/dev/null)"
assert_eq "$FRESH_AT" "$cred30_at" "(30) RC-P3: ① credentials.json stays FRESH (forward-align committed stores NOT rolled back·even when switch-in not in registry)"
rm -rf "$FX30" "$SECSTUB_SLOW30"

# ──────────────────────────────────────────────────────────────────────────────────────────────────
# (31) **切出 token 抢救 happy-path（Finding #72·补 vault↔官方存储单向失同步）**.
#      切入 alice 时，覆写官方存储【之前】把官方存储当前 blob（属切出号 bob·被 claude 自主 refresh 更新到最新·含
#      已轮转的新 refreshToken）读出 → 身份 guard 过（~/.claude.json oauthAccount.emailAddress == bob）→ token-blind
#      回写 bob 的 file vault。断言：bob vault 的 _TOKEN 行从 STALE 刷新成官方存储里的 FRESH refreshToken（修前 bob
#      vault 停在切入那刻旧值·下次切回 refresh 失败成死号）。stub security no-op → read_official_blob 走 CRED_PATH fallback。
# ──────────────────────────────────────────────────────────────────────────────────────────────────
BOB_OFFICIAL_AT='sk-ant-oat01-BOBofficialFRESHaccess0000000000000bbbbbb-_bof'
BOB_OFFICIAL_RT='sk-ant-ort01-BOBofficialFRESHrefresh000000000000bbbbbb-_bof'
BOB_STALE_RT='sk-ant-ort01-BOBstaleVAULTrefresh00000000000000bbbbbb-_bst'
FX31="$(make_fixture)"; REG31="$FX31/accounts.json"
VFILE_BOB31="$FX31/accounts-bob.env"; VFILE_ALICE31="$FX31/accounts-alice.env"
CRED31="$FX31/credentials.json"; CJSON31="$FX31/claude.json"
cat > "$REG31" <<JSON
{ "schema": "cc-master/accounts/v1", "accounts": {
  "bob@y.com":   { "vault": {"kind":"file","path":"$VFILE_BOB31","key":"bob@y.com"}, "active": true, "last_switch_out": null },
  "alice@x.com": { "vault": {"kind":"file","path":"$VFILE_ALICE31","key":"alice@x.com"}, "token_expires_at":"2027-06-17T10:40:00Z", "active": false, "last_switch_out": null, "identity": {"emailAddress":"new@y.com","accountUuid":"uuid-new","subscriptionType":"max"} }
} }
JSON
umask 077
# bob vault: STALE token line（其 refreshToken 早被服务端轮转吊销·这是 Finding #72 病根状态）。
printf 'bob@y.com_TOKEN=%s\n' "{\"accessToken\":\"sk-ant-oat01-BOBstaleACCESS00000000000000000-_bs\",\"refreshToken\":\"$BOB_STALE_RT\",\"expiresAt\":1600000000000,\"subscriptionType\":\"max\"}" > "$VFILE_BOB31"; chmod 600 "$VFILE_BOB31"
# alice vault: 完整 blob（供 refresh + 切入）。
printf 'alice@x.com_TOKEN=%s\n' "{\"accessToken\":\"$ALICE_AT\",\"refreshToken\":\"$ALICE_RT\",\"expiresAt\":1700000000000,\"subscriptionType\":\"max\"}" > "$VFILE_ALICE31"; chmod 600 "$VFILE_ALICE31"
# 官方存储（credentials.json）= 切出号 bob 被 claude 自主 refresh 更新到最新的 blob（含已轮转的新 refreshToken）。
cat > "$CRED31" <<JSON
{"claudeAiOauth":{"accessToken":"$BOB_OFFICIAL_AT","refreshToken":"$BOB_OFFICIAL_RT","expiresAt":1700000000000,"subscriptionType":"max"},"keepKey":"k"}
JSON
# ~/.claude.json oauthAccount.emailAddress = bob（身份 guard：官方存储当前确属切出号 bob）。
cat > "$CJSON31" <<'JSON'
{"oauthAccount":{"emailAddress":"bob@y.com","subscriptionType":"max"},"numStartups":1,"theme":"dark"}
JSON
PORT31="$FX31/url.txt"; start_refresh_endpoint ok "$PORT31"; RURL31="$(cat "$PORT31")"
out31="$(PATH="$SECSTUB:$PATH" CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" REFRESH_TOKEN_URL="$RURL31" CRED_PATH="$CRED31" CLAUDE_JSON_PATH="$CJSON31" \
        bash "$SCRIPT" --registry "$REG31" --email "alice@x.com" --now "2026-06-17T09:00:00Z" --no-snapshot 2>&1)"; rc31=$?
assert_eq "0" "$rc31" "(31) switch with switch-out rescue exits 0"
# CORE: bob vault 的 _TOKEN 行被刷新成官方存储里的 FRESH refreshToken（抢救生效）。
if grep -q "$BOB_OFFICIAL_RT" "$VFILE_BOB31" 2>/dev/null; then PASS=$((PASS+1)); _green "(31) rescue: bob vault refreshed to官方存储's FRESH refreshToken (Finding #72 反向回流闭环)"; else FAILED=$((FAILED+1)); _red "FAIL: (31) rescue did NOT writeback official blob to bob vault (vault tail: $(tr -d '\n' < "$VFILE_BOB31" 2>/dev/null | tail -c 80))"; fi
# STALE token 行已被替换（不再残留旧 refreshToken·只删 _TOKEN 行重写）。
if grep -q "$BOB_STALE_RT" "$VFILE_BOB31" 2>/dev/null; then FAILED=$((FAILED+1)); _red "FAIL: (31) bob vault still carries STALE refreshToken (old _TOKEN line not replaced)"; else PASS=$((PASS+1)); _green "(31) rescue: bob vault STALE refreshToken replaced (no stale残留)"; fi
# 恰一条 bob _TOKEN 行（无重复）。
n31_tok="$(grep -c '^bob@y.com_TOKEN=' "$VFILE_BOB31" 2>/dev/null)"
assert_eq "1" "$n31_tok" "(31) rescue: exactly one bob _TOKEN line after writeback (old replaced, no dup)"
# 抢救成功消息透传（非密·无 token）。
assert_contains "$out31" "回写切出号（bob@y.com）vault" "(31) rescue: success message surfaced (反向回流 done)"
# token no-leak：官方/陈旧 refresh token 绝不出现在脚本输出（只该进 vault 文件·不进 stdout/stderr）。
assert_not_contains "$out31" "$BOB_OFFICIAL_RT" "(31) rescue: official refresh token does NOT leak in switch output"
assert_not_contains "$out31" "$BOB_STALE_RT"    "(31) rescue: stale refresh token does NOT leak in switch output"
for p in "${ENDPOINT_PIDS[@]}"; do kill "$p" 2>/dev/null || true; done
rm -rf "$FX31"

# ──────────────────────────────────────────────────────────────────────────────────────────────────
# (31b) **切出 token 抢救 身份 guard（防 mislabel·安全关键）**.
#       同 (31)，但 ~/.claude.json oauthAccount.emailAddress = mallory（≠ 切出号 bob）——官方存储当前不是 bob（用户
#       手动 /login 切过？）→ 身份 guard 必须拒绝、绝不把这份 token 写进 bob vault（否则污染号池）。断言：bob vault
#       保持 STALE 不变 + 抢救跳过消息透传。换号本身照常成功（best-effort·绝不阻断）。
# ──────────────────────────────────────────────────────────────────────────────────────────────────
FX31B="$(make_fixture)"; REG31B="$FX31B/accounts.json"
VFILE_BOB31B="$FX31B/accounts-bob.env"; VFILE_ALICE31B="$FX31B/accounts-alice.env"
CRED31B="$FX31B/credentials.json"; CJSON31B="$FX31B/claude.json"
cat > "$REG31B" <<JSON
{ "schema": "cc-master/accounts/v1", "accounts": {
  "bob@y.com":   { "vault": {"kind":"file","path":"$VFILE_BOB31B","key":"bob@y.com"}, "active": true, "last_switch_out": null },
  "alice@x.com": { "vault": {"kind":"file","path":"$VFILE_ALICE31B","key":"alice@x.com"}, "token_expires_at":"2027-06-17T10:40:00Z", "active": false, "last_switch_out": null, "identity": {"emailAddress":"new@y.com","accountUuid":"uuid-new","subscriptionType":"max"} }
} }
JSON
umask 077
printf 'bob@y.com_TOKEN=%s\n' "{\"accessToken\":\"sk-ant-oat01-BOBstaleACCESS00000000000000000-_bs\",\"refreshToken\":\"$BOB_STALE_RT\",\"expiresAt\":1600000000000,\"subscriptionType\":\"max\"}" > "$VFILE_BOB31B"; chmod 600 "$VFILE_BOB31B"
printf 'alice@x.com_TOKEN=%s\n' "{\"accessToken\":\"$ALICE_AT\",\"refreshToken\":\"$ALICE_RT\",\"expiresAt\":1700000000000,\"subscriptionType\":\"max\"}" > "$VFILE_ALICE31B"; chmod 600 "$VFILE_ALICE31B"
cat > "$CRED31B" <<JSON
{"claudeAiOauth":{"accessToken":"$BOB_OFFICIAL_AT","refreshToken":"$BOB_OFFICIAL_RT","expiresAt":1700000000000,"subscriptionType":"max"}}
JSON
# 身份不匹配：官方存储 oauthAccount 标的是 mallory，不是切出号 bob → guard 拒绝。
cat > "$CJSON31B" <<'JSON'
{"oauthAccount":{"emailAddress":"mallory@evil.com","subscriptionType":"max"},"numStartups":1}
JSON
PORT31B="$FX31B/url.txt"; start_refresh_endpoint ok "$PORT31B"; RURL31B="$(cat "$PORT31B")"
out31b="$(PATH="$SECSTUB:$PATH" CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" REFRESH_TOKEN_URL="$RURL31B" CRED_PATH="$CRED31B" CLAUDE_JSON_PATH="$CJSON31B" \
         bash "$SCRIPT" --registry "$REG31B" --email "alice@x.com" --now "2026-06-17T09:00:00Z" --no-snapshot 2>&1)"; rc31b=$?
assert_eq "0" "$rc31b" "(31b) switch still exits 0 (rescue skip never blocks switch·best-effort)"
# CORE: 身份不匹配 → bob vault 绝不被写入官方 token（保持 STALE·防 mislabel 污染号池）。
if grep -q "$BOB_OFFICIAL_RT" "$VFILE_BOB31B" 2>/dev/null; then FAILED=$((FAILED+1)); _red "FAIL: (31b) identity guard BREACHED — official token written to bob vault despite oauthAccount≠bob (号池污染)"; else PASS=$((PASS+1)); _green "(31b) identity guard: official token NOT written to bob vault when oauthAccount≠切出号 (防 mislabel)"; fi
if grep -q "$BOB_STALE_RT" "$VFILE_BOB31B" 2>/dev/null; then PASS=$((PASS+1)); _green "(31b) identity guard: bob vault stays STALE unchanged (rescue correctly skipped)"; else FAILED=$((FAILED+1)); _red "FAIL: (31b) bob vault STALE line unexpectedly altered"; fi
assert_contains "$out31b" "≠ 切出号" "(31b) identity guard: skip message surfaced (官方存储身份≠切出号)"
for p in "${ENDPOINT_PIDS[@]}"; do kill "$p" 2>/dev/null || true; done
rm -rf "$FX31B"

# ──────────────────────────────────────────────────────────────────────────────────────────────────
# (32) **policy 机制硬闸 — deny 拦截（ADR-016 §2.2）**.
#      stub `ccm` 返回 autonomous_account_switch="deny" → switch-account.sh 必须：
#        ① exit 7（policy-deny 拒绝码）；
#        ② 官方三存储文件**保持 OLD 值**（凭证一字未改）；
#        ③ registry active 未翻（alice 仍 false / bob 仍 true）。
#      反向 teeth：若 policy 闸缺失或 deny 未拦，deny case 会通过，rc=0 + 三存储被改 → FAIL。
# ──────────────────────────────────────────────────────────────────────────────────────────────────
FX32="$(make_fixture)"; REG32="$FX32/accounts.json"; VFILE32="$FX32/accounts.env"
CRED32="$FX32/credentials.json"; CJSON32="$FX32/claude.json"
cat > "$REG32" <<JSON
{ "schema": "cc-master/accounts/v1", "accounts": {
  "bob@y.com":   { "vault": {"kind":"keychain","service":"cc-master-oauth","account":"bob@y.com"}, "active": true, "last_switch_out": null },
  "alice@x.com": { "vault": {"kind":"file","path":"$VFILE32","key":"alice@x.com"}, "token_expires_at":"2027-06-17T10:40:00Z", "active": false, "last_switch_out": null, "identity": {"emailAddress":"alice@x.com","accountUuid":"uuid-alice","subscriptionType":"max"} }
} }
JSON
umask 077
printf 'alice@x.com_TOKEN=%s\n' "{\"accessToken\":\"$ALICE_AT\",\"refreshToken\":\"$ALICE_RT\",\"expiresAt\":1700000000000,\"subscriptionType\":\"max\"}" > "$VFILE32"; chmod 600 "$VFILE32"
# pre-seed OLD official stores — must remain unchanged after a deny block.
OLD32_AT='sk-ant-oat01-OLDcred32AAA000000000000000000-_o'
cat > "$CRED32" <<JSON
{"claudeAiOauth":{"accessToken":"$OLD32_AT","refreshToken":"sk-ant-ort01-OLDcred32r00000000000000000-_o","expiresAt":1700000000000,"subscriptionType":"pro"}}
JSON
cat > "$CJSON32" <<'JSON'
{"oauthAccount":{"emailAddress":"old@x.com","subscriptionType":"pro"},"numStartups":7}
JSON
PORT32="$FX32/url.txt"; start_refresh_endpoint ok "$PORT32"; RURL32="$(cat "$PORT32")"
# stub `ccm` that returns autonomous_account_switch="deny" for `policy show --json`.
CCM32="$(make_project)"
cat > "$CCM32/ccm" <<'CCM'
#!/usr/bin/env bash
# stub ccm: `policy show --json` → deny; any other subcommand → exit 0 silently (e.g. `log add`).
if [ "${1:-}" = "policy" ] && [ "${2:-}" = "show" ]; then
  printf '%s\n' '{"ok":true,"data":{"policy":{"autonomous_account_switch":"deny"},"effective":{"autonomous_account_switch":"deny"}}}'
fi
exit 0
CCM
chmod +x "$CCM32/ccm"
# ccm 解析现优先 CCM_BIN（bug2 修复）→ stub 经 CCM_BIN 注入（canonical 路径·不受 run-tests.sh 继承的 dev-shim CCM_BIN 干扰）。
out32="$(PATH="$CCM32:$SECSTUB:$PATH" CCM_BIN="$CCM32/ccm" CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" REFRESH_TOKEN_URL="$RURL32" CRED_PATH="$CRED32" CLAUDE_JSON_PATH="$CJSON32" \
        bash "$SCRIPT" --registry "$REG32" --email "alice@x.com" --now "2026-06-17T09:00:00Z" --no-snapshot 2>&1)"; rc32=$?
# ① rc must be 7 (policy-deny拒绝码·区别于其他失败码).
assert_eq "7" "$rc32" "(32) policy deny: exit code must be 7 (policy-deny blocked)"
# ② 官方三存储 ① credentials.json 必须保持 OLD token（policy 闸拦在覆写之前·一字未改）.
cred32_at="$(node -e 'try{const j=require(process.argv[1]);process.stdout.write(j.claudeAiOauth.accessToken||"NONE")}catch(_e){process.stdout.write("ERROR")}' "$CRED32" 2>/dev/null)"
assert_eq "$OLD32_AT" "$cred32_at" "(32) policy deny: credentials.json UNCHANGED (凭证三存储未被覆写·policy 闸生效)"
# ② ~/.claude.json oauthAccount must be unchanged (emailAddress still old@x.com).
cj32_email="$(node -e 'try{const j=require(process.argv[1]);process.stdout.write(j.oauthAccount.emailAddress||"NONE")}catch(_e){process.stdout.write("ERROR")}' "$CJSON32" 2>/dev/null)"
assert_eq "old@x.com" "$cj32_email" "(32) policy deny: ~/.claude.json oauthAccount UNCHANGED (emailAddress still old@x.com)"
# ③ registry active NOT flipped (alice stays false / bob stays true).
alice32="$(node -e 'try{const r=require(process.argv[1]).loadRegistry(process.argv[2]);process.stdout.write(String(r.accounts["alice@x.com"].active))}catch(_e){process.stdout.write("ERROR")}' "$LIB_JS" "$REG32" 2>/dev/null)"
bob32="$(node -e 'try{const r=require(process.argv[1]).loadRegistry(process.argv[2]);process.stdout.write(String(r.accounts["bob@y.com"].active))}catch(_e){process.stdout.write("ERROR")}' "$LIB_JS" "$REG32" 2>/dev/null)"
assert_eq "false" "$alice32" "(32) policy deny: registry alice active NOT flipped (stays false)"
assert_eq "true"  "$bob32"   "(32) policy deny: registry bob still active=true"
# stderr must surface the deny message.
assert_contains "$out32" "board.policy" "(32) policy deny: stderr surfaces board.policy拦截消息"
assert_contains "$out32" "deny" "(32) policy deny: stderr contains 'deny'"
# ④ vault NOT refreshed/written-back（policy 闸前移关键断言·codex P2 bug fix）：
#    deny 时 policy 闸必须在 refresh 和 vault 回写之前拦截。
#    检验：vault 文件仍含 ALICE_AT（原 accessToken）、不含 FRESH_AT（stub refresh endpoint 的新 token）。
#    若闸仍在 refresh 之后：refresh 已发生、vault blob 已被回写 FRESH_AT → vault 文件含 FRESH_AT → 断言失败。
#    这正是 codex 指出的 bug 的反向 teeth：「deny 时 vault 已被 refresh/改写」= 此断言失败。
vault32_content="$(cat "$VFILE32" 2>/dev/null || true)"
if echo "$vault32_content" | grep -qF "$FRESH_AT" 2>/dev/null; then
  FAILED=$((FAILED+1)); _red "FAIL: (32) policy deny+needs-refresh: vault was refreshed/overwritten (FRESH_AT found in vault) — policy gate ran AFTER refresh, not before!"
else
  PASS=$((PASS+1)); _green "(32) policy deny+needs-refresh: vault NOT refreshed/written (FRESH_AT absent — policy gate runs before any credential op)"
fi
# ④b vault blob refresh token also unchanged (still ALICE_RT, not FRESH_RT).
if echo "$vault32_content" | grep -qF "$FRESH_RT" 2>/dev/null; then
  FAILED=$((FAILED+1)); _red "FAIL: (32) policy deny: vault refresh token was rotated (FRESH_RT found in vault) — refresh happened before policy gate"
else
  PASS=$((PASS+1)); _green "(32) policy deny: vault refresh token NOT rotated (FRESH_RT absent — no refresh occurred before deny)"
fi
# **反向 teeth**: if policy gate is absent / not wired, the deny stub would be silently ignored and switch
#   would succeed (rc=0, cred overwritten) — this test MUST fail in that case (the assertions above catch it).
rm -rf "$FX32" "$CCM32"

# ──────────────────────────────────────────────────────────────────────────────────────────────────
# (33) **policy 机制硬闸 — allow 放行（ADR-016 §2.3）**.
#      stub `ccm` 返回 autonomous_account_switch="allow" → 换号正常完成（rc=0·三存储被覆写·active 翻转）。
# ──────────────────────────────────────────────────────────────────────────────────────────────────
FX33="$(make_fixture)"; REG33="$FX33/accounts.json"; VFILE33="$FX33/accounts.env"
CRED33="$FX33/credentials.json"; CJSON33="$FX33/claude.json"
cat > "$REG33" <<JSON
{ "schema": "cc-master/accounts/v1", "accounts": {
  "bob@y.com":   { "vault": {"kind":"keychain","service":"cc-master-oauth","account":"bob@y.com"}, "active": true, "last_switch_out": null },
  "alice@x.com": { "vault": {"kind":"file","path":"$VFILE33","key":"alice@x.com"}, "token_expires_at":"2027-06-17T10:40:00Z", "active": false, "last_switch_out": null, "identity": {"emailAddress":"alice@x.com","accountUuid":"uuid-alice","subscriptionType":"max"} }
} }
JSON
umask 077
printf 'alice@x.com_TOKEN=%s\n' "{\"accessToken\":\"$ALICE_AT\",\"refreshToken\":\"$ALICE_RT\",\"expiresAt\":1700000000000,\"subscriptionType\":\"max\"}" > "$VFILE33"; chmod 600 "$VFILE33"
cat > "$CRED33" <<'JSON'
{"claudeAiOauth":{"accessToken":"sk-ant-oat01-OLDcred33AAA000000000000000000-_o","refreshToken":"sk-ant-ort01-OLDcred33r00000000000000000-_o","expiresAt":1700000000000,"subscriptionType":"pro"}}
JSON
cat > "$CJSON33" <<'JSON'
{"oauthAccount":{"emailAddress":"old@x.com","subscriptionType":"pro"},"numStartups":3}
JSON
PORT33="$FX33/url.txt"; start_refresh_endpoint ok "$PORT33"; RURL33="$(cat "$PORT33")"
# stub `ccm` that returns autonomous_account_switch="allow".
CCM33="$(make_project)"
cat > "$CCM33/ccm" <<'CCM'
#!/usr/bin/env bash
# stub ccm: `policy show --json` → allow; other subcommands → exit 0.
if [ "${1:-}" = "policy" ] && [ "${2:-}" = "show" ]; then
  printf '%s\n' '{"ok":true,"data":{"policy":{"autonomous_account_switch":"allow"},"effective":{"autonomous_account_switch":"allow"}}}'
fi
exit 0
CCM
chmod +x "$CCM33/ccm"
# stub 经 CCM_BIN 注入（canonical 路径·bug2 修复后 CCM_BIN 优先于 PATH·不受继承 dev-shim 干扰）。
out33="$(PATH="$CCM33:$SECSTUB:$PATH" CCM_BIN="$CCM33/ccm" CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" REFRESH_TOKEN_URL="$RURL33" CRED_PATH="$CRED33" CLAUDE_JSON_PATH="$CJSON33" \
        bash "$SCRIPT" --registry "$REG33" --email "alice@x.com" --now "2026-06-17T09:00:00Z" --no-snapshot 2>&1)"; rc33=$?
assert_eq "0" "$rc33" "(33) policy allow: switch exits 0 (正常换号·policy 放行)"
# credentials.json must be overwritten with FRESH token (happy-path succeeded).
cred33_at="$(node -e 'try{const j=require(process.argv[1]);process.stdout.write(j.claudeAiOauth.accessToken||"NONE")}catch(_e){process.stdout.write("ERROR")}' "$CRED33" 2>/dev/null)"
assert_eq "$FRESH_AT" "$cred33_at" "(33) policy allow: credentials.json overwritten with FRESH token (换号完成)"
# registry: alice active, bob inactive.
alice33="$(node -e 'try{const r=require(process.argv[1]).loadRegistry(process.argv[2]);process.stdout.write(String(r.accounts["alice@x.com"].active))}catch(_e){process.stdout.write("ERROR")}' "$LIB_JS" "$REG33" 2>/dev/null)"
assert_eq "true" "$alice33" "(33) policy allow: registry alice flipped to active=true"
rm -rf "$FX33" "$CCM33"

# ──────────────────────────────────────────────────────────────────────────────────────────────────
# (34) **policy 机制硬闸 — fail-open（ADR-016 §2.3）**.
#      ccm 不存在（PATH 中无 ccm）→ 换号**仍正常完成**（降级放行·不把没接 ccm 的环境误锁）。
#      另测：stub `ccm` 返回非法 JSON → 同样 fail-open 放行。
# ──────────────────────────────────────────────────────────────────────────────────────────────────
FX34="$(make_fixture)"; REG34="$FX34/accounts.json"; VFILE34="$FX34/accounts.env"
CRED34="$FX34/credentials.json"; CJSON34="$FX34/claude.json"
cat > "$REG34" <<JSON
{ "schema": "cc-master/accounts/v1", "accounts": {
  "bob@y.com":   { "vault": {"kind":"keychain","service":"cc-master-oauth","account":"bob@y.com"}, "active": true, "last_switch_out": null },
  "alice@x.com": { "vault": {"kind":"file","path":"$VFILE34","key":"alice@x.com"}, "token_expires_at":"2027-06-17T10:40:00Z", "active": false, "last_switch_out": null, "identity": {"emailAddress":"alice@x.com","accountUuid":"uuid-alice","subscriptionType":"max"} }
} }
JSON
umask 077
printf 'alice@x.com_TOKEN=%s\n' "{\"accessToken\":\"$ALICE_AT\",\"refreshToken\":\"$ALICE_RT\",\"expiresAt\":1700000000000,\"subscriptionType\":\"max\"}" > "$VFILE34"; chmod 600 "$VFILE34"
cat > "$CRED34" <<'JSON'
{"claudeAiOauth":{"accessToken":"sk-ant-oat01-OLDcred34AAA000000000000000000-_o","refreshToken":"sk-ant-ort01-OLDcred34r00000000000000000-_o","expiresAt":1700000000000,"subscriptionType":"pro"}}
JSON
cat > "$CJSON34" <<'JSON'
{"oauthAccount":{"emailAddress":"old@x.com","subscriptionType":"pro"},"numStartups":5}
JSON
PORT34="$FX34/url.txt"; start_refresh_endpoint ok "$PORT34"; RURL34="$(cat "$PORT34")"
# (34a) — ccm 完全不存在（PATH 里故意 pre-pend 一个空目录·**并 `env -u CCM_BIN`** 抹掉 run-tests.sh 继承的 dev-shim，
#         确保真·无 ccm：CCM_BIN 未设 且 PATH 无 ccm → fail-open allow·验 bug2 修复保留 ADR-016 §2.3 故意 fail-open）.
EMPTY34="$(make_project)"
out34="$(PATH="$EMPTY34:$SECSTUB:$PATH" CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" REFRESH_TOKEN_URL="$RURL34" CRED_PATH="$CRED34" CLAUDE_JSON_PATH="$CJSON34" \
        env -u CCM_BIN bash "$SCRIPT" --registry "$REG34" --email "alice@x.com" --now "2026-06-17T09:00:00Z" --no-snapshot 2>&1)"; rc34=$?
assert_eq "0" "$rc34" "(34a) fail-open: ccm not found → switch exits 0 (降级放行·不误锁)"
cred34_at="$(node -e 'try{const j=require(process.argv[1]);process.stdout.write(j.claudeAiOauth.accessToken||"NONE")}catch(_e){process.stdout.write("ERROR")}' "$CRED34" 2>/dev/null)"
assert_eq "$FRESH_AT" "$cred34_at" "(34a) fail-open: credentials.json overwritten with FRESH token (换号完成·ccm 缺不误拦)"
# (34b) — ccm 存在但返回非法 JSON（fail-open for bad output）.
CCM34B="$(make_project)"
cat > "$CCM34B/ccm" <<'CCM'
#!/usr/bin/env bash
# stub ccm: returns invalid JSON for policy show (simulate malformed output).
if [ "${1:-}" = "policy" ] && [ "${2:-}" = "show" ]; then
  printf '%s\n' 'NOT_VALID_JSON{{{garbage'
fi
exit 0
CCM
chmod +x "$CCM34B/ccm"
# Re-seed stores to OLD for this sub-case (34a already overwrote them to FRESH).
cat > "$CRED34" <<'JSON'
{"claudeAiOauth":{"accessToken":"sk-ant-oat01-OLDcred34AAA000000000000000000-_o","refreshToken":"sk-ant-ort01-OLDcred34r00000000000000000-_o","expiresAt":1700000000000,"subscriptionType":"pro"}}
JSON
cat > "$CJSON34" <<'JSON'
{"oauthAccount":{"emailAddress":"old@x.com","subscriptionType":"pro"},"numStartups":5}
JSON
# Also need to re-seed vault since the FRESH refresh token was written to it in (34a).
printf 'alice@x.com_TOKEN=%s\n' "{\"accessToken\":\"$ALICE_AT\",\"refreshToken\":\"$ALICE_RT\",\"expiresAt\":1700000000000,\"subscriptionType\":\"max\"}" > "$VFILE34"; chmod 600 "$VFILE34"
# And we need a fresh refresh endpoint since the old one may have self-reaped.
PORT34B="$FX34/url34b.txt"; start_refresh_endpoint ok "$PORT34B"; RURL34B="$(cat "$PORT34B")"
# bad-JSON stub 经 CCM_BIN 注入（canonical 路径·bug2 修复后 CCM_BIN 优先·指向坏输出 stub → 调用成功但输出非法 JSON → fail-open）。
out34b="$(PATH="$CCM34B:$SECSTUB:$PATH" CCM_BIN="$CCM34B/ccm" CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" REFRESH_TOKEN_URL="$RURL34B" CRED_PATH="$CRED34" CLAUDE_JSON_PATH="$CJSON34" \
         bash "$SCRIPT" --registry "$REG34" --email "alice@x.com" --now "2026-06-17T09:00:00Z" --no-snapshot 2>&1)"; rc34b=$?
assert_eq "0" "$rc34b" "(34b) fail-open: ccm returns bad JSON → switch exits 0 (坏 JSON 降级放行·不误拦)"
cred34b_at="$(node -e 'try{const j=require(process.argv[1]);process.stdout.write(j.claudeAiOauth.accessToken||"NONE")}catch(_e){process.stdout.write("ERROR")}' "$CRED34" 2>/dev/null)"
assert_eq "$FRESH_AT" "$cred34b_at" "(34b) fail-open: credentials.json overwritten with FRESH token (坏 JSON 不误拦换号)"
rm -rf "$FX34" "$EMPTY34" "$CCM34B"

# ──────────────────────────────────────────────────────────────────────────────────────────────────
# (36) **policy 机制硬闸 — ccm 经 CCM_BIN 提供（PATH 无 ccm）时 deny 仍被 enforce（codex round-4 #bug2）**.
#      场景：ccm 仅经 `CCM_BIN` 环境变量提供（绝对路径·hooks/scripts/tests 惯例·usage-pacing.js / board-lint.js 同约定），
#        **不在 PATH**。旧版 policy 闸只 `command -v ccm` → 返空 → 误判 fail-open → board policy=deny 被绕过（违 ADR-016 安全意图）。
#      修复后 `_CCM_BIN="${CCM_BIN:-$(command -v ccm ...)}"` 优先认 CCM_BIN → deny 正确拦截 exit 7。
#      **反向 teeth**：修复前 command -v 找不到 ccm（PATH 无）→ fail-open 放行 → rc=0 + 三存储被覆写 → 下方断言失败。
# ──────────────────────────────────────────────────────────────────────────────────────────────────
FX36="$(make_fixture)"; REG36="$FX36/accounts.json"; VFILE36="$FX36/accounts.env"
CRED36="$FX36/credentials.json"; CJSON36="$FX36/claude.json"
cat > "$REG36" <<JSON
{ "schema": "cc-master/accounts/v1", "accounts": {
  "bob@y.com":   { "vault": {"kind":"keychain","service":"cc-master-oauth","account":"bob@y.com"}, "active": true, "last_switch_out": null },
  "alice@x.com": { "vault": {"kind":"file","path":"$VFILE36","key":"alice@x.com"}, "token_expires_at":"2027-06-17T10:40:00Z", "active": false, "last_switch_out": null, "identity": {"emailAddress":"alice@x.com","accountUuid":"uuid-alice","subscriptionType":"max"} }
} }
JSON
umask 077
printf 'alice@x.com_TOKEN=%s\n' "{\"accessToken\":\"$ALICE_AT\",\"refreshToken\":\"$ALICE_RT\",\"expiresAt\":1700000000000,\"subscriptionType\":\"max\"}" > "$VFILE36"; chmod 600 "$VFILE36"
# pre-seed OLD official stores — must remain unchanged after a deny block.
OLD36_AT='sk-ant-oat01-OLDcred36AAA000000000000000000-_o'
cat > "$CRED36" <<JSON
{"claudeAiOauth":{"accessToken":"$OLD36_AT","refreshToken":"sk-ant-ort01-OLDcred36r00000000000000000-_o","expiresAt":1700000000000,"subscriptionType":"pro"}}
JSON
cat > "$CJSON36" <<'JSON'
{"oauthAccount":{"emailAddress":"old@x.com","subscriptionType":"pro"},"numStartups":7}
JSON
PORT36="$FX36/url.txt"; start_refresh_endpoint ok "$PORT36"; RURL36="$(cat "$PORT36")"
# stub `ccm` returning deny — placed in its OWN dir that is **NOT on PATH**; provided ONLY via CCM_BIN (absolute path).
CCMDIR36="$(make_project)"
cat > "$CCMDIR36/ccm-stub" <<'CCM'
#!/usr/bin/env bash
# stub ccm: `policy show --json` → deny; any other subcommand → exit 0 silently (e.g. `log add`).
if [ "${1:-}" = "policy" ] && [ "${2:-}" = "show" ]; then
  printf '%s\n' '{"ok":true,"data":{"policy":{"autonomous_account_switch":"deny"},"effective":{"autonomous_account_switch":"deny"}}}'
fi
exit 0
CCM
chmod +x "$CCMDIR36/ccm-stub"
# CRITICAL: ccm is NOT on PATH here (CCMDIR36 not added to PATH; binary named ccm-stub anyway). Provided via CCM_BIN only.
#   This is the exact scenario the bug missed: command -v ccm → empty → old code fail-opens → deny bypassed.
out36="$(PATH="$SECSTUB:$PATH" CCM_BIN="$CCMDIR36/ccm-stub" CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" REFRESH_TOKEN_URL="$RURL36" CRED_PATH="$CRED36" CLAUDE_JSON_PATH="$CJSON36" \
        bash "$SCRIPT" --registry "$REG36" --email "alice@x.com" --now "2026-06-17T09:00:00Z" --no-snapshot 2>&1)"; rc36=$?
# ① rc must be 7 — policy deny enforced via CCM_BIN (NOT fail-open).
assert_eq "7" "$rc36" "(36) CCM_BIN deny: exit 7 — ccm via CCM_BIN (PATH has no ccm) still enforces deny (was fail-open bypass)"
# ② credentials.json must keep OLD token (gate blocks before any overwrite).
cred36_at="$(node -e 'try{const j=require(process.argv[1]);process.stdout.write(j.claudeAiOauth.accessToken||"NONE")}catch(_e){process.stdout.write("ERROR")}' "$CRED36" 2>/dev/null)"
assert_eq "$OLD36_AT" "$cred36_at" "(36) CCM_BIN deny: credentials.json UNCHANGED (policy gate via CCM_BIN ran before overwrite)"
# ③ registry active NOT flipped.
alice36="$(node -e 'try{const r=require(process.argv[1]).loadRegistry(process.argv[2]);process.stdout.write(String(r.accounts["alice@x.com"].active))}catch(_e){process.stdout.write("ERROR")}' "$LIB_JS" "$REG36" 2>/dev/null)"
assert_eq "false" "$alice36" "(36) CCM_BIN deny: registry alice active NOT flipped (deny enforced)"
# ④ deny message surfaced.
assert_contains "$out36" "deny" "(36) CCM_BIN deny: stderr surfaces deny"
# ⑤ vault NOT refreshed (gate前移·no FRESH token leaked into vault).
vault36_content="$(cat "$VFILE36" 2>/dev/null || true)"
if echo "$vault36_content" | grep -qF "$FRESH_AT" 2>/dev/null; then
  FAILED=$((FAILED+1)); _red "FAIL: (36) CCM_BIN deny: vault refreshed (FRESH_AT present) — gate ran AFTER refresh"
else
  PASS=$((PASS+1)); _green "(36) CCM_BIN deny: vault NOT refreshed (FRESH_AT absent — gate via CCM_BIN runs before credential ops)"
fi
rm -rf "$FX36" "$CCMDIR36"

# ──────────────────────────────────────────────────────────────────────────────────────────────────
# (36b) **CONTROL — CCM_BIN unset AND ccm not on PATH → fail-open allow (ADR-016 §2.3 故意 fail-open 保留)**.
#       证明修复**只**把「ccm 经 CCM_BIN 真实可用」从误判 fail-open 改成正确 enforce——真·无 ccm（CCM_BIN 未设 且
#       PATH 无）时**仍** fail-open allow（不锁未接 ccm 的环境）。这是 (36) 的对照组（与 (34a) 同义·此处显式再断一次确保两路径都对）。
# ──────────────────────────────────────────────────────────────────────────────────────────────────
FX36B="$(make_fixture)"; REG36B="$FX36B/accounts.json"; VFILE36B="$FX36B/accounts.env"
CRED36B="$FX36B/credentials.json"; CJSON36B="$FX36B/claude.json"
cat > "$REG36B" <<JSON
{ "schema": "cc-master/accounts/v1", "accounts": {
  "bob@y.com":   { "vault": {"kind":"keychain","service":"cc-master-oauth","account":"bob@y.com"}, "active": true, "last_switch_out": null },
  "alice@x.com": { "vault": {"kind":"file","path":"$VFILE36B","key":"alice@x.com"}, "token_expires_at":"2027-06-17T10:40:00Z", "active": false, "last_switch_out": null, "identity": {"emailAddress":"alice@x.com","accountUuid":"uuid-alice","subscriptionType":"max"} }
} }
JSON
umask 077
printf 'alice@x.com_TOKEN=%s\n' "{\"accessToken\":\"$ALICE_AT\",\"refreshToken\":\"$ALICE_RT\",\"expiresAt\":1700000000000,\"subscriptionType\":\"max\"}" > "$VFILE36B"; chmod 600 "$VFILE36B"
cat > "$CRED36B" <<'JSON'
{"claudeAiOauth":{"accessToken":"sk-ant-oat01-OLDcred36bAA000000000000000000-_o","refreshToken":"sk-ant-ort01-OLDcred36br0000000000000000-_o","expiresAt":1700000000000,"subscriptionType":"pro"}}
JSON
cat > "$CJSON36B" <<'JSON'
{"oauthAccount":{"emailAddress":"old@x.com","subscriptionType":"pro"},"numStartups":5}
JSON
PORT36B="$FX36B/url.txt"; start_refresh_endpoint ok "$PORT36B"; RURL36B="$(cat "$PORT36B")"
# EMPTY dir pre-pended to PATH so no real ccm leaks in; CCM_BIN explicitly UNSET.
EMPTY36B="$(make_project)"
out36b="$(PATH="$EMPTY36B:$SECSTUB:$PATH" CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" REFRESH_TOKEN_URL="$RURL36B" CRED_PATH="$CRED36B" CLAUDE_JSON_PATH="$CJSON36B" \
         env -u CCM_BIN bash "$SCRIPT" --registry "$REG36B" --email "alice@x.com" --now "2026-06-17T09:00:00Z" --no-snapshot 2>&1)"; rc36b=$?
assert_eq "0" "$rc36b" "(36b) CONTROL fail-open: CCM_BIN unset + ccm not on PATH → switch exits 0 (真·无 ccm 仍 fail-open allow·不误锁)"
cred36b_at="$(node -e 'try{const j=require(process.argv[1]);process.stdout.write(j.claudeAiOauth.accessToken||"NONE")}catch(_e){process.stdout.write("ERROR")}' "$CRED36B" 2>/dev/null)"
assert_eq "$FRESH_AT" "$cred36b_at" "(36b) CONTROL fail-open: credentials.json overwritten with FRESH token (换号完成·真·无 ccm 不误拦)"
rm -rf "$FX36B" "$EMPTY36B"

# ══════════════════════════════════════════════════════════════════════════════════════════════════
# (37) **policy 机制硬闸 — 多 active board 下确定性 board selector enforce deny（codex P1·deny 被绕过）**.
#      场景：home 里 2 块 active board 共享（一块目标板 policy=deny），ccm 在 switch-account.sh 子进程里拿不到
#        orchestrator 的 hook-stdin sid → 无 board selector 的 `ccm policy show` 走 ambient discovery →
#        Ambiguous/NotFound 失败 → 旧版 `|| true` 吞掉 → 空 JSON → fail-open allow → **目标板 deny 被绕过**（P1）.
#      修复：switch-account.sh 把目标板经 `--board <path>` / `$CC_MASTER_BOARD` 确定性交给 ccm policy show →
#        ccm discover.ts ① 直读指定板 → deny 正确 enforce exit 7。
#      用一个 **discover-faithful 的 stub ccm**：带 `--board <path>` / 经 CC_MASTER_BOARD → 读该 path 的板 policy；
#        无 selector + home 多 active → 输出 ambiguous 错误 JSON `{"ok":false,...}`（精确镜像 discover 失败形状）。
#      **反向 teeth**：修前不带 board 上下文 → stub 出 ambiguous JSON → 旧 parse 取不到 .data.effective → 当 allow →
#        rc=0 + 三存储被覆写 → 断言失败。修后即便不带 --board，只要 CC_MASTER_BOARD 指目标板就 enforce deny。
# ══════════════════════════════════════════════════════════════════════════════════════════════════
FX37="$(make_fixture)"; REG37="$FX37/accounts.json"; VFILE37="$FX37/accounts.env"
CRED37="$FX37/credentials.json"; CJSON37="$FX37/claude.json"
HOME37="$(make_project)"   # hermetic CC_MASTER_HOME with TWO active boards
# 目标板（policy=deny）与另一块 active board（policy 缺省 allow）——共享 home，模拟 ambient 歧义。
DENYBOARD37="$HOME37/20990101T000000Z-aaaa.board.json"
OTHERBOARD37="$HOME37/20990101T000001Z-bbbb.board.json"
cat > "$DENYBOARD37" <<'JSON'
{"schema":"cc-master/board/v2","goal":"GOAL-DENY","owner":{"active":true,"session_id":""},"policy":{"autonomous_account_switch":"deny"},"tasks":[],"log":[]}
JSON
cat > "$OTHERBOARD37" <<'JSON'
{"schema":"cc-master/board/v2","goal":"GOAL-OTHER","owner":{"active":true,"session_id":""},"tasks":[],"log":[]}
JSON
cat > "$REG37" <<JSON
{ "schema": "cc-master/accounts/v1", "accounts": {
  "bob@y.com":   { "vault": {"kind":"keychain","service":"cc-master-oauth","account":"bob@y.com"}, "active": true, "last_switch_out": null },
  "alice@x.com": { "vault": {"kind":"file","path":"$VFILE37","key":"alice@x.com"}, "token_expires_at":"2027-06-17T10:40:00Z", "active": false, "last_switch_out": null, "identity": {"emailAddress":"alice@x.com","accountUuid":"uuid-alice","subscriptionType":"max"} }
} }
JSON
umask 077
printf 'alice@x.com_TOKEN=%s\n' "{\"accessToken\":\"$ALICE_AT\",\"refreshToken\":\"$ALICE_RT\",\"expiresAt\":1700000000000,\"subscriptionType\":\"max\"}" > "$VFILE37"; chmod 600 "$VFILE37"
OLD37_AT='sk-ant-oat01-OLDcred37AAA000000000000000000-_o'
cat > "$CRED37" <<JSON
{"claudeAiOauth":{"accessToken":"$OLD37_AT","refreshToken":"sk-ant-ort01-OLDcred37r00000000000000000-_o","expiresAt":1700000000000,"subscriptionType":"pro"}}
JSON
cat > "$CJSON37" <<'JSON'
{"oauthAccount":{"emailAddress":"old@x.com","subscriptionType":"pro"},"numStartups":7}
JSON
PORT37="$FX37/url.txt"; start_refresh_endpoint ok "$PORT37"; RURL37="$(cat "$PORT37")"
# discover-faithful stub ccm（不在 PATH·仅经 CCM_BIN）：
#   `policy show --board <path>` / 经 $CC_MASTER_BOARD → 读该板 policy（deny/allow·镜像 discover ①·确定性）；
#   `policy show` 无 selector + home 多 active → ambiguous 错误 JSON（镜像 discover「无 sid」分支 throw·exit 5）；
#   `log add ...` → exit 0（含 --board·吞掉即可）。
CCMDIR37="$(make_project)"
cat > "$CCMDIR37/ccm-stub" <<'CCM'
#!/usr/bin/env bash
# discover-faithful policy-show stub. Reads board.policy.autonomous_account_switch from the resolved board path.
# Resolution mirrors discover.ts ①: --board <path>  >  $CC_MASTER_BOARD  >  (no selector → ambient).
if [ "${1:-}" = "policy" ] && [ "${2:-}" = "show" ]; then
  shift 2
  BPATH=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --board) BPATH="${2:-}"; shift 2;;
      --json)  shift;;
      *)       shift;;
    esac
  done
  [ -z "$BPATH" ] && BPATH="${CC_MASTER_BOARD:-}"
  if [ -z "$BPATH" ]; then
    # No selector + multiple active boards in home → ambient discovery is ambiguous (discover.ts throws).
    n=0
    for f in "${CC_MASTER_HOME:-/nonexistent}"/*.board.json; do [ -f "$f" ] && n=$((n+1)); done
    if [ "$n" -gt 1 ]; then
      printf '%s\n' '{"ok":false,"exit":5,"error":"Multiple active boards; pass --board or --goal to disambiguate","violations":[]}'
      exit 5
    fi
    # single active → would resolve, but for this test we only exercise multi-active; fall through to allow.
    printf '%s\n' '{"ok":true,"data":{"policy":null,"effective":{"autonomous_account_switch":"allow"}}}'
    exit 0
  fi
  # Read the named board's policy deterministically (mirrors discover ① --board / CC_MASTER_BOARD).
  val="$(node -e 'try{const b=require(process.argv[1]);const p=b&&b.policy&&b.policy.autonomous_account_switch;process.stdout.write(typeof p==="string"?p:"allow")}catch(_e){process.stdout.write("MISSING")}' "$BPATH" 2>/dev/null)"
  if [ "$val" = "MISSING" ]; then
    printf '%s\n' '{"ok":false,"exit":5,"error":"--board path is missing or not valid board JSON","violations":[]}'
    exit 5
  fi
  printf '%s\n' "{\"ok\":true,\"data\":{\"policy\":{\"autonomous_account_switch\":\"$val\"},\"effective\":{\"autonomous_account_switch\":\"$val\"}}}"
  exit 0
fi
exit 0
CCM
chmod +x "$CCMDIR37/ccm-stub"

# ── (37) — 多 active board·传 --board <目标 deny 板> → deny enforce exit 7（确定性 selector·不被 ambient 干扰）──
out37="$(PATH="$SECSTUB:$PATH" CCM_BIN="$CCMDIR37/ccm-stub" CC_MASTER_HOME="$HOME37" CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" \
        REFRESH_TOKEN_URL="$RURL37" CRED_PATH="$CRED37" CLAUDE_JSON_PATH="$CJSON37" \
        env -u CC_MASTER_BOARD bash "$SCRIPT" --registry "$REG37" --email "alice@x.com" --board "$DENYBOARD37" --now "2026-06-17T09:00:00Z" --no-snapshot 2>&1)"; rc37=$?
assert_eq "7" "$rc37" "(37) multi-active + --board deny board: exit 7 — deterministic selector enforces deny (was ambient bypass)"
cred37_at="$(node -e 'try{const j=require(process.argv[1]);process.stdout.write(j.claudeAiOauth.accessToken||"NONE")}catch(_e){process.stdout.write("ERROR")}' "$CRED37" 2>/dev/null)"
assert_eq "$OLD37_AT" "$cred37_at" "(37) multi-active --board deny: credentials.json UNCHANGED (gate ran before overwrite)"
alice37="$(node -e 'try{const r=require(process.argv[1]).loadRegistry(process.argv[2]);process.stdout.write(String(r.accounts["alice@x.com"].active))}catch(_e){process.stdout.write("ERROR")}' "$LIB_JS" "$REG37" 2>/dev/null)"
assert_eq "false" "$alice37" "(37) multi-active --board deny: registry alice active NOT flipped"
assert_contains "$out37" "deny" "(37) multi-active --board deny: stderr surfaces deny"
vault37_content="$(cat "$VFILE37" 2>/dev/null || true)"
if echo "$vault37_content" | grep -qF "$FRESH_AT" 2>/dev/null; then
  FAILED=$((FAILED+1)); _red "FAIL: (37) multi-active --board deny: vault refreshed (FRESH_AT present) — gate ran AFTER refresh"
else
  PASS=$((PASS+1)); _green "(37) multi-active --board deny: vault NOT refreshed (FRESH_AT absent — gate before credential ops)"
fi

# ── (37b) — 多 active board·经 $CC_MASTER_BOARD 指目标 deny 板（不传 --board）→ deny 仍 enforce exit 7 ──
#   (反向 teeth：修前 ambient `ccm policy show` 无 selector → stub 出 ambiguous JSON → 旧 parse 当 allow → rc=0 放行。)
# Re-seed stores to OLD (37 blocked so they're still OLD, but re-seed defensively + vault).
cat > "$CRED37" <<JSON
{"claudeAiOauth":{"accessToken":"$OLD37_AT","refreshToken":"sk-ant-ort01-OLDcred37r00000000000000000-_o","expiresAt":1700000000000,"subscriptionType":"pro"}}
JSON
printf 'alice@x.com_TOKEN=%s\n' "{\"accessToken\":\"$ALICE_AT\",\"refreshToken\":\"$ALICE_RT\",\"expiresAt\":1700000000000,\"subscriptionType\":\"max\"}" > "$VFILE37"; chmod 600 "$VFILE37"
PORT37B="$FX37/url37b.txt"; start_refresh_endpoint ok "$PORT37B"; RURL37B="$(cat "$PORT37B")"
out37b="$(PATH="$SECSTUB:$PATH" CCM_BIN="$CCMDIR37/ccm-stub" CC_MASTER_HOME="$HOME37" CC_MASTER_BOARD="$DENYBOARD37" CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" \
         REFRESH_TOKEN_URL="$RURL37B" CRED_PATH="$CRED37" CLAUDE_JSON_PATH="$CJSON37" \
         bash "$SCRIPT" --registry "$REG37" --email "alice@x.com" --now "2026-06-17T09:00:00Z" --no-snapshot 2>&1)"; rc37b=$?
assert_eq "7" "$rc37b" "(37b) multi-active + CC_MASTER_BOARD=deny board (no --board): exit 7 — env selector enforces deny"
cred37b_at="$(node -e 'try{const j=require(process.argv[1]);process.stdout.write(j.claudeAiOauth.accessToken||"NONE")}catch(_e){process.stdout.write("ERROR")}' "$CRED37" 2>/dev/null)"
assert_eq "$OLD37_AT" "$cred37b_at" "(37b) multi-active CC_MASTER_BOARD deny: credentials.json UNCHANGED"

# ── (37c) — 多 active board·**有板上下文却读不到目标板 policy**（坏路径）→ 保守拦截 exit 7（不静默放行·codex P1 核心）──
#   场景：CC_MASTER_BOARD 指一个不存在/坏 board path → stub 出 {"ok":false,...} → switch 知道「该看哪块板」却读不到 →
#     不当 allow，而是 deny 侧保守（与 a 类「真·无板上下文」的故意 fail-open 区分）。
cat > "$CRED37" <<JSON
{"claudeAiOauth":{"accessToken":"$OLD37_AT","refreshToken":"sk-ant-ort01-OLDcred37r00000000000000000-_o","expiresAt":1700000000000,"subscriptionType":"pro"}}
JSON
printf 'alice@x.com_TOKEN=%s\n' "{\"accessToken\":\"$ALICE_AT\",\"refreshToken\":\"$ALICE_RT\",\"expiresAt\":1700000000000,\"subscriptionType\":\"max\"}" > "$VFILE37"; chmod 600 "$VFILE37"
PORT37C="$FX37/url37c.txt"; start_refresh_endpoint ok "$PORT37C"; RURL37C="$(cat "$PORT37C")"
out37c="$(PATH="$SECSTUB:$PATH" CCM_BIN="$CCMDIR37/ccm-stub" CC_MASTER_HOME="$HOME37" CC_MASTER_BOARD="$HOME37/does-not-exist.board.json" CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" \
         REFRESH_TOKEN_URL="$RURL37C" CRED_PATH="$CRED37" CLAUDE_JSON_PATH="$CJSON37" \
         bash "$SCRIPT" --registry "$REG37" --email "alice@x.com" --now "2026-06-17T09:00:00Z" --no-snapshot 2>&1)"; rc37c=$?
assert_eq "7" "$rc37c" "(37c) board ctx given but policy unreadable: exit 7 — conservative deny (NOT silent fail-open·codex P1)"
cred37c_at="$(node -e 'try{const j=require(process.argv[1]);process.stdout.write(j.claudeAiOauth.accessToken||"NONE")}catch(_e){process.stdout.write("ERROR")}' "$CRED37" 2>/dev/null)"
assert_eq "$OLD37_AT" "$cred37c_at" "(37c) board ctx unreadable: credentials.json UNCHANGED (conservative block before overwrite)"

# ── (37d) — CONTROL: 真·无 ccm（CCM_BIN 未设 + PATH 无 ccm 二进制）+ 有 --board → 仍 fail-open allow（不误伤）──
#   语义：fail-open 的存在理由是「不锁**未接 ccm** 的环境」——ccm 二进制根本不在场时，闸无从读任何 policy、
#     该环境显然没在跑 cc-master 的 policy 机制 → fail-open allow（哪怕传了 --board）。保守拦截 (b 类) 只在
#     **ccm 在场但读不到目标板 policy** 时触发（见 37c）。本控制证明二者不混淆。
#   注意：本控制须**真**没有 ccm——空目录 prepend 仍会让 `command -v ccm` 命中系统真 ccm（如 ~/.local/bin/ccm）。
#     故重建一条只含 node / security / secstub 目录、**剔除真 ccm 所在目录**的最小 PATH。
cat > "$CRED37" <<JSON
{"claudeAiOauth":{"accessToken":"$OLD37_AT","refreshToken":"sk-ant-ort01-OLDcred37r00000000000000000-_o","expiresAt":1700000000000,"subscriptionType":"pro"}}
JSON
printf 'alice@x.com_TOKEN=%s\n' "{\"accessToken\":\"$ALICE_AT\",\"refreshToken\":\"$ALICE_RT\",\"expiresAt\":1700000000000,\"subscriptionType\":\"max\"}" > "$VFILE37"; chmod 600 "$VFILE37"
PORT37D="$FX37/url37d.txt"; start_refresh_endpoint ok "$PORT37D"; RURL37D="$(cat "$PORT37D")"
# 最小 PATH：node 目录 + security 目录 + secstub（绝不含真 ccm 所在目录）→ command -v ccm 必空。
NODE_DIR37="$(dirname "$(command -v node)")"
SEC_DIR37="$(dirname "$(command -v security 2>/dev/null || echo /usr/bin/security)")"
MINPATH37="$SECSTUB:$NODE_DIR37:$SEC_DIR37:/usr/bin:/bin"
# sanity: 确认这条 PATH 下 ccm 确实不可达（否则本控制名不副实）。
if PATH="$MINPATH37" command -v ccm >/dev/null 2>&1; then
  FAILED=$((FAILED+1)); _red "FAIL: (37d) precondition: ccm still reachable on minimal PATH — control is not真·无 ccm"
else
  out37d="$(PATH="$MINPATH37" CC_MASTER_HOME="$HOME37" CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" \
           REFRESH_TOKEN_URL="$RURL37D" CRED_PATH="$CRED37" CLAUDE_JSON_PATH="$CJSON37" \
           env -u CCM_BIN bash "$SCRIPT" --registry "$REG37" --email "alice@x.com" --board "$DENYBOARD37" --now "2026-06-17T09:00:00Z" --no-snapshot 2>&1)"; rc37d=$?
  assert_eq "0" "$rc37d" "(37d) CONTROL no-ccm + --board: exit 0 — true no-ccm still fail-open allow (不误锁未接 ccm 的环境)"
  cred37d_at="$(node -e 'try{const j=require(process.argv[1]);process.stdout.write(j.claudeAiOauth.accessToken||"NONE")}catch(_e){process.stdout.write("ERROR")}' "$CRED37" 2>/dev/null)"
  assert_eq "$FRESH_AT" "$cred37d_at" "(37d) CONTROL no-ccm + --board: credentials.json overwritten with FRESH (true no-ccm fail-open 不误拦)"
fi
rm -rf "$FX37" "$HOME37" "$CCMDIR37"

# ── (35-snap-degrade) cc-usage.sh 不存在（CLAUDE_PLUGIN_ROOT 无 cc-usage）→ 换号仍完成·snapshot 干净跳过 ──
# 场景：用户未安装 orchestrating-to-completion skill（或 CLAUDE_PLUGIN_ROOT 路径无对应 cc-usage.sh）→ CC_USAGE_SH
#   解析到一个不存在的文件 → switch-account.sh record_switch_out() 内 [ -f "$CC_USAGE_SH" ] 为假 → usage_json=""
#   → node 块走「used_pct undefined → 跳过本次切出配额快照」路径。换号核心（三存储覆写 + active 翻转）独立、不受影响。
# teeth：① switch exits 0；② active 翻转正确（alice=true·bob=false）；③ bob.last_switch_out NOT written；
#         ④ 无 stack trace；⑤ no token leak。
echo "-- (35-snap-degrade) cc-usage.sh absent in CLAUDE_PLUGIN_ROOT → switch exits 0, snapshot cleanly skipped --"
FX35="$(make_fixture)"; REG35="$FX35/accounts.json"; VFILE35="$FX35/accounts.env"
CRED35="$FX35/credentials.json"; CJSON35="$FX35/claude.json"
cat > "$REG35" <<JSON
{ "schema": "cc-master/accounts/v1", "accounts": {
  "bob@y.com":   { "vault": {"kind":"keychain","service":"cc-master-oauth","account":"bob@y.com"}, "active": true, "last_switch_out": null },
  "alice@x.com": { "vault": {"kind":"file","path":"$VFILE35","key":"alice@x.com"}, "active": false, "last_switch_out": null }
} }
JSON
umask 077
printf 'alice@x.com_TOKEN=%s\n' "{\"accessToken\":\"$ALICE_AT\",\"refreshToken\":\"$ALICE_RT\",\"expiresAt\":1700000000000,\"subscriptionType\":\"max\"}" > "$VFILE35"; chmod 600 "$VFILE35"
cat > "$CRED35" <<'JSON'
{"claudeAiOauth":{"accessToken":"sk-ant-oat01-OLD35000000000000000000000-_o","refreshToken":"sk-ant-ort01-OLD35r00000000000000000-_o","expiresAt":1700000000000}}
JSON
printf '{}' > "$CJSON35"
# stub plugin root that does NOT have cc-usage.sh in the orch scripts dir → file-not-found path
STUB_ROOT35="$(make_project)"
mkdir -p "$STUB_ROOT35/skills/account-management/scripts" "$STUB_ROOT35/skills/orchestrating-to-completion/scripts"
ln -s "$PLUGIN_ROOT/skills/account-management/scripts/switch-account.sh" "$STUB_ROOT35/skills/account-management/scripts/switch-account.sh"
ln -s "$PLUGIN_ROOT/skills/account-management/scripts/accounts-lib.js"   "$STUB_ROOT35/skills/account-management/scripts/accounts-lib.js"
ln -s "$PLUGIN_ROOT/skills/account-management/scripts/select-account.js" "$STUB_ROOT35/skills/account-management/scripts/select-account.js"
# intentionally do NOT create cc-usage.sh in STUB_ROOT35/skills/orchestrating-to-completion/scripts/
PORT35="$FX35/url.txt"; start_refresh_endpoint ok "$PORT35"; RURL35="$(cat "$PORT35")"
out35="$(PATH="$SECSTUB:$PATH" CLAUDE_PLUGIN_ROOT="$STUB_ROOT35" REFRESH_TOKEN_URL="$RURL35" CRED_PATH="$CRED35" CLAUDE_JSON_PATH="$CJSON35" \
        bash "$STUB_ROOT35/skills/account-management/scripts/switch-account.sh" --registry "$REG35" --email "alice@x.com" --now "2026-06-17T09:00:00Z" 2>&1)"; rc35=$?
assert_eq "0" "$rc35" "(35-snap-degrade) cc-usage.sh absent → switch STILL exits 0 (graceful degradation, not blocked)"
assert_contains "$out35" "无重启换号完成" "(35-snap-degrade) 换号核心完成 even without cc-usage"
# active must flip correctly
alice35="$(node -e 'const r=require(process.argv[1]).loadRegistry(process.argv[2]);process.stdout.write(String(r.accounts["alice@x.com"].active))' "$LIB_JS" "$REG35" 2>/dev/null)"
bob35="$(node -e 'const r=require(process.argv[1]).loadRegistry(process.argv[2]);process.stdout.write(String(r.accounts["bob@y.com"].active))' "$LIB_JS" "$REG35" 2>/dev/null)"
assert_eq "true"  "$alice35" "(35-snap-degrade) setActive flipped alice → active=true (snapshot skip never blocked core switch)"
assert_eq "false" "$bob35"   "(35-snap-degrade) setActive flipped bob → active=false (independent setActive unaffected)"
# bob.last_switch_out must NOT be written (no cc-usage signal → clean skip)
bob35_lso="$(node -e 'const r=require(process.argv[1]).loadRegistry(process.argv[2]);process.stdout.write(r.accounts["bob@y.com"].last_switch_out?"SET":"null")' "$LIB_JS" "$REG35" 2>/dev/null)"
assert_eq "null" "$bob35_lso" "(35-snap-degrade) bob.last_switch_out NOT written when cc-usage absent (clean skip·no pollution)"
assert_not_contains "$out35" "    at " "(35-snap-degrade) NO node stack-trace frame leaks on cc-usage-absent path"
assert_not_contains "$out35" "$ALICE_RT" "(35-snap-degrade) alice refresh token does NOT leak in output"
for p in "${ENDPOINT_PIDS[@]}"; do kill "$p" 2>/dev/null || true; done
rm -rf "$FX35" "$STUB_ROOT35"

# kill any lingering stub endpoints.
for p in "${ENDPOINT_PIDS[@]}"; do kill "$p" 2>/dev/null || true; done
rm -rf "$SECSTUB" "$SECSTUB_CAPTURE" "$SECSTUB_FAIL" "$FX1" "$FX1B" "$FX2" "$FX3" "$FX4" "$FX5" "$STUB_ROOT5" "$FX5D" "$FX5E" "$FX6" "$FX8" "$FX9" "$STUB_ROOT9" "$FX10" "$FX11" "$FX11B" "$STUB_ROOT11B" "$FX15" "$STUB_ROOT15" "$FX16"

finish
