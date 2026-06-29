#!/usr/bin/env bash
. "$(dirname "$0")/helpers.sh"

# Tests for posttool-batch.js (H5 — WIP soft-warning on parallel-batch parse). The hook reads THIS
# session's active board, counts in_flight (N) vs scheduling.wip_limit (M, v2 — fallback root wip_limit),
# and injects a NON-BLOCKING additionalContext warning when N > M. It NEVER emits decision:block and is
# read-only on the board. v2 node 收编（ADR-013 §2.4）：board.scheduling.{wip_limit,owner_wip_limit}（缺则
# 降级 fallback v1 根字段·兼容旧板）；per-task wip_limit 留在 task 上不变。schema 夹具 cc-master/v2。

# mkactive HOME NAME JSON — drop a board file into <home>/boards/ (board-v2 layout)
mkactive() { mkdir -p "$1/boards"; printf '%s' "$3" > "$1/boards/$2.board.json"; }
# run_batch HOME SID — run the PostToolBatch hook with stdin JSON carrying session_id=SID.
run_batch() {
  HOOK_OUT="$(printf '{"session_id":"%s","hook_event_name":"PostToolBatch","tool_results":[]}' "$2" \
             | CLAUDE_PROJECT_DIR="/nonexistent-proj" CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" CC_MASTER_HOME="$1" \
               node "$PLUGIN_ROOT/hooks/scripts/posttool-batch.js" 2>/dev/null)"; HOOK_RC=$?
}
# run_batch_raw HOME STDIN_JSON — run the PostToolBatch hook with a caller-supplied stdin JSON literal
# (so tests can inject extra fields like agent_id). The hook itself extracts session_id from the JSON.
run_batch_raw() {
  HOOK_OUT="$(printf '%s' "$2" \
             | CLAUDE_PROJECT_DIR="/nonexistent-proj" CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" CC_MASTER_HOME="$1" \
               node "$PLUGIN_ROOT/hooks/scripts/posttool-batch.js" 2>/dev/null)"; HOOK_RC=$?
}

# Case 1: active board, in_flight=5, wip_limit=4 → warn. HOOK_OUT contains "WIP", "5", "4", rc 0,
#          and MUST NOT contain a block decision.
H="$(make_project)"; SID="sess-over"
mkactive "$H" "b1" "{\"schema\":\"cc-master/v2\",\"goal\":\"g\",\"scheduling\":{\"wip_limit\":4},\"owner\":{\"active\":true,\"session_id\":\"$SID\"},\"tasks\":[{\"id\":\"T1\",\"status\":\"in_flight\",\"deps\":[]},{\"id\":\"T2\",\"status\":\"in_flight\",\"deps\":[]},{\"id\":\"T3\",\"status\":\"in_flight\",\"deps\":[]},{\"id\":\"T4\",\"status\":\"in_flight\",\"deps\":[]},{\"id\":\"T5\",\"status\":\"in_flight\",\"deps\":[]}]}"
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
mkactive "$H" "b1" "{\"schema\":\"cc-master/v2\",\"goal\":\"g\",\"scheduling\":{\"wip_limit\":4},\"owner\":{\"active\":true,\"session_id\":\"$SID\"},\"tasks\":[{\"id\":\"T1\",\"status\":\"in_flight\",\"deps\":[]},{\"id\":\"T2\",\"status\":\"in_flight\",\"deps\":[]}]}"
run_batch "$H" "$SID"
assert_eq 0 "$HOOK_RC" "within cap → rc 0"
assert_eq "" "$HOOK_OUT" "within cap → silent (no output)"
rm -rf "$H"

# Case 3: board has NO wip_limit field → graceful degrade → silent (empty out), rc 0 (must not crash).
H="$(make_project)"; SID="sess-nolimit"
mkactive "$H" "b1" "{\"schema\":\"cc-master/v2\",\"goal\":\"g\",\"owner\":{\"active\":true,\"session_id\":\"$SID\"},\"tasks\":[{\"id\":\"T1\",\"status\":\"in_flight\",\"deps\":[]},{\"id\":\"T2\",\"status\":\"in_flight\",\"deps\":[]},{\"id\":\"T3\",\"status\":\"in_flight\",\"deps\":[]},{\"id\":\"T4\",\"status\":\"in_flight\",\"deps\":[]},{\"id\":\"T5\",\"status\":\"in_flight\",\"deps\":[]}]}"
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
mkactive "$H" "b1" "{\"schema\":\"cc-master/v2\",\"scheduling\":{\"wip_limit\":\"auto\"},\"owner\":{\"active\":true,\"session_id\":\"$SID\"},\"tasks\":[{\"id\":\"T1\",\"status\":\"in_flight\",\"deps\":[]},{\"id\":\"T2\",\"status\":\"in_flight\",\"deps\":[]},{\"id\":\"T3\",\"status\":\"in_flight\",\"deps\":[]}]}"
run_batch "$H" "$SID"
assert_eq 0 "$HOOK_RC" "non-numeric wip_limit → rc 0"
assert_eq "" "$HOOK_OUT" "non-numeric wip_limit → silent (graceful degrade)"
rm -rf "$H"

# Case 6: N == M (exactly at cap, not over) → silent (warn only when strictly over).
H="$(make_project)"; SID="sess-atcap"
mkactive "$H" "b1" "{\"schema\":\"cc-master/v2\",\"scheduling\":{\"wip_limit\":3},\"owner\":{\"active\":true,\"session_id\":\"$SID\"},\"tasks\":[{\"id\":\"T1\",\"status\":\"in_flight\",\"deps\":[]},{\"id\":\"T2\",\"status\":\"in_flight\",\"deps\":[]},{\"id\":\"T3\",\"status\":\"in_flight\",\"deps\":[]}]}"
run_batch "$H" "$SID"
assert_eq 0 "$HOOK_RC" "exactly at cap → rc 0"
assert_eq "" "$HOOK_OUT" "exactly at cap (N==M) → silent (warn only when strictly over)"
rm -rf "$H"

