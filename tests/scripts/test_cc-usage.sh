#!/usr/bin/env bash
# Out-of-band cc-usage.sh correctness: deterministic fixture + fixed --now → exact 5h numbers.
. "$(dirname "$0")/../hooks/helpers.sh"

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
FIX="$(cd "$(dirname "$0")/fixtures" && pwd)"

# --- active window: now=12:00Z, latest msg 11:00Z is <5h ago → block is live ---
OUT="$(bash "$ROOT/scripts/cc-usage.sh" --dir "$FIX" --now "2026-06-10T12:00:00Z")"

used="$(printf '%s' "$OUT" | python3 -c 'import sys,json;print(json.load(sys.stdin)["five_hour"]["used_tokens"])')"
rem="$(printf '%s'  "$OUT" | python3 -c 'import sys,json;print(json.load(sys.stdin)["five_hour"]["window_remaining_min"])')"
wk="$(printf '%s'   "$OUT" | python3 -c 'import sys,json;print(json.load(sys.stdin)["seven_day"]["used_tokens"])')"

# m1=1350, m2=2050 (m2 row appears twice → dedup by message.id) → 3400
assert_eq 3400 "$used" "5h used_tokens (dedup by message.id + sum of all token kinds)"
# window starts at the block's first msg 10:00Z; remaining = (10:00+5h) - 12:00 = 180 min
assert_eq 180  "$rem"  "5h window_remaining_min (now=12:00Z)"
# both messages are within 7d of 2026-06-10T12:00:00Z
assert_eq 3400 "$wk"   "7d used_tokens"

# --- stale window (codex Finding #27): now=20:00Z, block start 10:00Z + 5h = 15:00Z < now →
#     the window already closed. Must report a clean zero — never stale used_tokens, and never
#     a NEGATIVE window_remaining_min. ---
STALE="$(bash "$ROOT/scripts/cc-usage.sh" --dir "$FIX" --now "2026-06-10T20:00:00Z")"
s_used="$(printf '%s' "$STALE" | python3 -c 'import sys,json;print(json.load(sys.stdin)["five_hour"]["used_tokens"])')"
s_rem="$(printf '%s'  "$STALE" | python3 -c 'import sys,json;print(json.load(sys.stdin)["five_hour"]["window_remaining_min"])')"
s_wk="$(printf '%s'   "$STALE" | python3 -c 'import sys,json;print(json.load(sys.stdin)["seven_day"]["used_tokens"])')"
assert_eq 0    "$s_used" "5h used_tokens is zero once the window has closed (no stale carryover)"
assert_eq 0    "$s_rem"  "5h window_remaining_min is zero once closed (never negative)"
# 7d window is independent of the 5h block: both msgs are still within 7d of 20:00Z
assert_eq 3400 "$s_wk"   "7d used_tokens still counts closed-5h-window msgs within 7d"

finish
