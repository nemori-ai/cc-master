import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import test from 'node:test';

const SUITE_ROOT = resolve(import.meta.dirname, '..', '..');
const TARGET_ROOT = resolve(process.env.CCM_XH_C3_TARGET_ROOT || SUITE_ROOT);
const MANIFEST = JSON.parse(
  readFileSync(join(SUITE_ROOT, 'tests/hooks/fixtures/xh-c3-subscription-phip-ssot-v1/manifest.json'), 'utf8'),
);

function walkMarkdown(root) {
  if (!existsSync(root)) return [];
  const out = [];
  for (const name of readdirSync(root)) {
    const path = join(root, name);
    const stat = statSync(path);
    if (stat.isDirectory()) out.push(...walkMarkdown(path));
    else if (name.endsWith('.md')) out.push(path);
  }
  return out;
}

function parseAuthority(text, marker, failures, label) {
  const escaped = marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = text.match(
    new RegExp(`<!-- ${escaped}:BEGIN -->\\s*\\x60\\x60\\x60json\\s*([\\s\\S]*?)\\s*\\x60\\x60\\x60\\s*<!-- ${escaped}:END -->`),
  );
  if (!match) {
    failures.push(`${label}: missing canonical JSON block ${marker}`);
    return null;
  }
  try {
    return JSON.parse(match[1]);
  } catch (error) {
    failures.push(`${label}: malformed canonical JSON block: ${error.message}`);
    return null;
  }
}

function readTarget(path, failures, label) {
  const absolute = join(TARGET_ROOT, path);
  if (!existsSync(absolute)) {
    failures.push(`${label}: missing ${path}`);
    return '';
  }
  return readFileSync(absolute, 'utf8');
}