# Case 7: SINGLE-LINE board with a flexible log[] carrying status:"in_flight" → log must NOT inflate
#          the in_flight count. tasks has 2 in_flight, log has 1 → N=2 ≤ wip_limit=4 → silent.
H="$(make_project)"; SID="sess-log"
mkactive "$H" "b1" "{\"schema\":\"cc-master/v2\",\"scheduling\":{\"wip_limit\":4},\"owner\":{\"active\":true,\"session_id\":\"$SID\"},\"tasks\":[{\"id\":\"T1\",\"status\":\"in_flight\",\"deps\":[]},{\"id\":\"T2\",\"status\":\"in_flight\",\"deps\":[]}],\"log\":[{\"id\":\"L1\",\"status\":\"in_flight\"},{\"id\":\"L2\",\"status\":\"in_flight\"},{\"id\":\"L3\",\"status\":\"in_flight\"}]}"
run_batch "$H" "$SID"
assert_eq 0 "$HOOK_RC" "log in_flight entries → rc 0"
assert_eq "" "$HOOK_OUT" "log in_flight entries excluded from count → N=2 ≤ cap → silent (narrow-waist scope)"
rm -rf "$H"

# Case 8: session filter — another session's over-cap board must NOT trigger a warning for MY session.
H="$(make_project)"; MINE="sess-mine"; OTHER="sess-other"
mkactive "$H" "other" "{\"schema\":\"cc-master/v2\",\"scheduling\":{\"wip_limit\":1},\"owner\":{\"active\":true,\"session_id\":\"$OTHER\"},\"tasks\":[{\"id\":\"T1\",\"status\":\"in_flight\",\"deps\":[]},{\"id\":\"T2\",\"status\":\"in_flight\",\"deps\":[]}]}"
run_batch "$H" "$MINE"
assert_eq 0 "$HOOK_RC" "session filter → rc 0"
assert_eq "" "$HOOK_OUT" "session filter → other session's over-cap board does not warn me"
rm -rf "$H"

# Case 9: NO board-level wip_limit (no scheduling.wip_limit, no root wip_limit), but a TASK carries a
#          nested "wip_limit":1 (agent-shaped payload, per-task cap — NOT the global cap). in_flight=2 > 1.
#          The per-task cap must NOT be picked up as the GLOBAL cap — only board scheduling.wip_limit (or
#          v1-root fallback) is the global cap, so this degrades gracefully to silent (no global threshold →
#          no global warning). With JSON.parse a nested task.wip_limit can never masquerade as the board cap.
H="$(make_project)"; SID="sess-nested"
mkactive "$H" "b1" "{\"schema\":\"cc-master/v2\",\"goal\":\"g\",\"owner\":{\"active\":true,\"session_id\":\"$SID\"},\"tasks\":[{\"id\":\"T1\",\"status\":\"in_flight\",\"deps\":[],\"wip_limit\":1},{\"id\":\"T2\",\"status\":\"in_flight\",\"deps\":[]}]}"
run_batch "$H" "$SID"
assert_eq 0 "$HOOK_RC" "nested wip_limit → rc 0"
assert_eq "" "$HOOK_OUT" "nested task wip_limit ignored → no board-level cap → silent (graceful degrade)"
rm -rf "$H"

# Case 10: REAL board scheduling.wip_limit=1 AND a task ALSO carries nested "wip_limit":99 (per-task cap)
#           → the board global cap must still win. in_flight=2 > 1 → warn. Guards against over-correcting
#           Case 9 into never reading a genuine board cap when a per-task same-name key is present.
H="$(make_project)"; SID="sess-toplevel-wins"
mkactive "$H" "b1" "{\"schema\":\"cc-master/v2\",\"goal\":\"g\",\"scheduling\":{\"wip_limit\":1},\"owner\":{\"active\":true,\"session_id\":\"$SID\"},\"tasks\":[{\"id\":\"T1\",\"status\":\"in_flight\",\"deps\":[],\"wip_limit\":99},{\"id\":\"T2\",\"status\":\"in_flight\",\"deps\":[]}]}"
run_batch "$H" "$SID"
assert_eq 0 "$HOOK_RC" "top-level wip_limit with nested same-name → rc 0"
assert_contains "$HOOK_OUT" "WIP" "board scheduling.wip_limit still read despite per-task same-name key → warns"
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
mkactive "$H" "b1" "{\"schema\":\"cc-master/v2\",\"goal\":\"g1\",\"scheduling\":{\"wip_limit\":4},\"owner\":{\"active\":true,\"session_id\":\"$SID\"},\"tasks\":[{\"id\":\"T1\",\"status\":\"in_flight\",\"deps\":[]},{\"id\":\"T2\",\"status\":\"in_flight\",\"deps\":[]},{\"id\":\"T3\",\"status\":\"in_flight\",\"deps\":[]}]}"
mkactive "$H" "b2" "{\"schema\":\"cc-master/v2\",\"goal\":\"g2\",\"scheduling\":{\"wip_limit\":3},\"owner\":{\"active\":true,\"session_id\":\"$SID\"},\"tasks\":[{\"id\":\"U1\",\"status\":\"in_flight\",\"deps\":[]},{\"id\":\"U2\",\"status\":\"in_flight\",\"deps\":[]}]}"
run_batch "$H" "$SID"
assert_eq 0 "$HOOK_RC" "two boards each within own cap → rc 0"
assert_eq "" "$HOOK_OUT" "two boards each within own cap → silent (no aggregation across boards)"
rm -rf "$H"

