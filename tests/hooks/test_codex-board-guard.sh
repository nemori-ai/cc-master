#!/usr/bin/env bash
. "$(dirname "$0")/helpers.sh"

LAUNCHER="$REPO_ROOT/plugin/src/hooks/_hosts/codex/launcher.js"
CORE="$REPO_ROOT/plugin/src/hooks/board-guard/implementations/codex/board-guard-core.js"

seed_board() {
  mkdir -p "$1/boards"
  printf '%s' "$3" >"$1/boards/$2.board.json"
}

run_pretool() {
  HOOK_OUT="$(
    printf '%s' "$1" |
      CC_MASTER_HOME="$2" node "$LAUNCHER" --event PreToolUse --core "$CORE" 2>/dev/null
  )"
  HOOK_RC=$?
}

run_pretool_in_cwd() {
  HOOK_OUT="$(
    printf '%s' "$1" |
      (cd "$3" && CC_MASTER_HOME="$2" node "$LAUNCHER" --event PreToolUse --core "$CORE" 2>/dev/null)
  )"
  HOOK_RC=$?
}

json_write_payload() {
  printf '{"session_id":"%s","hook_event_name":"PreToolUse","tool_name":"%s","tool_input":{"file_path":"%s"}}' "$1" "$2" "$3"
}

json_bash_payload() {
  printf '{"session_id":"%s","hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":%s}}' "$1" "$(node -e 'process.stdout.write(JSON.stringify(process.argv[1]))' "$2")"
}

json_patch_payload() {
  printf '{"session_id":"%s","hook_event_name":"PreToolUse","tool_name":"apply_patch","tool_input":{"patch":%s}}' "$1" "$(node -e 'process.stdout.write(JSON.stringify(process.argv[1]))' "$2")"
}

json_native_patch_payload() {
  printf '{"session_id":"%s","hook_event_name":"PreToolUse","tool_name":"apply_patch","tool_input":%s}' "$1" "$(node -e 'process.stdout.write(JSON.stringify(process.argv[1]))' "$2")"
}

# functions.exec -> tools.apply_patch FREEFORM envelope (issue #156): the patch string arrives under
# tool_input.input rather than as a bare string or {patch}. The launcher must collapse it to
# {patch:string} before board-guard classifies targets.
json_input_wrapped_patch_payload() {
  printf '{"session_id":"%s","hook_event_name":"PreToolUse","tool_name":"apply_patch","tool_input":{"input":%s}}' "$1" "$(node -e 'process.stdout.write(JSON.stringify(process.argv[1]))' "$2")"
}

json_structured_payload() {
  printf '{"session_id":"%s","hook_event_name":"PreToolUse","tool_name":"%s","tool_input":%s}' "$1" "$2" "$3"
}

assert_patch_allowed() {
  run_pretool "$(json_patch_payload "sess-x" "$1")" "$2"
  assert_eq 0 "$HOOK_RC" "$3 -> rc 0"
  assert_eq "" "$HOOK_OUT" "$3 -> allow"
}

assert_patch_blocked() {
  run_pretool "$(json_patch_payload "sess-x" "$1")" "$2"
  assert_contains "$HOOK_OUT" '"decision":"block"' "$3 -> block"
}

assert_patch_allowed_in_cwd() {
  run_pretool_in_cwd "$(json_patch_payload "sess-x" "$1")" "$2" "$3"
  assert_eq 0 "$HOOK_RC" "$4 -> rc 0"
  assert_eq "" "$HOOK_OUT" "$4 -> allow"
}

assert_patch_blocked_in_cwd() {
  run_pretool_in_cwd "$(json_patch_payload "sess-x" "$1")" "$2" "$3"
  assert_eq 0 "$HOOK_RC" "$4 -> rc 0"
  assert_contains "$HOOK_OUT" '"decision":"block"' "$4 -> block"
}

REAL_APPLY_PATCH_BIN="$(command -v apply_patch 2>/dev/null || true)"

# require_apply_patch LABEL — single skip guard shared by every call site that runs the real
# installed apply_patch binary and then asserts its on-disk effect. assert_real_patch_applied /
# assert_real_patch_rejected below already print "SKIP: ..." and return without invoking the
# binary when it is unavailable, but a *trailing* effect assertion (assert_eq/assert_file/
# assert_no_file/symlink checks/...) that reads the resulting file must never run unconditionally
# against a patch that was never applied — that turns an environmental SKIP into a false FAIL.
# Callers wrap the assert_real_patch_* call and its trailing effect assertions together in
# `if require_apply_patch "$label"; then ... fi` so the whole group is skipped as one unit, and
# runs completely unmodified whenever the binary is present.
require_apply_patch() {
  if [ -z "$REAL_APPLY_PATCH_BIN" ]; then
    printf 'SKIP: %s (installed apply_patch unavailable)\n' "$1"
    return 1
  fi
  return 0
}

assert_real_patch_applied() {
  local patch="$1" cwd="$2" label="$3" out rc
  if [ -z "$REAL_APPLY_PATCH_BIN" ]; then
    printf 'SKIP: %s (installed apply_patch unavailable)\n' "$label"
    return
  fi
  out="$(printf '%s' "$patch" | (cd "$cwd" && "$REAL_APPLY_PATCH_BIN") 2>&1)"
  rc=$?
  assert_eq 0 "$rc" "$label -> real parser applied ($out)"
}

assert_real_patch_rejected() {
  local patch="$1" cwd="$2" label="$3" out rc
  if [ -z "$REAL_APPLY_PATCH_BIN" ]; then
    printf 'SKIP: %s (installed apply_patch unavailable)\n' "$label"
    return
  fi
  out="$(printf '%s' "$patch" | (cd "$cwd" && "$REAL_APPLY_PATCH_BIN") 2>&1)"
  rc=$?
  if [ "$rc" -ne 0 ]; then
    PASS=$((PASS+1))
  else
    FAILED=$((FAILED+1))
    _red "FAIL: $label -> real parser unexpectedly applied ($out)"
  fi
}

exercise_environment_patch_case() {
  local kind="$1" target_class="$2" kind_lc h target source patch label
  kind_lc="$(printf '%s' "$kind" | tr '[:upper:]' '[:lower:]')"
  h="$(make_project)"
  seed_board "$h" "armed" "$GOOD"
  label="apply_patch Environment ID $kind $target_class target"

  if [ "$target_class" = "board" ]; then
    target="$h/boards/$kind_lc.board.json"
  else
    target="$h/$kind_lc.txt"
  fi

  case "$kind" in
    Update)
      printf '%s\n' 'before' > "$target"
      patch="$(printf '%s\n' \
        '*** Begin Patch' \
        '*** Environment ID: remote' \
        "*** Update File: $target   " \
        '@@' \
        '-before' \
        "+after mentions $h/boards/armed.board.json only in hunk body" \
        '*** End Patch')"
      ;;
    Add)
      patch="$(printf '%s\n' \
        '*** Begin Patch' \
        '*** Environment ID: remote' \
        "*** Add File: $target   " \
        '+added' \
        '*** End Patch')"
      ;;
    Delete)
      printf '%s\n' 'delete-me' > "$target"
      patch="$(printf '%s\n' \
        '*** Begin Patch' \
        '*** Environment ID: remote' \
        "*** Delete File: $target   " \
        '*** End Patch')"
      ;;
    Move)
      source="$h/$kind_lc-${target_class}-source.txt"
      printf '%s\n' 'move-me' > "$source"
      patch="$(printf '%s\n' \
        '*** Begin Patch' \
        '*** Environment ID: remote' \
        "*** Update File: $source   " \
        "*** Move to: $target   " \
        '@@' \
        '-move-me' \
        '+moved' \
        '*** End Patch')"
      ;;
  esac

  if [ "$target_class" = "board" ]; then
    assert_patch_blocked "$patch" "$h" "$label"
  else
    assert_patch_allowed "$patch" "$h" "$label"
  fi
  if [ -n "$REAL_APPLY_PATCH_BIN" ]; then
    assert_real_patch_applied "$patch" "$h" "$label"
    case "$kind" in
      Update) assert_contains "$(tr -d '\n' < "$target")" 'after mentions' "$label -> real update effect" ;;
      Add) assert_file "$target" "$label -> real add effect" ;;
      Delete) assert_no_file "$target" "$label -> real delete effect" ;;
      Move) assert_file "$target" "$label -> real move effect" ;;
    esac
  else
    printf 'SKIP: %s (installed apply_patch unavailable)\n' "$label"
  fi
  rm -rf "$h"
}

exercise_control_whitespace_patch_case() {
  local kind="$1" target_class="$2" header_shape="${3:-trailing}" kind_lc h target source patch label control_prefix
  kind_lc="$(printf '%s' "$kind" | tr '[:upper:]' '[:lower:]')"
  h="$(make_project)"
  seed_board "$h" "armed" "$GOOD"
  label="apply_patch control whitespace $kind $target_class target ($header_shape header)"

  if [ "$target_class" = "board" ]; then
    target="$h/boards/$kind_lc-control.board.json"
    # Keep board rows trailing-whitespace-heavy: the normalization mutation must expose the raw
    # suffix as part of the target and turn these DENY assertions red, rather than fail closed.
    if [ "$header_shape" = "leading-and-trailing" ]; then
      control_prefix=$' \t'
    else
      control_prefix=''
    fi
  else
    target="$h/$kind_lc-control.txt"
    control_prefix=$' \t'
  fi

  case "$kind" in
    Update)
      printf '%s\n' 'before' > "$target"
      patch="$(printf '%s\n' \
        $' \t*** Begin Patch \t' \
        "${control_prefix}*** Update File: $target   " \
        '@@' \
        '-before' \
        "+after mentions $h/boards/armed.board.json only in hunk body" \
        $'*** End of File \t' \
        $' \t*** End Patch \t')"
      ;;
    Add)
      patch="$(printf '%s\n' \
        $' \t*** Begin Patch \t' \
        "${control_prefix}*** Add File: $target   " \
        '+added' \
        $' \t*** End Patch \t')"
      ;;
    Delete)
      printf '%s\n' 'delete-me' > "$target"
      patch="$(printf '%s\n' \
        $' \t*** Begin Patch \t' \
        "${control_prefix}*** Delete File: $target   " \
        $' \t*** End Patch \t')"
      ;;
    Move)
      source="$h/$kind_lc-${target_class}-source.txt"
      printf '%s\n' 'move-me' > "$source"
      patch="$(printf '%s\n' \
        $' \t*** Begin Patch \t' \
        "${control_prefix}*** Update File: $source   " \
        "*** Move to: $target   " \
        '@@' \
        '-move-me' \
        '+moved' \
        $' \t*** End Patch \t')"
      ;;
  esac

  if [ "$target_class" = "board" ]; then
    assert_patch_blocked "$patch" "$h" "$label"
  else
    assert_patch_allowed "$patch" "$h" "$label"
  fi
  if [ -n "$REAL_APPLY_PATCH_BIN" ]; then
    assert_real_patch_applied "$patch" "$h" "$label"
    case "$kind" in
      Update) assert_contains "$(tr -d '\n' < "$target")" 'after mentions' "$label -> real update effect" ;;
      Add) assert_file "$target" "$label -> real add effect" ;;
      Delete) assert_no_file "$target" "$label -> real delete effect" ;;
      Move) assert_file "$target" "$label -> real move effect" ;;
    esac
  else
    printf 'SKIP: %s (installed apply_patch unavailable)\n' "$label"
  fi
  rm -rf "$h"
}

