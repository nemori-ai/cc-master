import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const manifestPath = join(ROOT, 'plugin/src/hooks/_manifest/injection-contracts.yaml');

function read(rel) {
  return readFileSync(join(ROOT, rel), 'utf8');
}

function parseContracts(text) {
  const contracts = [];
  let current = null;
  let listKey = null;
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*#/.test(line) || /^\s*$/.test(line)) continue;
    const item = line.match(/^\s*-\s+id:\s*(.+?)\s*$/);
    if (item) {
      current = { id: item[1].replace(/^["']|["']$/g, ''), required_hosts: [], required_source_anchors: [] };
      contracts.push(current);
      listKey = null;
      continue;
    }
    if (!current) continue;
    const scalar = line.match(/^\s+([a-z_]+):\s*(.+?)\s*$/);
    if (scalar) {
      current[scalar[1]] = scalar[2].replace(/^["']|["']$/g, '');
      listKey = null;
      continue;
    }
    const list = line.match(/^\s+([a-z_]+):\s*$/);
    if (list) {
      listKey = list[1];
      if (!Array.isArray(current[listKey])) current[listKey] = [];
      continue;
    }
    const listItem = line.match(/^\s+-\s*(.+?)\s*$/);
    if (listItem && listKey) {
      current[listKey].push(listItem[1].replace(/^["']|["']$/g, ''));
    }
  }
  return contracts;
}

function implementationText(hook, host) {
  const dir = join(ROOT, 'plugin/src/hooks', hook, 'implementations', host);
  assert.ok(existsSync(dir), `missing implementation dir: ${dir}`);
  return readdirSync(dir)
    .filter((name) => name.endsWith('.js') || name.endsWith('.sh'))
    .map((name) => read(`plugin/src/hooks/${hook}/implementations/${host}/${name}`))
    .join('\n');
}

test('hook injection contracts are declared and covered by every required host implementation', () => {
  const contracts = parseContracts(readFileSync(manifestPath, 'utf8'));
  assert.ok(contracts.length > 0, 'expected at least one hook injection contract');

  for (const contract of contracts) {
    assert.ok(contract.id, 'contract has id');
    assert.ok(contract.hook, `${contract.id} has hook`);
    assert.ok(contract.required_hosts.length > 0, `${contract.id} has required hosts`);
    assert.ok(contract.required_source_anchors.length > 0, `${contract.id} has required anchors`);

    for (const host of contract.required_hosts) {
      const text = implementationText(contract.hook, host);
      for (const anchor of contract.required_source_anchors) {
        assert.ok(
          text.includes(anchor),
          `${contract.id}: ${contract.hook}/${host} is missing required agent-facing anchor ${JSON.stringify(anchor)}`,
        );
      }
    }
  }
});

// ── HOOKPAR-DEC / ADR-028: per-hook CONTRACT.md "PARITY anchors" structural check ───────────────────
// CONTRACT.md (plugin/src/hooks/<hook>/CONTRACT.md) is the host-neutral business-rule SSOT for the
// 7 dual-implemented hooks. Its "## PARITY anchors" section lists {rule, required_hosts}; each rule
// must have a `// PARITY: <rule>` (or `# PARITY: <rule>`) comment literally present in every one of
// its required hosts' implementation files. This is a STRUCTURAL check only (same limitation as the
// injection-contracts check above) — it proves both hosts' source at least declares awareness of the
// rule, not that their judgment tables are behaviorally equivalent (see the fixture-based behavioral
// parity tests in tests/hooks/test_parity-fixtures.sh for that).

function hookContractDirs() {
  const hooksRoot = join(ROOT, 'plugin/src/hooks');
  return readdirSync(hooksRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('_'))
    .map((e) => e.name)
    .filter((name) => existsSync(join(hooksRoot, name, 'CONTRACT.md')));
}

function parseParityAnchors(contractText) {
  const heading = contractText.indexOf('## PARITY anchors');
  if (heading === -1) return [];
  const rest = contractText.slice(heading);
  const fenceStart = rest.indexOf('```yaml');
  if (fenceStart === -1) return [];
  const afterFence = rest.slice(fenceStart + '```yaml'.length);
  const fenceEnd = afterFence.indexOf('```');
  const block = fenceEnd === -1 ? afterFence : afterFence.slice(0, fenceEnd);

  const anchors = [];
  let cur = null;
  for (const line of block.split(/\r?\n/)) {
    if (/^\s*#/.test(line) || /^\s*$/.test(line)) continue;
    const ruleMatch = line.match(/^\s*-\s+rule:\s*(.+?)\s*$/);
    if (ruleMatch) {
      cur = { rule: ruleMatch[1].replace(/^["']|["']$/g, ''), required_hosts: [] };
      anchors.push(cur);
      continue;
    }
    if (!cur) continue;
    const hostsMatch = line.match(/^\s+required_hosts:\s*\[(.*)\]\s*$/);
    if (hostsMatch) {
      cur.required_hosts = hostsMatch[1].split(',').map((s) => s.trim()).filter(Boolean);
    }
  }
  return anchors;
}

test('CONTRACT.md PARITY anchors are present in every required host implementation', () => {
  const hooks = hookContractDirs();
  assert.ok(hooks.length > 0, 'expected at least one hook with a CONTRACT.md');

  let anchorCount = 0;
  for (const hook of hooks) {
    const contractPath = join(ROOT, 'plugin/src/hooks', hook, 'CONTRACT.md');
    const anchors = parseParityAnchors(readFileSync(contractPath, 'utf8'));
    for (const anchor of anchors) {
      assert.ok(anchor.required_hosts.length > 0, `${hook}: PARITY anchor ${anchor.rule} has required_hosts`);
      for (const host of anchor.required_hosts) {
        const text = implementationText(hook, host);
        const tagged = text.includes(`PARITY: ${anchor.rule}`);
        assert.ok(
          tagged,
          `${hook}/${host}: missing "PARITY: ${anchor.rule}" structural anchor declared in CONTRACT.md`,
        );
        anchorCount += 1;
      }
    }
  }
  assert.ok(anchorCount > 0, 'expected at least one PARITY anchor to be checked');
});