# Case 12: TWO active boards, same session. b1: in_flight=2, wip_limit=4 (within). b2: in_flight=3,
#           wip_limit=2 (OVER its own cap). The over-cap board must trigger a warning carrying ITS OWN
#           numbers (3 in_flight vs cap 2) — and must NOT be hidden behind the within-cap board.
H="$(make_project)"; SID="sess-multi-over"
mkactive "$H" "b1" "{\"schema\":\"cc-master/v2\",\"goal\":\"g1\",\"scheduling\":{\"wip_limit\":4},\"owner\":{\"active\":true,\"session_id\":\"$SID\"},\"tasks\":[{\"id\":\"T1\",\"status\":\"in_flight\",\"deps\":[]},{\"id\":\"T2\",\"status\":\"in_flight\",\"deps\":[]}]}"
mkactive "$H" "b2" "{\"schema\":\"cc-master/v2\",\"goal\":\"g2\",\"scheduling\":{\"wip_limit\":2},\"owner\":{\"active\":true,\"session_id\":\"$SID\"},\"tasks\":[{\"id\":\"U1\",\"status\":\"in_flight\",\"deps\":[]},{\"id\":\"U2\",\"status\":\"in_flight\",\"deps\":[]},{\"id\":\"U3\",\"status\":\"in_flight\",\"deps\":[]}]}"
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
mkactive "$H" "b1" "{\"schema\":\"cc-master/v2\",\"goal\":\"g\",\"scheduling\":{\"wip_limit\":1},\"owner\":{\"active\":false,\"session_id\":\"$SID\"},\"tasks\":[{\"id\":\"T1\",\"status\":\"in_flight\",\"deps\":[]},{\"id\":\"T2\",\"status\":\"in_flight\",\"deps\":[]}],\"log\":[{\"id\":\"L1\",\"snapshot\":{\"active\":true,\"session_id\":\"other\"}}]}"
run_batch "$H" "$SID"
assert_eq 0 "$HOOK_RC" "归档板含嵌套 active:true → rc 0"
assert_eq "" "$HOOK_OUT" "归档板（owner.active:false）+ 嵌套 active:true → 休眠（owner 子对象才算数）"
rm -rf "$H"

# Case 14 (反向保活)：真 active 板（owner.active:true、owner.session_id == sid）即便某 task 嵌套
#           "active":false，仍照常 armed —— in_flight=2 > wip_limit=1 → 该警告。防过度修复。
H="$(make_project)"; SID="sess-real-active"
mkactive "$H" "b1" "{\"schema\":\"cc-master/v2\",\"goal\":\"g\",\"scheduling\":{\"wip_limit\":1},\"owner\":{\"active\":true,\"session_id\":\"$SID\"},\"tasks\":[{\"id\":\"T1\",\"status\":\"in_flight\",\"deps\":[],\"meta\":{\"active\":false}},{\"id\":\"T2\",\"status\":\"in_flight\",\"deps\":[]}]}"
run_batch "$H" "$SID"
assert_eq 0 "$HOOK_RC" "真 active 板含嵌套 active:false → rc 0"
assert_contains "$HOOK_OUT" "WIP" "真 active 板（owner.active:true）照常 armed → 超 cap 警告"
assert_contains "$HOOK_OUT" "additionalContext" "真 active 板 → 注入 additionalContext"
rm -rf "$H"

# ── SUB-AGENT 闸：sub-agent 上下文（stdin 带 agent_id）不得收到指挥专属 WIP 警告（CODEX9，破红线 4 修复）──
# PostToolBatch 在 Task 派生的 sub-agent 上下文内部也触发；官方 stdin 此时带 `agent_id`（主线缺席）。
# 旧版 board_matches 只用 session_id 判 arming → leaf worker 自己的一批工具调用会匹配主板、在主板超
# wip_limit 时收到「指挥专属」的 WIP/编排 additionalContext —— 把指挥的乐谱递给了乐手（WIP 警告是
# orchestrator-only 的认知指导，绝不该到单元 worker）。下面用例锁死：agent_id 非空 → 静默早退。

# Case 15 (CODEX9 回归)：真 active 主板（owner.active:true、owner.session_id == sid，2 个 in_flight、
#           wip_limit=1 → 超 cap）。stdin 同时带 session_id 与 "agent_id":"sub-xyz"（sub-agent 上下文）。
#           必须静默（空 stdout、rc 0、无 WIP additionalContext）。修前只用 session_id 判 → 误注 WIP 警告。
H="$(make_project)"; SID="sess-subagent"
mkactive "$H" "b1" "{\"schema\":\"cc-master/v2\",\"goal\":\"g\",\"scheduling\":{\"wip_limit\":1},\"owner\":{\"active\":true,\"session_id\":\"$SID\"},\"tasks\":[{\"id\":\"T1\",\"status\":\"in_flight\",\"deps\":[]},{\"id\":\"T2\",\"status\":\"in_flight\",\"deps\":[]}]}"
run_batch_raw "$H" "{\"session_id\":\"$SID\",\"agent_id\":\"sub-xyz\",\"hook_event_name\":\"PostToolBatch\",\"tool_results\":[]}"
assert_eq 0 "$HOOK_RC" "sub-agent 上下文（agent_id 非空）→ rc 0"
assert_eq "" "$HOOK_OUT" "sub-agent 上下文 → 静默（指挥专属 WIP 警告不泄漏给 leaf worker，红线4）"
assert_not_contains "$HOOK_OUT" "WIP" "sub-agent 上下文 → 无 WIP 警告"
rm -rf "$H"

