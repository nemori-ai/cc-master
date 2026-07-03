// handler-harness.test.ts — supported harness inventory command.

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { run } from '../src/router.js';

test('ccm harness list --json reports installed supported harnesses and current selection', () => {
  const root = mkdtempSync(join(tmpdir(), 'ccm-harness-list-'));
  const codexHome = join(root, '.codex');
  mkdirSync(codexHome, { recursive: true });
  const out: string[] = [];
  const err: string[] = [];

  const code = run(['--harness', 'codex', 'harness', 'list', '--json'], {
    out: (s) => out.push(s),
    err: (s) => err.push(s),
    env: { HOME: root, CODEX_HOME: codexHome, CC_MASTER_NO_AUTOINSTALL: '1' },
  });

  assert.equal(code, 0, err.join('\n'));
  const parsed = JSON.parse(out[out.length - 1] || '{}');
  assert.equal(parsed.ok, true);
  assert.equal(parsed.data.current, 'codex');
  const codex = parsed.data.harnesses.find((h: { id: string }) => h.id === 'codex');
  assert.equal(codex.installed, true);
  assert.equal(codex.capabilities.pluginDistribution.supported, true);
});
