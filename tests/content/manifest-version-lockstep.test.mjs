import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';

const ROOT = join(import.meta.dirname, '..', '..');
const MANIFESTS = {
  'claude-code': 'plugin/src/.claude-plugin/plugin.json',
  codex: 'plugin/src/.codex-plugin/plugin.json',
  cursor: 'plugin/src/.cursor-plugin/plugin.json',
  'kimi-code': 'plugin/src/.kimi-plugin/plugin.json',
};

// 防 per-host manifest 版本漂（rc2 dogfood）。
test('all four host plugin manifests keep their versions in lockstep', () => {
  const versions = Object.entries(MANIFESTS).map(([host, manifest]) => ({
    host,
    version: JSON.parse(readFileSync(join(ROOT, manifest), 'utf8')).version,
  }));
  const uniqueVersions = new Set(versions.map(({ version }) => version));
  const driftMessage =
    `per-host plugin manifest version drift: ` +
    versions.map(({ host, version }) => `${host}=${version}`).join(', ');

  if (uniqueVersions.size !== 1) process.stderr.write(`${driftMessage}\n`);

  assert.equal(
    uniqueVersions.size,
    1,
    driftMessage,
  );
});
