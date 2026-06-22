#!/usr/bin/env bash
. "$(dirname "$0")/helpers.sh"

mkactive() { mkdir -p "$1"; printf '%s' "$3" > "$1/$2.board.json"; }
# run_ss HOME — run reinject with EMPTY stdin (no session_id → degraded: match any active board).
run_ss() {
  HOOK_OUT="$(CLAUDE_PROJECT_DIR="/nonexistent-proj" CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" CC_MASTER_HOME="$1" \
             bash "$PLUGIN_ROOT/hooks/scripts/reinject.sh" </dev/null 2>/dev/null)"; HOOK_RC=$?
}
# run_ss_sid HOME SID — run reinject with stdin JSON carrying session_id=SID (SessionStart-shaped).
# Session-scoped armed gate: only THIS session's active board(s) re-anchor the role.
run_ss_sid() {
  HOOK_OUT="$(printf '{"session_id":"%s","hook_event_name":"SessionStart","source":"compact"}' "$2" \
             | CLAUDE_PROJECT_DIR="/nonexistent-proj" CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" CC_MASTER_HOME="$1" \
               bash "$PLUGIN_ROOT/hooks/scripts/reinject.sh" 2>/dev/null)"; HOOK_RC=$?
}
# dangling_segment OUT — isolate JUST the dangling-node id list from a reinject context (the text after
# `stale/escalated:` up to the next period). TF1 FIX: a negative id assertion (e.g. "T2 must NOT appear")
# must NOT scan the WHOLE $HOOK_OUT — that output EMBEDS ${HOME_DIR}, a `mktemp .tmp-ccm.XXXXXX` path
# whose random base-62 suffix contains the literal "T2" ≈0.12% of the time (and "T9" similarly). Scanning
# the full output therefore false-FAILS `assert_not_contains "$HOOK_OUT" "T2"` whenever the temp path
# happens to carry that substring — the dominant full-suite reinject flake (load-independent; it is pure
# substring collision, surfacing more often under suite load only because more runs accumulate). The
# dangling-id LIST is built solely from board task ids and never includes the path, so assert the negative
# (and the positive ids) against THIS segment. Empty when there is no dangling note (the no-note cases).
dangling_segment() { # $1 = HOOK_OUT
  printf '%s' "$1" | sed -n 's/.*stale\/escalated:[[:space:]]*\([^.]*\)\..*/\1/p'
}

# Case A: no active board → silent no-op
H="$(make_project)"
run_ss "$H"
assert_eq 0 "$HOOK_RC" "no active board → rc 0"
assert_eq "" "$HOOK_OUT" "no active board → no output"
rm -rf "$H"

# Case B: an active board with a goal → re-injects role + home + goal + board name
H="$(make_project)"
mkactive "$H" "20260101T000000Z-1" '{"schema":"cc-master/v1","goal":"INTERNATIONALIZE THE APP TO 6 LOCALES","owner":{"active":true},"tasks":[{"id":"T1","status":"ready","deps":[]}]}'
run_ss "$H"
assert_contains "$HOOK_OUT" "INTERNATIONALIZE THE APP TO 6 LOCALES" "re-injects the goal"
assert_contains "$HOOK_OUT" "orchestrator" "re-anchors the role"
assert_contains "$HOOK_OUT" "20260101T000000Z-1.board.json" "names the active board"
assert_contains "$HOOK_OUT" "$H" "points at the home dir"
rm -rf "$H"

# Case C: only an archived board (active:false) → no-op
H="$(make_project)"
mkactive "$H" "b1" '{"schema":"cc-master/v1","goal":"OLD DONE TASK","owner":{"active":false},"tasks":[]}'
run_ss "$H"
assert_eq "" "$HOOK_OUT" "archived-only home → no output"
rm -rf "$H"

# Case D: two active boards → lists both goals
H="$(make_project)"
mkactive "$H" "a" '{"schema":"cc-master/v1","goal":"TASK ALPHA","owner":{"active":true},"tasks":[{"id":"T1","status":"in_flight","deps":[]}]}'
mkactive "$H" "b" '{"schema":"cc-master/v1","goal":"TASK BETA","owner":{"active":true},"tasks":[{"id":"T1","status":"in_flight","deps":[]}]}'
run_ss "$H"
assert_contains "$HOOK_OUT" "TASK ALPHA" "lists first active goal"
assert_contains "$HOOK_OUT" "TASK BETA" "lists second active goal"
rm -rf "$H"

