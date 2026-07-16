import assert from 'node:assert/strict';
import { test } from 'node:test';
import { boardInit, boardUpdate } from '../src/mutations.js';
import { REGISTRY } from '../src/registry.js';

test('GC-09: registry exposes the dedicated goal lifecycle', () => {
  assert.deepEqual(Object.keys(REGISTRY.goal ?? {}).sort(), [
    'amend',
    'check',
    'confirm',
    'deadline',
    'set',
    'show',
  ]);
});

test('GC-01: fresh board starts as an empty pending skeleton', () => {
  const fresh = boardInit();
  assert.equal(fresh.goal, '');
  assert.deepEqual(fresh.goal_contract, {
    schema: 'ccm/goal-contract/v1',
    revision: 1,
    assurance: 'pending',
    updated_at: fresh.goal_contract.updated_at,
  });
});

test('GC-01: github issue remains source evidence and is not copied into goal', () => {
  const fresh = boardInit({ githubIssue: 'https://github.com/nemori-ai/cc-master/issues/99' });
  assert.equal(fresh.goal, '');
  assert.equal(fresh.source.url, 'https://github.com/nemori-ai/cc-master/issues/99');
  assert.equal(fresh.goal_contract.assurance, 'pending');
});

test('GC-03: explicit non-empty board init goal becomes asserted contract', () => {
  const fresh = boardInit({ goal: '交付 draft PR 并等待人工评审' });
  assert.equal(fresh.goal_contract.revision, 1);
  assert.equal(fresh.goal_contract.assurance, 'asserted');
});

test('GC-09: generic board update cannot bypass an active goal contract', () => {
  const fresh = boardInit({ goal: 'v1' });
  assert.throws(() => boardUpdate(fresh, { goal: 'v2' }), /ccm goal amend/);
});
