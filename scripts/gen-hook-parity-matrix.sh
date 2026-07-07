#!/usr/bin/env bash
# gen-hook-parity-matrix.sh — render design_docs/hook-parity-matrix.md from each hook's CONTRACT.md.
#
# HOOKPAR-DEC / ADR-028: CONTRACT.md (plugin/src/hooks/<hook>/CONTRACT.md) is the host-neutral
# business-rule SSOT per dual-implemented hook. This script aggregates every CONTRACT.md's
# "降级行为" fenced-yaml block into one read-only, generated overview — same source-dispersed /
# view-generated pattern as `plugin/src` -> `plugin/dist` (scripts/sync-plugin-dist.sh) and
# `.claude/skills` -> `.agents/skills` (scripts/sync-codex-skills.sh). NEVER hand-edit the
# generated design_docs/hook-parity-matrix.md — edit the source CONTRACT.md files and regenerate.
#
# Usage:
#   scripts/gen-hook-parity-matrix.sh           # regenerate design_docs/hook-parity-matrix.md
#   scripts/gen-hook-parity-matrix.sh --check   # regenerate to a temp file and diff against
#                                                 the committed doc; non-zero exit + diff on drift
#                                                 (same sync-discipline shape as check-plugin-dist-sync.sh)
#
# Why node, not bash+jq/python: this is a dev-only out-of-band script (never in plugin/src/hooks/),
# but keeps the same runtime discipline as the rest of scripts/ (node is guaranteed present in any
# Claude Code host, AGENTS.md §3 红线1 / ADR-006) and the repo's existing node-based content tests.

set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$REPO/design_docs/hook-parity-matrix.md"

MODE="write"
if [ "${1:-}" = "--check" ]; then
  MODE="check"
elif [ "${1:-}" != "" ]; then
  echo "usage: scripts/gen-hook-parity-matrix.sh [--check]" >&2
  exit 2
fi

command -v node >/dev/null 2>&1 || {
  echo "node not found on PATH — required (Claude Code hosts ship node; ADR-006)" >&2
  exit 1
}

GENERATED="$(REPO="$REPO" node - <<'NODE'
'use strict';
const { readFileSync, readdirSync, existsSync } = require('node:fs');
const { join } = require('node:path');

const ROOT = process.env.REPO;
const HOOKS_DIR = join(ROOT, 'plugin/src/hooks');

