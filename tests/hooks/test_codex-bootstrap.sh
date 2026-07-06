#!/usr/bin/env bash
# Codex bootstrap minimal fresh path: launcher normalizes UserPromptSubmit, core creates an armed board.

. "$(dirname "$0")/helpers.sh"

LAUNCHER="$REPO_ROOT/plugin/src/hooks/_hosts/codex/launcher.js"
CORE="$REPO_ROOT/plugin/src/hooks/bootstrap-board/implementations/codex/bootstrap-board-core.js"

H="$(make_project)"
HOME_DIR="$H/home"
PAYLOAD='{"session_id":"codex-sess-1","hook_event_name":"UserPromptSubmit","prompt":"$cc-master:cc-master-as-master-orchestrator Ship the slice --priority high --wip 2 --policy-switch deny","cwd":"/tmp/work"}'

HOOK_OUT="$(printf '%s' "$PAYLOAD" | CC_MASTER_HOME="$HOME_DIR" node "$LAUNCHER" --core "$CORE" 2>/dev/null)"
HOOK_RC=$?

assert_eq 0 "$HOOK_RC" "codex bootstrap rc 0"
assert_valid_json "$HOOK_OUT" "codex bootstrap context envelope valid JSON"
assert_contains "$HOOK_OUT" '"systemMessage"' "codex bootstrap uses UserPromptSubmit systemMessage envelope"
assert_contains "$HOOK_OUT" "cc-master fresh: created and armed Codex orchestration board" "codex bootstrap reports armed board"
assert_contains "$HOOK_OUT" "MANDATORY NEXT STEP" "codex bootstrap requires DAG before work"
assert_contains "$HOOK_OUT" "zero tasks is not a runnable orchestration" "codex bootstrap rejects empty-board progress"

BOARD="$(find "$HOME_DIR/boards" -type f -name '*.board.json' | sort | head -n1)"
assert_file "$BOARD" "codex bootstrap board created"
assert_contains "$HOOK_OUT" "--board $BOARD" "codex bootstrap gives exact ccm board path"

GOAL="$(node -e 'const fs=require("fs");const b=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(String(b.goal||""));' "$BOARD")"
SID="$(node -e 'const fs=require("fs");const b=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(String((b.owner&&b.owner.session_id)||""));' "$BOARD")"
ACTIVE="$(node -e 'const fs=require("fs");const b=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(String(b.owner&&b.owner.active));' "$BOARD")"
WIP="$(node -e 'const fs=require("fs");const b=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(String(b.scheduling&&b.scheduling.wip_limit));' "$BOARD")"
PRIORITY="$(node -e 'const fs=require("fs");const b=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(String(b.coordination&&b.coordination.priority));' "$BOARD")"
POLICY="$(node -e 'const fs=require("fs");const b=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(String(b.policy&&b.policy.autonomous_account_switch));' "$BOARD")"
SESSION_STATE="$HOME_DIR/sessions/codex-sess-1.json"

assert_eq "Ship the slice" "$GOAL" "codex bootstrap records goal"
assert_eq "codex-sess-1" "$SID" "codex bootstrap stamps owner.session_id"
assert_eq "true" "$ACTIVE" "codex bootstrap arms owner.active"
assert_eq "2" "$WIP" "codex bootstrap maps --wip"
assert_eq "high" "$PRIORITY" "codex bootstrap maps --priority"
assert_eq "deny" "$POLICY" "codex bootstrap maps --policy-switch"
assert_file "$SESSION_STATE" "codex bootstrap writes session state"
STATE_BOARD="$(node -e 'const fs=require("fs");const s=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(String(s.board_path||""));' "$SESSION_STATE")"
STATE_HARNESS="$(node -e 'const fs=require("fs");const s=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(String(s.harness||""));' "$SESSION_STATE")"
STATE_MODE="$(node -e 'const fs=require("fs");const s=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(String(s.mode||""));' "$SESSION_STATE")"
assert_eq "$BOARD" "$STATE_BOARD" "codex bootstrap session state points at board"
assert_eq "codex" "$STATE_HARNESS" "codex bootstrap session state records harness"
assert_eq "fresh" "$STATE_MODE" "codex bootstrap session state records fresh mode"

