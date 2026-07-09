// harness-registry.test.ts — HarnessAdapter selection contract.

import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  harnessSessionId,
  inspectKnownHarnesses,
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

test('Codex thread marker wins over Claude-compatible fallback and mixed local env', () => {
  assert.equal(
    resolveHarnessId({
      env: { CODEX_THREAD_ID: 'cx-thread', CLAUDE_CODE_SSE_PORT: '32445' },
    }),
    'codex',
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
