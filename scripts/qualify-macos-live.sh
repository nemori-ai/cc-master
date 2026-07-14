#!/usr/bin/env bash
# Live macOS qualification operator. This is dev/CI-only evidence tooling; it does not publish,
# release, mutate credentials, or claim that a Linux fixture qualifies Darwin.

set -uo pipefail

SEA="${1:-}"
CONTRACT="${2:-}"
EVIDENCE_DIR="${3:-}"
EXPECTED_UNAME_ARCH="${EXPECTED_UNAME_ARCH:-}"
EXPECTED_NODE_ARCH="${EXPECTED_NODE_ARCH:-}"

if [ -z "${SEA}" ] || [ -z "${CONTRACT}" ] || [ -z "${EVIDENCE_DIR}" ]; then
  printf 'usage: %s <downloaded-sea> <darwin-arm64|darwin-x64> <evidence-dir>\n' "$0" >&2
  exit 2
fi
if [ "$(uname -s)" != Darwin ]; then
  printf 'macOS live qualification requires a real Darwin endpoint; observed %s\n' "$(uname -s)" >&2
  exit 2
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${REPO_ROOT}" || exit 2
SEA="$(cd "$(dirname "${SEA}")" && pwd)/$(basename "${SEA}")"
mkdir -p "${EVIDENCE_DIR}"
EVIDENCE_DIR="$(cd "${EVIDENCE_DIR}" && pwd)"
VERDICTS="${EVIDENCE_DIR}/verdicts.tsv"
LAUNCHD_IDENTITY="${EVIDENCE_DIR}/launchd_trusted_identity.json"
FAILURES=0
printf 'gate\tclassification\texit_code\n' >"${VERDICTS}"

record() {
  printf '%s\t%s\t%s\n' "$1" "$2" "$3" >>"${VERDICTS}"
}

run_required() {
  local name="$1"
  shift
  printf '%q ' "$@" >"${EVIDENCE_DIR}/${name}.command.txt"
  printf '\n' >>"${EVIDENCE_DIR}/${name}.command.txt"
  "$@" >"${EVIDENCE_DIR}/${name}.log" 2>&1
  local rc=$?
  printf '%s\n' "${rc}" >"${EVIDENCE_DIR}/${name}.exit"
  cat "${EVIDENCE_DIR}/${name}.log"
  if [ "${rc}" -eq 0 ]; then
    record "${name}" PASS "${rc}"
  else
    record "${name}" FAIL "${rc}"
    FAILURES=$((FAILURES + 1))
  fi
  return 0
}

run_conditional() {
  local name="$1"
  shift
  printf '%q ' "$@" >"${EVIDENCE_DIR}/${name}.command.txt"
  printf '\n' >>"${EVIDENCE_DIR}/${name}.command.txt"
  "$@" >"${EVIDENCE_DIR}/${name}.log" 2>&1
  local rc=$?
  printf '%s\n' "${rc}" >"${EVIDENCE_DIR}/${name}.exit"
  cat "${EVIDENCE_DIR}/${name}.log"
  if [ "${rc}" -eq 0 ]; then
    record "${name}" PASS "${rc}"
  else
    record "${name}" CONDITIONAL "${rc}"
  fi
  return 0
}

assert_runner_identity() {
  [ "$(uname -s)" = Darwin ] || return 11
  [ -n "${EXPECTED_UNAME_ARCH}" ] || return 12
  [ -n "${EXPECTED_NODE_ARCH}" ] || return 13
  [ "$(uname -m)" = "${EXPECTED_UNAME_ARCH}" ] || return 14
  [ "$(node -p 'process.arch')" = "${EXPECTED_NODE_ARCH}" ] || return 15
  case "${CONTRACT}:$(uname -m):$(node -p 'process.arch')" in
    darwin-arm64:arm64:arm64|darwin-x64:x86_64:x64) return 0 ;;
    *) return 16 ;;
  esac
}

