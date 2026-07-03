#!/usr/bin/env bash
# UserPromptSubmit hook: when the as-master-orchestrator command is invoked, deterministically
# create a NEW uniquely-named board in the configurable home, then inject its path + the
# orchestrator role so the agent knows which board is its own. This hook does NOT self-gate on a
# marker (it is the activator) — it gates on a TIGHTENED dual sentinel so that text which merely
# *mentions* the command name (a task-notification, a sub-agent result, a user discussing the
# command) no longer false-triggers an empty board (Finding #15):
#   1. raw command  — the prompt field VALUE starts with /cc-master:as-master-orchestrator
#                     (leading whitespace tolerated); a mid-text mention does not qualify.
#   2. expanded body— the cc-master:bootstrap:v1 marker (an HTML comment that opens the expanded
#                     command body, right after the frontmatter) is the prompt's FIRST non-empty
#                     line. Kept as a safety backup in case UserPromptSubmit sees the expanded body,
#                     not the raw cmd. The marker MUST be the first non-empty line, not a bare
#                     substring anywhere in stdin — otherwise prose that merely *mentions* the marker
#                     mid-sentence (a sub-agent report quoting the command-file convention) would
#                     false-trigger an empty board (Finding #16).
# Pure bash extraction of the JSON prompt field — no jq/node (ship-anywhere).
#
# ARMING NOTE (hook armed-gate discipline): every OTHER cc-master hook stays fully dormant until this
# session is "armed" — armed ⟺ home holds a *.board.json with owner.active:true AND owner.session_id
# == this session's id. This bootstrap hook is the ARM ACTION ITSELF: it is the only hook EXEMPT from
# that gate (it cannot require a prior armed board — it creates the armed state). To make the
# session-scoped gate satisfiable the instant the board is born, it stamps owner.session_id from the
# stdin session_id below (instead of leaving it ""), so the creating session immediately owns its board.
set -uo pipefail

stdin="$(cat)"

# ── stdin → session_id (pure bash, no jq; same extraction as verify-board.sh / reinject.sh) ─────────
# This is the ARM identity stamped onto the new board's owner.session_id, so the armed gate
# (active:true AND owner.session_id==sid) is immediately true for the session that armed it.
sid="$(printf '%s' "$stdin" | sed -n 's/.*"session_id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)"

# ── BASH SSOT: cc-master home 解析（统一全局口径·board-v2 home 收口）─────────────────────────────────
# claude_config_dir — claude 配置根（跟随 $CLAUDE_CONFIG_DIR·默认 $HOME/.claude）。与 node 侧
#   hook-common.claudeConfigDir / ccm paths.resolveClaudeConfigDir 同口径。纯 bash·ship-anywhere。
#   `${HOME:-}` 守卫只保函数自身在 `set -u` 下不崩；都空时塌成根 `/.claude`（无意义）由调用点 fail-loud 闸兜。
claude_config_dir() { printf '%s' "${CLAUDE_CONFIG_DIR:-${HOME:-}/.claude}"; }
# cc_master_home — cc-master home **根**目录。优先级：$CC_MASTER_HOME 覆写 → $HOME/.cc_master
#   （全局·默认·harness-neutral）。**不再** per-repo（CLAUDE_PROJECT_DIR/.claude/cc-master）或 cwd
#   fallback——所有 orchestration 的 board 集中到一个用户级 home，跨 repo 不再各起一份。**这是 bash 侧唯一的
#   home 解析点**（本仓现仅 bootstrap-board.sh 一个 bash hook 解析 home；node 侧 SSOT 在
#   hooks/scripts/hook-common.js 的 resolveHome，ccm 侧在 discover.ts 的 resolveHome——三处同口径）。
# F2（codex）：CC_MASTER_HOME 与 HOME 都空时这里会塌成相对用户根不可知，那是个
#   **无意义**的 home。真正的处置是**调用点的 fail-loud 闸**（见下方 HOME 解析处）：都空时清晰报错 + 干净退出 +
#   不建 bogus board。本函数只在「至少一个非空」时才被调用，故这里恒返回一个有意义的 home。
cc_master_home() { printf '%s' "${CC_MASTER_HOME:-${HOME:-}/.cc_master}"; }
# cc_master_boards_dir — home 下集中放所有 *.board.json 的子目录（<home>/boards/）。home 根只放
#   accounts.json（全局·不动）+ hook sidecar + 预留 channel/，与 board 枚举目录分开互不撞。
cc_master_boards_dir() { printf '%s/boards' "$(cc_master_home)"; }

