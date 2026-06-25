#!/usr/bin/env bash
# Tests for the manual board-lint script (T9 — delivery B). It lives in the skill's scripts/ dir
# (skills/orchestrating-to-completion/scripts/board-lint.js — a RUNTIME out-of-band script shipped with
# the skill, 红线5 / Finding #37), is invoked EXPLICITLY by agent/user (so it needs NO armed gate — like
# cc-usage.sh / codex-review.sh), and lints any board path you hand it (or, with no arg, auto-finds the
# single active board in home).
#
# ★T4-3b: the script no longer in-process `require`s a lint core — the whole cli/ is deleted. It now
# shells out to the global `ccm` binary (`ccm board lint --board <path> --raw --json`), the ONE lint
# SSOT (@ccm/engine). Being an EXPLICIT manual script (not a hook), ccm-missing → friendly error rc 2
# (it tells the user "needs ccm"), never silent-degrade. We point CCM_BIN at the dev-bin node shim so
# these assertions run through real ccm; if ccm/dist isn't built we build it (else skip with a note).
#
# CLI contract:
#   node board-lint.js <board-path>     → lint that file
#   node board-lint.js                  → lint the single active board under CC_MASTER_HOME (else error)
#   node board-lint.js --json <path>    → emit structured {errors,warnings} JSON (projected from ccm violations)
# Exit code: 0 = no hard error (may have warnings); 1 = at least one hard error; 2 = usage/IO/ccm-unavailable.
set -uo pipefail

PLUGIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$PLUGIN_ROOT/skills/orchestrating-to-completion/scripts/board-lint.js"

# ── ccm dev-bin shim：让脚本测试真走 ccm 路径（ADR-014·T4-3b）──────────────────────────────────────
# run-tests.sh 已 export CCM_BIN（指向 dev-bin shim·已 build dist）。本测试也可独立跑：CCM_BIN 未设时
# 自指向 shim，dist 缺则尝试 build。无 pnpm / build 失败 → 跳过（ccm 是唯一路径，无它无法测）。
SHIM="$PLUGIN_ROOT/ccm/apps/cli/dev-bin/ccm"
if [ -z "${CCM_BIN:-}" ]; then
  if [ -f "$SHIM" ] && [ -f "$PLUGIN_ROOT/ccm/apps/cli/dist/index.cjs" ]; then
    export CCM_BIN="$SHIM"
  elif [ -f "$SHIM" ] && command -v pnpm >/dev/null 2>&1 && \
       (cd "$PLUGIN_ROOT" && pnpm -C ccm build) >/dev/null 2>&1 && \
       [ -f "$PLUGIN_ROOT/ccm/apps/cli/dist/index.cjs" ]; then
    export CCM_BIN="$SHIM"
  else
    echo "(ccm dist NOT available — board-lint.js needs ccm; skipping test_board-lint.sh)"
    echo "passed=0 failed=0"
    exit 0
  fi
fi
PASS=0; FAILED=0
_red()  { printf '\033[31m%s\033[0m\n' "$1"; }
assert_eq() { if [ "$1" = "$2" ]; then PASS=$((PASS+1)); else FAILED=$((FAILED+1)); _red "FAIL: $3 (expected [$1] got [$2])"; fi; }
assert_contains() { case "$1" in *"$2"*) PASS=$((PASS+1));; *) FAILED=$((FAILED+1)); _red "FAIL: $3 (missing [$2])";; esac; }
assert_not_contains() { case "$1" in *"$2"*) FAILED=$((FAILED+1)); _red "FAIL: $3 (unexpected [$2])";; *) PASS=$((PASS+1));; esac; }
mkproj() { mktemp -d "${TMPDIR:-/tmp}/.tmp-ccm.XXXXXX"; }

GOOD='{"schema":"cc-master/v2","meta":{"template_version":1},"goal":"g","owner":{"active":true,"session_id":"s"},"git":{"worktree":"/w","branch":"b"},"tasks":[{"id":"T0","status":"done","deps":[],"started_at":"2026-06-23T10:00:00Z","finished_at":"2026-06-23T11:00:00Z"},{"id":"T1","status":"ready","deps":["T0"]}]}'

