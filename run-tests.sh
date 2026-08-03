#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

# ── 分层（issue #213）─────────────────────────────────────────────────────────────────────────────
#   (no flag)  全套 —— 与分层引入之前的行为逐字节等价，本地端点门 / 发版门用它。
#   --fast     跳过 tests/heavy-tests.txt 登记的重型 content 测试，其余全跑（含全部 hook / script
#              测试——它们即使慢也留在快门里，因为测的是运行时核心行为）。这一层进每 PR CI。
#   --heavy    只跑清单里那些。nightly 用它。
#   --quarantine  只跑 tests/quarantine.txt 登记的已知失败，并做**反向检查**：任何一个变绿了
#              却还留在清单上就是硬错误。这保证隔离清单只许变短。nightly 每天执行。
#   --list     只打印本次会选中的单元后退出（用来证明三层的选中集合，不真跑）。
# 分层的理由与收录判据见 tests/heavy-tests.txt 卷首；隔离的门槛见 tests/quarantine.txt 卷首。
MODE=all
LIST_ONLY=0
for arg in "$@"; do
  case "$arg" in
    --fast) MODE=fast ;;
    --heavy) MODE=heavy ;;
    --quarantine) MODE=quarantine ;;
    --list) LIST_ONLY=1 ;;
    -h|--help)
      sed -n '5,15p' "$0"
      exit 0
      ;;
    *)
      echo "run-tests.sh: unknown argument '$arg' (expected --fast | --heavy | --quarantine | --list)" >&2
      exit 2
      ;;
  esac
done

HEAVY_LIST=tests/heavy-tests.txt
if [ ! -f "$HEAVY_LIST" ]; then
  echo "run-tests.sh: missing $HEAVY_LIST (the heavy-test registry is part of the contract)" >&2
  exit 2
fi
# 清单格式：`#` 注释行 / 空行忽略；每行取第一个 TAB 之前的文件名（basename）。
heavy_names=$(sed -e 's/#.*$//' "$HEAVY_LIST" | cut -f1 | sed -e 's/[[:space:]]*$//' -e '/^$/d')

all_node_tests=$(find tests -name '*.test.mjs' 2>/dev/null | sort)

# 防清单腐烂：清单里列了但仓库里不存在的文件名 = 硬错误。反之（仓库里有、清单没列）不报错，
# 那些自然落入快层。
missing=""
heavy_node_tests=""
while IFS= read -r name; do
  [ -n "$name" ] || continue
  hit=$(printf '%s\n' "$all_node_tests" | awk -F/ -v n="$name" '$NF == n')
  if [ -z "$hit" ]; then
    missing="${missing}  - ${name}"$'\n'
  else
    heavy_node_tests="${heavy_node_tests}${hit}"$'\n'
  fi
done <<< "$heavy_names"
if [ -n "$missing" ]; then
  echo "run-tests.sh: $HEAVY_LIST lists test files that do not exist in the repo:" >&2
  printf '%s' "$missing" >&2
  echo "Fix the registry (a rotten list silently un-gates tests)." >&2
  exit 2
fi
heavy_node_tests=$(printf '%s' "$heavy_node_tests" | sed '/^$/d' | sort)

# ── 隔离清单（已知失败）─────────────────────────────────────────────────────────────────────
# 与 heavy 清单同样的腐烂防护：列了却不存在 = 硬错误。语义区别见 tests/quarantine.txt 卷首
# （heavy 收「慢」，quarantine 收「红」）。两个清单不许重叠——一个文件不能既因慢被推迟、
# 又因红被隔离，那会让它从任何一层都跑不到。
QUARANTINE_LIST=tests/quarantine.txt
if [ ! -f "$QUARANTINE_LIST" ]; then
  echo "run-tests.sh: missing $QUARANTINE_LIST (the quarantine registry is part of the contract)" >&2
  exit 2