capture_environment() {
  printf 'exact_commit=%s\n' "$(git rev-parse HEAD)"
  printf 'exact_tree=%s\n' "$(git rev-parse 'HEAD^{tree}')"
  printf 'contract=%s\n' "${CONTRACT}"
  printf 'uname_s=%s\n' "$(uname -s)"
  printf 'uname_m=%s\n' "$(uname -m)"
  printf 'node_arch=%s\n' "$(node -p 'process.arch')"
  uname -a
  sw_vers
  sysctl -n machdep.cpu.brand_string 2>/dev/null || true
  diskutil info / || true
  stat -f 'filesystem_type=%T device=%d inode=%i mode=%Sp owner=%u:%g' /
  mount
  node --version
  pnpm --version
  git status --short --branch
}

assert_apfs() {
  local device info
  device="$(df "${EVIDENCE_DIR}" | awk 'NR == 2 { print $1 }')" || return 17
  [ -n "${device}" ] || return 17
  info="$(diskutil info "${device}")" || return 17
  printf 'qualification_workspace=%s\ndevice=%s\n%s\n' "${EVIDENCE_DIR}" "${device}" "${info}"
  printf '%s\n' "${info}" | grep -Eiq \
    '^[[:space:]]*Type \(Bundle\):[[:space:]]*apfs[[:space:]]*$' || {
    printf 'expected APFS qualification workspace, observed device %s\n' "${device}" >&2
    return 18
  }
}

probe_directory_fsync() {
  node - "${EVIDENCE_DIR}" <<'NODE'
  const fs = require('node:fs');
  const dir = process.argv[2];
  const fd = fs.openSync(dir, 'r');
  try {
    fs.fsyncSync(fd);
    process.stdout.write('directory fsync accepted\n');
  } finally {
    fs.closeSync(fd);
  }
NODE
}

validate_sea_dependencies() {
  if grep -Eq '/opt/homebrew|/usr/local/(opt|Cellar)|libnode' "${EVIDENCE_DIR}/sea_otool.log"; then
    printf '%s\n' 'downloaded SEA has a non-system build-machine dependency' >&2
    return 21
  fi
}

validate_runtime_matrix_log() {
  local log="${EVIDENCE_DIR}/runtime_apfs_exdev_crash_matrix.log"
  grep -q 'publish EXDEV and activation kill-switch fail closed' "${log}" || return 22
  grep -q 'process crash after commit leaves a stale lock' "${log}" || return 23
  grep -q 'concurrent activation has one linearization winner' "${log}" || return 24
  grep -q 'no-replace publish has one winner under a real two-process race' "${log}" || return 25
  grep -q 'a concurrently appearing invalid launcher final is preserved and rejected' "${log}" || return 26
  grep -q 'launcher pathname replacement after pinning cannot redirect publication' "${log}" || return 27
  grep -q 'native invoke enforces the platform assurance tier' "${log}" || return 28
  grep -q 'exact-object callers fail closed before spawn' "${log}" || return 29
  grep -q 'an independently verified valid launcher final is idempotent' "${log}" || return 30
  grep -q 'two concurrent cold invokes both succeed' "${log}" || return 32
  grep -q 'SIGKILL around launcher directory recovery and helper publication' "${log}" || return 33
  grep -q 'a real publisher-parent SIGKILL cannot strand an executable materializer bootstrap' "${log}" || return 45
  grep -q 'a publisher crash after bootstrap creation is reclaimed by the next activation' "${log}" || return 46
  grep -q 'native bootstrap self-clean survives parent SIGKILL before and after helper publication' "${log}" || return 47
  grep -q 'dead publisher materializer bootstrap instances are recovered without touching live owners' "${log}" || return 48
  grep -q 'dead materializer bootstrap recovery is idempotent across concurrent activations' "${log}" || return 49
  grep -q 'native materializer self-cleans its own bootstrap before stale recovery' "${log}" || return 50
  grep -q 'materializer bootstrap recovery fails closed on symlink, type, and permission anomalies' "${log}" || return 51
}

