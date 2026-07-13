#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

CC_MASTER_INSTALL_SH_TEST_SOURCE=1 source ./install.sh

pass() { printf 'ok - %s\n' "$*"; }
fail() { printf 'not ok - %s\n' "$*" >&2; exit 1; }

json_get() {
  node -e '
    const fs = require("node:fs");
    const [file, dotted] = process.argv.slice(1);
    const lines = fs.readFileSync(file, "utf8").trim().split(/\n/).filter(Boolean);
    let value = JSON.parse(lines.at(-1));
    for (const key of dotted.split(".")) value = value?.[key];
    if (value === undefined || value === null) process.exit(4);
    process.stdout.write(typeof value === "object" ? JSON.stringify(value) : String(value));
  ' "$1" "$2"
}

asset="$tmp/asset.bin"
manifest="$tmp/SHA256SUMS"
printf 'release asset payload\n' >"$asset"
good_hash="$(sha256_file "$asset")"
printf '%s  asset.bin\n' "$good_hash" >"$manifest"

verify_sha256_manifest "$asset" "$manifest"
pass "valid SHA256SUMS entry verifies"

installed_name="$tmp/ccm"
cp "$asset" "$installed_name"
asset_named_manifest="$tmp/SHA256SUMS.asset-name"
printf '%s  ccm-linux-x64\n' "$good_hash" >"$asset_named_manifest"
verify_sha256_manifest "$installed_name" "$asset_named_manifest" "ccm-linux-x64"
pass "release asset name can differ from installed temp filename"

CCM_VERSION="0.14.0"
[ "$(resolve_ccm_tag)" = "ccm-v0.14.0" ] || fail "bare ccm semver should normalize to ccm-v tag"
CCM_VERSION="v0.14.0"
[ "$(resolve_ccm_tag)" = "ccm-v0.14.0" ] || fail "v-prefixed ccm semver should normalize to ccm-v tag"
CCM_VERSION="ccm-v0.14.0"
[ "$(resolve_ccm_tag)" = "ccm-v0.14.0" ] || fail "ccm-v tag should remain unchanged"
CCM_VERSION=""
PLUGIN_VERSION="0.13.0"
[ "$(resolve_plugin_tag)" = "v0.13.0" ] || fail "bare plugin semver should normalize to v tag"
PLUGIN_VERSION="v0.13.0"
[ "$(resolve_plugin_tag)" = "v0.13.0" ] || fail "plugin v tag should remain unchanged"
PLUGIN_VERSION=""
pass "explicit version inputs normalize to release tag names"

bad_manifest="$tmp/SHA256SUMS.bad"
printf '%064d  asset.bin\n' 0 >"$bad_manifest"
if ( verify_sha256_manifest "$asset" "$bad_manifest" ) >/dev/null 2>"$tmp/bad.err"; then
  fail "checksum mismatch should fail closed"
fi
grep -q "checksum 校验失败" "$tmp/bad.err" || fail "checksum mismatch explains failure"
pass "checksum mismatch fails closed"

missing_manifest="$tmp/SHA256SUMS.missing"
printf '%s  other.bin\n' "$good_hash" >"$missing_manifest"
if ( verify_sha256_manifest "$asset" "$missing_manifest" ) >/dev/null 2>"$tmp/missing.err"; then
  fail "manifest without asset entry should fail closed"
fi
grep -q "找不到 asset.bin" "$tmp/missing.err" || fail "missing manifest entry explains failure"
pass "missing asset entry fails closed"

LOCAL_SRC="$tmp/local-no-manifest"
mkdir -p "$LOCAL_SRC"
verify_downloaded_release_asset "local" "asset.bin" "$asset" "$tmp/unused-manifest"
pass "CC_MASTER_INSTALL_LOCAL without SHA256SUMS remains usable with explicit warning"

LOCAL_SRC="$tmp/local-bad-manifest"
mkdir -p "$LOCAL_SRC"
cp "$bad_manifest" "$LOCAL_SRC/SHA256SUMS"
if ( verify_downloaded_release_asset "local" "asset.bin" "$asset" "$tmp/unused-manifest" ) >/dev/null 2>"$tmp/local-bad.err"; then
  fail "CC_MASTER_INSTALL_LOCAL with bad SHA256SUMS should fail closed"
fi
grep -q "checksum 校验失败" "$tmp/local-bad.err" || fail "local bad checksum explains failure"
pass "CC_MASTER_INSTALL_LOCAL verifies SHA256SUMS when present"

no_node_bin="$tmp/no-node-bin"
mkdir -p "$no_node_bin"
for required in bash uname unzip chmod; do
  ln -s "$(command -v "$required")" "$no_node_bin/$required"
