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

test('board.template.json carries num_account default 1 — soft-observed, NOT the pinned waist', () => {
  const b = read(`${A}/board.template.json`);
  // num_account is the third soft-observed field (usage-pacing.js reads it to scale pacing cadence ×N).
  // It is NOT the hook-required narrow waist (red line 2): missing/non-positive degrades to 1 in-hook.
  // The template ships the default 1 so bootstrap's literal-anchored sed has an anchor to stamp the real
  // --num_account value onto. Lock the default into the content contract to prevent regression.
  assert.ok(Number.isInteger(b.num_account), 'board.template.json must carry an integer top-level num_account');
  assert.equal(b.num_account, 1, 'template num_account default must be 1');
});

test('board.example.json is a valid worked board with ≥1 task carrying id/status/deps', () => {
  const b = read(`${A}/board.example.json`);
  assert.equal(b.schema, 'cc-master/v1');
  assert.ok(b.tasks.length >= 1);
  for (const t of b.tasks) { assert.ok(t.id && t.status); assert.ok(Array.isArray(t.deps)); }
});

test('board.example.json demonstrates a per-task observability edge — agent-shaped telemetry, NOT the pinned waist', () => {
  const b = read(`${A}/board.example.json`);
  // observability is an OPTIONAL per-task agent-shaped flexible edge (red line 2): orchestrator copies
  // the completion notification's <usage> block (subagent_tokens/duration_ms/tool_uses) into it when it
  // marks a node done. NO hook reads it — board-lint is silent-on-unknown, so it ships zero hook/lint
  // change. The example must demonstrate one shape so readers (view.html / retrospective) see the schema.
  const withObs = b.tasks.find((t) => t && typeof t.observability === 'object' && t.observability);
  assert.ok(withObs, 'board.example.json must demonstrate ≥1 task carrying an observability object');
  const o = withObs.observability;
  assert.ok(Number.isFinite(o.total_tokens), 'observability.total_tokens must be a number');
  assert.ok(Number.isFinite(o.duration_ms), 'observability.duration_ms must be a number');
  assert.ok(typeof o.source === 'string' && o.source.length > 0, 'observability.source must label the provenance');
  // RED LINE 2: observability is agent-shaped, never the hook-read narrow waist. The template (the
  // bootstrap-seeded skeleton, tasks:[]) carries NO observability — it is filled per-node at runtime.
  const tmpl = read(`${A}/board.template.json`);
  assert.deepEqual(tmpl.tasks, [], 'template ships empty tasks[] — observability is filled per-node at runtime, never seeded');
});
