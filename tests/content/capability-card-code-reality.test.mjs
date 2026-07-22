import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const ROOT = join(import.meta.dirname, '..', '..');
const CAPABILITY_ROOT = join(ROOT, 'design_docs/harnesses/capabilities');
const HOSTS = ['claude-code', 'codex', 'cursor', 'kimi-code'];

// These cards describe runtime or cross-component behavior that cannot be proved from a stable,
// local structural signal. Keep the exclusions explicit: adding a card must either add a probe below
// or explain why it remains a human-review surface.
const MANUAL_ONLY = new Map([
  ['agent-stream-transcript', 'parser presence does not prove access to live host transcript storage'],
  ['cross-harness-session-bound-worker', 'provider execution and descendant-process cleanup need runtime probes'],
  ['goal-contract-lifecycle', 'the lifecycle spans CLI state transitions, commands, hooks, and skill guidance'],
  ['machine-wide-quota-notification', 'producer/delivery semantics are exercised by dedicated behavioral tests'],
  ['path-token-resolution', 'installed-root and host token expansion require packaged-runtime probes'],
  ['role-substrate-reinject', 'static rules and dynamic reinjection are host-specific behavioral substitutes'],
  ['stop-continuation-gate', 'continuation, release valves, and fuses require behavioral hook tests'],
]);

const HOOK_CAPABILITIES = new Map([
  ['cross-harness-cached-context', ['orchestrator-context']],
  ['cross-harness-notification-subscription', ['bootstrap-board', 'coordination-inbox']],
  ['post-tool-batch-gate', ['posttool-batch']],
  ['usage-pacing-midflight', ['usage-pacing']],
]);

function read(path) {
  return readFileSync(path, 'utf8');
}

function capabilityCards() {
  return readdirSync(CAPABILITY_ROOT)
    .filter((name) => name.endsWith('.md') && name !== 'README.md')
    .map((name) => name.slice(0, -3))
    .sort();
}

function parseHostClaims(cardId) {
  const text = read(join(CAPABILITY_ROOT, `${cardId}.md`));
  const sectionStart = text.indexOf('## Host mechanisms');
  const sectionEnd = text.indexOf('\n## ', sectionStart + 3);
  const section = text.slice(sectionStart, sectionEnd === -1 ? text.length : sectionEnd);
  const claims = new Map();
  for (const line of section.split(/\r?\n/)) {
    const cells = line
      .split('|')
      .slice(1, -1)
      .map((cell) => cell.trim());
    if (HOSTS.includes(cells[0])) claims.set(cells[0], cells[1].toLowerCase());
  }
  assert.deepEqual([...claims.keys()].sort(), [...HOSTS].sort(), `${cardId}: Host mechanisms must list all hosts`);
  return claims;
}

function claimKind(status) {
  if (status.startsWith('unsupported')) return 'unsupported';
  if (status.startsWith('partial')) return 'partial';
  return 'positive';
}

function hookCoverage(hookId, host) {
  const manifest = read(join(ROOT, 'plugin/src/hooks/_manifest/hooks.yaml'));
  const blockStart = manifest.indexOf(`  - id: ${hookId}\n`);
  const blockEnd = manifest.indexOf('\n  - id: ', blockStart + 1);
  const block = manifest.slice(blockStart, blockEnd === -1 ? manifest.length : blockEnd);
  const status = block.match(new RegExp(`^      ${host}:\\s*(\\S+)`, 'm'))?.[1] ?? '';
  assert.ok(status, `${hookId}: missing hooks.yaml host_coverage.${host}`);
  return status;
}

function implementationPayloadExists(hookId, host) {
  const dir = join(ROOT, 'plugin/src/hooks', hookId, 'implementations', host);
  if (!existsSync(dir)) return false;
  return readdirSync(dir).some((name) => /\.(?:js|sh)$/.test(name));
}

function parityForHost(hookId, host) {
  const contractPath = join(ROOT, 'plugin/src/hooks', hookId, 'CONTRACT.md');
  if (!existsSync(contractPath)) return { declared: 0, verified: true };
  const contract = read(contractPath);
  const sectionStart = contract.indexOf('## PARITY anchors');
  const sectionEnd = contract.indexOf('\n## ', sectionStart + 3);
  const section = sectionStart === -1 ? '' : contract.slice(sectionStart, sectionEnd === -1 ? contract.length : sectionEnd);
  const rules = [];
  for (const match of section.matchAll(/- rule:\s*([^\s]+)\s*\n\s*required_hosts:\s*\[([^\]]*)\]/g)) {
    const requiredHosts = match[2].split(',').map((item) => item.trim());
    if (requiredHosts.includes(host)) rules.push(match[1]);
  }
  const implementationDir = join(ROOT, 'plugin/src/hooks', hookId, 'implementations', host);
  const payload = existsSync(implementationDir)
    ? readdirSync(implementationDir)
        .filter((name) => /\.(?:js|sh)$/.test(name))
        .map((name) => read(join(implementationDir, name)))
        .join('\n')
    : '';
  return {
    declared: rules.length,
    verified: rules.every((rule) => payload.includes(`PARITY: ${rule}`)),
  };
}