done
if HOME="$tmp/no-node-home" \
   PATH="$no_node_bin" \
   CC_MASTER_INSTALL_LOCAL="$tmp/local-no-node" \
     "$no_node_bin/bash" ./install.sh --ccm-version ccm-v9.9.9 --plugin-version v9.9.9 --harness cursor \
     >"$tmp/no-node.out" 2>"$tmp/no-node.err"; then
  fail "installer must fail loudly when the unconditional Node.js prerequisite is absent"
fi
grep -q '缺少必需命令：node' "$tmp/no-node.err" \
  || fail "no-Node failure must name the unconditional prerequisite"
old_node_bin="$tmp/old-node-bin"
cp -R "$no_node_bin" "$old_node_bin"
cat >"$old_node_bin/node" <<'EOF'
#!/usr/bin/env sh
exit 1
EOF
chmod 755 "$old_node_bin/node"
if HOME="$tmp/old-node-home" \
   PATH="$old_node_bin" \
   CC_MASTER_INSTALL_LOCAL="$tmp/local-old-node" \
     "$old_node_bin/bash" ./install.sh --ccm-version ccm-v9.9.9 --plugin-version v9.9.9 --harness cursor \
     >"$tmp/old-node.out" 2>"$tmp/old-node.err"; then
  fail "installer must reject a Node.js runtime below the supported contract"
fi
grep -q '需要 Node.js 22 或更高版本' "$tmp/old-node.err" \
  || fail "old-Node failure must name the Node.js 22+ contract"
"$no_node_bin/bash" ./install.sh --help >"$tmp/install-help.out" 2>"$tmp/install-help.err"
grep -q 'Node.js 22+（联网、pin 和本地离线模式都必需）' "$tmp/install-help.err" \
  || fail "installer help must disclose the unconditional Node.js prerequisite"
pass "no-Node contract fails loudly and installer help discloses the prerequisite"

# Transactional publication is the installer safety boundary: candidates may come from a
# different filesystem, but activation must happen from a target-adjacent stage and every
# injected failure must leave the last-known-good artifact runnable.
make_ccm_fixture() {
  local path="$1" label="$2"
  cat >"$path" <<EOF
#!/usr/bin/env sh
if [ "\${1:-}" != "--version" ]; then
  printf '%s\n' 'expected exactly --version' >&2
  exit 64
fi
printf '%s\n' "$label"
EOF
  chmod 755 "$path"
}

assert_old_binary_survives() {
  local target="$1"
  [ -x "$target" ] || fail "old binary must remain executable"
  [ "$("$target" --version)" = "old-ccm" ] || fail "old binary payload must survive"
}

binary_root="$tmp/target fs/二进制"
mkdir -p "$binary_root/source"
binary_target="$binary_root/ccm"
binary_new="$tmp/new ccm"
make_ccm_fixture "$binary_target" "old-ccm"
make_ccm_fixture "$binary_new" "new-ccm"

if "$binary_new" >"$tmp/fixture-no-argv.out" 2>"$tmp/fixture-no-argv.err"; then
  fail "binary fixture must reject a missing --version argument"
fi
if "$binary_new" --wrong >"$tmp/fixture-wrong-argv.out" 2>"$tmp/fixture-wrong-argv.err"; then
  fail "binary fixture must reject a wrong validation argument"
fi
[ "$("$binary_new" --version)" = "new-ccm" ] || fail "binary fixture must accept exactly --version"
pass "binary fixture enforces the real --version argv contract"

for fault in copy checksum exec rename exdev activation; do
  if CC_MASTER_PUBLISH_FAULT="$fault" transactional_publish binary "$binary_new" "$binary_target" \
      >"$tmp/binary-$fault.out" 2>"$tmp/binary-$fault.err"; then
    fail "binary $fault fault must return nonzero"
  fi
  assert_old_binary_survives "$binary_target"
  grep -Eq '"ok":false.*"phase":"[^\"]+".*"code":"[^\"]+"' \
    "$tmp/binary-$fault.err" || fail "binary $fault failure must emit structured state"
  [ "$(json_get "$tmp/binary-$fault.err" endpoint_ok)" = "true" ] \
    || fail "binary $fault must verify the restored/unchanged endpoint"
  [ "$(json_get "$tmp/binary-$fault.err" action)" = "preserved-last-known-good" ] \
    || fail "binary $fault may claim preservation only after endpoint verification"
done
pass "binary fault matrix preserves last-known-good executable with structured failure"

transactional_publish binary "$binary_new" "$binary_target" >"$tmp/binary-success.json"
[ "$("$binary_target" --version)" = "new-ccm" ] || fail "successful binary publication activates candidate"
[ "$(stat -c '%a' "$binary_target" 2>/dev/null || stat -f '%Lp' "$binary_target")" = "755" ] \
  || fail "published binary mode must be 0755"
