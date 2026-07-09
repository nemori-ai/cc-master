#!/usr/bin/env bash
# Materialize a project-local Cursor hook probe into a workdir.
# Does NOT auto-run Cursor — you must open the workdir in Cursor IDE and chat.
#
# Usage:
#   bash plugin/src/hooks/_hosts/cursor/probes/setup-project-probe.sh
#   bash plugin/src/hooks/_hosts/cursor/probes/setup-project-probe.sh /path/to/workdir
#
# Prints: probe_root, fixtures, hooks_json, checklist path.

set -euo pipefail

PROBE_SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
ROOT="${1:-${TMPDIR:-/tmp}/cc-master-cursor-probe-${STAMP}-$$}"
FIXTURES="${ROOT}/fixtures"
HOOKS_DIR="${ROOT}/.cursor"
PROBE_HOOK_JS="${PROBE_SRC_DIR}/probe-hook.js"

mkdir -p "${FIXTURES}" "${HOOKS_DIR}" "${ROOT}/notes"

# Resolve absolute paths for the template.
PROBE_DIR_ABS="$(cd "${FIXTURES}" && pwd)"
PROBE_HOOK_ABS="$(cd "$(dirname "${PROBE_HOOK_JS}")" && pwd)/$(basename "${PROBE_HOOK_JS}")"

sed \
  -e "s|{{PROBE_DIR}}|${PROBE_DIR_ABS}|g" \
  -e "s|{{PROBE_HOOK_JS}}|${PROBE_HOOK_ABS}|g" \
  "${PROBE_SRC_DIR}/hooks.project.template.json" >"${HOOKS_DIR}/hooks.json"

cat >"${ROOT}/notes/HOW_TO_RUN.md" <<EOF
# Cursor Phase 0 probe — how to run (project-local)

Workdir: \`${ROOT}\`
Fixtures: \`${FIXTURES}\`
Hooks: \`${HOOKS_DIR}/hooks.json\`

## Steps (you do these in Cursor IDE)

1. **Open this folder** as a Cursor workspace: File → Open Folder → \`${ROOT}\`
2. Open **Agent** chat (not just inline edit).
3. Send: \`Reply exactly: OK\`
4. Ask Agent to run a shell command: \`echo hello-from-probe && pwd\`
5. Ask Agent to write a tiny file: create \`notes/wrote-by-agent.txt\` with content \`probe\`
6. Open **View → Output → Hooks** and confirm hooks fired (no spawn errors).
7. Optionally trigger compaction (long chat / compact) and note whether \`preCompact\` / \`sessionStart\` fixtures appear.
8. Let the agent finish so \`stop\` fires once.

## Collect results

\`\`\`bash
find "${FIXTURES}" -type f -name '*.json' | sort
\`\`\`

Paste fixture paths + a short note per D1–D12 into:
\`design_docs/harnesses/cursor.md\` §Probe Results
(or reply in chat and ask the agent to backfill).

## Cleanup

When done: \`rm -rf "${ROOT}"\` (fixtures are under this tree).
EOF

cp "${PROBE_SRC_DIR}/MANUAL_CHECKLIST.md" "${ROOT}/notes/MANUAL_CHECKLIST.md"

printf 'probe_root=%s\n' "${ROOT}"
printf 'fixtures=%s\n' "${FIXTURES}"
printf 'hooks_json=%s\n' "${HOOKS_DIR}/hooks.json"
printf 'howto=%s\n' "${ROOT}/notes/HOW_TO_RUN.md"
printf 'checklist=%s\n' "${ROOT}/notes/MANUAL_CHECKLIST.md"
printf '\nNext: open %s in Cursor IDE and follow notes/HOW_TO_RUN.md\n' "${ROOT}"
