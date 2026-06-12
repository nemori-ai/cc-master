#!/usr/bin/env bash
. "$(dirname "$0")/helpers.sh"

# Tests for posttool-batch.sh (H5 — WIP soft-warning on parallel-batch parse). The hook reads THIS
# session's active board, counts in_flight (N) vs top-level wip_limit (M), and injects a NON-BLOCKING
# additionalContext warning when N > M. It NEVER emits decision:block and is read-only on the board.

# mkactive HOME NAME JSON — drop a board file into the home
mkactive() { mkdir -p "$1"; printf '%s' "$3" > "$1/$2.board.json"; }
# run_batch HOME SID — run the PostToolBatch hook with stdin JSON carrying session_id=SID.
run_batch() {
  HOOK_OUT="$(printf '{"session_id":"%s","hook_event_name":"PostToolBatch","tool_results":[]}' "$2" \
             | CLAUDE_PROJECT_DIR="/nonexistent-proj" CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" CC_MASTER_HOME="$1" \
               bash "$PLUGIN_ROOT/hooks/scripts/posttool-batch.sh" 2>/dev/null)"; HOOK_RC=$?
}

# Case 1: active board, in_flight=5, wip_limit=4 → warn. HOOK_OUT contains "WIP", "5", "4", rc 0,
#          and MUST NOT contain a block decision.
H="$(make_project)"; SID="sess-over"
mkactive "$H" "b1" "{\"schema\":\"cc-master/v1\",\"goal\":\"g\",\"wip_limit\":4,\"owner\":{\"active\":true,\"session_id\":\"$SID\"},\"tasks\":[{\"id\":\"T1\",\"status\":\"in_flight\",\"deps\":[]},{\"id\":\"T2\",\"status\":\"in_flight\",\"deps\":[]},{\"id\":\"T3\",\"status\":\"in_flight\",\"deps\":[]},{\"id\":\"T4\",\"status\":\"in_flight\",\"deps\":[]},{\"id\":\"T5\",\"status\":\"in_flight\",\"deps\":[]}]}"
run_batch "$H" "$SID"
assert_eq 0 "$HOOK_RC" "over-cap → rc 0"
assert_contains "$HOOK_OUT" "WIP" "over-cap → warning mentions WIP"
assert_contains "$HOOK_OUT" "5" "over-cap → warning carries N=5"
assert_contains "$HOOK_OUT" "4" "over-cap → warning carries M=4"
assert_contains "$HOOK_OUT" "additionalContext" "over-cap → injects additionalContext"
assert_not_contains "$HOOK_OUT" "\"decision\":\"block\"" "over-cap → NEVER a block decision"
rm -rf "$H"

# Case 2: in_flight=2, wip_limit=4 → within cap → silent (empty out), rc 0.
H="$(make_project)"; SID="sess-under"
mkactive "$H" "b1" "{\"schema\":\"cc-master/v1\",\"goal\":\"g\",\"wip_limit\":4,\"owner\":{\"active\":true,\"session_id\":\"$SID\"},\"tasks\":[{\"id\":\"T1\",\"status\":\"in_flight\",\"deps\":[]},{\"id\":\"T2\",\"status\":\"in_flight\",\"deps\":[]}]}"
run_batch "$H" "$SID"
assert_eq 0 "$HOOK_RC" "within cap → rc 0"
assert_eq "" "$HOOK_OUT" "within cap → silent (no output)"
rm -rf "$H"

# Case 3: board has NO wip_limit field → graceful degrade → silent (empty out), rc 0 (must not crash).
H="$(make_project)"; SID="sess-nolimit"
mkactive "$H" "b1" "{\"schema\":\"cc-master/v1\",\"goal\":\"g\",\"owner\":{\"active\":true,\"session_id\":\"$SID\"},\"tasks\":[{\"id\":\"T1\",\"status\":\"in_flight\",\"deps\":[]},{\"id\":\"T2\",\"status\":\"in_flight\",\"deps\":[]},{\"id\":\"T3\",\"status\":\"in_flight\",\"deps\":[]},{\"id\":\"T4\",\"status\":\"in_flight\",\"deps\":[]},{\"id\":\"T5\",\"status\":\"in_flight\",\"deps\":[]}]}"
run_batch "$H" "$SID"
assert_eq 0 "$HOOK_RC" "no wip_limit → rc 0 (graceful degrade, no crash)"
assert_eq "" "$HOOK_OUT" "no wip_limit → silent (no threshold → no warning)"
rm -rf "$H"