# migrate_legacy_boards SRC DEST — 旧 per-repo 布局（board 直接放 <repo>/.claude/cc-master/）→ 全局
#   <home>/boards/ 的一次性、**非破坏**最佳努力迁移：把 SRC 下每个 *.board.json **复制**进 DEST（保留原
#   文件，不删），同名已存在则跳过。只从 $CLAUDE_PROJECT_DIR/.claude/cc-master 迁（不扫 $(pwd)——pwd 在
#   hook 里常是 repo 根，扫它会把无关 board 拖进来污染）。全程吞错（绝不让迁移失败拖垮 ARM 这条关键路径）。
migrate_legacy_boards() { # $1 legacy-dir $2 boards-dest
  local src="$1" dest="$2"
  [ -n "$src" ] || return 0
  [ -d "$src" ] || return 0
  # F1（codex）：只当 SRC 与 DEST 是**同一目录**才不自迁（self-copy 无意义·且已被下面同名跳过兜住）。
  #   DEST **严格在 SRC 之下**（如 <home> → <home>/boards/）是**合法迁移方向**——glob 只命中 SRC 的直接
  #   子项 *.board.json（不递归），dest 子目录里的板不在其中，无环形复制。旧守卫 `"$src"|"$src"/*` 把这条
  #   合法方向也一并 early-return，导致用户把 CC_MASTER_HOME 指到旧 flat-layout 根目录（板直接放 <home>/）时，
  #   根目录下的既有 board 永不进 boards/、而 resume 只扫 boards/ → 静默丢板（codex F1）。
  [ "$dest" = "$src" ] && return 0
  local f bn
  for f in "$src"/*.board.json; do
    [ -e "$f" ] || continue
    bn="$(basename "$f")"
    [ -e "$dest/$bn" ] && continue          # 全局已有同名 → 跳过（幂等·不覆盖）
    mkdir -p "$dest" 2>/dev/null || true
    cp "$f" "$dest/$bn" 2>/dev/null || true  # 非破坏复制（保留旧 per-repo 原件）
  done
  return 0
}

# ════════════════════════════════════════════════════════════════════════════════════════════════
# RESUME support (design 2026-06-15-resume-board-mechanism.md). bootstrap's SECOND ARM form: instead
# of creating a fresh board, re-stamp owner onto a SELECTED pre-existing board (cross-session re-arm).
# Everything here is pure bash + awk (a shell tool, NOT jq/node — red line 1 / ADR-006). Functions are
# defined up-front but only invoked from the resume branch below; the fresh path never touches them.
# ════════════════════════════════════════════════════════════════════════════════════════════════

# rewrite_owner_field BOARD FIELD NEWVAL — rewrite owner.FIELD (FIELD ∈ session_id|active|heartbeat)
# IN PLACE, touching ONLY the ROOT "owner" sub-object (red line 2). Reuses verify-board.sh's verified
# owner DEPTH-aware scanner state machine: it walks the file char-by-char tracking curly depth (cd),
# bracket depth (bd) and string state, enters ONLY the root-depth `"owner"` object, and within it
# rewrites the FIRST occurrence of `"FIELD": <value>` — emitting NEWVAL verbatim and skipping the old
# value's bytes. Every other byte (goal, tasks[], log[], git, any session_id-shaped field nested in a
# task/log payload) is passed through untouched. NEWVAL is passed via awk `-v` (NOT spliced into a
# regex/sed replacement) so a value carrying sed metachars (/ & . *) is written literally — this is
# why we use awk, not sed, for the non-empty re-stamp (design §1.3 metachar trap). FORMAT-AGNOSTIC:
# single-line and multi-line JSON behave identically (same guarantee as owner_region/tasks_region).
rewrite_owner_field() { # $1 board $2 field $3 newval
  awk -v field="$2" -v newval="$3" '
    { s = s $0 "\n" }            # buffer the whole file (a trailing "\n" per line; one dropped at EOF)
    END {
      n = length(s)
      cd = 0; bd = 0; instr = 0; esc = 0
      capkey = 0; key = ""; pendKey = ""
      inowner = 0; od = 0; done = 0
      out = ""
      k = 1
      while (k <= n) {
        ch = substr(s, k, 1)
        if (inowner && !done) {
          if (instr) {
            out = out ch
            if (esc) esc = 0
            else if (ch == "\\") esc = 1
            else if (ch == "\"") instr = 0
            k++; continue
          }
          if (ch == "\"") {
            # a string at owner-field depth (cd==od+1, bd==0) may be the FIELD key we want
            if (cd == od + 1 && bd == 0) {
              # peek the key name
              kk = k + 1; nm = ""
              while (kk <= n) {
                c2 = substr(s, kk, 1)
                if (c2 == "\"") break
                if (c2 == "\\") { kk++; nm = nm substr(s, kk, 1); kk++; continue }
                nm = nm c2; kk++
              }
              if (nm == field) {
                # found owner.FIELD key. Emit the key + colon + whitespace verbatim, then replace the
                # VALUE token with newval (quoted for string fields, bare for active=true/false).
                out = out "\"" nm "\""
                p = kk + 1                       # char right after the closing key-quote
                # copy whitespace + the colon + whitespace up to the value start
                while (p <= n) {
                  cc = substr(s, p, 1)
                  if (cc == " " || cc == "\t" || cc == "\n" || cc == ":") { out = out cc; p++; if (cc == ":") break; continue }
                  break
                }
                while (p <= n) {                 # skip whitespace before the value
                  cc = substr(s, p, 1)
                  if (cc == " " || cc == "\t" || cc == "\n") { out = out cc; p++; continue }
                  break
                }
                # now p is at the value start: either a quoted string or a bare token (true/false/null/number)
                vc = substr(s, p, 1)
                if (vc == "\"") {                # string value → skip to matching close-quote
                  p++
                  while (p <= n) {
                    cc = substr(s, p, 1)
                    if (cc == "\\") { p += 2; continue }
                    if (cc == "\"") { p++; break }
                    p++
                  }
                } else {                          # bare token → skip to next , } ] or whitespace
                  while (p <= n) {
                    cc = substr(s, p, 1)
                    if (cc == "," || cc == "}" || cc == "]" || cc == " " || cc == "\t" || cc == "\n") break
                    p++
                  }
                }
                if (field == "active") out = out newval        # bare boolean, no quotes
                else out = out "\"" newval "\""                # string fields → quoted
                done = 1                                       # only the first owner.FIELD is rewritten
                k = p                                          # continue emitting from after the old value
                continue
              }
            }
            out = out ch; instr = 1; k++; continue
          }
          if (ch == "[") { bd++; out = out ch; k++; continue }
          if (ch == "]") { if (bd > 0) bd--; out = out ch; k++; continue }
          if (ch == "{") { cd++; out = out ch; k++; continue }
          if (ch == "}") { cd--; out = out ch; if (cd == od) { inowner = 0 } k++; continue }
          out = out ch; k++; continue
        }
        # ── outside owner (or after done): pass through verbatim, but still track depth to find owner{
        out = out ch
        if (instr) {
          if (esc) { esc = 0; if (capkey) key = key ch; k++; continue }
          if (ch == "\\") { esc = 1; if (capkey) key = key ch; k++; continue }
          if (ch == "\"") { instr = 0; if (capkey) { capkey = 0; pendKey = key } k++; continue }
          if (capkey) key = key ch
          k++; continue
        }
        if (ch == "\"") {
          instr = 1
          if (cd == 1 && bd == 0) { capkey = 1; key = "" } else capkey = 0
          k++; continue
        }
        if (ch == "[") { bd++; pendKey = ""; k++; continue }
        if (ch == "]") { if (bd > 0) bd--; k++; continue }
        if (ch == "{") {
          cd++
          if (cd == 2 && bd == 0 && pendKey == "owner" && !done) { inowner = 1; od = 1 }
          pendKey = ""
          k++; continue
        }
        if (ch == "}") { if (cd > 0) cd--; pendKey = ""; k++; continue }
        if (ch == ",") { pendKey = ""; k++; continue }
        k++
      }
      # strip the single trailing "\n" we synthesized at EOF if the source had none — simplest: print
      # out as-is; callers compare byte content of the regions, and a trailing newline is harmless and
      # matches typical board files (printf ... "\n"). We drop exactly one trailing newline to mirror
      # the original file when it had no trailing blank line.
      sub(/\n$/, "", out)
      printf "%s\n", out
    }' "$1"
}

# owner_field_value BOARD FIELD — print the value of owner.FIELD (string fields unquoted, "active"
# as the bare token true/false). Reuses verify-board's owner_region scanner inline. "" if absent.
owner_field_value() { # $1 board $2 field
  awk -v field="$2" '
    { s = s $0 "\n" }
    END {
      n = length(s)
      cd = 0; bd = 0; instr = 0; esc = 0
      capkey = 0; key = ""; pendKey = ""
      inowner = 0; od = 0; out = ""
      for (k = 1; k <= n; k++) {
        ch = substr(s, k, 1)
        if (inowner) {
          if (instr) { if (cd == od + 1 && bd == 0) out = out ch
            if (esc) esc = 0; else if (ch == "\\") esc = 1; else if (ch == "\"") instr = 0; continue }
          if (ch == "\"") { instr = 1; if (cd == od + 1 && bd == 0) out = out ch; continue }
          if (ch == "[") { bd++; continue }
          if (ch == "]") { if (bd > 0) bd--; continue }
          if (ch == "{") { cd++; continue }
          if (ch == "}") { cd--; if (cd == od) { inowner = 0; break } continue }
          if (cd == od + 1 && bd == 0) out = out ch
          continue
        }
        if (instr) {
          if (esc) { esc = 0; if (capkey) key = key ch; continue }
          if (ch == "\\") { esc = 1; if (capkey) key = key ch; continue }
          if (ch == "\"") { instr = 0; if (capkey) { capkey = 0; pendKey = key } continue }
          if (capkey) key = key ch
          continue
        }
        if (ch == "\"") { instr = 1; if (cd == 1 && bd == 0) { capkey = 1; key = "" } else capkey = 0; continue }
        if (ch == "[") { bd++; pendKey = ""; continue }
        if (ch == "]") { if (bd > 0) bd--; continue }
        if (ch == "{") { cd++; if (cd == 2 && bd == 0 && pendKey == "owner") { inowner = 1; od = 1 } pendKey = ""; continue }
        if (ch == "}") { if (cd > 0) cd--; pendKey = ""; continue }
        if (ch == ",") pendKey = ""
      }
      # out is the owner field stream; pull FIELD value. String fields: "field":"value"; active: bare.
      sfield = "\"" field "\"[ \t]*:[ \t]*\""
      if (match(out, sfield)) { v = substr(out, RSTART + RLENGTH); sub(/".*/, "", v); print v; exit }
      bfield = "\"" field "\"[ \t]*:[ \t]*"
      if (match(out, bfield)) { v = substr(out, RSTART + RLENGTH); sub(/[^A-Za-z0-9._-].*/, "", v); print v; exit }
    }' "$1"
}

