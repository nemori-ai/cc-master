import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { isDeepStrictEqual } from 'node:util';

const SUITE_ROOT = resolve(import.meta.dirname, '..', '..');
const TARGET_ROOT = resolve(process.env.CCM_XH_C3_TARGET_ROOT || SUITE_ROOT);
const MANIFEST = JSON.parse(
  readFileSync(
    join(SUITE_ROOT, 'tests/hooks/fixtures/xh-c3-subscription-phip-ssot-v1/manifest.json'),
    'utf8',
  ),
);

function publishableMarkdownPaths(failures) {
  const result = spawnSync(
    'git',
    [
      '-C',
      TARGET_ROOT,
      'ls-files',
      '--cached',
      '--others',
      '--exclude-standard',
      '-z',
      '--',
      'design_docs',
      'plugin/src/hooks',
    ],
    { encoding: 'utf8' },
  );
  if (result.status !== 0) {
    failures.push(
      `publishable authority discovery failed: ${result.error?.message || result.stderr.trim() || `git exited ${result.status}`}`,
    );
    return [];
  }
  return result.stdout
    .split('\0')
    .filter((path) => path.endsWith('.md') && existsSync(join(TARGET_ROOT, path)));
}

function readTarget(path, failures, label) {
  const absolute = join(TARGET_ROOT, path);
  if (!existsSync(absolute)) {
    failures.push(`${label}: missing ${path}`);
    return '';
  }
  return readFileSync(absolute, 'utf8');
}

function authorityBlocks(text, path, failures) {
  const blocks = [];
  const beginPattern = /<!--\s*(XH-C3-[A-Z0-9_-]+-AUTHORITY):BEGIN\s*-->/g;
  for (const match of text.matchAll(beginPattern)) {
    const marker = match[1];
    const bodyStart = match.index + match[0].length;
    const endMarker = `<!-- ${marker}:END -->`;
    const bodyEnd = text.indexOf(endMarker, bodyStart);
    if (bodyEnd < 0) {
      failures.push(`${path}: incomplete structured authority block ${marker}`);
      blocks.push({ marker, path, value: null });
      continue;
    }
    const fenced = text.slice(bodyStart, bodyEnd).match(/^\s*```json\s*([\s\S]*?)\s*```\s*$/);
    if (!fenced) {
      failures.push(`${path}: malformed JSON fence for ${marker}`);
      blocks.push({ marker, path, value: null });
      continue;
    }
    try {
      blocks.push({ marker, path, value: JSON.parse(fenced[1]) });
    } catch (error) {
      failures.push(`${path}: malformed canonical JSON block ${marker}: ${error.message}`);
      blocks.push({ marker, path, value: null });
    }
  }
  return blocks;
}

