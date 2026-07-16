// handler-agent.test.ts — Agent Registry noun handler（handlers/agent.ts）契约门。
//   端到端（mkdtemp 临时 home + 真 leaf + 临时板）验证 7 verb 全链路、无证据拒绝、幂等 link、
//   probe 降级（真 sleep 进程 kill → orphaned）、状态机拒绝、not-found、--json 形状。
//   board 写全经 runWrite 既有写入关卡（带锁 + lint after mutate）。

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import type { Ctx } from '../src/handlers/_common.js';
import * as agent from '../src/handlers/agent.js';
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

function mkBoardHome(tasks: unknown[] = []): string {
  const root = mkTmp('ccm-hag-');
  const home = join(root, '.cc_master', 'boards');
  mkdirSync(home, { recursive: true });
  const boardPath = join(home, '2026-07-16-000000-1.board.json');
  const board = {
    schema: 'cc-master/v2',
    meta: { template_version: 3 },
    goal: 'agent registry test',
    owner: { active: true, session_id: 'sid-ag', heartbeat: '2026-07-16T08:00:00Z' },
    git: { worktree: '', branch: '' },
    scheduling: { wip_limit: 4 },
    tasks,
    log: [],
  };
  writeFileSync(boardPath, `${JSON.stringify(board, null, 2)}\n`, 'utf8');
  return boardPath;
}

type TestCtx = Ctx & { outBuf: string[]; errBuf: string[] };
function mkCtx(
  boardPath: string,
  {
    values = {},
    flags = {},
    positionals = [],
  }: {
    values?: Record<string, unknown>;
    flags?: Partial<Ctx['flags']>;
    positionals?: string[];
  } = {},
): TestCtx {
  const outBuf: string[] = [];
  const errBuf: string[] = [];
  return {
    values: { board: boardPath, ...values },
    positionals,
    flags: {
      json: false,
      dryRun: false,
      force: false,
      yes: false,
      quiet: true, // 静默 lint 摘要，测试只看 out
      verbose: false,
      color: false,
      ...flags,
    },
    sid: 'sid-ag',
    env: {},
    out: (s: string) => outBuf.push(s),
    err: (s: string) => errBuf.push(s),
    isTTY: true,
    outBuf,
    errBuf,
  };
}

const readBoard = (p: string) => JSON.parse(readFileSync(p, 'utf8'));

// ── create ────────────────────────────────────────────────────────────────────────────────────────
test('create registers a starting agent and returns agt-001', () => {
  const bp = mkBoardHome();
  const ctx = mkCtx(bp, {
    values: { type: 'cli-worker', harness: 'codex', intent: 'review diff' },
    flags: { json: true },
  });
  assert.equal(agent.create(ctx), EXIT.OK);
  const data = JSON.parse(ctx.outBuf.join('')).data;
  assert.equal(data.agent_id, 'agt-001');
  assert.equal(data.agent.lifecycle.state, 'starting');
  assert.equal(data.agent.account_ref, null);
  assert.equal(data.agent.quota_pool_ref, null);
  const board = readBoard(bp);
  assert.equal(board.agents.length, 1);
  assert.equal(board.agents[0].id, 'agt-001');
});

test('create auto-increments ids agt-001 → agt-002', () => {
  const bp = mkBoardHome();
  agent.create(mkCtx(bp, { values: { type: 'subagent', harness: 'origin', intent: 'a' } }));
  agent.create(mkCtx(bp, { values: { type: 'workflow', harness: 'origin', intent: 'b' } }));
  const board = readBoard(bp);
  assert.deepEqual(
    board.agents.map((a: any) => a.id),
    ['agt-001', 'agt-002'],
  );
});

// ── bind ──────────────────────────────────────────────────────────────────────────────────────────
test('bind with real handle evidence: starting → running', () => {
  const bp = mkBoardHome();
  agent.create(mkCtx(bp, { values: { type: 'cli-worker', harness: 'codex', intent: 'x' } }));
  const ctx = mkCtx(bp, {
    positionals: ['agt-001'],
    values: { handle: 'session-id:0197-abc', 'attach-cmd': 'codex resume 0197-abc' },
  });
  assert.equal(agent.bind(ctx), EXIT.OK);
  const a = readBoard(bp).agents[0];
  assert.equal(a.lifecycle.state, 'running');
  assert.equal(a.handle.kind, 'session-id');
  assert.equal(a.handle.value, '0197-abc');
  assert.equal(a.handle.attach_cmd, 'codex resume 0197-abc');
});

test('bind with no handle evidence is rejected (Validation·exit 3): "no real handle ≠ running"', () => {
  const bp = mkBoardHome();
  agent.create(mkCtx(bp, { values: { type: 'cli-worker', harness: 'codex', intent: 'x' } }));
  for (const bad of ['', 'pid:', 'garbage-no-colon', 'bogus-kind:val']) {
    const ctx = mkCtx(bp, { positionals: ['agt-001'], values: { handle: bad } });
    assert.throws(
      () => agent.bind(ctx),
      (e: Error & { errKind?: string }) => e.errKind === 'Validation',
      `handle=${JSON.stringify(bad)} must be rejected`,
    );
  }
  // 仍是 starting（未被非法推进到 running）。
  assert.equal(readBoard(bp).agents[0].lifecycle.state, 'starting');
});

