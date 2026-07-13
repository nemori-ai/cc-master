#!/usr/bin/env bash
. "$(dirname "$0")/helpers.sh"

LAUNCHER="$REPO_ROOT/plugin/src/hooks/_hosts/codex/launcher.js"
CORE="$REPO_ROOT/plugin/src/hooks/board-guard/implementations/codex/board-guard-core.js"
ROOT="$(make_project)"
HOME_DIR="$ROOT/home"
PATCH_CWD="$ROOT/patch-cwd"
MUTANT_CORE="$ROOT/board-guard-rootedness-mutant.js"
GOOD='{"schema":"cc-master/v2","goal":"g","owner":{"active":true,"session_id":"sess-x"},"tasks":[]}'

cleanup() {
  rm -rf "$ROOT"
}
trap cleanup EXIT

mkdir -p "$HOME_DIR/boards" "$PATCH_CWD"
printf '%s' "$GOOD" > "$HOME_DIR/boards/armed.board.json"

# Generate the exact regression caught in round 6: TAB/CR cleanup happens before path.resolve(),
# promoting a parser-relative `/absolute-looking` shadow into a real absolute board path. Requiring
# one exact replacement makes this mutation test fail loudly if the implementation seam changes.
node - "$CORE" "$MUTANT_CORE" <<'NODE'
const fs = require('fs');
const [sourcePath, targetPath] = process.argv.slice(2);
const source = fs.readFileSync(sourcePath, 'utf8');
const correct = "return path.resolve(target).replace(/[\\t\\r]/gu, '');";
const mutant = "return path.resolve(target.replace(/[\\t\\r]/gu, ''));";
const occurrences = source.split(correct).length - 1;
if (occurrences !== 1) {
  process.stderr.write(`expected one rootedness-order mutation seam, found ${occurrences}\n`);
  process.exit(1);
}
fs.writeFileSync(targetPath, source.replace(correct, mutant));
fs.chmodSync(targetPath, 0o755);
NODE
MUTATION_RC=$?
assert_eq 0 "$MUTATION_RC" "rootedness-order mutant generated from exactly one seam"

patch_payload() {
  node -e 'process.stdout.write(JSON.stringify({
    session_id: "sess-x",
    hook_event_name: "PreToolUse",
    tool_name: "apply_patch",
    tool_input: {patch: process.argv[1]},
  }))' "$1"
}

run_core() {
  local core="$1" patch="$2"
  HOOK_OUT="$(
    patch_payload "$patch" |
      (cd "$PATCH_CWD" && CC_MASTER_HOME="$HOME_DIR" node "$LAUNCHER" --event PreToolUse --core "$core" 2>/dev/null)
  )"
  HOOK_RC=$?
}

for SEPARATOR_NAME in tab cr; do
  case "$SEPARATOR_NAME" in
    tab) SEPARATOR=$'\t' ;;
    cr) SEPARATOR=$'\r' ;;
  esac
  ACTUAL="$HOME_DIR/boards/mutant-$SEPARATOR_NAME.board.json"
  printf -v PATCH '*** Begin Patch\n*** Add File: %s%s\n+{}\n*** End Patch' "$SEPARATOR" "$ACTUAL"

  run_core "$CORE" "$PATCH"
  assert_eq 0 "$HOOK_RC" "$SEPARATOR_NAME rootedness fixture real core -> rc 0"
  assert_eq "" "$HOOK_OUT" "$SEPARATOR_NAME rootedness fixture real core -> legal shadow ALLOW"

  run_core "$MUTANT_CORE" "$PATCH"
  assert_eq 0 "$HOOK_RC" "$SEPARATOR_NAME rootedness fixture wrong-order mutant -> rc 0"
  assert_contains "$HOOK_OUT" '"decision":"block"' \
    "$SEPARATOR_NAME rootedness fixture kills cleanup-before-classification mutant"
done

finish
