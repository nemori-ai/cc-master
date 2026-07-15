#!/usr/bin/env bash
# Host-neutral board-guard shell lexer fixtures. A quoted word is ordinary argv unless it is the
# command string consumed by a bash/sh `-c` launcher; only that bounded nested command is rescanned.
. "$(dirname "$0")/helpers.sh"

CLAUDE_GUARD="$PLUGIN_ROOT/hooks/scripts/board-guard.js"
CODEX_LAUNCHER="$REPO_ROOT/plugin/src/hooks/_hosts/codex/launcher.js"
CODEX_CORE="$REPO_ROOT/plugin/src/hooks/board-guard/implementations/codex/board-guard-core.js"
CURSOR_LAUNCHER="$REPO_ROOT/plugin/src/hooks/_hosts/cursor/launcher.js"
CURSOR_CORE="$REPO_ROOT/plugin/src/hooks/board-guard/implementations/cursor/board-guard-core.js"

seed_board() {
  mkdir -p "$1/boards"
  printf '%s' '{"schema":"cc-master/v2","goal":"g","owner":{"active":true,"session_id":"sess-x"},"tasks":[{"id":"T0","status":"ready","deps":[]}]}' >"$1/boards/mine.board.json"
}

json_string() {
  node -e 'process.stdout.write(JSON.stringify(process.argv[1]))' "$1"
}

run_host_command() {
  local host="$1" home="$2" command="$3" payload
  case "$host" in
    claude-code)
      printf -v payload '{"session_id":"sess-x","hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":%s}}' "$(json_string "$command")"
      HOOK_OUT="$(printf '%s' "$payload" | CC_MASTER_HOME="$home" node "$CLAUDE_GUARD" 2>/dev/null)"
      ;;
    codex)
      printf -v payload '{"session_id":"sess-x","hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":%s}}' "$(json_string "$command")"
      HOOK_OUT="$(printf '%s' "$payload" | CC_MASTER_HOME="$home" node "$CODEX_LAUNCHER" --event PreToolUse --core "$CODEX_CORE" 2>/dev/null)"
      ;;
    cursor)
      printf -v payload '{"conversation_id":"sess-x","session_id":"sess-x","hook_event_name":"preToolUse","tool_name":"Shell","tool_input":{"command":%s}}' "$(json_string "$command")"
      HOOK_OUT="$(printf '%s' "$payload" | CC_MASTER_HOME="$home" node "$CURSOR_LAUNCHER" --event preToolUse --core "$CURSOR_CORE" 2>/dev/null)"
      ;;
  esac
  HOOK_RC=$?
}

assert_blocked() {
  local host="$1" home="$2" command="$3" label="$4" marker
  run_host_command "$host" "$home" "$command"
  assert_eq 0 "$HOOK_RC" "$host $label -> rc 0"
  case "$host" in
    claude-code) marker='"permissionDecision":"deny"' ;;
    codex) marker='"decision":"block"' ;;
    cursor) marker='"permission":"deny"' ;;
  esac
  assert_contains "$HOOK_OUT" "$marker" "$host $label -> deny"
}

assert_allowed() {
  local host="$1" home="$2" command="$3" label="$4"
  run_host_command "$host" "$home" "$command"
  assert_eq 0 "$HOOK_RC" "$host $label -> rc 0"
  assert_eq "" "$HOOK_OUT" "$host $label -> allow"
}