# ── (a) good board → PASS, rc 0, report says PASS ────────────────────────────────────────────────────
D="$(mkproj)"; printf '%s' "$GOOD" > "$D/b.board.json"
OUT="$(node "$SCRIPT" "$D/b.board.json" 2>&1)"; RC=$?
assert_eq 0 "$RC" "(a) good board → rc 0"
assert_contains "$OUT" "PASS" "(a) report says PASS"
rm -rf "$D"

# ── (b) invalid JSON (FMT-JSON) → rc 1, names FMT-JSON, agent-friendly (not a raw stack trace) ──────────────────
D="$(mkproj)"; printf '{"schema":"cc-master/v2","tasks":[{"id":"T0"' > "$D/b.board.json"
OUT="$(node "$SCRIPT" "$D/b.board.json" 2>&1)"; RC=$?
assert_eq 1 "$RC" "(b) invalid JSON → rc 1"
assert_contains "$OUT" "FMT-JSON" "(b) names FMT-JSON (invalid JSON)"
assert_contains "$OUT" "FAIL" "(b) report says FAIL"
assert_not_contains "$OUT" "at Object.<anonymous>" "(b) NOT a raw node stack trace (agent-friendly)"
rm -rf "$D"

# ── (c) dangling dep (GRAPH-DANGLING) + self-loop (GRAPH-SELFLOOP) + cycle (GRAPH-CYCLE) → rc 1, deps-graph rules named ────────────
D="$(mkproj)"
printf '%s' '{"schema":"cc-master/v2","goal":"g","owner":{"active":true,"session_id":"s"},"git":{"worktree":"","branch":""},"tasks":[{"id":"T7","status":"ready","deps":["GONE"]},{"id":"S","status":"ready","deps":["S"]},{"id":"A","status":"ready","deps":["B"]},{"id":"B","status":"ready","deps":["A"]}]}' > "$D/b.board.json"
OUT="$(node "$SCRIPT" "$D/b.board.json" 2>&1)"; RC=$?
assert_eq 1 "$RC" "(c) deps-graph errors → rc 1"
assert_contains "$OUT" "GRAPH-DANGLING" "(c) names dangling-dep (GRAPH-DANGLING)"
assert_contains "$OUT" "GRAPH-SELFLOOP" "(c) names self-loop (GRAPH-SELFLOOP)"
assert_contains "$OUT" "GRAPH-CYCLE" "(c) names cycle (GRAPH-CYCLE)"
rm -rf "$D"

# ── (d) duplicate id (FMT-ID-UNIQUE) + missing status (FMT-ID/FMT-STATUS) → rc 1 ─────────────────────────────────────────
D="$(mkproj)"
printf '%s' '{"schema":"cc-master/v2","goal":"g","owner":{"active":true,"session_id":"s"},"git":{"worktree":"","branch":""},"tasks":[{"id":"T0","status":"done","deps":[]},{"id":"T0","status":"ready","deps":[]},{"id":"T2","deps":[]}]}' > "$D/b.board.json"
OUT="$(node "$SCRIPT" "$D/b.board.json" 2>&1)"; RC=$?
assert_eq 1 "$RC" "(d) dup id + missing status → rc 1"
assert_contains "$OUT" "FMT-ID-UNIQUE" "(d) names duplicate-id (FMT-ID-UNIQUE)"
rm -rf "$D"

# ── (d2) missing deps (FMT-DEPS) → rc 1 — deps is a required waist field, not optional (codex P2-A) ───────
D="$(mkproj)"
printf '%s' '{"schema":"cc-master/v2","goal":"g","owner":{"active":true,"session_id":"s"},"git":{"worktree":"","branch":""},"tasks":[{"id":"T0","status":"done","deps":[]},{"id":"T1","status":"ready"}]}' > "$D/b.board.json"
OUT="$(node "$SCRIPT" "$D/b.board.json" 2>&1)"; RC=$?
assert_eq 1 "$RC" "(d2) task missing deps → rc 1 (required waist field)"
assert_contains "$OUT" "FMT-DEPS" "(d2) names the missing-deps rule (FMT-DEPS)"
assert_contains "$OUT" "T1" "(d2) names the offending task (T1)"
rm -rf "$D"

