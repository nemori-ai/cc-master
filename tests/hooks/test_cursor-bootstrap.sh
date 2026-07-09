#!/usr/bin/env bash
# Cursor bootstrap: launcher normalizes beforeSubmitPrompt, core creates an armed board.

. "$(dirname "$0")/helpers.sh"

LAUNCHER="$REPO_ROOT/plugin/src/hooks/_hosts/cursor/launcher.js"
CORE="$REPO_ROOT/plugin/src/hooks/bootstrap-board/implementations/cursor/bootstrap-board-core.js"

board_task_count() {
  node -e 'const fs=require("fs");const b=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));const tasks=Array.isArray(b.tasks)?b.tasks:[];process.stdout.write(String(tasks.length));' "$1";
}
board_github_issue_source() {
  node -e 'const b=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const s=b.source&&typeof b.source==="object"?b.source:{};process.stdout.write(s.kind==="github_issue"&&typeof s.url==="string"?s.url:"");' "$1";
}

H="$(make_project)"
HOME_DIR="$H/home"
PAYLOAD='{"conversation_id":"cursor-sess-1","session_id":"cursor-sess-1","hook_event_name":"beforeSubmitPrompt","prompt":"cc-master:as-master-orchestrator Ship the slice --priority high --wip 2 --policy-switch deny","cwd":"/tmp/work"}'

HOOK_OUT="$(printf '%s' "$PAYLOAD" | CC_MASTER_HOME="$HOME_DIR" node "$LAUNCHER" --core "$CORE" 2>/dev/null)"
HOOK_RC=$?

assert_eq 0 "$HOOK_RC" "cursor bootstrap rc 0"
assert_valid_json "$HOOK_OUT" "cursor bootstrap context envelope valid JSON"
assert_contains "$HOOK_OUT" '"user_message"' "cursor bootstrap uses user_message envelope"
assert_contains "$HOOK_OUT" '"continue":true' "cursor bootstrap continues prompt with ARM notice"
assert_not_contains "$HOOK_OUT" '"additional_context"' "cursor bootstrap does not use additional_context"
assert_contains "$HOOK_OUT" "cc-master fresh: created and armed Cursor orchestration board" "cursor bootstrap reports armed board"
assert_contains "$HOOK_OUT" "MANDATORY NEXT STEP" "cursor bootstrap requires DAG before work"
assert_contains "$HOOK_OUT" "zero tasks is not a runnable orchestration" "cursor bootstrap rejects empty-board progress"

BOARD="$(find "$HOME_DIR/boards" -type f -name '*.board.json' | sort | head -n1)"
BOARD="$(node -e 'process.stdout.write(require("path").resolve(process.argv[1]))' "$BOARD")"
assert_file "$BOARD" "cursor bootstrap board created"
assert_contains "$HOOK_OUT" "--board $BOARD" "cursor bootstrap gives exact ccm board path"

GOAL="$(node -e 'const fs=require("fs");const b=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(String(b.goal||""));' "$BOARD")"
SID="$(node -e 'const fs=require("fs");const b=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(String((b.owner&&b.owner.session_id)||""));' "$BOARD")"
ACTIVE="$(node -e 'const fs=require("fs");const b=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(String(b.owner&&b.owner.active));' "$BOARD")"
WIP="$(node -e 'const fs=require("fs");const b=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(String(b.scheduling&&b.scheduling.wip_limit));' "$BOARD")"
PRIORITY="$(node -e 'const fs=require("fs");const b=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(String(b.coordination&&b.coordination.priority));' "$BOARD")"
POLICY="$(node -e 'const fs=require("fs");const b=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(String(b.policy&&b.policy.autonomous_account_switch));' "$BOARD")"
SESSION_STATE="$HOME_DIR/sessions/cursor-sess-1.json"