for HOST in claude-code codex cursor; do
  H="$(make_project)"
  seed_board "$H"
  BOARD="$H/boards/mine.board.json"

  SPACE_BOARD="${BOARD/mine./mine space.}"
  cp "$BOARD" "$SPACE_BOARD"

  # Nested shell command strings are executable syntax and must be inspected, even though the outer
  # shell represents them as a quoted argv word.
  assert_blocked "$HOST" "$H" "bash -c 'printf x > $BOARD'" "nested bash -c redirect"
  assert_blocked "$HOST" "$H" "sh -c 'printf x | tee $BOARD'" "nested sh -c tee"
  assert_blocked "$HOST" "$H" "/bin/bash -c 'cp /tmp/source $BOARD'" "nested absolute bash -c cp"
  assert_blocked "$HOST" "$H" "FOO=1 sh -c 'mv /tmp/source $BOARD'" "nested env-prefixed sh -c mv"

  # Direct forms remain protected; the nested-shell fix cannot weaken the original heuristic.
  assert_blocked "$HOST" "$H" "printf x > '$BOARD'" "direct redirect"
  assert_blocked "$HOST" "$H" "printf x | tee '$BOARD'" "direct tee"
  assert_blocked "$HOST" "$H" "cp /tmp/source '$BOARD'" "direct cp"
  assert_blocked "$HOST" "$H" "mv /tmp/source '$BOARD'" "direct mv"

  # Preserve the lexer word boundary for a protected path containing whitespace. These are all
  # executable writes: one direct redirection and two bounded nested-shell command strings.
  SPACE_DIRECT="printf replacement > '$SPACE_BOARD'"
  SPACE_NESTED_CP="/bin/bash -c 'cp \"$H/source-cp\" \"$SPACE_BOARD\"'"
  SPACE_NESTED_MV="FOO=1 sh -c 'mv \"$H/source-mv\" \"$SPACE_BOARD\"'"
  assert_blocked "$HOST" "$H" "$SPACE_DIRECT" "space-path direct redirect"
  assert_blocked "$HOST" "$H" "$SPACE_NESTED_CP" "space-path absolute bash -c cp"
  assert_blocked "$HOST" "$H" "$SPACE_NESTED_MV" "space-path env-prefixed sh -c mv"

  # A separator inside a quoted argv word is data, not syntax. The cp command itself still writes
  # the protected target and must remain blocked rather than being split at the quoted separator.
  assert_blocked "$HOST" "$H" "cp '$H/source;name' '$BOARD'" "quoted separator in cp source argv"

  # The same bytes are harmless when they are an ordinary quoted argv value. They are not shell
  # syntax merely because the value happens to contain tee, >, a board path, or even `bash -c` text.
  assert_allowed "$HOST" "$H" "printf '%s\\n' 'literal tee > $BOARD'" "quoted tee/redirect/board argv"
  assert_allowed "$HOST" "$H" "node -e 'console.log(\"tee > $BOARD\")'" "ordinary node argv"
  assert_allowed "$HOST" "$H" "echo 'cp /tmp/source $BOARD'" "quoted cp/board argv"
  assert_allowed "$HOST" "$H" "printf '%s\\n' 'bash -c \"mv /tmp/source $BOARD\"'" "quoted shell-launcher text argv"
  assert_allowed "$HOST" "$H" "bash script.sh -c 'mv /tmp/source $BOARD'" "bash script argv after option scan"
  assert_allowed "$HOST" "$H" "printf '%s\n' 'literal;still-data > $BOARD'" "quoted separator data argv"
  assert_allowed "$HOST" "$H" "ccm task update T0 --set 'note=please cp this later' --board '$BOARD'" "quoted cp data in ccm argv"

  # Exact dogfood false positives: the protected path is ccm's --board argv, while the shell
  # redirect target is /dev/null. Earlier assignment segments and quoted log punctuation remain
  # data/segment boundaries; neither means that the shell itself writes the board.
  FIRE_REPRO="FIRE=\$(date -u -d '+15 minutes' +%Y-%m-%dT%H:%M:%SZ)
ccm watchdog arm --fire-at \"\$FIRE\" --mechanism shell --job-id shell-terminal:53392 --checklist 'Poll lifecycle-R2, PHIP checker, RunStore review; record verdicts and dispatch next ready task.' --board '$BOARD' >/dev/null
ccm watchdog status --board '$BOARD'"
  assert_allowed "$HOST" "$H" "$FIRE_REPRO" "FIRE prefix plus ccm watchdog output redirected away from board"

  REVIEW_REPRO="ccm task update xh_c2_run_store_capability_v2_contract_r2 --handle codex-subagent:/root/c3_subscription_oracle --log 'Independent review assigned after PR #124 delivery; reviewer is disjoint from R2 producer.' --board '$BOARD' >/dev/null
ccm board lint --board '$BOARD' | sed -n '1,2p'"
  assert_allowed "$HOST" "$H" "$REVIEW_REPRO" "quoted PR hash/log plus ccm output redirected away from board"

  # The target-aware ccm exception is narrow. Real board redirects, true writer commands, Node/fs
  # writes, and nested-shell counterfeits stay fail-closed.
  assert_blocked "$HOST" "$H" "ccm watchdog status --board '$BOARD' > '$BOARD'" "ccm redirect target is the board"
  assert_blocked "$HOST" "$H" "printf x | tee '$BOARD' >/dev/null" "tee board write with unrelated stdout redirect"
  assert_blocked "$HOST" "$H" "node -e 'require(\"fs\").writeFileSync(process.argv[1], \"{}\")' '$BOARD' >/dev/null" "Node fs board write with unrelated stdout redirect"
  assert_blocked "$HOST" "$H" "bash -c 'ccm board show --board \"$BOARD\" > \"$BOARD\"'" "nested ccm redirect counterfeit"

  # Independent shell execution proves that each rejected space-path shape is real RC0 write syntax,
  # not inert text. It runs only against this disposable fixture after all armed-hook assertions.
  /bin/sh -c "$SPACE_DIRECT"
  assert_eq 0 "$?" "$HOST real direct space-path shell -> rc 0"
  assert_eq replacement "$(cat "$SPACE_BOARD")" "$HOST real direct space-path shell -> wrote target"
  printf source-cp >"$H/source-cp"
  /bin/sh -c "$SPACE_NESTED_CP"
  assert_eq 0 "$?" "$HOST real nested cp space-path shell -> rc 0"
  assert_eq source-cp "$(cat "$SPACE_BOARD")" "$HOST real nested cp space-path shell -> wrote target"
  printf source-mv >"$H/source-mv"
  /bin/sh -c "$SPACE_NESTED_MV"
  assert_eq 0 "$?" "$HOST real nested mv space-path shell -> rc 0"
  assert_eq source-mv "$(cat "$SPACE_BOARD")" "$HOST real nested mv space-path shell -> wrote target"

  rm -rf "$H"
done

finish
