#!/usr/bin/env bash
# test_hook-ccm-decoupling.sh — T4-1b·ADR-014：board-lint.js / verify-board.js 从「in-process require board
# 引擎」解耦为「进程边界 shell 调 ccm 二进制 + JSON」后的**三态**契约门。每个 hook 三态各验：
#   ① ccm 可用（CCM_BIN 指向 dev-bin shim）→ 走 ccm 路径（board-lint 注入 report、verify-board rollup 来自 ccm）。
#   ② CCM_BIN 指向不存在的可执行 → spawn ENOENT → 退回 require fallback、行为与今一致（与 ① 字节级等价）。
#   ③ ccm 缺 ∧ require fallback 也不可用（模拟 board-lint-core / board-model require 抛）→ 优雅降级不 crash。
#
# 与 test_board-lint.sh / test_verify-board.sh 互补：那两份在 run-tests 注入的 CCM_BIN 下跑（默认态）；本份
# **自己控制 CCM_BIN 三态**，确证 fallback / 降级两条安全路径真存在（端点验收：闸绿≠真过，三态都要真喂 stdin）。
#
# 红线1/ADR-006：node/JS only（spawn ccm 二进制是 ADR-014 许可的进程边界，非 import 引擎）。
# 红线6：所有用例都 ARMED（本 session owner.active:true + session_id 匹配）——三态只关 ccm/fallback 切换，
#   不碰武装闸（武装闸不变由 test_board-lint / test_verify-board 守）。
. "$(dirname "$0")/helpers.sh"

LINT_HOOK="$PLUGIN_ROOT/hooks/scripts/board-lint.js"
VERIFY_HOOK="$PLUGIN_ROOT/hooks/scripts/verify-board.js"
SHIM="$PLUGIN_ROOT/ccm/apps/cli/dev-bin/ccm"

# 确保 ccm dist 在（shim exec node bin/ccm.cjs→dist/index.cjs）。run-tests 已 build 过则复用；否则本测试 build。
# pnpm / dist 不可得 → CCM_HAVE=0（state ① 跳过、只跑 fallback/降级两态，仍是有效覆盖）。
CCM_HAVE=0
if [ -f "$SHIM" ] && [ -f "$PLUGIN_ROOT/ccm/apps/cli/dist/index.cjs" ]; then
  CCM_HAVE=1
elif [ -f "$SHIM" ] && command -v pnpm >/dev/null 2>&1; then
  if (cd "$PLUGIN_ROOT" && pnpm -C ccm build) >/dev/null 2>&1 && [ -f "$PLUGIN_ROOT/ccm/apps/cli/dist/index.cjs" ]; then
    CCM_HAVE=1
  fi
fi
[ "$CCM_HAVE" -eq 1 ] && echo "(ccm dist available — state ① runs through real ccm)" \
                      || echo "(ccm dist NOT available — state ① skipped, fallback/degrade still tested)"

NOPE="/no/such/ccm-binary-$$"   # 不存在的可执行 → spawn ENOENT → fallback

# A good armed board owned by sess-x (used as arming board where needed).
GOOD='{"schema":"cc-master/v2","goal":"g","owner":{"active":true,"session_id":"sess-x"},"git":{"worktree":"/w","branch":"b"},"tasks":[{"id":"T0","status":"done","deps":[],"started_at":"2026-06-23T10:00:00Z","finished_at":"2026-06-23T11:00:00Z"},{"id":"T1","status":"ready","deps":["T0"]}]}'
# A board with a hard error (dangling dep) — board-lint must report it.
BADLINT='{"schema":"cc-master/v2","goal":"g","owner":{"active":true,"session_id":"sess-x"},"git":{"worktree":"","branch":""},"tasks":[{"id":"T7","status":"ready","deps":["GONE"]}]}'
# A rollup-inconsistent board (done owner M1 + in_flight child M1.b) — verify-board completion handshake names it.
ROLLUP='{"schema":"cc-master/v2","goal":"g","owner":{"active":true,"session_id":"sess-rb"},"git":{"worktree":"","branch":""},"tasks":[{"id":"M1","status":"done","deps":[]},{"id":"M1.a","status":"done","deps":[],"parent":"M1"},{"id":"M1.b","status":"in_flight","deps":[],"parent":"M1"}]}'