# Case 4: no active board for this session → silent (empty out), rc 0.
H="$(make_project)"
run_batch "$H" "sess-absent"
assert_eq 0 "$HOOK_RC" "no active board → rc 0"
assert_eq "" "$HOOK_OUT" "no active board → silent"
rm -rf "$H"

# ── extra guards ──────────────────────────────────────────────────────────────────────────────────

# Case 5: non-numeric wip_limit (e.g. "auto") → graceful degrade → silent.
H="$(make_project)"; SID="sess-badlimit"
mkactive "$H" "b1" "{\"schema\":\"cc-master/v1\",\"wip_limit\":\"auto\",\"owner\":{\"active\":true,\"session_id\":\"$SID\"},\"tasks\":[{\"id\":\"T1\",\"status\":\"in_flight\",\"deps\":[]},{\"id\":\"T2\",\"status\":\"in_flight\",\"deps\":[]},{\"id\":\"T3\",\"status\":\"in_flight\",\"deps\":[]}]}"
run_batch "$H" "$SID"
assert_eq 0 "$HOOK_RC" "non-numeric wip_limit → rc 0"
assert_eq "" "$HOOK_OUT" "non-numeric wip_limit → silent (graceful degrade)"
rm -rf "$H"

# Case 6: N == M (exactly at cap, not over) → silent (warn only when strictly over).
H="$(make_project)"; SID="sess-atcap"
mkactive "$H" "b1" "{\"schema\":\"cc-master/v1\",\"wip_limit\":3,\"owner\":{\"active\":true,\"session_id\":\"$SID\"},\"tasks\":[{\"id\":\"T1\",\"status\":\"in_flight\",\"deps\":[]},{\"id\":\"T2\",\"status\":\"in_flight\",\"deps\":[]},{\"id\":\"T3\",\"status\":\"in_flight\",\"deps\":[]}]}"
run_batch "$H" "$SID"
assert_eq 0 "$HOOK_RC" "exactly at cap → rc 0"
assert_eq "" "$HOOK_OUT" "exactly at cap (N==M) → silent (warn only when strictly over)"
rm -rf "$H"

# Case 7: SINGLE-LINE board with a flexible log[] carrying status:"in_flight" → log must NOT inflate
#          the in_flight count. tasks has 2 in_flight, log has 1 → N=2 ≤ wip_limit=4 → silent.
H="$(make_project)"; SID="sess-log"
mkactive "$H" "b1" "{\"schema\":\"cc-master/v1\",\"wip_limit\":4,\"owner\":{\"active\":true,\"session_id\":\"$SID\"},\"tasks\":[{\"id\":\"T1\",\"status\":\"in_flight\",\"deps\":[]},{\"id\":\"T2\",\"status\":\"in_flight\",\"deps\":[]}],\"log\":[{\"id\":\"L1\",\"status\":\"in_flight\"},{\"id\":\"L2\",\"status\":\"in_flight\"},{\"id\":\"L3\",\"status\":\"in_flight\"}]}"
run_batch "$H" "$SID"
assert_eq 0 "$HOOK_RC" "log in_flight entries → rc 0"
assert_eq "" "$HOOK_OUT" "log in_flight entries excluded from count → N=2 ≤ cap → silent (narrow-waist scope)"
rm -rf "$H"

# Case 8: session filter — another session's over-cap board must NOT trigger a warning for MY session.
H="$(make_project)"; MINE="sess-mine"; OTHER="sess-other"
mkactive "$H" "other" "{\"schema\":\"cc-master/v1\",\"wip_limit\":1,\"owner\":{\"active\":true,\"session_id\":\"$OTHER\"},\"tasks\":[{\"id\":\"T1\",\"status\":\"in_flight\",\"deps\":[]},{\"id\":\"T2\",\"status\":\"in_flight\",\"deps\":[]}]}"
run_batch "$H" "$MINE"
assert_eq 0 "$HOOK_RC" "session filter → rc 0"
assert_eq "" "$HOOK_OUT" "session filter → other session's over-cap board does not warn me"
rm -rf "$H"