validate_darwin_runtime_assurance() {
  node - "${EVIDENCE_DIR}/runtime_resolve.log" "${EVIDENCE_DIR}/runtime_doctor.log" \
    "${CONTRACT}" <<'NODE'
const fs = require('node:fs');
const [resolveFile, doctorFile, expectedPlatform] = process.argv.slice(2);
function data(file) {
  const text = fs.readFileSync(file, 'utf8');
  const start = text.indexOf('{');
  if (start < 0) process.exit(2);
  return JSON.parse(text.slice(start)).data;
}
const resolved = data(resolveFile);
const doctor = data(doctorFile);
const expected = {
  object_binding: 'path-attested-v1',
  publisher_identity: 'local-sha256-provenance',
  active_same_uid_replacement: 'residual',
  platform: expectedPlatform,
};
for (const [key, value] of Object.entries(expected)) {
  if (resolved.invoke_assurance?.[key] !== value) process.exit(3);
  if (doctor.backend.invoke_assurance?.[key] !== value) process.exit(4);
}
process.stdout.write(`${JSON.stringify(expected, null, 2)}\n`);
NODE
}

assert_exact_object_denied() {
  local output rc
  output="$(env HOME="${QUAL_HOME}" CC_MASTER_HOME="${CCM_HOME}" \
    "${SEA}" runtime invoke --require-assurance exact-object -- --version 2>&1)"
  rc=$?
  printf '%s\n' "${output}"
  [ "${rc}" -eq 3 ] || return 30
  printf '%s\n' "${output}" | grep -q 'RUNTIME_INVOKE_ASSURANCE' || return 31
}

validate_installer_matrix_log() {
  local log="${EVIDENCE_DIR}/installer_apfs_fault_matrix.log"
  grep -q 'binary fault matrix preserves last-known-good executable' "${log}" || return 26
  grep -q 'all host plugin trees use recoverable atomic pointers' "${log}" || return 27
}

validate_launchd_install_log() {
  node - "${EVIDENCE_DIR}/launchd_install.log" <<'NODE'
const fs = require('node:fs');
const doc = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (doc.ok !== true || doc.installed !== true || doc.activated !== true) process.exit(2);
if (doc.kind !== 'launchd' || doc.activation?.kind !== 'launchd') process.exit(3);
if (doc.activation?.ok !== true || doc.activation?.state !== 'active') process.exit(4);
const steps = doc.activation?.steps ?? [];
if (steps.map((step) => step.id).join(',') !== 'bootstrap,kickstart,status') process.exit(5);
if (steps.some((step) => step.ok !== true || step.code !== 0 || !Array.isArray(step.args))) process.exit(6);
process.stdout.write(`${JSON.stringify(doc, null, 2)}\n`);
NODE
}

write_launchd_trusted_identity() {
  local uid label arch target
  [ -n "${PLIST:-}" ] || return 1
  uid="$(id -u)" || return 1
  label="$(basename "${PLIST}" .plist)" || return 1
  case "${CONTRACT}" in
    darwin-arm64) arch=arm64 ;;
    darwin-x64) arch=x64 ;;
    *) return 2 ;;
  esac
  target="gui/${uid}/${label}"
  TRUSTED_CONTRACT="${CONTRACT}" TRUSTED_ARCH="${arch}" TRUSTED_PLIST="${PLIST}" \
    TRUSTED_LABEL="${label}" TRUSTED_UID="${uid}" TRUSTED_TARGET="${target}" \
    node >"${LAUNCHD_IDENTITY}" <<'NODE'
const identity = {
  schema: 'ccm/macos-launchd-qualification-identity/v1',
  contract: process.env.TRUSTED_CONTRACT,
  platform: 'darwin',
  arch: process.env.TRUSTED_ARCH,
  plist_path: process.env.TRUSTED_PLIST,
  label: process.env.TRUSTED_LABEL,
  gui_uid: process.env.TRUSTED_UID,
  launchctl_target: process.env.TRUSTED_TARGET,
};
process.stdout.write(`${JSON.stringify(identity, null, 2)}\n`);
NODE
  cat "${LAUNCHD_IDENTITY}"
}