[ "$(stat -c '%u' "$binary_target" 2>/dev/null || stat -f '%u' "$binary_target")" = "$(id -u)" ] \
  || fail "published binary must be owned by the publisher"
grep -q '"ok":true' "$tmp/binary-success.json" || fail "binary success must emit structured state"
pass "binary publish succeeds after injected failures and preserves executable mode"

binary_link_real="$tmp/binary link real"
binary_link_target="$tmp/binary link target"
make_ccm_fixture "$binary_link_real" "old-ccm"
ln -s "$binary_link_real" "$binary_link_target"
if transactional_publish binary "$binary_new" "$binary_link_target" \
    >"$tmp/binary-link.out" 2>"$tmp/binary-link.err"; then
  fail "binary symlink target must be rejected instead of escaping the declared install path"
fi
[ -L "$binary_link_target" ] || fail "rejected binary target symlink must be preserved"
[ "$("$binary_link_target" --version)" = "old-ccm" ] || fail "binary symlink policy must preserve old executable"
grep -q '"code":"TARGET_TYPE"' "$tmp/binary-link.err" || fail "binary symlink rejection must be structured"
pass "binary target symlink policy is explicit and fail-closed"

for link_shape in dangling-relative dangling-absolute; do
  dangling_root="$tmp/$link_shape"
  dangling_target="$dangling_root/ccm"
  mkdir -p "$dangling_root"
  if [ "$link_shape" = "dangling-relative" ]; then
    dangling_link="missing-real-ccm"
  else
    dangling_link="$tmp/missing absolute ccm"
  fi
  ln -s "$dangling_link" "$dangling_target"
  if transactional_publish binary "$binary_new" "$dangling_target" \
      >"$tmp/$link_shape.out" 2>"$tmp/$link_shape.err"; then
    fail "$link_shape binary target symlink must fail closed"
  fi
  [ -L "$dangling_target" ] || fail "$link_shape target link itself must be preserved"
  [ "$(readlink "$dangling_target")" = "$dangling_link" ] \
    || fail "$link_shape target link payload must be unchanged"
  grep -q '"code":"TARGET_TYPE"' "$tmp/$link_shape.err" \
    || fail "$link_shape rejection must emit TARGET_TYPE"
done

dangling_real_parent="$tmp/dangling real parent"
dangling_linked_parent="$tmp/dangling linked parent"
mkdir -p "$dangling_real_parent"
ln -s "$dangling_real_parent" "$dangling_linked_parent"
ln -s "missing-through-parent" "$dangling_real_parent/ccm"
if transactional_publish binary "$binary_new" "$dangling_linked_parent/ccm" \
    >"$tmp/dangling-parent.out" 2>"$tmp/dangling-parent.err"; then
  fail "dangling binary target below a symlinked parent must fail closed"
fi
[ -L "$dangling_real_parent/ccm" ] || fail "symlinked-parent target link must be preserved"
[ "$(readlink "$dangling_real_parent/ccm")" = "missing-through-parent" ] \
  || fail "symlinked-parent target link payload must be unchanged"
grep -q '"code":"TARGET_TYPE"' "$tmp/dangling-parent.err" \
  || fail "symlinked-parent dangling rejection must emit TARGET_TYPE"
pass "live and dangling binary target symlinks fail closed without replacing the link"

for fault_case in "activation,rollback" "cleanup" "activation,rollback,cleanup"; do
  fault_slug="${fault_case//,/-}"
  recovery_root="$tmp/binary recovery/$fault_slug"
  recovery_target="$recovery_root/ccm"
  recovery_new="$recovery_root/new-ccm"
  mkdir -p "$recovery_root"
  make_ccm_fixture "$recovery_target" "old-ccm"
  make_ccm_fixture "$recovery_new" "new-ccm"
  if CC_MASTER_PUBLISH_FAULT="$fault_case" transactional_publish binary "$recovery_new" "$recovery_target" \
      >"$tmp/binary-$fault_slug.out" 2>"$tmp/binary-$fault_slug.err"; then
    fail "binary $fault_case mutation must return nonzero"
  fi
  [ "$("$recovery_target" --version)" = "new-ccm" ] \
    || fail "binary $fault_case must leave a verified active endpoint"
  binary_recovery_backup="$(json_get "$tmp/binary-$fault_slug.err" recovery_paths.binary_backup)" \
    || fail "binary $fault_case must report a recovery backup"
  [ -x "$binary_recovery_backup" ] || fail "binary $fault_case must retain executable old backup"
  [ "$("$binary_recovery_backup" --version)" = "old-ccm" ] \
    || fail "binary $fault_case recovery backup must remain the old binary"
  [ "$(json_get "$tmp/binary-$fault_slug.err" endpoint_ok)" = "true" ] \
    || fail "binary $fault_case must verify the final endpoint before reporting state"
  grep -Eq '"action":"(recovery-required|published-recovery-required)"' \
    "$tmp/binary-$fault_slug.err" || fail "binary $fault_case must not claim preserved-last-known-good"