# Case E: backward compat — a legacy board that still carries a residual `phase` block must NOT
# inject any phase note (the phase mechanism is gone) and must not error: goal/role/board are
# re-injected exactly as for a board with no phase at all.
H="$(make_project)"
mkactive "$H" "20260101T000000Z-1" '{"schema":"cc-master/v1","goal":"LEGACY PHASE BOARD","owner":{"active":true},"phase":{"current":"OLD PHASE NAME","goal_condition":"some old condition","task_ids":["T1","T2"]},"tasks":[{"id":"T1","status":"in_flight","deps":[]}]}'
run_ss "$H"
assert_eq 0 "$HOOK_RC" "residual phase block → still rc 0 (no error)"
assert_contains "$HOOK_OUT" "LEGACY PHASE BOARD" "still re-injects the goal when a residual phase block is present"
assert_contains "$HOOK_OUT" "orchestrator" "still re-anchors the role"
assert_not_contains "$HOOK_OUT" "OLD PHASE NAME" "residual phase.current must not be injected"
assert_not_contains "$HOOK_OUT" "some old condition" "residual phase.goal_condition must not be injected"
assert_not_contains "$HOOK_OUT" "/goal" "no /goal guidance injected anymore"
assert_not_contains "$HOOK_OUT" "phase" "no phase reminder injected anymore"
rm -rf "$H"

# Case F: an active board with NO phase field → goal/role/board re-injected, no phase reminder.
H="$(make_project)"
mkactive "$H" "20260101T000000Z-2" '{"schema":"cc-master/v1","goal":"NO PHASE HERE","owner":{"active":true},"tasks":[{"id":"T1","status":"ready","deps":[]}]}'
run_ss "$H"
assert_contains "$HOOK_OUT" "NO PHASE HERE" "still re-injects the goal when no phase"
assert_not_contains "$HOOK_OUT" "phase" "no phase reminder when board has no phase"
rm -rf "$H"

# ── H4: resume-side dangling-node report ──────────────────────────────────────────────────────────
# On resume/compact, beyond re-anchoring the role, name the board's unresolved (stale/escalated)
# nodes so a plan-update transaction break is called out on resume.

# Case G: active board with 1 stale + 1 escalated → ctx names them as unresolved, lists both ids.
H="$(make_project)"
mkactive "$H" "20260101T000000Z-3" '{"schema":"cc-master/v1","goal":"RECONCILE GOAL","owner":{"active":true},"tasks":[{"id":"T1","status":"stale","deps":[]},{"id":"T2","status":"in_flight","deps":[]},{"id":"T3","status":"escalated","deps":[]}]}'
run_ss "$H"
assert_contains "$HOOK_OUT" "RECONCILE GOAL" "G: still re-injects the goal"
assert_contains "$HOOK_OUT" "orchestrator" "G: still re-anchors the role"
assert_contains "$HOOK_OUT" "unresolved" "G: surfaces an unresolved-node note"
# Assert the ids against the dangling-id LIST only (path-free) — see dangling_segment (TF1: $HOOK_OUT
# embeds the temp HOME_DIR path, whose random suffix can carry "T2"/"T3" and false-fail/pass otherwise).
G_DANGLE="$(dangling_segment "$HOOK_OUT")"
assert_contains "$G_DANGLE" "T1" "G: names the stale node id"
assert_contains "$G_DANGLE" "T3" "G: names the escalated node id"
assert_not_contains "$G_DANGLE" "T2" "G: does not name a non-dangling (in_flight) node"
rm -rf "$H"

# Case H: active board with NO stale/escalated (all ready/in_flight/done) → ctx unchanged, no note.
H="$(make_project)"
mkactive "$H" "20260101T000000Z-4" '{"schema":"cc-master/v1","goal":"ALL CLEAR GOAL","owner":{"active":true},"tasks":[{"id":"T1","status":"ready","deps":[]},{"id":"T2","status":"in_flight","deps":[]},{"id":"T3","status":"done","deps":[]}]}'
run_ss "$H"
assert_contains "$HOOK_OUT" "ALL CLEAR GOAL" "H: re-injects the goal"
assert_not_contains "$HOOK_OUT" "unresolved" "H: no dangling-node note when nothing is stale/escalated"
rm -rf "$H"

