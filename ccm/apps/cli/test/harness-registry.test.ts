// harness-registry.test.ts — HarnessAdapter selection contract.

import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { test } from 'node:test';
import {
  detectTrustedHarnessId,
  harnessSessionId,
  inspectKnownHarnesses,
  MachineHarnessRegistry,
  resolveHarnessAdapter,
  resolveHarnessId,
} from '../src/harnesses/registry.js';

test('--harness flag wins over env aliases', () => {
  const adapter = resolveHarnessAdapter({
    harnessFlag: 'codex',
    env: { CC_MASTER_HARNESS: 'claude-code', CLAUDE_CODE_SESSION_ID: 'cc-sid' },
  });
  assert.equal(adapter.id, 'codex');
});

test('CC_MASTER_HARNESS wins over legacy host env aliases', () => {
  assert.equal(
    resolveHarnessId({
      env: { CC_MASTER_HARNESS: 'codex', CC_MASTER_HOST: 'claude-code' },
    }),
    'codex',
  );
});

test('legacy host env aliases still work', () => {
  assert.equal(resolveHarnessId({ env: { CC_MASTER_HOST: 'openai-codex' } }), 'codex');
  assert.equal(resolveHarnessId({ env: { CCM_HOST: 'claude' } }), 'claude-code');
});

test('explicit unknown harness uses generic adapter, not Claude fallback', () => {
  const adapter = resolveHarnessAdapter({ harnessFlag: 'future-agent', env: {} });
  assert.equal(adapter.id, 'future-agent');
  assert.equal(adapter.accountPool.supported, false);
  assert.equal(adapter.externalStatusline.supported, false);
  assert.equal(adapter.readCurrentUsage({}).source, 'unavailable');
});

test('auto-detect recognizes Codex and Claude Code markers', () => {
  assert.equal(resolveHarnessId({ env: { CODEX_SESSION_ID: 'cx-sid' } }), 'codex');
  assert.equal(resolveHarnessId({ env: { CODEX_THREAD_ID: 'cx-thread' } }), 'codex');
  assert.equal(resolveHarnessId({ env: { CLAUDE_CODE_SESSION_ID: 'cc-sid' } }), 'claude-code');
});

test('auto-detect recognizes CURSOR_AGENT → cursor', () => {
  assert.equal(resolveHarnessId({ env: { CURSOR_AGENT: '1' } }), 'cursor');
  assert.equal(resolveHarnessId({ env: { CURSOR_CONVERSATION_ID: 'conv-1' } }), 'cursor');
});

test('Codex thread marker wins over Claude-compatible fallback and mixed local env', () => {
  assert.equal(
    resolveHarnessId({
      env: { CODEX_THREAD_ID: 'cx-thread', CLAUDE_CODE_SSE_PORT: '32445' },
    }),
    'codex',
  );
});

test('CURSOR_AGENT wins over CLAUDE_CODE_SSE_PORT', () => {
  assert.equal(
    resolveHarnessId({
      env: { CURSOR_AGENT: '1', CLAUDE_CODE_SSE_PORT: '32445' },
    }),
    'cursor',
  );
});

test('no explicit harness and no detection keeps transitional Claude-compatible default', () => {
  assert.equal(resolveHarnessId({ env: {} }), 'claude-code');
});

test('trusted harness detection ignores transitional default and explicit flags', () => {
  assert.equal(detectTrustedHarnessId({}), null);
  assert.equal(detectTrustedHarnessId({ CC_MASTER_HARNESS: 'codex' }), null);
  assert.equal(detectTrustedHarnessId({ CODEX_SESSION_ID: 'cx-sid' }), 'codex');
  assert.equal(detectTrustedHarnessId({ CURSOR_AGENT: '1' }), 'cursor');
  assert.equal(detectTrustedHarnessId({ CLAUDE_CODE_SESSION_ID: 'cc-sid' }), 'claude-code');
});

test('session id comes from selected adapter', () => {
  assert.equal(
    harnessSessionId({
      harnessFlag: 'codex',
      env: { CODEX_SESSION_ID: 'cx-sid', CLAUDE_CODE_SESSION_ID: 'cc-sid' },
    }),
    'cx-sid',
  );
  assert.equal(
    harnessSessionId({
      env: { CODEX_THREAD_ID: 'cx-thread', CLAUDE_CODE_SSE_PORT: '32445' },
    }),
    'cx-thread',
  );
  assert.equal(harnessSessionId({ harnessFlag: 'future-agent', env: {} }), '');
});

test('inspectKnownHarnesses detects installed supported harnesses from PATH/config', () => {
  const root = mkdtempSync(join(tmpdir(), 'ccm-harness-probe-'));
  const bin = join(root, 'codex');
  writeFileSync(bin, '#!/bin/sh\nexit 0\n');
  chmodSync(bin, 0o755);

  const inv = inspectKnownHarnesses({
    PATH: root,
    HOME: join(root, 'home'),
    CODEX_SESSION_ID: 'cx-sid',
  });
  const codex = inv.find((h) => h.id === 'codex');
  assert.ok(codex);
  assert.equal(codex?.installed, true);
  assert.equal(codex?.active, true);
  assert.equal(codex?.cli.path, bin);
  assert.equal(codex?.capabilities.pluginDistribution.supported, true);
});