done
[ "$(json_get "$tmp/binary-activation-rollback-cleanup.err" rollback_ok)" = "false" ] \
  || fail "binary rollback mutation must report rollback failure"
[ "$(json_get "$tmp/binary-activation-rollback-cleanup.err" rollback_error_code)" = "EIO" ] \
  || fail "binary rollback-rename mutation must expose its EIO code"
[ "$(json_get "$tmp/binary-activation-rollback-cleanup.err" cleanup_attempted)" = "false" ] \
  || fail "binary cleanup must be skipped after rollback failure"
[ "$(json_get "$tmp/binary-cleanup.err" cleanup_error_code)" = "EIO" ] \
  || fail "binary cleanup mutation must expose its EIO code"
pass "binary rollback/cleanup mutations retain old recovery material and verify the active endpoint"

binary_barrier_root="$tmp/binary recovery/barriers"
binary_barrier_target="$binary_barrier_root/ccm"
binary_barrier_new="$binary_barrier_root/new-ccm"
mkdir -p "$binary_barrier_root"
make_ccm_fixture "$binary_barrier_target" "old-ccm"
make_ccm_fixture "$binary_barrier_new" "new-ccm"
if CC_MASTER_PUBLISH_FAULT=backup-barrier transactional_publish binary \
    "$binary_barrier_new" "$binary_barrier_target" \
    >"$tmp/binary-backup-barrier.out" 2>"$tmp/binary-backup-barrier.err"; then
  fail "binary backup durability barrier mutation must return nonzero"
fi
[ "$("$binary_barrier_target" --version)" = "old-ccm" ] \
  || fail "binary backup barrier failure must preserve the old active endpoint"
binary_barrier_backup="$(json_get "$tmp/binary-backup-barrier.err" recovery_paths.binary_backup)" \
  || fail "binary backup barrier failure must report the retained backup"
[ "$("$binary_barrier_backup" --version)" = "old-ccm" ] \
  || fail "binary backup barrier failure must retain the old recovery inode"
[ "$(json_get "$tmp/binary-backup-barrier.err" cleanup_attempted)" = "false" ] \
  || fail "binary backup barrier failure must skip cleanup"
[ "$(json_get "$tmp/binary-backup-barrier.err" action)" = "recovery-required" ] \
  || fail "binary backup barrier failure must require recovery"
[ "$(json_get "$tmp/binary-backup-barrier.err" durability_barrier)" = "backup-barrier" ] \
  || fail "binary backup barrier failure must name the failed durability boundary"

make_ccm_fixture "$binary_barrier_target" "old-ccm"
if CC_MASTER_PUBLISH_FAULT=activation,rollback-barrier transactional_publish binary \
    "$binary_barrier_new" "$binary_barrier_target" \
    >"$tmp/binary-rollback-barrier.out" 2>"$tmp/binary-rollback-barrier.err"; then
  fail "binary rollback durability barrier mutation must return nonzero"
fi
[ "$("$binary_barrier_target" --version)" = "old-ccm" ] \
  || fail "binary rollback barrier failure must leave the restored endpoint runnable"
binary_failed_candidate="$(json_get "$tmp/binary-rollback-barrier.err" recovery_paths.failed_candidate)" \
  || fail "binary rollback barrier failure must retain the displaced candidate"
[ "$("$binary_failed_candidate" --version)" = "new-ccm" ] \
  || fail "binary rollback barrier failure must retain the displaced new binary"
[ "$(json_get "$tmp/binary-rollback-barrier.err" rollback_ok)" = "false" ] \
  || fail "binary rollback barrier failure must not claim a durable rollback"
[ "$(json_get "$tmp/binary-rollback-barrier.err" rollback_error_code)" = "EIO" ] \
  || fail "binary rollback barrier failure must expose EIO"
[ "$(json_get "$tmp/binary-rollback-barrier.err" cleanup_attempted)" = "false" ] \
  || fail "binary rollback barrier failure must skip cleanup"
[ "$(json_get "$tmp/binary-rollback-barrier.err" action)" = "recovery-required" ] \
  || fail "binary rollback barrier failure must require recovery"
[ "$(json_get "$tmp/binary-rollback-barrier.err" durability_barrier)" = "rollback-barrier" ] \
  || fail "binary rollback barrier failure must name the failed durability boundary"
pass "binary recovery-name and rollback directory barriers fail closed with both versions retained"

