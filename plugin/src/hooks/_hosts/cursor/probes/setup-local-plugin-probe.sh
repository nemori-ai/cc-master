#!/usr/bin/env bash
# Materialize a local Cursor plugin under ~/.cursor/plugins/local/ for D9 install probe.
# Does NOT auto-enable the plugin — you must enable it in Cursor Customize / Plugins.
#
# Usage:
#   bash plugin/src/hooks/_hosts/cursor/probes/setup-local-plugin-probe.sh
#
# Env:
#   CC_MASTER_CURSOR_PLUGIN_NAME  default: cc-master-hook-probe
#   CC_MASTER_CURSOR_PROBE_DIR    fixture dir (default under TMPDIR)

set -euo pipefail

PROBE_SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
PLUGIN_NAME="${CC_MASTER_CURSOR_PLUGIN_NAME:-cc-master-hook-probe}"
CURSOR_HOME="${CURSOR_HOME:-${HOME}/.cursor}"
PLUGIN_DIR="${CURSOR_HOME}/plugins/local/${PLUGIN_NAME}"
FIXTURES="${CC_MASTER_CURSOR_PROBE_DIR:-${TMPDIR:-/tmp}/cc-master-cursor-plugin-probe-${STAMP}-$$}"

mkdir -p "${FIXTURES}" "${PLUGIN_DIR}/.cursor-plugin" "${PLUGIN_DIR}/hooks"

cp "${PROBE_SRC_DIR}/probe-hook.js" "${PLUGIN_DIR}/hooks/probe-hook.js"
chmod +x "${PLUGIN_DIR}/hooks/probe-hook.js"

PROBE_DIR_ABS="$(cd "${FIXTURES}" && pwd)"

# Prefer absolute path to probe-hook inside the installed plugin (D1: no assumed token).
# Also emit a second copy of hooks using {{PLUGIN_ROOT}} literal for token experiments —
# operator can swap files manually.
sed \
  -e "s|{{PROBE_DIR}}|${PROBE_DIR_ABS}|g" \
  -e "s|{{PLUGIN_ROOT}}|${PLUGIN_DIR}|g" \
  "${PROBE_SRC_DIR}/hooks.plugin-local.template.json" >"${PLUGIN_DIR}/hooks/hooks.json"

# Keep a token-form variant for D1 comparison (operator swaps in place).
sed \
  -e "s|{{PROBE_DIR}}|${PROBE_DIR_ABS}|g" \
  "${PROBE_SRC_DIR}/hooks.plugin-local.template.json" >"${PLUGIN_DIR}/hooks/hooks.plugin-root-token.json"

cat >"${PLUGIN_DIR}/.cursor-plugin/plugin.json" <<EOF
{
  "name": "${PLUGIN_NAME}",
  "version": "0.0.0-probe",
  "description": "Temporary cc-master Cursor hook environment probe (Phase 0).",
  "hooks": "./hooks/hooks.json"
}
EOF

cat >"${PLUGIN_DIR}/README-PROBE.md" <<EOF
# ${PLUGIN_NAME} (Phase 0 probe)

Installed at: \`${PLUGIN_DIR}\`
Fixtures: \`${FIXTURES}\`

## Enable

1. Restart Cursor or reload window.
2. Open **Cursor Settings → Plugins / Customize** and confirm local plugin \`${PLUGIN_NAME}\` is visible/enabled.
3. Open any project Agent chat and send: \`Reply exactly: OK\`
4. Run a Shell tool + Write a file so pre/postToolUse fire.
5. Check View → Output → Hooks.

## D1 token experiment

Default \`hooks/hooks.json\` uses **absolute** paths (safe baseline).
To test whether Cursor expands a plugin-root token, swap:

\`\`\`bash
cp "${PLUGIN_DIR}/hooks/hooks.plugin-root-token.json" "${PLUGIN_DIR}/hooks/hooks.json"
\`\`\`

Then re-trigger hooks. If spawn fails, token is unsupported (record in Probe Results).

## Uninstall

\`\`\`bash
rm -rf "${PLUGIN_DIR}"
\`\`\`
EOF

printf 'plugin_dir=%s\n' "${PLUGIN_DIR}"
printf 'fixtures=%s\n' "${FIXTURES}"
printf 'readme=%s\n' "${PLUGIN_DIR}/README-PROBE.md"
printf '\nNext: enable local plugin in Cursor, then chat; collect fixtures under %s\n' "${FIXTURES}"