test('Cursor inventory keeps IDE plugin and headless agent as independent surfaces', () => {
  const cases = [
    { name: 'only-agent', ide: false, agent: true },
    { name: 'only-IDE', ide: true, agent: false },
    { name: 'both', ide: true, agent: true },
    { name: 'neither', ide: false, agent: false },
  ] as const;

  for (const fixture of cases) {
    const root = mkdtempSync(join(tmpdir(), `ccm-cursor-surfaces-${fixture.name}-`));
    const bin = join(root, 'bin');
    mkdirSync(bin, { recursive: true });
    if (fixture.ide) writeExecutable(join(bin, 'cursor'));
    if (fixture.agent) writeExecutable(join(bin, 'cursor-agent'));

    const cursor = inspectKnownHarnesses({ PATH: bin, HOME: join(root, 'home') }).find(
      (h) => h.id === 'cursor',
    );
    assert.ok(cursor, fixture.name);
    const ide = cursor.surfaces.find((surface) => surface.id === 'cursor-ide-plugin');
    const agent = cursor.surfaces.find((surface) => surface.id === 'cursor-agent');
    assert.ok(ide, fixture.name);
    assert.ok(agent, fixture.name);

    assert.equal(cursor.installed, fixture.ide, `${fixture.name}: top-level remains IDE-only`);
    assert.equal(ide.kind, 'ide-plugin');
    assert.equal(ide.installed, fixture.ide, fixture.name);
    assert.equal(ide.available, fixture.ide, fixture.name);
    assert.equal(agent.kind, 'cli-headless');
    assert.equal(agent.installed, fixture.agent, fixture.name);
    assert.equal(agent.available, fixture.agent, fixture.name);
    assert.equal(agent.binary.name, 'cursor-agent');
    assert.equal(agent.binary.path, fixture.agent ? join(bin, 'cursor-agent') : null);
    assert.deepEqual(agent.facts.authentication, { state: 'unknown', source: 'not-probed' });
    assert.deepEqual(agent.facts.quota, { state: 'unknown', source: 'not-probed' });
    assert.equal(agent.capabilities.accountMutation.state, 'forbidden');
    assert.equal(agent.capabilities.accountAutoswitch.state, 'unsupported');
    assert.equal(agent.capabilities.pluginDistribution.state, 'unsupported');
  }
});

test('Cursor headless executable probe accepts symlinks and rejects non-executable files', () => {
  const symlinkRoot = mkdtempSync(join(tmpdir(), 'ccm-cursor-agent-symlink-'));
  const target = join(symlinkRoot, 'versions', 'cursor-agent-real');
  const link = join(symlinkRoot, 'bin', 'cursor-agent');
  mkdirSync(join(symlinkRoot, 'versions'), { recursive: true });
  mkdirSync(join(symlinkRoot, 'bin'), { recursive: true });
  writeExecutable(target);
  symlinkSync(target, link);

  const linkedCursor = inspectKnownHarnesses({
    PATH: join(symlinkRoot, 'bin'),
    HOME: join(symlinkRoot, 'home'),
  }).find((h) => h.id === 'cursor');
  const linkedAgent = linkedCursor?.surfaces.find((surface) => surface.id === 'cursor-agent');
  assert.equal(linkedAgent?.installed, true);
  assert.equal(linkedAgent?.available, true);
  assert.equal(linkedAgent?.binary.path, link);

  const nonExecutableRoot = mkdtempSync(join(tmpdir(), 'ccm-cursor-agent-nonexec-'));
  const nonExecutableBin = join(nonExecutableRoot, 'bin');
  mkdirSync(nonExecutableBin, { recursive: true });
  writeFileSync(join(nonExecutableBin, 'cursor-agent'), '#!/bin/sh\nexit 0\n');

  const nonExecutableCursor = inspectKnownHarnesses({
    PATH: nonExecutableBin,
    HOME: join(nonExecutableRoot, 'home'),
  }).find((h) => h.id === 'cursor');
  const nonExecutableAgent = nonExecutableCursor?.surfaces.find(
    (surface) => surface.id === 'cursor-agent',
  );
  assert.equal(nonExecutableAgent?.installed, false);
  assert.equal(nonExecutableAgent?.available, false);
  assert.equal(nonExecutableAgent?.binary.path, null);
});

test('Cursor headless executable probe rejects searchable directories', () => {
  const root = mkdtempSync(join(tmpdir(), 'ccm-cursor-agent-directory-'));
  const bin = join(root, 'bin');
  mkdirSync(join(bin, 'cursor-agent'), { recursive: true });

  const cursor = inspectKnownHarnesses({ PATH: bin, HOME: join(root, 'home') }).find(
    (h) => h.id === 'cursor',
  );
  const agent = cursor?.surfaces.find((surface) => surface.id === 'cursor-agent');
  assert.equal(agent?.installed, false);
  assert.equal(agent?.available, false);
  assert.equal(agent?.binary.path, null);
});