# Case 16 (反向保活)：同一超 cap 主板，stdin 只带 session_id、无 agent_id（主线）→ 照常注入 WIP 警告。
#           防过度修复：sub-agent 闸不得误伤主线编排者。
H="$(make_project)"; SID="sess-mainline"
mkactive "$H" "b1" "{\"schema\":\"cc-master/v2\",\"goal\":\"g\",\"scheduling\":{\"wip_limit\":1},\"owner\":{\"active\":true,\"session_id\":\"$SID\"},\"tasks\":[{\"id\":\"T1\",\"status\":\"in_flight\",\"deps\":[]},{\"id\":\"T2\",\"status\":\"in_flight\",\"deps\":[]}]}"
run_batch_raw "$H" "{\"session_id\":\"$SID\",\"hook_event_name\":\"PostToolBatch\",\"tool_results\":[]}"
assert_eq 0 "$HOOK_RC" "主线（无 agent_id）→ rc 0"
assert_contains "$HOOK_OUT" "WIP" "主线（无 agent_id）→ 照常注入 WIP 警告（不误伤主线）"
assert_contains "$HOOK_OUT" "additionalContext" "主线 → 注入 additionalContext"
rm -rf "$H"

# Case 17 (null/缺席当主线)："agent_id":null（JSON null，非带引号字符串）→ sed 只认带引号值 → 解析为空
#           → 视为主线 → 同一超 cap 板照常警告。验证 sed 不会把 null 误当 sub-agent 而误静默主线。
H="$(make_project)"; SID="sess-agentnull"
mkactive "$H" "b1" "{\"schema\":\"cc-master/v2\",\"goal\":\"g\",\"scheduling\":{\"wip_limit\":1},\"owner\":{\"active\":true,\"session_id\":\"$SID\"},\"tasks\":[{\"id\":\"T1\",\"status\":\"in_flight\",\"deps\":[]},{\"id\":\"T2\",\"status\":\"in_flight\",\"deps\":[]}]}"
run_batch_raw "$H" "{\"session_id\":\"$SID\",\"agent_id\":null,\"hook_event_name\":\"PostToolBatch\",\"tool_results\":[]}"
assert_eq 0 "$HOOK_RC" "agent_id:null → rc 0"
assert_contains "$HOOK_OUT" "WIP" "agent_id:null（非带引号字符串）→ 当主线 → 照常警告"
rm -rf "$H"

# ── stdin 顶层字段限定：session_id / agent_id 只从 stdin 根对象的顶层字段读，绝不被 tool_results 污染 ──
# （CODEX10，破红线 4 + 红线 6 修复）。PostToolBatch 的 stdin 是一个 JSON 对象：顶层有 hook 元数据
# （session_id / agent_id / hook_event_name / transcript_path…），但还带 `tool_results`（一批工具调用的
# 任意输出）。工具输出里可能含 JSON 或散文如 `"agent_id":"..."` / `"session_id":"..."`。旧版用贪婪全
# stdin sed（`.*` 贪婪）解析 → 紧凑单行 JSON 下匹配到最后一个（嵌在 tool_results 里的）值，而非顶层 hook
# 元数据。后果：主线 batch 的工具输出含 `"agent_id":"x"` → 误读出非空 agent_id → 误判 sub-agent 而静默 →
# 超 cap 主板收不到本该有的 WIP 警告；或工具输出含 `"session_id":"other"` → 匹配错 session → 武装判定错乱。
# 下面用例锁死「session_id / agent_id 只从 stdin 根对象顶层字段读，tool_results 内同名字段整体丢弃」。

# Case 18 (CODEX10 回归 · 紧凑单行)：主线 stdin（顶层 "session_id":"SID"、无顶层 agent_id），但其
#           tool_results 里某工具返回的嵌套对象带真 JSON 字段 "agent_id":"POISON" 与 "session_id":"OTHER"
#           （未转义、真实嵌套 JSON——工具输出可含此类结构化载荷）。超 cap 主板 owner.session_id==SID、
#           wip_limit:1、两个 in_flight。修后须照常注入 WIP 警告（没把嵌套 POISON 读成 sub-agent、也没把
#           session 匹配到 OTHER）。修前贪婪 sed（.* 贪婪）会误读最后一个即 POISON → 静默（Red）。
#           紧凑单行最能触发贪婪 bug。
H="$(make_project)"; SID="sess-toplevel-only"
mkactive "$H" "b1" "{\"schema\":\"cc-master/v2\",\"goal\":\"g\",\"scheduling\":{\"wip_limit\":1},\"owner\":{\"active\":true,\"session_id\":\"$SID\"},\"tasks\":[{\"id\":\"T1\",\"status\":\"in_flight\",\"deps\":[]},{\"id\":\"T2\",\"status\":\"in_flight\",\"deps\":[]}]}"
run_batch_raw "$H" "{\"session_id\":\"$SID\",\"hook_event_name\":\"PostToolBatch\",\"tool_results\":[{\"type\":\"tool_result\",\"meta\":{\"agent_id\":\"POISON\",\"session_id\":\"OTHER\"}}]}"
assert_eq 0 "$HOOK_RC" "tool_results 含嵌套 agent_id/session_id → rc 0"
assert_contains "$HOOK_OUT" "WIP" "顶层无 agent_id、tool_results 内 agent_id 不算 → 当主线 → 照常警告"
assert_contains "$HOOK_OUT" "additionalContext" "顶层 session 匹配（非 tool_results 内 OTHER）→ 注入 additionalContext"
rm -rf "$H"

# Case 19 (CODEX10 回归 · 多行缩进，证 format-agnostic)：同 Case 18 语义，但 stdin 用多行缩进 JSON，
#           tool_results 内嵌真 JSON 字段 "agent_id":"POISON" / "session_id":"OTHER"。须与单行行为一致 → 照常警告。
H="$(make_project)"; SID="sess-toplevel-multiline"
mkactive "$H" "b1" "{\"schema\":\"cc-master/v2\",\"goal\":\"g\",\"scheduling\":{\"wip_limit\":1},\"owner\":{\"active\":true,\"session_id\":\"$SID\"},\"tasks\":[{\"id\":\"T1\",\"status\":\"in_flight\",\"deps\":[]},{\"id\":\"T2\",\"status\":\"in_flight\",\"deps\":[]}]}"
ML_STDIN="$(printf '{\n  "session_id": "%s",\n  "hook_event_name": "PostToolBatch",\n  "tool_results": [\n    {\n      "type": "tool_result",\n      "meta": { "agent_id": "POISON", "session_id": "OTHER" }\n    }\n  ]\n}' "$SID")"
run_batch_raw "$H" "$ML_STDIN"
assert_eq 0 "$HOOK_RC" "多行缩进 + tool_results 嵌套同名字段 → rc 0"
assert_contains "$HOOK_OUT" "WIP" "多行缩进下顶层字段限定仍生效（format-agnostic）→ 照常警告"
rm -rf "$H"