validate_launchd_uninstall_log() {
  node scripts/validate-macos-launchd-deactivation.mjs "${EVIDENCE_DIR}/launchd_uninstall.log" \
    "${CONTRACT}" "${LAUNCHD_IDENTITY}"
}

write_provenance() {
  local hash
  hash="$(shasum -a 256 "${SEA}" | awk '{print $1}')" || return 1
  SEA_HASH="${hash}" SEA_ASSET="$(basename "${SEA}")" node >"${EVIDENCE_DIR}/runtime-provenance.json" <<'NODE'
  const doc = {
    schema: 'ccm/runtime-provenance/v1',
    repository: 'nemori-ai/cc-master',
    tag: 'ccm-v0.0.0-macos-live-qualification',
    asset: process.env.SEA_ASSET,
    sha256: process.env.SEA_HASH,
  };
  process.stdout.write(`${JSON.stringify(doc, null, 2)}\n`);
NODE
}

json_data_field() {
  local file="$1" field="$2"
  node - "${file}" "${field}" <<'NODE'
  const fs = require('node:fs');
  const [file, dotted] = process.argv.slice(2);
  const text = fs.readFileSync(file, 'utf8');
  const start = text.indexOf('{');
  if (start < 0) process.exit(2);
  let value = JSON.parse(text.slice(start));
  value = value.data;
  for (const key of dotted.split('.')) value = value?.[key];
  if (value === undefined || value === null) process.exit(3);
  process.stdout.write(typeof value === 'object' ? JSON.stringify(value) : String(value));
NODE
}

validate_plugin_archives() {
  local host zip dest
  for host in claude-code codex cursor; do
    zip="${EVIDENCE_DIR}/plugins/cc-master-plugin-${host}-v0.0.0-macos-qualification.zip"
    [ -f "${zip}" ] || return 31
    dest="${EVIDENCE_DIR}/plugin-extract-${host}"
    rm -rf "${dest}"
    mkdir -p "${dest}"
    unzip -q "${zip}" -d "${dest}" || return 32
    test -d "${dest}/cc-master/skills" || return 33
    test -d "${dest}/cc-master/hooks" || return 34
    case "${host}" in
      claude-code)
        test -f "${dest}/cc-master/.claude-plugin/plugin.json" || return 35
        test -x "${dest}/cc-master/hooks/scripts/bootstrap-board.sh" || return 36
        claude plugin validate "${dest}/cc-master" || return 37
        ;;
      codex)
        test -f "${dest}/cc-master/.codex-plugin/plugin.json" || return 38
        test -x "${dest}/cc-master/hooks/_hosts/codex/launcher.js" || return 39
        ;;
      cursor)
        test -f "${dest}/cc-master/.cursor-plugin/plugin.json" || return 40
        test -d "${dest}/cc-master/rules" || return 41
        test -x "${dest}/cc-master/hooks/_hosts/cursor/launcher.js" || return 42
        node - "${dest}/cc-master/hooks/hooks.json" <<'NODE' || return 43
        const fs = require('node:fs');
        const file = process.argv[2];
        const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
        const commands = [];
        function walk(value) {
          if (Array.isArray(value)) for (const item of value) walk(item);
          else if (value && typeof value === 'object') {
            for (const [key, item] of Object.entries(value)) {
              if (key === 'command' && typeof item === 'string') commands.push(item);
              walk(item);
            }
          }
        }
        walk(doc);
        if (!commands.length) process.exit(2);
        for (const command of commands) {
          if (!command.includes('./hooks/')) process.exit(3);
          if (/(^|\s)(\/Users\/|\/home\/|[A-Za-z]:\\)/.test(command)) process.exit(4);
        }
