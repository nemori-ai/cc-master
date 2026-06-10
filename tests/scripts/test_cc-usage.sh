#!/usr/bin/env bash
# Out-of-band cc-usage.sh correctness: deterministic fixture + fixed --now → exact 5h numbers.
. "$(dirname "$0")/../hooks/helpers.sh"

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
FIX="$(cd "$(dirname "$0")/fixtures" && pwd)"
# Each fixture lives in its OWN subdir — cc-usage.sh globs **/*.jsonl recursively, so a shared
# dir would let one fixture's rows leak into another's window.
SAMPLE="$FIX/sample"; ROLL="$FIX/rolling"

# --- active window: now=12:00Z, latest msg 11:00Z is <5h ago → block is live ---
OUT="$(bash "$ROOT/scripts/cc-usage.sh" --dir "$SAMPLE" --now "2026-06-10T12:00:00Z")"

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
STALE="$(bash "$ROOT/scripts/cc-usage.sh" --dir "$SAMPLE" --now "2026-06-10T20:00:00Z")"
s_used="$(printf '%s' "$STALE" | python3 -c 'import sys,json;print(json.load(sys.stdin)["five_hour"]["used_tokens"])')"
s_rem="$(printf '%s'  "$STALE" | python3 -c 'import sys,json;print(json.load(sys.stdin)["five_hour"]["window_remaining_min"])')"
s_wk="$(printf '%s'   "$STALE" | python3 -c 'import sys,json;print(json.load(sys.stdin)["seven_day"]["used_tokens"])')"
assert_eq 0    "$s_used" "5h used_tokens is zero once the window has closed (no stale carryover)"
assert_eq 0    "$s_rem"  "5h window_remaining_min is zero once closed (never negative)"
# 7d window is independent of the 5h block: both msgs are still within 7d of 20:00Z
assert_eq 3400 "$s_wk"   "7d used_tokens still counts closed-5h-window msgs within 7d"

# --- continuous use across the 5h boundary (codex Finding #27 round-2): msgs 10:00 / 14:59 /
#     15:01 with NO >5h gap. 15:01 is 5h01m after the block's first msg → it opens a NEW block.
#     At 15:02 the active window is that new block (r3=300) — NOT a stale zero, NOT the whole 600.
#     Guards against sustained-usage-past-5h wrongly reporting an empty window. ---
ROLLOUT="$(bash "$ROOT/scripts/cc-usage.sh" --dir "$ROLL" --now "2026-06-10T15:02:00Z")"
r_used="$(printf '%s' "$ROLLOUT" | python3 -c 'import sys,json;print(json.load(sys.stdin)["five_hour"]["used_tokens"])')"
r_rem="$(printf '%s'  "$ROLLOUT" | python3 -c 'import sys,json;print(json.load(sys.stdin)["five_hour"]["window_remaining_min"])')"
assert_eq 300 "$r_used" "5h used = current rolling block only (new block opens at the 5h boundary even under continuous use)"
# new block starts 15:01Z; remaining = (15:01+5h) - 15:02 = 299 min
assert_eq 299 "$r_rem"  "5h window_remaining_min tracks the NEW block start, not the old one"

finish