test('Cursor headless executable probe reports an absolute path from relative PATH entries', () => {
  const root = mkdtempSync(join(tmpdir(), 'ccm-cursor-agent-relative-path-'));
  const bin = join(root, 'bin');
  mkdirSync(bin, { recursive: true });
  writeExecutable(join(bin, 'cursor-agent'));

  const cursor = inspectKnownHarnesses({
    PATH: relative(process.cwd(), bin),
    HOME: join(root, 'home'),
  }).find((h) => h.id === 'cursor');
  const agent = cursor?.surfaces.find((surface) => surface.id === 'cursor-agent');
  assert.equal(agent?.installed, true);
  assert.equal(agent?.available, true);
  assert.equal(agent?.binary.path, join(bin, 'cursor-agent'));
});

test('harness adapters expose machine-wide registry coordinates', () => {
  const root = mkdtempSync(join(tmpdir(), 'ccm-harness-coords-'));
  const claudeConfig = join(root, 'claude-config');
  const ccmHome = join(root, 'ccm-home');
  const codexHome = join(root, 'codex-home');
  const cursorState = join(root, 'Cursor', 'User', 'globalStorage', 'state.vscdb');

  const claude = resolveHarnessAdapter({ harnessFlag: 'claude-code', env: {} });
  assert.deepEqual(claude.sessionStoreRoots({ HOME: root, CLAUDE_CONFIG_DIR: claudeConfig }), [
    join(claudeConfig, 'projects'),
  ]);
  assert.deepEqual(claude.usageSource({}), {
    kind: 'statusline-sidecar',
    pollable: false,
    quotaModel: 'rolling-5h-7d',
  });
  assert.equal(
    claude.accountPoolLocation({ HOME: root, CC_MASTER_HOME: ccmHome }),
    join(ccmHome, 'accounts.json'),
  );

  const codex = resolveHarnessAdapter({ harnessFlag: 'codex', env: {} });
  assert.deepEqual(codex.sessionStoreRoots({ HOME: root, CODEX_HOME: codexHome }), [
    join(codexHome, 'sessions'),
  ]);
  assert.deepEqual(codex.usageSource({}), {
    kind: 'app-server',
    pollable: true,
    quotaModel: 'primary-secondary',
  });
  assert.equal(codex.accountPoolLocation({ HOME: root }), null);

  const cursor = resolveHarnessAdapter({ harnessFlag: 'cursor', env: {} });
  assert.deepEqual(cursor.sessionStoreRoots({ HOME: root, CCM_CURSOR_STATE_DB: cursorState }), [
    join(root, 'Cursor', 'User', 'globalStorage'),
  ]);
  assert.deepEqual(cursor.usageSource({}), {
    kind: 'dashboard-api',
    pollable: true,
    quotaModel: 'billing-period',
  });
  assert.equal(cursor.accountPoolLocation({ HOME: root }), null);
});

test('MachineHarnessRegistry.sweep walks all known adapters into an immutable snapshot', () => {
  const root = mkdtempSync(join(tmpdir(), 'ccm-machine-harness-'));
  mkdirSync(join(root, 'bin'), { recursive: true });
  writeExecutable(join(root, 'bin', 'cursor-agent'));
  mkdirSync(join(root, '.codex'), { recursive: true });
  mkdirSync(join(root, '.claude'), { recursive: true });

  const registry = MachineHarnessRegistry.sweep({
    HOME: root,
    PATH: join(root, 'bin'),
    CODEX_HOME: join(root, '.codex'),
    CC_MASTER_HARNESS: 'codex',
  });
  const snapshot = registry.toJSON();

  assert.equal(snapshot.schema, 'ccm/machine-harness-registry/v1');
  assert.deepEqual(
    snapshot.harnesses.map((h) => h.id),
    ['codex', 'cursor', 'claude-code'],
  );
  assert.ok(snapshot.installed.includes('codex'));
  assert.ok(snapshot.installed.includes('claude-code'));
  assert.equal(registry.byId('cursor')?.usageSource.quotaModel, 'billing-period');
  assert.deepEqual(snapshot.installedSurfaces, ['cursor-agent']);
  assert.equal(registry.byId('cursor')?.installed, false);
  assert.equal(registry.byId('cursor')?.surfaces.length, 2);
  assert.equal(registry.poolOf('claude-code')?.location, join(root, '.cc_master', 'accounts.json'));
  assert.equal(registry.poolOf('codex'), null);
  assert.equal(Object.isFrozen(snapshot.harnesses), true);
  assert.equal(Object.isFrozen(snapshot.harnesses[0]), true);
  assert.equal(Object.isFrozen(registry.byId('cursor')?.surfaces), true);
});

function writeExecutable(path: string): void {
  writeFileSync(path, '#!/bin/sh\nexit 0\n');
  chmodSync(path, 0o755);
}