NODE
        ;;
    esac
    unzip -Z -v "${zip}" >"${EVIDENCE_DIR}/plugin-${host}-zip-metadata.log" || return 44
  done
}

cursor_capability_probe() {
  env HOME="${QUAL_HOME}" CC_MASTER_HOME="${CCM_HOME}" \
    "${SEA}" harness list --machine-wide --json
}

run_required runner_identity assert_runner_identity
run_required environment capture_environment
run_required apfs_filesystem assert_apfs
run_conditional directory_fsync probe_directory_fsync
run_required sea_version "${SEA}" --version
run_required sea_checksum bash -c 'cd "$1" && shasum -a 256 -c "$(basename "$2").sha256"' _ "$(dirname "${SEA}")" "${SEA}"
run_required sea_codesign_verify codesign --verify --strict --verbose=4 "${SEA}"
run_required sea_codesign_display codesign -dvvv "${SEA}"
run_required sea_otool otool -L "${SEA}"
run_required sea_dependency_policy validate_sea_dependencies
run_conditional gatekeeper_assessment spctl --assess --type execute --verbose=4 "${SEA}"
run_conditional quarantine_xattrs xattr -lr "${SEA}"

run_required runtime_provenance write_provenance

QUAL_HOME="${EVIDENCE_DIR}/Fresh Home with spaces 用户"
CCM_HOME="${QUAL_HOME}/.cc_master"
mkdir -p "${QUAL_HOME}" "${CCM_HOME}"

run_required runtime_stage env HOME="${QUAL_HOME}" CC_MASTER_HOME="${CCM_HOME}" \
  "${SEA}" runtime stage "${SEA}" --provenance "${EVIDENCE_DIR}/runtime-provenance.json" --json
TX="$(json_data_field "${EVIDENCE_DIR}/runtime_stage.log" transaction_id 2>/dev/null || true)"
if [ -n "${TX}" ]; then
  run_required runtime_activate env HOME="${QUAL_HOME}" CC_MASTER_HOME="${CCM_HOME}" \
    "${SEA}" runtime activate "${TX}" --json
  run_required runtime_resolve env HOME="${QUAL_HOME}" CC_MASTER_HOME="${CCM_HOME}" \
    "${SEA}" runtime resolve --json
  run_required runtime_invoke env HOME="${QUAL_HOME}" CC_MASTER_HOME="${CCM_HOME}" \
    "${SEA}" runtime invoke -- --version
  run_required runtime_doctor env HOME="${QUAL_HOME}" CC_MASTER_HOME="${CCM_HOME}" \
    "${SEA}" runtime doctor --json
  run_required runtime_assurance validate_darwin_runtime_assurance
  run_required runtime_exact_object_denial assert_exact_object_denied
else
  printf '%s\n' 'runtime stage did not return a transaction_id' >"${EVIDENCE_DIR}/runtime_transaction.log"
  record runtime_transaction FAIL 65
  FAILURES=$((FAILURES + 1))
fi

run_required runtime_apfs_exdev_crash_matrix \
  pnpm -C ccm/apps/cli exec node --import tsx --test \
  test/handler-runtime.test.ts test/runtime-verified-exec-contract.test.ts
run_required runtime_matrix_coverage validate_runtime_matrix_log
run_required installer_apfs_fault_matrix bash tests/scripts/test_install_integrity.sh
run_required installer_matrix_coverage validate_installer_matrix_log
run_required service_serializer_contract \
  pnpm -C ccm/packages/engine exec node --test test/service-serializers.test.ts
run_required monitor_platform_neutral_contract \
  pnpm -C ccm/apps/cli exec node --import tsx --test \
  --test-name-pattern='monitor (start/status|start forces|serve runs)' test/handler-monitor.test.ts

PLIST_DIR="${QUAL_HOME}/Library/LaunchAgents"
run_required launchd_install env HOME="${QUAL_HOME}" CC_MASTER_HOME="${CCM_HOME}" \
  "${SEA}" monitor install-service --json
