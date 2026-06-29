#!/usr/bin/env bash
# =====================================================================================
# cc-master — end-to-end hook-chain smoke test (the "talking walkthrough")
# =====================================================================================
# This is the RUNNABLE proof behind walkthrough.md. Where tests/hooks/test_flow.sh is a
# terse assertion suite, this script narrates: at every step it prints *what happened* and
# *what the hook decided*, in plain language, so a human can read along and see the
# orchestration come alive. It also doubles as a CI smoke check (PASS/FAIL + exit code).
#
# It drives the three real hooks against a throwaway $CC_MASTER_HOME, in the exact order a
# live orchestration hits them:
#   1. bootstrap-board.sh  — UserPromptSubmit: the /as-master-orchestrator command fires it,
#                            it creates a fresh board and injects its path + the role.
#   2. (we write a toy DAG into that board — standing in for the agent's decomposition)
#   3. reinject.js         — SessionStart(compact|resume): re-injects role + board listing.
#   4. verify-board.js     — Stop (the goal-hook): gates the agent across four board states.
#   5. archive             — owner.active:false → reinject goes silent (orchestration stood down).
#
# Run:   bash examples/sample-orchestration/smoke.sh
# Needs: bash + the cc-master hook scripts. No jq, no node, no network. macOS bash 3.2 OK.
# =====================================================================================
set -uo pipefail

# ── locate the plugin root (this file lives at <root>/examples/sample-orchestration/) ──
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
HOOKS="$ROOT/hooks/scripts"

# ── throwaway home, isolated from any real orchestration ──────────────────────────────
HOME_DIR="$(mktemp -d "${TMPDIR:-/tmp}/ccm-smoke.XXXXXX")"
PROJ="/nonexistent-smoke-project"          # forces $CC_MASTER_HOME to be the home that's used
SID="smoke-session-001"                    # a stable fake session id, as Claude Code would pass
cleanup() { rm -rf "$HOME_DIR"; }
trap cleanup EXIT

# ── tiny presentation + scoring helpers (no deps) ─────────────────────────────────────
if [ -t 1 ]; then B=$'\033[1m'; G=$'\033[32m'; R=$'\033[31m'; C=$'\033[36m'; Y=$'\033[33m'; Z=$'\033[0m'
else B=''; G=''; R=''; C=''; Y=''; Z=''; fi

PASS=0; FAIL=0
step() { printf '\n%s━━ STEP %s ━━%s\n' "$B" "$*" "$Z"; }
say()  { printf '   %s\n' "$*"; }
what() { printf '   %swhat happened:%s %s\n' "$C" "$Z" "$*"; }
deci() { printf '   %shook decided:%s %s\n' "$Y" "$Z" "$*"; }
ok()   { PASS=$((PASS+1)); printf '   %s✓ %s%s\n' "$G" "$*" "$Z"; }
no()   { FAIL=$((FAIL+1)); printf '   %s✗ %s%s\n' "$R" "$*" "$Z"; }

# check: assert haystack CONTAINS needle (or, with leading '!', does NOT contain it)
check() { # $1 "PASS msg" $2 haystack $3 needle  [$4 = "!" for negate]
  local msg="$1" hay="$2" needle="$3" neg="${4:-}"
  if [ "$neg" = "!" ]; then
    case "$hay" in *"$needle"*) no "$msg (unexpectedly saw: $needle)";; *) ok "$msg";; esac
  else
    case "$hay" in *"$needle"*) ok "$msg";; *) no "$msg (missing: $needle)";; esac
  fi
}

# run_hook SCRIPT STDIN_JSON  → sets OUT (stdout) and RC (exit code). Mocks Claude Code's env.
# SCRIPT is the bare hook filename (it lives in $HOOKS).
OUT=''; RC=0
run_hook() {
  # v2 收编：.js hook 用 node 跑，.sh hook 用 bash 跑（bootstrap-board.sh 仍 bash·唯一豁免 ARM 动作）。
  local runner="bash"; case "$1" in *.js) runner="node";; esac
  OUT="$(printf '%s' "$2" \
        | CLAUDE_PROJECT_DIR="$PROJ" CLAUDE_PLUGIN_ROOT="$ROOT" CC_MASTER_HOME="$HOME_DIR" \
          "$runner" "$HOOKS/$1" 2>/dev/null)"
  RC=$?
}

# show the live board JSON so the reader can "see it with their own eyes"
show_board() { # $1 = board path, $2 = caption
  printf '   %s%s%s\n' "$C" "$2" "$Z"
  while IFS= read -r line; do printf '   │ %s\n' "$line"; done < "$1"
}