assert_eq "Ship the slice" "$GOAL" "cursor bootstrap records goal"
assert_eq "cursor-sess-1" "$SID" "cursor bootstrap stamps owner.session_id"
assert_eq "true" "$ACTIVE" "cursor bootstrap arms owner.active"
assert_eq "2" "$WIP" "cursor bootstrap maps --wip"
assert_eq "high" "$PRIORITY" "cursor bootstrap maps --priority"
assert_eq "deny" "$POLICY" "cursor bootstrap maps --policy-switch"
assert_file "$SESSION_STATE" "cursor bootstrap writes session state"
STATE_BOARD="$(node -e 'const fs=require("fs");const s=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(String(s.board_path||""));' "$SESSION_STATE")"
STATE_HARNESS="$(node -e 'const fs=require("fs");const s=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(String(s.harness||""));' "$SESSION_STATE")"
STATE_MODE="$(node -e 'const fs=require("fs");const s=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(String(s.mode||""));' "$SESSION_STATE")"
assert_eq "$BOARD" "$STATE_BOARD" "cursor bootstrap session state points at board"
assert_eq "cursor" "$STATE_HARNESS" "cursor bootstrap session state records harness"
assert_eq "fresh" "$STATE_MODE" "cursor bootstrap session state records fresh mode"

ECHO_PAYLOAD='{"conversation_id":"cursor-sess-1","session_id":"cursor-sess-1","hook_event_name":"sessionStart","cwd":"/tmp/work"}'
ECHO_OUT="$(printf '%s' "$ECHO_PAYLOAD" | CC_MASTER_HOME="$HOME_DIR" node "$LAUNCHER" --event sessionStart --echo-normalized 2>/dev/null)"
ECHO_BOARD="$(printf '%s' "$ECHO_OUT" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const j=JSON.parse(s);process.stdout.write(String(j.env.CC_MASTER_BOARD||""));});')"
ECHO_STEM="$(printf '%s' "$ECHO_OUT" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const j=JSON.parse(s);process.stdout.write(String(j.env.CC_MASTER_BOARD_STEM||""));});')"
ECHO_HARNESS="$(printf '%s' "$ECHO_OUT" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const j=JSON.parse(s);process.stdout.write(String(j.env.CC_MASTER_HARNESS||""));});')"
ECHO_SESSION="$(printf '%s' "$ECHO_OUT" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const j=JSON.parse(s);process.stdout.write(String(j.env.CC_MASTER_SESSION_ID||""));});')"
ECHO_SOURCE="$(printf '%s' "$ECHO_OUT" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const j=JSON.parse(s);process.stdout.write(String(j.env.CC_MASTER_BOARD_SOURCE||""));});')"
assert_eq "$BOARD" "$ECHO_BOARD" "cursor launcher injects CC_MASTER_BOARD for later hooks"
assert_eq "$(basename "$BOARD" .board.json)" "$ECHO_STEM" "cursor launcher injects CC_MASTER_BOARD_STEM"
assert_eq "cursor" "$ECHO_HARNESS" "cursor launcher injects CC_MASTER_HARNESS"
assert_eq "cursor-sess-1" "$ECHO_SESSION" "cursor launcher injects CC_MASTER_SESSION_ID"
assert_eq "session-state" "$ECHO_SOURCE" "cursor launcher prefers session-state board discovery"

NOOP='{"conversation_id":"cursor-sess-2","session_id":"cursor-sess-2","hook_event_name":"beforeSubmitPrompt","prompt":"ordinary prompt","cwd":"/tmp/work"}'
NOOP_OUT="$(printf '%s' "$NOOP" | CC_MASTER_HOME="$H/noop-home" node "$LAUNCHER" --core "$CORE" 2>/dev/null)"
NOOP_RC=$?
assert_eq 0 "$NOOP_RC" "cursor bootstrap no-op rc 0"
assert_eq "" "$NOOP_OUT" "cursor bootstrap no-op emits nothing"
assert_no_file "$H/noop-home/boards" "cursor bootstrap no-op creates no board dir"

