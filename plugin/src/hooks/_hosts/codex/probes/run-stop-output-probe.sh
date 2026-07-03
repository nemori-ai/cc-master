#!/usr/bin/env bash
# Probe Codex Stop hook output behavior with project-local absolute hook config.

set -euo pipefail

PROBE_SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
ROOT="${TMPDIR:-/tmp}/cc-master-codex-stop-output-probe-${STAMP}-$$"
WORKDIR="${ROOT}/work"
FIXTURES="${ROOT}/fixtures"
PROBE_HOOK_JS="${PROBE_SRC_DIR}/probe-hook.js"

mkdir -p "${WORKDIR}/.codex" "${FIXTURES}"

run_mode() {
  local mode="$1"
  local mode_dir="${FIXTURES}/${mode}"
  mkdir -p "${mode_dir}"
  cat >"${WORKDIR}/.codex/hooks.json" <<EOF
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "CC_MASTER_CODEX_HOOK_PROBE_EVENT=Stop CC_MASTER_CODEX_HOOK_PROBE_MODE=${mode} CC_MASTER_CODEX_HOOK_PROBE_DIR=\"${mode_dir}\" node \"${PROBE_HOOK_JS}\""
          }
        ]
      }
    ]
  }
}
EOF

  set +e
  timeout 90s codex exec \
    --dangerously-bypass-approvals-and-sandbox \
    --dangerously-bypass-hook-trust \
    -C "${WORKDIR}" \
    "Reply exactly: OK" >"${ROOT}/${mode}.stdout" 2>"${ROOT}/${mode}.stderr"
  local rc=$?
  set -e
  printf '%s rc=%s\n' "${mode}" "${rc}" | tee "${ROOT}/${mode}.rc"
}

for mode in system-message block exit2; do
  run_mode "${mode}"
done

printf 'probe_root=%s\n' "${ROOT}"
printf 'fixtures=%s\n' "${FIXTURES}"
find "${ROOT}" -type f -print | sort
