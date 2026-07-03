#!/usr/bin/env bash
# test_hook-ccm-decoupling.sh — T4-3b·ADR-014：board-lint.js / verify-board.js 经「进程边界 shell 调 ccm
# 二进制 + JSON」访问 board（cli/ 已删·无 require fallback）后的**两态**契约门。每个 hook 两态各验：
#   ① ccm 可用（CCM_BIN 指向 dev-bin shim）→ 走 ccm 路径（board-lint 注入 report、verify-board rollup 来自 ccm）。
#   ② ccm 不可用（CCM_BIN 指向不存在的可执行 → spawn ENOENT）→ **优雅降级**：board-lint 静默 exit0、
#      verify-board 跳过 rollup 段但其余 Stop gate（self-check 握手）照常 block——绝不 crash、绝不污染 agent 流。
#
# ★3b 与 1b 的差异：1b 测三态（含「fallback：ccm 缺 → require 旧 cli」），3b 删 cli/ 后 fallback 态不存在。
#   现在「ccm 缺」直接降级（lint 静默 / verify 跳 rollup），不再有「退回 in-process 引擎」这一中间态。
#
# 与 test_board-lint.sh / test_verify-board.sh 互补：那两份在 run-tests 注入的 CCM_BIN 下跑（默认 ccm 态）；
# 本份**自己控制 CCM_BIN 两态**，确证降级安全路径真存在（端点验收：闸绿≠真过，两态都要真喂 stdin）。
#
# 红线1/ADR-006：node/JS only（spawn ccm 二进制是 ADR-014 许可的进程边界，非 import 引擎）。
# 红线6：所有用例都 ARMED（本 session owner.active:true + session_id 匹配）——两态只关 ccm 在/不在切换，
#   不碰武装闸（武装闸不变由 test_board-lint / test_verify-board 守）。
. "$(dirname "$0")/helpers.sh"

LINT_HOOK="$PLUGIN_ROOT/hooks/scripts/board-lint.js"
VERIFY_HOOK="$PLUGIN_ROOT/hooks/scripts/verify-board.js"
SHIM="$REPO_ROOT/ccm/apps/cli/dev-bin/ccm"

# 确保 ccm dist 在（shim exec node bin/ccm.cjs→dist/index.cjs）。run-tests 已 build 过则复用；否则本测试 build。
# pnpm / dist 不可得 → CCM_HAVE=0（state ① 跳过、只跑降级态，仍是有效覆盖）。
CCM_HAVE=0
if [ -f "$SHIM" ] && [ -f "$REPO_ROOT/ccm/apps/cli/dist/index.cjs" ]; then
  CCM_HAVE=1
elif [ -f "$SHIM" ] && command -v pnpm >/dev/null 2>&1; then
  if (cd "$REPO_ROOT" && pnpm -C ccm build) >/dev/null 2>&1 && [ -f "$REPO_ROOT/ccm/apps/cli/dist/index.cjs" ]; then
    CCM_HAVE=1
  fi
fi
[ "$CCM_HAVE" -eq 1 ] && echo "(ccm dist available — state ① runs through real ccm)" \
                      || echo "(ccm dist NOT available — state ① skipped, graceful-degrade still tested)"

NOPE="/no/such/ccm-binary-$$"   # 不存在的可执行 → spawn ENOENT → 优雅降级

# A good armed board owned by sess-x (used as arming board where needed).
GOOD='{"schema":"cc-master/v2","goal":"g","owner":{"active":true,"session_id":"sess-x"},"git":{"worktree":"/w","branch":"b"},"tasks":[{"id":"T0","status":"done","deps":[],"started_at":"2026-06-23T10:00:00Z","finished_at":"2026-06-23T11:00:00Z"},{"id":"T1","status":"ready","deps":["T0"]}]}'
# A board with a hard error (dangling dep) — board-lint must report it (when ccm is available).
BADLINT='{"schema":"cc-master/v2","goal":"g","owner":{"active":true,"session_id":"sess-x"},"git":{"worktree":"","branch":""},"tasks":[{"id":"T7","status":"ready","deps":["GONE"]}]}'
# A rollup-inconsistent board (done owner M1 + in_flight child M1.b) — verify-board completion handshake names it (when ccm available).
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