# goal_value BOARD — print the top-level "goal" string value (pure bash sed, first match = goal in the
# pinned waist order). Used for substring selection only.
goal_value() { sed -n 's/.*"goal"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$1" | head -1; }

# board_mtime_epoch BOARD — print the file's mtime as epoch seconds (GNU `stat -c` / BSD `stat -f`).
# Empty if neither works (→ treated as "no signal" → conservative).
board_mtime_epoch() {
  stat -c %Y "$1" 2>/dev/null || stat -f %m "$1" 2>/dev/null || true
}

# iso8601_to_epoch TS — parse an ISO8601 UTC heartbeat to epoch seconds. TWO precisions are accepted,
# because BOTH are actually in use: a live session / the documented board (board.example.json,
# board.md) flushes MINUTE precision `YYYY-MM-DDTHH:MMZ` (e.g. 2026-06-15T05:52Z), while the takeover
# re-stamp below writes SECOND precision `YYYY-MM-DDTHH:MM:SSZ` (date -u +%Y-%m-%dT%H:%M:%SZ). Prints
# the epoch on success; prints NOTHING (empty) when TS is empty or NOT parseable — the caller treats
# "no output" as "no usable signal" (conservative, design §5.4: heartbeat 解析失败 → 退 mtime-only；两者都
# 拿不到 → 保守要 force). Portability: BSD `date -j -f` (macOS) and GNU `date -d` reject malformed input
# with non-zero RC, so a garbage TS yields empty regardless of platform. TZ=UTC pins the parse so a Z
# timestamp maps to the same epoch on both.
iso8601_to_epoch() { # $1 ts
  [ -n "$1" ] || return 0
  # Shape-gate first: accept YYYY-MM-DDTHH:MM[:SS]Z — seconds OPTIONAL (minute precision is the
  # documented/flushed form; the takeover re-stamp adds seconds). This stops a loose `date` (some GNU
  # builds coerce partial/garbage strings) from inventing an epoch for a non-timestamp value while no
  # longer rejecting the minute-precision heartbeat the board actually carries (round-3 Finding C).
  printf '%s' "$1" | grep -qE '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2})?Z$' || return 0
  # BSD/macOS: `date -j -u -f FMT VALUE +%s`. GNU/Linux: `date -u -d VALUE +%s`. Try the second-precision
  # then the minute-precision BSD format, then GNU (which generally accepts both shapes from the string).
  date -j -u -f '%Y-%m-%dT%H:%M:%SZ' "$1" +%s 2>/dev/null \
    || date -j -u -f '%Y-%m-%dT%H:%MZ' "$1" +%s 2>/dev/null \
    || date -u -d "$1" +%s 2>/dev/null \
    || true
}

# json_string TEXT — emit TEXT as ONE properly-escaped JSON string literal (including the surrounding
# quotes). A correct escaper: backslash → \\, double-quote → \", and any LITERAL newline → \n, then the
# whole stream wrapped in a single pair of quotes. The fresh path's `sed 's/^/"/; s/$/"/'` quotes
# PER LINE — fine for its single-line context, but the resume disambiguation context carries literal
# newlines (the multi-board candidate listing), which per-line quoting turns into ILLEGAL JSON (each
# physical line gets its own quote pair, raw newlines left between them). So escape newlines to \n and
# wrap once. `awk` (a shell tool, not jq/node — red line 1) reads the whole stream and joins records
# with the two-char sequence backslash-n; ORS="" stops awk re-appending a trailing newline.
json_string() { # $1 text
  printf '%s' "$1" \
    | awk 'BEGIN{ORS=""} { gsub(/\\/,"\\\\"); gsub(/"/,"\\\""); if(NR>1) printf "\\n"; printf "%s",$0 }' \
    | sed 's/^/"/; s/$/"/'
}
# inject_ctx TEXT — emit the UserPromptSubmit additionalContext JSON envelope (a single valid object,
# newline-safe via json_string above).
inject_ctx() {
  printf '{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":%s}}\n' \
    "$(json_string "$1")"
}

# FRESHNESS_THRESHOLD_SECS — a board touched within this window is treated as "possibly still live"
# (conservative — write-too-loose is safer to bias AGAINST, so the threshold is generous). 10 min.
FRESHNESS_THRESHOLD_SECS=600

# resume_main — the full resume flow: select board → live-safety probe → owner re-stamp → inject.
# selector + HOME_DIR + sid are in scope. Pure bash control flow; per-board reads use the awk helpers.
resume_main() {
  # ── Finding A guard (codex P2): a DEGRADED UserPromptSubmit (no session_id in stdin → $sid empty)
  #    must NEVER touch an EXISTING board. Resume OVERWRITES owner on a selected pre-existing board;
  #    re-stamping owner.session_id="" would (a) erase the original owner and (b) — per the armed gate
  #    (active:true AND owner.session_id==stdin sid) — leave the board DORMANT for every real non-empty
  #    session_id, i.e. "taken over" into permanent silence while the injected context claims success.
  #    The fresh path tolerates an empty sid because it builds a NEW blank board (recoverable); resume
  #    cannot. Refuse up-front — before any board selection or write — leaving every board untouched.
  if [ -z "$sid" ]; then
    inject_ctx "cc-master resume: cannot resume without a session id (degraded hook environment — stdin carried no session_id) — the board was NOT modified. Re-invoke --resume from a session that carries a session_id."
    return 0
  fi
  mkdir -p "$BOARDS_DIR"
  # ── build the candidate set: ALL *.board.json (active AND archived) in <home>/boards/, excluding
  #    boards already owned by THIS session's sid (fork #4: any board is resumable; only self-owned
  #    boards are skipped). ──
  cands=""
  any_board=0
  for b in "$BOARDS_DIR"/*.board.json; do
    [ -e "$b" ] || continue
    any_board=1
    if [ -n "$sid" ]; then
      bsid="$(owner_field_value "$b" session_id)"
      [ "$bsid" = "$sid" ] && continue          # skip a board this very session already owns
    fi
    cands="$cands$b
"
  done

  # ── zero candidates → nothing to resume ──────────────────────────────────────────────────────────
  if [ "$any_board" -eq 0 ] || [ -z "$cands" ]; then
    inject_ctx "cc-master resume: there is no resumable board in your home (${HOME_DIR}). To start a NEW orchestration, re-run the command WITHOUT --resume and give it a goal."
    return 0
  fi

  # ── selection (design §3 priority): explicit board name/path > timestamp prefix > goal substring ──
  matches=""
  match_count=0
  sel_trim="$selector"
  # strip a trailing --force-takeover / ! token from the selector before matching (it is a directive,
  # not part of the board selector). force is detected separately below.
  force=0
  case " $sel_trim " in
    *" --force-takeover "*) force=1 ;;
  esac
  case "$sel_trim" in
    *!) force=1 ;;
  esac
  # remove the force tokens from the selector string used for matching
  sel_for_match="$(printf '%s' "$sel_trim" | sed -e 's/--force-takeover//g' -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
  case "$sel_for_match" in
    *!) sel_for_match="${sel_for_match%!}" ;;
  esac
  sel_for_match="$(printf '%s' "$sel_for_match" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"

  if [ -n "$sel_for_match" ]; then
    # priority 1+2: explicit board filename / timestamp-prefix — match against the basename.
    while IFS= read -r b; do
      [ -n "$b" ] || continue
      bn="$(basename "$b")"
      case "$bn" in
        "$sel_for_match"|"$sel_for_match".board.json|"$sel_for_match"*) matches="$matches$b
"; match_count=$((match_count+1)) ;;
      esac
    done <<EOF
$cands
EOF
    # priority 3: if no filename/prefix hit, fall to goal substring (case-insensitive LITERAL grep -iF,
    # never spliced into a regex — defends against metachars in the selector, design §3.1).
    if [ "$match_count" -eq 0 ]; then
      matches=""
      while IFS= read -r b; do
        [ -n "$b" ] || continue
        g="$(goal_value "$b")"
        if printf '%s' "$g" | grep -iqF -- "$sel_for_match"; then
          matches="$matches$b
"; match_count=$((match_count+1))
        fi
      done <<EOF
$cands
EOF
    fi
  else
    # empty selector → all candidates are "matches"; if exactly one, it locks; else disambiguate.
    matches="$cands"
    match_count="$(printf '%s' "$cands" | grep -c '.board.json')" || match_count=0
  fi

  # ── ambiguity / missing → NEVER write; inject a disambiguation context (design §3.3) ─────────────
  if [ "$match_count" -eq 0 ]; then
    inject_ctx "cc-master resume: selector '${sel_for_match}' matched no board. $(list_candidates "$cands") Re-send --resume with a more precise selector (a goal substring or the board filename)."
    return 0
  fi
  if [ "$match_count" -gt 1 ]; then
    if [ -z "$sel_for_match" ]; then
      inject_ctx "cc-master resume: your home holds more than one resumable board — pick one. $(list_candidates "$cands") Re-send --resume <selector> with a goal substring or the board filename to choose."
    else
      inject_ctx "cc-master resume: selector '${sel_for_match}' matched more than one board. $(list_candidates "$matches") Re-send --resume with a more precise selector."
    fi
    return 0
  fi

  # ── unique candidate → TARGET locked ─────────────────────────────────────────────────────────────
  TARGET="$(printf '%s' "$matches" | grep -m1 '.board.json')"

  # ── live-safety probe (design §5): is the board possibly still live? heartbeat / mtime freshness ──
  # The freshness gate exists ONLY to protect a possibly-LIVE session from being orphaned. An ARCHIVED
  # board (owner.active:false, just /stop'd) has NO live session — its mtime is fresh precisely because
  # /stop just wrote active:false, so a fresh mtime there is a false "still live" signal. Gate the whole
  # probe on active:true: an archived board skips it and proceeds straight to revive-takeover, no force
  # required (codex Finding 3 — the common "just /stop'd, now --resume to revive" path must not stall).
  target_active="$(owner_field_value "$TARGET" active)"
  fresh=0          # 1 = looks possibly-live (recent activity); 0 = looks abandoned/stale
  signal=0         # 1 = we HAVE a usable freshness signal; 0 = no signal (→ conservative)
  if [ "$target_active" = "true" ]; then
    hb="$(owner_field_value "$TARGET" heartbeat)"
    now="$(date -u +%s)"
    mt="$(board_mtime_epoch "$TARGET")"
    # ── Two freshness channels, treated SYMMETRICALLY (design §5.4: freshness = max(heartbeat 新鲜度,
    #    mtime 新鲜度); signal = 任一通道可定龄). A channel contributes ONLY when it can be DATED to a
    #    NON-FUTURE epoch; a value that cannot be aged contributes NOTHING (not a "present → signal=1").
    # mtime channel: a usable, NON-FUTURE mtime → a signal; within the window → fresh.
    if [ -n "$mt" ] && printf '%s' "$mt" | grep -qE '^[0-9]+$' && [ "$mt" -le "$now" ]; then
      signal=1
      age=$((now - mt))
      [ "$age" -lt "$FRESHNESS_THRESHOLD_SECS" ] && fresh=1
    fi
    # heartbeat channel (Finding B fix): an active session flushes an ISO8601 heartbeat each round, so
    # AGE it — do NOT mis-read mere presence as a signal. Parse to epoch (empty if unparseable/future);
    # a datable, non-future heartbeat is a signal in its own right, and a recent one marks the board
    # possibly-LIVE (→ fresh). An UNPARSEABLE / future heartbeat contributes nothing → with mtime also
    # unusable this lands on the signal==0 conservative "require force" branch (design §5.4 fail-safe),
    # NOT on a silent no-force takeover.
    hb_epoch="$(iso8601_to_epoch "$hb")"
    if [ -n "$hb_epoch" ] && [ "$hb_epoch" -le "$now" ]; then
      signal=1
      hb_age=$((now - hb_epoch))
      [ "$hb_age" -lt "$FRESHNESS_THRESHOLD_SECS" ] && fresh=1
    fi
  fi
  # archived board (active:false) → fresh=0, signal stays at its init; the force==0 block below is a
  # no-op for it (fresh!=1 and we set signal=1 to skip the no-signal branch), so it falls through to
  # the revive-takeover. Make that explicit: an archived board always has "a signal" (it IS abandoned).
  [ "$target_active" = "true" ] || signal=1

  if [ "$force" -eq 0 ]; then
    if [ "$fresh" -eq 1 ]; then
      inject_ctx "cc-master resume: the board ${TARGET} looks like it may still have a LIVE session (recent activity within ${FRESHNESS_THRESHOLD_SECS}s). Taking it over would orphan that session's background work. If you are sure, re-send: --resume ${sel_for_match} --force-takeover"
      return 0
    fi
    if [ "$signal" -eq 0 ]; then
      inject_ctx "cc-master resume: cannot determine whether the board ${TARGET} has a live session (no heartbeat and no usable mtime). Conservatively withholding takeover — if you are sure it is abandoned, re-send: --resume ${sel_for_match} --force-takeover"
      return 0
    fi
  fi

  # ── TAKEOVER: re-stamp owner (only narrow-waist fields). session_id ← new sid; active ← true
  #    (idempotent for abandoned-active, revives archived); heartbeat ← takeover timestamp. ──────────
  ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  tmp="$TARGET.tmp.$$"
  rewrite_owner_field "$TARGET" session_id "$sid" > "$tmp" && mv -f "$tmp" "$TARGET"
  rewrite_owner_field "$TARGET" active true > "$tmp" && mv -f "$tmp" "$TARGET"
  rewrite_owner_field "$TARGET" heartbeat "$ts" > "$tmp" && mv -f "$tmp" "$TARGET"

  inject_ctx "cc-master resume: you have TAKEN OVER the existing orchestration board at ${TARGET}. This is a RESUME, not a fresh start — do NOT re-decompose the goal and do NOT reset tasks[]. Invoke the master-orchestrator-guide skill, then RECONCILE the existing tasks[]: rebuild your mental model from their statuses. Treat every in_flight task as an ORPHAN (its handle died with the prior session) — do not wait on it; run it through endpoint verification (resume-verify content-hash + endpoint check): if its artifact exists and passes, mark it done/verified; otherwise demote it to ready/stale and re-dispatch for a fresh handle. This board is your single source of truth; from now on update owner.heartbeat each time you flush it."
  return 0
}

# list_candidates CANDS — render the candidate boards in TWO groups (active-but-abandoned / archived),
# each line "<basename> [goal]". Pure bash; used inside disambiguation context strings.
list_candidates() { # $1 newline-separated candidate board paths
  act=""; arc=""
  while IFS= read -r b; do
    [ -n "$b" ] || continue
    bn="$(basename "$b")"
    g="$(goal_value "$b")"
    a="$(owner_field_value "$b" active)"
    line="${bn} [${g}]"
    if [ "$a" = "true" ]; then act="${act}    ${line}
"; else arc="${arc}    ${line}
"; fi
  done <<EOF
$1
EOF
  outp="Candidates:"
  [ -n "$act" ] && outp="${outp}
  active-but-abandoned:
${act}"
  [ -n "$arc" ] && outp="${outp}
  archived (will be revived):
${arc}"
  printf '%s' "$outp"
}

# Extract the value of the top-level "prompt" string field. Grab everything after `"prompt":"` up to
# the next unescaped double-quote. This is a best-effort extraction sufficient to test a prefix; if
# no prompt field is present, `prompt` stays empty and the prefix test simply fails.
prompt="${stdin#*\"prompt\":\"}"          # drop everything up to & including  "prompt":"
[ "$prompt" = "$stdin" ] && prompt=""     # no "prompt": field at all → empty
prompt="${prompt%%\"*}"                    # drop from the first " onward → the raw field value
trimmed="${prompt#"${prompt%%[![:space:]]*}"}"   # strip leading whitespace

# Expanded-body backup: unescape \n in the prompt field value, take the first non-empty line, and
# require the bootstrap marker to live ON that line. A mid-prose mention (marker quoted inside a
# sentence) leaves a non-marker first line and does not qualify (Finding #16).
first_line="$(printf '%s' "$prompt" | sed -e 's/\\n/\n/g' | grep -m1 -v '^[[:space:]]*$')"
first_line="${first_line#"${first_line%%[![:space:]]*}"}"   # strip leading whitespace
first_line="${first_line%"${first_line##*[![:space:]]}"}"   # strip trailing whitespace
marker_hit=0
case "$first_line" in
  '<!-- cc-master:bootstrap:v1 -->') marker_hit=1 ;;        # STANDALONE first line only — an inline
                                                            # mention on the first line is NOT enough
                                                            # (codex self-review catch, Finding #16)
esac

case "$trimmed" in
  /cc-master:as-master-orchestrator*) : ;;        # raw command: name is the prompt PREFIX
  *)
    [ "$marker_hit" -eq 1 ] || exit 0 ;;          # not the marker first-line → silent no-op
esac

# ── ④ CCM HARD PRECHECK (ADR-021·install-presence gate)──────────────────────────────────────────────
# ccm is a HOST INSTALL PRE-REQUISITE (ADR-014): board v2's write-gate (ADR-013) requires the agent to
# mutate the board ONLY through `ccm`. If ccm is absent, a board could still be CREATED by this pure-bash
# bootstrap, but the agent would then be unable to operate it (every `ccm` write silently degrades) — a
# phantom orchestration that looks live but is crippled. So at the ARM entry (trigger gate just passed,
# BEFORE any board is created) we hard-check install presence and, if ccm is missing, REFUSE TO ARM:
#   · inject a `<directive source="bootstrap">` additionalContext telling the AGENT to relay an install
#     reminder to the USER and to NOT orchestrate until ccm is installed (agent-relay is the only reliable
#     channel to the user — UserPromptSubmit exit-2 stderr goes to the agent, not the user; §3.3);
#   · EXIT 0 (NOT decision:block — block would stop the agent from receiving the directive; §3.4);
#   · create NO board (so no hook arms → all runtime hooks stay dormant·red line 6 naturally holds).
# Idempotent / retriable: once the user installs ccm, re-running the command passes this gate and arms.
# This is the BOOTSTRAP HARD CHECK (install presence·binary in PATH·二元·一次性·user-fixable); it is
# distinct from and does NOT remove the runtime hooks' graceful soft-degrade on a TRANSIENT ccm hiccup
# (ADR-021 §3.5 boundary). Pure bash `command -v` (red line 1 floor·no jq/python/node·no ccm spawn).
#   CCM_BIN override (absolute executable path·dev/test/custom install·same口径 as node hooks): when set,
#   check `[ -x "$CCM_BIN" ]`; else check `command -v ccm` on PATH.
ccm_present=0
if [ -n "${CCM_BIN:-}" ]; then
  [ -x "$CCM_BIN" ] && ccm_present=1
else
  command -v ccm >/dev/null 2>&1 && ccm_present=1
fi
if [ "$ccm_present" -eq 0 ]; then
  # The directive tag is just a string (§13 author-side discipline: source必填·directive for a hard
  # constraint·ccm-missing IS a hard pre-requisite). Hand-built in bash (cannot require node's directive()
  # wrapper). inject_ctx escapes the whole payload to one valid JSON additionalContext envelope.
  directive_body='<directive source="bootstrap">cc-master 依赖外部工具 `ccm`（per-OS Node SEA 二进制·ADR-014 主机安装前置），但当前环境的 PATH 上找不到它。没有 ccm，board v2 的写入关卡（ADR-013·agent 一律经 ccm 写 board）无法工作——即便建出 board 也无法正确操作，会是一场「看起来在跑、实则瘸腿」的 phantom orchestration。因此本次**不创建 board、不进入编排**。请你立即转告用户：先安装 ccm（cc-master 的硬前置依赖）——下载对应自己 OS/arch 的二进制 `ccm-<os>-<arch>`（os = darwin 或 linux、arch = arm64 或 x64，例如 Apple Silicon Mac 取 `ccm-darwin-arm64`、x86 Linux 取 `ccm-linux-x64`），重命名为 `ccm`、`chmod +x ccm`、放进 PATH（如 `~/.local/bin/ccm`），跑 `ccm --version` 确认可用（详见 README 安装段）。装好后重新运行 /cc-master:as-master-orchestrator <goal> 即可正常起编排。在用户确认装好之前，不要继续编排——你没有可用的 board 操作能力。</directive>'
  inject_ctx "$directive_body"
  exit 0
fi

# Home 解析（统一全局口径·BASH SSOT cc_master_home）：$CC_MASTER_HOME 覆写，否则 $HOME/.cc_master。
# board 集中落 <home>/boards/；home 根另放 accounts.json（全局·不动）+ sidecar + 预留 channel/。
# F2（codex）FAIL-LOUD 闸：CC_MASTER_HOME 与 HOME **都为空**时无从解析出合理 home——绝不
#   静默降级到 `/.cc_master`（在那建 board / mkdir 必失败、脚本无 set -e 行为不可预测、且会留下
#   bogus 痕迹）。改为 emit 一条清晰 stderr 提示 + 干净退出（rc 0、空 stdout、**不建任何 board**）。fail-loud 比
#   脆弱的跨平台 os.homedir bash 等价更 ship-anywhere 安全（bash 无可靠 os.homedir 兜底）。本闸在**触发门之后**
#   （上方 case 已过），故只有真要建/续板时才出声、不污染无关 prompt。
if [ -z "${CC_MASTER_HOME:-}" ] && [ -z "${HOME:-}" ]; then
  printf 'cc-master: 无法解析 home 目录（CC_MASTER_HOME / HOME 均未设）——请设置 CC_MASTER_HOME（或 HOME）后重试；本次未创建任何 board。\n' >&2
  exit 0
fi
HOME_DIR="$(cc_master_home)"
BOARDS_DIR="$(cc_master_boards_dir)"
# 一次性、非破坏的旧布局迁移：把旧 per-repo $CLAUDE_PROJECT_DIR/.claude/cc-master/*.board.json 复制进
# 全局 boards/（保留原件·同名跳过·全程吞错）。只迁 CLAUDE_PROJECT_DIR 这个有据可查的旧 per-repo home，
# 不扫 $(pwd)（hook 的 cwd 常是无关 repo 根）。让升级用户的旧 board 在全局 home 里 --resume 找得到。
# F4（codex）：CLAUDE_PROJECT_DIR 为空时**跳过**——否则 "${CLAUDE_PROJECT_DIR:-}/.claude/cc-master" 塌成
#   绝对根 "/.claude/cc-master"，可能 copy 进无关 board（migrate 内部的 `[ -n "$src" ]` 守不住——src 此时非空）。
if [ -n "${CLAUDE_PROJECT_DIR:-}" ]; then
  migrate_legacy_boards "$CLAUDE_PROJECT_DIR/.claude/cc-master" "$BOARDS_DIR"
fi
# 旧全局默认 home 曾是 <claudeConfigDir>/cc-master；新默认改为 ~/.cc_master 后，best-effort 迁它的 boards/
# 目录，避免升级用户的 active/archived board 因默认 home 改名而从 resume 视野里消失。只复制 board，不搬
# accounts.json / vault / sidecar，避免静默改变账号状态与凭证语义。只在未显式设置 CC_MASTER_HOME 时迁旧默认；
# 显式 home 是隔离意图，不能从旧 Claude config home 抄真实用户旧板污染测试 / 多 home / 临时 home。
if [ -z "${CC_MASTER_HOME:-}" ]; then
  OLD_CLAUDE_HOME="$(claude_config_dir)/cc-master"
  if [ "$OLD_CLAUDE_HOME" != "$HOME_DIR" ]; then
    migrate_legacy_boards "$OLD_CLAUDE_HOME/boards" "$BOARDS_DIR"
    migrate_legacy_boards "$OLD_CLAUDE_HOME" "$BOARDS_DIR"
  fi
fi
# F1（codex）：也迁「已解析 home **根**目录」下的 legacy flat 板（旧布局板直接放 <home>/ 而非 <home>/boards/，
#   常见于升级用户把 CC_MASTER_HOME 指到旧 flat-layout 目录）。glob 只命中 home 根直接子项 *.board.json
#   （不递归、不含 boards/ 里的板）→ copy 进 boards/，让 resume（只扫 boards/）看得见——否则根目录下既有 board
#   静默不可见（丢板）。幂等·非破坏（同名跳过·保留原件）。即便 CC_MASTER_HOME 指的就是 home root 也生效。
migrate_legacy_boards "$HOME_DIR" "$BOARDS_DIR"
mkdir -p "$HOME_DIR/channel"   # 预留多-orchestrator 协调信道目录（本任务只建目录约定·不实现内容）

# ── INTENT PARSE (resume vs fresh) — runs ONLY AFTER the trigger gate above already passed ──────────
# This is a SECOND demux INSIDE an already-triggered prompt; it does NOT participate in triggering
# (the sentinel/prefix gate is untouched). Detect whether the FIRST token after the command prefix is
# `--resume`. If so → mode=resume + selector (the remaining arg string, possibly empty). Otherwise →
# mode=fresh, the original byte-unchanged path. A `--resume` appearing mid-goal (not the first token)
# stays fresh (Finding-style false-trigger avoidance). → design §1.1/§2.1.
mode=fresh
selector=""
# raw-command path: strip the prefix, ltrim, then test the leading token.
rest="${trimmed#/cc-master:as-master-orchestrator}"
rest="${rest#"${rest%%[![:space:]]*}"}"          # ltrim the arg string
case "$rest" in
  --resume|--resume\ *)
    mode=resume
    selector="${rest#--resume}"
    selector="${selector#"${selector%%[![:space:]]*}"}" ;;   # remaining = selector (may be empty)
esac
# body-sentinel path: the expanded command body cannot conditionally render on $ARGUMENTS (it is
# static markdown), so it UNCONDITIONALLY carries a machine-readable args line right after the
# sentinel: `<!-- cc-master:args: <raw $ARGUMENTS> -->`. When we triggered via the marker (not the raw
# prefix), recover the original args from THAT line and run them through the SAME --resume first-token
# demux as the raw-command path — so fresh/resume routing is identical on both paths (design §2.2;
# codex Finding 2: the old `cc-master:resume` line was never rendered, so --resume fell through to a
# spurious fresh board). The args line must be the SECOND machine-readable line (an HTML comment),
# matched standalone like the sentinel (Finding #16 discipline) — a mid-prose `cc-master:args:`
# mention won't false-route because we anchor on the line and strip the comment wrapper.
if [ "$mode" = "fresh" ] && [ "$marker_hit" -eq 1 ]; then
  args_line="$(printf '%s' "$prompt" | sed -e 's/\\n/\n/g' | grep -m1 -E '^[[:space:]]*<!--[[:space:]]*cc-master:args:' || true)"
  if [ -n "$args_line" ]; then
    # strip the `<!-- cc-master:args:` opener and the trailing ` -->`, then trim → the raw $ARGUMENTS.
    body_args="$(printf '%s' "$args_line" \
      | sed -e 's/^[[:space:]]*<!--[[:space:]]*cc-master:args://' -e 's/[[:space:]]*-->[[:space:]]*$//' \
            -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
    case "$body_args" in
      --resume|--resume\ *)
        mode=resume
        selector="${body_args#--resume}"
        selector="${selector#"${selector%%[![:space:]]*}"}" ;;   # remaining = selector (may be empty)
    esac
  fi
fi

if [ "$mode" = "resume" ]; then
  # Delegate the whole resume flow (select → live-safety probe → owner re-stamp → inject context).
  # Keep the fresh path below BYTE-UNCHANGED (zero regression, design §1.1).
  resume_main
  exit 0
fi

# ── A2 T6: --num_account is GONE ─────────────────────────────────────────────────────────────────────
# The FRESH-path `--num_account <n>` flag is REMOVED (A2 account-management refactor §C-T6). pacing's
# effective-N is no longer user-supplied per session via a CLI flag → board top-level num_account; it is
# now DERIVED by usage-pacing.js from the account pool registry (accounts.json: count of non-active,
# token-unexpired switchable backups + 1). No registry = a natural single account (effective-N 1), so
# there is nothing to parse or stamp here anymore. The board TEMPLATE still ships `"num_account": 1` as a
# harmless backward-compat default (an OLD board that already carries num_account is NOT an error — it is
# simply no longer read by the hook), so no template change is required; we just stop WRITING it from a
# CLI arg. → design_docs/plans/2026-06-17-A2-account-management-design.md §C-T6 / §F.

# CCM_CMD：进程边界 spawn 的 ccm 可执行（与 node hook 同口径）。上方 install precheck 已保证它在场
# （CCM_BIN 可执行 OR `ccm` 在 PATH）。下方建骨架 + INIT-FLAGS 段共用它。
CCM_CMD="${CCM_BIN:-ccm}"

mkdir -p "$BOARDS_DIR"
# ── FRESH board 骨架经 `ccm board init` 建（ADR-014 进程边界·红线：hooks ⊥ skill assets）───────────────
# board 的**空骨架**现由 ccm（board-model SSOT·@ccm/engine）建，不再 `cp` 一个 skill asset——hook 绝不
# 反向伸手够某个 skill 的 assets/ 或 scripts/ 目录（本任务消除的唯一违规）。ccm 上方已硬前置在场，故可依赖它。把 CC_MASTER_HOME
# pin 到已解析的 HOME_DIR，让 ccm 写进本 hook 期望的**同一** boards/ 目录（三处 resolveHome 本已同口径·pin
# 只为消除任何分歧）。ccm 自己挑一个唯一的 `<UTC-ts>-<pid>.board.json` 名（同样 time-sortable·并发不撞的
# 约定），我们从它 stdout 里恢复所建路径（匹配 `.board.json` **路径 token**·与本地化标签无关——认路径不认
# 「路径:」字样）。**ARMING（盖 session_id）仍是 bootstrap 自己的活**（见下）：owner 是 arming 窄腰、hook 所
# 有、无 ccm setter，且 board-guard（ADR-025）只 gate agent 的工具调用、不管 hook 进程内的写。
init_out="$(CC_MASTER_HOME="$HOME_DIR" "$CCM_CMD" board init 2>&1)"
BOARD="$(printf '%s' "$init_out" | grep -oE '/[^[:space:]]*\.board\.json' | head -1)"
if [ -z "$BOARD" ] || [ ! -f "$BOARD" ]; then
  # ccm 在场（已前置）却没能建出可用 board 路径 → 宁可拒 arm，也不注入一个指向虚空的 phantom「board 已建」。
  # 以 <directive source="bootstrap"> agent-relay·exit 0（不 block·否则 agent 收不到 directive）。
  inject_ctx '<directive source="bootstrap">cc-master: `ccm board init` 未能建出 board（ccm 在场但建板失败）——本次不进入编排。请重试 /cc-master:as-master-orchestrator <goal>；若持续失败，检查 ccm 安装与 CC_MASTER_HOME 目录可写。</directive>'
  exit 0
fi
# Escape the sid for safe inclusion in the JSON string value (backslash + double-quote only; a
# session id is otherwise printable). Empty sid → stamps "" — an ANOMALY (normal bootstrap stdin
# carries a sid): such a blank board stays DORMANT for every non-empty stdin sid (it is NOT
# auto-adopted — red line 6 / ADR-007 §2.3; hooks degrade to any-active ONLY when THEIR OWN stdin
# sid is empty). Claim it by re-running as-master-orchestrator (re-arm re-stamps owner.session_id).
# Keep this pure bash (no jq) — ship-anywhere.
sid_esc="$(printf '%s' "$sid" | sed 's/\\/\\\\/g; s/"/\\"/g')"
# Stamp owner.session_id with the creating session's id (the ARM identity). `ccm board init` ships the
# field as `"session_id": ""`; a literal-anchored sed replaces ONLY that empty owner field (owner
# precedes tasks[] in the pinned waist, and no fresh board carries any other session_id-shaped value).
# Pure bash sed runs INSIDE the hook process (not an agent tool call), so board-guard (ADR-025·gates
# agent tool calls only) does not apply; owner.session_id has no ccm setter (it is the arming waist).
tmp="$BOARD.tmp.$$"
sed "s/\"session_id\"[[:space:]]*:[[:space:]]*\"\"/\"session_id\": \"$sid_esc\"/" "$BOARD" > "$tmp" && mv -f "$tmp" "$BOARD"

# ── INIT FLAGS（方案A·ADR-020 board-init 写边界）─────────────────────────────────────────────────────
# bootstrap 作为板的**创建者**，在 fresh 建板初始化时据用户在命令里**亲手敲的**显式旋钮 flag（priority /
# wip / owner-wip / policy-switch）把 board 预设好——经进程边界 `ccm board update` / `ccm policy set` 写 ✎
# 字段（coordination.priority / scheduling.wip_limit·owner_wip_limit / policy）。这是**建板初始化**写边界，
# 与运行时 hook 的 `runtime.*` nudge side-channel 不同性质（那是 ADR-020 §2.1 的运行时簿记；本段是建板那一刻的
# 一次性初始化）。守红线：① 红线1——纯 bash 解析 + 进程边界 spawn `ccm`（不 import 引擎）；② 红线6——写在
# 「建板 + 盖 sid」之后（板此刻已存在、本 session 已武装）；③ 红线2——priority/wip/policy 皆 ✎ 非窄腰、hook
# 不读窄腰；④ policy 授权语义——用户亲手敲 `--policy-switch` = 用户授权，hook 转 `--user-authorized` 的权来自
# 用户输入、**非 hook 自授权**。**best-effort**：板已建好，flag 落地失败**绝不 block 编排起跑**（exit 0 仍走到
# 下方 ctx 注入），失败/非法值在 ctx 附一句 advisory。**goal 不在此设**（模板 goal=""，由 agent 设）。
#
# CCM_CMD 已在上方建骨架处解析（进程边界 spawn 的 ccm·与 node hook 同口径·install precheck 已保证在场）。
# 下方 INIT-FLAGS best-effort 吞错（仿 migrate_legacy_boards）——任何失败只记 note、不崩、不 block 起跑。
# fresh_args：本回合 fresh 形态的**完整原始 arg 串**（含 goal + flag）。两条触发路径各取其源：raw-command 路径
#   `rest`（已 ltrim·prefix 已剥）；body-sentinel 路径 `body_args`（从 <!-- cc-master:args: $ARGUMENTS --> 恢复）。
#   `rest != trimmed` ⟺ raw-command 前缀真匹配过（剥掉了前缀）；否则走 body-sentinel 的 body_args（可能未设）。
fresh_args=""
if [ "$rest" != "$trimmed" ]; then
  fresh_args="$rest"
elif [ -n "${body_args:-}" ]; then
  fresh_args="$body_args"
fi

flag_notes=""    # 非法值 / 应用失败的 advisory 文案（单行·无换行·下方 per-line sed 量化才安全）
applied=""       # 成功落板的旋钮摘要（喂 agent「原样保留别覆写」）
init_pri=""; init_wip=""; init_ownerwip=""; init_pol=""
# 纯 bash token 循环抽 flag 值（enum/int 轻解析）。set -f 关 glob（goal 文本可能含 `*`·别让它扩成文件名）；
#   `set -- $fresh_args` 按 IFS 词分割成 token（goal 词被下面 *) 分支跳过·只挑 flag）。扫完恢复 +f。
set -f
# shellcheck disable=SC2086
set -- $fresh_args
set +f
while [ "$#" -gt 0 ]; do
  case "$1" in
    --priority)        init_pri="${2:-}";      shift; [ "$#" -gt 0 ] && shift ;;
    --priority=*)      init_pri="${1#--priority=}";           shift ;;
    --wip)             init_wip="${2:-}";       shift; [ "$#" -gt 0 ] && shift ;;
    --wip=*)           init_wip="${1#--wip=}";                shift ;;
    --owner-wip)       init_ownerwip="${2:-}";  shift; [ "$#" -gt 0 ] && shift ;;
    --owner-wip=*)     init_ownerwip="${1#--owner-wip=}";     shift ;;
    --policy-switch)   init_pol="${2:-}";       shift; [ "$#" -gt 0 ] && shift ;;
    --policy-switch=*) init_pol="${1#--policy-switch=}";      shift ;;
    *) shift ;;
  esac
done

# ── 校验取值（非法 → 跳过该 flag + 记 note·别 block）+ 攒一条合并的 board update ──────────────────────
upd_flags=""
case "$init_pri" in
  "") : ;;
  urgent|high|normal|low|trivial) upd_flags="$upd_flags --priority $init_pri"; applied="${applied} priority=$init_pri" ;;
  *) flag_notes="${flag_notes} --priority 取值 '${init_pri}' 非法（须 urgent|high|normal|low|trivial）·已跳过；" ;;
esac
case "$init_wip" in
  "") : ;;
  *[!0-9]*|0) flag_notes="${flag_notes} --wip 取值 '${init_wip}' 非正整数·已跳过；" ;;
  *) upd_flags="$upd_flags --wip-limit $init_wip"; applied="${applied} wip=$init_wip" ;;
esac
case "$init_ownerwip" in
  "") : ;;
  *[!0-9]*|0) flag_notes="${flag_notes} --owner-wip 取值 '${init_ownerwip}' 非正整数·已跳过；" ;;
  *) upd_flags="$upd_flags --owner-wip $init_ownerwip"; applied="${applied} owner-wip=$init_ownerwip" ;;
esac
if [ -n "$upd_flags" ]; then
  # --board "$BOARD" 精确定位刚建的板（消歧·消除打错板风险）。吞错——失败只记 note·不崩·不 block。
  # shellcheck disable=SC2086
  if ! "$CCM_CMD" board update --board "$BOARD" $upd_flags >/dev/null 2>&1; then
    flag_notes="${flag_notes} ccm board update 应用失败（板已建·priority/wip 未落地·可手动补设）；"
    applied=""   # update 整条失败 → 收回上面攒的 priority/wip applied 摘要（诚实记账）
  fi
fi
# ── policy（allow|deny）经 ccm policy set·非 TTY 须 --user-authorized（权来自用户亲手敲 flag·非自授权）──
case "$init_pol" in
  "") : ;;
  allow|deny)
    if "$CCM_CMD" policy set --board "$BOARD" --autonomous-account-switch "$init_pol" --user-authorized >/dev/null 2>&1; then
      applied="${applied} policy-switch=$init_pol"
    else
      flag_notes="${flag_notes} ccm policy set 应用失败（板已建·policy 未落地·可手动补设）；"
    fi ;;
  *) flag_notes="${flag_notes} --policy-switch 取值 '${init_pol}' 非法（须 allow|deny）·已跳过；" ;;
esac

ctx="cc-master: a fresh orchestration board was created at ${BOARD}. You are now the master orchestrator for this task — remember that path, it is YOUR board. MANDATORY NEXT STEP: before implementation, tests, git, push, or PR work, decompose the goal into a dependency DAG and write tasks with acceptance criteria via ccm task add --board ${BOARD}. An armed fresh board with zero tasks is not a runnable orchestration. Then invoke the master-orchestrator-guide skill and run the decision program."
# applied / flag_notes 都是**单行**（无内嵌换行）——下方 per-line sed 量化（s/^/"/; s/$/"/）才不破 JSON。
if [ -n "$applied" ]; then
  ctx="${ctx} bootstrap 已据你启动命令里的显式 flag 预设了这些 board 旋钮：${applied}（已写入 board）。设 board.goal 时把这些 flag token 从 goal 里剔除；这些已落板的旋钮原样保留、别覆写。"
fi
if [ -n "$flag_notes" ]; then
  ctx="${ctx} <advisory source=\"bootstrap\" strength=\"weak\">部分启动 flag 未落地：${flag_notes}这些旋钮你可用 ccm（board update / policy set）手动补设，或请用户重发一条带正确 flag 的命令。</advisory>"
fi
printf '{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":%s}}\n' "$(printf '%s' "$ctx" | sed 's/\\/\\\\/g; s/"/\\"/g; s/^/"/; s/$/"/')"
exit 0
