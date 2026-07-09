#!/usr/bin/env node
/**
 * Render design_docs/capability-parity-matrix.md from capability INTENT cards.
 * ADR-031 — invoked by scripts/gen-capability-parity-matrix.sh
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = process.env.REPO || join(__dirname, '..');
const CAP_DIR = process.env.CAP_DIR || join(REPO, 'design_docs/harnesses/capabilities');

function parseDivergences(text) {
  const heading = text.indexOf('## Declared divergence');
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

function parseHostMechanisms(text) {
  const rows = [];
  const lines = text.split(/\r?\n/);
  let inTable = false;
  for (const line of lines) {
    if (line.startsWith('## Host mechanisms')) {
      inTable = false;
      continue;
    }
    if (!inTable && line.startsWith('| host | status')) {
      inTable = true;
      continue;
    }
    if (inTable) {
      if (!line.startsWith('|') || line.includes('---')) continue;
      const cells = line
        .split('|')
        .map((s) => s.trim())
        .filter(Boolean);
      if (cells.length >= 2 && cells[0] !== 'host') {
        rows.push({ host: cells[0], status: cells[1] });
      }
      if (line.trim() === '' || line.startsWith('## ')) inTable = false;
    }
  }
  return rows;
}

const cards = readdirSync(CAP_DIR, { withFileTypes: true })
  .filter((e) => e.isFile() && e.name.endsWith('.md') && e.name !== 'README.md')
  .map((e) => e.name.replace(/\.md$/, ''))
  .sort();

const out = [];
out.push('# Capability Parity Matrix');
out.push('');
out.push('**GENERATED — do not hand-edit.** Source of truth: each file in');
out.push('`design_docs/harnesses/capabilities/*.md` "Declared divergence" section. Regenerate with');
out.push('`bash scripts/gen-capability-parity-matrix.sh` (checked by `--check` in `run-tests.sh`).');
out.push('');
out.push('See [ADR-031](../adrs/ADR-031-n-host-capability-parity.md) and');
out.push('[capabilities/README.md](harnesses/capabilities/README.md).');
out.push('');
out.push('| capability | claude-code | codex | cursor | card |');
out.push('| --- | --- | --- | --- | --- |');

for (const id of cards) {
  const text = readFileSync(join(CAP_DIR, `${id}.md`), 'utf8');
  const mechs = parseHostMechanisms(text);
  const byHost = Object.fromEntries(mechs.map((r) => [r.host, r.status]));
  out.push(
    '| ' +
      [id, byHost['claude-code'] || '?', byHost['codex'] || '?', byHost['cursor'] || '?', `[${id}.md](harnesses/capabilities/${id}.md)`].join(
        ' | ',
      ) +
      ' |',
  );
}

out.push('');
out.push('## Declared divergences by kind');
out.push('');
out.push('`kind`: `event-unavailable` · `protocol-capability-gap` · `host-convention-divergence`');
out.push('(see ADR-028 / ADR-031).');
out.push('');

for (const id of cards) {
  const text = readFileSync(join(CAP_DIR, `${id}.md`), 'utf8');
  const divergences = parseDivergences(text);
  if (divergences.length === 0) continue;
  out.push(`### ${id}`);
  out.push('');
  out.push('| rule | kind | affected hosts | tracked by |');
  out.push('| --- | --- | --- | --- |');
  for (const d of divergences) {
    const hosts = Array.isArray(d.affected_hosts) ? d.affected_hosts.join(', ') : '';
    const tracked = (d.tracked_by || '').replace(/\|/g, '\\|');
    out.push(`| ${d.rule || ''} | ${d.kind || ''} | ${hosts} | ${tracked} |`);
  }
  out.push('');
}

process.stdout.write(out.join('\n') + '\n');
