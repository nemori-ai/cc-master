// handler-peers.test.ts — peers noun handler（handlers/peers.ts）契约门（COORD·设计稿 §3.2）。
//
// peers handler 是跨板只读花名册——本测试用 mkdtemp 临时 home/boards/ + 多块板，端到端验证：
//   · list 聚活+新鲜板 → 花名册（goal/workload/priority/liveness）。
//   · 过滤非活 / 过期心跳板（不占 count）。
//   · coordination 缺失 → 降级（priority=normal·current/planned=null）·仍计入。
//   · --json 形状（{ peers, pools, count, freshness_sec, as_of }）。
//   · --freshness-sec 覆写。
//   · 空 home → count:0 + exit 0（fail-safe·不报错）。
//   · token-blind：花名册 JSON 无任何 secret 字段。

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import type { Ctx } from '../src/handlers/_common.js';
import * as peersHandler from '../src/handlers/peers.js';
import * as io from '../src/io.js';

const EXIT = io.EXIT;

let TMPDIRS: string[] = [];
function mkTmp(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  TMPDIRS.push(d);
  return d;
}
afterEach(() => {
  for (const d of TMPDIRS) rmSync(d, { recursive: true, force: true });
  TMPDIRS = [];
});

// 固定 now（测试机当下·心跳相对它算 age）。用真实 now，确保「新鲜」判定对真实时钟成立。
const ISO = (offsetSec: number): string =>
  new Date(Date.now() + offsetSec * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');

// mkHome() → 临时 home 根；writeBoard 往其 boards/ 写一块板。
function mkHome(): string {
  const root = mkTmp('ccm-hpeers-');
  const home = join(root, '.claude', 'cc-master');
  mkdirSync(join(home, 'boards'), { recursive: true });
  return home;
}

function writeBoard(
  home: string,
  file: string,
  {
    active = true,
    hbOffsetSec = -60,
    session_id = 'sid-x',
    harness,
    goal = 'g',
    priority,
    coordination,
  }: {
    active?: boolean;
    hbOffsetSec?: number;
    session_id?: string;
    harness?: string;
    goal?: string;
    priority?: string;
    coordination?: unknown;
  } = {},
): void {
  const board: Record<string, unknown> = {
    schema: 'cc-master/v2',
    meta: { template_version: 3 },
    goal,
    owner: {
      active,
      session_id,
      heartbeat: ISO(hbOffsetSec),
      ...(harness !== undefined ? { harness } : {}),
    },
    git: { worktree: '', branch: '' },
    tasks: [],
    log: [],
  };
  if (coordination !== undefined) board.coordination = coordination;
  else if (priority !== undefined) board.coordination = { priority };
  writeFileSync(join(home, 'boards', file), `${JSON.stringify(board, null, 2)}\n`, 'utf8');
}

type TestCtx = Ctx & { outBuf: string[]; errBuf: string[] };
function mkCtx(
  home: string,
  {
    values = {},
    flags = {},
  }: { values?: Record<string, unknown>; flags?: Partial<Ctx['flags']> } = {},
): TestCtx {
  const outBuf: string[] = [];
  const errBuf: string[] = [];
  return {
    values: { home, ...values },
    positionals: [],
    flags: {
      json: false,
      dryRun: false,
      force: false,
      yes: false,
      quiet: false,
      verbose: false,
      color: false,
      ...flags,
    },
    sid: 'sid-x',
    env: { HOME: home }, // 兜底：resolveHome 退 env.HOME（--home flag 先于它）
    out: (s: string) => outBuf.push(s),
    err: (s: string) => errBuf.push(s),
    isTTY: true,
    outBuf,
    errBuf,
  };
}

// ══ peers list ═══════════════════════════════════════════════════════════════════════════════════

test('peers list aggregates active+fresh boards into roster', () => {
  const home = mkHome();
  writeBoard(home, 'a.board.json', { priority: 'high', goal: 'auth service' });
  writeBoard(home, 'b.board.json', { priority: 'normal', goal: 'data pipeline' });
  const ctx = mkCtx(home, { flags: { json: true } });
  const code = peersHandler.list(ctx);
  assert.equal(code, EXIT.OK);
  const out = JSON.parse(ctx.outBuf.join(''));
  assert.equal(out.ok, true);
  assert.equal(out.data.count, 2);
  assert.deepEqual(out.data.peers.map((p: { goal: string }) => p.goal).sort(), [
    'auth service',
    'data pipeline',
  ]);
});

test('peers list excludes inactive boards', () => {
  const home = mkHome();
  writeBoard(home, 'live.board.json', { active: true, goal: 'live' });
  writeBoard(home, 'archived.board.json', { active: false, goal: 'archived' });
  const ctx = mkCtx(home, { flags: { json: true } });
  peersHandler.list(ctx);
  const out = JSON.parse(ctx.outBuf.join(''));
  assert.equal(out.data.count, 1);
  assert.equal(out.data.peers[0].goal, 'live');
});

test('peers list excludes stale-heartbeat boards (>10min)', () => {
  const home = mkHome();
  writeBoard(home, 'fresh.board.json', { hbOffsetSec: -120, goal: 'fresh' });
  writeBoard(home, 'stale.board.json', { hbOffsetSec: -1200, goal: 'stale' });
  const ctx = mkCtx(home, { flags: { json: true } });
  peersHandler.list(ctx);
  const out = JSON.parse(ctx.outBuf.join(''));
  assert.equal(out.data.count, 1);
  assert.equal(out.data.peers[0].goal, 'fresh');
});

test('peers list degrades gracefully when coordination missing', () => {
  const home = mkHome();
  writeBoard(home, 'a.board.json', { goal: 'no-coord' }); // 无 priority / coordination
  const ctx = mkCtx(home, { flags: { json: true } });
  peersHandler.list(ctx);
  const out = JSON.parse(ctx.outBuf.join(''));
  assert.equal(out.data.count, 1);
  assert.equal(out.data.peers[0].priority, 'normal');
  assert.equal(out.data.peers[0].current, null);
  assert.equal(out.data.peers[0].planned, null);
});

test('peers list partitions JSON by harness pools', () => {
  const home = mkHome();
  writeBoard(home, 'claude-a.board.json', { harness: 'claude-code', goal: 'claude A' });
  writeBoard(home, 'claude-b.board.json', { harness: 'claude-code', goal: 'claude B' });
  writeBoard(home, 'cursor-a.board.json', { harness: 'cursor', goal: 'cursor A' });
  writeBoard(home, 'unknown-a.board.json', { goal: 'unknown A' });
  const ctx = mkCtx(home, { flags: { json: true } });
  peersHandler.list(ctx);
  const pools = JSON.parse(ctx.outBuf.join('')).data.pools;
  assert.deepEqual(
    pools.map((p: { pool_id: string; harness: string; count: number }) => [
      p.pool_id,
      p.harness,
      p.count,
    ]),
    [
      ['claude-code', 'claude-code', 2],
      ['cursor', 'cursor', 1],
      ['unknown:unknown-a.board.json', 'unknown', 1],
    ],
  );
});

test('peers list --json shape: { peers, pools, count, freshness_sec, as_of }', () => {
  const home = mkHome();
  writeBoard(home, 'a.board.json', {
    priority: 'urgent',
    goal: 'prod incident fix',
    coordination: {
      priority: 'urgent',
      state: {
        current: { active_tasks: 1, workload: 'hotfix', burn_contribution: 9 },
        planned: { remaining_work: 'verify+deploy', cost_to_complete_pct: 4 },
      },
    },
  });
  const ctx = mkCtx(home, { flags: { json: true } });
  peersHandler.list(ctx);
  const out = JSON.parse(ctx.outBuf.join(''));
  const d = out.data;
  assert.ok(Array.isArray(d.peers), 'peers is array');
  assert.ok(Array.isArray(d.pools), 'pools is array');
  assert.equal(typeof d.count, 'number', 'count is number');
  assert.equal(d.freshness_sec, 600, 'default freshness 600');
  assert.match(d.as_of, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/, 'as_of is ISO-8601 UTC');
  const p = d.peers[0];
  assert.equal(p.priority, 'urgent');
  assert.equal(p.goal, 'prod incident fix');
  assert.equal(p.current.active_tasks, 1);
  assert.equal(p.planned.cost_to_complete_pct, 4);
  assert.ok('heartbeat_age_sec' in p, 'has heartbeat_age_sec');
});

test('peers list --freshness-sec override tightens liveness window', () => {
  const home = mkHome();
  writeBoard(home, 'a.board.json', { hbOffsetSec: -200, goal: 'a' }); // 200s 前
  // 窗口 100s → 过期·count 0。
  const tight = mkCtx(home, { values: { 'freshness-sec': '100' }, flags: { json: true } });
  peersHandler.list(tight);
  assert.equal(JSON.parse(tight.outBuf.join('')).data.count, 0);
  // 窗口 300s → 新鲜·count 1。
  const loose = mkCtx(home, { values: { 'freshness-sec': '300' }, flags: { json: true } });
  peersHandler.list(loose);
  assert.equal(JSON.parse(loose.outBuf.join('')).data.count, 1);
});

test('peers list empty home → count:0 + exit 0 (fail-safe)', () => {
  const home = mkHome(); // boards/ 存在但空
  const ctx = mkCtx(home, { flags: { json: true } });
  const code = peersHandler.list(ctx);
  assert.equal(code, EXIT.OK);
  const out = JSON.parse(ctx.outBuf.join(''));
  assert.equal(out.data.count, 0);
  assert.deepEqual(out.data.peers, []);
  assert.deepEqual(out.data.pools, []);
});

test('peers list human render shows roster lines', () => {
  const home = mkHome();
  writeBoard(home, 'a.board.json', { priority: 'high', goal: 'human-render-goal' });
  const ctx = mkCtx(home);
  const code = peersHandler.list(ctx);
  assert.equal(code, EXIT.OK);
  const out = ctx.outBuf.join('');
  assert.ok(out.includes('peers'), 'human render mentions peers');
  assert.ok(out.includes('pool unknown:a.board.json'), 'human render shows harness pool');
  assert.ok(out.includes('human-render-goal'), 'human render shows peer goal');
  assert.ok(out.includes('high'), 'human render shows priority');
});

test('peers list is token-blind (roster JSON carries no secret-shaped fields)', () => {
  const home = mkHome();
  writeBoard(home, 'a.board.json', { priority: 'normal', goal: 'g' });
  const ctx = mkCtx(home, { flags: { json: true } });
  peersHandler.list(ctx);
  const raw = ctx.outBuf.join('').toLowerCase();
  for (const forbidden of ['token', 'secret', 'oauth', 'password', 'credential', 'access_token']) {
    assert.ok(!raw.includes(forbidden), `roster must not contain "${forbidden}"`);
  }
});