function same(actual, expected) {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function expectExact(failures, label, actual, expected) {
  if (!same(actual, expected)) {
    failures.push(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function hookCoverage(text, hookId) {
  const marker = `  - id: ${hookId}\n`;
  const start = text.indexOf(marker);
  const rest = start < 0 ? '' : text.slice(start + marker.length);
  const next = rest.indexOf('\n  - id: ');
  const block = next < 0 ? rest : rest.slice(0, next);
  const coverage = {};
  for (const host of MANIFEST.required_hosts) {
    coverage[host] = block.match(new RegExp(`^      ${host}:\\s*(\\S+)`, 'm'))?.[1] || '';
  }
  return coverage;
}

test('XH C3 Track-B capability has one mapped authority per subject and executable contract anchors', () => {
  const failures = [];
  const parsed = {};
  const allOwns = new Map();

  for (const [name, entry] of Object.entries(MANIFEST.canonical)) {
    const text = readTarget(entry.path, failures, name);
    if (!text) continue;
    const block = parseAuthority(text, entry.marker, failures, name);
    if (!block) continue;
    parsed[name] = block;
    expectExact(failures, `${name}.owns`, block.owns, entry.owns);
    if (block.capability_id !== MANIFEST.capability_id) {
      failures.push(`${name}.capability_id: expected ${MANIFEST.capability_id}, got ${block.capability_id}`);
    }
    for (const subject of block.owns || []) {
      const previous = allOwns.get(subject);
      if (previous) failures.push(`duplicate authority for ${subject}: ${previous} and ${entry.path}`);
      else allOwns.set(subject, entry.path);
    }
  }

  const capability = parsed.capability;
  if (capability) {
    expectExact(failures, 'capability.required_hosts', capability.required_hosts, MANIFEST.required_hosts);
    expectExact(
      failures,
      'capability.affected_hooks',
      capability.affected_hooks,
      [MANIFEST.canonical.bootstrap.path, MANIFEST.canonical.inbox.path],
    );
    expectExact(failures, 'capability.derived_documents', capability.derived_documents, MANIFEST.derived_documents);

    const cardText = readTarget(MANIFEST.canonical.capability.path, failures, 'capability-card');
    const rows = {};
    for (const match of cardText.matchAll(/^\| (claude-code|codex|cursor) \| ([^|]+?) \|/gm)) {
      rows[match[1]] = match[2].trim();
    }
    expectExact(
      failures,
      'capability.host-status',
      rows,
      Object.fromEntries(MANIFEST.required_hosts.map((host) => [host, MANIFEST.required_status])),
    );
  }

  const bootstrap = parsed.bootstrap;
  if (bootstrap) {
    const expected = MANIFEST.bootstrap_contract;
    expectExact(failures, 'bootstrap.command', bootstrap.registration.command, expected.command);
    expectExact(failures, 'bootstrap.required_selectors', bootstrap.registration.required_selectors, expected.required_selectors);
    expectExact(
      failures,
      'bootstrap.required_non_empty_response_fields',
      bootstrap.registration.required_non_empty_response_fields,
      expected.required_non_empty_response_fields,
    );
    expectExact(
      failures,
      'bootstrap.exact_echo_response_fields',
      bootstrap.registration.exact_echo_response_fields,
      expected.exact_echo_response_fields,
    );
    expectExact(failures, 'bootstrap.failure_observations', bootstrap.failure.observations, expected.failure_observations);
    expectExact(failures, 'bootstrap.failure_effects', bootstrap.failure.effects, expected.failure_effects);
  }

  const inbox = parsed.inbox;
  if (inbox) {
    const expected = MANIFEST.inbox_contract;
    expectExact(failures, 'inbox.current_command', inbox.current.command, expected.current_command);
    expectExact(failures, 'inbox.list_command', inbox.list.command, expected.list_command);
    expectExact(failures, 'inbox.current_required_selectors', inbox.current.required_selectors, expected.current_required_selectors);
    expectExact(failures, 'inbox.list_required_selectors', inbox.list.required_selectors, expected.list_required_selectors);
    expectExact(failures, 'inbox.fail_closed_observations', inbox.fail_closed.observations, expected.fail_closed_observations);
    expectExact(failures, 'inbox.fail_closed_effects', inbox.fail_closed.effects, expected.fail_closed_effects);
    expectExact(
      failures,
      'inbox.provenance_required_non_empty_fields',
      inbox.provenance.required_non_empty_fields,
      expected.provenance_required_non_empty_fields,
    );
    expectExact(
      failures,
      'inbox.provenance_exact_match_fields',
      inbox.provenance.exact_match_fields,
      expected.provenance_exact_match_fields,
    );
  }

  const hooksManifest = readTarget('plugin/src/hooks/_manifest/hooks.yaml', failures, 'hooks-manifest');
  if (hooksManifest) {
    for (const hook of ['bootstrap-board', 'coordination-inbox']) {
      const coverage = hookCoverage(hooksManifest, hook);
      for (const host of MANIFEST.required_hosts) {
        if (!coverage[host]) failures.push(`hooks-manifest: ${hook} missing host_coverage.${host}`);
      }
    }
  }

  for (const path of MANIFEST.derived_documents) {
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
      if (forbidden.test(text)) failures.push(`${path}: derived document repeats normative semantics (${forbidden})`);
    }
  }

  const markerOwners = new Map();
  for (const root of ['design_docs', 'plugin/src/hooks']) {
    for (const file of walkMarkdown(join(TARGET_ROOT, root))) {
      const text = readFileSync(file, 'utf8');
      for (const match of text.matchAll(/<!-- (XH-C3-[A-Z-]+-AUTHORITY):BEGIN -->/g)) {
        const rel = relative(TARGET_ROOT, file);
        const previous = markerOwners.get(match[1]);
        if (previous) failures.push(`second normative block ${match[1]}: ${previous} and ${rel}`);
        else markerOwners.set(match[1], rel);
      }
    }
  }
  for (const entry of Object.values(MANIFEST.canonical)) {
    if (markerOwners.get(entry.marker) !== entry.path) {
      failures.push(`${entry.marker}: canonical owner must be ${entry.path}, got ${markerOwners.get(entry.marker) || '(missing)'}`);
    }
    for (const anchor of entry.exclusive_semantic_anchors || []) {
      const owners = [];
      for (const root of ['design_docs', 'plugin/src/hooks']) {
        for (const file of walkMarkdown(join(TARGET_ROOT, root))) {
          if (readFileSync(file, 'utf8').includes(anchor)) owners.push(relative(TARGET_ROOT, file));
        }
      }
      expectExact(failures, `exclusive semantic anchor ${anchor}`, owners.sort(), [entry.path]);
    }
  }

  assert.equal(failures.length, 0, `XH C3 PHIP SSOT contract: ${failures.length} failure(s)\n- ${failures.join('\n- ')}`);
});