make_plugin_fixture() {
  local root="$1" host="$2" label="$3" manifest
  case "$host" in
    claude-code) manifest=".claude-plugin/marketplace.json" ;;
    codex) manifest=".codex-plugin/plugin.json" ;;
    cursor) manifest=".cursor-plugin/plugin.json" ;;
    *) fail "unknown fixture host $host" ;;
  esac
  mkdir -p "$root/$(dirname "$manifest")" "$root/bin" "$root/assets"
  printf '{"name":"cc-master","fixture":"%s"}\n' "$label" >"$root/$manifest"
  printf '#!/usr/bin/env sh\nprintf "%%s\\n" "%s"\n' "$label" >"$root/bin/probe"
  chmod 755 "$root/bin/probe"
  printf '%s\n' "$label" >"$root/assets/payload"
  ln -s "payload" "$root/assets/current"
}

for host in claude-code codex cursor; do
  plugin_parent="$tmp/plugin targets/$host/含 空格"
  plugin_target="$plugin_parent/cc-master"
  plugin_new="$tmp/plugin candidates/$host/new"
  mkdir -p "$plugin_parent" "$(dirname "$plugin_new")"
  make_plugin_fixture "$plugin_target" "$host" "old-$host"
  make_plugin_fixture "$plugin_new" "$host" "new-$host"

  for fault in copy checksum rename exdev activation; do
    if CC_MASTER_PUBLISH_FAULT="$fault" transactional_publish "plugin:$host" "$plugin_new" "$plugin_target" \
        >"$tmp/plugin-$host-$fault.out" 2>"$tmp/plugin-$host-$fault.err"; then
      fail "$host plugin $fault fault must return nonzero"
    fi
    [ -x "$plugin_target/bin/probe" ] || fail "$host old plugin probe must remain executable"
    [ "$("$plugin_target/bin/probe")" = "old-$host" ] || fail "$host old plugin must survive $fault"
    grep -Eq '"ok":false.*"phase":"[^\"]+".*"code":"[^\"]+"' \
      "$tmp/plugin-$host-$fault.err" || fail "$host $fault failure must emit structured state"
    [ "$(json_get "$tmp/plugin-$host-$fault.err" endpoint_ok)" = "true" ] \
      || fail "$host $fault must verify the restored/unchanged plugin pointer"
    [ "$(json_get "$tmp/plugin-$host-$fault.err" action)" = "preserved-last-known-good" ] \
      || fail "$host $fault may claim preservation only after pointer verification"
  done

  transactional_publish "plugin:$host" "$plugin_new" "$plugin_target" >"$tmp/plugin-$host-success.json"
  [ "$("$plugin_target/bin/probe")" = "new-$host" ] || fail "$host plugin candidate must activate"
  [ -L "$plugin_target" ] || fail "$host active plugin must be an atomic version pointer"
  [ -L "$plugin_target/assets/current" ] || fail "$host internal symlink must be preserved"
  [ "$(cat "$plugin_target/assets/current")" = "new-$host" ] || fail "$host symlink target must stay relative"
  [ "$(stat -c '%a' "$plugin_target/bin/probe" 2>/dev/null || stat -f '%Lp' "$plugin_target/bin/probe")" = "755" ] \
    || fail "$host plugin executable mode must be preserved"
  [ "$(stat -c '%u' "$plugin_target/bin/probe" 2>/dev/null || stat -f '%u' "$plugin_target/bin/probe")" = "$(id -u)" ] \
    || fail "$host plugin tree must be owned by the publisher"
done
pass "all host plugin trees use recoverable atomic pointers and preserve modes/symlinks"