exercise_post_eof_gap_case() {
  local gap_kind="$1" target_class="$2" h target patch gap label
  h="$(make_project)"
  seed_board "$h" "armed" "$GOOD"
  label="apply_patch post-End-of-File $gap_kind physical line $target_class target"
  if [ "$target_class" = "board" ]; then
    target="$h/boards/post-eof-$gap_kind.board.json"
  else
    target="$h/post-eof-$gap_kind.txt"
  fi
  case "$gap_kind" in
    empty) gap=$'\n' ;;
    space-tab) gap=$' \t\n' ;;
    cr-rich) gap=$'\r\r\r\n' ;;
  esac
  printf 'before\n' > "$target"
  printf -v patch '*** Begin Patch\n*** Update File: %s\n@@\n-before\n+after\n*** End of File\n%s*** End Patch' \
    "$target" "$gap"

  if [ "$target_class" = "board" ]; then
    assert_patch_blocked "$patch" "$h" "$label"
  else
    assert_patch_allowed "$patch" "$h" "$label"
  fi
  if require_apply_patch "$label"; then
    assert_real_patch_applied "$patch" "$h" "$label"
    assert_eq after "$(< "$target")" "$label -> real update effect"
    assert_eq 6 "$(wc -c < "$target" | tr -d '[:space:]')" "$label -> exact real update size"
  fi
  rm -rf "$h"
}

exercise_nel_header_patch_case() {
  local kind="$1" target_class="$2" kind_lc h target source patch label nel
  kind_lc="$(printf '%s' "$kind" | tr '[:upper:]' '[:lower:]')"
  h="$(make_project)"
  seed_board "$h" "armed" "$GOOD"
  nel="$(printf '\302\205')"
  label="apply_patch Rust-whitespace trailing NEL $kind $target_class target"
  if [ "$target_class" = "board" ]; then
    target="$h/boards/$kind_lc-nel.board.json"
  else
    target="$h/$kind_lc-nel.txt"
  fi

  case "$kind" in
    Add)
      printf -v patch '*** Begin Patch\n*** Add File: %s%s\n+added\n*** End Patch' "$target" "$nel"
      ;;
    Delete)
      printf 'delete-me\n' > "$target"
      printf -v patch '*** Begin Patch\n*** Delete File: %s%s\n*** End Patch' "$target" "$nel"
      ;;
    Update)
      printf 'before\n' > "$target"
      printf -v patch '*** Begin Patch\n*** Update File: %s%s\n@@\n-before\n+after\n*** End Patch' \
        "$target" "$nel"
      ;;
    Move)
      source="$h/$kind_lc-$target_class-source.txt"
      printf 'move-me\n' > "$source"
      printf -v patch '*** Begin Patch\n*** Update File: %s\n*** Move to: %s%s\n@@\n-move-me\n+moved\n*** End Patch' \
        "$source" "$target" "$nel"
      ;;
  esac

  if [ "$target_class" = "board" ]; then
    assert_patch_blocked "$patch" "$h" "$label"
  else
    assert_patch_allowed "$patch" "$h" "$label"
  fi
  if require_apply_patch "$label"; then
    assert_real_patch_applied "$patch" "$h" "$label"
    case "$kind" in
      Add) assert_file "$target" "$label -> real add effect" ;;
      Delete) assert_no_file "$target" "$label -> real delete effect" ;;
      Update) assert_eq after "$(< "$target")" "$label -> real update effect" ;;
      Move) assert_file "$target" "$label -> real move effect" ;;
    esac
  fi
  rm -rf "$h"
}

exercise_effect_obfuscated_target_case() {
  local kind="$1" separator_name="$2" target_class="$3" kind_lc h target wire source patch label separator
  kind_lc="$(printf '%s' "$kind" | tr '[:upper:]' '[:lower:]')"
  h="$(make_project)"
  seed_board "$h" "armed" "$GOOD"
  case "$separator_name" in
    tab) separator=$'\t' ;;
    cr) separator=$'\r' ;;
  esac
  label="apply_patch effect-normalized embedded $separator_name $kind $target_class target"
  if [ "$target_class" = "board" ]; then
    target="$h/boards/$kind_lc-$separator_name-effect.board.json"
    wire="${target%.json}.${separator}json"
  else
    target="$h/$kind_lc-$separator_name-effect.txt"
    wire="${target%.txt}.${separator}txt"
  fi

  case "$kind" in
    Add)
      printf -v patch '*** Begin Patch\n*** Add File: %s\n+added\n*** End Patch' "$wire"
      ;;
    Delete)
      printf 'delete-me\n' > "$target"
      printf -v patch '*** Begin Patch\n*** Delete File: %s\n*** End Patch' "$wire"
      ;;
    Update)
      printf 'before\n' > "$target"
      printf -v patch '*** Begin Patch\n*** Update File: %s\n@@\n-before\n+after\n*** End Patch' "$wire"
      ;;
    Move)
      source="$h/$kind_lc-$separator_name-$target_class-source.txt"
      printf 'move-me\n' > "$source"
      printf -v patch '*** Begin Patch\n*** Update File: %s\n*** Move to: %s\n@@\n-move-me\n+moved\n*** End Patch' \
        "$source" "$wire"
      ;;
  esac

  if [ "$target_class" = "board" ]; then
    assert_patch_blocked "$patch" "$h" "$label"
  else
    assert_patch_allowed "$patch" "$h" "$label"
  fi
  if require_apply_patch "$label"; then
    assert_real_patch_applied "$patch" "$h" "$label"
    case "$kind" in
      Add) assert_file "$target" "$label -> real add effect" ;;
      Delete) assert_no_file "$target" "$label -> real delete effect" ;;
      Update) assert_eq after "$(< "$target")" "$label -> real update effect" ;;
      Move)
        assert_file "$target" "$label -> real move effect"
        assert_no_file "$source" "$label -> real source removed"
        ;;
    esac
    assert_no_file "$wire" "$label -> no literal control-byte path"
  fi
  rm -rf "$h"
}

exercise_leading_separator_shadow_case() {
  local kind="$1" separator_name="$2" role="$3" kind_lc h home patch_cwd actual shadow wire source destination patch label separator actual_before
  h="$(make_project)"
  home="$h/home"
  patch_cwd="$h/patch-cwd"
  mkdir -p "$patch_cwd"
  seed_board "$home" "armed" "$GOOD"
  case "$separator_name" in
    tab) separator=$'\t' ;;
    cr) separator=$'\r' ;;
  esac

  kind_lc="$(printf '%s' "$kind" | tr '[:upper:]' '[:lower:]')"
  actual="$home/boards/$kind_lc-$role-$separator_name.board.json"
  shadow="$patch_cwd/${actual#/}"
  wire="${separator}${actual}"
  label="apply_patch leading $separator_name keeps $kind $role relative to patch cwd"
  actual_before='actual-board-must-stay-unchanged'

  case "$kind:$role" in
    Add:target)
      printf -v patch '*** Begin Patch\n*** Add File: %s\n+shadow-add\n*** End Patch' "$wire"
      ;;
    Delete:source)
      mkdir -p "$(dirname "$shadow")"
      printf 'shadow-delete\n' > "$shadow"
      printf '%s\n' "$actual_before" > "$actual"
      printf -v patch '*** Begin Patch\n*** Delete File: %s\n*** End Patch' "$wire"
      ;;
    Update:source)
      mkdir -p "$(dirname "$shadow")"
      printf 'before\n' > "$shadow"
      printf '%s\n' "$actual_before" > "$actual"
      printf -v patch '*** Begin Patch\n*** Update File: %s\n@@\n-before\n+after\n*** End Patch' "$wire"
      ;;
    Move:destination)
      source="$patch_cwd/move-$separator_name-source.txt"
      printf 'move-me\n' > "$source"
      printf '%s\n' "$actual_before" > "$actual"
      printf -v patch '*** Begin Patch\n*** Update File: %s\n*** Move to: %s\n@@\n-move-me\n+moved\n*** End Patch' \
        "$source" "$wire"
      ;;
    Move:source)
      mkdir -p "$(dirname "$shadow")"
      printf 'move-me\n' > "$shadow"
      printf '%s\n' "$actual_before" > "$actual"
      destination="$patch_cwd/move-$separator_name-destination.txt"
      printf -v patch '*** Begin Patch\n*** Update File: %s\n*** Move to: %s\n@@\n-move-me\n+moved\n*** End Patch' \
        "$wire" "$destination"
      ;;
  esac

  assert_patch_allowed_in_cwd "$patch" "$home" "$patch_cwd" "$label"
  if require_apply_patch "$label"; then
    assert_real_patch_applied "$patch" "$patch_cwd" "$label"
    case "$kind:$role" in
      Add:target)
        assert_file "$shadow" "$label -> exact relative shadow add effect"
        assert_no_file "$actual" "$label -> absolute-looking board target untouched"
        ;;
      Delete:source)
        assert_no_file "$shadow" "$label -> exact relative shadow delete effect"
        assert_eq "$actual_before" "$(< "$actual")" "$label -> actual board unchanged"
        ;;
      Update:source)
        assert_eq after "$(< "$shadow")" "$label -> exact relative shadow update effect"
        assert_eq "$actual_before" "$(< "$actual")" "$label -> actual board unchanged"
        ;;
      Move:destination)
        assert_file "$shadow" "$label -> exact relative shadow move destination"
        assert_no_file "$source" "$label -> move source removed"
        assert_eq "$actual_before" "$(< "$actual")" "$label -> actual board unchanged"
        ;;
      Move:source)
        assert_no_file "$shadow" "$label -> exact relative shadow move source removed"
        assert_file "$destination" "$label -> move destination created"
        assert_eq "$actual_before" "$(< "$actual")" "$label -> actual board unchanged"
        ;;
    esac
  fi
  rm -rf "$h"
}

