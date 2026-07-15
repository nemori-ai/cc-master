#!/usr/bin/env bash
. "$(dirname "$0")/helpers.sh"

LAUNCHER="$REPO_ROOT/plugin/src/hooks/_hosts/codex/launcher.js"
CORE="$REPO_ROOT/plugin/src/hooks/reinject/implementations/codex/reinject-core.js"
DIST_LAUNCHER="$REPO_ROOT/plugin/dist/codex/hooks/_hosts/codex/launcher.js"
DIST_CORE="$REPO_ROOT/plugin/dist/codex/hooks/reinject/implementations/codex/reinject-core.js"

mkactive() {
  mkdir -p "$1/boards"
  printf '%s' "$3" >"$1/boards/$2.board.json"
}

run_session_start() {
  run_session_start_from "$1" "$2" "${CCM_BIN:-ccm}" "$LAUNCHER" "$CORE"
}

run_session_start_from() {
  HOOK_OUT="$(
    printf '{"session_id":"%s","hook_event_name":"SessionStart","source":"startup"}' "$2" |
      CC_MASTER_HOME="$1" CCM_BIN="$3" node "$4" --event SessionStart --core "$5" 2>/dev/null
  )"
  HOOK_RC=$?
}

dangling_segment() {
  printf '%s' "$1" | sed -n 's/.*stale\/escalated:[[:space:]]*\(.*\)\. Reconcile.*/\1/p'
}

chmod +x "$CORE"

# No active board: dormant.
H="$(make_project)"
run_session_start "$H" "sess-none"
assert_eq 0 "$HOOK_RC" "no active board -> rc 0"
assert_eq "" "$HOOK_OUT" "no active board -> no output"
rm -rf "$H"

# Matching session: inject role and goal through Codex launcher envelope.
H="$(make_project)"
mkactive "$H" "mine" '{"schema":"cc-master/v2","goal":"CODEX REINJECT GOAL","owner":{"active":true,"session_id":"sess-mine"},"tasks":[{"id":"T1","status":"ready","deps":[]}]}'
run_session_start "$H" "sess-mine"
assert_contains "$HOOK_OUT" '"systemMessage"' "uses SessionStart systemMessage envelope"
assert_contains "$HOOK_OUT" "CODEX REINJECT GOAL" "injects matching board goal"
assert_contains "$HOOK_OUT" "master orchestrator" "re-anchors role"
assert_contains "$HOOK_OUT" "mine.board.json" "names board"
assert_contains "$HOOK_OUT" "tool_search" "prompts Codex deferred tool discovery after compaction"
assert_contains "$HOOK_OUT" "multi_agent_v1.spawn_agent" "prompts Codex multi-agent spawn handle discipline"
rm -rf "$H"

# Goal Contract boards name revision/assurance and require integrity reconciliation before dispatch.
H="$(make_project)"
mkactive "$H" "contract" '{"schema":"cc-master/v2","goal":"REFINED GOAL","goal_contract":{"schema":"ccm/goal-contract/v1","revision":2,"assurance":"confirmed","updated_at":"2026-07-15T00:00:00Z"},"owner":{"active":true,"session_id":"sess-contract"},"tasks":[{"id":"T1","status":"ready","deps":[]}]}'
run_session_start "$H" "sess-contract"
assert_contains "$HOOK_OUT" "r2 confirmed" "reinject names current goal revision and assurance"
assert_contains "$HOOK_OUT" "ccm goal check" "reinject requires integrity check"
rm -rf "$H"

# Source and projected Codex adapters both treat Goal Contract transport failure as advisory, not
# semantic evidence. The stale-task note proves other local gates continue to run.
for SURFACE in source dist; do
  H="$(make_project)"
  mkactive "$H" "contract-unavailable-$SURFACE" "{\"schema\":\"cc-master/v2\",\"goal\":\"VALID CONFIRMED GOAL\",\"goal_contract\":{\"schema\":\"ccm/goal-contract/v1\",\"revision\":1,\"assurance\":\"confirmed\",\"updated_at\":\"2026-07-15T00:00:00Z\"},\"owner\":{\"active\":true,\"session_id\":\"sess-$SURFACE\"},\"tasks\":[{\"id\":\"T1\",\"status\":\"stale\",\"deps\":[]}]}"
  if [ "$SURFACE" = source ]; then
    run_session_start_from "$H" "sess-$SURFACE" "$H/no-such-ccm" "$LAUNCHER" "$CORE"
  else
    run_session_start_from "$H" "sess-$SURFACE" "$H/no-such-ccm" "$DIST_LAUNCHER" "$DIST_CORE"
  fi
  assert_contains "$HOOK_OUT" "STRONG ADVISORY" "$SURFACE Codex transport failure is a strong advisory"
  assert_contains "$HOOK_OUT" "Goal Contract integrity probe unavailable" "$SURFACE Codex advisory names the unavailable probe"
  assert_not_contains "$HOOK_OUT" "HARD STOP: Goal Contract integrity/assurance" "$SURFACE Codex transport failure does not prohibit dispatch"
  assert_contains "$HOOK_OUT" "unresolved node(s)" "$SURFACE Codex transport failure preserves local gates"
  rm -rf "$H"