for host in claude-code codex cursor; do
  for fault_case in "cleanup" "activation,rollback,cleanup"; do
    fault_slug="${fault_case//,/-}"
    recovery_parent="$tmp/plugin recovery/$host/$fault_slug"
    recovery_target="$recovery_parent/cc-master"
    recovery_old="$recovery_parent/old-source"
    recovery_new="$recovery_parent/new-source"
    mkdir -p "$recovery_parent"
    make_plugin_fixture "$recovery_old" "$host" "old-$host"
    make_plugin_fixture "$recovery_new" "$host" "new-$host"
    transactional_publish "plugin:$host" "$recovery_old" "$recovery_target" \
      >"$tmp/plugin-$host-$fault_slug-initial.json"
    if CC_MASTER_PUBLISH_FAULT="$fault_case" transactional_publish "plugin:$host" "$recovery_new" "$recovery_target" \
        >"$tmp/plugin-$host-$fault_slug.out" 2>"$tmp/plugin-$host-$fault_slug.err"; then
      fail "$host plugin $fault_case mutation must return nonzero"
    fi
    [ -L "$recovery_target" ] || fail "$host $fault_case must retain an active pointer"
    [ "$("$recovery_target/bin/probe")" = "new-$host" ] \
      || fail "$host $fault_case must leave a verified new plugin endpoint"
    previous_endpoint="$(json_get "$tmp/plugin-$host-$fault_slug.err" recovery_paths.previous_endpoint)" \
      || fail "$host $fault_case must report the previous plugin version"
    published_version="$(json_get "$tmp/plugin-$host-$fault_slug.err" recovery_paths.published_version)" \
      || fail "$host $fault_case must report the current published version"
    [ -x "$previous_endpoint/bin/probe" ] || fail "$host $fault_case must retain runnable previous plugin"
    [ "$("$previous_endpoint/bin/probe")" = "old-$host" ] \
      || fail "$host $fault_case previous plugin must retain old payload"
    [ -x "$published_version/bin/probe" ] || fail "$host $fault_case must not delete current plugin version"
    [ "$("$published_version/bin/probe")" = "new-$host" ] \
      || fail "$host $fault_case published plugin must retain new payload"
    [ "$(json_get "$tmp/plugin-$host-$fault_slug.err" endpoint_ok)" = "true" ] \
      || fail "$host $fault_case must verify the final pointer before reporting state"
    grep -Eq '"action":"(recovery-required|published-recovery-required)"' \
      "$tmp/plugin-$host-$fault_slug.err" || fail "$host $fault_case must not claim preserved-last-known-good"
  done
  [ "$(json_get "$tmp/plugin-$host-activation-rollback-cleanup.err" rollback_ok)" = "false" ] \
    || fail "$host rollback mutation must report rollback failure"
  [ "$(json_get "$tmp/plugin-$host-activation-rollback-cleanup.err" rollback_error_code)" = "EIO" ] \
    || fail "$host rollback-rename mutation must expose its EIO code"
  [ "$(json_get "$tmp/plugin-$host-activation-rollback-cleanup.err" cleanup_attempted)" = "false" ] \
    || fail "$host cleanup must be skipped after rollback failure"
  [ "$(json_get "$tmp/plugin-$host-cleanup.err" cleanup_error_code)" = "EIO" ] \
    || fail "$host cleanup mutation must expose its EIO code"
done
pass "all host plugin rollback/cleanup mutations keep current pointers and previous versions runnable"

for host in claude-code codex cursor; do
  pointer_barrier_parent="$tmp/plugin rollback barrier/$host"
  pointer_barrier_target="$pointer_barrier_parent/cc-master"
  pointer_barrier_old="$pointer_barrier_parent/old-source"
  pointer_barrier_new="$pointer_barrier_parent/new-source"
  mkdir -p "$pointer_barrier_parent"
  make_plugin_fixture "$pointer_barrier_old" "$host" "old-$host"
  make_plugin_fixture "$pointer_barrier_new" "$host" "new-$host"
  transactional_publish "plugin:$host" "$pointer_barrier_old" "$pointer_barrier_target" \
    >"$tmp/plugin-$host-rollback-barrier-initial.json"
  if CC_MASTER_PUBLISH_FAULT=activation,rollback-barrier transactional_publish "plugin:$host" \
      "$pointer_barrier_new" "$pointer_barrier_target" \
      >"$tmp/plugin-$host-rollback-barrier.out" 2>"$tmp/plugin-$host-rollback-barrier.err"; then
    fail "$host pointer rollback durability barrier mutation must return nonzero"
  fi
  [ -L "$pointer_barrier_target" ] || fail "$host rollback barrier must retain an active pointer"
  [ "$("$pointer_barrier_target/bin/probe")" = "old-$host" ] \
    || fail "$host rollback barrier must leave the restored pointer runnable"
  pointer_published="$(json_get "$tmp/plugin-$host-rollback-barrier.err" recovery_paths.published_version)" \
    || fail "$host rollback barrier must report the retained new version"
  [ "$("$pointer_published/bin/probe")" = "new-$host" ] \
    || fail "$host rollback barrier must retain the new version for recovery"
  [ "$(json_get "$tmp/plugin-$host-rollback-barrier.err" rollback_ok)" = "false" ] \
    || fail "$host rollback barrier must not claim a durable rollback"
  [ "$(json_get "$tmp/plugin-$host-rollback-barrier.err" cleanup_attempted)" = "false" ] \
    || fail "$host rollback barrier failure must skip cleanup"
  [ "$(json_get "$tmp/plugin-$host-rollback-barrier.err" action)" = "recovery-required" ] \
    || fail "$host rollback barrier failure must require recovery"
  [ "$(json_get "$tmp/plugin-$host-rollback-barrier.err" durability_barrier)" = "rollback-barrier" ] \
    || fail "$host rollback barrier failure must name the failed durability boundary"
