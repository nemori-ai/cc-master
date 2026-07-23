#!/usr/bin/env bash
# sync-plugin-dist.sh — project paragoge-style plugin source to adapter dist.
#
# Phase 1 ships only the full Claude Code adapter, but the source shape is the
# full paragoge pattern. Skills can be projected per host before the rest of a
# host adapter is ready.
#
# Full host sync builds a sibling whole-host staging tree and atomically publishes
# only after overlay + candidate-root compile + attestation all succeed. Live
# plugin/dist/<host> is byte-identical until that commit boundary.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${REPO_ROOT}"

SRC="plugin/src"
HOST="claude-code"
SURFACE="all"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --host)
      HOST="${2:-}"
      [ -n "${HOST}" ] || { echo "sync-plugin-dist: --host requires a value" >&2; exit 2; }
      shift 2
      ;;
    --skills-only)
      SURFACE="skills"
      shift
      ;;
    -h|--help)
      cat <<'EOF'
Usage: bash scripts/sync-plugin-dist.sh [--host <host>] [--skills-only]

Default:
  Generate the full Claude Code adapter at plugin/dist/claude-code.

Examples:
  bash scripts/sync-plugin-dist.sh
  bash scripts/sync-plugin-dist.sh --host codex --skills-only
EOF
      exit 0
      ;;
    *)
      echo "sync-plugin-dist: unknown argument $1" >&2
      exit 2
      ;;
  esac
done

DST="plugin/dist/${HOST}"

[ -d "${SRC}" ] || { echo "sync-plugin-dist: missing ${SRC}" >&2; exit 1; }

if [ "${SURFACE}" = "all" ] && [ "${HOST}" != "claude-code" ] && [ "${HOST}" != "codex" ] && [ "${HOST}" != "cursor" ] && [ "${HOST}" != "kimi-code" ]; then
  echo "sync-plugin-dist: full adapter generation for ${HOST} is not implemented. Use --skills-only for ${HOST}." >&2
  exit 2
fi

SYNC_HOST="${HOST}" SYNC_SURFACE="${SURFACE}" node <<'NODE'
const {
  projectAndPublishSkillsSurface,
} = require('./scripts/skill-knowledge/sync-skills-surface.cjs');
const {
  projectAndPublishHostSurface,
} = require('./scripts/skill-knowledge/sync-host-surface.cjs');

const host = process.env.SYNC_HOST || 'claude-code';
const surface = process.env.SYNC_SURFACE || 'all';
const stamp = `${process.pid}-${Date.now().toString(16)}`;
const warn = (message) => console.warn(`sync-plugin-dist: ${message}`);

if (surface === 'skills') {
  projectAndPublishSkillsSurface({
    repoRoot: process.cwd(),
    host,
    stamp,
    warn,
  });
  process.exit(0);
}

projectAndPublishHostSurface({
  repoRoot: process.cwd(),
  host,
  stamp,
  warn,
});
NODE

echo "sync-plugin-dist: ${SRC} --adapt ${HOST}${SURFACE:+ (${SURFACE})} -> ${DST}"