# Case 20 (保活①·真 sub-agent 顶层 agent_id)：顶层带 "agent_id":"sub-1"（真 sub-agent 上下文）→ 即便
#           tool_results 也提到 agent_id，顶层非空 agent_id 必须被读到 → 静默早退（不误伤 sub-agent 闸）。
H="$(make_project)"; SID="sess-real-subagent"
mkactive "$H" "b1" "{\"schema\":\"cc-master/v2\",\"goal\":\"g\",\"scheduling\":{\"wip_limit\":1},\"owner\":{\"active\":true,\"session_id\":\"$SID\"},\"tasks\":[{\"id\":\"T1\",\"status\":\"in_flight\",\"deps\":[]},{\"id\":\"T2\",\"status\":\"in_flight\",\"deps\":[]}]}"
run_batch_raw "$H" "{\"session_id\":\"$SID\",\"agent_id\":\"sub-1\",\"hook_event_name\":\"PostToolBatch\",\"tool_results\":[{\"meta\":{\"agent_id\":\"noise\"}}]}"
assert_eq 0 "$HOOK_RC" "顶层真 agent_id（sub-agent）→ rc 0"
assert_eq "" "$HOOK_OUT" "顶层 agent_id 非空 → sub-agent → 静默（顶层字段流照常读到 sub-1）"
rm -rf "$H"

# Case 21 (保活②·干净主线)：干净主线 stdin（无 agent_id、顶层 session 匹配、超 cap、tool_results 为空对象
#           批次但不含 agent_id/session_id 杂质）→ 照常警告。防顶层字段流把干净主线的合法字段也漏掉。
H="$(make_project)"; SID="sess-clean-mainline"
mkactive "$H" "b1" "{\"schema\":\"cc-master/v2\",\"goal\":\"g\",\"scheduling\":{\"wip_limit\":1},\"owner\":{\"active\":true,\"session_id\":\"$SID\"},\"tasks\":[{\"id\":\"T1\",\"status\":\"in_flight\",\"deps\":[]},{\"id\":\"T2\",\"status\":\"in_flight\",\"deps\":[]}]}"
run_batch_raw "$H" "{\"session_id\":\"$SID\",\"hook_event_name\":\"PostToolBatch\",\"tool_results\":[{\"type\":\"tool_result\",\"content\":\"ok\"},{\"type\":\"tool_result\",\"content\":\"done\"}]}"
assert_eq 0 "$HOOK_RC" "干净主线 → rc 0"
assert_contains "$HOOK_OUT" "WIP" "干净主线（顶层 session 匹配、无 agent_id）→ 照常警告"
rm -rf "$H"

# ── 非对称 degrade：blank-session 板（owner.session_id 空串）对非空 stdin sid 保持休眠（CODEX14 回退）──
# 上一轮（CODEX12）曾对称 degrade 收养空 board sid；本轮（CODEX14）回退：收养会武装任意不相关 session，破红线 6。
# 裁决（ADR-007 §2.3 / §4.5）：红线 6（非协商）优先于孤儿边缘 case。异常 blank 板保持休眠（fail-safe），由显式
# re-arm 认领。「board sid 非空但 ≠ stdin sid」同样休眠（红线 6 防真跨会话污染，一字不动）。

# Case 22 (CODEX14 回退：blank-session 板对非空 stdin sid 休眠)：active 板 owner.session_id:""（空串），wip_limit=1、
#           2 个 in_flight（超 cap），stdin 带**非空** session_id（主线，无 agent_id）。"" != "sess-adopt" → 不武装
#           → 静默（无 WIP 警告）。这正是红线 6 要的 fail-safe：blank 板不收养任意 session。
H="$(make_project)"; SID="sess-adopt"
mkactive "$H" "b1" "{\"schema\":\"cc-master/v2\",\"goal\":\"g\",\"scheduling\":{\"wip_limit\":1},\"owner\":{\"active\":true,\"session_id\":\"\"},\"tasks\":[{\"id\":\"T1\",\"status\":\"in_flight\",\"deps\":[]},{\"id\":\"T2\",\"status\":\"in_flight\",\"deps\":[]}]}"
run_batch "$H" "$SID"
assert_eq 0 "$HOOK_RC" "22: blank-session 板 + 非空 stdin sid → rc 0"
assert_eq "" "$HOOK_OUT" "22: blank-session 板（owner.session_id:\"\"）对非空 stdin sid → 休眠，不警告（CODEX14 回退，红线 6 fail-safe）"
rm -rf "$H"

# Case 23 (红线 6 防线保活：board sid 非空且 ≠ stdin sid 仍休眠)：active 板 owner.session_id:"OTHER"
#           （非空），wip_limit=1、2 个 in_flight（超 cap），stdin sid "MINE"（不同）→ 必须静默（空 stdout，
#           不警告）。证明对称 degrade **没有**退化成「任何 active 板即武装」—— 红线 6 防线原样保留。
H="$(make_project)"; SID="MINE"
mkactive "$H" "b1" '{"schema":"cc-master/v2","goal":"g","scheduling":{"wip_limit":1},"owner":{"active":true,"session_id":"OTHER"},"tasks":[{"id":"T1","status":"in_flight","deps":[]},{"id":"T2","status":"in_flight","deps":[]}]}'
run_batch "$H" "$SID"
assert_eq 0 "$HOOK_RC" "23: board sid 非空且 ≠ stdin sid → rc 0"
assert_eq "" "$HOOK_OUT" "23: board sid=OTHER（非空）≠ stdin sid=MINE → 仍休眠（不警告，红线 6 防线未退化）"
rm -rf "$H"