# ── (e) warn-only (FMT-BLOCKED-ON dangling blocked_on) → rc 0 (warnings don't fail), report PASS + warning ─────
D="$(mkproj)"
printf '%s' '{"schema":"cc-master/v2","goal":"g","owner":{"active":true,"session_id":"s"},"git":{"worktree":"","branch":""},"tasks":[{"id":"T9","status":"blocked","deps":[],"blocked_on":"T8"}]}' > "$D/b.board.json"
OUT="$(node "$SCRIPT" "$D/b.board.json" 2>&1)"; RC=$?
assert_eq 0 "$RC" "(e) warn-only → rc 0 (warnings don't fail the lint)"
assert_contains "$OUT" "FMT-BLOCKED-ON" "(e) warns on dangling blocked_on (FMT-BLOCKED-ON)"
rm -rf "$D"

# ── (f) agent-shaped custom fields → PASS silently (红线2: never a second waist) ──────────────────────
D="$(mkproj)"
printf '%s' '{"schema":"cc-master/v2","goal":"g","owner":{"active":true,"session_id":"s"},"git":{"worktree":"","branch":""},"invented":1,"tasks":[{"id":"T0","status":"done","deps":[],"my_field":"free","handle":"bg-1"}]}' > "$D/b.board.json"
OUT="$(node "$SCRIPT" "$D/b.board.json" 2>&1)"; RC=$?
assert_eq 0 "$RC" "(f) agent custom fields → rc 0"
assert_contains "$OUT" "PASS" "(f) custom fields don't trip the lint"
rm -rf "$D"

# ── (g) no-arg → auto-find the single active board under CC_MASTER_HOME ──────────────────────────────
D="$(mkproj)"; printf '%s' "$GOOD" > "$D/only.board.json"
OUT="$(CC_MASTER_HOME="$D" node "$SCRIPT" 2>&1)"; RC=$?
assert_eq 0 "$RC" "(g) no-arg single active board → rc 0"
assert_contains "$OUT" "PASS" "(g) auto-found the one active board and linted it"
rm -rf "$D"

# ── (g2) no-arg with MULTIPLE active boards → usage error rc 2, tells user to pass a path ───────────
D="$(mkproj)"; printf '%s' "$GOOD" > "$D/a.board.json"; printf '%s' "$GOOD" > "$D/b.board.json"
OUT="$(CC_MASTER_HOME="$D" node "$SCRIPT" 2>&1)"; RC=$?
assert_eq 2 "$RC" "(g2) multiple active boards no-arg → rc 2 (usage)"
assert_contains "$OUT" "board" "(g2) message mentions board (asks for an explicit path)"
rm -rf "$D"

# ── (h) --json → structured output parses + has errors/warnings keys; exit reflects hard errors ─────
D="$(mkproj)"; printf '{"schema":"cc-master/v2","tasks":99}' > "$D/b.board.json"
OUT="$(node "$SCRIPT" --json "$D/b.board.json" 2>&1)"; RC=$?
assert_eq 1 "$RC" "(h) --json with hard error → rc 1"
echo "$OUT" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const o=JSON.parse(s);if(Array.isArray(o.errors)&&Array.isArray(o.warnings)&&o.errors.length>0)process.exit(0);process.exit(1)})' \
  && PASS=$((PASS+1)) || { FAILED=$((FAILED+1)); _red "FAIL: (h) --json emits {errors:[...],warnings:[...]} with a hard error"; }
rm -rf "$D"

# ── (i) missing file path → usage/IO error rc 2 (not a crash) ───────────────────────────────────────
OUT="$(node "$SCRIPT" /nonexistent/nope.board.json 2>&1)"; RC=$?
assert_eq 2 "$RC" "(i) missing file → rc 2 (IO error, not a crash)"
assert_not_contains "$OUT" "ENOENT" "(i) IO error is reported agent-friendly, not a raw ENOENT throw"

# ── (j) explicit path works even on an ARCHIVED board (manual script has no armed gate) ─────────────
D="$(mkproj)"
printf '%s' '{"schema":"cc-master/v2","goal":"g","owner":{"active":false,"session_id":"s"},"git":{"worktree":"","branch":""},"tasks":[{"id":"T0","status":"ready","deps":["GONE"]}]}' > "$D/arch.board.json"
OUT="$(node "$SCRIPT" "$D/arch.board.json" 2>&1)"; RC=$?
assert_eq 1 "$RC" "(j) explicit archived board with dangling dep → rc 1 (no armed gate; lints any path)"
assert_contains "$OUT" "GRAPH-DANGLING" "(j) lints archived board too (manual = explicit, unconditional)"
rm -rf "$D"

echo "passed=$PASS failed=$FAILED"; [ "$FAILED" -eq 0 ] || exit 1