// Parse the single fenced ```yaml ... ``` block under a "## 降级行为" heading in a CONTRACT.md.
// Deliberately tiny/hand-rolled (no yaml dep, red-line1-adjacent discipline) — the block is a flat
// list of records with a fixed key set, which a line-oriented parser handles exactly.
function parseDivergences(text) {
  const heading = text.indexOf('## 降级行为');
  if (heading === -1) return [];
  const rest = text.slice(heading);
  const fenceStart = rest.indexOf('```yaml');
  if (fenceStart === -1) return [];
  const afterFence = rest.slice(fenceStart + '```yaml'.length);
  const fenceEnd = afterFence.indexOf('```');
  const block = fenceEnd === -1 ? afterFence : afterFence.slice(0, fenceEnd);

  const records = [];
  let cur = null;
  let curKey = null;
  for (const rawLine of block.split(/\r?\n/)) {
    const line = rawLine;
    if (/^\s*#/.test(line) || /^\s*$/.test(line)) continue;
    const startItem = line.match(/^\s*-\s+rule:\s*(.+?)\s*$/);
    if (startItem) {
      cur = { rule: startItem[1].replace(/^["']|["']$/g, ''), affected_hosts: [] };
      records.push(cur);
      curKey = null;
      continue;
    }
    if (!cur) continue;
    const listKey = line.match(/^\s+([a-z_]+):\s*\[(.*)\]\s*$/);
    if (listKey) {
      cur[listKey[1]] = listKey[2].split(',').map((s) => s.trim()).filter(Boolean);
      curKey = null;
      continue;
    }
    const scalarBlock = line.match(/^\s+([a-z_]+):\s*>\s*$/);
    if (scalarBlock) {
      cur[scalarBlock[1]] = '';
      curKey = scalarBlock[1];
      continue;
    }
    const scalar = line.match(/^\s+([a-z_]+):\s*(.+?)\s*$/);
    if (scalar && !/^\s{4,}/.test(line)) {
      cur[scalar[1]] = scalar[2].replace(/^["']|["']$/g, '');
      curKey = null;
      continue;
    }
    if (curKey) {
      // Folded scalar continuation line (indented under a `key: >` block).
      cur[curKey] = (cur[curKey] ? cur[curKey] + ' ' : '') + line.trim();
    }
  }
  return records;
}

function readHostCoverage() {
  const yaml = readFileSync(join(HOOKS_DIR, '_manifest/hooks.yaml'), 'utf8');
  const coverage = {};
  let curId = null;
  for (const line of yaml.split(/\r?\n/)) {
    const idMatch = line.match(/^\s*-\s+id:\s*(.+?)\s*$/);
    if (idMatch) { curId = idMatch[1]; coverage[curId] = {}; continue; }
    if (!curId) continue;
    const hostMatch = line.match(/^\s+(claude-code|codex):\s*(.+?)\s*$/);
    if (hostMatch) coverage[curId][hostMatch[1]] = hostMatch[2];
  }
  return coverage;
}

const hostCoverage = readHostCoverage();
const hookDirs = readdirSync(HOOKS_DIR, { withFileTypes: true })
  .filter((e) => e.isDirectory() && !e.name.startsWith('_'))
  .map((e) => e.name)
  .filter((name) => existsSync(join(HOOKS_DIR, name, 'CONTRACT.md')))
  .sort();

const lines = [];
lines.push('# Hook Parity Matrix');
lines.push('');
lines.push('**GENERATED — do not hand-edit.** Source of truth: each hook\'s');
lines.push('`plugin/src/hooks/<hook>/CONTRACT.md` "降级行为" section. Regenerate with');
lines.push('`bash scripts/gen-hook-parity-matrix.sh` after editing a CONTRACT.md (checked by');
lines.push('`bash scripts/gen-hook-parity-matrix.sh --check`, wired into `run-tests.sh`).');
lines.push('');
lines.push('| hook | claude-code | codex | contract |');
lines.push('| --- | --- | --- | --- |');
for (const hook of hookDirs) {
  const cov = hostCoverage[hook] || {};
  lines.push(`| ${hook} | ${cov['claude-code'] || '?'} | ${cov['codex'] || '?'} | [CONTRACT.md](../plugin/src/hooks/${hook}/CONTRACT.md) |`);
}
lines.push('');
lines.push('## Declared divergences by kind');
lines.push('');
lines.push('`kind` values (per AGENTS.md-referenced HOOKPAR taxonomy, design_docs/plans/2026-07-07-hook-parity-system.md §3.5):');
lines.push('`event-unavailable` (no equivalent trigger point) · `protocol-capability-gap` (event exists, host');
lines.push('semantics differ, intentional adaptation) · `host-convention-divergence` (pure implementation drift —');
lines.push('must carry a `tracked_by`, treated as backlog, not an acceptable permanent state).');
lines.push('');

for (const hook of hookDirs) {
  const contractText = readFileSync(join(HOOKS_DIR, hook, 'CONTRACT.md'), 'utf8');
  const divergences = parseDivergences(contractText);
  if (divergences.length === 0) continue;
  lines.push(`### ${hook}`);
  lines.push('');
  lines.push('| rule | kind | affected hosts | tracked by |');
  lines.push('| --- | --- | --- | --- |');
  for (const d of divergences) {
    const hosts = Array.isArray(d.affected_hosts) ? d.affected_hosts.join(', ') : '';
    const tracked = (d.tracked_by || '').replace(/\|/g, '\\|');
    lines.push(`| ${d.rule || ''} | ${d.kind || ''} | ${hosts} | ${tracked} |`);
  }
  lines.push('');
}

process.stdout.write(lines.join('\n') + '\n');
NODE
)"

if [ "$MODE" = "check" ]; then
  if [ ! -f "$OUT" ]; then
    echo "gen-hook-parity-matrix: missing $OUT — run scripts/gen-hook-parity-matrix.sh" >&2
    exit 1
  fi
  CURRENT="$(cat "$OUT")"
  if [ "$GENERATED" != "$CURRENT" ]; then
    echo "gen-hook-parity-matrix: $OUT is stale — run scripts/gen-hook-parity-matrix.sh and commit the diff" >&2
    diff <(echo "$CURRENT") <(echo "$GENERATED") || true
    exit 1
  fi
  echo "gen-hook-parity-matrix: OK — $OUT is in sync"
  exit 0
fi

mkdir -p "$(dirname "$OUT")"
printf '%s' "$GENERATED" > "$OUT"
echo "gen-hook-parity-matrix: wrote $OUT"
