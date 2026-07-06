#!/usr/bin/env bash
. "$(dirname "$0")/helpers.sh"

# ── ④ CCM PRECHECK (ADR-021)·present-ccm baseline for the EXISTING "happy" cases ─────────────────────
# bootstrap now HARD-CHECKS ccm install presence at the ARM entry (ADR-021): missing ccm → refuse to arm
# (no board + a <directive source="bootstrap"> agent-relay install reminder·exit 0). So every case below
# that expects a board to be created needs ccm to be PRESENT. Tests own CCM_BIN (same口径 as
# test_identity-nudge / test_hook-ccm-decoupling): if run-tests.sh already exported CCM_BIN (the dev-bin
# shim), reuse it; otherwise point it at the shim so the gate sees ccm regardless of PATH. The gate is
# `[ -x "$CCM_BIN" ]` — the shim is an executable wrapper, so existence is enough (the gate never spawns
# ccm). The dedicated ccm-ABSENT cases (G-series, bottom) override CCM_BIN to a nonexistent path.
if [ -z "${CCM_BIN:-}" ]; then
  _SHIM="$REPO_ROOT/ccm/apps/cli/dev-bin/ccm"
  # Adopt the shim ONLY if it is FUNCTIONAL (dist built → `--version` succeeds). The shim is a thin
  # `exec node bin/ccm.cjs` wrapper that require()s ccm/apps/cli/dist/index.cjs — when the dist has not
  # been built (no pnpm / version-mismatched pnpm / missing node_modules), the shim is executable but
  # every spawn fails. Adopting a non-functional shim would make the arm gate (`[ -x ]`, existence-only)
  # pass yet silently break `ccm board update` / `ccm policy set` in the INIT-FLAGS cases, so the flags
  # never land (board keeps template defaults). Probing `--version` distinguishes "built shim" from
  # "unbuilt shim"; when unbuilt we leave CCM_BIN unset so both the gate's `command -v ccm` AND
  # bootstrap's CCM_CMD=${CCM_BIN:-ccm} fall through to a working on-PATH ccm. On CI the dist is built,
  # so the functional shim is adopted; on a dev box with only PATH ccm, PATH ccm is used.
  if [ -x "$_SHIM" ] && "$_SHIM" --version >/dev/null 2>&1; then
    export CCM_BIN="$_SHIM"
  else
    # No functional shim (unbuilt dist) → resolve a working on-PATH ccm and point CCM_BIN at it. This
    # matters beyond the arm gate: the INIT-FLAGS series itself gates on `[ -x "$CCM_BIN" ]` and spawns
    # `$CCM_BIN board update` / `$CCM_BIN policy set`, so it needs CCM_BIN to name a FUNCTIONAL binary
    # (leaving it unset would only skip the series, never exercise the flag-write path). On CI the shim
    # is built (adopted above); on a dev box with only PATH ccm, that PATH ccm is used here.
    _PATH_CCM="$(command -v ccm 2>/dev/null || true)"
    if [ -n "$_PATH_CCM" ] && "$_PATH_CCM" --version >/dev/null 2>&1; then export CCM_BIN="$_PATH_CCM"; fi
  fi
  # else (neither functional shim nor on-PATH ccm): CCM_BIN stays unset → the happy cases correctly
  #   refuse to arm and the INIT-FLAGS series skips; CI/dev環境 always has one of shim/ccm.
fi
NO_CCM="/no/such/ccm-binary-$$"   # nonexistent executable → CCM_BIN override → ccm-ABSENT gate path

# board 集中落 <home>/boards/（board-v2 布局）；这些 helper 入参传 home **根**，内部扫 boards/ 子目录。
count_boards() { ls "$1/boards"/*.board.json 2>/dev/null | wc -l | tr -d ' '; }
# board_sid FILE — extract owner.session_id value (pure bash). owner precedes tasks[] in the pinned
# waist, so the FIRST "session_id" token is owner's. grep -o the first token BEFORE sed: a greedy
# `.*"session_id"` on a single line bearing several session_id-shaped fields would otherwise capture
# the LAST one (a task-level decoy), not owner's.
board_sid() {
  grep -oE '"session_id"[[:space:]]*:[[:space:]]*"[^"]*"' "$1" | head -1 \
    | sed -n 's/.*"session_id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p'
}
# only_board HOME — echo the single board path in <HOME>/boards/ (assumes exactly one).
only_board() { ls "$1/boards"/*.board.json 2>/dev/null | head -1; }
# board_has_template_version FILE — grep the agent-shaped meta.template_version field (integer value).
# Pure bash, no jq. Echoes the integer if present, empty otherwise.
board_template_version() {
  grep -oE '"template_version"[[:space:]]*:[[:space:]]*[0-9]+' "$1" | head -1 \
    | sed -n 's/.*"template_version"[[:space:]]*:[[:space:]]*\([0-9]*\).*/\1/p'
}