done

# A determined semantic failure remains a hard block even though ccm reports it with a non-zero exit.
H="$(make_project)"
mkactive "$H" "contract-missing" '{"schema":"cc-master/v2","goal":"BROKEN CONFIRMED GOAL","goal_contract":{"schema":"ccm/goal-contract/v1","revision":1,"assurance":"confirmed","brief":{"ref":"goals/contract-missing/r0001.goal.md","sha256":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},"updated_at":"2026-07-15T00:00:00Z"},"owner":{"active":true,"session_id":"sess-missing"},"tasks":[{"id":"T1","status":"ready","deps":[]}]}'
run_session_start_from "$H" "sess-missing" "${CCM_BIN:-$REPO_ROOT/ccm/apps/cli/dev-bin/ccm}" "$LAUNCHER" "$CORE"
assert_contains "$HOOK_OUT" "HARD STOP: Goal Contract integrity/assurance" "determined missing Brief remains a hard block"
assert_contains "$HOOK_OUT" "verdict=missing_brief" "semantic failure preserves the ccm verdict despite non-zero exit"
rm -rf "$H"

# Matching empty board: SessionStart must force DAG creation before work.
H="$(make_project)"
mkactive "$H" "empty" '{"schema":"cc-master/v2","goal":"","goal_contract":{"schema":"ccm/goal-contract/v1","revision":1,"assurance":"pending","updated_at":"2026-07-15T00:00:00Z"},"owner":{"active":true,"session_id":"sess-empty"},"tasks":[]}'
run_session_start "$H" "sess-empty"
assert_contains "$HOOK_OUT" "HARD STOP" "empty active board gets hard stop"
assert_contains "$HOOK_OUT" "zero tasks are not runnable orchestration DAGs" "empty active board blocks ordinary progress"
assert_contains "$HOOK_OUT" "ccm goal set" "pending empty board instructs goal framing before decomposition"
rm -rf "$H"

# Other session: do not leak another active board.
H="$(make_project)"
mkactive "$H" "other" '{"schema":"cc-master/v2","goal":"OTHER CODEX GOAL","owner":{"active":true,"session_id":"sess-other"},"tasks":[{"id":"T1","status":"ready","deps":[]}]}'
run_session_start "$H" "sess-fresh"
assert_eq "" "$HOOK_OUT" "other session board stays dormant"
rm -rf "$H"

# Empty session id degrades to any active board.
H="$(make_project)"
mkactive "$H" "degraded" '{"schema":"cc-master/v2","goal":"DEGRADED CODEX GOAL","owner":{"active":true,"session_id":"sess-any"},"tasks":[{"id":"T1","status":"ready","deps":[]}]}'
run_session_start "$H" ""
assert_contains "$HOOK_OUT" "DEGRADED CODEX GOAL" "empty session_id degrades to active board"
rm -rf "$H"

# Dangling stale/escalated note only names top-level task statuses.
H="$(make_project)"
mkactive "$H" "dangling" '{"schema":"cc-master/v2","goal":"DANGLING CODEX GOAL","owner":{"active":true,"session_id":"sess-d"},"tasks":[{"id":"T1","status":"stale","deps":[]},{"id":"T2","status":"in_flight","deps":[]},{"id":"T3","status":"escalated","deps":[],"parent":"P1"},{"id":"T4","status":"in_flight","deps":[],"log":[{"status":"stale","id":"L1"}]}]}'
run_session_start "$H" "sess-d"
assert_contains "$HOOK_OUT" "unresolved" "dangling note appears"
DANGLE="$(dangling_segment "$HOOK_OUT")"
assert_contains "$DANGLE" "T1" "names stale task"
assert_contains "$DANGLE" "T3 (owner P1)" "names escalated child task"
assert_not_contains "$DANGLE" "T2" "does not name in-flight task"
assert_not_contains "$DANGLE" "L1" "does not scan nested log status"
rm -rf "$H"

finish
