// handler-harness.test.ts — supported harness inventory command.

import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
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
    env: {
      HOME: root,
      PATH: join(root, 'bin'),
      CODEX_HOME: codexHome,
      CC_MASTER_NO_AUTOINSTALL: '1',
    },
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
  const codexHome = join(root, '.codex');
  mkdirSync(codexHome, { recursive: true });
  const out: string[] = [];
  const err: string[] = [];

  const code = run(['--harness', 'codex', 'harness', 'list', '--machine-wide', '--json'], {
    out: (s) => out.push(s),
    err: (s) => err.push(s),
    env: {
      HOME: root,
      PATH: join(root, 'bin'),
      CODEX_HOME: codexHome,
      CC_MASTER_NO_AUTOINSTALL: '1',
    },
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

test('machine-wide inventory keeps Cursor IDE and Agent CLI as independent canonical surfaces', () => {
  const root = mkdtempSync(join(tmpdir(), 'ccm-harness-cursor-surfaces-'));
  const bin = join(root, 'bin');
  const home = join(root, 'home');
  mkdirSync(bin, { recursive: true });
  mkdirSync(home, { recursive: true });
  const agent = join(bin, 'agent');
  writeFileSync(
    agent,
    `#!${process.execPath}\n` +
      `const a=process.argv.slice(2).join(' ');\n` +
      `if(a==='--version')console.log('2026.07.09-a3815c0');\n` +
      `else if(a==='--help')console.log('--print --output-format --workspace --model status');\n` +
      `else if(a==='status --help')console.log('--format <json|text>');\n` +
      `else if(a==='status --format json')console.log(JSON.stringify({isAuthenticated:true,userInfo:{email:'private@example.test'}}));\n` +
      `else process.exit(64);\n`,
  );
  chmodSync(agent, 0o755);
  const out: string[] = [];
  const err: string[] = [];

  const code = run(['--harness', 'codex', 'harness', 'list', '--machine-wide', '--json'], {
    out: (s) => out.push(s),
    err: (s) => err.push(s),
    env: { HOME: home, PATH: bin, CC_MASTER_NO_AUTOINSTALL: '1' },
  });

  assert.equal(code, 0, err.join('\n'));
  const parsed = JSON.parse(out[out.length - 1] || '{}');
  const inventory = parsed.data.surfaceInventory;
  assert.equal(inventory.schema, 'ccm/machine-surface-inventory/v1');
  assert.equal(Buffer.byteLength(JSON.stringify(inventory), 'utf8') <= 4096, true);
  assert.deepEqual(
    inventory.surfaces.map((surface: { surface_id: string }) => surface.surface_id),
    ['cursor-ide-plugin', 'cursor-agent-cli'],
  );
  const ide = inventory.surfaces[0];
  const headless = inventory.surfaces[1];
  assert.equal(ide.installed, false);
  assert.equal(ide.auth.state, 'unknown');
  assert.equal(headless.installed, true);
  assert.equal(headless.auth.state, 'authenticated');
  assert.equal(headless.model.state, 'unknown');
  assert.equal(headless.quota.state, 'unknown');
  assert.equal(headless.eligibility.automatic, false);
  assert.deepEqual(inventory.eligible_surface_ids, []);
  assert.equal(JSON.stringify(inventory).includes('private@example.test'), false);
});

test('machine-wide surface inventory is mechanically capped under adversarial binary input', () => {
  const root = mkdtempSync(join(tmpdir(), 'ccm-harness-cursor-bounded-'));
  const home = join(root, 'home');
  const bin = join(root, 'bin');
  mkdirSync(home, { recursive: true });
  mkdirSync(bin, { recursive: true });
  const out: string[] = [];
  const err: string[] = [];
  const longMissingOverride = `/missing/${'x'.repeat(5_000)}`;

  const code = run(['--harness', 'codex', 'harness', 'list', '--machine-wide', '--json'], {
    out: (s) => out.push(s),
    err: (s) => err.push(s),
    env: {
      HOME: home,
      PATH: bin,
      CCM_CURSOR_AGENT_BIN: longMissingOverride,
      CC_MASTER_NO_AUTOINSTALL: '1',
    },
  });

  assert.equal(code, 0, err.join('\n'));
  const inventory = JSON.parse(out[out.length - 1] || '{}').data.surfaceInventory;
  assert.equal(Buffer.byteLength(JSON.stringify(inventory), 'utf8') <= 4096, true);
  assert.equal(inventory.truncation.applied, true);
  assert.equal(inventory.truncation.max_bytes, 4096);
  assert.ok(inventory.truncation.fields.includes('cursor-agent-cli.binary.name'));
  assert.deepEqual(inventory.eligible_surface_ids, []);
  const headless = inventory.surfaces.find(
    (surface: { surface_id: string }) => surface.surface_id === 'cursor-agent-cli',
  );
  assert.equal(headless.eligibility.automatic, false);
  assert.equal(headless.negative_capabilities.account_switch, 'forbidden');
  assert.equal(headless.negative_capabilities.credential_mutation, 'forbidden');
});