function same(actual, expected) {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function expectExact(failures, label, actual, expected) {
  if (!same(actual, expected)) {
    failures.push(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function hookCoverage(text, hookId, requiredHosts) {
  const marker = `  - id: ${hookId}\n`;
  const start = text.indexOf(marker);
  const rest = start < 0 ? '' : text.slice(start + marker.length);
  const next = rest.indexOf('\n  - id: ');
  const block = next < 0 ? rest : rest.slice(0, next);
  const coverage = {};
  for (const host of requiredHosts) {
    coverage[host] = block.match(new RegExp(`^      ${host}:\\s*(\\S+)`, 'm'))?.[1] || '';
  }
  return coverage;
}

function parityAnchors(text) {
  const heading = text.indexOf('## PARITY anchors');
  if (heading < 0) return new Map();
  const rest = text.slice(heading);
  const fenceStart = rest.indexOf('```yaml');
  if (fenceStart < 0) return new Map();
  const afterFence = rest.slice(fenceStart + '```yaml'.length);
  const fenceEnd = afterFence.indexOf('```');
  const block = fenceEnd < 0 ? afterFence : afterFence.slice(0, fenceEnd);
  const anchors = new Map();
  let current = null;
  for (const line of block.split(/\r?\n/)) {
    const rule = line.match(/^\s*-\s+rule:\s*(.+?)\s*$/);
    if (rule) {
      current = rule[1].replace(/^["']|["']$/g, '');
      anchors.set(current, []);
      continue;
    }
    const hosts = line.match(/^\s+required_hosts:\s*\[(.*)\]\s*$/);
    if (current && hosts) {
      anchors.set(
        current,
        hosts[1]
          .split(',')
          .map((host) => host.trim())
          .filter(Boolean),
      );
    }
  }
  return anchors;
}

function implementationText(hook, host, failures) {
  const root = join(TARGET_ROOT, 'plugin/src/hooks', hook, 'implementations', host);
  if (!existsSync(root)) {
    failures.push(`${hook}/${host}: implementation directory missing`);
    return '';
  }
  return readdirSync(root)
    .filter((name) => name.endsWith('.js') || name.endsWith('.sh'))
    .map((name) => readFileSync(join(root, name), 'utf8'))
    .join('\n');
}

function matrixStatuses(text, capabilityId, requiredHosts) {
  const line = text
    .split(/\r?\n/)
    .find((candidate) => candidate.startsWith(`| ${capabilityId} |`));
  if (!line) return {};
  const cells = line
    .split('|')
    .slice(1, -1)
    .map((cell) => cell.trim());
  return Object.fromEntries(requiredHosts.map((host, index) => [host, cells[index + 1] || '']));
}

test('XH C3 Track-B capability has one mapped authority per subject and executable contract anchors', () => {
  const failures = [];
  if (MANIFEST.role !== 'non-normative-test-oracle') {
    failures.push(`fixture role must be non-normative-test-oracle, got ${MANIFEST.role}`);
  }
  const parsed = {};
  const allOwns = new Map();
  const markerOwners = new Map();
  const canonicalByMarker = new Map(
    Object.values(MANIFEST.canonical).map((entry) => [entry.marker, entry]),
  );
  const discovered = [];
  const publishableMarkdown = publishableMarkdownPaths(failures);

  for (const path of publishableMarkdown) {
    discovered.push(
      ...authorityBlocks(readFileSync(join(TARGET_ROOT, path), 'utf8'), path, failures),
    );
  }

  for (const block of discovered) {
    const expected = canonicalByMarker.get(block.marker);
    if (!expected) failures.push(`${block.path}: unapproved authority marker ${block.marker}`);
    else if (expected.path !== block.path) {
      failures.push(`${block.marker}: canonical owner must be ${expected.path}, got ${block.path}`);
    }

    const previousMarker = markerOwners.get(block.marker);
    if (previousMarker) {
      failures.push(`second normative block ${block.marker}: ${previousMarker} and ${block.path}`);
    } else {
      markerOwners.set(block.marker, block.path);
    }

    if (!block.value) continue;
    if (
      !Array.isArray(block.value.owns) ||
      block.value.owns.some((subject) => typeof subject !== 'string' || subject.length === 0)
    ) {
      failures.push(`${block.path}:${block.marker}: owns must be non-empty strings`);
      continue;
    }
    for (const subject of block.value.owns) {
      const owner = `${block.marker}@${block.path}`;
      const previous = allOwns.get(subject);
      if (previous) failures.push(`duplicate authority for ${subject}: ${previous} and ${owner}`);
      else allOwns.set(subject, owner);
    }
  }

  for (const [name, entry] of Object.entries(MANIFEST.canonical)) {
    const matches = discovered.filter((block) => block.marker === entry.marker);
    if (matches.length === 0)
      failures.push(`${name}: missing canonical JSON block ${entry.marker}`);
    if (matches.length !== 1 || !matches[0].value) continue;
    const block = matches[0].value;
    parsed[name] = block;
    if (!isDeepStrictEqual(block, entry.authority)) {
      failures.push(
        `${name}.authority: canonical JSON differs from versioned fixture; expected ${JSON.stringify(entry.authority)}, got ${JSON.stringify(block)}`,
      );
    }
  }

  const capability = parsed.capability;
  const capabilityFixture = MANIFEST.canonical.capability.authority;
  const requiredHosts = capabilityFixture.required_hosts;
  const derivedDocuments = capabilityFixture.derived_documents;
  if (capability) {
    const cardText = readTarget(MANIFEST.canonical.capability.path, failures, 'capability-card');
    const rows = {};
    for (const match of cardText.matchAll(/^\| (claude-code|codex|cursor) \| ([^|]+?) \|/gm)) {
      rows[match[1]] = match[2].trim();
    }
    expectExact(
      failures,
      'capability.host-status',
      rows,
      Object.fromEntries(requiredHosts.map((host) => [host, MANIFEST.required_status])),
    );
    const matrixText = readTarget(
      'design_docs/capability-parity-matrix.md',
      failures,
      'capability-matrix',
    );
    expectExact(
      failures,
      'capability.matrix-status',
      matrixStatuses(matrixText, capability.capability_id, requiredHosts),
      Object.fromEntries(requiredHosts.map((host) => [host, MANIFEST.required_status])),
    );

    const targetOnlyClaims = [
      /Track B specification target/i,
      /Track B `target`/i,
      /runtime pending/i,
      /not current implementation anchors/i,
      /还没有兑现本 Track B target/,
      /均保持 `target`/,
    ];
    for (const path of [
      MANIFEST.canonical.capability.path,
      MANIFEST.canonical.bootstrap.path,
      MANIFEST.canonical.inbox.path,
    ]) {
      const text = readTarget(path, failures, 'current-truth');
      for (const pattern of targetOnlyClaims) {
        if (pattern.test(text)) failures.push(`${path}: stale target-only claim ${pattern}`);
      }
    }
  }

  for (const [name, hook] of [
    ['bootstrap', 'bootstrap-board'],
    ['inbox', 'coordination-inbox'],
  ]) {
    const authority = parsed[name];
    if (!authority) continue;
    const contractPath = MANIFEST.canonical[name].path;
    const contractText = readTarget(contractPath, failures, `${name}-contract`);
    const anchors = parityAnchors(contractText);
    // Kimi can register the subscription while lacking a non-blocking inbox delivery event.
    // The capability card therefore remains unsupported for Kimi, but bootstrap's executable
    // registration slice must still be kept in parity with the three delivery-capable hosts.
    const ruleRequiredHosts = name === 'bootstrap'
      ? [...requiredHosts, 'kimi-code']
      : requiredHosts;
    for (const rule of authority.rule_ids) {
      expectExact(failures, `${name}.parity.${rule}`, anchors.get(rule) || [], ruleRequiredHosts);
      for (const host of ruleRequiredHosts) {
        const implementation = implementationText(hook, host, failures);
        if (!implementation.includes(`PARITY: ${rule}`)) {
          failures.push(`${hook}/${host}: executable runtime missing PARITY: ${rule}`);
        }
      }
    }
  }

  const hooksManifest = readTarget(
    'plugin/src/hooks/_manifest/hooks.yaml',
    failures,
    'hooks-manifest',
  );
  if (hooksManifest) {
    for (const [hook, hosts] of [
      ['bootstrap-board', [...requiredHosts, 'kimi-code']],
      ['coordination-inbox', requiredHosts],
    ]) {
      const coverage = hookCoverage(hooksManifest, hook, hosts);
      for (const host of hosts) {
        if (!coverage[host]) failures.push(`hooks-manifest: ${hook} missing host_coverage.${host}`);
      }
    }
  }

  for (const path of derivedDocuments) {
    const text = readTarget(path, failures, 'derived-document');
    if (!text) continue;
    if (!/^Status: \*\*non-normative authority map\*\*/m.test(text)) {
      failures.push(`${path}: must declare non-normative authority map status`);
    }
    for (const forbidden of [
      /\bccm coordination subscription register\b/,
      /\bccm coordination subscription current\b/,
      /\bccm coordination inbox list\b/,
      /\bMUST(?: NOT)?\b/,
      /"subscription_id"\s*:/,
      /"source_policy_revision"\s*:/,
    ]) {
      if (forbidden.test(text))
        failures.push(`${path}: derived document repeats normative semantics (${forbidden})`);
    }
  }

  for (const entry of Object.values(MANIFEST.canonical)) {
    for (const anchor of entry.exclusive_semantic_anchors || []) {
      const owners = [];
      for (const path of publishableMarkdown) {
        if (readFileSync(join(TARGET_ROOT, path), 'utf8').includes(anchor)) owners.push(path);
      }
      expectExact(failures, `exclusive semantic anchor ${anchor}`, owners.sort(), [entry.path]);
    }
  }

  assert.equal(
    failures.length,
    0,
    `XH C3 PHIP SSOT contract: ${failures.length} failure(s)\n- ${failures.join('\n- ')}`,
  );
});
