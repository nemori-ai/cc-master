// handler-harness.test.ts — supported harness inventory command.

import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { run } from '../src/router.js';

test('ccm harness list --json reports installed supported harnesses and current selection', () => {
  const root = mkdtempSync(join(tmpdir(), 'ccm-harness-list-'));
  const bin = join(root, 'bin');
  const codexHome = join(root, '.codex');
  mkdirSync(bin, { recursive: true });
  mkdirSync(codexHome, { recursive: true });
  const out: string[] = [];
  const err: string[] = [];

  const code = run(['--harness', 'codex', 'harness', 'list', '--json'], {
    out: (s) => out.push(s),
    err: (s) => err.push(s),
    env: { HOME: root, PATH: bin, CODEX_HOME: codexHome, CC_MASTER_NO_AUTOINSTALL: '1' },
  });

  assert.equal(code, 0, err.join('\n'));
  const parsed = JSON.parse(out[out.length - 1] || '{}');
  assert.equal(parsed.ok, true);
  assert.equal(parsed.data.current, 'codex');
  const codex = parsed.data.harnesses.find((h: { id: string }) => h.id === 'codex');
  assert.equal(codex.installed, true);
  assert.equal(codex.capabilities.pluginDistribution.supported, true);
});

test('ccm harness list --machine-wide --json reports registry coordinates', () => {
  const root = mkdtempSync(join(tmpdir(), 'ccm-harness-machine-list-'));
  const bin = join(root, 'bin');
  const codexHome = join(root, '.codex');
  mkdirSync(bin, { recursive: true });
  mkdirSync(codexHome, { recursive: true });
  const out: string[] = [];
  const err: string[] = [];

  const code = run(['--harness', 'codex', 'harness', 'list', '--machine-wide', '--json'], {
    out: (s) => out.push(s),
    err: (s) => err.push(s),
    env: { HOME: root, PATH: bin, CODEX_HOME: codexHome, CC_MASTER_NO_AUTOINSTALL: '1' },
  });

  assert.equal(code, 0, err.join('\n'));
  const parsed = JSON.parse(out[out.length - 1] || '{}');
  assert.equal(parsed.ok, true);
  assert.equal(parsed.data.current, 'codex');
  assert.equal(parsed.data.machineWide, true);
  assert.equal(parsed.data.schema, 'ccm/machine-harness-registry/v1');

  const codex = parsed.data.harnesses.find((h: { id: string }) => h.id === 'codex');
  assert.equal(codex.usageSource.kind, 'app-server');
  assert.deepEqual(codex.sessionStoreRoots, [join(codexHome, 'sessions')]);

  const claude = parsed.data.harnesses.find((h: { id: string }) => h.id === 'claude-code');
  assert.equal(claude.usageSource.quotaModel, 'rolling-5h-7d');
  assert.equal(claude.accountPoolLocation, join(root, '.cc_master', 'accounts.json'));
});

test('ccm harness list renders a headless-only cursor-agent without claiming Cursor IDE', () => {
  const root = mkdtempSync(join(tmpdir(), 'ccm-harness-cursor-agent-only-'));
  const bin = join(root, 'bin');
  mkdirSync(bin, { recursive: true });
  const agentPath = join(bin, 'cursor-agent');
  writeFileSync(agentPath, '#!/bin/sh\nexit 0\n');
  chmodSync(agentPath, 0o755);

  const jsonOut: string[] = [];
  const jsonErr: string[] = [];
  const jsonCode = run(['harness', 'list', '--json'], {
    out: (s) => jsonOut.push(s),
    err: (s) => jsonErr.push(s),
    env: { HOME: join(root, 'home'), PATH: bin, CC_MASTER_NO_AUTOINSTALL: '1' },
  });
  assert.equal(jsonCode, 0, jsonErr.join('\n'));
  const parsed = JSON.parse(jsonOut[jsonOut.length - 1] || '{}');
  const cursor = parsed.data.harnesses.find((h: { id: string }) => h.id === 'cursor');
  const ide = cursor.surfaces.find((surface: { id: string }) => surface.id === 'cursor-ide-plugin');
  const agent = cursor.surfaces.find((surface: { id: string }) => surface.id === 'cursor-agent');
  assert.equal(cursor.installed, false);
  assert.equal(parsed.data.installed.includes('cursor'), false);
  assert.deepEqual(parsed.data.installedSurfaces, ['cursor-agent']);
  assert.equal(ide.installed, false);
  assert.equal(agent.installed, true);
  assert.equal(agent.available, true);
  assert.equal(agent.binary.name, 'cursor-agent');
  assert.equal(agent.binary.path, agentPath);
  assert.equal(agent.facts.authentication.state, 'unknown');
  assert.equal(agent.facts.quota.state, 'unknown');
  assert.equal(agent.capabilities.accountMutation.state, 'forbidden');
  assert.equal(JSON.stringify(parsed).includes('credential'), false);

  const textOut: string[] = [];
  const textErr: string[] = [];
  const textCode = run(['harness', 'list'], {
    out: (s) => textOut.push(s),
    err: (s) => textErr.push(s),
    env: { HOME: join(root, 'home'), PATH: bin, CC_MASTER_NO_AUTOINSTALL: '1' },
  });
  assert.equal(textCode, 0, textErr.join('\n'));
  const rendered = textOut.join('\n');
  assert.match(rendered, /cursor\s+plugin-target=missing.*plugin-dist=yes/);
  assert.doesNotMatch(rendered, /cursor\s+missing/);
  assert.doesNotMatch(rendered, /cursor\s+.*plugin=yes/);
  assert.match(rendered, /cursor-ide-plugin\s+ide-plugin\s+missing\/unavailable/);
  assert.match(rendered, /cursor-agent\s+cli-headless\s+installed\/available/);
  assert.match(rendered, new RegExp(`binary=${escapeRegExp(agentPath)}`));
  assert.match(
    rendered,
    /auth=unknown quota=unknown account-mutation=forbidden autoswitch=unsupported/,
  );
  assert.match(rendered, /cursor-agent.*plugin-dist=unsupported/);
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