run_required launchd_activation_truth validate_launchd_install_log
PLIST="$(find "${PLIST_DIR}" -maxdepth 1 -name '*.plist' -print 2>/dev/null | head -n 1)"
if [ -n "${PLIST}" ]; then
  run_required launchd_plutil plutil -lint "${PLIST}"
  run_required launchd_plist_dump plutil -p "${PLIST}"
  run_required launchd_trusted_identity write_launchd_trusted_identity
else
  printf '%s\n' 'monitor install-service produced no plist' >"${EVIDENCE_DIR}/launchd_plist.log"
  record launchd_plist FAIL 66
  FAILURES=$((FAILURES + 1))
fi
run_required launchd_uninstall env HOME="${QUAL_HOME}" CC_MASTER_HOME="${CCM_HOME}" \
  "${SEA}" monitor uninstall-service --json
run_required launchd_deactivation_truth validate_launchd_uninstall_log

mkdir -p "${EVIDENCE_DIR}/plugins"
run_required plugin_package env CCM_PLUGIN_OUT_DIR="${EVIDENCE_DIR}/plugins" \
  bash scripts/package-plugin.sh --all-hosts v0.0.0-macos-qualification
run_required plugin_checksums bash -c 'cd "$1" && shasum -a 256 -c SHA256SUMS' _ \
  "${EVIDENCE_DIR}/plugins"
run_required plugin_extract_modes_manifests validate_plugin_archives
run_required plugin_projection_clean bash scripts/check-plugin-dist-sync.sh

# The read-only inventory probe is required evidence, but a clean hosted runner is not expected to
# carry Cursor credentials or quota. Its unknown/unavailable result is conditional, never relabeled
# as a qualified Cursor Agent worker.
run_conditional cursor_agent_capability cursor_capability_probe
if ! command -v agent >/dev/null 2>&1 && ! command -v cursor-agent >/dev/null 2>&1; then
  printf '%s\n' 'Cursor Agent binary unavailable on this hosted runner; auth/quota/sandbox/task acceptance remain unknown.' \
    >"${EVIDENCE_DIR}/cursor_agent_endpoint.txt"
  record cursor_agent_endpoint CONDITIONAL 127
else
  CURSOR_BIN="$(command -v agent 2>/dev/null || command -v cursor-agent)"
  run_conditional cursor_agent_version "${CURSOR_BIN}" --version
  printf '%s\n' 'Binary exists, but no credentials or quota were provisioned; no state-changing/provider task was run.' \
    >"${EVIDENCE_DIR}/cursor_agent_endpoint.txt"
  record cursor_agent_endpoint CONDITIONAL 0
fi

printf 'required_failures=%s\n' "${FAILURES}" >"${EVIDENCE_DIR}/summary.txt"
printf 'exact_commit=%s\n' "$(git rev-parse HEAD)" >>"${EVIDENCE_DIR}/summary.txt"
printf 'exact_tree=%s\n' "$(git rev-parse 'HEAD^{tree}')" >>"${EVIDENCE_DIR}/summary.txt"
printf 'contract=%s\n' "${CONTRACT}" >>"${EVIDENCE_DIR}/summary.txt"
cat "${VERDICTS}"
cat "${EVIDENCE_DIR}/summary.txt"

if ! node scripts/macos-evidence-manifest.mjs write \
  "${EVIDENCE_DIR}" "${EVIDENCE_DIR}/SHA256SUMS"; then
  printf '%s\n' 'failed to write the closed qualification evidence manifest' >&2
  exit 1
fi
if ! node scripts/macos-evidence-manifest.mjs verify \
  "${EVIDENCE_DIR}" "${EVIDENCE_DIR}/SHA256SUMS"; then
  printf '%s\n' 'qualification evidence manifest is not an exact closed set' >&2
  exit 1
fi

if [ "${FAILURES}" -ne 0 ]; then
  exit 1
fi
exit 0
