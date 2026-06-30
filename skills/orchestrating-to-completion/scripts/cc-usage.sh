#!/usr/bin/env bash
# cc-usage.sh — out-of-band 5h/7d usage signal for the orchestrator (NOT a hook).
#
# P4 收口（ADR-014/015·plan §10-P4 line 174）：this script no longer parses JSONL with python3. The
# account-authoritative 5h/7d signal收口'd into the `ccm` engine: it reads the status-line sidecar
# (the ONLY programmatic source of 5h/7d `used_percentage` + `resets_at`·Finding #37) plus the accounts.json
# registry. cc-usage.sh is now a thin shell wrapper that delegates to `ccm usage show --json` (account
# state) and `ccm usage advise --json` (双侧走廊 verdict·引擎 pacing.ts SSOT·ADR-010), reshapes them into
# the normalized schema below, and — crucially — **去掉了 python3 依赖**（zero python3·red line 5 spirit:
# this out-of-band script no longer needs a system python).
#
# Capability note (honest·plan §10 line 174「降级为账户权威 only + 诚实标注」)：the old python3 path also
# did a LOCAL JSONL 反推（used_tokens / burn_rate / 反推 window）as a fallback when no sidecar existed. That
# 反推 path is **dropped here**: the engine deliberately excludes JSONL 反推（usage/pacing.ts:「引擎不含
# JSONL 反推」·plan §4 性能边界）, and Finding #37 showed the 反推 reset 倒计时 失真到数量级 (untrustworthy).
# So when the account-authoritative sidecar is unavailable, cc-usage.sh emits `source:"unavailable"` +
# `available:false` and HONESTLY says local approx is no longer offered out-of-band. (The Stop-hook
# usage-pacing.js still keeps its OWN self-contained local 反推 fallback for its in-session pacing nudge;
# that is a hook-internal floor, separate from this out-of-band orchestrator signal.)
#
# Out-of-band like codex-review / eval: the orchestrator's MAIN THREAD runs this deliberately at a pacing
# decision point. It is NOT a hook — it does NOT live in hooks/ and is NOT bound by red line 1 (bash+node/JS).
# It informs usage-aware pacing (see the pacing-and-estimation skill). 红线3：ccm 出 verdict、A 决策——本脚本
# 只把账户状态 + 走廊 verdict 透出，不替编排者拍板。
#
# Requires: `ccm` on PATH (per-OS Node SEA binary·ADR-014 主机预置前置)。CCM_BIN overrides the binary
# (dev/test/自定义安装·绝对路径)。ccm 缺失 → graceful: emit source:"unavailable" + available:false (exit 0,
# 不报错——与 hook 优雅降级同精神，调用方据 available 判断)。
#
# Usage: cc-usage.sh [--now <ISO8601>] [--rate-cache <path>] [--effective-n <N>]
#   --rate-cache  status-line sidecar path (default ${CC_MASTER_RATE_CACHE:-<claudeConfigDir>/.cc-master-rate-limits.json}, claudeConfigDir follows CLAUDE_CONFIG_DIR, default ~/.claude)
#                 — passed through to ccm via CC_MASTER_RATE_CACHE; lets tests point at a fixture.
#   --effective-n 号池有效配额份数覆写（默认从 registry 算·透传给 ccm usage advise --effective-n）。
#   --now         accepted for back-compat but NO-OP (account-authoritative reset 倒计时是 ccm 从 sidecar
#                 的绝对 resets_at 算的真实时刻·不再需要 --now 锚点；旧调用者传了也不报错)。
#   --dir         accepted for back-compat but NO-OP (本地 JSONL 反推已撤·见上 capability note)。
#
# Output (JSON, one line). Account-authoritative shape:
#   {"source":"account","available":true,
#    "five_hour":{"used_percentage":N,"resets_at":E},"seven_day":{"used_percentage":N,"resets_at":E},
#    "effective_n":N,"as_of":"ISO",
#    "advise":{"verdict":"throttle|accelerate|hold|hard_stop","reason":"…","levers":[…],"switch_candidate":…}}
#   When unavailable (no sidecar / ccm missing):
#   {"source":"unavailable","available":false,"note":"账户权威信号不可用…本地反推已撤(plan §10)…"}
set -uo pipefail

