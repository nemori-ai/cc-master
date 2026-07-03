#!/usr/bin/env bash
# sync-codex-skills.sh — project .claude/skills into Codex repo skill location.
#
# Codex scans .agents/skills, not .claude/skills. It supports symlinked skill
# folders, so the default mode creates symlinks to avoid duplicate skill bodies.
# Use --copy for environments where symlinks are undesirable.

set -euo pipefail

MODE="symlink"
if [ "${1:-}" = "--check" ]; then
  MODE="check"
elif [ "${1:-}" = "--copy" ]; then
  MODE="copy"
elif [ "${1:-}" != "" ]; then
  echo "usage: scripts/sync-codex-skills.sh [--check|--copy]" >&2
  exit 2
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="${REPO_ROOT}/.claude/skills"
DST="${REPO_ROOT}/.agents/skills"

[ -d "${SRC}" ] || { echo "sync-codex-skills: missing ${SRC}" >&2; exit 1; }

if [ "${MODE}" = "check" ]; then
  [ -d "${DST}" ] || { echo "sync-codex-skills: missing ${DST}; run scripts/sync-codex-skills.sh" >&2; exit 1; }
  fail=0
  for skill in "${SRC}"/*; do
    [ -d "${skill}" ] || continue
    name="$(basename "${skill}")"
    [ -f "${skill}/SKILL.md" ] || continue
    target="${DST}/${name}"
    if [ ! -e "${target}" ]; then
      echo "sync-codex-skills: missing projection for ${name}" >&2
      fail=1
      continue
    fi
    if [ ! -f "${target}/SKILL.md" ]; then
      echo "sync-codex-skills: projected ${name} has no SKILL.md" >&2
      fail=1
    fi
  done
  for projected in "${DST}"/*; do
    [ -e "${projected}" ] || continue
    name="$(basename "${projected}")"
    if [ ! -d "${SRC}/${name}" ]; then
      echo "sync-codex-skills: stale projection ${name}" >&2
      fail=1
    fi
  done
  [ "${fail}" -eq 0 ] || exit 1
  echo "sync-codex-skills: OK — ${DST} matches ${SRC}"
  exit 0
fi

rm -rf "${DST}"
mkdir -p "${DST}"

for skill in "${SRC}"/*; do
  [ -d "${skill}" ] || continue
  name="$(basename "${skill}")"
  [ -f "${skill}/SKILL.md" ] || continue
  if [ "${MODE}" = "copy" ]; then
    cp -R "${skill}" "${DST}/${name}"
  else
    ln -s "../../.claude/skills/${name}" "${DST}/${name}"
  fi
done

echo "sync-codex-skills: ${SRC} -> ${DST} (${MODE})"