ECHO_PAYLOAD='{"session_id":"codex-sess-1","hook_event_name":"SessionStart","source":"resume","cwd":"/tmp/work"}'
ECHO_OUT="$(printf '%s' "$ECHO_PAYLOAD" | CC_MASTER_HOME="$HOME_DIR" node "$LAUNCHER" --event SessionStart --echo-normalized 2>/dev/null)"
ECHO_BOARD="$(printf '%s' "$ECHO_OUT" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const j=JSON.parse(s);process.stdout.write(String(j.env.CC_MASTER_BOARD||""));});')"
ECHO_STEM="$(printf '%s' "$ECHO_OUT" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const j=JSON.parse(s);process.stdout.write(String(j.env.CC_MASTER_BOARD_STEM||""));});')"
ECHO_HARNESS="$(printf '%s' "$ECHO_OUT" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const j=JSON.parse(s);process.stdout.write(String(j.env.CC_MASTER_HARNESS||""));});')"
ECHO_SESSION="$(printf '%s' "$ECHO_OUT" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const j=JSON.parse(s);process.stdout.write(String(j.env.CC_MASTER_SESSION_ID||""));});')"
assert_eq "$BOARD" "$ECHO_BOARD" "codex launcher injects CC_MASTER_BOARD for later hooks"
assert_eq "$(basename "$BOARD" .board.json)" "$ECHO_STEM" "codex launcher injects CC_MASTER_BOARD_STEM"
assert_eq "codex" "$ECHO_HARNESS" "codex launcher injects CC_MASTER_HARNESS"
assert_eq "codex-sess-1" "$ECHO_SESSION" "codex launcher injects CC_MASTER_SESSION_ID"

NOOP='{"session_id":"codex-sess-2","hook_event_name":"UserPromptSubmit","prompt":"ordinary prompt","cwd":"/tmp/work"}'
NOOP_OUT="$(printf '%s' "$NOOP" | CC_MASTER_HOME="$H/noop-home" node "$LAUNCHER" --core "$CORE" 2>/dev/null)"
NOOP_RC=$?
assert_eq 0 "$NOOP_RC" "codex bootstrap no-op rc 0"
assert_eq "" "$NOOP_OUT" "codex bootstrap no-op emits nothing"
assert_no_file "$H/noop-home/boards" "codex bootstrap no-op creates no board dir"

RESET_HOME="$H/reset-home"
RESET_BOARD="$RESET_HOME/boards/reset.board.json"
mkdir -p "$RESET_HOME/boards"
CC_MASTER_HOME="$RESET_HOME" ccm --board "$RESET_BOARD" board init --goal "Reset stop release" --json --no-input >/dev/null
node - "$RESET_BOARD" <<'NODE'
const fs = require('fs');
const boardPath = process.argv[2];
const board = JSON.parse(fs.readFileSync(boardPath, 'utf8'));
board.owner = { ...(board.owner || {}), active: true, session_id: 'codex-sess-reset' };
board.runtime = { ...(board.runtime || {}), stop_allow_until: '2999-01-01T00:00:00Z' };
fs.writeFileSync(boardPath, `${JSON.stringify(board, null, 2)}\n`);
NODE
RESET_PAYLOAD='{"session_id":"codex-sess-reset","hook_event_name":"UserPromptSubmit","prompt":"ordinary prompt after user input","cwd":"/tmp/work"}'
RESET_OUT="$(printf '%s' "$RESET_PAYLOAD" | CC_MASTER_HOME="$RESET_HOME" node "$LAUNCHER" --core "$CORE" 2>/dev/null)"
RESET_RC=$?
RESET_UNTIL="$(node -e 'const fs=require("fs");const b=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(String(b.runtime&&b.runtime.stop_allow_until||""));' "$RESET_BOARD")"
assert_eq 0 "$RESET_RC" "codex bootstrap reset stop release rc 0"
assert_eq "" "$RESET_OUT" "codex bootstrap reset stop release stays silent"
assert_eq "1970-01-01T00:00:00Z" "$RESET_UNTIL" "ordinary UserPromptSubmit resets stop_allow_until for active session board"