# ── rollup-aware 两级 WIP（D3.7·按 owner 分组限 N，叠在全局 wip_limit 限 M 之上）─────────────────────────
# 除全局 wip_limit（限 M·限整板 in_flight 总数）外，soft-observed 的 root top-level `owner_wip_limit`（限 N·
# 限每个 owner 名下 in_flight 子任务数）开启 per-owner 两级 WIP。某 owner 名下 in_flight 子任务 > N → 注入
# 一条非阻塞软警告（点名该 owner + 其子 in_flight 数 vs 上限），与全局 C5 同形态。per-owner 可用 owner 节点
# 自身的 `wip_limit` 字段覆写默认 N（per-owner 覆写优先于根 owner_wip_limit）。缺字段 / 旧板 / 无 parent 边
# → 该检查静默关闭（graceful degrade，同 wip_limit 缺失即关 C5 的纪律）。

# Case 24 (owner 超 per-owner 上限 → 点名警告)：owner M1 有 3 个 in_flight 子（M1.a/b/c），owner_wip_limit=2
#           → 超 owner 级上限。全局 in_flight=4（含 owner M1 自身 in_flight），无全局 wip_limit → 全局检查关。
#           须注入点名 M1 的 owner 级 WIP 警告（含 owner id "M1"、子 in_flight 数 3、上限 2），rc 0，非 block。
H="$(make_project)"; SID="sess-owner-over"
mkactive "$H" "b1" "{\"schema\":\"cc-master/v2\",\"goal\":\"g\",\"scheduling\":{\"owner_wip_limit\":2},\"owner\":{\"active\":true,\"session_id\":\"$SID\"},\"tasks\":[{\"id\":\"M1\",\"status\":\"in_flight\",\"deps\":[],\"kind\":\"owner\"},{\"id\":\"M1.a\",\"status\":\"in_flight\",\"deps\":[],\"parent\":\"M1\"},{\"id\":\"M1.b\",\"status\":\"in_flight\",\"deps\":[],\"parent\":\"M1\"},{\"id\":\"M1.c\",\"status\":\"in_flight\",\"deps\":[],\"parent\":\"M1\"}]}"
run_batch "$H" "$SID"
assert_eq 0 "$HOOK_RC" "24: owner 超 per-owner 上限 → rc 0"
assert_contains "$HOOK_OUT" "M1" "24: owner 级 WIP 警告点名 owner id M1"
assert_contains "$HOOK_OUT" "additionalContext" "24: owner 超上限 → 注入 additionalContext"
assert_not_contains "$HOOK_OUT" "\"decision\":\"block\"" "24: owner 超上限 → NEVER a block decision"
rm -rf "$H"

# Case 25 (owner 在 per-owner 上限内 → 静默)：owner M1 有 2 个 in_flight 子，owner_wip_limit=2（恰在上限、
#           非超）。无全局 wip_limit。须静默（per-owner WIP 只在严格超时警告，N==上限不警告，与全局 C5 同口径）。
H="$(make_project)"; SID="sess-owner-within"
mkactive "$H" "b1" "{\"schema\":\"cc-master/v2\",\"goal\":\"g\",\"scheduling\":{\"owner_wip_limit\":2},\"owner\":{\"active\":true,\"session_id\":\"$SID\"},\"tasks\":[{\"id\":\"M1\",\"status\":\"in_flight\",\"deps\":[],\"kind\":\"owner\"},{\"id\":\"M1.a\",\"status\":\"in_flight\",\"deps\":[],\"parent\":\"M1\"},{\"id\":\"M1.b\",\"status\":\"in_flight\",\"deps\":[],\"parent\":\"M1\"}]}"
run_batch "$H" "$SID"
assert_eq 0 "$HOOK_RC" "25: owner 在上限内 → rc 0"
assert_eq "" "$HOOK_OUT" "25: owner in_flight 子数 == owner_wip_limit（非严格超）→ 静默"
rm -rf "$H"

# Case 26 (无 owner_wip_limit → owner 级检查静默关闭)：owner M1 有 3 个 in_flight 子，但板无 owner_wip_limit
#           （也无全局 wip_limit）→ 两级 WIP 全关，graceful degrade，静默（缺字段即关，同 wip_limit 纪律）。
H="$(make_project)"; SID="sess-owner-nolimit"
mkactive "$H" "b1" "{\"schema\":\"cc-master/v2\",\"goal\":\"g\",\"owner\":{\"active\":true,\"session_id\":\"$SID\"},\"tasks\":[{\"id\":\"M1\",\"status\":\"in_flight\",\"deps\":[],\"kind\":\"owner\"},{\"id\":\"M1.a\",\"status\":\"in_flight\",\"deps\":[],\"parent\":\"M1\"},{\"id\":\"M1.b\",\"status\":\"in_flight\",\"deps\":[],\"parent\":\"M1\"},{\"id\":\"M1.c\",\"status\":\"in_flight\",\"deps\":[],\"parent\":\"M1\"}]}"
run_batch "$H" "$SID"
assert_eq 0 "$HOOK_RC" "26: 无 owner_wip_limit → rc 0"
assert_eq "" "$HOOK_OUT" "26: 缺 owner_wip_limit → owner 级检查静默关闭（graceful degrade）"
rm -rf "$H"

