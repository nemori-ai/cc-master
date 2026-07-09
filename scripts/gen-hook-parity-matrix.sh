#!/usr/bin/env bash
# gen-hook-parity-matrix.sh — render design_docs/hook-parity-matrix.md (ADR-028 / ADR-031).
#
# Usage:
#   scripts/gen-hook-parity-matrix.sh           # regenerate
#   scripts/gen-hook-parity-matrix.sh --check   # diff against committed (run-tests.sh)

set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$REPO/design_docs/hook-parity-matrix.md"
MJS="$REPO/scripts/gen-hook-parity-matrix.mjs"

MODE="write"
if [ "${1:-}" = "--check" ]; then
  MODE="check"
elif [ "${1:-}" != "" ]; then
  echo "usage: scripts/gen-hook-parity-matrix.sh [--check]" >&2
  exit 2
fi

command -v node >/dev/null 2>&1 || {
  echo "node not found on PATH — required (ADR-006)" >&2
  exit 1
}

GENERATED="$(REPO="$REPO" node "$MJS")"

if [ "$MODE" = "check" ]; then
  if [ ! -f "$OUT" ]; then
    echo "gen-hook-parity-matrix: missing $OUT — run scripts/gen-hook-parity-matrix.sh" >&2
    exit 1
  fi
  CURRENT="$(cat "$OUT")"
  if [ "$GENERATED" != "$CURRENT" ]; then
    echo "gen-hook-parity-matrix: $OUT is stale — run scripts/gen-hook-parity-matrix.sh and commit the diff" >&2
    diff <(echo "$CURRENT") <(echo "$GENERATED") || true
    exit 1
  fi
  echo "gen-hook-parity-matrix: OK — $OUT is in sync"
  exit 0
fi

mkdir -p "$(dirname "$OUT")"
printf '%s' "$GENERATED" > "$OUT"
echo "gen-hook-parity-matrix: wrote $OUT"