# Case I: no active board → still silent (H4 must not break the dormant no-op).
H="$(make_project)"
mkactive "$H" "b1" '{"schema":"cc-master/v1","goal":"ARCHIVED","owner":{"active":false},"tasks":[{"id":"T1","status":"stale","deps":[]}]}'
run_ss "$H"
assert_eq "" "$HOOK_OUT" "I: archived board with a stale task → still silent (dormant)"
rm -rf "$H"

# Case J: stale/escalated tokens living only inside a nested task-local "log" array must NOT trip the
# dangling-node note (the tasks-region scan isolates nested fields — same guard as verify-board.sh).
H="$(make_project)"
mkactive "$H" "20260101T000000Z-5" '{"schema":"cc-master/v1","goal":"NESTED LOG GOAL","owner":{"active":true},"tasks":[{"id":"T1","status":"in_flight","deps":[],"log":[{"id":"L1","status":"stale"},{"id":"L2","status":"escalated"}]}]}'
run_ss "$H"
assert_contains "$HOOK_OUT" "NESTED LOG GOAL" "J: re-injects the goal"
assert_not_contains "$HOOK_OUT" "unresolved" "J: nested log stale/escalated does not trip the note"
rm -rf "$H"

# ── ARMED GATE: reinject is now SESSION-SCOPED (no longer home-scoped) ──────────────────────────────
# A hook stays dormant until THIS session is armed (active board with owner.session_id==stdin sid).
# reinject used to activate on ANY active board in home (home-scoped) — a brand-new session that
# never ran as-master-orchestrator would get falsely re-anchored as an orchestrator just because some
# OTHER session left an active board behind. These cases pin the session-scoped behavior.

# Case K (session match): board owned by THIS session → re-anchor (role + goal + board name).
H="$(make_project)"
mkactive "$H" "20260101T000000Z-K" '{"schema":"cc-master/v1","goal":"MY SESSION GOAL","owner":{"active":true,"session_id":"sess-mine"},"tasks":[{"id":"T1","status":"ready","deps":[]}]}'
run_ss_sid "$H" "sess-mine"
assert_eq 0 "$HOOK_RC" "K: my session's active board → rc 0"
assert_contains "$HOOK_OUT" "MY SESSION GOAL" "K: my session's board → re-injects the goal"
assert_contains "$HOOK_OUT" "orchestrator" "K: my session's board → re-anchors the role"
assert_contains "$HOOK_OUT" "20260101T000000Z-K.board.json" "K: my session's board → names it"
rm -rf "$H"

# Case L (FALSE-ACTIVATION GAP, the core fix): home has an active board owned by ANOTHER session, and
# THIS is a fresh session that never ran as-master-orchestrator → reinject must be SILENT (the new
# session is NOT an orchestrator; the leftover board is not its concern).
H="$(make_project)"
mkactive "$H" "20260101T000000Z-L" '{"schema":"cc-master/v1","goal":"OTHER SESSION GOAL","owner":{"active":true,"session_id":"sess-other"},"tasks":[{"id":"T1","status":"in_flight","deps":[]}]}'
run_ss_sid "$H" "sess-fresh-newcomer"
assert_eq 0 "$HOOK_RC" "L: other session's board, fresh session → rc 0"
assert_eq "" "$HOOK_OUT" "L: other session's active board does NOT activate a fresh session (false-activation gap closed)"
rm -rf "$H"

# Case M (mixed home): two active boards, one mine one another session's → only MY goal re-injected,
# the other session's goal is NOT leaked into my context.
H="$(make_project)"
mkactive "$H" "mine"  '{"schema":"cc-master/v1","goal":"GOAL FOR ME","owner":{"active":true,"session_id":"sess-m"},"tasks":[{"id":"T1","status":"in_flight","deps":[]}]}'
mkactive "$H" "other" '{"schema":"cc-master/v1","goal":"GOAL FOR THEM","owner":{"active":true,"session_id":"sess-o"},"tasks":[{"id":"T1","status":"in_flight","deps":[]}]}'
run_ss_sid "$H" "sess-m"
assert_contains "$HOOK_OUT" "GOAL FOR ME" "M: re-injects MY session's goal"
assert_not_contains "$HOOK_OUT" "GOAL FOR THEM" "M: does NOT leak the other session's goal"
rm -rf "$H"

