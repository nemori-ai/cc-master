#!/usr/bin/env bash
# gen-capability-parity-matrix.sh — render design_docs/capability-parity-matrix.md (ADR-031).
#
# Usage:
#   scripts/gen-capability-parity-matrix.sh           # regenerate
#   scripts/gen-capability-parity-matrix.sh --check   # diff against committed (run-tests.sh)

set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$REPO/design_docs/capability-parity-matrix.md"
MJS="$REPO/scripts/gen-capability-parity-matrix.mjs"

MODE="write"
if [ "${1:-}" = "--check" ]; then
  MODE="check"
elif [ "${1:-}" != "" ]; then
  echo "usage: scripts/gen-capability-parity-matrix.sh [--check]" >&2
  exit 2
fi

command -v node >/dev/null 2>&1 || {
  echo "node not found on PATH — required (ADR-006)" >&2
  exit 1
}

GENERATED="$(REPO="$REPO" node "$MJS")"

if [ "$MODE" = "check" ]; then
  if [ ! -f "$OUT" ]; then
    echo "gen-capability-parity-matrix: missing $OUT — run scripts/gen-capability-parity-matrix.sh" >&2
    exit 1
  fi
  CURRENT="$(cat "$OUT")"
  if [ "$GENERATED" != "$CURRENT" ]; then
    echo "gen-capability-parity-matrix: $OUT is stale — run scripts/gen-capability-parity-matrix.sh" >&2
    diff <(echo "$CURRENT") <(echo "$GENERATED") || true
    exit 1
  fi
  echo "gen-capability-parity-matrix: OK — $OUT is in sync"
  exit 0
fi

mkdir -p "$(dirname "$OUT")"
printf '%s' "$GENERATED" > "$OUT"
echo "gen-capability-parity-matrix: wrote $OUT"