# Case A: command-name sentinel → exactly one board in the default home, path + role injected
P="$(make_project)"
run_hook "hooks/scripts/bootstrap-board.sh" '{"prompt":"/cc-master:as-master-orchestrator migrate the thing"}' "$P"
assert_eq 0 "$HOOK_RC" "bootstrap exits 0"
assert_eq 1 "$(count_boards "$P/.claude/cc-master")" "exactly one board created in default home"
assert_contains "$HOOK_OUT" ".board.json" "injects the board path"
assert_contains "$HOOK_OUT" "orchestrator" "injects the orchestrator role"
# fresh boards carry meta.template_version — agent-shaped versioning the timeline reads to gate its
# real-time axis. The skeleton is now built by `ccm board init` (board.template.json was DELETED — a hook
# must not reach into skill assets; bootstrap builds the skeleton via ccm·ADR-014), so ccm is the SSOT for
# the version. DERIVE THE EXPECTED VERSION FROM THAT SSOT (TF1): run `ccm board init` into a throwaway home
# and read the version off its product, so the assertion tracks whatever version ccm ships rather than a
# hardcoded literal that would silently lag a bump. Also create the asserted board in a FRESH project home
# so there is exactly one board (no ls -t tie-break at all).
_TV_HOME="$(make_project)"
CC_MASTER_HOME="$_TV_HOME" "${CCM_BIN:-ccm}" board init >/dev/null 2>&1
EXPECTED_TV="$(board_template_version "$(only_board "$_TV_HOME")")"
rm -rf "$_TV_HOME"
P2="$(make_project)"
HOOK_OUT="$(printf '%s' '{"prompt":"/cc-master:as-master-orchestrator x"}' \
  | CLAUDE_PROJECT_DIR="$P2" CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" CC_MASTER_HOME="$P2/.claude/cc-master" \
    bash "$PLUGIN_ROOT/hooks/scripts/bootstrap-board.sh" 2>/dev/null)"
assert_eq "$EXPECTED_TV" "$(board_template_version "$(only_board "$P2/.claude/cc-master")")" "A: fresh board carries the ccm-init skeleton's meta.template_version ($EXPECTED_TV)"
rm -rf "$P" "$P2"

# Case A0 (no skill-asset dependency): bootstrap builds the skeleton via `ccm board init`, NOT by copying
# a skill asset (board.template.json was DELETED; the inline printf fallback is gone too). Even with a
# BOGUS/empty CLAUDE_PLUGIN_ROOT (no skills/ tree at all) the board is still created and carries
# meta.template_version — proving the hooks ⊥ skill-assets decoupling (bootstrap no longer reads PLUGIN_ROOT).
P="$(make_project)"; EMPTY_ROOT="$(make_project)"
HOOK_OUT="$(printf '%s' '{"session_id":"sess-fb","prompt":"/cc-master:as-master-orchestrator x"}' \
  | CLAUDE_PROJECT_DIR="$P" CLAUDE_PLUGIN_ROOT="$EMPTY_ROOT" CC_MASTER_HOME="$P/.claude/cc-master" \
    bash "$PLUGIN_ROOT/hooks/scripts/bootstrap-board.sh" 2>/dev/null)"
assert_eq 1 "$(count_boards "$P/.claude/cc-master")" "A0: board built via ccm regardless of PLUGIN_ROOT (no skill-asset dependency)"
assert_eq "$EXPECTED_TV" "$(board_template_version "$(only_board "$P/.claude/cc-master")")" "A0: ccm-built board carries meta.template_version=$EXPECTED_TV (no template file needed)"
rm -rf "$P" "$EMPTY_ROOT"

