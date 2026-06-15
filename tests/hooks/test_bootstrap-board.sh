#!/usr/bin/env bash
. "$(dirname "$0")/helpers.sh"

count_boards() { ls "$1"/*.board.json 2>/dev/null | wc -l | tr -d ' '; }
# board_sid FILE — extract owner.session_id value (pure bash). owner precedes tasks[] in the pinned
# waist, so the FIRST "session_id" token is owner's. grep -o the first token BEFORE sed: a greedy
# `.*"session_id"` on a single line bearing several session_id-shaped fields would otherwise capture
# the LAST one (a task-level decoy), not owner's.
board_sid() {
  grep -oE '"session_id"[[:space:]]*:[[:space:]]*"[^"]*"' "$1" | head -1 \
    | sed -n 's/.*"session_id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p'
}
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

# ────────────────────────────────────────────────────────────────────────────────────────────────
# RESUME mechanism (design 2026-06-15-resume-board-mechanism.md §1/§2/§3/§5/§8)
# ────────────────────────────────────────────────────────────────────────────────────────────────
#
# seed_board HOME SID ACTIVE GOAL [EXTRA_TASKS_JSON] — write a pre-existing board into HOME with a
# UNIQUE time-sortable name, owner.session_id=SID, owner.active=ACTIVE (true|false), goal=GOAL, two
# stub tasks (+ optional EXTRA_TASKS_JSON inserted verbatim). Echoes the board path. Uniqueness via
# mktemp (a counter would NOT survive the $(...) subshell each call runs in). Heartbeat left empty
# (the common case for stale/abandoned boards).
seed_board() { # $1 home $2 sid $3 active $4 goal [$5 extra-tasks-json]
  local home="$1" sid="$2" active="$3" goal="$4" extra="${5:-}"
  mkdir -p "$home"
  local bp; bp="$(mktemp "$home/20260101T000000Z-seedXXXXXX")"; mv "$bp" "$bp.board.json"; bp="$bp.board.json"
  local tasks='{"id":"T1","status":"done","deps":[]},{"id":"T2","status":"in_flight","deps":["T1"]}'
  [ -n "$extra" ] && tasks="$tasks,$extra"
  printf '{"schema":"cc-master/v1","goal":"%s","owner":{"active":%s,"session_id":"%s","heartbeat":""},"git":{"worktree":"","branch":""},"wip_limit":4,"tasks":[%s],"log":[{"t":"2026-01-01","msg":"seeded"}]}\n' \
    "$goal" "$active" "$sid" "$tasks" > "$bp"
  # Default an aged (stale) mtime so a seeded board reads as ABANDONED (the common resume case). The
  # live-safety gate (S10–S13) overrides this per-test by calling touch_mtime explicitly.
  touch_mtime "$bp" 120
  echo "$bp"
}
# run_resume HOME SID PROMPT — fire bootstrap with a custom CC_MASTER_HOME + stdin session_id, set
# HOOK_OUT / HOOK_RC. (run_hook uses the project default home; resume tests seed a custom home.)
run_resume() { # $1 home $2 sid $3 prompt
  local proj; proj="$(make_project)"
  HOOK_OUT="$(printf '%s' "$(printf '{"session_id":"%s","prompt":"%s"}' "$2" "$3")" \
    | CLAUDE_PROJECT_DIR="$proj" CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" CC_MASTER_HOME="$1" \
      bash "$PLUGIN_ROOT/hooks/scripts/bootstrap-board.sh" 2>/dev/null)"; HOOK_RC=$?
  rm -rf "$proj"
}
# touch_mtime FILE MINUTES_AGO — set FILE's mtime to MINUTES_AGO minutes in the past (GNU/BSD touch).
touch_mtime() {
  local f="$1" mins="$2"
  if touch -d "$mins minutes ago" "$f" 2>/dev/null; then return 0; fi   # GNU
  local secs=$((mins*60)) hh mm ss                                       # BSD touch -A: [-]HHMMSS
  hh=$(printf '%02d' $((secs/3600))); mm=$(printf '%02d' $(((secs%3600)/60))); ss=$(printf '%02d' $((secs%60)))
  touch -A "-${hh}${mm}${ss}" "$f" 2>/dev/null || true
}
# mtime_future FILE — set FILE's mtime far in the FUTURE → undatable as a "stale" mtime signal, so the
# mtime channel contributes NO signal (forces the heartbeat channel to be the sole freshness source).
mtime_future() { touch -t 209901010000 "$1" 2>/dev/null || true; }
# set_heartbeat FILE VALUE — rewrite owner.heartbeat="" (seed_board's default) to "VALUE" in place.
# Literal-anchored sed on the empty heartbeat value (seed_board always emits it empty), so only that
# owner field is touched. Pure bash; VALUE is an ISO8601 timestamp or a garbage token for the tests.
set_heartbeat() { # $1 file $2 value
  local tmp; tmp="$1.hb.$$"
  sed "s/\"heartbeat\"[[:space:]]*:[[:space:]]*\"\"/\"heartbeat\": \"$2\"/" "$1" > "$tmp" && mv -f "$tmp" "$1"
}
# iso_minutes_ago MINUTES — print an ISO8601 UTC timestamp (YYYY-MM-DDTHH:MM:SSZ, SECOND precision)
# MINUTES in the past (the format a TAKEOVER write flushes into owner.heartbeat). GNU `date -d` / BSD
# `date -v` portable.
iso_minutes_ago() { # $1 minutes
  date -u -d "$1 minutes ago" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null \
    || date -u -v-"$1"M +%Y-%m-%dT%H:%M:%SZ 2>/dev/null \
    || date -u +%Y-%m-%dT%H:%M:%SZ
}
# iso_minutes_ago_minprec MINUTES — print an ISO8601 UTC timestamp at MINUTE precision
# (YYYY-MM-DDTHH:MMZ, no seconds) MINUTES in the past. THIS is the format board.example.json /
# board.md document and a live session actually flushes into owner.heartbeat (e.g. 2026-06-15T05:52Z),
# distinct from the second-precision timestamp the takeover re-stamp writes. GNU `date -d` / BSD
# `date -v` portable.
iso_minutes_ago_minprec() { # $1 minutes
  date -u -d "$1 minutes ago" +%Y-%m-%dT%H:%MZ 2>/dev/null \
    || date -u -v-"$1"M +%Y-%m-%dT%H:%MZ 2>/dev/null \
    || date -u +%Y-%m-%dT%H:%MZ
}
# run_resume_nosid HOME PROMPT — like run_resume but the stdin JSON carries NO session_id field at all
# (a DEGRADED UserPromptSubmit env). Sets HOOK_OUT / HOOK_RC.
run_resume_nosid() { # $1 home $2 prompt
  local proj; proj="$(make_project)"
  HOOK_OUT="$(printf '%s' "$(printf '{"prompt":"%s"}' "$2")" \
    | CLAUDE_PROJECT_DIR="$proj" CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" CC_MASTER_HOME="$1" \
      bash "$PLUGIN_ROOT/hooks/scripts/bootstrap-board.sh" 2>/dev/null)"; HOOK_RC=$?
  rm -rf "$proj"
}

# ── R2: fresh path zero-regression — no --resume → still NEW board + fresh context (no resume branch)
H="$(make_project)"
run_resume "$H" "new-sess" '/cc-master:as-master-orchestrator migrate the thing'
assert_eq 0 "$HOOK_RC" "R2: fresh exits 0"
assert_eq 1 "$(count_boards "$H")" "R2: no --resume → new board created"
assert_eq "new-sess" "$(board_sid "$(only_board "$H")")" "R2: fresh stamps new sid"
assert_contains "$HOOK_OUT" "fresh" "R2: fresh context injected"
rm -rf "$H"

# ── R3: goal text CONTAINS --resume but not as the first token after the prefix → still fresh
H="$(make_project)"
run_resume "$H" "new-sess" '/cc-master:as-master-orchestrator migrate the --resume flag handling'
assert_eq 1 "$(count_boards "$H")" "R3: --resume mid-goal → still fresh (new board), not resume"
assert_contains "$HOOK_OUT" "fresh" "R3: mid-goal --resume → fresh context"
rm -rf "$H"

# ── S1: happy path, unique candidate — empty selector, one abandoned-active board → re-stamp sid
H="$(make_project)"
B="$(seed_board "$H" "old-sess" "true" "build the thing")"
run_resume "$H" "new-sess" '/cc-master:as-master-orchestrator --resume'
assert_eq 0 "$HOOK_RC" "S1: resume exits 0"
assert_eq 1 "$(count_boards "$H")" "S1: no new board created (count stays 1)"
assert_eq "new-sess" "$(board_sid "$B")" "S1: owner.session_id re-stamped to new sid"
assert_eq "true" "$(board_active "$B")" "S1: owner.active stays true"
assert_contains "$HOOK_OUT" "$B" "S1: resume context names the board path"
rm -rf "$H"

# ── S2: goal substring selects the right board — payments board untouched
H="$(make_project)"
Bi="$(seed_board "$H" "old-a" "true" "ship the i18n localization")"
Bp="$(seed_board "$H" "old-b" "true" "refactor the payments gateway")"
run_resume "$H" "new-sess" '/cc-master:as-master-orchestrator --resume i18n'
assert_eq "new-sess" "$(board_sid "$Bi")" "S2: i18n board re-stamped"
assert_eq "old-b" "$(board_sid "$Bp")" "S2: payments board owner UNTOUCHED"
rm -rf "$H"

# ── S3: explicit board filename selects the board
H="$(make_project)"
B1="$(seed_board "$H" "old-a" "true" "alpha goal")"
B2="$(seed_board "$H" "old-b" "true" "beta goal")"
run_resume "$H" "new-sess" "/cc-master:as-master-orchestrator --resume $(basename "$B2")"
assert_eq "new-sess" "$(board_sid "$B2")" "S3: explicit board name re-stamped"
assert_eq "old-a" "$(board_sid "$B1")" "S3: other board untouched"
rm -rf "$H"

# ── S4: tasks/log/goal preserved byte-for-byte (red line 2 regression gate)
H="$(make_project)"
B="$(seed_board "$H" "old-sess" "true" "preserve me")"
before_tasks="$(tr -d '\n' < "$B" | sed -n 's/.*\("tasks":\[.*\]\),"log".*/\1/p')"
before_log="$(tr -d '\n' < "$B" | sed -n 's/.*\("log":\[[^]]*\]\).*/\1/p')"
before_goal="$(board_goal "$B")"
run_resume "$H" "new-sess" '/cc-master:as-master-orchestrator --resume preserve'
after_tasks="$(tr -d '\n' < "$B" | sed -n 's/.*\("tasks":\[.*\]\),"log".*/\1/p')"
after_log="$(tr -d '\n' < "$B" | sed -n 's/.*\("log":\[[^]]*\]\).*/\1/p')"
assert_eq "$before_tasks" "$after_tasks" "S4: tasks[] byte-identical after resume"
assert_eq "$before_log" "$after_log" "S4: log[] byte-identical after resume"
assert_eq "$before_goal" "$(board_goal "$B")" "S4: goal byte-identical after resume"
rm -rf "$H"

# ── S5: multiple boards match selector → NO write, disambiguation context
H="$(make_project)"
B1="$(seed_board "$H" "old-a" "true" "migrate the database")"
B2="$(seed_board "$H" "old-b" "true" "migrate the auth service")"
run_resume "$H" "new-sess" '/cc-master:as-master-orchestrator --resume migrate'
assert_eq "old-a" "$(board_sid "$B1")" "S5: board1 owner unchanged (no write)"
assert_eq "old-b" "$(board_sid "$B2")" "S5: board2 owner unchanged (no write)"
assert_eq 2 "$(count_boards "$H")" "S5: no new board created"
assert_contains "$HOOK_OUT" "more precise" "S5: context asks for a more precise selector"
rm -rf "$H"

# ── S6: selector non-empty but zero matches → no write, "no match" context
H="$(make_project)"
B="$(seed_board "$H" "old-sess" "true" "alpha")"
run_resume "$H" "new-sess" '/cc-master:as-master-orchestrator --resume nonexistent-goal-xyz'
assert_eq "old-sess" "$(board_sid "$B")" "S6: board owner unchanged (no write on zero match)"
assert_contains "$HOOK_OUT" "no" "S6: context indicates no match"
rm -rf "$H"

# ── S7: empty selector + multiple candidates (active + archived mix) → no write, two-group listing
H="$(make_project)"
Ba="$(seed_board "$H" "old-a" "true" "active board goal")"
Bx="$(seed_board "$H" "old-b" "false" "archived board goal")"
run_resume "$H" "new-sess" '/cc-master:as-master-orchestrator --resume'
assert_eq "old-a" "$(board_sid "$Ba")" "S7: active board owner unchanged (no write)"
assert_eq "old-b" "$(board_sid "$Bx")" "S7: archived board owner unchanged (no write)"
assert_contains "$HOOK_OUT" "$(basename "$Ba")" "S7: active candidate listed"
assert_contains "$HOOK_OUT" "$(basename "$Bx")" "S7: archived candidate listed"
assert_contains "$HOOK_OUT" "archived" "S7: groups the candidates (archived group named)"
rm -rf "$H"

# ── S8: zero candidate boards → no write, "no resumable board" context
H="$(make_project)"
run_resume "$H" "new-sess" '/cc-master:as-master-orchestrator --resume'
assert_eq 0 "$(count_boards "$H")" "S8: no board created on resume with empty home"
assert_contains "$HOOK_OUT" "no" "S8: context indicates no resumable board"
rm -rf "$H"

# ── S9: abandoned-active direct takeover (sid re-stamp, active stays true, tasks preserved)
H="$(make_project)"
B="$(seed_board "$H" "old-sess" "true" "takeover goal")"
run_resume "$H" "new-sess" '/cc-master:as-master-orchestrator --resume takeover'
assert_eq "new-sess" "$(board_sid "$B")" "S9: abandoned-active sid re-stamped"
assert_eq "true" "$(board_active "$B")" "S9: active stays true"
rm -rf "$H"

# ── S9b: revive an archived board (active:false → true) + re-stamp sid + tasks byte-unchanged
H="$(make_project)"
B="$(seed_board "$H" "old-sess" "false" "revive this archived goal")"
before_tasks="$(tr -d '\n' < "$B" | sed -n 's/.*\("tasks":\[.*\]\),"log".*/\1/p')"
run_resume "$H" "new-sess" '/cc-master:as-master-orchestrator --resume revive'
assert_eq "true" "$(board_active "$B")" "S9b: archived board revived (active false→true)"
assert_eq "new-sess" "$(board_sid "$B")" "S9b: archived board sid re-stamped"
after_tasks="$(tr -d '\n' < "$B" | sed -n 's/.*\("tasks":\[.*\]\),"log".*/\1/p')"
assert_eq "$before_tasks" "$after_tasks" "S9b: tasks byte-unchanged on revive"
rm -rf "$H"

# ── S9c: an archived board IS in the candidate set (empty selector, only one archived board) → locked
H="$(make_project)"
B="$(seed_board "$H" "old-sess" "false" "lonely archived goal")"
run_resume "$H" "new-sess" '/cc-master:as-master-orchestrator --resume'
assert_eq "new-sess" "$(board_sid "$B")" "S9c: archived board is a candidate (unique → locked, not filtered)"
assert_eq "true" "$(board_active "$B")" "S9c: archived unique candidate revived"
rm -rf "$H"

# ── S10: stale board (mtime ~1h ago, empty heartbeat) → direct takeover, "took over" context
H="$(make_project)"
B="$(seed_board "$H" "old-sess" "true" "stale goal")"
touch_mtime "$B" 60
run_resume "$H" "new-sess" '/cc-master:as-master-orchestrator --resume stale'
assert_eq "new-sess" "$(board_sid "$B")" "S10: stale board taken over (sid re-stamped)"
rm -rf "$H"

# ── S10b: stale archived board revives without --force-takeover
H="$(make_project)"
B="$(seed_board "$H" "old-sess" "false" "stale archived goal")"
touch_mtime "$B" 90
run_resume "$H" "new-sess" '/cc-master:as-master-orchestrator --resume archived'
assert_eq "true" "$(board_active "$B")" "S10b: stale archived revived w/o force (active→true)"
assert_eq "new-sess" "$(board_sid "$B")" "S10b: stale archived sid re-stamped"
rm -rf "$H"

# ── S11: fresh board (mtime just now) + no force → NO re-stamp, warning context
H="$(make_project)"
B="$(seed_board "$H" "old-sess" "true" "fresh live goal")"
touch_mtime "$B" 0
run_resume "$H" "new-sess" '/cc-master:as-master-orchestrator --resume fresh'
assert_eq "old-sess" "$(board_sid "$B")" "S11: fresh board NOT taken over (sid unchanged)"
assert_eq "true" "$(board_active "$B")" "S11: fresh board active unchanged"
assert_contains "$HOOK_OUT" "force-takeover" "S11: warning asks for --force-takeover"
rm -rf "$H"

# ── S12: fresh board + --force-takeover → takeover (sid re-stamped, active true)
H="$(make_project)"
B="$(seed_board "$H" "old-sess" "true" "force goal")"
touch_mtime "$B" 0
run_resume "$H" "new-sess" '/cc-master:as-master-orchestrator --resume force --force-takeover'
assert_eq "new-sess" "$(board_sid "$B")" "S12: --force-takeover overrides freshness gate"
assert_eq "true" "$(board_active "$B")" "S12: forced takeover sets active true"
rm -rf "$H"

# ── S13: no freshness signal (heartbeat empty + mtime in the FUTURE → undatable as stale) →
# conservatively require force. mtime far in the future cannot be "stale"; without force, withhold.
H="$(make_project)"
B="$(seed_board "$H" "old-sess" "true" "nosignal goal")"
touch -t 209901010000 "$B" 2>/dev/null || true   # mtime in the FUTURE → not usable as a "stale" signal
run_resume "$H" "new-sess" '/cc-master:as-master-orchestrator --resume nosignal'
assert_eq "old-sess" "$(board_sid "$B")" "S13: no-signal board NOT taken over without force"
assert_contains "$HOOK_OUT" "force-takeover" "S13: no-signal asks for force"
rm -rf "$H"

# ── S14: a session_id-shaped field inside tasks[] is NOT touched (owner-scope gate, red line 2)
H="$(make_project)"
B="$(seed_board "$H" "old-sess" "true" "scope goal" '{"id":"T3","status":"ready","deps":[],"session_id":"decoy-must-not-change"}')"
touch_mtime "$B" 60
run_resume "$H" "new-sess" '/cc-master:as-master-orchestrator --resume scope'
assert_eq "new-sess" "$(board_sid "$B")" "S14: owner.session_id re-stamped (first session_id is owner's)"
assert_contains "$(cat "$B")" '"session_id":"decoy-must-not-change"' "S14: task-level session_id decoy UNCHANGED"
rm -rf "$H"

# ── S15: new sid contains sed metachars (/ & . *) → owner.session_id exactly equals it (awk -v safe)
H="$(make_project)"
B="$(seed_board "$H" "old-sess" "true" "meta goal")"
touch_mtime "$B" 60
run_resume "$H" "sess/a.b*c&d" '/cc-master:as-master-orchestrator --resume meta'
assert_eq "sess/a.b*c&d" "$(board_sid "$B")" "S15: metachar sid re-stamped exactly (no sed-escape corruption)"
rm -rf "$H"

# ── S16: compact single-line vs pretty multi-line JSON → identical resume result (format-agnostic)
H="$(make_project)"
Bc="$H/20260101T010101Z-compact.board.json"
printf '{"schema":"cc-master/v1","goal":"compactfmt","owner":{"active":true,"session_id":"old-c","heartbeat":""},"git":{"worktree":"","branch":""},"tasks":[{"id":"T1","status":"done"}],"log":[]}\n' > "$Bc"
touch_mtime "$Bc" 60
run_resume "$H" "new-c" '/cc-master:as-master-orchestrator --resume compactfmt'
assert_eq "new-c" "$(board_sid "$Bc")" "S16a: compact JSON re-stamped"
assert_eq "true" "$(board_active "$Bc")" "S16a: compact JSON active stays true"
rm -rf "$H"
H="$(make_project)"
Bm="$H/20260101T020202Z-multi.board.json"
printf '{\n  "schema": "cc-master/v1",\n  "goal": "prettyfmt",\n  "owner": {\n    "active": true,\n    "session_id": "old-m",\n    "heartbeat": ""\n  },\n  "git": { "worktree": "", "branch": "" },\n  "tasks": [ { "id": "T1", "status": "done" } ],\n  "log": []\n}\n' > "$Bm"
touch_mtime "$Bm" 60
run_resume "$H" "new-m" '/cc-master:as-master-orchestrator --resume prettyfmt'
assert_eq "new-m" "$(board_sid "$Bm")" "S16b: pretty multi-line JSON re-stamped"
assert_eq "true" "$(board_active "$Bm")" "S16b: pretty multi-line JSON active stays true"
rm -rf "$H"

# ────────────────────────────────────────────────────────────────────────────────────────────────
# codex P2 finding regressions (second-reviewer catches, 2026-06-15)
# ────────────────────────────────────────────────────────────────────────────────────────────────

# ── S17 (codex Finding 1): multi-board disambiguation must emit VALID single-object JSON. The
# candidate listing (list_candidates) carries LITERAL newlines; inject_ctx must escape them into \n
# inside ONE quoted JSON string, not wrap each physical line in its own pair of quotes (which yields
# illegal JSON). S5/S7 only grep substrings of the (broken) output, so they missed this — assert the
# stdout PARSES. Three disambiguation paths exercise the multi-line context: ≥2 selector matches,
# empty-selector ≥2 candidates (active+archived two-group listing), and zero matches with a listing.
H="$(make_project)"
B1="$(seed_board "$H" "old-a" "true" "migrate the database")"
B2="$(seed_board "$H" "old-b" "true" "migrate the auth service")"
run_resume "$H" "new-sess" '/cc-master:as-master-orchestrator --resume migrate'
assert_valid_json "$HOOK_OUT" "S17a: ≥2-selector-match disambiguation stdout is valid JSON"
rm -rf "$H"
H="$(make_project)"
Ba="$(seed_board "$H" "old-a" "true" "active board goal")"
Bx="$(seed_board "$H" "old-b" "false" "archived board goal")"
run_resume "$H" "new-sess" '/cc-master:as-master-orchestrator --resume'
assert_valid_json "$HOOK_OUT" "S17b: empty-selector two-group listing stdout is valid JSON"
rm -rf "$H"
H="$(make_project)"
B="$(seed_board "$H" "old-sess" "true" "alpha")"
run_resume "$H" "new-sess" '/cc-master:as-master-orchestrator --resume nonexistent-goal-xyz'
assert_valid_json "$HOOK_OUT" "S17c: zero-match (with candidate listing) stdout is valid JSON"
rm -rf "$H"

# ── S18 (codex Finding 2): EXPANDED-BODY path must honor --resume from the machine-readable args
# line. When UserPromptSubmit sees the expanded command body (first line = sentinel), the SECOND line
# carries `cc-master:args: <raw $ARGUMENTS>`. If those args lead with --resume, the hook must take
# over the existing board — NOT create a spurious fresh board (the old logic only honored a never-
# rendered `cc-master:resume` line, so --resume silently fell through to fresh).
H="$(make_project)"
B="$(seed_board "$H" "old-sess" "true" "expanded body resume goal")"
touch_mtime "$B" 60
run_resume "$H" "new-sess" '<!-- cc-master:bootstrap:v1 -->\n<!-- cc-master:args: --resume expanded -->\nbody prose...'
assert_eq "new-sess" "$(board_sid "$B")" "S18: expanded-body --resume takes over (sid re-stamped)"
assert_eq "true" "$(board_active "$B")" "S18: expanded-body resume keeps active true"
assert_eq 1 "$(count_boards "$H")" "S18: expanded-body --resume does NOT create a fresh board"
rm -rf "$H"

# ── S18b (codex Finding 2, negative): expanded-body args WITHOUT --resume → correct FRESH path
# (new board created, existing board untouched). Defends the fresh routing of the args-line parse.
H="$(make_project)"
B="$(seed_board "$H" "old-sess" "true" "pre-existing untouched goal")"
run_resume "$H" "new-sess" '<!-- cc-master:bootstrap:v1 -->\n<!-- cc-master:args: migrate the thing -->\nbody prose...'
assert_eq 2 "$(count_boards "$H")" "S18b: expanded-body without --resume → fresh board created"
assert_eq "old-sess" "$(board_sid "$B")" "S18b: pre-existing board owner UNTOUCHED on fresh"
assert_contains "$HOOK_OUT" "fresh" "S18b: expanded-body fresh context injected"
rm -rf "$H"

# ── S18c (codex Finding 2): expanded-body --resume <selector> selects the right board via the args
# line (selector after --resume is honored, same as the raw-command path).
H="$(make_project)"
Bi="$(seed_board "$H" "old-a" "true" "ship the i18n localization")"
Bp="$(seed_board "$H" "old-b" "true" "refactor the payments gateway")"
touch_mtime "$Bi" 60; touch_mtime "$Bp" 60
run_resume "$H" "new-sess" '<!-- cc-master:bootstrap:v1 -->\n<!-- cc-master:args: --resume i18n -->\nbody...'
assert_eq "new-sess" "$(board_sid "$Bi")" "S18c: expanded-body selector picks i18n board"
assert_eq "old-b" "$(board_sid "$Bp")" "S18c: payments board owner UNTOUCHED"
rm -rf "$H"

# ── S19 (codex Finding 3): a FRESH-mtime ARCHIVED board (active:false, just /stop'd) → --resume
# revives it WITHOUT --force-takeover. The freshness gate exists to protect a possibly-LIVE session;
# an archived board has no live session to orphan, so its new mtime must NOT block takeover. (S10b
# used a STALE mtime, so it never exercised the gate on an archived board — this uses a fresh one.)
H="$(make_project)"
B="$(seed_board "$H" "old-sess" "false" "freshly archived goal")"
touch_mtime "$B" 0   # FRESH mtime (just written) — but active:false, so freshness gate must skip it
run_resume "$H" "new-sess" '/cc-master:as-master-orchestrator --resume freshly'
assert_eq "new-sess" "$(board_sid "$B")" "S19: fresh-mtime archived board revived w/o force (sid re-stamped)"
assert_eq "true" "$(board_active "$B")" "S19: fresh-mtime archived board active false→true"
assert_contains "$HOOK_OUT" "TAKEN OVER" "S19: fresh archived board → takeover context (not a freshness warning)"
rm -rf "$H"

# ────────────────────────────────────────────────────────────────────────────────────────────────
# codex P2 finding regressions (second-reviewer catches on the resume degraded paths, 2026-06-15)
# ────────────────────────────────────────────────────────────────────────────────────────────────

# ── S20 (codex Finding A): a DEGRADED UserPromptSubmit (stdin carries NO session_id) must NOT mutate
# any existing board on --resume. Re-stamping owner.session_id="" would erase the original owner AND
# (per the armed gate) leave the board DORMANT for every real non-empty session_id — a board "taken
# over" into permanent silence. The resume flow must refuse up-front (before selecting/writing) and
# leave the board byte-for-byte unchanged. (Fresh path tolerates an empty sid because it builds a NEW
# blank board; resume OVERWRITES an existing owner, so the same empty sid is destructive here.)
H="$(make_project)"
B="$(seed_board "$H" "old-sess" "true" "abandoned active goal")"
before="$(cat "$B")"
run_resume_nosid "$H" '/cc-master:as-master-orchestrator --resume'
assert_eq 0 "$HOOK_RC" "S20: empty-sid resume exits 0 (no-op)"
assert_eq "$before" "$(cat "$B")" "S20: board byte-identical — empty-sid resume modifies NOTHING"
assert_eq "old-sess" "$(board_sid "$B")" "S20: original owner.session_id preserved (NOT erased to empty)"
assert_eq "true" "$(board_active "$B")" "S20: owner.active preserved"
assert_eq 1 "$(count_boards "$H")" "S20: no new board created on empty-sid resume"
assert_contains "$HOOK_OUT" "session id" "S20: context refuses — cannot resume without a session id"
rm -rf "$H"

# ── S21 (codex Finding B): heartbeat freshness must be DATED, not merely tested for presence. An
# active board with a JUST-NOW heartbeat but an unusable mtime (future) is possibly-LIVE → --resume
# WITHOUT --force-takeover must be withheld. The old code only checked `[ -n "$hb" ] && signal=1`
# (never aged the timestamp), so freshness rested entirely on mtime and a recent heartbeat could not
# block takeover.
H="$(make_project)"
B="$(seed_board "$H" "old-sess" "true" "live heartbeat goal")"
set_heartbeat "$B" "$(iso_minutes_ago 1)"   # heartbeat ~1min ago → strongly looks LIVE
mtime_future "$B"                            # mtime unusable → heartbeat is the only freshness signal
run_resume "$H" "new-sess" '/cc-master:as-master-orchestrator --resume live'
assert_eq "old-sess" "$(board_sid "$B")" "S21: recent heartbeat → board NOT taken over (sid unchanged)"
assert_eq "true" "$(board_active "$B")" "S21: recent-heartbeat board active unchanged"
assert_contains "$HOOK_OUT" "force-takeover" "S21: recent heartbeat → asks for --force-takeover"
rm -rf "$H"

# ── S22 (codex Finding B): heartbeat present but UNPARSEABLE (garbage, not ISO8601) AND mtime unusable
# → NO usable freshness signal → conservatively require force (withhold without --force-takeover). The
# old `[ -n "$hb" ] && signal=1` mis-read "non-empty" as "a signal", which (with mtime future) sailed
# straight to takeover with no force. Now a non-datable heartbeat contributes nothing.
H="$(make_project)"
B="$(seed_board "$H" "old-sess" "true" "garbage heartbeat goal")"
set_heartbeat "$B" "not-a-timestamp-xyz"   # non-empty but cannot be parsed to epoch
mtime_future "$B"                           # mtime unusable too → genuinely NO signal
run_resume "$H" "new-sess" '/cc-master:as-master-orchestrator --resume garbage'
assert_eq "old-sess" "$(board_sid "$B")" "S22: unparseable heartbeat + no mtime → NOT taken over (no force)"
assert_contains "$HOOK_OUT" "force-takeover" "S22: no usable signal → asks for force"
rm -rf "$H"

# ── S22b (codex Finding B): with force, the SAME unparseable-heartbeat board IS taken over (force
# overrides the conservative withhold) — proves S22 withholds on signal, not on a hard block.
H="$(make_project)"
B="$(seed_board "$H" "old-sess" "true" "garbage heartbeat forced goal")"
set_heartbeat "$B" "not-a-timestamp-xyz"
mtime_future "$B"
run_resume "$H" "new-sess" '/cc-master:as-master-orchestrator --resume garbage --force-takeover'
assert_eq "new-sess" "$(board_sid "$B")" "S22b: --force-takeover overrides the no-signal withhold"
assert_eq "true" "$(board_active "$B")" "S22b: forced takeover keeps active true"
rm -rf "$H"

# ── S23 (codex Finding B): heartbeat present and PARSEABLE but OLD (well past the threshold) AND mtime
# unusable → the board reads ABANDONED via the heartbeat channel → direct takeover WITHOUT force. This
# is the positive arm: an aged heartbeat is a usable "abandoned" signal, not a "withhold" one.
H="$(make_project)"
B="$(seed_board "$H" "old-sess" "true" "old heartbeat goal")"
set_heartbeat "$B" "$(iso_minutes_ago 120)"   # heartbeat 2h ago → well past the 10min threshold
mtime_future "$B"                              # mtime unusable → heartbeat is the sole signal
run_resume "$H" "new-sess" '/cc-master:as-master-orchestrator --resume "old heartbeat"'
assert_eq "new-sess" "$(board_sid "$B")" "S23: old heartbeat → abandoned → taken over (sid re-stamped)"
assert_eq "true" "$(board_active "$B")" "S23: old-heartbeat takeover keeps active true"
assert_contains "$HOOK_OUT" "TAKEN OVER" "S23: old heartbeat → takeover context (not a freshness warning)"
rm -rf "$H"

# ────────────────────────────────────────────────────────────────────────────────────────────────
# codex round-3 finding regressions (second-reviewer catches, 2026-06-15)
# ────────────────────────────────────────────────────────────────────────────────────────────────

# ── S24 (codex round-3 Finding C): the heartbeat parser must accept the MINUTE-precision ISO8601 that
# board.example.json / board.md document and a live session actually flushes (YYYY-MM-DDTHH:MMZ, e.g.
# 2026-06-15T05:52Z) — not only the SECOND-precision form the takeover re-stamp writes. The old shape-
# gate required seconds (`...T[0-9]{2}:[0-9]{2}:[0-9]{2}Z`), so a documented/real minute-precision
# heartbeat failed to parse → contributed NO freshness signal → with mtime unusable it defeated the
# live-safety gate (a possibly-LIVE board would be silently taken over). With the fix, a JUST-NOW
# minute-precision heartbeat dates as FRESH → --resume WITHOUT --force-takeover is withheld.
H="$(make_project)"
B="$(seed_board "$H" "old-sess" "true" "minute precision live goal")"
set_heartbeat "$B" "$(iso_minutes_ago_minprec 0)"   # minute-precision heartbeat, current minute → LIVE
mtime_future "$B"                                    # mtime unusable → heartbeat is the only signal
run_resume "$H" "new-sess" '/cc-master:as-master-orchestrator --resume "minute precision"'
assert_eq "old-sess" "$(board_sid "$B")" "S24: minute-precision recent heartbeat → board NOT taken over (sid unchanged)"
assert_eq "true" "$(board_active "$B")" "S24: minute-precision recent-heartbeat board active unchanged"
# MUST withhold via the FRESH (looks-LIVE) branch, NOT the no-signal branch — that distinction is the
# whole point: an unparseable minute heartbeat would ALSO withhold (signal=0 conservative branch) and
# pass a bare "force-takeover" check, masking the bug. Assert the LIVE-session phrasing so the test
# only passes when the minute-precision heartbeat actually DATES as fresh (the fix), not when it fails
# to parse and lands on the no-signal withhold (the bug).
assert_contains "$HOOK_OUT" "LIVE session" "S24: minute-precision recent heartbeat dates as FRESH (live-session withhold, not no-signal)"
assert_contains "$HOOK_OUT" "force-takeover" "S24: minute-precision recent heartbeat → asks for --force-takeover"
rm -rf "$H"

# ── S24b (codex round-3 Finding C): the SECOND-precision form the takeover re-stamp writes must STILL
# parse as a usable freshness signal (zero regression on the precision S21 already covers). An OLD
# second-precision heartbeat (well past threshold) + unusable mtime → reads ABANDONED via the heartbeat
# channel → direct takeover WITHOUT force. Proves the optional-seconds shape-gate keeps both precisions
# datable, not just the new minute one.
H="$(make_project)"
B="$(seed_board "$H" "old-sess" "true" "second precision old goal")"
set_heartbeat "$B" "$(iso_minutes_ago 120)"   # second-precision heartbeat 2h ago → abandoned
mtime_future "$B"                              # mtime unusable → heartbeat is the sole signal
run_resume "$H" "new-sess" '/cc-master:as-master-orchestrator --resume "second precision"'
assert_eq "new-sess" "$(board_sid "$B")" "S24b: old second-precision heartbeat still datable → abandoned → taken over"
assert_eq "true" "$(board_active "$B")" "S24b: second-precision takeover keeps active true"
assert_contains "$HOOK_OUT" "TAKEN OVER" "S24b: old second-precision heartbeat → takeover context (no regression)"
rm -rf "$H"

# ── S24c (codex round-3 Finding C): a minute-precision heartbeat that is OLD (past threshold) + mtime
# unusable → reads ABANDONED via the (now-parseable) heartbeat channel → direct takeover WITHOUT force.
# Positive arm proving minute precision is fully datable in BOTH directions (fresh-withhold AND
# abandoned-takeover), not merely accepted by the shape-gate.
H="$(make_project)"
B="$(seed_board "$H" "old-sess" "true" "minute precision old goal")"
set_heartbeat "$B" "$(iso_minutes_ago_minprec 120)"   # minute-precision heartbeat 2h ago → abandoned
mtime_future "$B"
run_resume "$H" "new-sess" '/cc-master:as-master-orchestrator --resume "minute precision old"'
assert_eq "new-sess" "$(board_sid "$B")" "S24c: old minute-precision heartbeat datable → abandoned → taken over"
assert_contains "$HOOK_OUT" "TAKEN OVER" "S24c: old minute-precision heartbeat → takeover context"
rm -rf "$H"

finish