done
pass "all three host pointer rollbacks require a parent-directory durability barrier before cleanup"

legacy_barrier_parent="$tmp/plugin legacy barriers/cursor"
legacy_barrier_target="$legacy_barrier_parent/cc-master"
legacy_barrier_new="$legacy_barrier_parent/new-source"
mkdir -p "$legacy_barrier_parent"
make_plugin_fixture "$legacy_barrier_target" cursor "old-cursor"
make_plugin_fixture "$legacy_barrier_new" cursor "new-cursor"
if CC_MASTER_PUBLISH_FAULT=backup-barrier transactional_publish plugin:cursor \
    "$legacy_barrier_new" "$legacy_barrier_target" \
    >"$tmp/plugin-legacy-backup-barrier.out" 2>"$tmp/plugin-legacy-backup-barrier.err"; then
  fail "legacy plugin backup durability barrier mutation must return nonzero"
fi
[ -d "$legacy_barrier_target" ] && [ ! -L "$legacy_barrier_target" ] \
  || fail "legacy backup barrier failure must restore the real-directory endpoint"
[ "$("$legacy_barrier_target/bin/probe")" = "old-cursor" ] \
  || fail "legacy backup barrier failure must restore the old plugin"
legacy_published="$(json_get "$tmp/plugin-legacy-backup-barrier.err" recovery_paths.published_version)" \
  || fail "legacy backup barrier failure must retain the published candidate"
[ "$("$legacy_published/bin/probe")" = "new-cursor" ] \
  || fail "legacy backup barrier failure must retain the new plugin candidate"
[ "$(json_get "$tmp/plugin-legacy-backup-barrier.err" cleanup_attempted)" = "false" ] \
  || fail "legacy backup barrier failure must skip cleanup"
[ "$(json_get "$tmp/plugin-legacy-backup-barrier.err" action)" = "recovery-required" ] \
  || fail "legacy backup barrier failure must require recovery"

rm -rf "$legacy_barrier_target" "$legacy_barrier_new"
make_plugin_fixture "$legacy_barrier_target" cursor "old-cursor"
make_plugin_fixture "$legacy_barrier_new" cursor "new-cursor"
if CC_MASTER_PUBLISH_FAULT=activation,rollback-barrier transactional_publish plugin:cursor \
    "$legacy_barrier_new" "$legacy_barrier_target" \
    >"$tmp/plugin-legacy-rollback-barrier.out" 2>"$tmp/plugin-legacy-rollback-barrier.err"; then
  fail "legacy plugin rollback durability barrier mutation must return nonzero"
fi
[ "$("$legacy_barrier_target/bin/probe")" = "old-cursor" ] \
  || fail "legacy rollback barrier failure must leave the restored endpoint runnable"
legacy_rollback_published="$(json_get "$tmp/plugin-legacy-rollback-barrier.err" recovery_paths.published_version)" \
  || fail "legacy rollback barrier failure must report the retained published version"
[ "$("$legacy_rollback_published/bin/probe")" = "new-cursor" ] \
  || fail "legacy rollback barrier failure must retain the new plugin version"
[ "$(json_get "$tmp/plugin-legacy-rollback-barrier.err" rollback_ok)" = "false" ] \
  || fail "legacy rollback barrier failure must not claim a durable rollback"
[ "$(json_get "$tmp/plugin-legacy-rollback-barrier.err" cleanup_attempted)" = "false" ] \
  || fail "legacy rollback barrier failure must skip cleanup"
pass "legacy plugin recovery-name and rollback barriers retain resolvable old and new trees"

# A symlinked target parent is a supported path shape; publication must resolve the parent
# filesystem for staging without replacing the symlink itself.
real_parent="$tmp/real plugin parent"
linked_parent="$tmp/linked-plugin-parent"
mkdir -p "$real_parent"
ln -s "$real_parent" "$linked_parent"
linked_new="$tmp/linked candidate"
make_plugin_fixture "$linked_new" cursor "linked-new"
transactional_publish "plugin:cursor" "$linked_new" "$linked_parent/cc-master" >"$tmp/linked-success.json"
[ "$("$linked_parent/cc-master/bin/probe")" = "linked-new" ] || fail "symlinked parent publish must activate"
pass "target-adjacent publication supports spaces, Unicode, and symlinked parents"

# Production-path endpoint: a complete offline Cursor install must consume the same publisher for
# both the SEA and the generic/host-native plugin roots. This catches a future mutation that leaves
# the safe helper tested but silently wires main back to mv or remove-then-copy.
e2e="$tmp/e2e 空间/端到端"
e2e_assets="$e2e/assets"
e2e_package="$e2e/package"
e2e_home="$e2e/home"
e2e_prefix="$e2e/prefix bin"
e2e_store="$e2e/plugin store"
e2e_cursor="$e2e_home/.cursor/plugins/local/cc-master"
mkdir -p "$e2e_assets" "$e2e_package" "$e2e_home/.cursor" "$e2e_prefix" "$(dirname "$e2e_cursor")"