# Case A1 (ARM = stamp session_id): bootstrap is the ARM action — the board it creates is born
# OWNED by the creating session. The hook must stamp owner.session_id from the stdin session_id
# (not leave it ""), so the session-scoped armed gate (active:true AND owner.session_id==sid) is
# immediately satisfiable for the very session that armed it.
P="$(make_project)"
HOOK_OUT="$(printf '%s' '{"session_id":"sess-boot-1","prompt":"/cc-master:as-master-orchestrator do the thing"}' \
  | CLAUDE_PROJECT_DIR="$P" CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" CC_MASTER_HOME="$P/.claude/cc-master" \
    bash "$PLUGIN_ROOT/hooks/scripts/bootstrap-board.sh" 2>/dev/null)"
assert_eq 1 "$(count_boards "$P/.claude/cc-master")" "A1: board created"
assert_eq "sess-boot-1" "$(board_sid "$(only_board "$P/.claude/cc-master")")" "A1: bootstrap stamps owner.session_id from stdin session_id"
rm -rf "$P"

# Case A2 (stamp regression, body-sentinel path + template fallback): even when the prompt arrives
# as the expanded body marker (not the raw command), the created board still carries the real sid.
P="$(make_project)"
HOOK_OUT="$(printf '%s' '{"session_id":"sess-boot-2","prompt":"<!-- cc-master:bootstrap:v1 -->\n..."}' \
  | CLAUDE_PROJECT_DIR="$P" CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" CC_MASTER_HOME="$P/.claude/cc-master" \
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
assert_contains "$HOOK_OUT" "MANDATORY NEXT STEP" "fresh bootstrap requires DAG before work"
assert_contains "$HOOK_OUT" "zero tasks is not a runnable orchestration" "fresh bootstrap rejects empty-board progress"
BOARD_F="$(ls "$P/.claude/cc-master/boards"/*.board.json | head -n1)"
assert_contains "$HOOK_OUT" "ccm task add --board $BOARD_F" "fresh bootstrap gives exact ccm board path"
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
  mkdir -p "$home/boards"   # board 落 <home>/boards/（board-v2 布局）
  local bp; bp="$(mktemp "$home/boards/20260101T000000Z-seedXXXXXX")"; mv "$bp" "$bp.board.json"; bp="$bp.board.json"
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
H="$(make_project)"; mkdir -p "$H/boards"
Bc="$H/boards/20260101T010101Z-compact.board.json"
printf '{"schema":"cc-master/v1","goal":"compactfmt","owner":{"active":true,"session_id":"old-c","heartbeat":""},"git":{"worktree":"","branch":""},"tasks":[{"id":"T1","status":"done"}],"log":[]}\n' > "$Bc"
touch_mtime "$Bc" 60
run_resume "$H" "new-c" '/cc-master:as-master-orchestrator --resume compactfmt'
assert_eq "new-c" "$(board_sid "$Bc")" "S16a: compact JSON re-stamped"
assert_eq "true" "$(board_active "$Bc")" "S16a: compact JSON active stays true"
rm -rf "$H"
H="$(make_project)"; mkdir -p "$H/boards"
Bm="$H/boards/20260101T020202Z-multi.board.json"
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
# live-safety gate (a possibly-LIVE board would be silently taken over). With the fix, a RECENT
# minute-precision heartbeat dates as FRESH → --resume WITHOUT --force-takeover is withheld.
# DETERMINISTIC TIME (TF1): use 1 minute ago, NOT the current minute (0). A current-minute,
# minute-precision string (`HH:MM Z`, seconds truncated to :00) parsed back to epoch by BSD `date -j`
# fills the missing %S field from the CURRENT wall-clock seconds — so its epoch lands ON the same
# minute as `now`, and because the hook samples `now` (L385) BEFORE it parses the heartbeat (L402),
# any parse delay (≥1s under full-suite load) makes hb_epoch > now → the `hb_epoch -le now` guard
# drops it as "no signal" → no-signal withhold instead of the LIVE-session withhold → this assert
# fails intermittently (~5% under load). 1 minute ago keeps the heartbeat unambiguously fresh
# (age ~60-119s ≪ 600s window → still dates as FRESH / LIVE) while making hb_epoch < now hold
# regardless of parse timing — the BSD %S-fill can only push the second field within the PRIOR
# minute, never past `now`. Discriminating power is preserved: still minute-precision, still
# fresh-dating, still the LIVE-session branch (the round-3 Finding C contract).
H="$(make_project)"
B="$(seed_board "$H" "old-sess" "true" "minute precision live goal")"
set_heartbeat "$B" "$(iso_minutes_ago_minprec 1)"   # minute-precision heartbeat, ~1min ago → fresh/LIVE, race-free
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

