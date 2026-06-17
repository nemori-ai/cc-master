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

test('board.template.json carries meta.template_version (integer ≥ 1) — agent-shaped, NOT the pinned waist', () => {
  const b = read(`${A}/board.template.json`);
  // meta.template_version is an agent-shaped namespace field (red line 2: never the
  // hook-read narrow waist `schema`). It lets the timeline gate the real-time axis on
  // "this-release-or-later" boards. Lock it into the content contract to prevent regression.
  assert.ok(b.meta && typeof b.meta === 'object', 'board.template.json must carry a top-level meta object');
  assert.ok(Number.isInteger(b.meta.template_version), 'meta.template_version must be an integer');
  assert.ok(b.meta.template_version >= 1, 'meta.template_version must be ≥ 1');
});

test('board.example.json is a valid worked board with ≥1 task carrying id/status/deps', () => {
  const b = read(`${A}/board.example.json`);
  assert.equal(b.schema, 'cc-master/v1');
  assert.ok(b.tasks.length >= 1);
  for (const t of b.tasks) { assert.ok(t.id && t.status); assert.ok(Array.isArray(t.deps)); }
});
