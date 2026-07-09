// coordination-arbiter.test.ts — ADR-032 P4 deterministic pool allocator contract.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as M from '../dist/index.mjs';

const NOW_SEC = Math.floor(Date.parse('2026-07-09T12:00:00Z') / 1000);
const NOW = '2026-07-09T12:00:00Z';
const LATER = '2026-07-09T12:10:00Z';

function peer(board_file: string, priority: string, burn: number, goal = board_file): M.PeerEntry {
  return {
    board_file,
    goal,
    harness: 'claude-code',
    priority,
    session_id: `sid-${board_file}`,
    heartbeat: NOW,
    heartbeat_age_sec: 10,
    current: { active_tasks: 1, workload: goal, burn_contribution: burn },
    planned: { remaining_work: 'remaining', cost_to_complete_pct: 20 },
  };
}

test('poolPressureFromUsage normalizes rolling windows to tightest headroom', () => {
  const p = M.poolPressureFromUsage(
    {
      five_hour: { used_percentage: 82, resets_at: NOW_SEC + 1800 },
      seven_day: { used_percentage: 40, resets_at: NOW_SEC + 86400 },
    },
    { nowSec: NOW_SEC, quotaModel: 'rolling-5h-7d', pollable: true },
  );
  assert.equal(p.headroom_pct, 18);
  assert.equal(p.used_pct, 82);
  assert.equal(p.nearest_reset, NOW_SEC + 1800);
  assert.equal(p.band, 'warn');
  assert.equal(p.pollable, true);
});

test('allocatePool M==1 strictly generalizes existing single-board pacing verdict', () => {
  const signal = {
    five_hour: { used_percentage: 92, resets_at: NOW_SEC + 1800 },
    seven_day: { used_percentage: 50, resets_at: NOW_SEC + 86400 },
  };
  const single = [peer('solo.board.json', 'normal', 0)];
  const allocation = M.allocatePool(signal, single, { nowSec: NOW_SEC, effectiveN: 1 });
  const advice = M.pacingAdvice(signal, { nowSec: NOW_SEC, effectiveN: 1 });
  assert.equal(allocation.mode, 'single-board');
  assert.equal(allocation.base_advice.verdict, advice.verdict);
  assert.equal(allocation.rows[0].kind, 'pacing_stop');
  assert.equal(allocation.rows[0].notification_kind, 'pacing_stop');
  assert.equal(allocation.rows[0].reason, advice.reason);
});

test('allocatePool produces complementary yield and claim rows deterministically', () => {
  const peers = [
    peer('a.board.json', 'normal', 12, 'normal over-burning board'),
    peer('b.board.json', 'urgent', 3, 'urgent under-served board'),
  ];
  const signal = {
    five_hour: { used_percentage: 85, resets_at: NOW_SEC + 1800 },
    seven_day: { used_percentage: 30, resets_at: NOW_SEC + 86400 },
  };
  const first = M.allocatePool(signal, peers, { nowSec: NOW_SEC, effectiveN: 1 });
  const second = M.allocatePool(signal, [...peers].reverse(), { nowSec: NOW_SEC, effectiveN: 1 });

  const byFile = new Map(first.rows.map((row) => [row.peer.board_file, row]));
  assert.equal(byFile.get('a.board.json')?.kind, 'pacing_yield');
  assert.equal(byFile.get('b.board.json')?.kind, 'pacing_claim');
  assert.equal(byFile.get('a.board.json')?.target_headroom_pct, 3);
  assert.equal(byFile.get('b.board.json')?.target_headroom_pct, 12);

  const firstStable = first.rows
    .map((row) => [row.peer.board_file, row.kind, row.target_headroom_pct, row.dedup_key])
    .sort();
  const secondStable = second.rows
    .map((row) => [row.peer.board_file, row.kind, row.target_headroom_pct, row.dedup_key])
    .sort();
  assert.deepEqual(secondStable, firstStable, 'same inputs produce stable complementary rows');
});

test('allocatePool uses calibrated priority weights and fair-share floor only', () => {
  assert.deepEqual(M.POOL_ARBITER_POLICY.priorityWeights, {
    urgent: 8,
    high: 4,
    normal: 2,
    low: 1,
    trivial: 0.5,
  });
  assert.equal(M.POOL_ARBITER_POLICY.antiStarvationFloorPct, 1);

  const allocation = M.allocatePool(
    { five_hour: { used_percentage: 99 }, seven_day: { used_percentage: 20 } },
    [peer('urgent.board.json', 'urgent', 0), peer('trivial.board.json', 'trivial', 0)],
    { nowSec: NOW_SEC },
  );
  const trivial = allocation.rows.find((row) => row.peer.priority === 'trivial');
  assert.equal(trivial?.target_headroom_pct, 1, 'floor keeps low-priority boards from starving');
});

test('shouldAppendAllocationNotification gates on dedup, cooldown, and row delta', () => {
  const allocation = M.allocatePool(
    { five_hour: { used_percentage: 85 }, seven_day: { used_percentage: 20 } },
    [peer('a.board.json', 'normal', 12), peer('b.board.json', 'urgent', 3)],
    { nowSec: NOW_SEC },
  );
  const row = allocation.rows.find((item) => item.peer.board_file === 'a.board.json');
  assert.ok(row);

  assert.equal(
    M.shouldAppendAllocationNotification(row, allocation, [], NOW_SEC * 1000).reason,
    'first',
  );

  const existing = {
    id: 'ntf-existing',
    kind: row.notification_kind,
    status: 'unconsumed',
    created_at: NOW,
    expires_at: '2026-07-09T16:00:00Z',
    strength: row.strength,
    summary: 'existing',
    payload: {
      producer: 'coordination-arbiter',
      dedup_key: row.dedup_key,
      pressure_band: allocation.pressure.band,
      roster_signature: allocation.roster_signature,
      target_headroom_pct: row.target_headroom_pct,
    },
    consumed_at: null,
    consumed_note: null,
  } as M.Notification;
  assert.equal(
    M.shouldAppendAllocationNotification(row, allocation, [existing], NOW_SEC * 1000).reason,
    'dedup',
  );

  const changed = M.allocatePool(
    { five_hour: { used_percentage: 95 }, seven_day: { used_percentage: 20 } },
    [peer('a.board.json', 'normal', 16), peer('b.board.json', 'urgent', 1)],
    { nowSec: NOW_SEC },
  );
  const changedRow = changed.rows.find((item) => item.peer.board_file === 'a.board.json');
  assert.ok(changedRow);
  const oldDifferent = {
    ...existing,
    payload: { ...existing.payload, dedup_key: 'older', target_headroom_pct: 3 },
  };
  assert.equal(
    M.shouldAppendAllocationNotification(changedRow, changed, [oldDifferent], (NOW_SEC + 60) * 1000)
      .reason,
    'cooldown',
  );
  assert.equal(
    M.shouldAppendAllocationNotification(changedRow, changed, [oldDifferent], Date.parse(LATER))
      .reason,
    'edge',
  );
});