# ────────────────────────────────────────────────────────────────────────────────────────────────
# codex second-perspective findings on the global-home resolution / migration (2026-06-26)
# ────────────────────────────────────────────────────────────────────────────────────────────────

# ── F1 (codex HIGH): a legacy board sitting FLAT under the resolved home ROOT (old layout, before the
#    boards/ subdir existed — common when a user points CC_MASTER_HOME at an old flat-layout dir whose
#    boards live directly inside it) must be migrated into <home>/boards/ so --resume (which only scans
#    boards/) can find it. The old migration's over-broad dest-under-src guard (`"$src"|"$src"/*`)
#    early-returned this LEGITIMATE direction (<home> → <home>/boards/), so the root board never reached
#    boards/ and resume silently saw NO board (lost board). The fix migrates the home root too, even when
#    CC_MASTER_HOME IS the home root. Force takeover so the assertion is deterministic regardless of the
#    copy's fresh mtime (cp resets mtime to now → would otherwise read as "looks LIVE").
H="$(make_project)"
printf '{"schema":"cc-master/v1","goal":"legacy flat goal","owner":{"active":true,"session_id":"old-flat","heartbeat":""},"git":{"worktree":"","branch":""},"tasks":[{"id":"T1","status":"done","deps":[]}],"log":[]}\n' > "$H/20250101T000000Z-legacyflat.board.json"
run_resume "$H" "new-sess" '/cc-master:as-master-orchestrator --resume --force-takeover'
assert_file "$H/boards/20250101T000000Z-legacyflat.board.json" "F1: flat-layout root board migrated into boards/ (idempotent copy)"
assert_file "$H/20250101T000000Z-legacyflat.board.json" "F1: original flat board preserved (non-destructive copy, not move)"
assert_eq "new-sess" "$(board_sid "$H/boards/20250101T000000Z-legacyflat.board.json")" "F1: migrated board is now resumable (forced takeover re-stamped sid)"
assert_eq "old-flat" "$(board_sid "$H/20250101T000000Z-legacyflat.board.json")" "F1: original flat board owner untouched (it was copied, not moved)"
assert_contains "$HOOK_OUT" "TAKEN OVER" "F1: resume found & took over the migrated flat board (it was invisible before the fix)"
rm -rf "$H"

# ── F2 (codex medium): when CC_MASTER_HOME and HOME are BOTH unset (HOME-less env) the bootstrap must
#    (1) NOT crash under `set -u` (the old bare `$HOME` → "HOME: unbound variable"), and — root cause, not
#    just the symptom — (2) NOT silently degrade to the absolute-root "/.claude/cc-master" and emit a BOGUS
#    "board was created" injection / write a board there. The fix FAILS LOUD: a clear stderr diagnostic +
#    clean exit (rc 0) + NO board. Drive a TRIGGERING prompt (so home resolution past the trigger gate is
#    actually reached) with BOTH unset; capture stdout and stderr SEPARATELY and assert all four.
F2DIR="$(make_project)"
printf '%s' '{"prompt":"/cc-master:as-master-orchestrator x"}' \
  | env -u HOME -u CC_MASTER_HOME CLAUDE_PROJECT_DIR="$F2DIR" CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" \
    bash "$PLUGIN_ROOT/hooks/scripts/bootstrap-board.sh" >"$F2DIR/out" 2>"$F2DIR/err"
F2_RC=$?
F2_OUT="$(cat "$F2DIR/out")"; F2_ERR="$(cat "$F2DIR/err")"
assert_eq 0 "$F2_RC" "F2: HOME-less + CC_MASTER_HOME-less triggering bootstrap exits cleanly (rc 0)"
assert_not_contains "$F2_ERR" "unbound variable" "F2: no set -u crash (symptom): home resolver guards HOME under nounset"
assert_contains "$F2_ERR" "无法解析 home 目录" "F2: FAIL-LOUD — clear stderr diagnostic when home is unresolvable (root cause, not silent degrade)"
assert_not_contains "$F2_OUT" "board was created" "F2: NO bogus board — does not degrade to /.claude/cc-master and claim a fresh board was created"
rm -rf "$F2DIR"