function hookReality(hookId, host) {
  const status = hookCoverage(hookId, host);
  const payload = implementationPayloadExists(hookId, host);
  const parity = parityForHost(hookId, host);
  const manifestImplemented = status.startsWith('implemented');
  const implemented = manifestImplemented && payload && parity.declared > 0 && parity.verified;
  const unsupported = status === 'unsupported' && !payload;
  return { implemented, unsupported, status, payload, parity };
}

function assertNegativeHookClaim(cardId, host, kind, hookIds) {
  const realities = hookIds.map((hookId) => ({ hookId, ...hookReality(hookId, host) }));
  if (kind === 'unsupported') {
    const implemented = realities.filter((item) => item.implemented);
    assert.equal(
      implemented.length,
      0,
      `${cardId}.${host}: card says unsupported, but implemented hook reality exists: ${implemented
        .map((item) => item.hookId)
        .join(', ')}`,
    );
    for (const item of realities) {
      assert.ok(
        item.unsupported,
        `${cardId}.${host}: unsupported requires hooks.yaml=unsupported and no implementation payload; ` +
          `${item.hookId} has status=${item.status}, payload=${item.payload}`,
      );
    }
    return;
  }

  const implemented = realities.filter((item) => item.implemented);
  const unsupported = realities.filter((item) => item.unsupported);
  assert.ok(implemented.length > 0, `${cardId}.${host}: partial must have a PARITY-verified implemented slice`);
  assert.ok(unsupported.length > 0, `${cardId}.${host}: partial must retain an unsupported slice`);
}

function assertQuotaClaim(host, kind) {
  const source = read(join(ROOT, 'ccm/apps/cli/src/harnesses/composition.ts'));
  const idOffset = source.indexOf(`    id: '${host}',`);
  assert.notEqual(idOffset, -1, `ccm-quota-account.${host}: missing HarnessModule declaration`);
  const moduleStart = source.lastIndexOf('  module({', idOffset);
  const moduleEnd = source.indexOf('\n  }),', idOffset);
  assert.ok(moduleStart >= 0 && moduleEnd > moduleStart, `ccm-quota-account.${host}: malformed HarnessModule declaration`);
  const module = source.slice(moduleStart, moduleEnd);
  const portfolioStart = source.indexOf('  const capabilities: CapabilityPortfolioDraft = {');
  const portfolioEnd = source.indexOf('\n  };', portfolioStart);
  const portfolio = source.slice(portfolioStart, portfolioEnd);
  assert.match(
    portfolio,
    /'usage-observation':\s*supported\(input\.usage\)/,
    'CapabilityPortfolio must keep module-owned usage observation as an implemented slice',
  );
  const slices = {
    usage: /\busage:\s*[A-Za-z_][A-Za-z0-9_]*/.test(module),
    accountPool: /\baccount:\s*supported\(/.test(module),
    externalStatusline: /\bstatusline:\s*supported\(/.test(module),
  };
  const implemented = Object.entries(slices).filter(([, value]) => value).map(([name]) => name);
  if (kind === 'unsupported') {
    assert.deepEqual(
      implemented,
      [],
      `ccm-quota-account.${host}: card says unsupported, but code implements: ${implemented.join(', ')}`,
    );
  } else {
    assert.ok(implemented.length > 0, `ccm-quota-account.${host}: partial has no implemented slice`);
    assert.ok(implemented.length < 3, `ccm-quota-account.${host}: partial is actually fully implemented`);
  }
}

function assertWorkflowClaim(host, kind) {
  const strategy = read(join(ROOT, 'plugin/src/skills/authoring-workflows/adapters', host, 'strategy.yaml'));
  const mode = strategy.match(/^mode:\s*(\S+)/m)?.[1] ?? 'canonical';
  if (kind === 'unsupported') {
    assert.equal(mode, 'unsupported_stub', `workflow-authoring.${host}: unsupported card requires unsupported_stub`);
  } else {
    assert.notEqual(mode, 'unsupported_stub', `workflow-authoring.${host}: partial cannot project only a stub`);
  }
}

test('every capability card is mechanically mapped or explicitly manual-only', () => {
  const mapped = new Set([...HOOK_CAPABILITIES.keys(), 'ccm-quota-account', 'workflow-authoring']);
  assert.deepEqual(
    capabilityCards(),
    [...mapped, ...MANUAL_ONLY.keys()].sort(),
    'new capability cards must add a structural probe or an explicit manual-only reason',
  );
});

test('unsupported/partial hook capability claims agree with manifest, payload, and PARITY anchors', () => {
  for (const [cardId, hookIds] of HOOK_CAPABILITIES) {
    for (const [host, status] of parseHostClaims(cardId)) {
      const kind = claimKind(status);
      if (kind !== 'positive') assertNegativeHookClaim(cardId, host, kind, hookIds);
    }
  }
});

test('unsupported/partial ccm quota-account claims agree with harness capability code', () => {
  for (const [host, status] of parseHostClaims('ccm-quota-account')) {
    const kind = claimKind(status);
    if (kind !== 'positive') assertQuotaClaim(host, kind);
  }
});

test('unsupported/partial workflow claims agree with adapter projection strategy', () => {
  for (const [host, status] of parseHostClaims('workflow-authoring')) {
    const kind = claimKind(status);
    if (kind !== 'positive') assertWorkflowClaim(host, kind);
  }
});

for (const [cardId, reason] of MANUAL_ONLY) {
  test.skip(`manual-only capability check: ${cardId} — ${reason}`, () => {});
}