# Case 27 (旧板无 parent 边 → owner 级检查静默关闭)：板有 owner_wip_limit=1 但全 flat top-level task、无任何
#           parent 边（旧板）→ 无 owner → owner 级检查无对象 → 静默（且全局 wip_limit 缺失，全局也关）。
H="$(make_project)"; SID="sess-owner-flat"
mkactive "$H" "b1" "{\"schema\":\"cc-master/v2\",\"goal\":\"g\",\"scheduling\":{\"owner_wip_limit\":1},\"owner\":{\"active\":true,\"session_id\":\"$SID\"},\"tasks\":[{\"id\":\"T1\",\"status\":\"in_flight\",\"deps\":[]},{\"id\":\"T2\",\"status\":\"in_flight\",\"deps\":[]},{\"id\":\"T3\",\"status\":\"in_flight\",\"deps\":[]}]}"
run_batch "$H" "$SID"
assert_eq 0 "$HOOK_RC" "27: 无 parent 边 → rc 0"
assert_eq "" "$HOOK_OUT" "27: owner_wip_limit 在但无 parent 边（旧板）→ 无 owner → owner 级检查静默关闭"
rm -rf "$H"

# Case 28 (per-owner 覆写：owner 节点自身 wip_limit 优先于根 owner_wip_limit)：root owner_wip_limit=5（宽），
#           但 owner M1 节点自带 wip_limit:1（窄覆写），M1 有 2 个 in_flight 子 > 1 → 须点名 M1 警告。
#           证明 per-owner 覆写生效（紧的本地 cap 胜过宽的全局默认 N），且 task 级 wip_limit 不被误当全局 cap。
H="$(make_project)"; SID="sess-owner-override"
mkactive "$H" "b1" "{\"schema\":\"cc-master/v2\",\"goal\":\"g\",\"scheduling\":{\"owner_wip_limit\":5},\"owner\":{\"active\":true,\"session_id\":\"$SID\"},\"tasks\":[{\"id\":\"M1\",\"status\":\"in_flight\",\"deps\":[],\"kind\":\"owner\",\"wip_limit\":1},{\"id\":\"M1.a\",\"status\":\"in_flight\",\"deps\":[],\"parent\":\"M1\"},{\"id\":\"M1.b\",\"status\":\"in_flight\",\"deps\":[],\"parent\":\"M1\"}]}"
run_batch "$H" "$SID"
assert_eq 0 "$HOOK_RC" "28: per-owner 覆写 → rc 0"
assert_contains "$HOOK_OUT" "M1" "28: owner 节点自身 wip_limit=1 覆写根默认 N=5 → 点名 M1 超上限"
assert_contains "$HOOK_OUT" "additionalContext" "28: per-owner 覆写超上限 → 注入 additionalContext"
rm -rf "$H"

# Case 29 (两级独立：仅全局超 / owner 各自不超 → 仍警告全局；owner 级不误增噪)：全局 wip_limit=2、in_flight=3
#           （owner M1 自身 + 2 子）→ 全局超。owner_wip_limit=3，M1 有 2 子 in_flight ≤ 3 → owner 级不超。
#           须有全局 C5 WIP 警告，且不含 owner 级点名（owner 级未触发）。证明两级各自独立判定。
H="$(make_project)"; SID="sess-global-only"
mkactive "$H" "b1" "{\"schema\":\"cc-master/v2\",\"goal\":\"g\",\"scheduling\":{\"wip_limit\":2,\"owner_wip_limit\":3},\"owner\":{\"active\":true,\"session_id\":\"$SID\"},\"tasks\":[{\"id\":\"M1\",\"status\":\"in_flight\",\"deps\":[],\"kind\":\"owner\"},{\"id\":\"M1.a\",\"status\":\"in_flight\",\"deps\":[],\"parent\":\"M1\"},{\"id\":\"M1.b\",\"status\":\"in_flight\",\"deps\":[],\"parent\":\"M1\"}]}"
run_batch "$H" "$SID"
assert_eq 0 "$HOOK_RC" "29: 全局超 / owner 不超 → rc 0"
assert_contains "$HOOK_OUT" "WIP" "29: 全局 in_flight=3 > wip_limit=2 → 全局 C5 WIP 警告照常"
assert_not_contains "$HOOK_OUT" "owner M1" "29: owner M1（2 子 ≤ 3）未超 owner 级上限 → 不点名 M1"
rm -rf "$H"

# Case 30 (per-owner 子计数 narrow-waist：log[] 嵌套 parent/status 不污染 owner 子计数)：单行紧凑板，owner
#           M1 有 2 个真子 in_flight（≤ owner_wip_limit=2，不超），但 log[] 里塞了嵌套 {"parent":"M1",
#           "status":"in_flight"} ×2。若误把 log 嵌套算进 owner 子计数 → 会变 4 > 2 → 误警告。须静默
#           （只数 tasks 顶层对象的 parent 边·narrow-waist scope，同 in_flight 计数的 tasks_region 隔离）。
H="$(make_project)"; SID="sess-owner-log"
mkactive "$H" "b1" "{\"schema\":\"cc-master/v2\",\"goal\":\"g\",\"scheduling\":{\"owner_wip_limit\":2},\"owner\":{\"active\":true,\"session_id\":\"$SID\"},\"tasks\":[{\"id\":\"M1\",\"status\":\"in_flight\",\"deps\":[],\"kind\":\"owner\"},{\"id\":\"M1.a\",\"status\":\"in_flight\",\"deps\":[],\"parent\":\"M1\"},{\"id\":\"M1.b\",\"status\":\"in_flight\",\"deps\":[],\"parent\":\"M1\"}],\"log\":[{\"id\":\"L1\",\"parent\":\"M1\",\"status\":\"in_flight\"},{\"id\":\"L2\",\"parent\":\"M1\",\"status\":\"in_flight\"}]}"
run_batch "$H" "$SID"
assert_eq 0 "$HOOK_RC" "30: log 嵌套 parent → rc 0"
assert_eq "" "$HOOK_OUT" "30: log[] 嵌套 parent/status 不计入 owner 子计数（narrow-waist）→ M1 仅 2 子 ≤ 2 → 静默"
rm -rf "$H"