# ── F4 (codex low): the CLAUDE_PROJECT_DIR legacy-migration source must be SKIPPED when CLAUDE_PROJECT_DIR
#    is empty — otherwise "${CLAUDE_PROJECT_DIR:-}/.claude/cc-master" collapses to the absolute ROOT
#    "/.claude/cc-master" and could copy unrelated boards (migrate's internal `[ -n "$src" ]` does NOT
#    catch it — src is non-empty there). A behavioral trigger needs a root-owned /.claude (not hermetic),
#    so this is a source-shape regression: the call must be wrapped in a non-empty CLAUDE_PROJECT_DIR
#    guard, and the old UNGUARDED form must be gone.
F4_SRC="$(cat "$PLUGIN_ROOT/hooks/scripts/bootstrap-board.sh")"
assert_not_contains "$F4_SRC" 'migrate_legacy_boards "${CLAUDE_PROJECT_DIR:-}/.claude/cc-master"' "F4: no UNGUARDED CLAUDE_PROJECT_DIR migration (empty → absolute-root /.claude footgun removed)"
assert_contains "$F4_SRC" '[ -n "${CLAUDE_PROJECT_DIR:-}" ]' "F4: project-dir migration is guarded by a non-empty CLAUDE_PROJECT_DIR check"

# ────────────────────────────────────────────────────────────────────────────────────────────────
# ④ CCM HARD PRECHECK (ADR-021): ccm install-presence gate at the ARM entry. Missing ccm → refuse to
# arm: inject a <directive source="bootstrap"> agent-relay install reminder, create NO board, exit 0.
# Present ccm → unchanged (board created — covered by every "happy" case above, which run under the
# CCM_BIN baseline). Drive ccm-ABSENT via CCM_BIN → nonexistent executable.
# ────────────────────────────────────────────────────────────────────────────────────────────────

# ── G1: raw command + ccm ABSENT → NO board + directive injected + rc 0 (refuse to arm, not block)
P="$(make_project)"
HOOK_OUT="$(printf '%s' '{"session_id":"sess-noccm","prompt":"/cc-master:as-master-orchestrator do the thing"}' \
  | CLAUDE_PROJECT_DIR="$P" CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" CC_MASTER_HOME="$P/.claude/cc-master" CCM_BIN="$NO_CCM" \
    bash "$PLUGIN_ROOT/hooks/scripts/bootstrap-board.sh" 2>/dev/null)"; G1_RC=$?
assert_eq 0 "$G1_RC" "G1: ccm-absent bootstrap exits 0 (refuse to arm, NOT decision:block)"
assert_eq 0 "$(count_boards "$P/.claude/cc-master")" "G1: ccm absent → NO board created (refuse to arm)"
assert_contains "$HOOK_OUT" "<directive source=" "G1: injects a directive (agent-relay install reminder)"
assert_contains "$HOOK_OUT" "ccm" "G1: directive names ccm as the missing pre-requisite"
assert_valid_json "$HOOK_OUT" "G1: ccm-absent directive stdout is valid JSON"
rm -rf "$P"

# ── G2: body-sentinel path + ccm ABSENT → also refuses (the gate is after the trigger demux, before
#    board creation, so BOTH trigger forms hit it)
P="$(make_project)"
HOOK_OUT="$(printf '%s' '{"session_id":"sess-noccm2","prompt":"<!-- cc-master:bootstrap:v1 -->\n..."}' \
  | CLAUDE_PROJECT_DIR="$P" CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" CC_MASTER_HOME="$P/.claude/cc-master" CCM_BIN="$NO_CCM" \
    bash "$PLUGIN_ROOT/hooks/scripts/bootstrap-board.sh" 2>/dev/null)"; G2_RC=$?
assert_eq 0 "$G2_RC" "G2: body-sentinel + ccm-absent exits 0"
assert_eq 0 "$(count_boards "$P/.claude/cc-master")" "G2: body-sentinel + ccm absent → NO board"
assert_contains "$HOOK_OUT" "<directive source=" "G2: body-sentinel path also injects the directive"
rm -rf "$P"

# ── G3: ccm ABSENT does NOT arm — the home stays board-free, so every runtime hook stays dormant
#    (dormant-until-armed naturally holds: no active board → nothing to match). Assert no board file at all.
P="$(make_project)"
HOOK_OUT="$(printf '%s' '{"session_id":"sess-noccm3","prompt":"/cc-master:as-master-orchestrator x"}' \
  | CLAUDE_PROJECT_DIR="$P" CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" CC_MASTER_HOME="$P/.claude/cc-master" CCM_BIN="$NO_CCM" \
    bash "$PLUGIN_ROOT/hooks/scripts/bootstrap-board.sh" 2>/dev/null)"
