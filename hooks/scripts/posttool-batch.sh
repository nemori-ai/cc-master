#!/usr/bin/env bash
# PostToolBatch hook — WIP soft-warning (H5, design 2026-06-11 §5.1). After a batch of parallel tool
# calls is fully parsed, this hook reads THIS session's ACTIVE boards. `wip_limit` is a board-LOCAL
# cap, so EACH matched board is evaluated INDEPENDENTLY: its own in_flight count (N) vs its own
# top-level flexible `wip_limit` field (M). Any board with N > M contributes a NON-BLOCKING
# additionalContext warning carrying THAT board's numbers ("don't add more parallel work next round,
# defer high-float"). NEVER aggregate in_flight across boards against a single board's cap — that would
# (a) false-warn two boards each within their own cap, or (b) hide a board over its own smaller cap
# behind a sibling's larger cap (codex round-2 finding). It NEVER blocks — parallel freedom is
# preserved; this only nudges (lens 5 ~75% utilization). Pure bash, NO jq/node, ship-anywhere
# (Bedrock/Vertex/Foundry).
#
# Self-gating (silent exit 0, no warning) on any of:
#   - no matching active board for this session (dormant)
#   - every matched board has no `wip_limit` field / non-numeric one (graceful degrade — no threshold)
#   - every matched board is within its own cap (N <= M per board)
# It is READ-ONLY on the board, owns no sidecar, and emits ONLY additionalContext — never decision:block.
set -uo pipefail

HOME_DIR="${CC_MASTER_HOME:-${CLAUDE_PROJECT_DIR:-$(pwd)}/.claude/cc-master}"

# ── stdin → 顶层字段流（root-object top-level fields ONLY） ────────────────────────────────────────
input="$(cat)"

# stdin_top_fields — 把 stdin（经管道喂入）当成一个根 JSON 对象，只发射 curly-depth-1 且 bracket-depth-0
# 的字符，即根对象自己的顶层字段流；凡嵌进数组（tool_results[...]）或子对象的内容整体丢弃。
# 与本文件的 board_root_stream 完全同构——唯一区别是输入源从文件改成 stdin 字符串（awk 无文件参数即读 stdin）。
# 动因（CODEX10）：PostToolBatch 的 stdin 是一个 JSON 对象，顶层有 hook 元数据（session_id / agent_id /
# hook_event_name / transcript_path…），但还带 `tool_results`（一批工具调用的任意输出，可能含 JSON 或散文
# 如 "agent_id":"x" / "session_id":"y"）。旧版用贪婪全 stdin sed（.* 贪婪）→ 紧凑单行 JSON 下匹配到最后一个
# （嵌在 tool_results 里的）值，而非顶层元数据 → 主线 batch 的工具输出含 "agent_id" → 误判 sub-agent 而静默
# → 超 cap 主板收不到 WIP 警告；或工具输出含 "session_id":"other" → 匹配错 session → 武装判定错乱。先把 stdin
# 缩到顶层字段流，再从中 grep/sed，则 tool_results 内同名字段整体被丢弃。FORMAT-AGNOSTIC：单行紧凑与多行
# 缩进行为一致；string/escape 处理（引号内字符、\ 转义不被当结构括号）——与 board_root_stream 同。
stdin_top_fields() {
  awk '
    { s = s $0 "\n" }
    END {
      n = length(s)
      bd = 0; cd = 0; instr = 0; esc = 0; out = ""
      for (k = 1; k <= n; k++) {
        ch = substr(s, k, 1)
        if (instr) {
          if (bd == 0 && cd == 1) out = out ch
          if (esc) esc = 0
          else if (ch == "\\") esc = 1
          else if (ch == "\"") instr = 0
          continue
        }
        if (ch == "\"") { instr = 1; if (bd == 0 && cd == 1) out = out ch; continue }
        if (ch == "[") { bd++; continue }
        if (ch == "]") { if (bd > 0) bd--; continue }
        if (ch == "{") { cd++; continue }
        if (ch == "}") { if (cd > 0) cd--; continue }
        if (bd == 0 && cd == 1) out = out ch
      }
      printf "%s", out
    }'
}

# 只含 stdin 根对象顶层字段（tool_results[] 及任何嵌套对象的内容已整体丢弃）
top="$(printf '%s' "$input" | stdin_top_fields)"
sid="$(printf '%s' "$top" | sed -n 's/.*"session_id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)"

