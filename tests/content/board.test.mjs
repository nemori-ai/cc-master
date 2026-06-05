import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const A = 'skills/orchestrating-to-completion/assets';
const read = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));

test('board.template.json is the empty skeleton with the pinned schema + empty goal', () => {
  const b = read(`${A}/board.template.json`);
  assert.equal(b.schema, 'cc-master/v1');
  assert.equal(b.goal, '');            // bootstrap leaves goal empty; agent fills it
  assert.equal(b.owner.active, true);
  assert.deepEqual(b.tasks, []);
  assert.ok('git' in b && 'log' in b);
});

test('board.example.json is a valid worked board with ≥1 task carrying id/status/deps', () => {
  const b = read(`${A}/board.example.json`);
  assert.equal(b.schema, 'cc-master/v1');
  assert.ok(b.tasks.length >= 1);
  for (const t of b.tasks) { assert.ok(t.id && t.status); assert.ok(Array.isArray(t.deps)); }
});