# Case N (session-scoped H4 dangling note): stale/escalated only counted on MY board. My board is
# clean; the OTHER session's board has a stale node → no dangling note (it's not mine to reconcile).
H="$(make_project)"
mkactive "$H" "mine"  '{"schema":"cc-master/v1","goal":"CLEAN GOAL","owner":{"active":true,"session_id":"sess-n"},"tasks":[{"id":"T1","status":"in_flight","deps":[]}]}'
mkactive "$H" "other" '{"schema":"cc-master/v1","goal":"DIRTY GOAL","owner":{"active":true,"session_id":"sess-x"},"tasks":[{"id":"T9","status":"stale","deps":[]}]}'
run_ss_sid "$H" "sess-n"
assert_contains "$HOOK_OUT" "CLEAN GOAL" "N: re-injects my clean goal"
assert_not_contains "$HOOK_OUT" "unresolved" "N: other session's stale node does not trip MY dangling note"
# No dangling note fires here, so the id list is empty — assert T9 is absent from it (path-free; see
# dangling_segment / TF1: a bare `assert_not_contains "$HOOK_OUT" "T9"` could false-fail when the random
# temp HOME_DIR suffix carries "T9").
assert_not_contains "$(dangling_segment "$HOOK_OUT")" "T9" "N: other session's stale node id not surfaced to me"
rm -rf "$H"

# Case O (session-scoped H4, positive): MY board has a stale node → my dangling note fires, naming it.
H="$(make_project)"
mkactive "$H" "20260101T000000Z-O" '{"schema":"cc-master/v1","goal":"RECONCILE MINE","owner":{"active":true,"session_id":"sess-o2"},"tasks":[{"id":"T1","status":"in_flight","deps":[]},{"id":"T5","status":"stale","deps":[]}]}'
run_ss_sid "$H" "sess-o2"
assert_contains "$HOOK_OUT" "unresolved" "O: my own stale node trips the dangling note"
assert_contains "$(dangling_segment "$HOOK_OUT")" "T5" "O: my own stale node id is named"   # path-free (TF1)
rm -rf "$H"

# Case P (degraded: no session_id → match any active, compaction-boundary robustness). A SessionStart
# whose stdin carries no session_id falls back to home-scoped matching so a compaction that drops the
# sid still re-anchors. (Preserves the original behavior under the degraded path.)
H="$(make_project)"
mkactive "$H" "20260101T000000Z-P" '{"schema":"cc-master/v1","goal":"DEGRADED GOAL","owner":{"active":true,"session_id":"sess-whatever"},"tasks":[{"id":"T1","status":"in_flight","deps":[]}]}'
run_ss "$H"   # empty stdin → no sid → degraded
assert_contains "$HOOK_OUT" "DEGRADED GOAL" "P: empty session_id → degraded match any active board (compaction robustness)"
rm -rf "$H"

# ── 武装闸：active/session_id 只从 board 根的 owner 子对象读（CODEX7，破红线 6 修复回归用例）─────────
# 旧版 board_matches 用全文 grep 判 arming，会把归档板某个 flexible 载荷里的 `"active":true` 误读为 owner
# 的 active，head -1 取到的第一个 session_id 仍是 owner.session_id —— 若它 == 当前 sid，归档板被误判 armed，
# reinject 仍会把已 /stop 归档的目标重注回上下文。下面两例锁死「只从 owner 子对象读」。

# Case Q (CODEX7 回归)：归档板 owner.active:false、owner.session_id == 本 session sid，log[] 嵌套对象塞
#          "active":true + 混淆 "session_id":"OTHER"。owner 子对象本身 active:false → reinject 必须休眠
#          （空 stdout，不重注目标 / 角色）。修前全文 grep 命中 → 误判 armed → 误重注归档目标。
H="$(make_project)"
mkactive "$H" "20260101T000000Z-Q" '{"schema":"cc-master/v1","goal":"ARCHIVED FALSE-ARM GOAL","owner":{"active":false,"session_id":"sess-arch"},"tasks":[{"id":"T1","status":"in_flight","deps":[]}],"log":[{"id":"L1","snapshot":{"active":true,"session_id":"OTHER"}}]}'
run_ss_sid "$H" "sess-arch"
assert_eq 0 "$HOOK_RC" "Q: 归档板含嵌套 active:true → rc 0"
assert_eq "" "$HOOK_OUT" "Q: 归档板（owner.active:false）+ 嵌套 active:true → 休眠（owner 子对象才算数，不重注归档目标）"
rm -rf "$H"