# run_lint CCM_BIN_VAL HOME TARGET SID — drive board-lint PostToolUse stdin; sets HOOK_OUT/HOOK_RC.
run_lint() {
  HOOK_OUT="$(printf '{"session_id":"%s","hook_event_name":"PostToolUse","tool_name":"Write","tool_input":{"file_path":"%s"}}' "$4" "$3" \
    | CCM_BIN="$1" CC_MASTER_HOME="$2" node "$LINT_HOOK" 2>/dev/null)"; HOOK_RC=$?
}
# run_verify CCM_BIN_VAL HOME SID — drive verify-board Stop stdin; sets HOOK_OUT/HOOK_RC. Fresh home → no stale sidecar.
run_verify() {
  HOOK_OUT="$(printf '{"session_id":"%s","hook_event_name":"Stop"}' "$3" \
    | CCM_BIN="$1" CC_MASTER_HOME="$2" node "$VERIFY_HOOK" 2>/dev/null)"; HOOK_RC=$?
}
# A node harness that makes ALL require() of a given basename throw — to simulate fallback unavailable (state ③).
# Non-destructive: never moves/deletes the real cli/ files (deletion is stage3).
DEGRADE_HARNESS="$(make_project)/degrade.cjs"
cat > "$DEGRADE_HARNESS" <<'EOF'
'use strict';
const Module = require('module');
const orig = Module._load;
const block = process.env.BLOCK_MODULE || '';
Module._load = function (request) {
  if (block && typeof request === 'string' && request.includes(block)) {
    const e = new Error('SIMULATED unavailable: ' + request); e.code = 'MODULE_NOT_FOUND'; throw e;
  }
  return orig.apply(this, arguments);
};
require(process.argv[2]);
EOF
# run_degraded HOOK STDIN HOME SID BLOCK — run HOOK under the degrade harness with CCM_BIN bogus + BLOCK_MODULE set.
run_degraded() {
  HOOK_OUT="$(printf '%s' "$2" \
    | CCM_BIN="$NOPE" CC_MASTER_HOME="$3" BLOCK_MODULE="$5" node "$DEGRADE_HARNESS" "$1" 2>/dev/null)"; HOOK_RC=$?
}

# ════════════════════════════════════ board-lint.js ════════════════════════════════════
# ── ① ccm path: armed + bad target → report injected (sourced from ccm) ──────────────────────────────
if [ "$CCM_HAVE" -eq 1 ]; then
  H="$(make_project)"; printf '%s' "$GOOD" > "$H/armed.board.json"; printf '%s' "$BADLINT" > "$H/bad.board.json"
  run_lint "$SHIM" "$H" "$H/bad.board.json" "sess-x"
  assert_eq 0 "$HOOK_RC" "lint①(ccm) rc 0"
  assert_contains "$HOOK_OUT" "additionalContext" "lint①(ccm) injects additionalContext"
  assert_contains "$HOOK_OUT" "GRAPH-DANGLING" "lint①(ccm) report names the rule (via ccm)"
  assert_contains "$HOOK_OUT" '"hookEventName":"PostToolUse"' "lint①(ccm) PostToolUse envelope"
  assert_not_contains "$HOOK_OUT" '"decision":"block"' "lint①(ccm) never blocks"
  assert_valid_json "$HOOK_OUT" "lint①(ccm) envelope valid JSON"
  CCM_OUT="$HOOK_OUT"
  rm -rf "$H"
fi

# ── ② fallback path: CCM_BIN bogus → ENOENT → require fallback → report still injected ────────────────
H="$(make_project)"; printf '%s' "$GOOD" > "$H/armed.board.json"; printf '%s' "$BADLINT" > "$H/bad.board.json"
run_lint "$NOPE" "$H" "$H/bad.board.json" "sess-x"
assert_eq 0 "$HOOK_RC" "lint②(fallback) rc 0"
assert_contains "$HOOK_OUT" "additionalContext" "lint②(fallback) injects additionalContext"
assert_contains "$HOOK_OUT" "GRAPH-DANGLING" "lint②(fallback) report names the rule (via require)"
assert_not_contains "$HOOK_OUT" '"decision":"block"' "lint②(fallback) never blocks"
assert_valid_json "$HOOK_OUT" "lint②(fallback) envelope valid JSON"
# ②≡① equivalence (only when ccm ran): ccm-path and fallback-path output must be byte-identical.
[ "$CCM_HAVE" -eq 1 ] && assert_eq "$CCM_OUT" "$HOOK_OUT" "lint②≡① ccm path == require fallback (byte-identical)"
rm -rf "$H"

