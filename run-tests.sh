#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

fail=0
echo "== hook tests (bash) =="
for t in tests/hooks/test_*.sh; do
  [ -e "$t" ] || continue
  echo "--- $t"
  bash "$t" || fail=1
done

echo "== node tests (linter + assets + content) =="
# node --test discovers *.test.mjs recursively under the given dirs
if ls tests/linter/*.test.mjs tests/assets/*.test.mjs tests/content/*.test.mjs >/dev/null 2>&1; then
  node --test tests/linter/ tests/assets/ tests/content/ || fail=1
fi

[ "$fail" -eq 0 ] && echo "ALL TESTS PASSED" || { echo "TESTS FAILED"; exit 1; }
