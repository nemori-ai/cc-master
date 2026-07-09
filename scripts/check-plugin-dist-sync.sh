#!/usr/bin/env bash
# check-plugin-dist-sync.sh — regenerate plugin adapter dist and fail if it changed.
#
# This is the mechanical guard for the repo invariant:
#   plugin/src is the semantic source; plugin/dist/<host> is committed generated output.
# Run before pushing. If this script leaves a diff under plugin/dist, commit that diff with
# the source change before pushing.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${REPO_ROOT}"

log() { printf '\033[1;34m[plugin-dist-sync]\033[0m %s\n' "$*" >&2; }
die() { printf '\033[1;31m[plugin-dist-sync] ERROR:\033[0m %s\n' "$*" >&2; exit 1; }

git rev-parse --is-inside-work-tree >/dev/null 2>&1 || die "not inside a git worktree"

log "regenerating plugin/dist/claude-code"
bash scripts/sync-plugin-dist.sh --host claude-code >/dev/null

log "regenerating plugin/dist/codex"
bash scripts/sync-plugin-dist.sh --host codex >/dev/null

log "regenerating plugin/dist/cursor"
bash scripts/sync-plugin-dist.sh --host cursor >/dev/null

if ! git diff --quiet -- plugin/dist; then
  cat >&2 <<'EOF'

plugin/dist is out of sync with plugin/src.

Review the generated diff and commit it together with the source change before pushing:

  git diff -- plugin/dist
  git add plugin/dist
  git commit --amend --no-edit   # or create a follow-up commit

EOF
  git diff --stat -- plugin/dist >&2 || true
  exit 1
fi

log "plugin/dist is in sync"
