#!/usr/bin/env bash
# regenerate-attestations.sh — the sanctioned entry for regenerating the attestation registries
# after an attested skill's canonical content or file set changes (issue #163).
#
# Attested runtime skills (master-orchestrator-guide, pacing-and-estimation, using-ccm) are pinned by
# two SHA-256 registries:
#   - plugin/src/skills/provider-guidance-runtime.json
#   - plugin/src/skills/pacing-and-estimation/read-only-capability.json
# sync-plugin-dist.sh refuses to publish an attested tree into plugin/dist until its fingerprint
# matches the registry. So when you legitimately change an attested skill, the registry must be
# regenerated first — otherwise sync's assert (correctly) rejects the new tree and dist can never
# move. Regenerating from the already-published dist is impossible (dist is what is stuck), which is
# the sync↔update deadlock this entry dissolves.
#
# How it stays sanctioned (not a bypass):
#   1. The update scripts recompute each registry by projecting the CANONICAL source through the same
#      projection SSOT (scripts/project-skill.cjs) that sync asserts against — a faithful mechanical
#      product, never hand-written dist and never an edited strategy contract.
#   2. After regenerating, this script runs the normal assert-on sync for every host, then
#      check-plugin-dist-sync.sh — the untouched safety net that independently proves
#      dist == registry == canonical projection. That assert is never disabled at any point.
#
# Usage:
#   bash scripts/regenerate-attestations.sh
# Then review and commit the changed registries together with plugin/dist and the skill source.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${REPO_ROOT}"

log() { printf '\033[1;34m[regen-attest]\033[0m %s\n' "$*" >&2; }

log "regenerating provider-guidance registry from canonical projection"
node scripts/update-provider-guidance-attestations.cjs

log "regenerating pacing read-only registry from canonical projection"
node scripts/update-pacing-read-only-attestations.cjs

for host in claude-code codex cursor kimi-code; do
  log "re-projecting plugin/dist/${host} under assert-on sync (safety net)"
  bash scripts/sync-plugin-dist.sh --host "${host}" >/dev/null
done

log "verifying dist == registry == canonical (assert-on)"
bash scripts/check-plugin-dist-sync.sh

log "attestation registries + plugin/dist regenerated and verified"
