#!/usr/bin/env bash
# Probe plugin-bundled Codex hook resource environment.

set -euo pipefail

PROBE_SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
MARKETPLACE_NAME="cc-master-hook-env-probe-${STAMP}-$$"
PLUGIN_NAME="cc-master-hook-env-probe"
ROOT="${TMPDIR:-/tmp}/${MARKETPLACE_NAME}"
FIXTURES="${ROOT}/fixtures"
WORKDIR="${ROOT}/work"
PLUGIN_DIR="${ROOT}/plugins/${PLUGIN_NAME}"

cleanup() {
  codex plugin remove "${PLUGIN_NAME}@${MARKETPLACE_NAME}" --json >/dev/null 2>&1 || true
  codex plugin marketplace remove "${MARKETPLACE_NAME}" --json >/dev/null 2>&1 || true
}
trap cleanup EXIT

mkdir -p "${ROOT}/.agents/plugins" "${PLUGIN_DIR}/.codex-plugin" "${PLUGIN_DIR}/hooks" "${WORKDIR}" "${FIXTURES}"
cp "${PROBE_SRC_DIR}/probe-hook.js" "${PLUGIN_DIR}/hooks/probe-hook.js"
chmod +x "${PLUGIN_DIR}/hooks/probe-hook.js"

cat >"${ROOT}/.agents/plugins/marketplace.json" <<EOF
{
  "name": "${MARKETPLACE_NAME}",
  "interface": {
    "displayName": "cc-master hook env probe"
  },
  "plugins": [
    {
      "name": "${PLUGIN_NAME}",
      "source": {
        "source": "local",
        "path": "./plugins/${PLUGIN_NAME}"
      },
      "policy": {
        "installation": "AVAILABLE",
        "authentication": "ON_USE",
        "products": ["CODEX"]
      },
      "category": "Developer Tools"
    }
  ]
}
EOF

cat >"${PLUGIN_DIR}/.codex-plugin/plugin.json" <<EOF
{
  "name": "${PLUGIN_NAME}",
  "version": "0.0.0",
  "description": "Temporary cc-master Codex hook environment probe.",
  "hooks": "./hooks/hooks.json",
  "author": {
    "name": "cc-master"
  },
  "license": "PolyForm-Noncommercial-1.0.0",
  "interface": {
    "displayName": "cc-master hook env probe",
    "shortDescription": "Temporary hook probe",
    "longDescription": "Temporary hook probe",
    "developerName": "cc-master",
    "category": "Developer Tools",
    "capabilities": ["Read"]
  }
}
EOF

cat >"${PLUGIN_DIR}/hooks/hooks.json" <<EOF
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup|resume|clear|compact",
        "hooks": [
          {
            "type": "command",
            "command": "CC_MASTER_CODEX_HOOK_PROBE_EVENT=SessionStart CC_MASTER_CODEX_HOOK_PROBE_MODE=silent CC_MASTER_CODEX_HOOK_PROBE_DIR=\"${FIXTURES}\" node \"\${PLUGIN_ROOT}/hooks/probe-hook.js\""
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "CC_MASTER_CODEX_HOOK_PROBE_EVENT=UserPromptSubmit CC_MASTER_CODEX_HOOK_PROBE_MODE=silent CC_MASTER_CODEX_HOOK_PROBE_DIR=\"${FIXTURES}\" node \"\${PLUGIN_ROOT}/hooks/probe-hook.js\""
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "CC_MASTER_CODEX_HOOK_PROBE_EVENT=Stop CC_MASTER_CODEX_HOOK_PROBE_MODE=silent CC_MASTER_CODEX_HOOK_PROBE_DIR=\"${FIXTURES}\" node \"\${PLUGIN_ROOT}/hooks/probe-hook.js\""
          }
        ]
      }
    ]
  }
}
EOF

codex plugin marketplace add "${ROOT}" --json >"${ROOT}/marketplace-add.json"
codex plugin add "${PLUGIN_NAME}@${MARKETPLACE_NAME}" --json >"${ROOT}/plugin-add.json"

codex exec \
  --dangerously-bypass-approvals-and-sandbox \
  --dangerously-bypass-hook-trust \
  -C "${WORKDIR}" \
  "Reply exactly: OK" >"${ROOT}/codex-exec.stdout" 2>"${ROOT}/codex-exec.stderr"

printf 'probe_root=%s\n' "${ROOT}"
printf 'fixtures=%s\n' "${FIXTURES}"
find "${FIXTURES}" -type f -name '*.json' -print | sort
