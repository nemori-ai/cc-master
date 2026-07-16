#!/usr/bin/env node
/**
 * Render design_docs/hook-parity-matrix.md from hook CONTRACT.md files.
 * HOOKPAR-DEC / ADR-028 / ADR-031 (cursor column) — invoked by gen-hook-parity-matrix.sh
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.REPO || join(__dirname, '..');
const HOOKS_DIR = join(ROOT, 'plugin/src/hooks');

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
      cur[listKey[1]] = listKey[2]
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
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
    if (idMatch) {
      curId = idMatch[1];
      coverage[curId] = {};
      continue;
    }
    if (!curId) continue;
    const hostMatch = line.match(/^\s+(claude-code|codex|cursor|kimi-code):\s*(.+?)\s*$/);
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
lines.push('| hook | claude-code | codex | cursor | kimi-code | contract |');
lines.push('| --- | --- | --- | --- | --- | --- |');
for (const hook of hookDirs) {
  const cov = hostCoverage[hook] || {};
  lines.push(
    '| ' +
      [
        hook,
        cov['claude-code'] || '?',
        cov['codex'] || '?',
        cov['cursor'] || '?',
        cov['kimi-code'] || '?',
        `[CONTRACT.md](../plugin/src/hooks/${hook}/CONTRACT.md)`,
      ].join(' | ') +
      ' |',
  );
}
lines.push('');
lines.push('## Declared divergences by kind');
lines.push('');
lines.push(
  '`kind` values (per AGENTS.md-referenced HOOKPAR taxonomy, design_docs/plans/2026-07-07-hook-parity-system.md §3.5):',
);
lines.push(
  '`event-unavailable` (no equivalent trigger point) · `protocol-capability-gap` (event exists, host',
);
lines.push(
  'semantics differ, intentional adaptation) · `host-convention-divergence` (pure implementation drift —',
);
lines.push('must carry a `tracked_by`, treated as backlog, not an acceptable permanent state).');
lines.push('');

for (const hook of hookDirs) {
  const contractText = readFileSync(join(HOOKS_DIR, hook, 'CONTRACT.md'), 'utf8');
  const divergences = parseDivergences(contractText);
  if (divergences.length === 0) continue;
  lines.push('### ' + hook);
  lines.push('');
  lines.push('| rule | kind | affected hosts | tracked by |');
  lines.push('| --- | --- | --- | --- |');
  for (const d of divergences) {
    const hosts = Array.isArray(d.affected_hosts) ? d.affected_hosts.join(', ') : '';
    const tracked = (d.tracked_by || '').replace(/\|/g, '\\|');
    lines.push('| ' + (d.rule || '') + ' | ' + (d.kind || '') + ' | ' + hosts + ' | ' + tracked + ' |');
  }
  lines.push('');
}

process.stdout.write(lines.join('\n') + '\n');
