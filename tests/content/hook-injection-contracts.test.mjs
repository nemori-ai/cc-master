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
