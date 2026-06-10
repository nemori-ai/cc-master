#!/usr/bin/env bash
# cc-usage.sh — out-of-band 5h/7d usage signal for the orchestrator (NOT a hook).
#
# Ship-anywhere: the system python3 (3.9-compatible) parses local Claude Code JSONL
# (~/.claude/projects/**/*.jsonl, the assistant.message.usage records) and computes the
# current 5h rolling block + the 7d total. Zero network, zero extra deps. If `ccusage` is
# on PATH it is used as an optional accelerator (more accurate, carries an official burn
# rate) — pass --no-ccusage to force the pure parser.
#
# Out-of-band like codex-review / eval: this is a script the orchestrator's MAIN THREAD
# runs deliberately at a pacing decision point. It is NOT a hook — it does NOT live in
# hooks/ and is NOT bound by red line 1 (pure-bash). It informs usage-aware pacing
# (see skills/orchestrating-to-completion/references/cost-and-pacing.md).
#
# Scope note (honest): context %used (`used_percentage` / `rate_limits.*.used_percentage`)
# lives ONLY in the status-line stdin JSON, not in the JSONL — this script does NOT emit
# it. It emits 5h/7d token usage + a 5h burn rate, which is what a long-horizon
# orchestrator needs to pace against a rolling quota window.
#
# Usage: cc-usage.sh [--dir <jsonl-root>] [--now <ISO8601>] [--no-ccusage]
#   --dir         JSONL root (default ~/.claude/projects) — also lets tests point at a fixture.
#   --now         override "now" with an ISO-8601 instant — makes the rolling window deterministic.
#   --no-ccusage  force the pure-python parser even when ccusage is installed.
#
# Output (JSON, one line):
#   {"five_hour":{"used_tokens":N,"window_remaining_min":M,"burn_rate_per_min":R},
#    "seven_day":{"used_tokens":N}}
set -uo pipefail

DIR="${HOME}/.claude/projects"; NOW=""; USE_CCUSAGE=1
while [ $# -gt 0 ]; do
  case "$1" in
    --dir)        DIR="$2"; shift 2;;
    --now)        NOW="$2"; shift 2;;
    --no-ccusage) USE_CCUSAGE=0; shift;;
    *)            shift;;
  esac
done

# Optional accelerator: only when ccusage is present AND no fixed --now was requested
# (ccusage always reports against the real now, so it cannot honor a test --now).
if [ "$USE_CCUSAGE" -eq 1 ] && command -v ccusage >/dev/null 2>&1 && [ -z "$NOW" ]; then
  out="$(ccusage blocks --json 2>/dev/null)" && [ -n "$out" ] && { printf '%s\n' "$out"; exit 0; }
fi

DIR="$DIR" NOW="$NOW" python3 - <<'PY'
import os, json, glob, datetime as dt

root = os.environ["DIR"]
now_s = os.environ.get("NOW", "")
now = (dt.datetime.fromisoformat(now_s.replace("Z", "+00:00"))
       if now_s else dt.datetime.now(dt.timezone.utc))

seen = set()
rows = []  # (timestamp, total_tokens)
for f in glob.glob(os.path.join(root, "**", "*.jsonl"), recursive=True):
    try:
        for line in open(f, encoding="utf-8"):
            line = line.strip()
            if not line:
                continue
            try:
                o = json.loads(line)
            except Exception:
                continue
            if o.get("type") != "assistant":
                continue
            msg = o.get("message") or {}
            u = msg.get("usage")
            mid = msg.get("id")
            if not u or not mid or mid in seen:   # dedup repeated tool-iteration rewrites
                continue
            seen.add(mid)
            tok = (u.get("input_tokens", 0) + u.get("output_tokens", 0)
                   + u.get("cache_creation_input_tokens", 0) + u.get("cache_read_input_tokens", 0))
            try:
                ts = dt.datetime.fromisoformat(o["timestamp"].replace("Z", "+00:00"))
            except Exception:
                continue
            rows.append((ts, tok))
    except Exception:
        continue

rows.sort(key=lambda r: r[0])

# 5h rolling block (ccusage口径): break when the gap to the previous msg exceeds 5h;
# the active block is the one containing the most recent message.
five = dt.timedelta(hours=5)
blocks, cur = [], []
for ts, tok in rows:
    if cur and ts - cur[-1][0] > five:
        blocks.append(cur); cur = []
    cur.append((ts, tok))
if cur:
    blocks.append(cur)

fh = {"used_tokens": 0, "window_remaining_min": 0, "burn_rate_per_min": 0}
if blocks:
    b = blocks[-1]
    used = sum(t for _, t in b)
    start = b[0][0]
    elapsed_min = max((now - start).total_seconds() / 60, 1)
    fh = {
        "used_tokens": used,
        "window_remaining_min": round(((start + five) - now).total_seconds() / 60),
        "burn_rate_per_min": round(used / elapsed_min),
    }

wk = sum(tok for ts, tok in rows if now - ts <= dt.timedelta(days=7))
print(json.dumps({"five_hour": fh, "seven_day": {"used_tokens": wk}}))
PY