# ════════════════════════════════════ board-lint.js ════════════════════════════════════
# ── ① ccm path: armed + bad target → report injected (sourced from ccm) ──────────────────────────────
if [ "$CCM_HAVE" -eq 1 ]; then
  H="$(make_project)"; mkdir -p "$H/boards"; printf '%s' "$GOOD" > "$H/boards/armed.board.json"; printf '%s' "$BADLINT" > "$H/boards/bad.board.json"
  run_lint "$SHIM" "$H" "$H/boards/bad.board.json" "sess-x"
  assert_eq 0 "$HOOK_RC" "lint①(ccm) rc 0"
  assert_contains "$HOOK_OUT" "additionalContext" "lint①(ccm) injects additionalContext"
  assert_contains "$HOOK_OUT" "GRAPH-DANGLING" "lint①(ccm) report names the rule (via ccm)"
  assert_contains "$HOOK_OUT" '"hookEventName":"PostToolUse"' "lint①(ccm) PostToolUse envelope"
  assert_not_contains "$HOOK_OUT" '"decision":"block"' "lint①(ccm) never blocks"
  assert_valid_json "$HOOK_OUT" "lint①(ccm) envelope valid JSON"
  rm -rf "$H"
fi

# ── ② graceful degrade: ccm unavailable (CCM_BIN bogus → ENOENT) → silent (empty out, rc 0) ──────────
# No require fallback (cli/ deleted): ccm missing → board-lint stays silent (lint is a SOFT PostToolUse
# nudge, not a gate — a missed lint is harmless; the hook NEVER pollutes the agent stream).
H="$(make_project)"; mkdir -p "$H/boards"; printf '%s' "$GOOD" > "$H/boards/armed.board.json"; printf '%s' "$BADLINT" > "$H/boards/bad.board.json"
run_lint "$NOPE" "$H" "$H/boards/bad.board.json" "sess-x"
assert_eq 0 "$HOOK_RC" "lint②(degrade) rc 0 (never crashes)"
assert_eq "" "$HOOK_OUT" "lint②(degrade) ccm gone → silent (no require fallback; hook never pollutes agent stream)"
rm -rf "$H"

# ════════════════════════════════════ verify-board.js ═══════════════════════════════════
# ── ① ccm path: rollup-inconsistent → completion handshake names rollup (sourced from ccm) ───────────
if [ "$CCM_HAVE" -eq 1 ]; then
  H="$(make_project)"; mkdir -p "$H/boards"; printf '%s' "$ROLLUP" > "$H/boards/b1.board.json"
  run_verify "$SHIM" "$H" "sess-rb"
  assert_eq 0 "$HOOK_RC" "verify①(ccm) rc 0"
  assert_contains "$HOOK_OUT" '"decision":"block"' "verify①(ccm) completion handshake blocks"
  assert_contains "$HOOK_OUT" "Rollup inconsistency" "verify①(ccm) rollup reminder injected (via ccm)"
  assert_contains "$HOOK_OUT" "owner M1 is" "verify①(ccm) names offending owner M1"
  assert_contains "$HOOK_OUT" "child M1.b is" "verify①(ccm) names non-done child M1.b"
  assert_valid_json "$HOOK_OUT" "verify①(ccm) envelope valid JSON"
  rm -rf "$H"
fi

# ── ② graceful degrade: ccm unavailable (CCM_BIN bogus → ENOENT) → rollup skipped, rest of gate runs ──
# No require fallback (cli/ deleted): ccm missing → the rollup PART is silently omitted (it's a SOFT
# reminder), but the self-check handshake (the actual Stop gate) STILL blocks — degrade never crashes.
H="$(make_project)"; mkdir -p "$H/boards"; printf '%s' "$ROLLUP" > "$H/boards/b1.board.json"
run_verify "$NOPE" "$H" "sess-rb"
assert_eq 0 "$HOOK_RC" "verify②(degrade) rc 0 (never crashes)"
assert_contains "$HOOK_OUT" '"decision":"block"' "verify②(degrade) rest of Stop gate still BLOCKS (handshake runs)"
assert_contains "$HOOK_OUT" "self-check" "verify②(degrade) self-check handshake intact"
assert_not_contains "$HOOK_OUT" "Rollup inconsistency" "verify②(degrade) rollup part skipped (no fallback, no crash)"
rm -rf "$H"

finish
