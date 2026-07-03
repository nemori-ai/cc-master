# shellcheck shell=bash
# Source me: . "$(dirname "$0")/helpers.sh"
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PLUGIN_ROOT="${CC_MASTER_TEST_PLUGIN_ROOT:-$REPO_ROOT/plugin/dist/claude-code}"
PASS=0; FAILED=0

_red()  { printf '\033[31m%s\033[0m\n' "$1"; }
_green(){ printf '\033[32m%s\033[0m\n' "$1"; }

assert_eq() { # $1 expected $2 actual $3 msg
  if [ "$1" = "$2" ]; then PASS=$((PASS+1)); else
    FAILED=$((FAILED+1)); _red "FAIL: $3 (expected [$1] got [$2])"; fi
}
assert_contains() { # $1 haystack $2 needle $3 msg
  case "$1" in *"$2"*) PASS=$((PASS+1));; *) FAILED=$((FAILED+1)); _red "FAIL: $3 (missing [$2])";; esac
}
assert_not_contains() { case "$1" in *"$2"*) FAILED=$((FAILED+1)); _red "FAIL: $3 (unexpected [$2])";; *) PASS=$((PASS+1));; esac; }
# assert_valid_json STR MSG — assert STR parses as valid JSON. node is fine here (it IS the Claude Code
# runtime; red line 1 / ADR-006 allows node/JS in hooks too — it bans only jq/python, never node — so a
# node-based test assertion is unambiguously fine). The hook stdout
# (an additionalContext envelope) must be a single, well-formed JSON object even when the embedded
# context string carries literal newlines (the multi-board disambiguation listing) — Finding-style
# regression guard for the per-line `sed` quoting bug that emitted invalid JSON.
assert_valid_json() { # $1 json-string $2 msg
  if printf '%s' "$1" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{JSON.parse(s);process.exit(0)}catch(e){process.exit(1)}})' 2>/dev/null; then
    PASS=$((PASS+1)); else FAILED=$((FAILED+1)); _red "FAIL: $2 (not valid JSON: [$1])"; fi
}
assert_file() { [ -f "$1" ] && PASS=$((PASS+1)) || { FAILED=$((FAILED+1)); _red "FAIL: $2 (no file $1)"; }; }
assert_no_file() { [ ! -e "$1" ] && PASS=$((PASS+1)) || { FAILED=$((FAILED+1)); _red "FAIL: $2 (file exists $1)"; }; }

# make_project: create an isolated fake project dir, echo its path
make_project() { local d; d="$(mktemp -d "${TMPDIR:-/tmp}/.tmp-ccm.XXXXXX")"; echo "$d"; }

# run_hook SCRIPT STDIN_JSON PROJECT_DIR -> sets HOOK_OUT / HOOK_RC
# home 收口为全局后，home 不再从 CLAUDE_PROJECT_DIR 派生——故显式 pin CC_MASTER_HOME 到 PROJECT_DIR 下的
# .claude/cc-master 隔离 home（① 不污染用户真实 ~/.claude/cc-master；② 保留断言里 "$P/.claude/cc-master"
# 这个路径基准·board 落其 boards/ 子目录）。
run_hook() {
  HOOK_OUT="$(printf '%s' "$2" | CLAUDE_PROJECT_DIR="$3" CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" \
             CC_MASTER_HOME="$3/.claude/cc-master" \
             bash "$PLUGIN_ROOT/$1" 2>/dev/null)"; HOOK_RC=$?
}

# board_active FILE — extract owner.active value (pure bash). Reads the FIRST "active": token, which
# in the pinned waist is owner.active (owner precedes tasks[] in the template / example board). Uses a
# bare lowercase-letter class (not true\|false) — BSD sed has no \| alternation in BRE.
board_active() { sed -n 's/.*"active"[[:space:]]*:[[:space:]]*\([a-z][a-z]*\).*/\1/p' "$1" | head -1; }
# board_goal FILE — extract the top-level "goal" string value (pure bash). goal is the first
# "goal": token in the pinned waist (it precedes owner/tasks in template / example board order).
board_goal() { sed -n 's/.*"goal"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$1" | head -1; }
# board_heartbeat FILE — extract owner.heartbeat value (pure bash). owner.heartbeat is the FIRST
# "heartbeat": token in the pinned waist (owner precedes tasks[]). Empty if absent/blank.
board_heartbeat() { sed -n 's/.*"heartbeat"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$1" | head -1; }

finish() { echo "passed=$PASS failed=$FAILED"; [ "$FAILED" -eq 0 ] || exit 1; }
