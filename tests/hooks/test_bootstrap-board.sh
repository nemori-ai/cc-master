#!/usr/bin/env bash
. "$(dirname "$0")/helpers.sh"

count_boards() { ls "$1"/*.board.json 2>/dev/null | wc -l | tr -d ' '; }
# board_sid FILE — extract owner.session_id value (pure bash, mirrors the hooks' extraction).
board_sid() { sed -n 's/.*"session_id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$1" | head -1; }
# only_board HOME — echo the single board path in HOME (assumes exactly one).
only_board() { ls "$1"/*.board.json 2>/dev/null | head -1; }

# Case A: command-name sentinel → exactly one board in the default home, path + role injected
P="$(make_project)"
run_hook "hooks/scripts/bootstrap-board.sh" '{"prompt":"/cc-master:as-master-orchestrator migrate the thing"}' "$P"
assert_eq 0 "$HOOK_RC" "bootstrap exits 0"
assert_eq 1 "$(count_boards "$P/.claude/cc-master")" "exactly one board created in default home"
assert_contains "$HOOK_OUT" ".board.json" "injects the board path"
assert_contains "$HOOK_OUT" "orchestrator" "injects the orchestrator role"
rm -rf "$P"

# Case A1 (ARM = stamp session_id): bootstrap is the ARM action — the board it creates is born
# OWNED by the creating session. The hook must stamp owner.session_id from the stdin session_id
# (not leave it ""), so the session-scoped armed gate (active:true AND owner.session_id==sid) is
# immediately satisfiable for the very session that armed it.
P="$(make_project)"
HOOK_OUT="$(printf '%s' '{"session_id":"sess-boot-1","prompt":"/cc-master:as-master-orchestrator do the thing"}' \
  | CLAUDE_PROJECT_DIR="$P" CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" \
    bash "$PLUGIN_ROOT/hooks/scripts/bootstrap-board.sh" 2>/dev/null)"
assert_eq 1 "$(count_boards "$P/.claude/cc-master")" "A1: board created"
assert_eq "sess-boot-1" "$(board_sid "$(only_board "$P/.claude/cc-master")")" "A1: bootstrap stamps owner.session_id from stdin session_id"
rm -rf "$P"

# Case A2 (stamp regression, body-sentinel path + template fallback): even when the prompt arrives
# as the expanded body marker (not the raw command), the created board still carries the real sid.
P="$(make_project)"
HOOK_OUT="$(printf '%s' '{"session_id":"sess-boot-2","prompt":"<!-- cc-master:bootstrap:v1 -->\n..."}' \
  | CLAUDE_PROJECT_DIR="$P" CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" \
    bash "$PLUGIN_ROOT/hooks/scripts/bootstrap-board.sh" 2>/dev/null)"
assert_eq "sess-boot-2" "$(board_sid "$(only_board "$P/.claude/cc-master")")" "A2: body-sentinel path also stamps the sid"
rm -rf "$P"

# Case A3 (no session_id in stdin → empty stamp, not a crash): a bootstrap whose stdin carries no
# session_id stamps owner.session_id="" (degraded — the armed gate then falls back to any-active).
P="$(make_project)"
run_hook "hooks/scripts/bootstrap-board.sh" '{"prompt":"/cc-master:as-master-orchestrator x"}' "$P"
assert_eq 1 "$(count_boards "$P/.claude/cc-master")" "A3: board created without a session_id"
assert_eq "" "$(board_sid "$(only_board "$P/.claude/cc-master")")" "A3: no stdin session_id → owner.session_id stays empty (degraded gate)"
rm -rf "$P"

# Case B: body sentinel (expanded-body case) — marker is the FIRST non-empty line (the command body
# opens with the sentinel right after frontmatter) → also creates a board
P="$(make_project)"
run_hook "hooks/scripts/bootstrap-board.sh" '{"prompt":"<!-- cc-master:bootstrap:v1 -->\n..."}' "$P"
assert_eq 1 "$(count_boards "$P/.claude/cc-master")" "board created via body sentinel"
rm -rf "$P"

# Case C: unrelated prompt → no board, rc 0 (silent no-op)
P="$(make_project)"
run_hook "hooks/scripts/bootstrap-board.sh" '{"prompt":"what files changed today?"}' "$P"
assert_eq 0 "$HOOK_RC" "no-op exits 0"
assert_eq 0 "$(count_boards "$P/.claude/cc-master")" "no board for unrelated prompt"
rm -rf "$P"

# Case D: CC_MASTER_HOME override → board lands in the custom home, NOT the project default
P="$(make_project)"; H="$(make_project)"
HOOK_OUT="$(printf '%s' '{"prompt":"/cc-master:as-master-orchestrator x"}' \
  | CLAUDE_PROJECT_DIR="$P" CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" CC_MASTER_HOME="$H" \
    bash "$PLUGIN_ROOT/hooks/scripts/bootstrap-board.sh" 2>/dev/null)"
assert_eq 1 "$(count_boards "$H")" "board created in CC_MASTER_HOME"
assert_eq 0 "$(count_boards "$P/.claude/cc-master")" "nothing in project default when home overridden"
rm -rf "$P" "$H"

# Case E (Finding #15): notification-style prompt that merely MENTIONS the command name (the string
# appears mid-text in a result/walkthrough, prompt value starts with <task-notification>) → must NOT
# build a board. Raw command detection gates on the command name being the PREFIX of the prompt value,
# not on a bare substring anywhere in the stdin.
P="$(make_project)"
run_hook "hooks/scripts/bootstrap-board.sh" '{"prompt":"<task-notification>sub-agent finished; its walkthrough mentions /cc-master:as-master-orchestrator as the entry point</task-notification>"}' "$P"
assert_eq 0 "$HOOK_RC" "notification-style mention exits 0 (no-op)"
assert_eq 0 "$(count_boards "$P/.claude/cc-master")" "no board for a prompt that merely mentions the command name"
rm -rf "$P"

# Case F (Finding #15): raw command — prompt value STARTS WITH the command name (optionally with
# leading whitespace) → must build a board.
P="$(make_project)"
run_hook "hooks/scripts/bootstrap-board.sh" '{"prompt":"  /cc-master:as-master-orchestrator <goal>"}' "$P"
assert_eq 0 "$HOOK_RC" "raw command exits 0"
assert_eq 1 "$(count_boards "$P/.claude/cc-master")" "board created for a raw command prompt (leading whitespace allowed)"
rm -rf "$P"

# Case G (Finding #15): expanded-body — prompt opens with the bootstrap marker comment on its first
# non-empty line (only ever the case in the expanded command body, never in a mention) → must build a
# board via the gate marker backup.
P="$(make_project)"
run_hook "hooks/scripts/bootstrap-board.sh" '{"prompt":"<!-- cc-master:bootstrap:v1 -->\nYou are being initialized as a master orchestrator..."}' "$P"
assert_eq 0 "$HOOK_RC" "expanded-body exits 0"
assert_eq 1 "$(count_boards "$P/.claude/cc-master")" "board created via expanded-body marker"
rm -rf "$P"

# Case E1 (Finding #16): expanded-body marker is the prompt's FIRST non-empty line (the as-master-
# orchestrator command body opens with the sentinel comment right after frontmatter) → must build a
# board. Preserves the legitimate marker-backup contract.
P="$(make_project)"
run_hook "hooks/scripts/bootstrap-board.sh" '{"prompt":"<!-- cc-master:bootstrap:v1 -->\nYou are being initialized..."}' "$P"
assert_eq 0 "$HOOK_RC" "marker-first-line exits 0"
assert_eq 1 "$(count_boards "$P/.claude/cc-master")" "P4b: marker on first non-empty line → builds board"
rm -rf "$P"

# Case E2 (Finding #16): the marker is merely MENTIONED inline mid-prose (e.g. a survey sub-agent's
# report quotes the sentinel while describing the command-file convention). The marker is NOT the
# first non-empty line → must NOT build a board. Direct regression for Finding #16.
P="$(make_project)"
run_hook "hooks/scripts/bootstrap-board.sh" '{"prompt":"# report\nname the sentinel comment (`<!-- cc-master:bootstrap:v1 -->`) and put it on the body first line."}' "$P"
assert_eq 0 "$HOOK_RC" "inline-mention exits 0 (no-op)"
assert_eq 0 "$(count_boards "$P/.claude/cc-master")" "P4b: marker mentioned inline mid-prose → no board (Finding#16)"
rm -rf "$P"

# Case E3 (Finding #16, codex self-review catch): the marker is quoted INLINE on the FIRST non-empty
# line (prose that happens to lead with a sentence mentioning the sentinel). The marker must be the
# first line STANDALONE — merely appearing on the first line is not enough. Must NOT build a board.
P="$(make_project)"
run_hook "hooks/scripts/bootstrap-board.sh" '{"prompt":"First line mentions the sentinel <!-- cc-master:bootstrap:v1 --> inline, not standalone."}' "$P"
assert_eq 0 "$HOOK_RC" "first-line inline-marker exits 0 (no-op)"
assert_eq 0 "$(count_boards "$P/.claude/cc-master")" "P4b: marker inline on first line (not standalone) → no board (codex catch)"
rm -rf "$P"

finish