exercise_literal_leading_space_target_case() {
  local h home patch_cwd actual shadow patch label
  h="$(make_project)"
  home="$h/home"
  patch_cwd="$h/patch-cwd"
  mkdir -p "$patch_cwd"
  seed_board "$home" "armed" "$GOOD"
  actual="$home/boards/literal-space.board.json"
  shadow="$patch_cwd/ /${actual#/}"
  label='apply_patch two spaces after Add header colon preserve a literal leading-space path'
  printf -v patch '*** Begin Patch\n*** Add File:  %s\n+space-shadow\n*** End Patch' "$actual"

  assert_patch_allowed_in_cwd "$patch" "$home" "$patch_cwd" "$label"
  if require_apply_patch "$label"; then
    assert_real_patch_applied "$patch" "$patch_cwd" "$label"
    assert_file "$shadow" "$label -> exact literal-space shadow effect"
    assert_no_file "$actual" "$label -> absolute-looking board target untouched"
  fi
  rm -rf "$h"
}

exercise_symlink_alias_case() {
  local alias_kind="$1" h home patch_cwd board alias target patch label
  h="$(make_project)"
  home="$h/home"
  patch_cwd="$h/patch-cwd"
  mkdir -p "$patch_cwd"
  seed_board "$home" "armed" "$GOOD"

  case "$alias_kind" in
    file)
      board="$home/boards/file-symlink-target.board.json"
      alias="$patch_cwd/file-alias.txt"
      target="file-alias.txt"
      label='apply_patch existing file symlink alias into protected boards root'
      printf 'before\n' > "$board"
      ln -s "$board" "$alias"
      ;;
    directory)
      board="$home/boards/directory-symlink-target.board.json"
      alias="$patch_cwd/boards-alias"
      target="boards-alias/directory-symlink-target.board.json"
      label='apply_patch existing directory symlink alias into protected boards root'
      printf 'before\n' > "$board"
      ln -s "$home/boards" "$alias"
      ;;
  esac

  printf -v patch '*** Begin Patch\n*** Update File: %s\n@@\n-before\n+after\n*** End Patch' "$target"
  assert_patch_blocked_in_cwd "$patch" "$home" "$patch_cwd" "$label"
  if require_apply_patch "$label"; then
    assert_real_patch_applied "$patch" "$patch_cwd" "$label"
    assert_eq after "$(< "$board")" "$label -> real protected-board effect"
    [ -L "$alias" ] && PASS=$((PASS+1)) || {
      FAILED=$((FAILED+1))
      _red "FAIL: $label -> parser replaced symlink alias"
    }
  fi
  rm -rf "$h"
}

exercise_symlink_resolution_boundaries() {
  local h home patch_cwd patch target real_target label
  h="$(make_project)"
  home="$h/home"
  patch_cwd="$h/patch-cwd"
  mkdir -p "$patch_cwd/non-board-real"
  seed_board "$home" "armed" "$GOOD"

  # A missing Add leaf still follows its existing symlinked ancestor into the protected root.
  ln -s "$home/boards" "$patch_cwd/boards-alias"
  target='boards-alias/new-through-directory-alias.board.json'
  real_target="$home/boards/new-through-directory-alias.board.json"
  label='apply_patch absent Add leaf below directory symlink into protected boards root'
  printf -v patch '*** Begin Patch\n*** Add File: %s\n+new\n*** End Patch' "$target"
  assert_patch_blocked_in_cwd "$patch" "$home" "$patch_cwd" "$label"
  if require_apply_patch "$label"; then
    assert_real_patch_applied "$patch" "$patch_cwd" "$label"
    assert_file "$real_target" "$label -> real protected-board effect"
  fi

  # Equivalent aliases outside the protected root remain ordinary legal parser targets.
  printf 'before\n' > "$patch_cwd/non-board-real/source.txt"
  ln -s "$patch_cwd/non-board-real/source.txt" "$patch_cwd/non-board-file-alias.txt"
  label='apply_patch existing file symlink alias outside protected boards root'
  printf -v patch '*** Begin Patch\n*** Update File: non-board-file-alias.txt\n@@\n-before\n+after\n*** End Patch'
  assert_patch_allowed_in_cwd "$patch" "$home" "$patch_cwd" "$label"
  if require_apply_patch "$label"; then
    assert_real_patch_applied "$patch" "$patch_cwd" "$label"
    assert_eq after "$(< "$patch_cwd/non-board-real/source.txt")" "$label -> real non-board effect"
  fi

  ln -s "$patch_cwd/non-board-real" "$patch_cwd/non-board-directory-alias"
  label='apply_patch absent Add leaf below directory symlink outside protected boards root'
  printf -v patch '*** Begin Patch\n*** Add File: non-board-directory-alias/new.txt\n+new\n*** End Patch'
  assert_patch_allowed_in_cwd "$patch" "$home" "$patch_cwd" "$label"
  if require_apply_patch "$label"; then
    assert_real_patch_applied "$patch" "$patch_cwd" "$label"
    assert_file "$patch_cwd/non-board-real/new.txt" "$label -> real non-board effect"
  fi

  # A wholly absent non-board path is resolved from its deepest existing ancestor and stays legal.
  label='apply_patch wholly absent nested non-board target'
  printf -v patch '*** Begin Patch\n*** Add File: absent/nested/new.txt\n+new\n*** End Patch'
  assert_patch_allowed_in_cwd "$patch" "$home" "$patch_cwd" "$label"
  if require_apply_patch "$label"; then
    assert_real_patch_applied "$patch" "$patch_cwd" "$label"
    assert_file "$patch_cwd/absent/nested/new.txt" "$label -> exact absent-path effect"
  fi

  # Existing-but-unresolvable paths are opaque, not equivalent to an absent lexical suffix.
  ln -s "$patch_cwd/missing-target.txt" "$patch_cwd/broken-alias.txt"
  label='apply_patch broken final symlink is fail-closed'
  printf -v patch '*** Begin Patch\n*** Update File: broken-alias.txt\n@@\n-before\n+after\n*** End Patch'
  assert_patch_blocked_in_cwd "$patch" "$home" "$patch_cwd" "$label"
  assert_real_patch_rejected "$patch" "$patch_cwd" "$label"

  ln -s loop-b "$patch_cwd/loop-a"
  ln -s loop-a "$patch_cwd/loop-b"
  label='apply_patch looping symlink ancestor is fail-closed'
  printf -v patch '*** Begin Patch\n*** Add File: loop-a/new.txt\n+new\n*** End Patch'
  assert_patch_blocked_in_cwd "$patch" "$home" "$patch_cwd" "$label"
  assert_real_patch_rejected "$patch" "$patch_cwd" "$label"

  printf 'not-a-directory\n' > "$patch_cwd/not-a-directory"
  label='apply_patch non-directory ancestor is fail-closed'
  printf -v patch '*** Begin Patch\n*** Add File: not-a-directory/new.txt\n+new\n*** End Patch'
  assert_patch_blocked_in_cwd "$patch" "$home" "$patch_cwd" "$label"
  assert_real_patch_rejected "$patch" "$patch_cwd" "$label"
  rm -rf "$h"
}

exercise_environment_near_neighbor() {
  local environment_line="$1" slug="$2" h target patch label
  h="$(make_project)"
  seed_board "$h" "armed" "$GOOD"
  target="$h/environment-$slug.txt"
  label="apply_patch Environment ID near-neighbor $slug"
  patch="$(printf '%s\n' \
    '*** Begin Patch' \
    "$environment_line" \
    "*** Add File: $target" \
    '+body' \
    '*** End Patch')"
  assert_patch_allowed "$patch" "$h" "$label"
  if require_apply_patch "$label"; then
    assert_real_patch_applied "$patch" "$h" "$label"
    assert_file "$target" "$label -> real add effect"
  fi
  rm -rf "$h"
}

chmod +x "$CORE"
GOOD='{"schema":"cc-master/v2","goal":"g","owner":{"active":true,"session_id":"sess-x"},"tasks":[{"id":"T0","status":"ready","deps":[]}]}'

# Codex native FREEFORM apply_patch sends tool_input as the patch string itself. The launcher must
# normalize that one host-native shape before board-guard classifies targets, without weakening the
# parser's existing fail-closed behavior for malformed input.
H="$(make_project)"
seed_board "$H" "mine" "$GOOD"

PATCH="*** Begin Patch
*** Add File: $H/ordinary-absolute.txt
+ordinary
*** End Patch"
run_pretool "$(json_native_patch_payload "sess-x" "$PATCH")" "$H"
assert_eq "" "$HOOK_OUT" "native FREEFORM apply_patch ordinary absolute path -> allow"

PATCH='*** Begin Patch
*** Add File: ordinary-relative.txt
+ordinary
*** End Patch'
run_pretool_in_cwd "$(json_native_patch_payload "sess-x" "$PATCH")" "$H" "$H"
assert_eq "" "$HOOK_OUT" "native FREEFORM apply_patch ordinary relative path -> allow"

PATCH="*** Begin Patch
*** Update File: $H/boards/mine.board.json
@@
-old
+new
*** End Patch"
run_pretool "$(json_native_patch_payload "sess-x" "$PATCH")" "$H"
assert_contains "$HOOK_OUT" '"decision":"block"' "native FREEFORM apply_patch real board path -> block"

run_pretool "$(json_native_patch_payload "sess-x" "not a patch envelope")" "$H"
assert_contains "$HOOK_OUT" '"decision":"block"' "native FREEFORM apply_patch malformed patch -> fail closed"
run_pretool "$(json_structured_payload "sess-x" "apply_patch" "42")" "$H"
assert_contains "$HOOK_OUT" '"decision":"block"' "native apply_patch malformed non-string/non-object input -> fail closed"
rm -rf "$H"

# functions.exec -> tools.apply_patch FREEFORM envelope (issue #156). The nested Codex tool contract
# delivers the patch as tool_input.input (a freeform string), not a bare string or {patch}. The
# launcher normalization bridge must collapse that carrier to {patch:string} so board-guard classifies
# the declared target instead of failing closed on an ordinary non-board source edit — while still
# denying real board targets and failing closed on a malformed envelope.
H="$(make_project)"
seed_board "$H" "mine" "$GOOD"

PATCH="*** Begin Patch
*** Add File: $H/ordinary-absolute-input.txt
+ordinary
*** End Patch"
run_pretool "$(json_input_wrapped_patch_payload "sess-x" "$PATCH")" "$H"
assert_eq "" "$HOOK_OUT" "functions.exec apply_patch envelope ordinary absolute path -> allow"