# ── SUB-AGENT 闸（红线4：指挥不演奏）──────────────────────────────────────────────────────────────────
# PostToolBatch 在 sub-agent（Task 派生的子 agent）上下文内部也触发；官方 stdin 此时带 `agent_id`（主线缺席）。
# 官方语义：sub-agent 内注入的 additionalContext 进的是该 leaf worker 自己的 context（贴在 tool result 旁）——
# 主编排者专属的 WIP/编排软警告绝不能泄漏给单元 worker（否则把指挥的乐谱递给乐手，破红线4：指挥不演奏）。
# 纯 bash 解析（红线1 禁 jq），比照上面 session_id：从 stdin 顶层字段流（top，已剥掉 tool_results）里只匹配
# 带引号的字符串值，故 `"agent_id":null` 或字段缺席 → 解析为空 → 视为主线；tool_results 内的 "agent_id" 已
# 被 stdin_top_fields 丢弃，不再污染（CODEX10）。非空（sub-agent）→ 静默 exit 0（在武装闸之前，最早可静默处）。
agent_id="$(printf '%s' "$top" | sed -n 's/.*"agent_id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)"
[ -n "$agent_id" ] && exit 0

# owner_region BOARD — print the ROOT "owner" object's DEPTH-1 FIELD STREAM only, via a string- and
# escape-aware depth scan ([ ] and { }) in POSIX awk. The board is one root object; this enters ONLY the
# `"owner"` key found at ROOT depth (curly depth 1, bracket depth 0) and emits the chars at the owner
# object's own field level (active / session_id / heartbeat) — every value nested DEEPER inside owner, or
# anywhere else in the file (tasks[], log[], deps[]), is dropped wholesale. FORMAT-AGNOSTIC: single-line
# and multi-line JSON behave identically. Used so the arming gate reads `active` / `session_id` ONLY from
# the board-root owner sub-object — an `"active":true` or a `session_id` buried in an agent-shaped
# task/log payload of an ARCHIVED board can never masquerade as owner's and false-arm the hook (CODEX7).
# Only a ROOT-depth `"owner"` key is honored (goal prose or a task with its own `"owner"` field can never
# be captured — same root-only caveat as board_root_stream). Mirrors tasks_region's string/escape rules.
owner_region() {
  awk '
    { s = s $0 "\n" }
    END {
      n = length(s)
      cd = 0; bd = 0; instr = 0; esc = 0
      capkey = 0; key = ""; pendKey = ""        # pendKey: last completed ROOT-depth key string
      inowner = 0; od = 0; out = ""
      for (k = 1; k <= n; k++) {
        ch = substr(s, k, 1)
        if (inowner) {                          # already inside the root owner object (opened at depth od)
          if (instr) {
            if (cd == od + 1 && bd == 0) out = out ch
            if (esc) esc = 0
            else if (ch == "\\") esc = 1
            else if (ch == "\"") instr = 0
            continue
          }
          if (ch == "\"") { instr = 1; if (cd == od + 1 && bd == 0) out = out ch; continue }
          if (ch == "[") { bd++; continue }
          if (ch == "]") { if (bd > 0) bd--; continue }
          if (ch == "{") { cd++; continue }
          if (ch == "}") { cd--; if (cd == od) { inowner = 0; break } continue }   # owner closed → done
          if (cd == od + 1 && bd == 0) out = out ch
          continue
        }
        if (instr) {                            # in a string while still scanning for root "owner":{
          if (esc) { esc = 0; if (capkey) key = key ch; continue }
          if (ch == "\\") { esc = 1; if (capkey) key = key ch; continue }
          if (ch == "\"") { instr = 0; if (capkey) { capkey = 0; pendKey = key } continue }
          if (capkey) key = key ch
          continue
        }
        if (ch == "\"") {                        # a string starting at ROOT depth is a candidate key
          instr = 1
          if (cd == 1 && bd == 0) { capkey = 1; key = "" } else capkey = 0
          continue
        }
        if (ch == "[") { bd++; pendKey = ""; continue }
        if (ch == "]") { if (bd > 0) bd--; continue }
        if (ch == "{") {
          cd++
          if (cd == 2 && bd == 0 && pendKey == "owner") { inowner = 1; od = 1 }   # entered root owner{}
          pendKey = ""
          continue
        }
        if (ch == "}") { if (cd > 0) cd--; pendKey = ""; continue }
        if (ch == ",") pendKey = ""
      }
      printf "%s", out
    }' "$1" 2>/dev/null
}

