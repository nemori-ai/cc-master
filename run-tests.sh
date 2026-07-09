#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

# Suite-level temp sweep: reap STALE leaked .tmp-ccm.* dirs from helpers.sh's make_project
# (template "${TMPDIR:-/tmp}/.tmp-ccm.XXXXXX"). Run at startup + via trap EXIT.
# AGE-FILTERED (mtime >60min) ON PURPOSE: a blanket `rm -rf ${TMPDIR}/.tmp-ccm.*` would delete
# the LIVE CC_MASTER_HOME / project dirs that a CONCURRENT `bash run-tests.sh` (or the repo's own
# concurrent-isolation tests) created seconds ago — one run's startup sweep, or an earlier-finishing
# run's EXIT trap, would yank another in-flight suite's active temp mid-test and REINTRODUCE flaky
# failures (codex second-endpoint review catch). No suite run lasts 60min, so anything older than
# that is abandoned backlog, never an active run. The source fix (run_resume/run_resume_nosid now
# rm -rf their own dirs) already prevents new leaks; this only reaps pre-existing stale backlog.
# Scoped strictly to the .tmp-ccm.* prefix at depth 1; errors swallowed (glob/empty-dir safe).
sweep_ccm_tmp() {
  find "${TMPDIR:-/tmp}" -maxdepth 1 -type d -name '.tmp-ccm.*' -mmin +60 \
    -exec rm -rf {} + 2>/dev/null || true
}
sweep_ccm_tmp
trap sweep_ccm_tmp EXIT

# ── ccm dev-bin shim：让 hook 测试**真走 ccm 路径**（ADR-014 解耦·T4-1b）────────────────────────────
# 两个 node hook（board-lint / verify-board）首选经进程边界 shell 调全局 `ccm` 二进制读 board，失败才退回
# require 旧 cli/。生产环境 `ccm` 在 PATH；本仓 dev/test 经 CCM_BIN 指向一个 node-bin shim
# （ccm/apps/cli/dev-bin/ccm — exec node bin/ccm.cjs，免每次重建 135MB SEA·T3 已证二进制≡node bin）。
# 故先 `pnpm -C ccm build` 出 dist（turbo 链 engine→cli），再 export CCM_BIN——使 hook 测试走真 ccm 路径
# 而非 fallback。构建/找不到 pnpm 时**软失败、不中断**：CCM_BIN 不设 → hook 自动退回 require fallback
# （仍全绿·已证字节级等价），让无 node toolchain 的环境照样跑完套件（CI/release 才在 SEA 上测真二进制）。
CCM_SHIM="$PWD/ccm/apps/cli/dev-bin/ccm"
if command -v pnpm >/dev/null 2>&1 && [ -f "$CCM_SHIM" ]; then
  echo "== building ccm dist (so hook tests run through real ccm path) =="
  if pnpm -C ccm build >/dev/null 2>&1 && [ -f ccm/apps/cli/dist/index.cjs ]; then
    export CCM_BIN="$CCM_SHIM"
    echo "   CCM_BIN=$CCM_BIN"
  else
    echo "   ccm build skipped/failed — hook tests fall back to require path (still green)"
  fi
else
  echo "== ccm dist build skipped (no pnpm / no shim) — hook tests use require fallback path =="
fi

# ── Disable ccm's no-touch status-line auto-install for the whole suite (0.10.0) ────────────────────
# `ccm statusline` auto-installs itself into <claudeConfigDir>/settings.json on the first NON-statusline
# ccm invocation. Hook/script tests spawn the real `ccm` (via CCM_BIN) WITHOUT pinning CLAUDE_CONFIG_DIR,
# so an un-gated auto-install would mutate the developer's REAL ~/.claude/settings.json mid-suite. The
# kill-switch makes every suite ccm spawn skip auto-install (the behavior itself is covered by the ccm
# engine/CLI tests against temp config dirs). Exported → inherited by all hook/script subprocess ccm calls.
export CC_MASTER_NO_AUTOINSTALL=1

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

echo "== codex project skill projection =="
bash scripts/sync-codex-skills.sh --check || fail=1

echo "== codex runtime skill adapter projection =="
bash scripts/sync-plugin-dist.sh --host codex --skills-only || fail=1

echo "== hook parity matrix sync (HOOKPAR-DEC / ADR-028) =="
bash scripts/gen-hook-parity-matrix.sh --check || fail=1

echo "== capability parity matrix sync (ADR-031) =="
bash scripts/gen-capability-parity-matrix.sh --check || fail=1

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
