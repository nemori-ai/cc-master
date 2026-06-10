#!/usr/bin/env bash
# Out-of-band cc-usage.sh correctness: deterministic fixture + fixed --now → exact 5h numbers.
. "$(dirname "$0")/../hooks/helpers.sh"

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
FIX="$(cd "$(dirname "$0")/fixtures" && pwd)"

OUT="$(bash "$ROOT/scripts/cc-usage.sh" --dir "$FIX" --now "2026-06-10T12:00:00Z" --no-ccusage)"

used="$(printf '%s' "$OUT" | python3 -c 'import sys,json;print(json.load(sys.stdin)["five_hour"]["used_tokens"])')"
rem="$(printf '%s'  "$OUT" | python3 -c 'import sys,json;print(json.load(sys.stdin)["five_hour"]["window_remaining_min"])')"
wk="$(printf '%s'   "$OUT" | python3 -c 'import sys,json;print(json.load(sys.stdin)["seven_day"]["used_tokens"])')"

# m1=1350, m2=2050 (m2 row appears twice → dedup by message.id) → 3400
assert_eq 3400 "$used" "5h used_tokens (dedup by message.id + sum of all token kinds)"
# window starts at the block's first msg 10:00Z; remaining = (10:00+5h) - 12:00 = 180 min
assert_eq 180  "$rem"  "5h window_remaining_min (now=12:00Z)"
# both messages are within 7d of 2026-06-10T12:00:00Z
assert_eq 3400 "$wk"   "7d used_tokens"

finish
