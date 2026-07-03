#!/usr/bin/env bash
# Install repo-local git hooks. This is intentionally opt-in because git does not
# version core.hooksPath; contributors run it once per clone.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${REPO_ROOT}"

git config core.hooksPath .githooks
printf 'Installed repo git hooks: core.hooksPath=.githooks\n'
