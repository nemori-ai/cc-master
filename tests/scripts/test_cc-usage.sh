#!/usr/bin/env bash
# Out-of-band cc-usage.sh correctness: deterministic fixture + fixed --now → exact numbers.
# Finding #37: cc-usage.sh now PREFERS the account-authoritative rate_limits captured into a sidecar
# (status-line is the only programmatic source of 5h/7d used_percentage + resets_at). When the sidecar
# is fresh it emits source:"account" with the AUTHORITATIVE used_percentage + reset-derived window; when
# it is missing/stale it falls back to the local-JSONL 反推 and HONESTLY labels source:"local-derived-approx".
. "$(dirname "$0")/../hooks/helpers.sh"

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
FIX="$(cd "$(dirname "$0")/fixtures" && pwd)"
# Each fixture lives in its OWN subdir — cc-usage.sh globs **/*.jsonl recursively, so a shared
# dir would let one fixture's rows leak into another's window.
SAMPLE="$FIX/sample"; ROLL="$FIX/rolling"
# Local-反推 cases must NOT accidentally read a real ~/.claude sidecar — pin the cache to a path that
# does not exist so they deterministically take the fallback branch.
NOCACHE="/nonexistent-cc-master-rate-cache-xyz"
jval() { python3 -c 'import sys,json;d=json.load(sys.stdin)
for k in sys.argv[1].split("."): d=d[k]
print(d)' "$1"; }

# ── FALLBACK: no sidecar → local-derived-approx, original schema intact ──────────────────────────────
# active window: now=12:00Z, latest msg 11:00Z is <5h ago → block is live.
OUT="$(CC_MASTER_RATE_CACHE="$NOCACHE" bash "$ROOT/skills/orchestrating-to-completion/scripts/cc-usage.sh" --dir "$SAMPLE" --now "2026-06-10T12:00:00Z")"
assert_eq local-derived-approx "$(printf '%s' "$OUT" | jval source)" "no sidecar → source=local-derived-approx (honest label)"
# m1=1350; m2 rewritten twice → dedup keeps MAX usage per id = 2050, total = 3400 (first-seen → 1400).
assert_eq 3400 "$(printf '%s' "$OUT" | jval five_hour.used_tokens)" "5h used_tokens (dedup keeps largest usage per id + sums all kinds)"
# window starts at block's first msg 10:00Z; remaining = (10:00+5h) - 12:00 = 180 min
assert_eq 180  "$(printf '%s' "$OUT" | jval five_hour.window_remaining_min)" "5h window_remaining_min (now=12:00Z)"
assert_eq 3400 "$(printf '%s' "$OUT" | jval seven_day.used_tokens)" "7d used_tokens"

# stale window (Finding #27): now=20:00Z, block 10:00Z+5h=15:00Z < now → closed → clean zero, never negative.
STALE="$(CC_MASTER_RATE_CACHE="$NOCACHE" bash "$ROOT/skills/orchestrating-to-completion/scripts/cc-usage.sh" --dir "$SAMPLE" --now "2026-06-10T20:00:00Z")"
assert_eq 0    "$(printf '%s' "$STALE" | jval five_hour.used_tokens)" "5h used_tokens zero once window closed (no stale carryover)"
assert_eq 0    "$(printf '%s' "$STALE" | jval five_hour.window_remaining_min)" "5h window_remaining_min zero once closed (never negative)"
assert_eq 3400 "$(printf '%s' "$STALE" | jval seven_day.used_tokens)" "7d used_tokens still counts closed-5h msgs within 7d"

# continuous use across 5h boundary (Finding #27 r2): new block opens at 15:01Z; at 15:02 active=300, rem=299.
ROLLOUT="$(CC_MASTER_RATE_CACHE="$NOCACHE" bash "$ROOT/skills/orchestrating-to-completion/scripts/cc-usage.sh" --dir "$ROLL" --now "2026-06-10T15:02:00Z")"
assert_eq 300 "$(printf '%s' "$ROLLOUT" | jval five_hour.used_tokens)" "5h used = current rolling block only (new block at 5h boundary)"
assert_eq 299 "$(printf '%s' "$ROLLOUT" | jval five_hour.window_remaining_min)" "5h window_remaining tracks the NEW block start"

# --now filters future rows (Finding #27 r4): now=11:00Z before 14:59/15:01 msgs → only r1 (100) counts.
FUTURE="$(CC_MASTER_RATE_CACHE="$NOCACHE" bash "$ROOT/skills/orchestrating-to-completion/scripts/cc-usage.sh" --dir "$ROLL" --now "2026-06-10T11:00:00Z")"
assert_eq 100 "$(printf '%s' "$FUTURE" | jval five_hour.used_tokens)" "rows newer than --now excluded (no future usage counted)"
assert_eq 240 "$(printf '%s' "$FUTURE" | jval five_hour.window_remaining_min)" "window_remaining tracks the only <=now block (10:00)"

# ── ACCOUNT: fresh sidecar (five_hour.resets_at>now) → source:account + authoritative %/reset ────────
NOWEP="$(python3 -c 'import datetime as d;print(int(d.datetime(2026,6,10,12,0,0,tzinfo=d.timezone.utc).timestamp()))')"
ACC_DIR="$(make_project)"; ACACHE="$ACC_DIR/rate.json"
R5=$((NOWEP+180*60)); R7=$((NOWEP+2*86400))   # 5h resets in 180min, 7d resets in 2d
printf '{"captured_at":%d,"five_hour":{"used_percentage":59,"resets_at":%d},"seven_day":{"used_percentage":86,"resets_at":%d}}' "$NOWEP" "$R5" "$R7" > "$ACACHE"
AOUT="$(CC_MASTER_RATE_CACHE="$ACACHE" bash "$ROOT/skills/orchestrating-to-completion/scripts/cc-usage.sh" --dir "$SAMPLE" --now "2026-06-10T12:00:00Z")"
assert_eq account "$(printf '%s' "$AOUT" | jval source)" "fresh sidecar → source=account"
assert_eq 59  "$(printf '%s' "$AOUT" | jval five_hour.used_percentage)"     "account: 5h used_percentage from sidecar (authoritative)"
assert_eq 180 "$(printf '%s' "$AOUT" | jval five_hour.window_remaining_min)" "account: 5h window_remaining from authoritative resets_at (not反推)"
assert_eq 86  "$(printf '%s' "$AOUT" | jval seven_day.used_percentage)"      "account: 7d used_percentage from sidecar"
assert_eq 3400 "$(printf '%s' "$AOUT" | jval five_hour.used_tokens)"         "account: still carries local used_tokens (burn context)"
rm -rf "$ACC_DIR"

# ── STALE sidecar (five_hour.resets_at<=now → window already rolled) → fallback, honest label ────────
ACC_DIR="$(make_project)"; SCACHE="$ACC_DIR/rate.json"
RPAST=$((NOWEP-60))
printf '{"captured_at":%d,"five_hour":{"used_percentage":59,"resets_at":%d}}' "$NOWEP" "$RPAST" > "$SCACHE"
SOUT="$(CC_MASTER_RATE_CACHE="$SCACHE" bash "$ROOT/skills/orchestrating-to-completion/scripts/cc-usage.sh" --dir "$SAMPLE" --now "2026-06-10T12:00:00Z")"
assert_eq local-derived-approx "$(printf '%s' "$SOUT" | jval source)" "stale sidecar (resets_at in past) → fallback source"
assert_eq 3400 "$(printf '%s' "$SOUT" | jval five_hour.used_tokens)" "stale sidecar → local used_tokens still emitted"
rm -rf "$ACC_DIR"

finish
