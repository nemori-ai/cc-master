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

echo "== script tests (bash) =="
for t in tests/scripts/test_*.sh; do
  [ -e "$t" ] || continue
  echo "--- $t"
  bash "$t" || fail=1
done

echo "== skill prose-lint (out-of-band, node) =="
# Cheap static checks over every SKILL.md: frontmatter quote anti-pattern (Finding #1),
# required name+description fields, and dead relative links. Checker only — never edits.
echo "--- scripts/skill-lint.sh"
bash scripts/skill-lint.sh || fail=1

echo "== node tests (content) =="
# Node 22+ treats `--test` path args as test files/globs, NOT discovery dirs (a bare dir is
# read as a module to execute and errors). So enumerate explicit test files via find — this
# is version-stable (Node 18-26) and avoids the "all three dirs must exist" fragility of a
# multi-glob `ls`. Our paths contain no spaces, so the unquoted expansion is intentional.
node_tests=$(find tests -name '*.test.mjs' 2>/dev/null | sort)
if [ -n "$node_tests" ]; then
  # shellcheck disable=SC2086
  node --test $node_tests || fail=1
fi

[ "$fail" -eq 0 ] && echo "ALL TESTS PASSED" || { echo "TESTS FAILED"; exit 1; }