fi
quarantine_names=$(sed -e 's/#.*$//' "$QUARANTINE_LIST" | cut -f1 | sed -e 's/[[:space:]]*$//' -e '/^$/d')
q_missing=""
quarantine_node_tests=""
while IFS= read -r name; do
  [ -n "$name" ] || continue
  hit=$(printf '%s\n' "$all_node_tests" | awk -F/ -v n="$name" '$NF == n')
  if [ -z "$hit" ]; then
    q_missing="${q_missing}  - ${name}"$'\n'
  else
    quarantine_node_tests="${quarantine_node_tests}${hit}"$'\n'
  fi
done <<< "$quarantine_names"
if [ -n "$q_missing" ]; then
  echo "run-tests.sh: $QUARANTINE_LIST lists test files that do not exist in the repo:" >&2
  printf '%s' "$q_missing" >&2
  echo "Fix the registry (a rotten list silently un-gates tests)." >&2
  exit 2
fi
quarantine_node_tests=$(printf '%s' "$quarantine_node_tests" | sed '/^$/d' | sort)

overlap=$(comm -12 <(printf '%s\n' "$heavy_node_tests") <(printf '%s\n' "$quarantine_node_tests") | sed '/^$/d')
if [ -n "$overlap" ]; then
  echo "run-tests.sh: these files are in BOTH the heavy and quarantine registries:" >&2
  printf '  - %s\n' $overlap >&2
  echo "Pick one — otherwise no layer ever runs them." >&2
  exit 2
fi

quarantine_count=$(printf '%s\n' "$quarantine_node_tests" | sed '/^$/d' | wc -l | tr -d ' ')

case "$MODE" in
  # `all` 也排除隔离项：否则本地端点门永远红，AGENTS.md 承诺的 ALL TESTS PASSED 永远拿不到。
  # 代价是「全套」不再字面等于「全部文件」——所以收尾行必须打印隔离数，不许悄悄少跑。
  all)        selected_node_tests=$(comm -23 <(printf '%s\n' "$all_node_tests") <(printf '%s\n' "$quarantine_node_tests")) ;;
  heavy)      selected_node_tests="$heavy_node_tests" ;;
  quarantine) selected_node_tests="$quarantine_node_tests" ;;
  fast)       selected_node_tests=$(comm -23 <(printf '%s\n' "$all_node_tests") <(printf '%s\n' "$heavy_node_tests" "$quarantine_node_tests" | sort -u)) ;;
esac

# 非 node 的段（hook / script / 投影与矩阵检查 / skill-lint）属于快层；--heavy 只跑清单里的 content 测试。
if [ "$MODE" = heavy ] || [ "$MODE" = quarantine ]; then
  run_fast_sections=0
else
  run_fast_sections=1
fi

if [ "$LIST_ONLY" -eq 1 ]; then
  echo "mode: $MODE"
  if [ "$run_fast_sections" -eq 1 ]; then
    for t in tests/hooks/test_*.sh tests/scripts/test_*.sh; do
      if [ -e "$t" ]; then echo "$t"; fi
    done
    echo "scripts/sync-codex-skills.sh --check"
    echo "scripts/gen-hook-parity-matrix.sh --check"
    echo "scripts/gen-capability-parity-matrix.sh --check"
    echo "scripts/skill-lint.sh"
  fi
  printf '%s\n' "$selected_node_tests" | sed '/^$/d'
  echo "-- node test files selected: $(printf '%s\n' "$selected_node_tests" | sed '/^$/d' | wc -l)"
  exit 0
fi

# Suite env hygiene: orchestration sessions may export CC_MASTER_HOME / CC_MASTER_BOARD into the
# parent shell. Tests pin their own homes via run_hook; a stale CC_MASTER_BOARD makes `ccm board init`
# target the live board instead of the isolated temp home (bootstrap-board regressions).
unset CC_MASTER_BOARD CC_MASTER_HOME 2>/dev/null || true

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

if [ "$run_fast_sections" -eq 1 ]; then

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

