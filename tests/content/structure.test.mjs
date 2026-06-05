import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

test('plugin.json is valid and well-formed', () => {
  const j = JSON.parse(read('.claude-plugin/plugin.json'));
  assert.equal(j.name, 'cc-master');
  assert.ok(typeof j.version === 'string' && j.version.length > 0);
  assert.ok(typeof j.description === 'string' && j.description.length > 0);
});
