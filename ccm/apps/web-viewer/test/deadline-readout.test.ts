// deadline-readout.test.ts — mission delivery-DDL live readout (issue #149·D6).
//   deadlineReadout maps the board-derived mission.deadline facts into a countdown / overdue
//   phrasing against a fixed clock. Margin / risk band are NOT computed here (verdict SSOT is
//   `ccm estimate deadline-risk`) — this only covers the deterministic viewer surface.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deadlineReadout } from '../src/format';

const NOW = Date.parse('2026-07-08T12:00:00Z');

test('confirmed DDL in the future → counts down, not overdue', () => {
  const r = deadlineReadout({ state: 'confirmed', at: '2026-07-10T12:00:00Z' }, NOW);
  assert.ok(r);
  assert.equal(r?.state, 'confirmed');
  assert.equal(r?.overdue, false);
  assert.equal(r?.settled, true);
  assert.match(r?.text ?? '', /^due in 2d/);
});

test('asserted DDL is settled → produces a readout', () => {
  const r = deadlineReadout({ state: 'asserted', at: '2026-07-08T18:00:00Z' }, NOW);
  assert.equal(r?.settled, true);
  assert.match(r?.text ?? '', /^due in 6h/);
});

test('past DDL → overdue phrasing + flag', () => {
  const r = deadlineReadout({ state: 'confirmed', at: '2026-07-08T09:00:00Z' }, NOW);
  assert.equal(r?.overdue, true);
  assert.match(r?.text ?? '', /^overdue by 3h/);
});

test('state none (confirmed no-DDL) → settled, no countdown, not overdue', () => {
  const r = deadlineReadout({ state: 'none' }, NOW);
  assert.equal(r?.settled, true);
  assert.equal(r?.overdue, false);
  assert.equal(r?.at, null);
  assert.match(r?.text ?? '', /no delivery deadline/);
});

test('pending → unsettled (does not drive the tick), no false green', () => {
  const r = deadlineReadout({ state: 'pending' }, NOW);
  assert.equal(r?.settled, false);
  assert.equal(r?.overdue, false);
  assert.match(r?.text ?? '', /pending/);
});

test('absent / malformed → null (no DDL row rendered)', () => {
  assert.equal(deadlineReadout(undefined, NOW), null);
  assert.equal(deadlineReadout(null, NOW), null);
  assert.equal(deadlineReadout('nope', NOW), null);
});
