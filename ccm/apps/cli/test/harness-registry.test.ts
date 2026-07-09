// harness-registry.test.ts — HarnessAdapter selection contract.

import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
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
  mkdirSync(join(root, '.codex'), { recursive: true });
  mkdirSync(join(root, '.claude'), { recursive: true });

  const registry = MachineHarnessRegistry.sweep({
    HOME: root,
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
  assert.equal(registry.poolOf('claude-code')?.location, join(root, '.cc_master', 'accounts.json'));
  assert.equal(registry.poolOf('codex'), null);
  assert.equal(Object.isFrozen(snapshot.harnesses), true);
  assert.equal(Object.isFrozen(snapshot.harnesses[0]), true);
});
