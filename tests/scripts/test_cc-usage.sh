#!/usr/bin/env bash
# Out-of-band cc-usage.sh correctness (P4 收口·ADR-014/015·plan §10-P4 line 174).
#
# cc-usage.sh no longer parses JSONL with python3 — the account-authoritative 5h/7d signal收口'd into the
# `ccm` engine (status-line sidecar·the ONLY programmatic source of used_percentage + resets_at·Finding #37,
# plus双侧走廊 verdict from `ccm usage advise`·引擎 pacing.ts SSOT). cc-usage.sh is now a thin shell wrapper
# that delegates to `ccm usage show/advise --json` and reshapes to the normalized schema. The old LOCAL
# JSONL 反推 fallback is dropped (引擎不含反推·Finding #37 反推 reset 失真到数量级)——no sidecar → honest
# source:"unavailable" + available:false (plan §10「降级为账户权威 only + 诚实标注」).
. "$(dirname "$0")/../hooks/helpers.sh"

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SCRIPT="$ROOT/skills/orchestrating-to-completion/scripts/cc-usage.sh"

# ── ccm dev-bin shim（与 test_board-lint.sh 同口径·ADR-014）：cc-usage.sh 现委托 ccm，故测试必须真走 ccm 路径。
# run-tests.sh 已 export CCM_BIN（指向 dev-bin shim·已 build dist）。独立跑时自指向 shim，dist 缺则尝试 build。
# 无 pnpm / build 失败 → 跳过（ccm 是唯一路径，无它无法测）。
SHIM="$ROOT/ccm/apps/cli/dev-bin/ccm"
if [ -z "${CCM_BIN:-}" ]; then
  if [ -f "$SHIM" ] && [ -f "$ROOT/ccm/apps/cli/dist/index.cjs" ]; then
    export CCM_BIN="$SHIM"
  elif [ -f "$SHIM" ] && command -v pnpm >/dev/null 2>&1 && \
       (cd "$ROOT" && pnpm -C ccm build) >/dev/null 2>&1 && \
       [ -f "$ROOT/ccm/apps/cli/dist/index.cjs" ]; then
    export CCM_BIN="$SHIM"
  else
    echo "(ccm dist NOT available — cc-usage.sh delegates to ccm; skipping test_cc-usage.sh)"
    echo "passed=0 failed=0"
    exit 0
  fi
fi

# Read one field path out of the one-line JSON (node·no python3 in the harness either).
jval() {
  node -e '
    let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
      let d;try{d=JSON.parse(s)}catch(_e){console.log("");process.exit(0)}
      for(const k of process.argv[1].split(".")){ if(d==null){console.log("");process.exit(0)} d=d[k]; }
      console.log(d==null?"":d);
    });' "$1"
}

# Isolated home so ccm never reads the dev machine's real accounts.json (effective_n leakage). A home with
# NO accounts.json → effective_n=1 (natural single account). Sidecar path is what we vary per case.
ISO_HOME="$(make_project)"

# ── ACCOUNT: fresh sidecar present → source:account + authoritative %/reset + advise verdict ──────────
ACC_DIR="$(make_project)"; ACACHE="$ACC_DIR/rate.json"
NOWEP="$(node -e 'console.log(Math.floor(Date.now()/1000))')"
R5=$((NOWEP+180*60)); R7=$((NOWEP+2*86400))   # 5h resets in 180min, 7d resets in 2d
printf '{"captured_at":%d,"five_hour":{"used_percentage":59,"resets_at":%d},"seven_day":{"used_percentage":40,"resets_at":%d}}' "$NOWEP" "$R5" "$R7" > "$ACACHE"
AOUT="$(CC_MASTER_HOME="$ISO_HOME" CC_MASTER_RATE_CACHE="$ACACHE" bash "$SCRIPT")"
assert_eq account "$(printf '%s' "$AOUT" | jval source)" "fresh sidecar → source=account (delegated to ccm usage show)"
assert_eq true "$(printf '%s' "$AOUT" | jval available)" "fresh sidecar → available:true"
assert_eq 59  "$(printf '%s' "$AOUT" | jval five_hour.used_percentage)" "account: 5h used_percentage from sidecar (authoritative)"
assert_eq 40  "$(printf '%s' "$AOUT" | jval seven_day.used_percentage)" "account: 7d used_percentage from sidecar"
assert_eq 1   "$(printf '%s' "$AOUT" | jval effective_n)" "no registry in isolated home → effective_n=1"
# advise verdict rides along (引擎 pacing.ts·here 5h 59% / 7d 40% both in走廊/headroom → hold).
assert_eq hold "$(printf '%s' "$AOUT" | jval advise.verdict)" "advise verdict from ccm engine (5h 59%/7d 40% → hold)"
rm -rf "$ACC_DIR"