# Case 31 (sub-agent 闸：owner 级两级 WIP 同样不泄漏给 leaf worker)：超 owner 上限的主板，stdin 带 agent_id
#           → 必须静默（两级 WIP 仍是 orchestrator-only 认知指导，红线 4 不递乐谱给乐手）。
H="$(make_project)"; SID="sess-owner-subagent"
mkactive "$H" "b1" "{\"schema\":\"cc-master/v2\",\"goal\":\"g\",\"scheduling\":{\"owner_wip_limit\":1},\"owner\":{\"active\":true,\"session_id\":\"$SID\"},\"tasks\":[{\"id\":\"M1\",\"status\":\"in_flight\",\"deps\":[],\"kind\":\"owner\"},{\"id\":\"M1.a\",\"status\":\"in_flight\",\"deps\":[],\"parent\":\"M1\"},{\"id\":\"M1.b\",\"status\":\"in_flight\",\"deps\":[],\"parent\":\"M1\"}]}"
run_batch_raw "$H" "{\"session_id\":\"$SID\",\"agent_id\":\"sub-xyz\",\"hook_event_name\":\"PostToolBatch\",\"tool_results\":[]}"
assert_eq 0 "$HOOK_RC" "31: sub-agent 上下文 + owner 超上限 → rc 0"
assert_eq "" "$HOOK_OUT" "31: sub-agent 上下文 → owner 级两级 WIP 也静默（红线 4，不泄漏给 leaf worker）"
rm -rf "$H"

# ── v1 旧板降级 fallback：scheduling.{wip_limit,owner_wip_limit} 缺 → 读根 wip_limit/owner_wip_limit ──────
# v2 收编后字段挪进 scheduling，但为兼容**旧板**（v1 时代根字段），缺 scheduling.X 时降级 fallback 到根 X。
# 下面用例锁死降级路径真被走到——旧板（无 scheduling 块、根带 wip_limit/owner_wip_limit）仍正确触发两级 WIP。

# Case 32 (全局 wip_limit 降级 fallback)：旧板无 scheduling 块、根带 wip_limit=1，2 个 in_flight 超 cap →
#           须从根 wip_limit 读出 cap → 照常 WIP 警告（验降级 fallback 真生效，不是只读 scheduling）。
H="$(make_project)"; SID="sess-v1fallback-wip"
mkactive "$H" "b1" "{\"schema\":\"cc-master/v1\",\"goal\":\"g\",\"wip_limit\":1,\"owner\":{\"active\":true,\"session_id\":\"$SID\"},\"tasks\":[{\"id\":\"T1\",\"status\":\"in_flight\",\"deps\":[]},{\"id\":\"T2\",\"status\":\"in_flight\",\"deps\":[]}]}"
run_batch "$H" "$SID"
assert_eq 0 "$HOOK_RC" "32: v1 旧板根 wip_limit fallback → rc 0"
assert_contains "$HOOK_OUT" "WIP" "32: 缺 scheduling.wip_limit → 降级读根 wip_limit（v1 旧板兼容）→ 照常警告"
assert_contains "$HOOK_OUT" "additionalContext" "32: v1 fallback → 注入 additionalContext"
rm -rf "$H"

# Case 33 (per-owner owner_wip_limit 降级 fallback)：旧板无 scheduling 块、根带 owner_wip_limit=1，owner M1
#           有 2 个 in_flight 子 > 1 → 须从根 owner_wip_limit 读出默认 N → 点名 M1 警告（验 owner 级降级 fallback）。
H="$(make_project)"; SID="sess-v1fallback-owner"
mkactive "$H" "b1" "{\"schema\":\"cc-master/v1\",\"goal\":\"g\",\"owner_wip_limit\":1,\"owner\":{\"active\":true,\"session_id\":\"$SID\"},\"tasks\":[{\"id\":\"M1\",\"status\":\"in_flight\",\"deps\":[],\"kind\":\"owner\"},{\"id\":\"M1.a\",\"status\":\"in_flight\",\"deps\":[],\"parent\":\"M1\"},{\"id\":\"M1.b\",\"status\":\"in_flight\",\"deps\":[],\"parent\":\"M1\"}]}"
run_batch "$H" "$SID"
assert_eq 0 "$HOOK_RC" "33: v1 旧板根 owner_wip_limit fallback → rc 0"
assert_contains "$HOOK_OUT" "M1" "33: 缺 scheduling.owner_wip_limit → 降级读根 owner_wip_limit（v1 旧板兼容）→ 点名 M1"
assert_contains "$HOOK_OUT" "additionalContext" "33: v1 owner 级 fallback → 注入 additionalContext"
rm -rf "$H"

# Case 34 (v2 scheduling 优先于根字段)：板同时有 scheduling.wip_limit=1（v2 紧）与根 wip_limit=99（旧字段宽）。
#           v2 位置必须优先 → in_flight=2 > 1 → 警告。防降级 fallback 反客为主把根字段当真相源。
H="$(make_project)"; SID="sess-v2-precedence"
mkactive "$H" "b1" "{\"schema\":\"cc-master/v2\",\"goal\":\"g\",\"wip_limit\":99,\"scheduling\":{\"wip_limit\":1},\"owner\":{\"active\":true,\"session_id\":\"$SID\"},\"tasks\":[{\"id\":\"T1\",\"status\":\"in_flight\",\"deps\":[]},{\"id\":\"T2\",\"status\":\"in_flight\",\"deps\":[]}]}"
run_batch "$H" "$SID"
assert_eq 0 "$HOOK_RC" "34: v2 scheduling 优先于根 fallback → rc 0"
assert_contains "$HOOK_OUT" "WIP" "34: scheduling.wip_limit=1 优先于根 wip_limit=99 → in_flight=2>1 → 警告"
rm -rf "$H"

finish