# Case 9: NO top-level wip_limit, but a TASK carries a nested "wip_limit":1 (agent-shaped payload).
#          in_flight=2 > 1. The nested cap must NOT be picked up — only a board-root top-level wip_limit
#          is a real cap, so this degrades gracefully to silent (no threshold → no warning). Guards
#          against the grep mis-catching a nested same-name key (codex round-2 finding).
H="$(make_project)"; SID="sess-nested"
mkactive "$H" "b1" "{\"schema\":\"cc-master/v1\",\"goal\":\"g\",\"owner\":{\"active\":true,\"session_id\":\"$SID\"},\"tasks\":[{\"id\":\"T1\",\"status\":\"in_flight\",\"deps\":[],\"wip_limit\":1},{\"id\":\"T2\",\"status\":\"in_flight\",\"deps\":[]}]}"
run_batch "$H" "$SID"
assert_eq 0 "$HOOK_RC" "nested wip_limit → rc 0"
assert_eq "" "$HOOK_OUT" "nested task wip_limit ignored → no top-level cap → silent (graceful degrade)"
rm -rf "$H"

# Case 10: REAL top-level wip_limit=1 AND a task ALSO carries nested "wip_limit":99 → the top-level cap
#           must still win. in_flight=2 > 1 → warn. Guards against over-correcting Case 9 into never
#           reading a genuine top-level cap when a nested same-name key is present.
H="$(make_project)"; SID="sess-toplevel-wins"
mkactive "$H" "b1" "{\"schema\":\"cc-master/v1\",\"goal\":\"g\",\"wip_limit\":1,\"owner\":{\"active\":true,\"session_id\":\"$SID\"},\"tasks\":[{\"id\":\"T1\",\"status\":\"in_flight\",\"deps\":[],\"wip_limit\":99},{\"id\":\"T2\",\"status\":\"in_flight\",\"deps\":[]}]}"
run_batch "$H" "$SID"
assert_eq 0 "$HOOK_RC" "top-level wip_limit with nested same-name → rc 0"
assert_contains "$HOOK_OUT" "WIP" "top-level wip_limit still read despite nested same-name key → warns"
assert_contains "$HOOK_OUT" "additionalContext" "top-level cap → injects additionalContext"
rm -rf "$H"

# ── per-board independent WIP evaluation (wip_limit is board-LOCAL) ──────────────────────────────────
# A session can own MULTIPLE active boards. wip_limit is a board-LOCAL cap, so each board's in_flight
# must be compared against ITS OWN cap — never an aggregated in_flight against a single board's cap.

# Case 11: TWO active boards, same session. b1: in_flight=3, wip_limit=4 (within). b2: in_flight=2,
#           wip_limit=3 (within). EACH board is within its OWN cap → MUST be silent. The old logic
#           summed in_flight across boards (3+2=5) and compared to the FIRST board's cap (4) → 5>4 →
#           it falsely warned. Per-board evaluation must NOT warn here.
H="$(make_project)"; SID="sess-multi-within"
mkactive "$H" "b1" "{\"schema\":\"cc-master/v1\",\"goal\":\"g1\",\"wip_limit\":4,\"owner\":{\"active\":true,\"session_id\":\"$SID\"},\"tasks\":[{\"id\":\"T1\",\"status\":\"in_flight\",\"deps\":[]},{\"id\":\"T2\",\"status\":\"in_flight\",\"deps\":[]},{\"id\":\"T3\",\"status\":\"in_flight\",\"deps\":[]}]}"
mkactive "$H" "b2" "{\"schema\":\"cc-master/v1\",\"goal\":\"g2\",\"wip_limit\":3,\"owner\":{\"active\":true,\"session_id\":\"$SID\"},\"tasks\":[{\"id\":\"U1\",\"status\":\"in_flight\",\"deps\":[]},{\"id\":\"U2\",\"status\":\"in_flight\",\"deps\":[]}]}"
run_batch "$H" "$SID"
assert_eq 0 "$HOOK_RC" "two boards each within own cap → rc 0"
assert_eq "" "$HOOK_OUT" "two boards each within own cap → silent (no aggregation across boards)"
rm -rf "$H"