GOAL='Internationalize the app to 6 locales (i18n framework + per-locale translation + locale routing)'

printf '%s╭───────────────────────────────────────────────────────────────────╮%s\n' "$B" "$Z"
printf '%s│  cc-master — end-to-end hook smoke (a walkthrough that runs)        │%s\n' "$B" "$Z"
printf '%s╰───────────────────────────────────────────────────────────────────╯%s\n' "$B" "$Z"
say "throwaway home: $HOME_DIR"
say "toy goal:       $GOAL"

# =====================================================================================
step "1 — bootstrap-board.sh  (UserPromptSubmit: the command ignites the orchestration)"
# =====================================================================================
say "The user types: /cc-master:as-master-orchestrator $GOAL"
say "UserPromptSubmit fires the bootstrap hook with the raw prompt on stdin."
run_hook bootstrap-board.sh \
  "{\"prompt\":\"/cc-master:as-master-orchestrator $GOAL\"}"

BOARD="$(ls "$HOME_DIR"/boards/*.board.json 2>/dev/null | head -1)"   # board-v2: board 落 <home>/boards/
what "a brand-new board file was created in the home (<home>/boards/), time-sortable + pid-stamped."
deci "inject additionalContext naming that exact board path + the 'you are the orchestrator' role."
say  "injected context (verbatim from the hook):"
printf '   │ %s\n' "$OUT"

[ -n "$BOARD" ] && check "bootstrap created exactly one board file" "$(ls "$HOME_DIR"/boards/*.board.json | wc -l | tr -d ' ')" "1" \
                || no "bootstrap created a board file"
check "the board file actually exists on disk" "$( [ -f "$BOARD" ] && echo yes )" "yes"
check "injected context carries the board path (agent learns which board is its own)" "$OUT" "$BOARD"
check "injected context re-anchors the orchestrator role" "$OUT" "master orchestrator"
show_board "$BOARD" "the freshly-bootstrapped board (empty skeleton — DAG not filled yet):"

# =====================================================================================
step "2 — the agent decomposes the goal into a DAG  (we stand in for it here)"
# =====================================================================================
say "In a real session the agent now writes tasks[] into ITS board. The toy DAG:"
say "  T0  i18n framework + string extraction                       (critical-path root)"
say "  de/ja/ar  one leaf per locale, all depend on T0              (parallel fan-out)"
say "  D1  glossary + register decision — a call only a human can make (blocked_on:user)"
say "We also stamp owner.session_id so the goal-hook can tell this board is THIS session's."
# A 3-leaf fan-out on a shared root + one HITL decision node. The classic 'dispatch on ready' shape.
cat > "$BOARD" <<JSON
{
  "schema": "cc-master/v2",
  "goal": "$GOAL",
  "owner": { "active": true, "session_id": "$SID", "heartbeat": "2026-06-08T10:00Z" },
  "git": { "worktree": "/repo/.worktrees/i18n", "branch": "feat/i18n-rollout" },
  "scheduling": { "wip_limit": 4 },
  "tasks": [
    { "id": "T0", "status": "in_flight", "deps": [], "model": "opus", "title": "i18n framework + string extraction", "executor": "subagent" },
    { "id": "de", "status": "blocked", "deps": ["T0"], "blocked_on": "T0", "model": "haiku", "title": "translate locale: de" },
    { "id": "ja", "status": "blocked", "deps": ["T0"], "blocked_on": "T0", "model": "haiku", "title": "translate locale: ja" },
    { "id": "ar", "status": "blocked", "deps": ["T0"], "blocked_on": "T0", "title": "translate locale: ar (RTL)" },
    { "id": "D1", "status": "blocked", "deps": [], "blocked_on": "user", "title": "glossary + register decision" }
  ],
  "log": []
}
JSON
what "tasks[] now holds a 5-node DAG: root T0, three locale leaves, and one blocked_on:user decision."
say  "owner.session_id is now \"$SID\" — the Stop hook will filter on it."
show_board "$BOARD" "board snapshot — INITIAL (root in_flight, leaves blocked on it):"