PATCH='*** Begin Patch
*** Add File: ordinary-relative-input.txt
+ordinary
*** End Patch'
run_pretool_in_cwd "$(json_input_wrapped_patch_payload "sess-x" "$PATCH")" "$H" "$H"
assert_eq "" "$HOOK_OUT" "functions.exec apply_patch envelope ordinary relative path -> allow"

PATCH="*** Begin Patch
*** Update File: $H/boards/mine.board.json
@@
-old
+new
*** End Patch"
run_pretool "$(json_input_wrapped_patch_payload "sess-x" "$PATCH")" "$H"
assert_contains "$HOOK_OUT" '"decision":"block"' "functions.exec apply_patch envelope real board path -> block"

run_pretool "$(json_input_wrapped_patch_payload "sess-x" "not a patch envelope")" "$H"
assert_contains "$HOOK_OUT" '"decision":"block"' "functions.exec apply_patch envelope malformed patch -> fail closed"

# Malformed nested envelope: the carrier field is not a string, so no patch can be extracted and the
# core must fail closed rather than allow.
run_pretool "$(json_structured_payload "sess-x" "apply_patch" '{"input":42}')" "$H"
assert_contains "$HOOK_OUT" '"decision":"block"' "functions.exec apply_patch envelope non-string carrier -> fail closed"
rm -rf "$H"

# Unarmed: allow silently.
H="$(make_project)"
mkdir -p "$H/boards"
run_pretool "$(json_write_payload "sess-x" "Write" "$H/boards/ghost.board.json")" "$H"
assert_eq 0 "$HOOK_RC" "unarmed write -> rc 0"
assert_eq "" "$HOOK_OUT" "unarmed write -> silent"
PATCH="$(printf '%s\n' \
  '*** Begin Patch' \
  '*** Environment ID: remote' \
  "*** Update File: $H/boards/ghost.board.json" \
  '@@' \
  '-old' \
  '+new' \
  '*** End Patch')"
assert_patch_allowed "$PATCH" "$H" "unarmed apply_patch Environment ID board target stays dormant"
PATCH="$(printf '%s\n' \
  $' \t*** Begin Patch \t' \
  " *** Update File: $H/boards/ghost.board.json   " \
  '@@' \
  '-old' \
  '+new' \
  $' \t*** End Patch \t')"
assert_patch_allowed "$PATCH" "$H" "unarmed apply_patch whitespace board target stays dormant"
rm -rf "$H"

# Existing aliases are part of the native parser's actual filesystem effect. The armed guard must
# classify the resolved target, not only the harmless-looking lexical spelling below the patch cwd.
# Run the real parser after the deny assertion to prove both aliases reach a protected board file.
exercise_symlink_alias_case file
exercise_symlink_alias_case directory
exercise_symlink_resolution_boundaries

# Armed Write/Edit/MultiEdit to board path: block.
H="$(make_project)"
seed_board "$H" "mine" "$GOOD"
for TOOL in Write Edit MultiEdit; do
  run_pretool "$(json_write_payload "sess-x" "$TOOL" "$H/boards/mine.board.json")" "$H"
  assert_contains "$HOOK_OUT" '"decision":"block"' "$TOOL board write -> Codex block"
  assert_contains "$HOOK_OUT" "ccm task" "$TOOL board write -> reason names ccm fix"
done
rm -rf "$H"

# Non-board file: allow.
H="$(make_project)"
seed_board "$H" "mine" "$GOOD"
run_pretool "$(json_write_payload "sess-x" "Write" "$H/notes.txt")" "$H"
assert_eq "" "$HOOK_OUT" "non-board write -> allow"
rm -rf "$H"

# A plain ccm --board call is allowed, but shell redirection to a board is a direct shell write even
# when ccm is the command word. Echo/sed remain blocked as before.
H="$(make_project)"
seed_board "$H" "mine" "$GOOD"
run_pretool "$(json_bash_payload "sess-x" "ccm task done T0 --board $H/boards/mine.board.json")" "$H"
assert_eq "" "$HOOK_OUT" "ccm command touching board -> allow"
run_pretool "$(json_bash_payload "sess-x" "ccm --help > $H/boards/mine.board.json")" "$H"
assert_contains "$HOOK_OUT" '"decision":"block"' "Bash ccm > board -> block"
run_pretool "$(json_bash_payload "sess-x" "CC_MASTER_HOME='$H' ccm task ls --json --board '$H/boards/mine.board.json' > '$H/boards/mine.board.json'")" "$H"
assert_contains "$HOOK_OUT" '"decision":"block"' "Bash env-prefixed ccm > quoted board -> block"
run_pretool "$(json_bash_payload "sess-x" "ccm board show --board $H/boards/mine.board.json >> $H/boards/mine.board.json")" "$H"
assert_contains "$HOOK_OUT" '"decision":"block"' "Bash ccm >> board -> block"
run_pretool "$(json_bash_payload "sess-x" "echo '{}' > $H/boards/mine.board.json")" "$H"
assert_contains "$HOOK_OUT" '"decision":"block"' "Bash echo board write -> block"
run_pretool "$(json_bash_payload "sess-x" "sed -i s/a/b/ $H/boards/mine.board.json")" "$H"
assert_contains "$HOOK_OUT" '"decision":"block"' "Bash sed board write -> block"
rm -rf "$H"

# apply_patch classification uses only structured file headers. A real non-board hook target stays
# allowed even when removed/added hunk content contains absolute board paths or the .board.json
# regex/string that triggered the dogfood false positive.
H="$(make_project)"
seed_board "$H" "mine" "$GOOD"
BOOTSTRAP="$REPO_ROOT/plugin/src/hooks/bootstrap-board/implementations/claude-code/bootstrap-board.sh"
PATCH="*** Begin Patch
*** Update File: $BOOTSTRAP
@@
-const boardPattern = /\\.board\\.json$/;
+const exampleBoard = '$H/boards/mine.board.json';
*** End Patch"
assert_patch_allowed "$PATCH" "$H" "apply_patch non-board target with board-looking hunk body"

PATCH="*** Begin Patch
*** Update File: $BOOTSTRAP
@@
-$H/boards/mine.board.json
+\\.board\\.json
*** End of File
*** End Patch"
assert_patch_allowed "$PATCH" "$H" "apply_patch known End of File marker is not a target header"

# These accepted forms were calibrated against the real Codex 0.144.2 apply_patch parser. Add may
# be empty but every present Add body line starts '+'. Update permits an implicit first hunk and an
# End of File marker after a non-empty hunk; another hunk after that marker must start with @@.
PATCH="*** Begin Patch
*** Add File: $REPO_ROOT/empty non-board fixture.txt
*** End Patch"
assert_patch_allowed "$PATCH" "$H" "apply_patch empty Add File matches real parser grammar"

PATCH="*** Begin Patch
*** Update File: $BOOTSTRAP
-old
+new
*** End Patch"
assert_patch_allowed "$PATCH" "$H" "apply_patch implicit first Update hunk matches real parser grammar"

PATCH="*** Begin Patch
*** Update File: $BOOTSTRAP
@@
-old
+new
*** End of File
@@
-older
+newer
*** End Patch"
assert_patch_allowed "$PATCH" "$H" "apply_patch hunk after End of File starts with context marker"

PATCH="*** Begin Patch
*** Update File: $BOOTSTRAP
@@
-old
+*** Update File: $H/boards/mine.board.json
*** End Patch"
assert_patch_allowed "$PATCH" "$H" "apply_patch header-looking added hunk text is never target evidence"

# Exact round4 reviewer RED matrix: each non-board patch below was accepted by the installed
# Codex 0.144.2 parser and produced the asserted filesystem effect. Keep these cases separate from
# hunk-data classification: only lines parsed in a top-level control slot receive outer-whitespace
# normalization.
CONTROL_ADD_BEGIN="$H/control-begin.txt"
PATCH="$(printf '%s\n' \
  '*** Begin Patch   ' \
  "*** Add File: $CONTROL_ADD_BEGIN" \
  '+begin' \
  '*** End Patch')"
assert_patch_allowed "$PATCH" "$H" "apply_patch Begin Patch trailing whitespace"
if require_apply_patch "apply_patch Begin Patch trailing whitespace"; then
  assert_real_patch_applied "$PATCH" "$H" "apply_patch Begin Patch trailing whitespace"
  assert_file "$CONTROL_ADD_BEGIN" "apply_patch Begin Patch trailing whitespace -> real add effect"
fi

CONTROL_ADD_END="$H/control-end.txt"
PATCH="$(printf '%s\n' \
  '*** Begin Patch' \
  "*** Add File: $CONTROL_ADD_END" \
  '+end' \
  '*** End Patch   ')"
assert_patch_allowed "$PATCH" "$H" "apply_patch End Patch trailing whitespace"
if require_apply_patch "apply_patch End Patch trailing whitespace"; then
  assert_real_patch_applied "$PATCH" "$H" "apply_patch End Patch trailing whitespace"
  assert_file "$CONTROL_ADD_END" "apply_patch End Patch trailing whitespace -> real add effect"
fi

CONTROL_UPDATE_EOF="$H/control-eof.txt"
printf '%s\n' 'before' > "$CONTROL_UPDATE_EOF"
PATCH="$(printf '%s\n' \
  '*** Begin Patch' \
  "*** Update File: $CONTROL_UPDATE_EOF" \
  '@@' \
  '-before' \
  '+after-eof' \
  '*** End of File   ' \
  '*** End Patch')"
assert_patch_allowed "$PATCH" "$H" "apply_patch End of File trailing whitespace"
if require_apply_patch "apply_patch End of File trailing whitespace"; then
  assert_real_patch_applied "$PATCH" "$H" "apply_patch End of File trailing whitespace"
  assert_contains "$(tr -d '\n' < "$CONTROL_UPDATE_EOF")" 'after-eof' "apply_patch End of File trailing whitespace -> real update effect"
fi

CONTROL_UPDATE_LEADING="$H/control-leading-update.txt"
printf '%s\n' 'before' > "$CONTROL_UPDATE_LEADING"
PATCH="$(printf '%s\n' \
  '*** Begin Patch' \
  " *** Update File: $CONTROL_UPDATE_LEADING" \
  '@@' \
  '-before' \
  '+after-leading-update' \
  '*** End Patch')"
assert_patch_allowed "$PATCH" "$H" "apply_patch Update File leading whitespace"
if require_apply_patch "apply_patch Update File leading whitespace"; then
  assert_real_patch_applied "$PATCH" "$H" "apply_patch Update File leading whitespace"
  assert_contains "$(tr -d '\n' < "$CONTROL_UPDATE_LEADING")" 'after-leading-update' "apply_patch Update File leading whitespace -> real update effect"
fi

CONTROL_ADD_LEADING_END="$H/control-leading-end.txt"
PATCH="$(printf '%s\n' \
  '*** Begin Patch' \
  "*** Add File: $CONTROL_ADD_LEADING_END" \
  '+leading-end' \
  ' *** End Patch')"