NOW=""
# claudeConfigDir 跟随 CLAUDE_CONFIG_DIR（默认 $HOME/.claude·与 ccm/hook 同口径）；CC_MASTER_RATE_CACHE 覆写最高优先。
CLAUDE_CONFIG_DIR_RESOLVED="${CLAUDE_CONFIG_DIR:-${HOME}/.claude}"
RATE_CACHE="${CC_MASTER_RATE_CACHE:-${CLAUDE_CONFIG_DIR_RESOLVED}/.cc-master-rate-limits.json}"
EFFECTIVE_N=""
CCM_BIN="${CCM_BIN:-ccm}"
while [ $# -gt 0 ]; do
  case "$1" in
    --now) NOW="$2"; shift 2;;                 # NO-OP (back-compat)
    --dir) shift 2;;                            # NO-OP (本地反推已撤)
    --rate-cache) RATE_CACHE="$2"; shift 2;;
    --effective-n) EFFECTIVE_N="$2"; shift 2;;
    *)     shift;;
  esac
done

# Delegate to the ccm engine (process boundary·ADR-014). Pass the sidecar path through CC_MASTER_RATE_CACHE
# so ccm reads the SAME sidecar this script is told about. Capture stdout; ccm missing/failed → empty.
ADVISE_ARGS="usage advise --json"
[ -n "$EFFECTIVE_N" ] && ADVISE_ARGS="$ADVISE_ARGS --effective-n $EFFECTIVE_N"

SHOW_JSON="$(CC_MASTER_RATE_CACHE="$RATE_CACHE" "$CCM_BIN" usage show --json 2>/dev/null || true)"
# shellcheck disable=SC2086
ADVISE_JSON="$(CC_MASTER_RATE_CACHE="$RATE_CACHE" "$CCM_BIN" $ADVISE_ARGS 2>/dev/null || true)"

# Reshape with node (red line 5 OK out-of-band·but node is universally present where ccm runs — zero python3).
# node parses the two ccm JSON envelopes and emits the normalized schema. Any failure → unavailable (graceful).
SHOW_JSON="$SHOW_JSON" ADVISE_JSON="$ADVISE_JSON" node <<'NODE'
'use strict';
function parse(s) { try { const o = JSON.parse(s); return o && typeof o === 'object' ? o : null; } catch (_e) { return null; } }
const show = parse(process.env.SHOW_JSON || '');
const advise = parse(process.env.ADVISE_JSON || '');
const sd = show && show.data ? show.data : null;
const ad = advise && advise.data ? advise.data : null;

// Account-authoritative requires the `show` current signal to be available (sidecar present + valid).
const current = sd && sd.current ? sd.current : null;
const available = !!(current && current.available === true);

if (!available) {
  // ccm missing / no sidecar / signal unavailable → honest "unavailable" (本地反推已撤·plan §10 line 174).
  process.stdout.write(JSON.stringify({
    source: 'unavailable',
    available: false,
    note: '账户权威信号不可用（无 status-line sidecar，或 ccm 不可用）。本地 JSONL 反推已撤（plan §10·' +
          '引擎不含反推·Finding #37 反推 reset 失真）——此带外信号现仅账户权威。sidecar 由 ccm 自带的 ' +
          '`ccm statusline`（首次跑 ccm 即自动安装）落；若已 `ccm statusline uninstall` opt-out 则不可用。',
  }) + '\n');
  process.exit(0);
}

// effective_n：advise 路径honors --effective-n 覆写（show 不接该 flag），故优先取 advise 的；缺则取 show 的。
const effN =
  ad && typeof ad.effective_n === 'number'
    ? ad.effective_n
    : typeof sd.effective_n === 'number'
      ? sd.effective_n
      : 1;
const out = {
  source: 'account',
  available: true,
  five_hour: current.five_hour || null,
  seven_day: current.seven_day || null,
  effective_n: effN,
  as_of: sd.as_of || null,
};
if (ad && typeof ad.verdict === 'string') {
  out.advise = {
    verdict: ad.verdict,
    reason: ad.reason || '',
    levers: Array.isArray(ad.levers) ? ad.levers : [],
    switch_candidate: ad.switch_candidate != null ? ad.switch_candidate : null,
    hard_stop_7d: ad.hard_stop_7d === true,
  };
}
process.stdout.write(JSON.stringify(out) + '\n');
NODE
