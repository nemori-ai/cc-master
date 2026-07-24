#!/usr/bin/env bash
# regenerate-attestations.sh — the sanctioned entry for regenerating the attestation registries
# after an attested skill's canonical content or file set changes (issue #163 / K1-06).
#
# Attested runtime skills (master-orchestrator-guide, pacing-and-estimation, using-ccm) are pinned by
# two SHA-256 registries:
#   - plugin/src/skills/provider-guidance-runtime.json  (final compiled runtime skill trees)
#   - plugin/src/skills/pacing-and-estimation/read-only-capability.json
# sync-plugin-dist.sh refuses to publish an attested tree into plugin/dist until its fingerprint
# matches the registry. So when you legitimately change an attested skill, the registry must be
# regenerated first — otherwise sync's assert (correctly) rejects the new tree and dist can never
# move. Regenerating from the already-published dist is impossible (dist is what is stuck), which is
# the sync↔update deadlock this entry dissolves.
#
# Stages (mechanical; never hand-edit digests):
#   1. update-provider-guidance-attestations.cjs
#        canonical → raw SAP scratch → shared final skill overlay → fingerprint final skill tree
#        (v1 single manifest; semantic target = final compiled runtime skills, not raw SAP)
#   2. update-pacing-read-only-attestations.cjs
#        canonical → raw SAP scratch (+ rendered read-only slot) → fingerprint
#   3. assert-on full sync for every host (raw SAP → final skill overlay → attest → publish;
#      full compile then emits atlas/modules/command entry pins)
#   4. check-plugin-dist-sync.sh — independent proof dist == registry == final runtime
#
# How it stays sanctioned (not a bypass):
#   1. Registries are recomputed only by the updater pipeline above — never by reading checked-in
#      dist, never by hand-writing digests, never by disabling sync's assert.
#   2. After regenerating, this script runs the normal assert-on sync for every host, then
#      check-plugin-dist-sync.sh — the untouched safety net.
#
# Usage:
#   bash scripts/regenerate-attestations.sh
# Then review and commit the changed registries together with plugin/dist and the skill source.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${REPO_ROOT}"

log() { printf '\033[1;34m[regen-attest]\033[0m %s\n' "$*" >&2; }

log "regenerating provider-guidance registry from canonical→overlay final projection"
node scripts/update-provider-guidance-attestations.cjs

log "regenerating pacing read-only registry from canonical projection"
node scripts/update-pacing-read-only-attestations.cjs

for host in claude-code codex cursor kimi-code; do
  log "re-projecting plugin/dist/${host} under assert-on sync (safety net)"
  bash scripts/sync-plugin-dist.sh --host "${host}" >/dev/null
done

log "verifying dist == registry == final runtime (assert-on)"
bash scripts/check-plugin-dist-sync.sh

log "attestation registries + plugin/dist regenerated and verified"