assert_patch_allowed "$PATCH" "$H" "apply_patch End Patch leading whitespace"
if require_apply_patch "apply_patch End Patch leading whitespace"; then
  assert_real_patch_applied "$PATCH" "$H" "apply_patch End Patch leading whitespace"
  assert_file "$CONTROL_ADD_LEADING_END" "apply_patch End Patch leading whitespace -> real add effect"
fi

# The installed parser also strips whitespace around the whole envelope and accepts CRLF line
# endings. Keep these as filesystem-effect fixtures: the guard must not reject legal non-board input
# before its context-aware control lexer gets a chance to classify the declared target.
CONTROL_OUTER_LEADING="$H/control-outer-leading.txt"
printf -v PATCH '\n*** Begin Patch\n*** Add File: %s\n+leading-blank\n*** End Patch' "$CONTROL_OUTER_LEADING"
assert_patch_allowed "$PATCH" "$H" "apply_patch leading blank before envelope"
if require_apply_patch "apply_patch leading blank before envelope"; then
  assert_real_patch_applied "$PATCH" "$H" "apply_patch leading blank before envelope"
  assert_file "$CONTROL_OUTER_LEADING" "apply_patch leading blank before envelope -> real add effect"
fi

CONTROL_OUTER_SPACES="$H/control-outer-spaces.txt"
printf -v PATCH ' \t\n*** Begin Patch\n*** Add File: %s\n+outer-spaces\n*** End Patch' "$CONTROL_OUTER_SPACES"
assert_patch_allowed "$PATCH" "$H" "apply_patch space-tab line before envelope"
if require_apply_patch "apply_patch space-tab line before envelope"; then
  assert_real_patch_applied "$PATCH" "$H" "apply_patch space-tab line before envelope"
  assert_file "$CONTROL_OUTER_SPACES" "apply_patch space-tab outer line -> real add effect"
fi

CONTROL_OUTER_SPACES_BOARD="$H/boards/control-outer-spaces.board.json"
printf -v PATCH ' \t\n*** Begin Patch\n*** Add File: %s\n+{}\n*** End Patch' "$CONTROL_OUTER_SPACES_BOARD"
assert_patch_blocked "$PATCH" "$H" "apply_patch space-tab outer line board target"
if require_apply_patch "apply_patch space-tab outer line board target"; then
  assert_real_patch_applied "$PATCH" "$H" "apply_patch space-tab outer line board target"
  assert_file "$CONTROL_OUTER_SPACES_BOARD" "apply_patch space-tab outer board target -> real add effect"
fi

CONTROL_OUTER_TRAILING="$H/control-outer-trailing.txt"
printf -v PATCH '*** Begin Patch\n*** Add File: %s\n+trailing-blank\n*** End Patch\n\n' "$CONTROL_OUTER_TRAILING"
assert_patch_allowed "$PATCH" "$H" "apply_patch two trailing newlines after envelope"
if require_apply_patch "apply_patch two trailing newlines after envelope"; then
  assert_real_patch_applied "$PATCH" "$H" "apply_patch two trailing newlines after envelope"
  assert_file "$CONTROL_OUTER_TRAILING" "apply_patch two trailing newlines after envelope -> real add effect"
fi

CONTROL_INNER_BLANK="$H/control-inner-blank.txt"
printf -v PATCH '*** Begin Patch\n \t\n*** Add File: %s\n+inner-blank\n*** End Patch' "$CONTROL_INNER_BLANK"
assert_patch_blocked "$PATCH" "$H" "apply_patch whitespace-only line inside envelope"
if require_apply_patch "apply_patch whitespace-only line inside envelope"; then
  assert_real_patch_rejected "$PATCH" "$H" "apply_patch whitespace-only line inside envelope"
  assert_no_file "$CONTROL_INNER_BLANK" "apply_patch inner whitespace line -> no filesystem effect"
fi

CONTROL_CRLF_ALL="$H/control-crlf-all.txt"
printf -v PATCH '*** Begin Patch\r\n*** Add File: %s\r\n+all-crlf\r\n*** End Patch\r\n' "$CONTROL_CRLF_ALL"
assert_patch_allowed "$PATCH" "$H" "apply_patch full CRLF envelope"
if require_apply_patch "apply_patch full CRLF envelope"; then
  assert_real_patch_applied "$PATCH" "$H" "apply_patch full CRLF envelope"
  assert_file "$CONTROL_CRLF_ALL" "apply_patch full CRLF envelope -> real add effect"
fi

CONTROL_CRLF_EMPTY_CONTEXT="$H/control-crlf-empty-context.txt"
printf 'before\n\n' > "$CONTROL_CRLF_EMPTY_CONTEXT"
printf -v PATCH '*** Begin Patch\r\n*** Update File: %s\r\n@@\r\n-before\r\n+after\r\n\r\n*** End Patch\r\n' "$CONTROL_CRLF_EMPTY_CONTEXT"
assert_patch_allowed "$PATCH" "$H" "apply_patch CRLF empty physical context line"
if require_apply_patch "apply_patch CRLF empty physical context line"; then
  assert_real_patch_applied "$PATCH" "$H" "apply_patch CRLF empty physical context line"
  assert_eq after "$(< "$CONTROL_CRLF_EMPTY_CONTEXT")" "apply_patch CRLF empty context -> real update content"
  assert_eq 6 "$(wc -c < "$CONTROL_CRLF_EMPTY_CONTEXT" | tr -d '[:space:]')" "apply_patch CRLF empty context -> exact real update size"
fi

CONTROL_CRLF_EMPTY_CONTEXT_BOARD="$H/boards/control-crlf-empty-context.board.json"
printf 'before\n\n' > "$CONTROL_CRLF_EMPTY_CONTEXT_BOARD"
printf -v PATCH '*** Begin Patch\r\n*** Update File: %s\r\n@@\r\n-before\r\n+after\r\n\r\n*** End Patch\r\n' "$CONTROL_CRLF_EMPTY_CONTEXT_BOARD"
assert_patch_blocked "$PATCH" "$H" "apply_patch CRLF empty context board target"
if require_apply_patch "apply_patch CRLF empty context board target"; then
  assert_real_patch_applied "$PATCH" "$H" "apply_patch CRLF empty context board target"
  assert_eq after "$(< "$CONTROL_CRLF_EMPTY_CONTEXT_BOARD")" "apply_patch CRLF empty context board -> real update content"
  assert_eq 6 "$(wc -c < "$CONTROL_CRLF_EMPTY_CONTEXT_BOARD" | tr -d '[:space:]')" "apply_patch CRLF empty context board -> exact real update size"
fi

CONTROL_DOUBLE_CR_EMPTY_CONTEXT="$H/control-double-cr-empty-context.txt"
printf 'before\n\n' > "$CONTROL_DOUBLE_CR_EMPTY_CONTEXT"
printf -v PATCH '*** Begin Patch\r\n*** Update File: %s\r\n@@\r\n-before\r\n+after\r\n\r\r\n*** End Patch\r\n' \
  "$CONTROL_DOUBLE_CR_EMPTY_CONTEXT"
assert_patch_allowed "$PATCH" "$H" "apply_patch double-CR empty physical context line"
if require_apply_patch "apply_patch double-CR empty physical context line"; then
  assert_real_patch_applied "$PATCH" "$H" "apply_patch double-CR empty physical context line"
  assert_eq after "$(< "$CONTROL_DOUBLE_CR_EMPTY_CONTEXT")" "apply_patch double-CR empty context -> real update content"
  assert_eq 6 "$(wc -c < "$CONTROL_DOUBLE_CR_EMPTY_CONTEXT" | tr -d '[:space:]')" "apply_patch double-CR empty context -> exact real update size"
fi

CONTROL_DOUBLE_CR_EMPTY_CONTEXT_BOARD="$H/boards/control-double-cr-empty-context.board.json"
printf 'before\n\n' > "$CONTROL_DOUBLE_CR_EMPTY_CONTEXT_BOARD"
printf -v PATCH '*** Begin Patch\r\n*** Update File: %s\r\n@@\r\n-before\r\n+after\r\n\r\r\n*** End Patch\r\n' \
  "$CONTROL_DOUBLE_CR_EMPTY_CONTEXT_BOARD"
assert_patch_blocked "$PATCH" "$H" "apply_patch double-CR empty context board target"
if require_apply_patch "apply_patch double-CR empty context board target"; then
  assert_real_patch_applied "$PATCH" "$H" "apply_patch double-CR empty context board target"
  assert_eq after "$(< "$CONTROL_DOUBLE_CR_EMPTY_CONTEXT_BOARD")" "apply_patch double-CR empty context board -> real update content"
  assert_eq 6 "$(wc -c < "$CONTROL_DOUBLE_CR_EMPTY_CONTEXT_BOARD" | tr -d '[:space:]')" "apply_patch double-CR empty context board -> exact real update size"
fi

CONTROL_TRIPLE_CR_EMPTY_CONTEXT="$H/control-triple-cr-empty-context.txt"
printf 'before\n\n' > "$CONTROL_TRIPLE_CR_EMPTY_CONTEXT"
printf -v PATCH '*** Begin Patch\r\n*** Update File: %s\r\n@@\r\n-before\r\n+after\r\n\r\r\r\n*** End Patch\r\n' \
  "$CONTROL_TRIPLE_CR_EMPTY_CONTEXT"
assert_patch_blocked "$PATCH" "$H" "apply_patch triple-CR empty context is malformed"
if require_apply_patch "apply_patch triple-CR empty context is malformed"; then
  assert_real_patch_rejected "$PATCH" "$H" "apply_patch triple-CR empty context is malformed"
  assert_eq before "$(< "$CONTROL_TRIPLE_CR_EMPTY_CONTEXT")" "apply_patch triple-CR rejection -> source unchanged"
fi

CONTROL_TRIPLE_CR_EMPTY_CONTEXT_BOARD="$H/boards/control-triple-cr-empty-context.board.json"
printf 'before\n\n' > "$CONTROL_TRIPLE_CR_EMPTY_CONTEXT_BOARD"
printf -v PATCH '*** Begin Patch\r\n*** Update File: %s\r\n@@\r\n-before\r\n+after\r\n\r\r\r\n*** End Patch\r\n' \
  "$CONTROL_TRIPLE_CR_EMPTY_CONTEXT_BOARD"
assert_patch_blocked "$PATCH" "$H" "apply_patch triple-CR empty context board is malformed"
if require_apply_patch "apply_patch triple-CR empty context board is malformed"; then
  assert_real_patch_rejected "$PATCH" "$H" "apply_patch triple-CR empty context board is malformed"
  assert_eq before "$(< "$CONTROL_TRIPLE_CR_EMPTY_CONTEXT_BOARD")" "apply_patch triple-CR board rejection -> source unchanged"