# Case 12: TWO active boards, same session. b1: in_flight=2, wip_limit=4 (within). b2: in_flight=3,
#           wip_limit=2 (OVER its own cap). The over-cap board must trigger a warning carrying ITS OWN
#           numbers (3 in_flight vs cap 2) — and must NOT be hidden behind the within-cap board.
H="$(make_project)"; SID="sess-multi-over"
mkactive "$H" "b1" "{\"schema\":\"cc-master/v1\",\"goal\":\"g1\",\"wip_limit\":4,\"owner\":{\"active\":true,\"session_id\":\"$SID\"},\"tasks\":[{\"id\":\"T1\",\"status\":\"in_flight\",\"deps\":[]},{\"id\":\"T2\",\"status\":\"in_flight\",\"deps\":[]}]}"
mkactive "$H" "b2" "{\"schema\":\"cc-master/v1\",\"goal\":\"g2\",\"wip_limit\":2,\"owner\":{\"active\":true,\"session_id\":\"$SID\"},\"tasks\":[{\"id\":\"U1\",\"status\":\"in_flight\",\"deps\":[]},{\"id\":\"U2\",\"status\":\"in_flight\",\"deps\":[]},{\"id\":\"U3\",\"status\":\"in_flight\",\"deps\":[]}]}"
run_batch "$H" "$SID"
assert_eq 0 "$HOOK_RC" "one of two boards over its own cap → rc 0"
assert_contains "$HOOK_OUT" "WIP" "over-cap board warns despite a sibling within-cap board"
assert_contains "$HOOK_OUT" "additionalContext" "per-board over-cap → injects additionalContext"
assert_not_contains "$HOOK_OUT" "\"decision\":\"block\"" "per-board over-cap → NEVER a block decision"
rm -rf "$H"

# ── 武装闸：active/session_id 只从 board 根的 owner 子对象读（CODEX7，破红线 6 修复回归用例）─────────
# 旧版 board_matches 用全文 grep 判 arming：`"active":true` 与 session_id 都从整个文件读。一块归档板
# （owner.active:false）若其某个 flexible 的 tasks[] / log[] 载荷里恰好出现 `"active":true`，全文 grep
# 命中 → 第一关误过；head -1 取到的第一个 session_id 仍是 owner.session_id，若它 == 当前 sid，则该归档板
# 被误判为 armed —— /stop 归档后 hook 仍激活。下面两例锁死「只从 owner 子对象读」。

# Case 13 (CODEX7 回归)：归档板 owner.active:false、owner.session_id == 本 session sid，但 log[] 的某个
#           flexible 嵌套对象里塞了 "active":true 和混淆用的 "session_id":"other"。owner 子对象本身是
#           active:false → 必须休眠（空 stdout、rc 0、不警告）。修前全文 grep 命中 → 误判 armed → 误警告。
H="$(make_project)"; SID="sess-archived-falsearm"
mkactive "$H" "b1" "{\"schema\":\"cc-master/v1\",\"goal\":\"g\",\"wip_limit\":1,\"owner\":{\"active\":false,\"session_id\":\"$SID\"},\"tasks\":[{\"id\":\"T1\",\"status\":\"in_flight\",\"deps\":[]},{\"id\":\"T2\",\"status\":\"in_flight\",\"deps\":[]}],\"log\":[{\"id\":\"L1\",\"snapshot\":{\"active\":true,\"session_id\":\"other\"}}]}"
run_batch "$H" "$SID"
assert_eq 0 "$HOOK_RC" "归档板含嵌套 active:true → rc 0"
assert_eq "" "$HOOK_OUT" "归档板（owner.active:false）+ 嵌套 active:true → 休眠（owner 子对象才算数）"
rm -rf "$H"

# Case 14 (反向保活)：真 active 板（owner.active:true、owner.session_id == sid）即便某 task 嵌套
#           "active":false，仍照常 armed —— in_flight=2 > wip_limit=1 → 该警告。防过度修复。
H="$(make_project)"; SID="sess-real-active"
mkactive "$H" "b1" "{\"schema\":\"cc-master/v1\",\"goal\":\"g\",\"wip_limit\":1,\"owner\":{\"active\":true,\"session_id\":\"$SID\"},\"tasks\":[{\"id\":\"T1\",\"status\":\"in_flight\",\"deps\":[],\"meta\":{\"active\":false}},{\"id\":\"T2\",\"status\":\"in_flight\",\"deps\":[]}]}"
run_batch "$H" "$SID"
assert_eq 0 "$HOOK_RC" "真 active 板含嵌套 active:false → rc 0"
assert_contains "$HOOK_OUT" "WIP" "真 active 板（owner.active:true）照常 armed → 超 cap 警告"
assert_contains "$HOOK_OUT" "additionalContext" "真 active 板 → 注入 additionalContext"
rm -rf "$H"

finish