MARKER_PAYLOAD="$(printf '%s' '{"conversation_id":"cursor-sess-marker","session_id":"cursor-sess-marker","hook_event_name":"beforeSubmitPrompt","prompt":"<!-- cc-master:bootstrap:v1 -->\n<!-- cc-master:args: Marker goal --wip 3 -->\n","cwd":"/tmp/work"}')"
MARKER_OUT="$(printf '%s' "$MARKER_PAYLOAD" | CC_MASTER_HOME="$H/marker-home" node "$LAUNCHER" --core "$CORE" 2>/dev/null)"
assert_eq 0 "$?" "cursor bootstrap expanded marker rc 0"
assert_contains "$MARKER_OUT" "cc-master fresh: created and armed Cursor orchestration board" "cursor bootstrap expanded marker arms"
MARKER_BOARD="$(find "$H/marker-home/boards" -type f -name '*.board.json' | sort | head -n1)"
MARKER_GOAL="$(node -e 'const fs=require("fs");const b=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(String(b.goal||""));' "$MARKER_BOARD")"
MARKER_WIP="$(node -e 'const fs=require("fs");const b=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(String(b.scheduling&&b.scheduling.wip_limit));' "$MARKER_BOARD")"
assert_eq "Marker goal" "$MARKER_GOAL" "cursor bootstrap marker recovers goal"
assert_eq "3" "$MARKER_WIP" "cursor bootstrap marker recovers --wip"

RESUME_HOME="$H/resume-home"
mkdir -p "$RESUME_HOME/boards"
RESUME_BOARD="$RESUME_HOME/boards/resume-one.board.json"
cat >"$RESUME_BOARD" <<'JSON'
{
  "schema": "ccm-board/v1",
  "goal": "Resume existing Cursor orchestration",
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
RESUME_PAYLOAD='{"conversation_id":"cursor-sess-resume","session_id":"cursor-sess-resume","hook_event_name":"beforeSubmitPrompt","prompt":"cc-master:as-master-orchestrator --resume resume-one","cwd":"/tmp/work"}'
RESUME_OUT="$(printf '%s' "$RESUME_PAYLOAD" | CC_MASTER_HOME="$RESUME_HOME" node "$LAUNCHER" --core "$CORE" 2>/dev/null)"
RESUME_RC=$?

assert_eq 0 "$RESUME_RC" "cursor bootstrap resume rc 0"
assert_contains "$RESUME_OUT" '"user_message"' "cursor bootstrap resume uses user_message envelope"
assert_contains "$RESUME_OUT" "cc-master resume: armed Cursor orchestration board" "cursor bootstrap resume reports armed board"
RESUME_SID="$(node -e 'const fs=require("fs");const b=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(String((b.owner&&b.owner.session_id)||""));' "$RESUME_BOARD")"
RESUME_ACTIVE="$(node -e 'const fs=require("fs");const b=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(String(b.owner&&b.owner.active));' "$RESUME_BOARD")"
RESUME_TASKS="$(node -e 'const fs=require("fs");const b=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(String((b.tasks||[]).length));' "$RESUME_BOARD")"
assert_eq "cursor-sess-resume" "$RESUME_SID" "cursor bootstrap resume restamps owner.session_id"
assert_eq "true" "$RESUME_ACTIVE" "cursor bootstrap resume arms owner.active"
assert_eq "1" "$RESUME_TASKS" "cursor bootstrap resume preserves tasks"

# ccm missing: refuse arm, no board created.
MISSING_HOME="$H/missing-ccm-home"
FAKE_BIN="$H/fake-bin"
mkdir -p "$FAKE_BIN"
MISSING_PAYLOAD='{"conversation_id":"cursor-sess-missing","session_id":"cursor-sess-missing","hook_event_name":"beforeSubmitPrompt","prompt":"cc-master:as-master-orchestrator Missing ccm goal","cwd":"/tmp/work"}'
MISSING_OUT="$(
  printf '%s' "$MISSING_PAYLOAD" |
    CC_MASTER_HOME="$MISSING_HOME" PATH="$FAKE_BIN" CCM_BIN= "$(command -v node)" "$LAUNCHER" --core "$CORE" 2>/dev/null
)"
assert_contains "$MISSING_OUT" '"continue":false' "cursor bootstrap ccm missing -> continue false"
assert_contains "$MISSING_OUT" '"user_message"' "cursor bootstrap ccm missing -> user_message directive"
assert_contains "$MISSING_OUT" 'source=\"bootstrap\"' "cursor bootstrap ccm missing -> bootstrap directive"
assert_no_file "$MISSING_HOME/boards" "cursor bootstrap ccm missing creates no board dir"

rm -rf "$H"
finish