fi

CONTROL_CR_BEGIN="$H/control-cr-begin.txt"
printf -v PATCH '*** Begin Patch\r\n*** Add File: %s\n+begin-cr\n*** End Patch' "$CONTROL_CR_BEGIN"
assert_patch_allowed "$PATCH" "$H" "apply_patch Begin Patch CRLF only"
if require_apply_patch "apply_patch Begin Patch CRLF only"; then
  assert_real_patch_applied "$PATCH" "$H" "apply_patch Begin Patch CRLF only"
  assert_file "$CONTROL_CR_BEGIN" "apply_patch Begin Patch CRLF only -> real add effect"
fi

CONTROL_CR_FILE="$H/control-cr-file.txt"
printf -v PATCH '*** Begin Patch\n*** Add File: %s\r\n+file-cr\n*** End Patch' "$CONTROL_CR_FILE"
assert_patch_allowed "$PATCH" "$H" "apply_patch file header CRLF only"
if require_apply_patch "apply_patch file header CRLF only"; then
  assert_real_patch_applied "$PATCH" "$H" "apply_patch file header CRLF only"
  assert_file "$CONTROL_CR_FILE" "apply_patch file header CRLF only -> real add effect"
fi

CONTROL_CR_END="$H/control-cr-end.txt"
printf -v PATCH '*** Begin Patch\n*** Add File: %s\n+end-cr\n*** End Patch\r\n' "$CONTROL_CR_END"
assert_patch_allowed "$PATCH" "$H" "apply_patch End Patch CRLF only"
if require_apply_patch "apply_patch End Patch CRLF only"; then
  assert_real_patch_applied "$PATCH" "$H" "apply_patch End Patch CRLF only"
  assert_file "$CONTROL_CR_END" "apply_patch End Patch CRLF only -> real add effect"
fi

CONTROL_CR_EOF="$H/control-cr-eof.txt"
printf '%s\n' 'before' > "$CONTROL_CR_EOF"
printf -v PATCH '*** Begin Patch\n*** Update File: %s\n@@\n-before\n+after-eof-cr\n*** End of File\r\n*** End Patch' "$CONTROL_CR_EOF"
assert_patch_allowed "$PATCH" "$H" "apply_patch End of File CRLF only"
if require_apply_patch "apply_patch End of File CRLF only"; then
  assert_real_patch_applied "$PATCH" "$H" "apply_patch End of File CRLF only"
  assert_contains "$(tr -d '\n' < "$CONTROL_CR_EOF")" 'after-eof-cr' "apply_patch End of File CRLF only -> real update effect"
fi

# Codex 0.144.2 is implemented in Rust: control and envelope normalization follows
# `char::is_whitespace`, whose Unicode White_Space set includes U+0085 NEL while JavaScript trim
# does not. These filesystem-effect rows pin the cross-runtime boundary without ever trimming hunk
# data globally.
NEL="$(printf '\302\205')"
CONTROL_NEL_TOPLEVEL="$H/control-nel-toplevel.txt"
printf -v PATCH '%s*** Begin Patch%s\n%s*** Add File: %s%s\n+nel-toplevel\n%s*** End Patch%s' \
  "$NEL" "$NEL" "$NEL" "$CONTROL_NEL_TOPLEVEL" "$NEL" "$NEL" "$NEL"
assert_patch_allowed "$PATCH" "$H" "apply_patch leading/trailing NEL on top-level controls"
if require_apply_patch "apply_patch leading/trailing NEL on top-level controls"; then
  assert_real_patch_applied "$PATCH" "$H" "apply_patch leading/trailing NEL on top-level controls"
  assert_file "$CONTROL_NEL_TOPLEVEL" "apply_patch top-level NEL -> real add effect"
fi

CONTROL_NEL_TOPLEVEL_BOARD="$H/boards/control-nel-toplevel.board.json"
printf -v PATCH '%s*** Begin Patch%s\n%s*** Add File: %s%s\n+{}\n%s*** End Patch%s' \
  "$NEL" "$NEL" "$NEL" "$CONTROL_NEL_TOPLEVEL_BOARD" "$NEL" "$NEL" "$NEL"
assert_patch_blocked "$PATCH" "$H" "apply_patch leading/trailing NEL top-level board target"
if require_apply_patch "apply_patch leading/trailing NEL top-level board target"; then
  assert_real_patch_applied "$PATCH" "$H" "apply_patch leading/trailing NEL top-level board target"
  assert_file "$CONTROL_NEL_TOPLEVEL_BOARD" "apply_patch top-level NEL board -> real add effect"
fi

CONTROL_NEL_OUTER="$H/control-nel-outer.txt"
printf -v PATCH '%s\n*** Begin Patch\n*** Add File: %s\n+nel-outer\n*** End Patch\n%s' \
  "$NEL" "$CONTROL_NEL_OUTER" "$NEL"
assert_patch_allowed "$PATCH" "$H" "apply_patch NEL-only physical lines outside envelope"
if require_apply_patch "apply_patch NEL-only physical lines outside envelope"; then
  assert_real_patch_applied "$PATCH" "$H" "apply_patch NEL-only physical lines outside envelope"
  assert_file "$CONTROL_NEL_OUTER" "apply_patch outer NEL -> real add effect"
fi

CONTROL_NEL_OUTER_BOARD="$H/boards/control-nel-outer.board.json"
printf -v PATCH '%s\n*** Begin Patch\n*** Add File: %s\n+{}\n*** End Patch\n%s' \
  "$NEL" "$CONTROL_NEL_OUTER_BOARD" "$NEL"
assert_patch_blocked "$PATCH" "$H" "apply_patch outer NEL board target"
if require_apply_patch "apply_patch outer NEL board target"; then
  assert_real_patch_applied "$PATCH" "$H" "apply_patch outer NEL board target"
  assert_file "$CONTROL_NEL_OUTER_BOARD" "apply_patch outer NEL board -> real add effect"
fi

CONTROL_NEL_EOF="$H/control-nel-eof.txt"
printf 'before\n' > "$CONTROL_NEL_EOF"
printf -v PATCH '*** Begin Patch\n*** Update File: %s\n@@\n-before\n+after-nel-eof\n*** End of File%s\n*** End Patch' \
  "$CONTROL_NEL_EOF" "$NEL"
assert_patch_allowed "$PATCH" "$H" "apply_patch End of File trailing NEL"
if require_apply_patch "apply_patch End of File trailing NEL"; then
  assert_real_patch_applied "$PATCH" "$H" "apply_patch End of File trailing NEL"
  assert_eq after-nel-eof "$(< "$CONTROL_NEL_EOF")" "apply_patch End of File NEL -> real update effect"
fi

# U+FEFF is intentionally not in Rust Unicode White_Space. It cannot prefix a control, and a
# filename ending in FEFF is a distinct non-board path even when the preceding suffix is
# `.board.json`.
FEFF="$(printf '\357\273\277')"
CONTROL_FEFF_BEGIN="$H/control-feff-begin.txt"
printf -v PATCH '%s*** Begin Patch\n*** Add File: %s\n+feff-begin\n*** End Patch' \
  "$FEFF" "$CONTROL_FEFF_BEGIN"
assert_patch_blocked "$PATCH" "$H" "apply_patch FEFF before Begin Patch is malformed"
if require_apply_patch "apply_patch FEFF before Begin Patch is malformed"; then
  assert_real_patch_rejected "$PATCH" "$H" "apply_patch FEFF before Begin Patch is malformed"
  assert_no_file "$CONTROL_FEFF_BEGIN" "apply_patch FEFF Begin rejection -> no effect"
fi

CONTROL_FEFF_HEADER="$H/control-feff-header.txt"
printf -v PATCH '*** Begin Patch\n%s*** Add File: %s\n+feff-header\n*** End Patch' \
  "$FEFF" "$CONTROL_FEFF_HEADER"
assert_patch_blocked "$PATCH" "$H" "apply_patch FEFF before file header is malformed"
if require_apply_patch "apply_patch FEFF before file header is malformed"; then
  assert_real_patch_rejected "$PATCH" "$H" "apply_patch FEFF before file header is malformed"
  assert_no_file "$CONTROL_FEFF_HEADER" "apply_patch FEFF header rejection -> no effect"
fi

CONTROL_FEFF_SUFFIX="$H/boards/distinct.board.json${FEFF}"
printf -v PATCH '*** Begin Patch\n*** Add File: %s\n+feff-suffix\n*** End Patch' "$CONTROL_FEFF_SUFFIX"
assert_patch_allowed "$PATCH" "$H" "apply_patch FEFF-suffixed board-looking path is distinct non-board"
if require_apply_patch "apply_patch FEFF-suffixed board-looking path is distinct non-board"; then
  assert_real_patch_applied "$PATCH" "$H" "apply_patch FEFF-suffixed board-looking path is distinct non-board"
  assert_file "$CONTROL_FEFF_SUFFIX" "apply_patch FEFF suffix -> exact distinct file effect"
  assert_no_file "$H/boards/distinct.board.json" "apply_patch FEFF suffix -> no normalized board effect"
fi

CONTROL_CR_BOARD="$H/boards/control-crlf.board.json"
printf -v PATCH '*** Begin Patch\r\n*** Add File: %s\r\n+{}\r\n*** End Patch\r\n' "$CONTROL_CR_BOARD"
assert_patch_blocked "$PATCH" "$H" "apply_patch full CRLF board target"
if require_apply_patch "apply_patch full CRLF board target"; then
  assert_real_patch_applied "$PATCH" "$H" "apply_patch full CRLF board target"
  assert_file "$CONTROL_CR_BOARD" "apply_patch full CRLF board target -> real add effect"
fi

# An End-of-File marker finishes a hunk, but the installed parser still accepts Rust-whitespace-only
# physical separator lines before the outer End Patch. This is a state-specific allowance; the same
# physical line elsewhere inside the envelope remains meaningful context or malformed.
for GAP_KIND in empty space-tab cr-rich; do
  exercise_post_eof_gap_case "$GAP_KIND" non-board
  exercise_post_eof_gap_case "$GAP_KIND" board
done

CONTROL_POST_EOF_NONBLANK="$H/control-post-eof-nonblank.txt"
printf 'before\n' > "$CONTROL_POST_EOF_NONBLANK"
printf -v PATCH '*** Begin Patch\n*** Update File: %s\n@@\n-before\n+after\n*** End of File\n context without a new hunk marker\n*** End Patch' \
  "$CONTROL_POST_EOF_NONBLANK"
