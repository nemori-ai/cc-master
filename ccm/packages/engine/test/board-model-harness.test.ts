// board-model-harness.test.ts — owner.harness field + FMT-HARNESS warning contract.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as M from '../dist/index.mjs';

function makeBoard(harness?: unknown): Record<string, unknown> {
  const owner: Record<string, unknown> = {
    active: true,
    session_id: 'sid-1',
    heartbeat: '2026-07-09T00:00:00Z',
  };
  if (harness !== undefined) owner.harness = harness;
  return {
    schema: 'cc-master/v2',
    goal: 'g',
    owner,
    git: {},
    tasks: [],
  };
}

test('ENUMS exposes closed harness ids including unknown fallback', () => {
  assert.deepEqual(M.ENUMS.harness, ['claude-code', 'codex', 'cursor', 'unknown']);
});

test('FIELDS documents owner.harness as optional non-gating subfield', () => {
  const owner = M.FIELDS.board.owner;
  assert.equal(owner.tier, '🔒');
  assert.match(owner.type, /harness\?:claude-code\|codex\|cursor\|unknown/);
  assert.match(owner.degrade, /harness 缺→unknown/);
});

test('INVARIANTS includes FMT-HARNESS at warn level', () => {
  const inv = M.INVARIANTS.find((i: { id: string }) => i.id === 'FMT-HARNESS');
  assert.ok(inv, 'FMT-HARNESS must be registered');
  assert.equal(inv.level, 'warn');
  assert.equal(inv.family, 'FMT');
});

test('missing owner.harness is backward-compatible (no warning)', () => {
  const result = M.lintBoard(JSON.stringify(makeBoard()));
  assert.equal(result.errors.length, 0);
  assert.equal(
    result.warnings.find((w: { rule: string }) => w.rule === 'FMT-HARNESS'),
    undefined,
  );
});

test('valid owner.harness values do not warn', () => {
  for (const harness of M.ENUMS.harness) {
    const result = M.lintBoard(JSON.stringify(makeBoard(harness)));
    assert.equal(result.errors.length, 0);
    assert.equal(
      result.warnings.find((w: { rule: string }) => w.rule === 'FMT-HARNESS'),
      undefined,
      `unexpected FMT-HARNESS warning for ${harness}`,
    );
  }
});

test('invalid owner.harness warns but never hard-fails', () => {
  const result = M.lintBoard(JSON.stringify(makeBoard('future-harness')));
  assert.equal(result.errors.length, 0);
  assert.ok(result.warnings.find((w: { rule: string }) => w.rule === 'FMT-HARNESS'));
});