# ── ACCOUNT: critical 7d → advise hard_stop verdict (走廊数学 SSOT·ADR-010) ──────────────────────────
ACC_DIR="$(make_project)"; HCACHE="$ACC_DIR/rate.json"
printf '{"captured_at":%d,"five_hour":{"used_percentage":40,"resets_at":%d},"seven_day":{"used_percentage":90,"resets_at":%d}}' "$NOWEP" "$R5" "$R7" > "$HCACHE"
HOUT="$(CC_MASTER_HOME="$ISO_HOME" CC_MASTER_RATE_CACHE="$HCACHE" bash "$SCRIPT")"
assert_eq account "$(printf '%s' "$HOUT" | jval source)" "critical 7d sidecar → still source=account"
assert_eq hard_stop "$(printf '%s' "$HOUT" | jval advise.verdict)" "7d 90% ≥ hard-stop gate → advise verdict hard_stop (ADR-010)"
assert_eq true "$(printf '%s' "$HOUT" | jval advise.hard_stop_7d)" "hard_stop_7d flag set"
rm -rf "$ACC_DIR"

# ── ACCOUNT: 5h critical (走廊上界) → advise throttle ────────────────────────────────────────────────
ACC_DIR="$(make_project)"; TCACHE="$ACC_DIR/rate.json"
printf '{"captured_at":%d,"five_hour":{"used_percentage":94,"resets_at":%d},"seven_day":{"used_percentage":40,"resets_at":%d}}' "$NOWEP" "$R5" "$R7" > "$TCACHE"
TOUT="$(CC_MASTER_HOME="$ISO_HOME" CC_MASTER_RATE_CACHE="$TCACHE" bash "$SCRIPT")"
assert_eq throttle "$(printf '%s' "$TOUT" | jval advise.verdict)" "5h 94% ≥走廊上界 + single account → advise throttle"
rm -rf "$ACC_DIR"

# ── UNAVAILABLE: no sidecar → source:unavailable + available:false + honest note (本地反推已撤) ────────
NOCACHE="/nonexistent-cc-master-rate-cache-xyz"
UOUT="$(CC_MASTER_HOME="$ISO_HOME" CC_MASTER_RATE_CACHE="$NOCACHE" bash "$SCRIPT")"
assert_eq unavailable "$(printf '%s' "$UOUT" | jval source)" "no sidecar → source=unavailable (本地反推已撤·plan §10)"
assert_eq false "$(printf '%s' "$UOUT" | jval available)" "no sidecar → available:false (honest degrade, exit 0)"
assert_contains "$UOUT" "本地 JSONL 反推已撤" "unavailable note honestly states local 反推 dropped"

# ── GRACEFUL: ccm binary absent → source:unavailable (graceful, never crash) ──────────────────────────
ACC_DIR="$(make_project)"; GCACHE="$ACC_DIR/rate.json"
printf '{"captured_at":%d,"five_hour":{"used_percentage":59,"resets_at":%d},"seven_day":{"used_percentage":40,"resets_at":%d}}' "$NOWEP" "$R5" "$R7" > "$GCACHE"
GOUT="$(CCM_BIN="/nonexistent-ccm-absent-xyz" CC_MASTER_HOME="$ISO_HOME" CC_MASTER_RATE_CACHE="$GCACHE" bash "$SCRIPT")"
GRC=$?
assert_eq 0 "$GRC" "ccm absent → exit 0 (graceful, never errors out)"
assert_eq unavailable "$(printf '%s' "$GOUT" | jval source)" "ccm absent → source=unavailable (graceful degrade)"
rm -rf "$ACC_DIR"

# ── BACK-COMPAT: legacy --now / --dir flags are accepted as NO-OPs (don't error) ──────────────────────
ACC_DIR="$(make_project)"; BCACHE="$ACC_DIR/rate.json"
printf '{"captured_at":%d,"five_hour":{"used_percentage":59,"resets_at":%d},"seven_day":{"used_percentage":40,"resets_at":%d}}' "$NOWEP" "$R5" "$R7" > "$BCACHE"
BOUT="$(CC_MASTER_HOME="$ISO_HOME" CC_MASTER_RATE_CACHE="$BCACHE" bash "$SCRIPT" --now "2026-06-10T12:00:00Z" --dir /some/dir)"
BRC=$?
assert_eq 0 "$BRC" "legacy --now/--dir accepted as no-ops → exit 0"
assert_eq account "$(printf '%s' "$BOUT" | jval source)" "legacy flags don't break the account path"
rm -rf "$ACC_DIR"

# ── EFFECTIVE-N override: --effective-n passes through to ccm advise (n>1 + 5h critical + 7d余量 → 切号侧) ──
ACC_DIR="$(make_project)"; NCACHE="$ACC_DIR/rate.json"
printf '{"captured_at":%d,"five_hour":{"used_percentage":94,"resets_at":%d},"seven_day":{"used_percentage":20,"resets_at":%d}}' "$NOWEP" "$R5" "$R7" > "$NCACHE"
NOUT="$(CC_MASTER_HOME="$ISO_HOME" CC_MASTER_RATE_CACHE="$NCACHE" bash "$SCRIPT" --effective-n 3)"
assert_eq 3 "$(printf '%s' "$NOUT" | jval effective_n)" "--effective-n 3 passes through to ccm"
assert_eq accelerate "$(printf '%s' "$NOUT" | jval advise.verdict)" "n=3 + 5h critical + 7d余量 → advise accelerate (切号侧·ADR-010)"
rm -rf "$ACC_DIR"

rm -rf "$ISO_HOME"
finish