test('bind on nonexistent agent → NotFound (exit 5)', () => {
  const bp = mkBoardHome();
  const ctx = mkCtx(bp, { positionals: ['agt-404'], values: { handle: 'pid:1' } });
  assert.throws(
    () => agent.bind(ctx),
    (e: Error & { errKind?: string }) => e.errKind === 'NotFound',
  );
});

test('bind on a terminal agent → IllegalTransition (exit 3)', () => {
  const bp = mkBoardHome();
  agent.create(mkCtx(bp, { values: { type: 'cli-worker', harness: 'codex', intent: 'x' } }));
  agent.bind(mkCtx(bp, { positionals: ['agt-001'], values: { handle: 'pid:1' } }));
  agent.terminal(mkCtx(bp, { positionals: ['agt-001'], values: { outcome: 'done' } }));
  const ctx = mkCtx(bp, { positionals: ['agt-001'], values: { handle: 'pid:2' } });
  assert.throws(
    () => agent.bind(ctx),
    (e: Error & { errKind?: string }) => e.errKind === 'IllegalTransition',
  );
});

// ── link ──────────────────────────────────────────────────────────────────────────────────────────
test('link appends an agent-side link; second link to same task is idempotent', () => {
  const bp = mkBoardHome([
    { id: 'T1', status: 'in_flight', deps: [], started_at: '2026-07-16T08:00:00Z' },
  ]);
  agent.create(mkCtx(bp, { values: { type: 'subagent', harness: 'origin', intent: 'x' } }));
  assert.equal(
    agent.link(mkCtx(bp, { positionals: ['agt-001'], values: { task: 'T1' } })),
    EXIT.OK,
  );
  assert.equal(
    agent.link(mkCtx(bp, { positionals: ['agt-001'], values: { task: 'T1' } })),
    EXIT.OK,
  );
  const a = readBoard(bp).agents[0];
  assert.equal(a.links.length, 1, 'idempotent: no duplicate link');
  assert.equal(a.links[0].task_id, 'T1');
});

test('link to a nonexistent task → Validation (exit 3)', () => {
  const bp = mkBoardHome([{ id: 'T1', status: 'ready', deps: [] }]);
  agent.create(mkCtx(bp, { values: { type: 'subagent', harness: 'origin', intent: 'x' } }));
  const ctx = mkCtx(bp, { positionals: ['agt-001'], values: { task: 'T-nope' } });
  assert.throws(
    () => agent.link(ctx),
    (e: Error & { errKind?: string }) => e.errKind === 'Validation',
  );
});

test('link never touches task.status / task.routing (terminal ≠ done boundary)', () => {
  const bp = mkBoardHome([
    { id: 'T1', status: 'in_flight', deps: [], started_at: '2026-07-16T08:00:00Z' },
  ]);
  agent.create(mkCtx(bp, { values: { type: 'subagent', harness: 'origin', intent: 'x' } }));
  agent.link(mkCtx(bp, { positionals: ['agt-001'], values: { task: 'T1' } }));
  const t = readBoard(bp).tasks[0];
  assert.equal(t.status, 'in_flight');
  assert.equal(t.routing, undefined, 'no routing envelope forced onto a legacy task');
});

// ── terminal ──────────────────────────────────────────────────────────────────────────────────────
test('terminal: running → terminal with outcome; task status untouched', () => {
  const bp = mkBoardHome([
    { id: 'T1', status: 'in_flight', deps: [], started_at: '2026-07-16T08:00:00Z' },
  ]);
  agent.create(mkCtx(bp, { values: { type: 'cli-worker', harness: 'codex', intent: 'x' } }));
  agent.bind(mkCtx(bp, { positionals: ['agt-001'], values: { handle: 'pid:1' } }));
  assert.equal(
    agent.terminal(mkCtx(bp, { positionals: ['agt-001'], values: { outcome: 'approved' } })),
    EXIT.OK,
  );
  const board = readBoard(bp);
  assert.equal(board.agents[0].lifecycle.state, 'terminal');
  assert.equal(board.agents[0].lifecycle.outcome, 'approved');
  assert.ok(board.agents[0].lifecycle.ended_at);
  assert.equal(
    board.tasks[0].status,
    'in_flight',
    'terminal ≠ task done: task status never changed',
  );
});

test('terminal on a starting agent → IllegalTransition (exit 3)', () => {
  const bp = mkBoardHome();
  agent.create(mkCtx(bp, { values: { type: 'cli-worker', harness: 'codex', intent: 'x' } }));
  const ctx = mkCtx(bp, { positionals: ['agt-001'], values: { outcome: 'x' } });
  assert.throws(
    () => agent.terminal(ctx),
    (e: Error & { errKind?: string }) => e.errKind === 'IllegalTransition',
  );
});

