#!/usr/bin/env bash
# cc-usage.sh — out-of-band 5h/7d usage signal for the orchestrator (NOT a hook).
#
# Ship-anywhere: the system python3 (3.9-compatible) parses local Claude Code JSONL
# (~/.claude/projects/**/*.jsonl, the assistant.message.usage records) and computes the
# current 5h rolling block + the 7d total. Zero network, zero extra deps — and it ALWAYS
# emits the normalized schema below (no external tool whose output shape we don't control).
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
# Usage: cc-usage.sh [--dir <jsonl-root>] [--now <ISO8601>]
#   --dir  JSONL root (default ~/.claude/projects) — also lets tests point at a fixture.
#   --now  override "now" with an ISO-8601 instant — makes the rolling window deterministic.
#
# Output (JSON, one line):
#   {"five_hour":{"used_tokens":N,"window_remaining_min":M,"burn_rate_per_min":R},
#    "seven_day":{"used_tokens":N}}
set -uo pipefail

DIR="${HOME}/.claude/projects"; NOW=""
while [ $# -gt 0 ]; do
  case "$1" in
    --dir) DIR="$2"; shift 2;;
    --now) NOW="$2"; shift 2;;
    *)     shift;;
  esac
done

# Pure-python parse only — always emits the normalized schema below. (A `ccusage` accelerator
# was intentionally dropped: its raw `blocks --json` shape differs from ours, so piping it
# through verbatim would break any caller parsing the documented schema. A future accelerator
# MUST first normalize ccusage output into THIS schema; until then, zero external-tool dep.)
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

# Only the block that still CONTAINS now is the active window. If the most recent activity is
# >5h old, that block already closed (the quota window refreshed) — report a clean zero, never
# a stale used_tokens nor a negative window_remaining_min.
fh = {"used_tokens": 0, "window_remaining_min": 0, "burn_rate_per_min": 0}
if blocks:
    b = blocks[-1]
    start = b[0][0]
    if now <= start + five:
        used = sum(t for _, t in b)
        elapsed_min = max((now - start).total_seconds() / 60, 1)
        fh = {
            "used_tokens": used,
            "window_remaining_min": round(((start + five) - now).total_seconds() / 60),
            "burn_rate_per_min": round(used / elapsed_min),
        }

wk = sum(tok for ts, tok in rows if now - ts <= dt.timedelta(days=7))
print(json.dumps({"five_hour": fh, "seven_day": {"used_tokens": wk}}))
PY