# Case R (反向保活)：真 active 板（owner.active:true、owner.session_id == sid），某 task 嵌套
#          "active":false —— reinject 仍照常重注角色 + 目标。防过度修复。
H="$(make_project)"
mkactive "$H" "20260101T000000Z-R" '{"schema":"cc-master/v1","goal":"REAL ACTIVE GOAL","owner":{"active":true,"session_id":"sess-rr"},"tasks":[{"id":"T1","status":"in_flight","deps":[],"meta":{"active":false}}]}'
run_ss_sid "$H" "sess-rr"
assert_eq 0 "$HOOK_RC" "R: 真 active 板含嵌套 active:false → rc 0"
assert_contains "$HOOK_OUT" "REAL ACTIVE GOAL" "R: 真 active 板（owner.active:true）照常重注目标"
assert_contains "$HOOK_OUT" "orchestrator" "R: 真 active 板照常重注角色"
rm -rf "$H"

# ── 非对称 degrade：blank-session 板（owner.session_id 空串）对非空 stdin sid 保持休眠（CODEX14 回退）──
# 上一轮（CODEX12）曾对称 degrade 收养空 board sid；本轮（CODEX14）回退：收养会武装任意不相关 session，破红线 6。
# 裁决（ADR-007 §2.3 / §4.5）：红线 6（非协商）优先于孤儿边缘 case。合法续跑因 resume/compaction 保留
# session_id、板带原 session_id 故照常匹配；异常 blank 板保持休眠（fail-safe），由显式 re-arm 认领。
# 「board sid 非空但 ≠ stdin sid」同样休眠（红线 6 防真跨会话污染，一字不动）。

# Case S (CODEX14 回退：blank-session 板对非空 stdin sid 休眠)：active 板 owner.session_id:""（空串），带 goal，
#          stdin 带**非空** session_id。"" != "sess-resume" → 不武装 → 静默（不重注）。这正是红线 6 要的
#          fail-safe：blank 板不收养任意 session。
H="$(make_project)"
mkactive "$H" "20260101T000000Z-S" '{"schema":"cc-master/v1","goal":"ORPHANED EMPTY-SID GOAL","owner":{"active":true,"session_id":""},"tasks":[{"id":"T1","status":"in_flight","deps":[]}]}'
run_ss_sid "$H" "sess-resume"
assert_eq 0 "$HOOK_RC" "S: blank-session 板 + 非空 stdin sid → rc 0"
assert_eq "" "$HOOK_OUT" "S: blank-session 板（owner.session_id:\"\"）对非空 stdin sid → 休眠，不重注（CODEX14 回退，红线 6 fail-safe）"
rm -rf "$H"

# Case T (红线 6 防线保活：board sid 非空且 ≠ stdin sid 仍休眠)：active 板 owner.session_id:"OTHER"
#          （非空），带 goal，stdin sid "MINE"（不同）→ 必须静默（空 stdout，不重注）。证明对称 degrade
#          **没有**退化成「任何 active 板即武装」—— false-activation gap / 红线 6 防线原样保留。
H="$(make_project)"
mkactive "$H" "20260101T000000Z-T" '{"schema":"cc-master/v1","goal":"OTHER NONEMPTY-SID GOAL","owner":{"active":true,"session_id":"OTHER"},"tasks":[{"id":"T1","status":"in_flight","deps":[]}]}'
run_ss_sid "$H" "MINE"
assert_eq 0 "$HOOK_RC" "T: board sid 非空且 ≠ stdin sid → rc 0"
assert_eq "" "$HOOK_OUT" "T: board sid=OTHER（非空）≠ stdin sid=MINE → 仍休眠（不重注，红线 6 防线未退化）"
rm -rf "$H"

finish