assert_patch_blocked "$PATCH" "$H" "apply_patch nonblank body after End of File stays malformed"
if require_apply_patch "apply_patch nonblank body after End of File stays malformed"; then
  assert_real_patch_rejected "$PATCH" "$H" "apply_patch nonblank body after End of File stays malformed"
  assert_eq before "$(< "$CONTROL_POST_EOF_NONBLANK")" "apply_patch post-EOF nonblank rejection -> source unchanged"
fi

# Trailing U+0085 is legal Rust whitespace on every target-bearing control. Board rows are the
# security assertions used by the normalization-removal mutation: all four must flip to ALLOW if
# Rust-compatible control normalization is removed.
for KIND in Add Delete Update Move; do
  exercise_nel_header_patch_case "$KIND" non-board
  exercise_nel_header_patch_case "$KIND" board
done

# The installed parser removes embedded TAB/CR from its filesystem-effect path. Classification must
# use that narrowly normalized effect path; otherwise an apparent non-board spelling reaches a real
# `.board.json`. Do not generalize this to other control characters without effect evidence.
for KIND in Add Delete Update Move; do
  exercise_effect_obfuscated_target_case "$KIND" tab board
done
exercise_effect_obfuscated_target_case Add cr board
exercise_effect_obfuscated_target_case Add tab non-board
exercise_effect_obfuscated_target_case Add cr non-board

# Rootedness is classified from the raw target before Codex drops TAB/CR bytes for its filesystem
# effect. A target beginning TAB/CR followed by `/absolute-looking-board-path` is therefore relative
# and mutates an exact shadow below the patch cwd, never the absolute-looking board. Cover every
# target-bearing operation, including both sides of Move, and pin the patch cwd explicitly.
for SEPARATOR_NAME in tab cr; do
  exercise_leading_separator_shadow_case Add "$SEPARATOR_NAME" target
  exercise_leading_separator_shadow_case Delete "$SEPARATOR_NAME" source
  exercise_leading_separator_shadow_case Update "$SEPARATOR_NAME" source
  exercise_leading_separator_shadow_case Move "$SEPARATOR_NAME" source
  exercise_leading_separator_shadow_case Move "$SEPARATOR_NAME" destination
done

# The parser does not generalize this behavior to ordinary space. The header grammar consumes one
# required space after the colon; a second is the first byte of the relative target and is retained.
exercise_literal_leading_space_target_case

# Full top-level control matrix. Non-board rows use leading+trailing whitespace; board rows retain
# trailing whitespace so removing control normalization makes the captured path miss `.board.json`
# and is observably unsafe. Move/End-of-File live in Update state, where the installed parser accepts
# trailing whitespace but treats leading whitespace as hunk data (covered by the context fixture below).
for KIND in Add Delete Update Move; do
  exercise_control_whitespace_patch_case "$KIND" board trailing
  exercise_control_whitespace_patch_case "$KIND" board leading-and-trailing
  exercise_control_whitespace_patch_case "$KIND" non-board
done

# In Update hunk state, raw leading-space lines are context content even when trimming would make
# them look like file/move/EOF controls. A board path in those bytes is never target evidence.
HUNK_CONTEXT_TARGET="$H/control-looking-hunk-data.txt"
printf '%s\n' \
  "*** Update File: $H/boards/mine.board.json" \
  "*** Move to: $H/boards/mine.board.json" \
  '*** End of File' \
  'before' > "$HUNK_CONTEXT_TARGET"
BOARD_BEFORE="$(< "$H/boards/mine.board.json")"
PATCH="$(printf '%s\n' \
  '*** Begin Patch' \
  "*** Update File: $HUNK_CONTEXT_TARGET" \
  '@@' \
  " *** Update File: $H/boards/mine.board.json" \
  " *** Move to: $H/boards/mine.board.json" \
  ' *** End of File' \
  '-before' \
  '+after' \
  '*** End Patch')"
assert_patch_allowed "$PATCH" "$H" "apply_patch leading-space hunk controls stay data"
if require_apply_patch "apply_patch leading-space hunk controls stay data"; then
  assert_real_patch_applied "$PATCH" "$H" "apply_patch leading-space hunk controls stay data"
  assert_contains "$(< "$HUNK_CONTEXT_TARGET")" 'after' "apply_patch leading-space hunk controls -> real update effect"
  assert_eq "$BOARD_BEFORE" "$(< "$H/boards/mine.board.json")" "apply_patch leading-space hunk controls -> board unchanged"
fi

HUNK_CRLF_CONTEXT_TARGET="$H/control-looking-hunk-crlf.txt"
printf '%s\n' \
  "*** Update File: $H/boards/mine.board.json" \
  "*** Move to: $H/boards/mine.board.json" \
  '*** End of File' \
  'before' > "$HUNK_CRLF_CONTEXT_TARGET"
BOARD_BEFORE="$(< "$H/boards/mine.board.json")"
printf -v PATCH '*** Begin Patch\r\n*** Update File: %s\r\n@@\r\n *** Update File: %s\r\n *** Move to: %s\r\n *** End of File\r\n-before\r\n+after-crlf\r\n*** End Patch\r\n' \
  "$HUNK_CRLF_CONTEXT_TARGET" \
  "$H/boards/mine.board.json" \
  "$H/boards/mine.board.json"
assert_patch_allowed "$PATCH" "$H" "apply_patch CRLF leading-space hunk controls stay data"
if require_apply_patch "apply_patch CRLF leading-space hunk controls stay data"; then
  assert_real_patch_applied "$PATCH" "$H" "apply_patch CRLF leading-space hunk controls stay data"
  assert_contains "$(< "$HUNK_CRLF_CONTEXT_TARGET")" 'after-crlf' "apply_patch CRLF hunk controls -> real update effect"
  assert_eq "$BOARD_BEFORE" "$(< "$H/boards/mine.board.json")" "apply_patch CRLF hunk controls -> board unchanged"
fi

HUNK_NEL_MOVE_TARGET="$H/control-looking-hunk-nel.txt"
printf '%s\n' \
  "${NEL}*** Move to: $H/boards/mine.board.json" \
  'before' > "$HUNK_NEL_MOVE_TARGET"
BOARD_BEFORE="$(< "$H/boards/mine.board.json")"
printf -v PATCH '*** Begin Patch\n*** Update File: %s\n@@\n %s*** Move to: %s\n-before\n+after-nel\n*** End Patch' \
  "$HUNK_NEL_MOVE_TARGET" "$NEL" "$H/boards/mine.board.json"
assert_patch_allowed "$PATCH" "$H" "apply_patch NEL-leading Move text with hunk prefix stays data"
if require_apply_patch "apply_patch NEL-leading Move text with hunk prefix stays data"; then
  assert_real_patch_applied "$PATCH" "$H" "apply_patch NEL-leading Move text with hunk prefix stays data"
  assert_contains "$(< "$HUNK_NEL_MOVE_TARGET")" 'after-nel' "apply_patch NEL Move hunk data -> real update effect"
  assert_eq "$BOARD_BEFORE" "$(< "$H/boards/mine.board.json")" "apply_patch NEL Move hunk data -> board unchanged"
fi

HUNK_EMBEDDED_CR_TARGET="$H/hunk-embedded-cr.txt"
printf '%s\n' 'before' > "$HUNK_EMBEDDED_CR_TARGET"
printf -v PATCH '*** Begin Patch\n*** Update File: %s\n@@\n-before\n+al\rpha\n*** End Patch' "$HUNK_EMBEDDED_CR_TARGET"
assert_patch_allowed "$PATCH" "$H" "apply_patch embedded hunk CR non-board target"
if require_apply_patch "apply_patch embedded hunk CR non-board target"; then
  assert_real_patch_applied "$PATCH" "$H" "apply_patch embedded hunk CR non-board target"
  assert_contains "$(< "$HUNK_EMBEDDED_CR_TARGET")" $'al\rpha' "apply_patch embedded hunk CR -> real update effect"
fi

HUNK_EMBEDDED_CR_BOARD="$H/boards/hunk-embedded-cr.board.json"
printf '%s\n' 'before' > "$HUNK_EMBEDDED_CR_BOARD"
printf -v PATCH '*** Begin Patch\n*** Update File: %s\n@@\n-before\n+al\rpha\n*** End Patch' "$HUNK_EMBEDDED_CR_BOARD"
assert_patch_blocked "$PATCH" "$H" "apply_patch embedded hunk CR board target"
if require_apply_patch "apply_patch embedded hunk CR board target"; then
  assert_real_patch_applied "$PATCH" "$H" "apply_patch embedded hunk CR board target"
  assert_contains "$(< "$HUNK_EMBEDDED_CR_BOARD")" $'al\rpha' "apply_patch embedded hunk CR board -> real update effect"
fi

# Real-parser parity fixture for the current Codex control preamble. The installed parser accepts one
# non-empty Environment ID only between Begin Patch and the first file header. Every accepted
# Add/Delete/Update/Move form is run through both the armed guard and the installed parser; Update also
# proves a hunk-body board path is not target evidence.
for KIND in Add Delete Update Move; do
  exercise_environment_patch_case "$KIND" board
  exercise_environment_patch_case "$KIND" non-board
done

# Preserve the legal Environment ID near-neighbor set independently observed against 0.144.2.
exercise_environment_near_neighbor '*** Environment ID: remote' canonical
exercise_environment_near_neighbor '*** Environment ID:remote' no-space-after-colon
exercise_environment_near_neighbor $'*** Environment ID:\tremote' tab-after-colon
exercise_environment_near_neighbor ' *** Environment ID: remote' leading-space
exercise_environment_near_neighbor $'\t*** Environment ID: remote' leading-tab
exercise_environment_near_neighbor '*** Environment ID:  remote' double-space
exercise_environment_near_neighbor '*** Environment ID: remote ' trailing-space
exercise_environment_near_neighbor $'*** Environment ID: remote\t' trailing-tab
exercise_environment_near_neighbor "$(printf '*** Environment ID:\302\205remote\302\205')" rust-nel-padding

# The same directive is malformed when empty, repeated, or placed after the first file header. The
# installed parser rejects each shape and the armed guard must fail closed before any target allow.
PATCH="$(printf '%s\n' \
  '*** Begin Patch' \
  '*** Environment ID:   ' \
  "*** Add File: $H/environment-empty.txt" \
  '+body' \
  '*** End Patch')"
assert_patch_blocked "$PATCH" "$H" "apply_patch empty Environment ID"
assert_real_patch_rejected "$PATCH" "$H" "apply_patch empty Environment ID"

PATCH="$(printf '%s\n' \
  '*** Begin Patch' \
  "$(printf '*** Environment ID:\302\205')" \
  "*** Add File: $H/environment-rust-empty.txt" \
  '+body' \
  '*** End Patch')"