RESUME_HOME="$H/resume-home"
mkdir -p "$RESUME_HOME/boards"
RESUME_BOARD="$RESUME_HOME/boards/resume-one.board.json"
cat >"$RESUME_BOARD" <<'JSON'
{
  "schema": "ccm-board/v1",
  "goal": "Resume existing Codex orchestration",
  "owner": {
    "active": false,
    "session_id": "old-session"
  },
  "tasks": [
    {
      "id": "T1",
      "title": "Preserve task",
      "status": "todo",
      "deps": []
    }
  ],
  "log": [
    {
      "ts": "2026-01-01T00:00:00Z",
      "msg": "preserve log"
    }
  ]
}
JSON
RESUME_PAYLOAD='{"session_id":"codex-sess-resume","hook_event_name":"UserPromptSubmit","prompt":"$cc-master:cc-master-as-master-orchestrator --resume resume-one","cwd":"/tmp/work"}'
RESUME_OUT="$(printf '%s' "$RESUME_PAYLOAD" | CC_MASTER_HOME="$RESUME_HOME" node "$LAUNCHER" --core "$CORE" 2>/dev/null)"
RESUME_RC=$?

assert_eq 0 "$RESUME_RC" "codex bootstrap resume rc 0"
assert_valid_json "$RESUME_OUT" "codex bootstrap resume context envelope valid JSON"
assert_contains "$RESUME_OUT" "cc-master resume: armed Codex orchestration board" "codex bootstrap resume reports armed board"
RESUME_SID="$(node -e 'const fs=require("fs");const b=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(String((b.owner&&b.owner.session_id)||""));' "$RESUME_BOARD")"
RESUME_ACTIVE="$(node -e 'const fs=require("fs");const b=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(String(b.owner&&b.owner.active));' "$RESUME_BOARD")"
RESUME_TASKS="$(node -e 'const fs=require("fs");const b=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(String((b.tasks||[]).length));' "$RESUME_BOARD")"
RESUME_LOG="$(node -e 'const fs=require("fs");const b=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(String((b.log||[]).length));' "$RESUME_BOARD")"

assert_eq "codex-sess-resume" "$RESUME_SID" "codex bootstrap resume restamps owner.session_id"
assert_eq "true" "$RESUME_ACTIVE" "codex bootstrap resume arms owner.active"
assert_eq "1" "$RESUME_TASKS" "codex bootstrap resume preserves tasks"
assert_eq "1" "$RESUME_LOG" "codex bootstrap resume preserves log"
RESUME_STATE="$RESUME_HOME/sessions/codex-sess-resume.json"
assert_file "$RESUME_STATE" "codex bootstrap resume writes session state"
RESUME_STATE_BOARD="$(node -e 'const fs=require("fs");const s=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(String(s.board_path||""));' "$RESUME_STATE")"
RESUME_STATE_MODE="$(node -e 'const fs=require("fs");const s=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(String(s.mode||""));' "$RESUME_STATE")"
assert_eq "$RESUME_BOARD" "$RESUME_STATE_BOARD" "codex bootstrap resume session state points at board"
assert_eq "resume" "$RESUME_STATE_MODE" "codex bootstrap session state records resume mode"

BUSY_HOME="$H/busy-home"
mkdir -p "$BUSY_HOME/boards"
BUSY_BOARD="$BUSY_HOME/boards/busy.board.json"
cat >"$BUSY_BOARD" <<'JSON'
{
  "schema": "ccm-board/v1",
  "goal": "Busy board",
  "owner": {
    "active": true,
    "session_id": "other-live-session"
  },
  "tasks": [],
  "log": []
}
JSON
BUSY_PAYLOAD='{"session_id":"codex-sess-new","hook_event_name":"UserPromptSubmit","prompt":"$cc-master:cc-master-as-master-orchestrator --resume busy","cwd":"/tmp/work"}'
BUSY_OUT="$(printf '%s' "$BUSY_PAYLOAD" | CC_MASTER_HOME="$BUSY_HOME" node "$LAUNCHER" --core "$CORE" 2>/dev/null)"
BUSY_RC=$?
BUSY_SID="$(node -e 'const fs=require("fs");const b=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(String((b.owner&&b.owner.session_id)||""));' "$BUSY_BOARD")"

assert_eq 0 "$BUSY_RC" "codex bootstrap resume busy rc 0"
assert_contains "$BUSY_OUT" "cc-master resume: refused to steal active board" "codex bootstrap resume refuses active foreign board"
assert_eq "other-live-session" "$BUSY_SID" "codex bootstrap resume does not steal foreign session"

rm -rf "$H"
finish