// ── probe（真进程降级）─────────────────────────────────────────────────────────────────────────────
test('probe: live pid → running; after kill → orphaned (only agents[] segment written)', async () => {
  const { spawn } = await import('node:child_process');
  const bp = mkBoardHome([
    { id: 'T1', status: 'in_flight', deps: [], started_at: '2026-07-16T08:00:00Z' },
  ]);
  agent.create(mkCtx(bp, { values: { type: 'background-shell', harness: 'origin', intent: 'x' } }));
  const child = spawn('sleep', ['30'], { detached: true });
  const pid = child.pid as number;
  agent.bind(mkCtx(bp, { positionals: ['agt-001'], values: { handle: `pid:${pid}` } }));

  assert.equal(agent.probe(mkCtx(bp, { positionals: ['agt-001'] })), EXIT.OK);
  let a = readBoard(bp).agents[0];
  assert.equal(a.probe.observed, 'alive');
  assert.equal(a.probe.method, 'pid');
  assert.equal(a.lifecycle.state, 'running');

  process.kill(pid, 'SIGKILL');
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(agent.probe(mkCtx(bp, { positionals: ['agt-001'] })), EXIT.OK);
  const board = readBoard(bp);
  a = board.agents[0];
  assert.equal(a.probe.observed, 'gone');
  assert.equal(a.lifecycle.state, 'orphaned');
  // M4：probe 只写 agents[] 段——task/attempt 投影零改动。
  assert.equal(board.tasks[0].status, 'in_flight');
  assert.equal(board.tasks[0].handle, undefined);
});

test('probe without id probes every agent on the board', () => {
  const bp = mkBoardHome();
  agent.create(mkCtx(bp, { values: { type: 'subagent', harness: 'origin', intent: 'a' } }));
  agent.create(mkCtx(bp, { values: { type: 'subagent', harness: 'origin', intent: 'b' } }));
  assert.equal(agent.probe(mkCtx(bp, {})), EXIT.OK);
  const board = readBoard(bp);
  for (const a of board.agents) {
    assert.ok(a.probe, 'every agent probed');
    assert.equal(a.probe.observed, 'unknown'); // 无 handle → 保真 unknown
  }
});

// ── list / show ─────────────────────────────────────────────────────────────────────────────────────
test('list --json returns count + state buckets + agents', () => {
  const bp = mkBoardHome();
  agent.create(mkCtx(bp, { values: { type: 'subagent', harness: 'origin', intent: 'a' } }));
  agent.create(mkCtx(bp, { values: { type: 'subagent', harness: 'origin', intent: 'b' } }));
  agent.bind(mkCtx(bp, { positionals: ['agt-001'], values: { handle: 'pid:1' } }));
  const ctx = mkCtx(bp, { flags: { json: true } });
  assert.equal(agent.list(ctx), EXIT.OK);
  const data = JSON.parse(ctx.outBuf.join('')).data;
  assert.equal(data.count, 2);
  assert.equal(data.buckets.running, 1);
  assert.equal(data.buckets.starting, 1);
});

test('show --json returns the full record; missing id → NotFound (exit 5)', () => {
  const bp = mkBoardHome();
  agent.create(mkCtx(bp, { values: { type: 'cli-worker', harness: 'codex', intent: 'x' } }));
  const ctx = mkCtx(bp, { positionals: ['agt-001'], flags: { json: true } });
  assert.equal(agent.show(ctx), EXIT.OK);
  assert.equal(JSON.parse(ctx.outBuf.join('')).data.agent.id, 'agt-001');
  const miss = mkCtx(bp, { positionals: ['agt-404'], flags: { json: true } });
  assert.throws(
    () => agent.show(miss),
    (e: Error & { errKind?: string }) => e.errKind === 'NotFound',
  );
});

// ── 单条记录尺寸预算（~1KB·大证据只存路径引用）──────────────────────────────────────────────────────
test('a single agent record stays under ~1KB', () => {
  const bp = mkBoardHome([
    { id: 'T1', status: 'in_flight', deps: [], started_at: '2026-07-16T08:00:00Z' },
  ]);
  agent.create(
    mkCtx(bp, {
      values: {
        type: 'cli-worker',
        harness: 'codex',
        intent: 'review the cross-harness routing contract diff end to end',
        model: 'gpt-5.6-luna',
      },
    }),
  );
  agent.bind(
    mkCtx(bp, {
      positionals: ['agt-001'],
      values: {
        handle: 'session-id:0197-0000-1111-2222',
        'attach-cmd': 'codex resume 0197-0000-1111-2222',
        transcript: '/abs/path/to/transcript.jsonl',
      },
    }),
  );
  agent.link(mkCtx(bp, { positionals: ['agt-001'], values: { task: 'T1' } }));
  agent.probe(mkCtx(bp, { positionals: ['agt-001'] }));
  const rec = readBoard(bp).agents[0];
  const size = Buffer.byteLength(JSON.stringify(rec), 'utf8');
  assert.ok(size < 1024, `agent record ${size}B should be < 1KB`);
});
