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
    env = {},
  }: {
    values?: Record<string, unknown>;
    flags?: Partial<Ctx['flags']>;
    positionals?: string[];
    env?: Record<string, string | undefined>;
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
    env,
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

test('create records launch.cwd: defaults to invocation cwd; explicit --cwd wins', () => {
  // launch.cwd 是 attach/resume 的关键接入证据（claude-code resume 须回原目录·viewer cwd-aware
  //   attach 依赖它）——漏传 --cwd 不该让它永远空：默认记录登记时刻的 process.cwd()。
  const bp = mkBoardHome();
  agent.create(mkCtx(bp, { values: { type: 'cli-worker', harness: 'codex', intent: 'a' } }));
  agent.create(
    mkCtx(bp, { values: { type: 'cli-worker', harness: 'codex', intent: 'b', cwd: '/work/repo' } }),
  );
  const board = readBoard(bp);
  assert.equal(board.agents[0].launch.cwd, process.cwd(), 'default: registration-time cwd');
  assert.equal(board.agents[1].launch.cwd, '/work/repo', 'explicit --cwd wins');
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

test('terminal on a starting agent is legal (startup-failure closure·no permanent zombie)', () => {
  // create 后 spawn 失败、无 handle 可 bind 的 agent 必须能收口——否则 terminal 被拒 exit 3、
  //   probe method=none 永远 unknown → 永久僵尸（对齐 native-attempt 的 startup_failed 终类）。
  const bp = mkBoardHome();
  agent.create(mkCtx(bp, { values: { type: 'cli-worker', harness: 'codex', intent: 'x' } }));
  assert.equal(
    agent.terminal(mkCtx(bp, { positionals: ['agt-001'], values: { outcome: 'spawn failed' } })),
    EXIT.OK,
  );
  const a = readBoard(bp).agents[0];
  assert.equal(a.lifecycle.state, 'terminal');
  assert.equal(a.lifecycle.outcome, 'spawn failed');
  assert.ok(a.lifecycle.ended_at);
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

// ── probe 语义修复（启动竞态 + 证据式恢复 + pid 不回归）──────────────────────────────────────────────
test('probe launch race: session file not yet on disk → observed=unknown, running is NOT downgraded', () => {
  // 真实缺陷：claude worker 刚起、~/.claude/projects/<slug>/<sid>.jsonl 尚未落盘时立即 probe，
  //   旧实现把「文件不存在」判成 gone → running 被误降 orphaned。「从未见过文件」≠「曾在而消失」。
  const claudeHome = mkTmp('ccm-hag-cc-'); // 空 CLAUDE_CONFIG_DIR：session 文件不存在
  const bp = mkBoardHome([
    { id: 'T1', status: 'in_flight', deps: [], started_at: '2026-07-16T08:00:00Z' },
  ]);
  agent.create(mkCtx(bp, { values: { type: 'cli-worker', harness: 'claude-code', intent: 'x' } }));
  agent.bind(mkCtx(bp, { positionals: ['agt-001'], values: { handle: 'session-id:sid-race-1' } }));
  const env = { CLAUDE_CONFIG_DIR: claudeHome };
  assert.equal(agent.probe(mkCtx(bp, { positionals: ['agt-001'], env })), EXIT.OK);
  const a = readBoard(bp).agents[0];
  assert.equal(a.probe.observed, 'unknown', 'missing session file must be unknown, not gone');
  assert.equal(a.lifecycle.state, 'running', 'running must survive a launch-race probe');
});

test('probe evidence recovery: orphaned agent whose session file appears fresh → running', () => {
  // 真实缺陷：单向降级卡死——文件后到、观测 alive，但 state 永久卡 orphaned（observed=alive+state=orphaned 矛盾）。
  const claudeHome = mkTmp('ccm-hag-ccr-');
  const bp = mkBoardHome([
    { id: 'T1', status: 'in_flight', deps: [], started_at: '2026-07-16T08:00:00Z' },
  ]);
  agent.create(mkCtx(bp, { values: { type: 'cli-worker', harness: 'claude-code', intent: 'x' } }));
  agent.bind(mkCtx(bp, { positionals: ['agt-001'], values: { handle: 'session-id:sid-rec-1' } }));
  // 人为制造 orphaned（模拟历史误判死的板）。
  {
    const board = readBoard(bp);
    board.agents[0].lifecycle.state = 'orphaned';
    writeFileSync(bp, `${JSON.stringify(board, null, 2)}\n`, 'utf8');
  }
  // session 文件此刻出现且 mtime 新鲜 → probe 观测 alive → 证据式恢复 running。
  const slugDir = join(claudeHome, 'projects', '-repo-slug');
  mkdirSync(slugDir, { recursive: true });
  writeFileSync(join(slugDir, 'sid-rec-1.jsonl'), '{}\n', 'utf8'); // 刚写出·mtime=now·必在 freshness 窗内
  const env = { CLAUDE_CONFIG_DIR: claudeHome };
  assert.equal(agent.probe(mkCtx(bp, { positionals: ['agt-001'], env })), EXIT.OK);
  const a = readBoard(bp).agents[0];
  assert.equal(a.probe.observed, 'alive');
  assert.equal(
    a.lifecycle.state,
    'running',
    'alive observation is evidence: orphaned must recover',
  );
  assert.equal(a.probe.method, 'session-file-mtime'); // 证据链照旧记录
});

test('probe pid semantics non-regression: kill -0 failure is still gone → orphaned', async () => {
  const { spawn } = await import('node:child_process');
  const bp = mkBoardHome();
  agent.create(mkCtx(bp, { values: { type: 'background-shell', harness: 'origin', intent: 'x' } }));
  const child = spawn('sleep', ['30'], { detached: true });
  const pid = child.pid as number;
  agent.bind(mkCtx(bp, { positionals: ['agt-001'], values: { handle: `pid:${pid}` } }));
  process.kill(pid, 'SIGKILL');
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(agent.probe(mkCtx(bp, { positionals: ['agt-001'] })), EXIT.OK);
  const a = readBoard(bp).agents[0];
  assert.equal(a.probe.observed, 'gone', 'pid is a deterministic death check: stays gone');
  assert.equal(a.lifecycle.state, 'orphaned');
});

test('probe seen-before: previously alive session file gets deleted → gone → orphaned', () => {
  // 真实缺陷（finding 2）：missing→unknown 修复后，session-bound worker 死亡 + 文件被清理的场景
  //   若无 seen-before 判定将永远检测不到（unknown 是 no-op，state 卡 running）。
  const claudeHome = mkTmp('ccm-hag-seen-');
  const bp = mkBoardHome();
  agent.create(mkCtx(bp, { values: { type: 'cli-worker', harness: 'claude-code', intent: 'x' } }));
  agent.bind(mkCtx(bp, { positionals: ['agt-001'], values: { handle: 'session-id:sid-del-1' } }));
  const slugDir = join(claudeHome, 'projects', '-repo-slug');
  mkdirSync(slugDir, { recursive: true });
  const sessionFile = join(slugDir, 'sid-del-1.jsonl');
  writeFileSync(sessionFile, '{}\n', 'utf8');
  const env = { CLAUDE_CONFIG_DIR: claudeHome };
  // 第一次 probe：观测 alive（建立 seen-before 证据链）。
  assert.equal(agent.probe(mkCtx(bp, { positionals: ['agt-001'], env })), EXIT.OK);
  let a = readBoard(bp).agents[0];
  assert.equal(a.probe.observed, 'alive');
  assert.equal(a.lifecycle.state, 'running');
  // 文件被清理：曾在而消失 = 真死亡证据 → gone → orphaned。
  rmSync(sessionFile);
  assert.equal(agent.probe(mkCtx(bp, { positionals: ['agt-001'], env })), EXIT.OK);
  a = readBoard(bp).agents[0];
  assert.equal(a.probe.observed, 'gone', 'seen-before + missing must be gone');
  assert.equal(a.lifecycle.state, 'orphaned');
});

test('probe evidence gate: pid alive does NOT revive orphaned (pid reuse ratchet)', () => {
  // 真实缺陷（finding 3）：kill-0 无法验证进程身份——pid 复用产生假 alive、EPERM 也判 alive；
  //   orphaned 的复活只认 mtime 类强证据。用本测试进程自身 pid 制造确定性 alive。
  const bp = mkBoardHome();
  agent.create(mkCtx(bp, { values: { type: 'background-shell', harness: 'origin', intent: 'x' } }));
  agent.bind(mkCtx(bp, { positionals: ['agt-001'], values: { handle: `pid:${process.pid}` } }));
  {
    const board = readBoard(bp);
    board.agents[0].lifecycle.state = 'orphaned'; // 模拟历史判死
    writeFileSync(bp, `${JSON.stringify(board, null, 2)}\n`, 'utf8');
  }
  assert.equal(agent.probe(mkCtx(bp, { positionals: ['agt-001'] })), EXIT.OK);
  const a = readBoard(bp).agents[0];
  assert.equal(a.probe.observed, 'alive', 'kill-0 on own pid is alive');
  assert.equal(a.lifecycle.state, 'orphaned', 'pid alive must NOT revive orphaned (weak evidence)');
});

test('probe evidence gate: uncertain + pid alive still recovers to running (uncertain ≠ dead)', () => {
  const bp = mkBoardHome();
  agent.create(mkCtx(bp, { values: { type: 'background-shell', harness: 'origin', intent: 'x' } }));
  agent.bind(mkCtx(bp, { positionals: ['agt-001'], values: { handle: `pid:${process.pid}` } }));
  {
    const board = readBoard(bp);
    board.agents[0].lifecycle.state = 'uncertain';
    writeFileSync(bp, `${JSON.stringify(board, null, 2)}\n`, 'utf8');
  }
  assert.equal(agent.probe(mkCtx(bp, { positionals: ['agt-001'] })), EXIT.OK);
  assert.equal(readBoard(bp).agents[0].lifecycle.state, 'running');
});

test('malformed agents entries (null / string) are skipped without crashing probe/list', () => {
  // 真实缺陷（finding 4）：agents:[null,…] 时 probe/list 对坏条目直接 TypeError 崩溃。
  const bp = mkBoardHome();
  agent.create(mkCtx(bp, { values: { type: 'subagent', harness: 'origin', intent: 'ok' } }));
  {
    const board = readBoard(bp);
    board.agents = [null, 'garbage', board.agents[0], 42];
    writeFileSync(bp, `${JSON.stringify(board, null, 2)}\n`, 'utf8');
  }
  const listCtx = mkCtx(bp, { flags: { json: true } });
  assert.equal(agent.list(listCtx), EXIT.OK);
  const data = JSON.parse(listCtx.outBuf.join('')).data;
  assert.equal(data.count, 1, 'bad entries silently skipped');
  assert.equal(data.agents[0].id, 'agt-001');
  const probeCtx = mkCtx(bp, { flags: { json: true } });
  assert.equal(agent.probe(probeCtx), EXIT.OK, 'probe must not crash on malformed entries');
  const probed = JSON.parse(probeCtx.outBuf.join('')).data.probed;
  assert.equal(probed.length, 1);
  assert.ok(probed[0].probe, 'valid agent still probed');
});

test('probe --freshness-sec rejects NaN / zero / negative as Usage (exit 2·never enters write path)', () => {
  const bp = mkBoardHome();
  agent.create(mkCtx(bp, { values: { type: 'cli-worker', harness: 'codex', intent: 'x' } }));
  // 真实缺陷（finding 5）：Number('5m')=NaN → 判活比较恒 false → 活 agent 恒 silent 被降级写盘。
  for (const bad of ['5m', 'abc', '0', '-30', 'NaN']) {
    const ctx = mkCtx(bp, { positionals: ['agt-001'], values: { 'freshness-sec': bad } });
    assert.throws(
      () => agent.probe(ctx),
      (e: Error & { errKind?: string }) => e.errKind === 'Usage',
      `--freshness-sec ${JSON.stringify(bad)} must be rejected`,
    );
  }
  // 拒绝发生在写路径之前：board 未被写入 probe 字段。
  assert.equal(readBoard(bp).agents[0].probe, undefined);
  // 合法值照常工作。
  assert.equal(
    agent.probe(mkCtx(bp, { positionals: ['agt-001'], values: { 'freshness-sec': '600' } })),
    EXIT.OK,
  );
});

test('probe --json exposes reconcile_rejected channel (state-machine SSOT guard annotation)', () => {
  const bp = mkBoardHome();
  agent.create(mkCtx(bp, { values: { type: 'subagent', harness: 'origin', intent: 'a' } }));
  const ctx = mkCtx(bp, { flags: { json: true } });
  assert.equal(agent.probe(ctx), EXIT.OK);
  const data = JSON.parse(ctx.outBuf.join('')).data;
  assert.deepEqual(
    data.reconcile_rejected,
    [],
    'channel present; empty when all transitions legal',
  );
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