# ── board matching = THE ARMING GATE ────────────────────────────────────────────────────────────────
# A board is "mine" when active AND (sid empty → degraded: any active board; else owner.session_id==sid).
# The degrade is ASYMMETRIC — it fires ONLY when the STDIN sid is empty (ADR-007 §2.3: a compaction that
# drops session_id; the OWNING session re-anchoring across a compaction boundary). A board stamped with an
# EMPTY owner.session_id is NOT adopted: it falls through to "" = "<non-empty sid>" → false → DORMANT
# (fail-safe). Auto-adopting blank-session boards was tried (CODEX12) and REVERTED (CODEX14): it armed
# EVERY unrelated session, re-introducing the cross-session pollution red line 6 forbids. Official
# resume/compaction PRESERVES session_id, so a legitimately-resumed board carries its ORIGINAL session_id
# (never blank) and matches normally; a blank board is only bootstrap's anomaly on a sid-less stdin, claimed
# by an explicit re-arm (re-run as-master-orchestrator → bootstrap re-stamps it). → ADR-007.
# This board_matches IS the arming gate: the hook stays dormant (no WIP warning) until THIS session is
# armed (owns an active board). (Unified armed-hook discipline — same gate across the cc-master hooks.)
# active AND session_id are read ONLY from the ROOT owner sub-object (owner_region above) — NEVER full-text
# grep: a flexible tasks[]/log[] payload of an ARCHIVED board carrying `"active":true` must never false-arm
# the hook (CODEX7, red line 6). Mirrors verify-board.sh: never splice $sid into a grep -E pattern (regex
# metachars would mis-match); extract owner's session_id value with a fixed regex, compare as a literal string.
board_matches() { # $1 = board path
  owner="$(owner_region "$1")"
  printf '%s' "$owner" | grep -qE '"active"[[:space:]]*:[[:space:]]*true' || return 1
  [ -z "$sid" ] && return 0
  # A blank board_sid falls through to "" = "<non-empty sid>" → false → DORMANT (blank board is NOT
  # auto-adopted; red line 6).
  board_sid="$(printf '%s' "$owner" | grep -oE '"session_id"[[:space:]]*:[[:space:]]*"[^"]*"' \
               | sed -n 's/.*"session_id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)"
  [ "$board_sid" = "$sid" ]
}

# board_root_stream BOARD — print the BOARD ROOT OBJECT's TOP-LEVEL FIELD STREAM only, via a string-
# and escape-aware depth scan ([ ] and { }) in POSIX awk. The board file is one root object; this emits
# only characters at root depth (curly depth 1, bracket depth 0) — every value nested inside an array
# (tasks[], log[], deps[]) or sub-object (owner{}) is dropped wholesale. FORMAT-AGNOSTIC: single-line
# and multi-line JSON behave identically. Used so a `wip_limit` cap is read ONLY from the board's
# top-level field — a `"wip_limit":N` buried in an agent-shaped task/log payload can never masquerade as
# the real cap (codex round-2 finding). Mirrors verify-board.sh's region/per-object isolation.
board_root_stream() {
  awk '
    { s = s $0 "\n" }
    END {
      n = length(s)
      bd = 0; cd = 0; instr = 0; esc = 0; out = ""
      for (k = 1; k <= n; k++) {
        ch = substr(s, k, 1)
        if (instr) {
          if (bd == 0 && cd == 1) out = out ch
          if (esc) esc = 0
          else if (ch == "\\") esc = 1
          else if (ch == "\"") instr = 0
          continue
        }
        if (ch == "\"") { instr = 1; if (bd == 0 && cd == 1) out = out ch; continue }
        if (ch == "[") { bd++; continue }
        if (ch == "]") { if (bd > 0) bd--; continue }
        if (ch == "{") { cd++; continue }
        if (ch == "}") { if (cd > 0) cd--; continue }
        if (bd == 0 && cd == 1) out = out ch
      }
      printf "%s", out
    }' "$1" 2>/dev/null
}

# tasks_region BOARD — print the TOP-LEVEL FIELD STREAM of each object in the "tasks" array via a
# string- and escape-aware double-depth scan ([ ] and { }) in POSIX awk. FORMAT-AGNOSTIC: single-line
# and multi-line JSON behave identically. Nested flexible fields (a task-local "log" array, structured
# entries like {"id":"L1","status":"ready"} inside it) are dropped wholesale, so they can neither
# truncate the scan nor masquerade as task id/status. (Copied verbatim from verify-board.sh — the
# narrow-waist-safe way to count task state without jq.)
tasks_region() {
  awk '
    { s = s $0 "\n" }
    END {
      i = index(s, "\"tasks\""); if (!i) exit
      s = substr(s, i + 7)
      j = index(s, "["); if (!j) exit
      s = substr(s, j + 1)                 # start INSIDE the tasks array
      bd = 1; cd = 0; instr = 0; esc = 0; out = ""
      n = length(s)
      for (k = 1; k <= n; k++) {
        ch = substr(s, k, 1)
        if (instr) {
          if (bd == 1 && cd == 1) out = out ch
          if (esc) esc = 0
          else if (ch == "\\") esc = 1
          else if (ch == "\"") instr = 0
          continue
        }
        if (ch == "\"") { instr = 1; if (bd == 1 && cd == 1) out = out ch; continue }
        if (ch == "[") { bd++; continue }
        if (ch == "]") { bd--; if (bd == 0) break; continue }
        if (ch == "{") { cd++; continue }
        if (ch == "}") { cd--; continue }
        if (bd == 1 && cd == 1) out = out ch
      }
      printf "%s", out
    }' "$1" 2>/dev/null
}

# ── evaluate EACH matched board INDEPENDENTLY against its OWN board-local cap ───────────────────────
# wip_limit is board-LOCAL, so per board: count ITS in_flight, read ITS top-level wip_limit, and if that
# board is strictly over its OWN cap, append a warning carrying THAT board's numbers. No cross-board
# aggregation — each board stands on its own cap (codex round-2 finding).
matched=0; over_warn=""
for b in "$HOME_DIR"/*.board.json; do
  [ -e "$b" ] || continue                 # no boards → unexpanded glob
  board_matches "$b" || continue          # archived or not this session's → ignore
  matched=1

  # in_flight for THIS board only. Count in_flight tasks inside the tasks REGION only (log entries can't
  # masquerade as task state). Use `grep -oE | grep -c` (NOT a bare `grep -c`): the region is emitted as
  # a SINGLE LINE, so a line-counting `grep -c` would return 1 regardless of how many in_flight tasks
  # there are. `grep -o` prints one match per line first, so the second `grep -c` counts OCCURRENCES.
  # Keep the `|| n=0` fallback OUTSIDE the substitution: grep prints "0" AND exits 1 on zero matches, so
  # a `|| echo 0` inside $(...) would append a second "0" → "0\n0" → integer-test crash (verify-board.sh caveat).
  region="$(tasks_region "$b")"
  n="$(printf '%s' "$region" | grep -oE '"status"[[:space:]]*:[[:space:]]*"in_flight"' | grep -c '')" || n=0

  # wip_limit for THIS board: a board ROOT top-level flexible integer field. Read it from the board-root
  # field stream ONLY (board_root_stream above) so a `"wip_limit":N` buried in an agent-shaped task/log
  # payload can never be mistaken for the cap — only the board's own top-level field counts (narrow-waist
  # scope; codex round-2 finding).
  m="$(board_root_stream "$b" \
        | grep -oE '"wip_limit"[[:space:]]*:[[:space:]]*[0-9]+' 2>/dev/null \
        | sed -n 's/.*"wip_limit"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p' | head -1)"
  case "$m" in ''|*[!0-9]*) continue;; esac             # this board: no/non-numeric cap → skip it
  [ "$n" -le "$m" ] && continue                          # this board: within its own cap → no warn

  # this board is strictly over its OWN cap → contribute its warning
  over_warn="${over_warn}cc-master: WIP is at/over the cap (${n} in_flight, wip_limit ${m}). Don't add more parallel work next round — consider deferring high-float tasks to keep ~75% utilization (lens 5). This is a soft warning, not a block. "
done

# ── self-gate ──────────────────────────────────────────────────────────────────────────────────────
[ "$matched" -eq 0 ] && exit 0                          # no active board for this session → dormant
[ -z "$over_warn" ] && exit 0                            # no board over its own cap → nothing to warn

# ── one-or-more board over its own cap → inject NON-BLOCKING additionalContext (never decision:block) ─
warn="${over_warn% }"                                    # trim trailing separator space
esc="$(printf '%s' "$warn" | sed 's/\\/\\\\/g; s/"/\\"/g; s/^/"/; s/$/"/')"
printf '{"hookSpecificOutput":{"hookEventName":"PostToolBatch","additionalContext":%s}}\n' "$esc"
exit 0