platform="$(detect_platform)"
make_ccm_fixture "$e2e_assets/ccm-$platform" "e2e-new-ccm"
make_ccm_fixture "$e2e_prefix/ccm" "old-ccm"
make_plugin_fixture "$e2e_package/cc-master" cursor "e2e-new-cursor"
make_plugin_fixture "$e2e_cursor" cursor "old-cursor"
( cd "$e2e_package" && zip -qry "$e2e_assets/cc-master-plugin-cursor-v9.9.9.zip" cc-master )
{
  printf '%s  %s\n' "$(sha256_file "$e2e_assets/ccm-$platform")" "ccm-$platform"
  printf '%s  %s\n' "$(sha256_file "$e2e_assets/cc-master-plugin-cursor-v9.9.9.zip")" \
    "cc-master-plugin-cursor-v9.9.9.zip"
} >"$e2e_assets/SHA256SUMS"

HOME="$e2e_home" \
PREFIX="$e2e_prefix" \
CC_MASTER_PLUGIN_DIR="$e2e_store" \
CC_MASTER_CURSOR_PLUGIN_ROOT="$e2e_cursor" \
CC_MASTER_INSTALL_LOCAL="$e2e_assets" \
PATH="$PATH" \
  bash ./install.sh --ccm-version ccm-v9.9.9 --plugin-version v9.9.9 --harness cursor \
  >"$tmp/e2e.out" 2>"$tmp/e2e.err"

[ "$("$e2e_prefix/ccm" --version)" = "e2e-new-ccm" ] || fail "main must activate SEA through publisher"
[ "$("$e2e_cursor/bin/probe")" = "e2e-new-cursor" ] || fail "main must activate Cursor tree through publisher"
[ -L "$e2e_cursor" ] || fail "main Cursor target must be a version pointer"
[ -L "$e2e_store/cursor/cc-master" ] || fail "main generic host tree must be a version pointer"
grep -q '"activation":"atomic-rename"' "$tmp/e2e.err" || fail "main must report binary publish state"
grep -q '"activation":"atomic-version-pointer"' "$tmp/e2e.err" || fail "main must report plugin publish state"
pass "offline installer endpoint uses transactional publisher for SEA and Cursor plugin trees"

# Re-run from a different source candidate with an injected production fault. The command must fail,
# and both endpoint artifacts from the successful install above remain runnable.
make_ccm_fixture "$e2e_assets/ccm-$platform" "e2e-bad-candidate"
{
  printf '%s  %s\n' "$(sha256_file "$e2e_assets/ccm-$platform")" "ccm-$platform"
  printf '%s  %s\n' "$(sha256_file "$e2e_assets/cc-master-plugin-cursor-v9.9.9.zip")" \
    "cc-master-plugin-cursor-v9.9.9.zip"
} >"$e2e_assets/SHA256SUMS"
if HOME="$e2e_home" \
   PREFIX="$e2e_prefix" \
   CC_MASTER_PLUGIN_DIR="$e2e_store" \
   CC_MASTER_CURSOR_PLUGIN_ROOT="$e2e_cursor" \
   CC_MASTER_INSTALL_LOCAL="$e2e_assets" \
   CC_MASTER_PUBLISH_FAULT=copy \
   PATH="$PATH" \
     bash ./install.sh --ccm-version ccm-v9.9.9 --plugin-version v9.9.9 --harness cursor \
     >"$tmp/e2e-fault.out" 2>"$tmp/e2e-fault.err"; then
  fail "production publisher fault must make installer nonzero"
fi
[ "$("$e2e_prefix/ccm" --version)" = "e2e-new-ccm" ] || fail "production fault must retain old SEA"
[ "$("$e2e_cursor/bin/probe")" = "e2e-new-cursor" ] || fail "production fault must retain old plugin"
grep -q '"ok":false' "$tmp/e2e-fault.err" || fail "production fault must expose structured state"
pass "production fault is nonzero and preserves both installed endpoints"

if grep -Fq 'mv -f "$TMP/ccm" "$PREFIX/ccm"' install.sh \
  || grep -Fq 'rm -rf "$dest/cc-master"' install.sh \
  || grep -Fq 'cp -R "$plugin_root"/. "$dest"/' install.sh; then
  fail "legacy destructive publish path must not coexist with transactional production wiring"
fi
pass "mutation guard rejects legacy replace/remove-then-copy production paths"
