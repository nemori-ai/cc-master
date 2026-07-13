#!/usr/bin/env bash
. "$(dirname "$0")/helpers.sh"

LAUNCHER="$REPO_ROOT/plugin/src/hooks/_hosts/codex/launcher.js"
CORE="$REPO_ROOT/plugin/src/hooks/board-guard/implementations/codex/board-guard-core.js"
ROOT="$(make_project)"
HOME_DIR="$ROOT/home"
PATCH_CWD="$ROOT/patch-cwd"
MUTANT_CORE="$ROOT/board-guard-symlink-mutant.js"
BOARD_SUFFIX='.board''.json'
GOOD='{"schema":"cc-master/v2","goal":"g","owner":{"active":true,"session_id":"sess-x"},"tasks":[]}'

cleanup() {
  rm -rf "$ROOT"
}
trap cleanup EXIT

mkdir -p "$HOME_DIR/boards" "$PATCH_CWD"
printf '%s' "$GOOD" > "$HOME_DIR/boards/armed${BOARD_SUFFIX}"

# Remove only the target realpath step while preserving parsing, rootedness/TAB-CR cleanup, and the
# canonical protected-root comparison. Both alias fixtures below must kill this exact mutant.
node - "$CORE" "$MUTANT_CORE" <<'NODE'
const fs = require('fs');
const [sourcePath, targetPath] = process.argv.slice(2);
const source = fs.readFileSync(sourcePath, 'utf8');
const correct = 'const realEffectPath = resolveExistingFilesystemEffect(effectPath);';
const mutant = 'const realEffectPath = effectPath;';
const occurrences = source.split(correct).length - 1;
if (occurrences !== 1) {
  process.stderr.write(`expected one symlink-resolution mutation seam, found ${occurrences}\n`);
  process.exit(1);
}
fs.writeFileSync(targetPath, source.replace(correct, mutant));
fs.chmodSync(targetPath, 0o755);
NODE
MUTATION_RC=$?
assert_eq 0 "$MUTATION_RC" "symlink-resolution mutant generated from exactly one seam"

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

FILE_TARGET="$HOME_DIR/boards/file-target${BOARD_SUFFIX}"
printf 'before\n' > "$FILE_TARGET"
ln -s "$FILE_TARGET" "$PATCH_CWD/file-alias.txt"
FILE_PATCH='*** Begin Patch
*** Update File: file-alias.txt
@@
-before
+after
*** End Patch'

ln -s "$HOME_DIR/boards" "$PATCH_CWD/boards-alias"
DIRECTORY_PATCH="*** Begin Patch
*** Add File: boards-alias/new-target${BOARD_SUFFIX}
+new
*** End Patch"

for CASE in file directory; do
  case "$CASE" in
    file) PATCH="$FILE_PATCH" ;;
    directory) PATCH="$DIRECTORY_PATCH" ;;
  esac

  run_core "$CORE" "$PATCH"
  assert_eq 0 "$HOOK_RC" "$CASE symlink fixture real core -> rc 0"
  assert_contains "$HOOK_OUT" '"decision":"block"' "$CASE symlink fixture real core -> block"

  run_core "$MUTANT_CORE" "$PATCH"
  assert_eq 0 "$HOOK_RC" "$CASE symlink fixture no-realpath mutant -> rc 0"
  assert_eq "" "$HOOK_OUT" "$CASE symlink fixture kills no-realpath mutant"
done

finish