# NOTE(2026-07-31): a `sync-plugin-dist.sh --host codex --skills-only` step used to sit here.
# It was removed, for two independent reasons:
#   1. It was not a test. That script has no --check mode; it *performs* the projection, writing
#      plugin/dist and taking a lock under plugin/dist/.codex.trusted-projection.lock/. A test
#      suite that mutates the tree it is testing can invalidate its own later assertions, and it
#      collides with any concurrent projection.
#   2. It was strictly redundant. Gate 2 (scripts/check-plugin-dist-sync.sh) already projects all
#      four hosts in full and fails on any resulting diff — codex --skills-only is a subset of it.
# Measured cost of the removed line alone: >10 minutes. The three gates now have disjoint jobs —
# this one tests behaviour and content contracts and never writes plugin/dist; gate 2 owns
# projection sync; gate 3 (claude plugin validate) owns artifact validity.

echo "== hook parity matrix sync (HOOKPAR-DEC / ADR-028) =="
bash scripts/gen-hook-parity-matrix.sh --check || fail=1

echo "== capability parity matrix sync (ADR-031) =="
bash scripts/gen-capability-parity-matrix.sh --check || fail=1

echo "== skill prose-lint (out-of-band, node) =="
# Cheap static checks over every SKILL.md: frontmatter quote anti-pattern (Finding #1),
# required name+description fields, and dead relative links. Checker only — never edits.
echo "--- scripts/skill-lint.sh"
bash scripts/skill-lint.sh || fail=1

fi  # run_fast_sections

echo "== node tests (content) — layer: $MODE =="
# Node 22+ treats `--test` path args as test files/globs, NOT discovery dirs (a bare dir is
# read as a module to execute and errors). So enumerate explicit test files via find — this
# is version-stable (Node 18-26) and avoids the "all three dirs must exist" fragility of a
# multi-glob `ls`. Our paths contain no spaces, so the unquoted expansion is intentional.
node_tests="$selected_node_tests"
if [ "$MODE" = quarantine ]; then
  # 反向检查：逐个跑，找**已经变绿却还留在清单上**的。这是隔离清单不会烂成垃圾桶的唯一保证——
  # 没有它，一条债还清了也没人知道，清单只会越来越长。所以「通过」在这里才是错误信号。
  echo "== quarantine reverse-check (a PASS here means the entry must be removed) =="
  recovered=""
  still_red=0
  while IFS= read -r t; do
    [ -n "$t" ] || continue
    if node --test "$t" >/dev/null 2>&1; then
      echo "--- $t  RECOVERED"
      recovered="${recovered}  - $(basename "$t")"$'\n'
    else
      echo "--- $t  still red"
      still_red=$((still_red + 1))
    fi
  done <<< "$node_tests"
  if [ -n "$recovered" ]; then
    echo "run-tests.sh: these quarantined tests now pass — delete their lines from $QUARANTINE_LIST:" >&2
    printf '%s' "$recovered" >&2
    fail=1
  fi
  echo "== quarantine: ${still_red} still red, $(printf '%s' "$recovered" | grep -c . || true) recovered =="
elif [ -n "$node_tests" ]; then
  # shellcheck disable=SC2086
  node --test $node_tests || fail=1
fi

# 收尾行按层区分——否则看日志分不清跑的是哪一层（谎报覆盖面）。隔离数一律写进收尾行：
# 少跑了东西还打印「全部通过」，就是把这套分层变成新的谎。
q_note=""
[ "$quarantine_count" -gt 0 ] && q_note=" · ${quarantine_count} quarantined (tests/quarantine.txt)"
case "$MODE" in
  all)        pass_line="ALL TESTS PASSED${q_note}" ;;
  fast)       pass_line="FAST TESTS PASSED (heavy layer skipped — see tests/heavy-tests.txt; nightly runs it)${q_note}" ;;
  heavy)      pass_line="HEAVY TESTS PASSED (heavy layer only — fast layer not run)" ;;
  quarantine) pass_line="QUARANTINE UNCHANGED (every entry still red — registry is accurate)" ;;
esac
case "$MODE" in
  all)        fail_line="TESTS FAILED" ;;
  fast)       fail_line="FAST TESTS FAILED" ;;
  heavy)      fail_line="HEAVY TESTS FAILED" ;;
  quarantine) fail_line="QUARANTINE REGISTRY STALE — remove the recovered entries listed above" ;;
esac

[ "$fail" -eq 0 ] && echo "$pass_line" || { echo "$fail_line"; exit 1; }