assert_no_file "$P/.claude/cc-master/boards"/*.board.json "G3: ccm absent → no board file anywhere (no arming → hooks stay dormant)"
rm -rf "$P"

# ── G4: unrelated prompt + ccm ABSENT → STILL a silent no-op (the ccm gate is AFTER the trigger gate,
#    so a non-triggering prompt never reaches it — no directive leaks onto unrelated prompts)
P="$(make_project)"
HOOK_OUT="$(printf '%s' '{"prompt":"what files changed today?"}' \
  | CLAUDE_PROJECT_DIR="$P" CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" CC_MASTER_HOME="$P/.claude/cc-master" CCM_BIN="$NO_CCM" \
    bash "$PLUGIN_ROOT/hooks/scripts/bootstrap-board.sh" 2>/dev/null)"; G4_RC=$?
assert_eq 0 "$G4_RC" "G4: unrelated prompt + ccm-absent exits 0 (silent no-op)"
assert_eq "" "$HOOK_OUT" "G4: unrelated prompt → NO directive (ccm gate is after the trigger gate)"
rm -rf "$P"

# ── G5: present-ccm regression via the explicit CCM_BIN override (the gate's CCM_BIN branch, not just
#    the PATH branch) → board IS created (proves `[ -x "$CCM_BIN" ]` lets a real ccm through)
P="$(make_project)"
if [ -n "${CCM_BIN:-}" ] && [ -x "${CCM_BIN:-}" ]; then
  HOOK_OUT="$(printf '%s' '{"session_id":"sess-ccm-ok","prompt":"/cc-master:as-master-orchestrator x"}' \
    | CLAUDE_PROJECT_DIR="$P" CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" CC_MASTER_HOME="$P/.claude/cc-master" \
      bash "$PLUGIN_ROOT/hooks/scripts/bootstrap-board.sh" 2>/dev/null)"
  assert_eq 1 "$(count_boards "$P/.claude/cc-master")" "G5: present ccm (CCM_BIN -x) → board created (gate passes)"
  assert_not_contains "$HOOK_OUT" '<directive source="bootstrap">' "G5: present ccm → no install directive"
else
  echo "(G5 skipped — no executable CCM_BIN/ccm available to prove the present-ccm gate branch)"
fi
rm -rf "$P"

# ════════════════════════════════════════════════════════════════════════════════════════════════════
# ── INIT-FLAGS series (方案A·ADR-020 §2.45)：fresh 路径据用户亲手敲的启动 flag（--priority / --wip /
#    --owner-wip / --policy-switch）经 ccm board update / ccm policy set 把刚建的板预设好。需要一个真 ccm
#    （CCM_BIN -x），否则跳过（flag 应用是 best-effort：ccm 缺时板照建·flag 不落地·只附 advisory）。
# ════════════════════════════════════════════════════════════════════════════════════════════════════
# board 字段读取（板被 ccm 写后是 pretty-printed 多行 JSON·纯 bash/sed·无 jq）。
#   coordination.priority 是板上唯一 "priority"（fresh 无 task 覆写）；scheduling.wip_limit 是首个 "wip_limit"。
board_priority() { sed -n 's/.*"priority"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$1" | head -1; }
board_wip_limit() { sed -n 's/.*"wip_limit"[[:space:]]*:[[:space:]]*\([0-9]*\).*/\1/p' "$1" | head -1; }
board_owner_wip() { sed -n 's/.*"owner_wip_limit"[[:space:]]*:[[:space:]]*\([0-9]*\).*/\1/p' "$1" | head -1; }
board_policy_switch() { sed -n 's/.*"autonomous_account_switch"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$1" | head -1; }
board_task_count() {
  node -e 'const fs=require("fs");const b=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));const tasks=Array.isArray(b.tasks)?b.tasks:[];process.stdout.write(String(tasks.length));' "$1";
}
board_github_issue_source() {
  node -e 'const fs=require("fs");const b=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));const s=b.source&&typeof b.source==="object"?b.source:{};process.stdout.write(s.kind==="github_issue"&&typeof s.url==="string"?s.url:"");' "$1";
}

if [ -n "${CCM_BIN:-}" ] && [ -x "${CCM_BIN:-}" ]; then
  # ── IF1 (raw-command path): all four flags valid → board update + policy set applied to the new board.
  P="$(make_project)"
  HOOK_OUT="$(printf '%s' '{"session_id":"sess-if1","prompt":"/cc-master:as-master-orchestrator build the widget --priority high --wip 3 --owner-wip 2 --policy-switch deny"}' \
    | CLAUDE_PROJECT_DIR="$P" CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" CC_MASTER_HOME="$P/.claude/cc-master" \
      bash "$PLUGIN_ROOT/hooks/scripts/bootstrap-board.sh" 2>/dev/null)"
  IF1_BOARD="$(only_board "$P/.claude/cc-master")"
  assert_eq 1 "$(count_boards "$P/.claude/cc-master")" "IF1: board created (raw-command path)"
  assert_eq "high" "$(board_priority "$IF1_BOARD")" "IF1: --priority high → coordination.priority"
  assert_eq "3" "$(board_wip_limit "$IF1_BOARD")" "IF1: --wip 3 → scheduling.wip_limit"
  assert_eq "2" "$(board_owner_wip "$IF1_BOARD")" "IF1: --owner-wip 2 → scheduling.owner_wip_limit"
  assert_eq "deny" "$(board_policy_switch "$IF1_BOARD")" "IF1: --policy-switch deny → policy.autonomous_account_switch"
  assert_valid_json "$HOOK_OUT" "IF1: ctx is valid JSON"
  assert_contains "$HOOK_OUT" "原样保留" "IF1: ctx tells agent the preset knobs are already on the board (别覆写)"
  rm -rf "$P"

  # ── IF2 (body-sentinel path): args recovered from the <!-- cc-master:args: ... --> line apply too.
  P="$(make_project)"
  HOOK_OUT="$(printf '%s' '{"session_id":"sess-if2","prompt":"<!-- cc-master:bootstrap:v1 -->\n<!-- cc-master:args: ship it --priority urgent --wip 5 --policy-switch allow -->\nbody..."}' \
    | CLAUDE_PROJECT_DIR="$P" CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" CC_MASTER_HOME="$P/.claude/cc-master" \
      bash "$PLUGIN_ROOT/hooks/scripts/bootstrap-board.sh" 2>/dev/null)"
  IF2_BOARD="$(only_board "$P/.claude/cc-master")"
  assert_eq 1 "$(count_boards "$P/.claude/cc-master")" "IF2: board created (body-sentinel path)"
  assert_eq "urgent" "$(board_priority "$IF2_BOARD")" "IF2: body-sentinel --priority urgent → coordination.priority"
  assert_eq "5" "$(board_wip_limit "$IF2_BOARD")" "IF2: body-sentinel --wip 5 → scheduling.wip_limit"
  assert_eq "allow" "$(board_policy_switch "$IF2_BOARD")" "IF2: body-sentinel --policy-switch allow → policy"
  rm -rf "$P"

  # ── IF3 (no flags): a plain goal leaves the template defaults untouched (no spurious writes).
  P="$(make_project)"
  HOOK_OUT="$(printf '%s' '{"session_id":"sess-if3","prompt":"/cc-master:as-master-orchestrator just a plain goal"}' \
    | CLAUDE_PROJECT_DIR="$P" CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" CC_MASTER_HOME="$P/.claude/cc-master" \
      bash "$PLUGIN_ROOT/hooks/scripts/bootstrap-board.sh" 2>/dev/null)"
  IF3_BOARD="$(only_board "$P/.claude/cc-master")"
  assert_eq "4" "$(board_wip_limit "$IF3_BOARD")" "IF3: no --wip → template default wip_limit=4 untouched"
  assert_eq "" "$(board_priority "$IF3_BOARD")" "IF3: no --priority → no coordination.priority written"
  assert_not_contains "$HOOK_OUT" "原样保留" "IF3: no flags → no preset-knob note in ctx"
  rm -rf "$P"

  # ── IF4 (invalid values·best-effort): bad enum/int are SKIPPED + noted in an advisory, board still
  #    created with template defaults, hook still exits 0 (illegal flag never blocks startup).
  P="$(make_project)"
  HOOK_OUT="$(printf '%s' '{"session_id":"sess-if4","prompt":"/cc-master:as-master-orchestrator do it --priority bogus --wip abc --policy-switch maybe"}' \
    | CLAUDE_PROJECT_DIR="$P" CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" CC_MASTER_HOME="$P/.claude/cc-master" \
      bash "$PLUGIN_ROOT/hooks/scripts/bootstrap-board.sh" 2>/dev/null)"; IF4_RC=$?
  IF4_BOARD="$(only_board "$P/.claude/cc-master")"
  assert_eq 0 "$IF4_RC" "IF4: invalid flag values still exit 0 (best-effort·never block)"
  assert_eq 1 "$(count_boards "$P/.claude/cc-master")" "IF4: board still created despite invalid flags"
  assert_eq "4" "$(board_wip_limit "$IF4_BOARD")" "IF4: invalid --wip abc skipped → wip_limit stays default 4"
  assert_eq "" "$(board_priority "$IF4_BOARD")" "IF4: invalid --priority bogus skipped → no priority written"
  assert_eq "" "$(board_policy_switch "$IF4_BOARD")" "IF4: invalid --policy-switch maybe skipped → no policy written"
  # NB: the ctx is JSON-escaped on the way out (s/"/\\"/g), so the quote chars appear as \" in HOOK_OUT
  #   — match on the quote-free prefix `<advisory source=` (same pattern the G-series uses for <directive).
  assert_contains "$HOOK_OUT" "<advisory source=" "IF4: invalid values noted in a bootstrap advisory"
  assert_valid_json "$HOOK_OUT" "IF4: ctx with advisory is still valid JSON"
  rm -rf "$P"

  # ── IF5 (github issue source): valid --github-issue in fresh bootstrap records board source, not a task.
  P="$(make_project)"
  ISSUE_URL="https://github.com/example/repo/issues/123"
  HOOK_OUT="$(printf '%s' "{\"session_id\":\"sess-if5\",\"prompt\":\"/cc-master:as-master-orchestrator fix bug --github-issue ${ISSUE_URL}\"}" \
    | CLAUDE_PROJECT_DIR="$P" CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" CC_MASTER_HOME="$P/.claude/cc-master" \
      bash "$PLUGIN_ROOT/hooks/scripts/bootstrap-board.sh" 2>/dev/null)"
  IF5_BOARD="$(only_board "$P/.claude/cc-master")"
  assert_eq "$ISSUE_URL" "$(board_github_issue_source "$IF5_BOARD")" "IF5: --github-issue records board.source"
  assert_eq 0 "$(board_task_count "$IF5_BOARD")" "IF5: issue source does not synthesize a task"
  assert_contains "$HOOK_OUT" "github-issue=" "IF5: ctx notes the github-issue source was applied"
  rm -rf "$P"

  # ── IF6 (invalid github issue URL): non-HTTP(S) URL 被跳过并留下 advisory，不新增任务。
  P="$(make_project)"
  HOOK_OUT="$(printf '%s' '{"session_id":"sess-if6","prompt":"/cc-master:as-master-orchestrator fix bug --github-issue ftp://example.com/issue"}' \
    | CLAUDE_PROJECT_DIR="$P" CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" CC_MASTER_HOME="$P/.claude/cc-master" \
      bash "$PLUGIN_ROOT/hooks/scripts/bootstrap-board.sh" 2>/dev/null)"
  IF6_BOARD="$(only_board "$P/.claude/cc-master")"
  assert_eq "" "$(board_github_issue_source "$IF6_BOARD")" "IF6: invalid --github-issue does not record board source"
  assert_eq 0 "$(board_task_count "$IF6_BOARD")" "IF6: invalid --github-issue does not add any tasks"
  assert_contains "$HOOK_OUT" "<advisory source=" "IF6: invalid --github-issue emits advisory"
  rm -rf "$P"

  # ── IF7 (resume path)：resume 不新增 issue 种子任务（与 fresh 分支语义隔离）
  P="$(make_project)"
  ISSUE_BOARD="$(seed_board "$P/resume" "old-sess" "true" "existing work" )"
  # keep one board so resume can match by stem.
  run_resume "$P/resume" "new-sess" '/cc-master:as-master-orchestrator --resume existing --github-issue https://github.com/example/repo/issues/456'
  assert_eq 2 "$(board_task_count "$ISSUE_BOARD")" "IF7: resume path keeps existing tasks (including bootstrap seed from seed_board fixture)"
  assert_eq "" "$(board_github_issue_source "$ISSUE_BOARD")" "IF7: resume ignores --github-issue"
  rm -rf "$P"
else
  echo "(INIT-FLAGS series skipped — no executable CCM_BIN/ccm to apply board update/policy set)"
fi

finish