# =====================================================================================
step "3 — reinject.js  (SessionStart compact|resume: survive a context wipe)"
# =====================================================================================
say "Compaction can erase 'I am an orchestrator' entirely — the agent can't restore that"
say "for itself. SessionStart fires reinject, which re-injects the role from OUTSIDE."
run_hook reinject.js '{"hook_event_name":"SessionStart","source":"compact"}'
what "reinject scanned the home, found one ACTIVE board, and read its goal back out."
deci "inject role + a listing of active boards (name + goal) so the agent re-finds its own."
say  "re-injected context (verbatim):"
printf '   │ %s\n' "$OUT"
check "reinject re-anchors the orchestrator role"        "$OUT" "orchestrator"
check "reinject lists the active board by name"          "$OUT" "$(basename "$BOARD")"
check "reinject echoes the goal so the agent re-IDs it"  "$OUT" "$GOAL"

# =====================================================================================
step "4 — verify-board.js  (Stop: the goal-hook gates the agent across board states)"
# =====================================================================================
say "The Stop hook is the goal-hook. It reads THIS session's active board and decides:"
say "block (keep going) or allow (you may stop). It never edits the board; handshake state"
say "lives in a sidecar it owns. We feed it the same session_id every time, as CC would."
STDIN_STOP="{\"session_id\":\"$SID\",\"hook_event_name\":\"Stop\"}"

# ── 4a — empty board → block (bootstrap never filled) ──
say ''
say "4a) FIRST, prove the empty-board backstop. Temporarily blank the DAG."
cat > "$BOARD" <<JSON
{ "schema": "cc-master/v2", "goal": "$GOAL",
  "owner": { "active": true, "session_id": "$SID" }, "tasks": [] }
JSON
run_hook verify-board.js "$STDIN_STOP"
what "the matched active board has zero tasks."
deci "BLOCK — 'an active board has no tasks; decompose the goal before ending.'"
check "empty board → Stop is BLOCKED" "$OUT" '"decision":"block"'

# restore the real DAG for the remaining sub-steps
cat > "$BOARD" <<JSON
{
  "schema": "cc-master/v2", "goal": "$GOAL",
  "owner": { "active": true, "session_id": "$SID", "heartbeat": "2026-06-08T10:00Z" },
  "scheduling": { "wip_limit": 4 },
  "tasks": [
    { "id": "T0", "status": "in_flight", "deps": [], "title": "i18n framework + string extraction" },
    { "id": "de", "status": "blocked", "deps": ["T0"], "blocked_on": "T0", "title": "translate locale: de" },
    { "id": "ja", "status": "blocked", "deps": ["T0"], "blocked_on": "T0", "title": "translate locale: ja" },
    { "id": "ar", "status": "blocked", "deps": ["T0"], "blocked_on": "T0", "title": "translate locale: ar (RTL)" },
    { "id": "D1", "status": "blocked", "deps": [], "blocked_on": "user", "title": "glossary + register decision" }
  ], "log": []
}
JSON

# ── 4b — has a ready leaf → block (actionable work) ──
say ''
say "4b) T0 finished → its three locale leaves go READY (dependency cleared). MID-RUN snapshot:"
cat > "$BOARD" <<JSON
{
  "schema": "cc-master/v2", "goal": "$GOAL",
  "owner": { "active": true, "session_id": "$SID", "heartbeat": "2026-06-08T11:00Z" },
  "scheduling": { "wip_limit": 4 },
  "tasks": [
    { "id": "T0", "status": "done", "deps": [], "title": "i18n framework + string extraction", "verified": true },
    { "id": "de", "status": "ready", "deps": ["T0"], "title": "translate locale: de" },
    { "id": "ja", "status": "ready", "deps": ["T0"], "title": "translate locale: ja" },
    { "id": "ar", "status": "ready", "deps": ["T0"], "title": "translate locale: ar (RTL)" },
    { "id": "D1", "status": "blocked", "deps": [], "blocked_on": "user", "title": "glossary + register decision" }
  ], "log": [ { "t": "11:00Z", "note": "T0 verified done; 3 locale leaves now ready to dispatch in parallel" } ]
}
JSON
show_board "$BOARD" "board snapshot — MID-RUN (root done+verified, 3 locale leaves ready to dispatch):"
run_hook verify-board.js "$STDIN_STOP"
what "the board has READY tasks — three locale leaves can be dispatched right now."
deci "BLOCK — 'this board still has a ready task; dispatch (or mark blocked/escalated) first.'"
check "ready work present → Stop is BLOCKED" "$OUT" '"decision":"block"'