assert_patch_blocked "$PATCH" "$H" "apply_patch Rust-whitespace-only Environment ID"
assert_real_patch_rejected "$PATCH" "$H" "apply_patch Rust-whitespace-only Environment ID"

PATCH="$(printf '%s\n' \
  '*** Begin Patch' \
  '*** Environment ID: remote' \
  '*** Environment ID: second' \
  "*** Add File: $H/environment-duplicate.txt" \
  '+body' \
  '*** End Patch')"
assert_patch_blocked "$PATCH" "$H" "apply_patch duplicate Environment ID"
assert_real_patch_rejected "$PATCH" "$H" "apply_patch duplicate Environment ID"

PATCH="$(printf '%s\n' \
  '*** Begin Patch' \
  "*** Add File: $H/environment-late.txt" \
  '*** Environment ID: remote' \
  '+body' \
  '*** End Patch')"
assert_patch_blocked "$PATCH" "$H" "apply_patch late Environment ID"
assert_real_patch_rejected "$PATCH" "$H" "apply_patch late Environment ID"

# Direct board targets are blocked for absolute, relative, normalized-alias, space, and Unicode paths.
PATCH="*** Begin Patch
*** Update File: $H/boards/mine.board.json
@@
-{}
+{\"tasks\":[]}
*** End Patch"
assert_patch_blocked "$PATCH" "$H" "apply_patch absolute board target"

REL_BOARD="$(node -e 'process.stdout.write(require("path").relative(process.cwd(), process.argv[1]))' "$H/boards/mine.board.json")"
PATCH="*** Begin Patch
*** Update File: $REL_BOARD
@@
-{}
+{\"tasks\":[]}
*** End Patch"
assert_patch_blocked "$PATCH" "$H" "apply_patch relative board target"

PATCH="*** Begin Patch
*** Update File: $H/boards/../boards/mine.board.json
@@
-{}
+{\"tasks\":[]}
*** End Patch"
assert_patch_blocked "$PATCH" "$H" "apply_patch normalized board path alias"
rm -rf "$H"

H_BASE="$(make_project)"
H="$H_BASE/home with space 资料"
mkdir -p "$H"
seed_board "$H" "看板 one" "$GOOD"
PATCH="*** Begin Patch
*** Update File: $H/boards/看板 one.board.json
@@
-{}
+{\"tasks\":[]}
*** End Patch"
assert_patch_blocked "$PATCH" "$H" "apply_patch board target with spaces and Unicode"
rm -rf "$H_BASE"

# Add/Delete/Move and multi-file patches classify every declared source/destination, not hunk text.
H="$(make_project)"
seed_board "$H" "mine" "$GOOD"
PATCH="*** Begin Patch
*** Add File: $H/boards/new.board.json
+{}
*** End Patch"
assert_patch_blocked "$PATCH" "$H" "apply_patch Add File board target"

PATCH="*** Begin Patch
*** Delete File: $H/boards/mine.board.json
*** End Patch"
assert_patch_blocked "$PATCH" "$H" "apply_patch Delete File board target"

PATCH="*** Begin Patch
*** Update File: $REPO_ROOT/notes.txt
*** Move to: $H/boards/moved.board.json
@@
-old
+new
*** End Patch"
assert_patch_blocked "$PATCH" "$H" "apply_patch Move to board destination"

PATCH="*** Begin Patch
*** Update File: $REPO_ROOT/notes.txt
@@
-old
+new
*** Update File: $H/boards/mine.board.json
@@
-{}
+{\"tasks\":[]}
*** End Patch"
assert_patch_blocked "$PATCH" "$H" "apply_patch multi-file with board target"

PATCH="*** Begin Patch
*** Update File: $REPO_ROOT/notes.txt
@@
-$H/boards/mine.board.json
+\\.board\\.json
*** Add File: $REPO_ROOT/notes two.txt
+not a board target
*** End Patch"
assert_patch_allowed "$PATCH" "$H" "apply_patch multi-file non-board targets with board-looking body"

# Ambiguous/malformed patch structure is fail-closed while armed.
PATCH="*** Begin Patch
*** Update File: $REPO_ROOT/notes.txt
@@
-old
+new"
assert_patch_blocked "$PATCH" "$H" "apply_patch missing End Patch"

PATCH="*** Begin Patch
*** Rename File: $REPO_ROOT/notes.txt
*** End Patch"
assert_patch_blocked "$PATCH" "$H" "apply_patch unknown file header"

PATCH="*** Begin Patch
*** Move to: $H/boards/orphan.board.json
*** End Patch"
assert_patch_blocked "$PATCH" "$H" "apply_patch orphan Move to header"

# Body and marker failures below were each rejected (rc=1) by the real Codex 0.144.2 apply_patch
# parser. The guard must reject the same malformed grammar before target classification can allow it.
PATCH="*** Begin Patch
*** Add File: $REPO_ROOT/add-bad.txt
body without plus
*** End Patch"
assert_patch_blocked "$PATCH" "$H" "apply_patch Add body line without plus"

PATCH="*** Begin Patch
*** Add File: $REPO_ROOT/add-eof.txt
+body
*** End of File
*** End Patch"
assert_patch_blocked "$PATCH" "$H" "apply_patch End of File is invalid in Add section"

PATCH="*** Begin Patch
*** Delete File: $REPO_ROOT/delete-bad.txt
+unexpected body
*** End Patch"
assert_patch_blocked "$PATCH" "$H" "apply_patch Delete section may not have a body"

PATCH="*** Begin Patch
*** Delete File: $REPO_ROOT/delete-eof.txt
*** End of File
*** End Patch"
assert_patch_blocked "$PATCH" "$H" "apply_patch End of File is invalid in Delete section"

PATCH="*** Begin Patch
*** Update File: $REPO_ROOT/update-bad.txt
@@
unprefixed body
*** End Patch"
assert_patch_blocked "$PATCH" "$H" "apply_patch Update body line must use context/add/delete prefix"

PATCH="*** Begin Patch
*** Update File: $REPO_ROOT/update-eof-empty.txt
*** End of File
*** End Patch"
assert_patch_blocked "$PATCH" "$H" "apply_patch End of File cannot precede an Update hunk"

PATCH="*** Begin Patch
*** Update File: $REPO_ROOT/update-empty-hunk.txt
@@
*** End Patch"
assert_patch_blocked "$PATCH" "$H" "apply_patch Update context marker requires hunk lines"

PATCH="*** Begin Patch
*** Update File: $REPO_ROOT/update-eof-body.txt
@@
-old
+new
*** End of File
 context without a new hunk marker
*** End Patch"
assert_patch_blocked "$PATCH" "$H" "apply_patch body after End of File requires a new context marker"
rm -rf "$H"

# Structured tool path aliases are evaluated as one target set: any board target, a conflicting
# multi-alias target, or an invalid multi-alias payload is denied. One valid alias remains compatible.
H="$(make_project)"
seed_board "$H" "mine" "$GOOD"
for KEY in file_path path filename; do
  INPUT="$(node -e 'process.stdout.write(JSON.stringify({[process.argv[1]]:process.argv[2]}))' "$KEY" "$H/boards/mine.board.json")"
  PAYLOAD="$(json_structured_payload "sess-x" "Edit" "$INPUT")"
  run_pretool "$PAYLOAD" "$H"
  assert_contains "$HOOK_OUT" '"decision":"block"' "Edit $KEY alias board write -> block"

  INPUT="$(node -e 'process.stdout.write(JSON.stringify({[process.argv[1]]:process.argv[2]}))' "$KEY" "$H/notes.txt")"
  PAYLOAD="$(json_structured_payload "sess-x" "Edit" "$INPUT")"
  run_pretool "$PAYLOAD" "$H"
  assert_eq "" "$HOOK_OUT" "Edit single legal $KEY non-board alias -> allow"
done

INPUT="$(node -e 'process.stdout.write(JSON.stringify({file_path:process.argv[1],path:process.argv[2]}))' "$H/notes.txt" "$H/boards/mine.board.json")"
run_pretool "$(json_structured_payload "sess-x" "Edit" "$INPUT")" "$H"
assert_contains "$HOOK_OUT" '"decision":"block"' "Edit aliases with any board target -> block"

INPUT="$(node -e 'process.stdout.write(JSON.stringify({file_path:process.argv[1],filename:process.argv[2]}))' "$H/notes.txt" "$H/other.txt")"
run_pretool "$(json_structured_payload "sess-x" "Edit" "$INPUT")" "$H"
assert_contains "$HOOK_OUT" '"decision":"block"' "Edit conflicting valid non-board aliases -> fail closed"

INPUT="$(node -e 'process.stdout.write(JSON.stringify({file_path:[],path:process.argv[1]}))' "$H/notes.txt")"
run_pretool "$(json_structured_payload "sess-x" "Edit" "$INPUT")" "$H"
assert_contains "$HOOK_OUT" '"decision":"block"' "Edit invalid multi-alias payload -> fail closed"

INPUT="$(node -e 'process.stdout.write(JSON.stringify({file_path:process.argv[1],path:process.argv[2],filename:process.argv[1]}))' "$H/notes.txt" "$H/../$(basename "$H")/notes.txt")"
run_pretool "$(json_structured_payload "sess-x" "Edit" "$INPUT")" "$H"
assert_eq "" "$HOOK_OUT" "Edit equivalent normalized aliases -> allow"

# Existing shell write forms remain denied.
run_pretool "$(json_bash_payload "sess-x" "printf '{}' | tee $H/boards/mine.board.json")" "$H"
assert_contains "$HOOK_OUT" '"decision":"block"' "Bash tee board write -> block"
run_pretool "$(json_bash_payload "sess-x" "cp $REPO_ROOT/notes.txt $H/boards/mine.board.json")" "$H"
assert_contains "$HOOK_OUT" '"decision":"block"' "Bash cp board write -> block"
run_pretool "$(json_bash_payload "sess-x" "mv $REPO_ROOT/notes.txt $H/boards/mine.board.json")" "$H"
assert_contains "$HOOK_OUT" '"decision":"block"' "Bash mv board write -> block"
rm -rf "$H"

# Other session: dormant.
H="$(make_project)"
seed_board "$H" "other" '{"schema":"cc-master/v2","goal":"g","owner":{"active":true,"session_id":"sess-other"},"tasks":[{"id":"T0","status":"ready","deps":[]}]}'
run_pretool "$(json_write_payload "sess-mine" "Write" "$H/boards/other.board.json")" "$H"
assert_eq "" "$HOOK_OUT" "other session board -> dormant"
rm -rf "$H"

finish
