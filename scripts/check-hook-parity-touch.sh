#!/usr/bin/env bash
# check-hook-parity-touch.sh — HOOKPAR-DEC / ADR-028 PR-diff existence check ("hook 双端锁步").
#
# For each dual-`implemented` hook (per plugin/src/hooks/_manifest/hooks.yaml host_coverage), if a PR
# diff touches `implementations/<host-A>/` files but NOT `implementations/<host-B>/` files, this
# script requires the hook's CONTRACT.md to ALSO be touched in the same diff — either because the
# other host was brought into line too (rare — that would touch both hosts, not just CONTRACT.md), or
# because the author is declaring, in the CONTRACT.md "降级行为" section, why this change only
# affects one host. This is an EXISTENCE check only (does CONTRACT.md appear in the diff?), not a
# semantic one — a human reviewer still judges whether the declaration is honest.
#
# Usage:
#   scripts/check-hook-parity-touch.sh [<base-ref>]
#     <base-ref> defaults to $GITHUB_BASE_REF / origin/main / main, in that order. If no base ref is
#     resolvable (e.g. running standalone, no remote, shallow clone with no shared history), this
#     script prints a note and exits 0 — it is a PR-context advisory check, not a general-purpose
#     hook test, and must never fail a plain local `run-tests.sh` run for lack of PR context.
#
# This is intentionally NOT wired into run-tests.sh (unlike scripts/gen-hook-parity-matrix.sh, which
# is a pure regenerate+diff check with no git-history dependency) — it needs a meaningful base ref to
# diff against, which a bare local test run does not reliably have.

set -uo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"

BASE_REF="${1:-${GITHUB_BASE_REF:-}}"
if [ -z "$BASE_REF" ]; then
  if git rev-parse --verify --quiet origin/main >/dev/null; then
    BASE_REF="origin/main"
  elif git rev-parse --verify --quiet main >/dev/null; then
    BASE_REF="main"
  fi
fi

if [ -z "$BASE_REF" ] || ! git rev-parse --verify --quiet "$BASE_REF" >/dev/null; then
  echo "check-hook-parity-touch: no resolvable base ref (pass one explicitly, e.g. \`scripts/check-hook-parity-touch.sh origin/main\`) — skipping (not a PR-context run)."
  exit 0
fi

MERGE_BASE="$(git merge-base "$BASE_REF" HEAD 2>/dev/null || echo "$BASE_REF")"
# Diff against the WORKING TREE (not just HEAD), AND include untracked new files (e.g. a brand-new
# CONTRACT.md `git diff` alone would miss): this must catch uncommitted changes too, since cc-master's
# own workflow (AGENTS.md §11) is sub-agents implement + orchestrator commits at the end — this check
# needs to be meaningful before that final commit exists, not only after.
TRACKED_CHANGED="$(git diff --name-only "$MERGE_BASE" -- plugin/src/hooks 2>/dev/null || true)"
UNTRACKED_NEW="$(git ls-files --others --exclude-standard -- plugin/src/hooks 2>/dev/null || true)"
CHANGED="$(printf '%s\n%s\n' "$TRACKED_CHANGED" "$UNTRACKED_NEW" | sed '/^$/d' | sort -u)"
if [ -z "$CHANGED" ]; then
  echo "check-hook-parity-touch: no plugin/src/hooks changes vs $BASE_REF — nothing to check."
  exit 0
fi

# Enumerate dual-implemented hooks from hooks.yaml (both claude-code and codex start with "implemented").
DUAL_HOOKS="$(node -e '
const fs = require("fs");
const text = fs.readFileSync("plugin/src/hooks/_manifest/hooks.yaml", "utf8");
const ids = [];
let curId = null, cov = {};
for (const line of text.split(/\r?\n/)) {
  const idM = line.match(/^\s*-\s+id:\s*(.+?)\s*$/);
  if (idM) { if (curId && cov["claude-code"] && cov["codex"] && cov["claude-code"].startsWith("implemented") && cov["codex"].startsWith("implemented")) ids.push(curId); curId = idM[1]; cov = {}; continue; }
  const hostM = line.match(/^\s+(claude-code|codex):\s*(.+?)\s*$/);
  if (hostM) cov[hostM[1]] = hostM[2];
}
if (curId && cov["claude-code"] && cov["codex"] && cov["claude-code"].startsWith("implemented") && cov["codex"].startsWith("implemented")) ids.push(curId);
process.stdout.write(ids.join("\n"));
')"

fail=0
for hook in $DUAL_HOOKS; do
  touched_claude="$(echo "$CHANGED" | grep -c "^plugin/src/hooks/${hook}/implementations/claude-code/" || true)"
  touched_codex="$(echo "$CHANGED" | grep -c "^plugin/src/hooks/${hook}/implementations/codex/" || true)"
  touched_contract="$(echo "$CHANGED" | grep -c "^plugin/src/hooks/${hook}/CONTRACT.md$" || true)"
  if [ "$touched_claude" -gt 0 ] && [ "$touched_codex" -eq 0 ] && [ "$touched_contract" -eq 0 ]; then
    echo "check-hook-parity-touch: FAIL — ${hook}: claude-code implementation touched, codex untouched, and CONTRACT.md untouched. Either bring codex into line, or declare the divergence in plugin/src/hooks/${hook}/CONTRACT.md (降级行为 section)." >&2
    fail=1
  fi
  if [ "$touched_codex" -gt 0 ] && [ "$touched_claude" -eq 0 ] && [ "$touched_contract" -eq 0 ]; then
    echo "check-hook-parity-touch: FAIL — ${hook}: codex implementation touched, claude-code untouched, and CONTRACT.md untouched. Either bring claude-code into line, or declare the divergence in plugin/src/hooks/${hook}/CONTRACT.md (降级行为 section)." >&2
    fail=1
  fi
done

if [ "$fail" -eq 0 ]; then
  echo "check-hook-parity-touch: OK — no undeclared single-host hook touches vs $BASE_REF."
fi
exit "$fail"
