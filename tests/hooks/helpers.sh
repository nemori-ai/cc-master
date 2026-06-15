# shellcheck shell=bash
# Source me: . "$(dirname "$0")/helpers.sh"
set -uo pipefail

PLUGIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
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
assert_file() { [ -f "$1" ] && PASS=$((PASS+1)) || { FAILED=$((FAILED+1)); _red "FAIL: $2 (no file $1)"; }; }
assert_no_file() { [ ! -e "$1" ] && PASS=$((PASS+1)) || { FAILED=$((FAILED+1)); _red "FAIL: $2 (file exists $1)"; }; }

# make_project: create an isolated fake project dir, echo its path
make_project() { local d; d="$(mktemp -d "${TMPDIR:-/tmp}/.tmp-ccm.XXXXXX")"; echo "$d"; }

# run_hook SCRIPT STDIN_JSON PROJECT_DIR -> sets HOOK_OUT / HOOK_RC
run_hook() {
  HOOK_OUT="$(printf '%s' "$2" | CLAUDE_PROJECT_DIR="$3" CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" \
             bash "$PLUGIN_ROOT/$1" 2>/dev/null)"; HOOK_RC=$?
}

# board_active FILE — extract owner.active value (pure bash). Reads the FIRST "active": token, which
# in the pinned waist is owner.active (owner precedes tasks[] in the template / example board). Uses a
# bare lowercase-letter class (not true\|false) — BSD sed has no \| alternation in BRE.
board_active() { sed -n 's/.*"active"[[:space:]]*:[[:space:]]*\([a-z][a-z]*\).*/\1/p' "$1" | head -1; }
# board_goal FILE — extract the top-level "goal" string value (pure bash). goal is the first
# "goal": token in the pinned waist (it precedes owner/tasks in template / example board order).
board_goal() { sed -n 's/.*"goal"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$1" | head -1; }

finish() { echo "passed=$PASS failed=$FAILED"; [ "$FAILED" -eq 0 ] || exit 1; }
