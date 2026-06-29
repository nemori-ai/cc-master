// coordination-peers.test.ts — buildPeerRoster 跨板花名册纯函数契约门（COORD·设计稿 §3.2）。
//
// 钉死：① 从多板聚活+新鲜 peer；② 过滤非活 / 过期心跳板（不占 M）；③ coordination 缺失 → 降级（current/
//   planned=null·priority 解析 normal）·仍计入；④ priority 排序（urgent 先）；⑤ 时钟注入确定性（nowMs）。

import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as M from '../dist/index.mjs';

// 固定基准 now（确定性·所有 heartbeat 相对它算 age）。
const NOW_MS = Date.parse('2026-06-29T12:00:00Z');
const ISO = (offsetSec: number): string =>
  new Date(NOW_MS + offsetSec * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');

// mkBoard(file, {active, hbOffsetSec, priority, goal, coordination}) → {file, board} 项。
function mkBoard(
  file: string,
  {
    active = true,
    hbOffsetSec = -60, // 默认 60s 前（新鲜）
    session_id = 'sid-x',
    priority,
    goal = 'g',
    coordination,
    noHeartbeat = false,
  }: {
    active?: boolean;
    hbOffsetSec?: number;
    session_id?: string;
    priority?: string;
    goal?: string;
    coordination?: unknown;
    noHeartbeat?: boolean;
  } = {},
): { file: string; board: unknown } {
  const owner: Record<string, unknown> = { active, session_id };
  if (!noHeartbeat) owner.heartbeat = ISO(hbOffsetSec);
  const board: Record<string, unknown> = {
    schema: 'cc-master/v2',
    goal,
    owner,
    git: {},
    tasks: [],
  };
  if (coordination !== undefined) board.coordination = coordination;
  else if (priority !== undefined) board.coordination = { priority };
  return { file, board };
}

const opts = { nowMs: NOW_MS };

// ── ① 多板聚花名册 ───────────────────────────────────────────────────────────────────────────────
test('aggregates active+fresh peers from multiple boards', () => {
  const boards = [
    mkBoard('a.board.json', { priority: 'high', goal: 'A' }),
    mkBoard('b.board.json', { priority: 'normal', goal: 'B' }),
  ];
  const r = M.buildPeerRoster(boards, opts);
  assert.equal(r.count, 2);
  assert.equal(r.peers.length, 2);
  assert.deepEqual(r.peers.map((p: { goal: string }) => p.goal).sort(), ['A', 'B']);
  assert.equal(r.freshness_sec, M.PEER_FRESHNESS_SEC);
});

// ── ② 过滤非活板 ─────────────────────────────────────────────────────────────────────────────────
test('excludes inactive boards (owner.active:false)', () => {
  const boards = [
    mkBoard('live.board.json', { active: true, goal: 'live' }),
    mkBoard('archived.board.json', { active: false, goal: 'archived' }),
  ];
  const r = M.buildPeerRoster(boards, opts);
  assert.equal(r.count, 1);
  assert.equal(r.peers[0].goal, 'live');
});

// ── ② 过滤过期心跳板（不占 M·设计稿 §10 liveness）──────────────────────────────────────────────────
test('excludes boards with stale heartbeat (age >= freshness window)', () => {
  const boards = [
    mkBoard('fresh.board.json', { hbOffsetSec: -120, goal: 'fresh' }), // 2min 前·新鲜
    mkBoard('stale.board.json', { hbOffsetSec: -1200, goal: 'stale' }), // 20min 前·过期（>600s）
  ];
  const r = M.buildPeerRoster(boards, opts);
  assert.equal(r.count, 1, 'stale heartbeat board must not count toward M');
  assert.equal(r.peers[0].goal, 'fresh');
});

test('excludes boards with no parseable heartbeat (conservative·fail-safe)', () => {
  const boards = [
    mkBoard('ok.board.json', { goal: 'ok' }),
    mkBoard('noHb.board.json', { noHeartbeat: true, goal: 'noHb' }),
  ];
  const r = M.buildPeerRoster(boards, opts);
  assert.equal(r.count, 1);
  assert.equal(r.peers[0].goal, 'ok');
});

test('respects custom freshnessSec override', () => {
  const boards = [
    mkBoard('a.board.json', { hbOffsetSec: -200, goal: 'a' }), // 200s 前
  ];
  // 窗口 100s → 200s 前的板过期、不计入。
  const tight = M.buildPeerRoster(boards, { nowMs: NOW_MS, freshnessSec: 100 });
  assert.equal(tight.count, 0);
  // 窗口 300s → 200s 前的板新鲜、计入。
  const loose = M.buildPeerRoster(boards, { nowMs: NOW_MS, freshnessSec: 300 });
  assert.equal(loose.count, 1);
});

// ── ③ coordination 缺失降级（仍计入·current/planned=null·priority 解析 normal）──────────────────────
test('degrades gracefully when coordination is missing (still in roster·normal priority)', () => {
  const boards = [mkBoard('a.board.json', { goal: 'no-coord' })]; // 无 priority / coordination
  const r = M.buildPeerRoster(boards, opts);
  assert.equal(r.count, 1);
  const p = r.peers[0];
  assert.equal(p.priority, 'normal', 'missing coordination → priority defaults to normal');
  assert.equal(p.current, null, 'missing state.current → null');
  assert.equal(p.planned, null, 'missing state.planned → null');
});

test('invalid priority degrades to normal', () => {
  const boards = [mkBoard('a.board.json', { coordination: { priority: 'bogus' } })];
  const r = M.buildPeerRoster(boards, opts);
  assert.equal(r.peers[0].priority, 'normal');
});

test('projects state.current/planned fields and nulls out bad scalar fields', () => {
  const co = {
    priority: 'low',
    state: {
      current: { active_tasks: 2, workload: 'w', burn_contribution: 'bad' }, // burn 坏 → null
      planned: { remaining_work: 'r', cost_to_complete_pct: 30 },
    },
  };
  const boards = [mkBoard('a.board.json', { coordination: co })];
  const r = M.buildPeerRoster(boards, opts);
  const p = r.peers[0];
  assert.equal(p.current.active_tasks, 2);
  assert.equal(p.current.workload, 'w');
  assert.equal(p.current.burn_contribution, null, 'non-numeric burn → null');
  assert.equal(p.planned.remaining_work, 'r');
  assert.equal(p.planned.cost_to_complete_pct, 30);
});

// ── ④ priority 排序（urgent 先）+ heartbeat tiebreak ──────────────────────────────────────────────
test('sorts by priority (urgent first) then by heartbeat freshness', () => {
  const boards = [
    mkBoard('a.board.json', { priority: 'low', goal: 'low-pri' }),
    mkBoard('b.board.json', { priority: 'urgent', goal: 'urgent-pri' }),
    mkBoard('c.board.json', { priority: 'normal', goal: 'normal-pri' }),
  ];
  const r = M.buildPeerRoster(boards, opts);
  assert.deepEqual(
    r.peers.map((p: { goal: string }) => p.goal),
    ['urgent-pri', 'normal-pri', 'low-pri'],
  );
});

// ── ⑤ 空 / 坏输入 ────────────────────────────────────────────────────────────────────────────────
test('empty board list yields empty roster (count:0·fail-safe)', () => {
  const r = M.buildPeerRoster([], opts);
  assert.equal(r.count, 0);
  assert.deepEqual(r.peers, []);
});

test('skips malformed boards without throwing', () => {
  const boards = [
    { file: 'bad1.board.json', board: null },
    { file: 'bad2.board.json', board: 42 },
    { file: 'bad3.board.json', board: { owner: 'not-an-object' } },
    mkBoard('good.board.json', { goal: 'good' }),
  ];
  const r = M.buildPeerRoster(boards, opts);
  assert.equal(r.count, 1);
  assert.equal(r.peers[0].goal, 'good');
});

test('tolerates future heartbeat (clock skew → treated as fresh)', () => {
  const boards = [mkBoard('a.board.json', { hbOffsetSec: 30, goal: 'future' })]; // 30s 后
  const r = M.buildPeerRoster(boards, opts);
  assert.equal(r.count, 1, 'future heartbeat (clock skew) tolerated as fresh');
});