# ── ③ graceful degrade: ccm missing ∧ board-lint-core require unavailable → silent (empty out, rc 0) ──
H="$(make_project)"; printf '%s' "$GOOD" > "$H/armed.board.json"; printf '%s' "$BADLINT" > "$H/bad.board.json"
LINT_STDIN="$(printf '{"session_id":"sess-x","hook_event_name":"PostToolUse","tool_name":"Write","tool_input":{"file_path":"%s"}}' "$H/bad.board.json")"
run_degraded "$LINT_HOOK" "$LINT_STDIN" "$H" "sess-x" "board-lint-core.js"
assert_eq 0 "$HOOK_RC" "lint③(degrade) rc 0 (never crashes)"
assert_eq "" "$HOOK_OUT" "lint③(degrade) ccm+fallback both gone → silent (hook never pollutes agent stream)"
rm -rf "$H"

# ════════════════════════════════════ verify-board.js ═══════════════════════════════════
# ── ① ccm path: rollup-inconsistent → completion handshake names rollup (sourced from ccm) ───────────
if [ "$CCM_HAVE" -eq 1 ]; then
  H="$(make_project)"; printf '%s' "$ROLLUP" > "$H/b1.board.json"
  run_verify "$SHIM" "$H" "sess-rb"
  assert_eq 0 "$HOOK_RC" "verify①(ccm) rc 0"
  assert_contains "$HOOK_OUT" '"decision":"block"' "verify①(ccm) completion handshake blocks"
  assert_contains "$HOOK_OUT" "Rollup inconsistency" "verify①(ccm) rollup reminder injected (via ccm)"
  assert_contains "$HOOK_OUT" "owner M1 is" "verify①(ccm) names offending owner M1"
  assert_contains "$HOOK_OUT" "child M1.b is" "verify①(ccm) names non-done child M1.b"
  assert_valid_json "$HOOK_OUT" "verify①(ccm) envelope valid JSON"
  VCCM_OUT="$HOOK_OUT"
  rm -rf "$H"
fi

# ── ② fallback path: CCM_BIN bogus → require board-model + inline rollup loop → same rollup strings ───
H="$(make_project)"; printf '%s' "$ROLLUP" > "$H/b1.board.json"
run_verify "$NOPE" "$H" "sess-rb"
assert_eq 0 "$HOOK_RC" "verify②(fallback) rc 0"
assert_contains "$HOOK_OUT" '"decision":"block"' "verify②(fallback) completion handshake blocks"
assert_contains "$HOOK_OUT" "Rollup inconsistency" "verify②(fallback) rollup reminder via require"
assert_contains "$HOOK_OUT" "owner M1 is" "verify②(fallback) names owner M1"
assert_contains "$HOOK_OUT" "child M1.b is" "verify②(fallback) names child M1.b"
assert_valid_json "$HOOK_OUT" "verify②(fallback) envelope valid JSON"
[ "$CCM_HAVE" -eq 1 ] && assert_eq "$VCCM_OUT" "$HOOK_OUT" "verify②≡① ccm path == require fallback (byte-identical)"
rm -rf "$H"

# ── ③ graceful degrade: ccm missing ∧ board-model require unavailable → rollup skipped, gate still runs ─
H="$(make_project)"; printf '%s' "$ROLLUP" > "$H/b1.board.json"
VERIFY_STDIN='{"session_id":"sess-rb","hook_event_name":"Stop"}'
run_degraded "$VERIFY_HOOK" "$VERIFY_STDIN" "$H" "sess-rb" "board-model.js"
assert_eq 0 "$HOOK_RC" "verify③(degrade) rc 0 (never crashes)"
assert_contains "$HOOK_OUT" '"decision":"block"' "verify③(degrade) rest of Stop gate still BLOCKS (handshake runs)"
assert_contains "$HOOK_OUT" "self-check" "verify③(degrade) self-check handshake intact"
assert_not_contains "$HOOK_OUT" "Rollup inconsistency" "verify③(degrade) rollup part skipped (no crash)"
rm -rf "$H"

finish
