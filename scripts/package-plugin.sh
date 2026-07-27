#!/usr/bin/env bash
# package-plugin.sh — manifest-only adapter for the attested release-bundle transaction.
#
# This script deliberately has no source/dist discovery, projection, sync, compilation, tag
# inference, or allowlist. TX1/TX2/TX4 provide one immutable input manifest; the production
# bundler verifies that evidence and publishes the already-planned four-host release atomically.
#
# Usage:
#   bash scripts/package-plugin.sh --manifest /absolute/release-input.json [--out-dir dist]
#
# Stdout is the exact upload set: four zips, SHA256SUMS, and release-attestation.json.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
MANIFEST=""
OUT_DIR="${CCM_PLUGIN_OUT_DIR:-${REPO_ROOT}/dist}"

die() {
  printf '[package-plugin] ERROR: %s\n' "$*" >&2
  exit 1
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --manifest)
      MANIFEST="${2:-}"
      shift 2
      ;;
    --manifest=*)
      MANIFEST="${1#*=}"
      shift
      ;;
    --out-dir)
      OUT_DIR="${2:-}"
      shift 2
      ;;
    --out-dir=*)
      OUT_DIR="${1#*=}"
      shift
      ;;
    -h|--help)
      sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      die "unknown argument: $1"
      ;;
  esac
done

[ -n "${MANIFEST}" ] || die "--manifest is required; live repo/dist packaging is forbidden"
[ -f "${MANIFEST}" ] || die "manifest does not exist: ${MANIFEST}"
[ -n "${OUT_DIR}" ] || die "--out-dir must not be empty"

exec node "${SCRIPT_DIR}/trusted-release-bundle.mjs" build \
  --manifest "${MANIFEST}" \
  --out-dir "${OUT_DIR}"