# ── 4c — completion state, FIRST stop → block (forced self-check handshake) ──
say ''
say "4c) The 3 leaves dispatched in parallel, finished, and were verified at the endpoint."
say "    (ar needed RTL layout work, so it was escalated to a workflow; the user answered D1.)"
say "    DONE snapshot — every node done; nothing ready, nothing uncertain:"
cat > "$BOARD" <<JSON
{
  "schema": "cc-master/v2", "goal": "$GOAL",
  "owner": { "active": true, "session_id": "$SID", "heartbeat": "2026-06-08T12:30Z" },
  "scheduling": { "wip_limit": 4 },
  "tasks": [
    { "id": "T0", "status": "done", "deps": [], "title": "i18n framework + string extraction", "verified": true },
    { "id": "de", "status": "done", "deps": ["T0"], "title": "translate locale: de", "verified": true },
    { "id": "ja", "status": "done", "deps": ["T0"], "title": "translate locale: ja", "verified": true },
    { "id": "ar", "status": "done", "deps": ["T0"], "title": "translate locale: ar (RTL)", "mechanism": "workflow", "verified": true },
    { "id": "D1", "status": "done", "deps": [], "title": "glossary + register decision (answered)" }
  ], "log": [ { "t": "12:30Z", "note": "all 3 locales shipped + independently verified; user decision answered; goal looks met" } ]
}
JSON
show_board "$BOARD" "board snapshot — DONE (all nodes done+verified; user decision answered):"
run_hook verify-board.js "$STDIN_STOP"
what "completion state reached — but it is the FIRST stop, so the hook won't take 'done' on faith."
deci "BLOCK once — forces a self-check against the original goal (incl. to-dos NOT on the board)."
check "completion state, first Stop → BLOCKED for a self-check" "$OUT" '"decision":"block"'
check "the block reason actually asks for a goal self-check"    "$OUT" "self-check"

# ── 4d — completion state, SECOND stop → allow (handshake satisfied) ──
say ''
say "4d) The agent did its self-check, judged the goal truly met, and tries to stop again."
say "    (Same board, same session — only the sidecar handshake state has advanced.)"
run_hook verify-board.js "$STDIN_STOP"
what "the self-check handshake was already forced once this round; board still complete."
deci "ALLOW — the agent may stand down. (exit 0, no decision:block emitted.)"
check "completion state, second Stop → ALLOWED" "$OUT" '"decision":"block"' "!"
check "allow path emits no block decision"       "$OUT" '"decision"'         "!"

# =====================================================================================
step "5 — archive  (/cc-master:stop sets owner.active:false → hooks go dormant)"
# =====================================================================================
say "Standing the orchestration down flips owner.active to false. The board is kept, not"
say "deleted — but the hooks must now treat it as inactive and fall silent."
cat > "$BOARD" <<JSON
{
  "schema": "cc-master/v2", "goal": "$GOAL",
  "owner": { "active": false, "session_id": "$SID" },
  "tasks": [
    { "id": "T0", "status": "done", "deps": [] },
    { "id": "de", "status": "done", "deps": ["T0"] },
    { "id": "ja", "status": "done", "deps": ["T0"] },
    { "id": "ar", "status": "done", "deps": ["T0"] },
    { "id": "D1", "status": "done", "deps": [] }
  ]
}
JSON
run_hook reinject.js '{"hook_event_name":"SessionStart","source":"resume"}'
what "reinject scanned the home and found NO active board (owner.active:false)."
deci "stay SILENT — no role injected; the orchestration is dormant. (empty stdout, exit 0)"
# (an empty-needle `check` is vacuous — assert emptiness explicitly instead)
[ -z "$OUT" ] && ok "archived board → reinject is silent (exactly empty output)" \
              || no "reinject should be empty after archive (got: $OUT)"

run_hook verify-board.js "$STDIN_STOP"
what "the Stop hook finds no active board owned by this session."
deci "ALLOW (dormant) — nothing to gate; the agent stops freely."
check "archived board → Stop allows (dormant)" "$OUT" '"decision":"block"' "!"

# =====================================================================================
printf '\n%s━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━%s\n' "$B" "$Z"
if [ "$FAIL" -eq 0 ]; then
  printf '%s✓ SMOKE PASS%s  — %d checks passed, 0 failed. The full hook chain behaved.\n' "$G" "$Z" "$PASS"
  printf '   bootstrap → fill DAG → reinject → gate(empty/ready/done×2) → archive: all green.\n'
  exit 0
else
  printf '%s✗ SMOKE FAIL%s  — %d passed, %d failed.\n' "$R" "$Z" "$PASS" "$FAIL"
  exit 1
fi
