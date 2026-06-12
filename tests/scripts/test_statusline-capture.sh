#!/usr/bin/env bash
# TDD — scripts/statusline-capture.js. The ONLY programmatic source of the subscription account's
# 5h/7d rate_limits is the status-line script's stdin (官方核实: hooks/transcript/CLI 全无)。This
# capture script reads that stdin, lifts rate_limits.{five_hour,seven_day}.{used_percentage,resets_at}
# into a sidecar (atomic write) for cc-usage.sh / usage-pacing.js to read, and (optionally) chains the
# user's own status line via --passthrough so it never clobbers their setup. Any failure stays silent
# (a status-line script must never pollute the UI). It is NOT a hook — no arming gate (it only caches a
# read-only ACCOUNT-GLOBAL signal, injects no agent context, blocks nothing).
. "$(dirname "$0")/../hooks/helpers.sh"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CAP="$ROOT/skills/orchestrating-to-completion/scripts/statusline-capture.js"

NOW="2026-06-10T12:00:00Z"
NOW_EPOCH="$(python3 -c "import datetime;print(int(datetime.datetime(2026,6,10,12,0,0,tzinfo=datetime.timezone.utc).timestamp()))")"

# A Pro/Max status-line stdin carrying full rate_limits.
FULL='{"session_id":"s","rate_limits":{"five_hour":{"used_percentage":59,"resets_at":1780066800},"seven_day":{"used_percentage":86,"resets_at":1780300000}}}'

jget() { python3 -c '
import sys, json
v = json.load(open(sys.argv[1]))
for k in sys.argv[2].split("."): v = v[k]
print(v)' "$1" "$2" 2>/dev/null; }

# ── (a) full rate_limits → sidecar written with correct fields + captured_at=now epoch ──────────────
CACHE="$(make_project)/rate.json"
OUT="$(printf '%s' "$FULL" | CC_MASTER_RATE_CACHE="$CACHE" CC_MASTER_NOW="$NOW" "$CAP" 2>/dev/null)"; RC=$?
assert_eq 0 "$RC" "(a) full rate_limits → rc 0"
assert_file "$CACHE" "(a) sidecar created"
assert_eq 59          "$(jget "$CACHE" five_hour.used_percentage)" "(a) five_hour.used_percentage captured"
assert_eq 1780066800  "$(jget "$CACHE" five_hour.resets_at)"       "(a) five_hour.resets_at captured"
assert_eq 86          "$(jget "$CACHE" seven_day.used_percentage)" "(a) seven_day.used_percentage captured"
assert_eq 1780300000  "$(jget "$CACHE" seven_day.resets_at)"       "(a) seven_day.resets_at captured"
assert_eq "$NOW_EPOCH" "$(jget "$CACHE" captured_at)"              "(a) captured_at = now epoch (CC_MASTER_NOW)"

# ── (b) missing rate_limits (non-Pro/Max) → DON'T clobber: no sidecar, silent, rc 0 ─────────────────
CACHE="$(make_project)/rate.json"
OUT="$(printf '%s' '{"session_id":"s","model":{"id":"x"}}' | CC_MASTER_RATE_CACHE="$CACHE" CC_MASTER_NOW="$NOW" "$CAP" 2>/dev/null)"; RC=$?
assert_eq 0 "$RC" "(b) no rate_limits → rc 0"
assert_no_file "$CACHE" "(b) no rate_limits → no sidecar (don't overwrite prior authoritative value)"

# ── (c) windows can be INDEPENDENTLY absent — five_hour present, seven_day absent → only 5h captured ─
CACHE="$(make_project)/rate.json"
printf '%s' '{"rate_limits":{"five_hour":{"used_percentage":12,"resets_at":111}}}' \
  | CC_MASTER_RATE_CACHE="$CACHE" CC_MASTER_NOW="$NOW" "$CAP" >/dev/null 2>&1
assert_file "$CACHE" "(c) sidecar created with partial windows"
assert_eq 12 "$(jget "$CACHE" five_hour.used_percentage)" "(c) five_hour captured"
assert_eq False "$(python3 -c 'import sys,json;d=json.load(open(sys.argv[1]));print("seven_day" in d and d.get("seven_day") is not None)' "$CACHE")" \
  "(c) absent seven_day → not in sidecar"

# ── (d) --passthrough chains the user's own status line; sidecar still captured ──────────────────────
CACHE="$(make_project)/rate.json"
OUT="$(printf '%s' "$FULL" | CC_MASTER_RATE_CACHE="$CACHE" CC_MASTER_NOW="$NOW" "$CAP" --passthrough 'echo USERLINE_XYZ' 2>/dev/null)"; RC=$?
assert_eq 0 "$RC" "(d) passthrough → rc 0"
assert_contains "$OUT" "USERLINE_XYZ" "(d) passthrough preserves the user's status-line stdout"
assert_file "$CACHE" "(d) passthrough still captures the sidecar"

# ── (e) corrupt stdin → rc 0, no sidecar, silent (never pollute the status line) ─────────────────────
CACHE="$(make_project)/rate.json"
OUT="$(printf '%s' 'not json {{{' | CC_MASTER_RATE_CACHE="$CACHE" CC_MASTER_NOW="$NOW" "$CAP" 2>/dev/null)"; RC=$?
assert_eq 0 "$RC" "(e) corrupt stdin → rc 0 (no throw)"
assert_no_file "$CACHE" "(e) corrupt stdin → no sidecar"

# ── (f) default output (no passthrough) surfaces 5h/7d % for the status line ─────────────────────────
CACHE="$(make_project)/rate.json"
OUT="$(printf '%s' "$FULL" | CC_MASTER_RATE_CACHE="$CACHE" CC_MASTER_NOW="$NOW" "$CAP" 2>/dev/null)"
assert_contains "$OUT" "59" "(f) default output carries the 5h %"
assert_contains "$OUT" "86" "(f) default output carries the 7d %"

# ── (g) sidecar is valid, COMPLETE JSON (atomic write — never half-written) ──────────────────────────
CACHE="$(make_project)/rate.json"
printf '%s' "$FULL" | CC_MASTER_RATE_CACHE="$CACHE" CC_MASTER_NOW="$NOW" "$CAP" >/dev/null 2>&1
if python3 -c 'import sys,json;json.load(open(sys.argv[1]))' "$CACHE" 2>/dev/null; then
  PASS=$((PASS+1)); else FAILED=$((FAILED+1)); _red "FAIL: (g) sidecar is valid complete JSON"; fi

finish
