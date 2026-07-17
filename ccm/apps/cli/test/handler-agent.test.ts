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

// ── stale-running advisory（收割闭环缺口的机械兜底·只读·绝不自动 terminal）────────────────────────────
test('list stale-running advisory: active agent whose every linked task is done → surfaced (never auto-terminal)', () => {
  // 产出被收割（linked task 全 done）却漏了 `agent terminal`，roster 永停 running。list 在 recon 的
  //   roster-rebuild 触点把候选交到手上（advisory）——但绝不改状态（三层解耦：收口判断归 orchestrator）。
  const bp = mkBoardHome([
    { id: 'T1', status: 'done', deps: [], verified: true, artifact: '/tmp/t1.md' },
    { id: 'T2', status: 'in_flight', deps: [], started_at: '2026-07-16T08:00:00Z' },
  ]);
  // agt-001：linked task 全 done → stale 候选
  agent.create(mkCtx(bp, { values: { type: 'subagent', harness: 'origin', intent: 'harvested' } }));
  agent.bind(mkCtx(bp, { positionals: ['agt-001'], values: { handle: 'pid:1' } }));
  agent.link(mkCtx(bp, { positionals: ['agt-001'], values: { task: 'T1' } }));
  // agt-002：linked task 仍 in_flight → 不算 stale（仍在干活）
  agent.create(mkCtx(bp, { values: { type: 'subagent', harness: 'origin', intent: 'working' } }));
  agent.bind(mkCtx(bp, { positionals: ['agt-002'], values: { handle: 'pid:2' } }));
  agent.link(mkCtx(bp, { positionals: ['agt-002'], values: { task: 'T2' } }));

  const listCtx = mkCtx(bp, { flags: { json: true } });
  assert.equal(agent.list(listCtx), EXIT.OK);
  const data = JSON.parse(listCtx.outBuf.join('')).data;
  assert.equal(data.stale_candidates.length, 1, 'only the all-linked-done agent is a candidate');
  assert.equal(data.stale_candidates[0].id, 'agt-001');
  assert.deepEqual(data.stale_candidates[0].links, ['T1']);

  // advisory 绝不改状态：agt-001 仍 running（never auto-terminal·三层解耦）
  assert.equal(readBoard(bp).agents[0].lifecycle.state, 'running');

  // human 输出含 advisory 提示行，指名 agt-001
  const humanCtx = mkCtx(bp, { flags: { json: false } });
  assert.equal(agent.list(humanCtx), EXIT.OK);
  assert.match(humanCtx.outBuf.join(''), /advisory:[\s\S]*agt-001/);
});

test('list stale-running advisory: terminal agent and no-link agent are not candidates', () => {
  const bp = mkBoardHome([
    { id: 'T1', status: 'done', deps: [], verified: true, artifact: '/tmp/t1.md' },
  ]);
  // agt-001：已 terminal（已收口）→ 不再是候选
  agent.create(mkCtx(bp, { values: { type: 'subagent', harness: 'origin', intent: 'x' } }));
  agent.link(mkCtx(bp, { positionals: ['agt-001'], values: { task: 'T1' } }));
  agent.terminal(mkCtx(bp, { positionals: ['agt-001'], values: { outcome: 'closed' } }));
  // agt-002：无 link → 不算候选（不确定它在干什么）
  agent.create(mkCtx(bp, { values: { type: 'subagent', harness: 'origin', intent: 'y' } }));

  const listCtx = mkCtx(bp, { flags: { json: true } });
  assert.equal(agent.list(listCtx), EXIT.OK);
  const data = JSON.parse(listCtx.outBuf.join('')).data;
  assert.equal(data.stale_candidates.length, 0);
  // 无候选时 human 输出不带 advisory 行
  const humanCtx = mkCtx(bp, { flags: { json: false } });
  assert.equal(agent.list(humanCtx), EXIT.OK);
  assert.doesNotMatch(humanCtx.outBuf.join(''), /advisory:/);
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

// ── amend（登记簿事后补正·handle 域三件套·任何状态可用含 terminal）────────────────────────────────────
test('amend fixes handle domain on a terminal agent (the real-world gap: bad handle found after terminal)', () => {
  // 真实缺口：坏 handle（task-id + resume --last）在 agent 已 terminal 后才发现——bind 被状态机拒，
  //   此前唯一出路是重复登记新 record（roster 撕成两行）。amend 是事后补正出口。
  const bp = mkBoardHome([
    { id: 'T1', status: 'in_flight', deps: [], started_at: '2026-07-16T08:00:00Z' },
  ]);
  agent.create(mkCtx(bp, { values: { type: 'cli-worker', harness: 'codex', intent: 'review' } }));
  agent.bind(
    mkCtx(bp, {
      positionals: ['agt-001'],
      values: { handle: 'task-id:worker-7', 'attach-cmd': 'codex resume --last' }, // 坏 handle
    }),
  );
  agent.link(mkCtx(bp, { positionals: ['agt-001'], values: { task: 'T1' } }));
  agent.terminal(mkCtx(bp, { positionals: ['agt-001'], values: { outcome: 'done' } }));
  const before = readBoard(bp).agents[0];

  const ctx = mkCtx(bp, {
    positionals: ['agt-001'],
    values: {
      handle: 'session-id:0197-real-sid',
      'attach-cmd': 'codex resume 0197-real-sid',
      transcript: '/abs/rollout.jsonl',
    },
    flags: { json: true },
  });
  assert.equal(agent.amend(ctx), EXIT.OK);
  const out = JSON.parse(ctx.outBuf.join('')).data.agent;
  assert.equal(out.handle.kind, 'session-id');
  assert.equal(out.handle.value, '0197-real-sid');

  const after = readBoard(bp).agents[0];
  assert.equal(after.handle.kind, 'session-id');
  assert.equal(after.handle.value, '0197-real-sid');
  assert.equal(after.handle.attach_cmd, 'codex resume 0197-real-sid');
  assert.equal(after.handle.transcript_ref, '/abs/rollout.jsonl');
  // 只动 handle 域：lifecycle / probe / links / intent 一字不动。
  assert.deepEqual(after.lifecycle, before.lifecycle, 'lifecycle untouched (state stays terminal)');
  assert.equal(after.lifecycle.state, 'terminal');
  assert.deepEqual(after.links, before.links, 'links untouched');
  assert.equal(after.intent, before.intent, 'intent untouched');
  assert.deepEqual(after.probe, before.probe, 'probe untouched');
});

test('amend works in every lifecycle state (starting/running/uncertain/orphaned/terminal)', () => {
  const bp = mkBoardHome();
  for (const state of ['starting', 'running', 'uncertain', 'orphaned', 'terminal']) {
    agent.create(mkCtx(bp, { values: { type: 'subagent', harness: 'origin', intent: state } }));
  }
  {
    const board = readBoard(bp);
    const states = ['starting', 'running', 'uncertain', 'orphaned', 'terminal'];
    board.agents.forEach((a: any, i: number) => {
      a.lifecycle.state = states[i];
    });
    writeFileSync(bp, `${JSON.stringify(board, null, 2)}\n`, 'utf8');
  }
  for (let i = 1; i <= 5; i++) {
    const id = `agt-00${i}`;
    assert.equal(
      agent.amend(mkCtx(bp, { positionals: [id], values: { handle: `pid:${i}` } })),
      EXIT.OK,
      `amend must work on ${id}`,
    );
  }
  const board = readBoard(bp);
  const states = ['starting', 'running', 'uncertain', 'orphaned', 'terminal'];
  board.agents.forEach((a: any, i: number) => {
    assert.equal(a.handle.kind, 'pid');
    assert.equal(a.handle.value, String(i + 1));
    assert.equal(a.lifecycle.state, states[i], 'amend never transitions state');
  });
});

test('amend rejects illegal handle kind / empty value (same validation as bind)', () => {
  const bp = mkBoardHome();
  agent.create(mkCtx(bp, { values: { type: 'cli-worker', harness: 'codex', intent: 'x' } }));
  for (const bad of ['', 'pid:', 'garbage-no-colon', 'bogus-kind:val']) {
    const ctx = mkCtx(bp, { positionals: ['agt-001'], values: { handle: bad } });
    assert.throws(
      () => agent.amend(ctx),
      (e: Error & { errKind?: string }) => e.errKind === 'Validation',
      `handle=${JSON.stringify(bad)} must be rejected`,
    );
  }
  // 记录未被改动。
  assert.equal(readBoard(bp).agents[0].handle.kind, 'none');
});

test('amend requires at least one of --handle/--attach-cmd/--transcript (Usage); missing id → NotFound', () => {
  const bp = mkBoardHome();
  agent.create(mkCtx(bp, { values: { type: 'cli-worker', harness: 'codex', intent: 'x' } }));
  assert.throws(
    () => agent.amend(mkCtx(bp, { positionals: ['agt-001'], values: {} })),
    (e: Error & { errKind?: string }) => e.errKind === 'Usage',
  );
  assert.throws(
    () => agent.amend(mkCtx(bp, { positionals: ['agt-404'], values: { handle: 'pid:1' } })),
    (e: Error & { errKind?: string }) => e.errKind === 'NotFound',
  );
  // 单项补正也合法（attach-cmd only）。
  assert.equal(
    agent.amend(mkCtx(bp, { positionals: ['agt-001'], values: { 'attach-cmd': 'claude -r sid' } })),
    EXIT.OK,
  );
  const a = readBoard(bp).agents[0];
  assert.equal(a.handle.attach_cmd, 'claude -r sid');
  assert.equal(a.handle.kind, 'none', 'handle kind untouched when only attach-cmd amended');
});

test('probe after amend locates by the new handle: terminal agent gets fresh mtime observation, state stays terminal', () => {
  // amend 补上真 sid 后 probe 能用新 handle 定位到会话文件（mtime 观测更新），
  //   但 terminal 是唯一终态——reconcile 绝不复活，只有 probe 字段更新。
  const claudeHome = mkTmp('ccm-hag-amend-');
  const bp = mkBoardHome();
  agent.create(mkCtx(bp, { values: { type: 'cli-worker', harness: 'claude-code', intent: 'x' } }));
  agent.bind(mkCtx(bp, { positionals: ['agt-001'], values: { handle: 'task-id:worker-x' } })); // 坏 handle
  agent.terminal(mkCtx(bp, { positionals: ['agt-001'], values: { outcome: 'done' } }));
  const slugDir = join(claudeHome, 'projects', '-repo-slug');
  mkdirSync(slugDir, { recursive: true });
  writeFileSync(join(slugDir, 'sid-amended-1.jsonl'), '{}\n', 'utf8'); // 真会话文件·mtime=now
  assert.equal(
    agent.amend(
      mkCtx(bp, { positionals: ['agt-001'], values: { handle: 'session-id:sid-amended-1' } }),
    ),
    EXIT.OK,
  );
  const env = { CLAUDE_CONFIG_DIR: claudeHome };
  assert.equal(agent.probe(mkCtx(bp, { positionals: ['agt-001'], env })), EXIT.OK);
  const a = readBoard(bp).agents[0];
  assert.equal(a.probe.method, 'session-file-mtime', 'probe located via amended handle');
  assert.equal(a.probe.observed, 'alive', 'fresh mtime observation through the new sid');
  assert.equal(a.lifecycle.state, 'terminal', 'terminal never resurrected by probe');
});

// ── rm（登记簿删除·破坏性·非 TTY 须 --yes）───────────────────────────────────────────────────────────
test('rm deletes an agent record including its links; --json returns removed id', () => {
  const bp = mkBoardHome([
    { id: 'T1', status: 'in_flight', deps: [], started_at: '2026-07-16T08:00:00Z' },
  ]);
  agent.create(mkCtx(bp, { values: { type: 'cli-worker', harness: 'codex', intent: 'dup' } }));
  agent.create(mkCtx(bp, { values: { type: 'cli-worker', harness: 'codex', intent: 'keep' } }));
  agent.link(mkCtx(bp, { positionals: ['agt-001'], values: { task: 'T1' } }));
  const ctx = mkCtx(bp, { positionals: ['agt-001'], flags: { json: true } });
  assert.equal(agent.rm(ctx), EXIT.OK);
  assert.equal(JSON.parse(ctx.outBuf.join('')).data.removed, 'agt-001');
  const board = readBoard(bp);
  assert.equal(board.agents.length, 1, 'record removed (links live agent-side, gone with it)');
  assert.equal(board.agents[0].id, 'agt-002');
  assert.equal(board.tasks[0].status, 'in_flight', 'task untouched');
});

test('rm on nonexistent agent → NotFound (exit 5)', () => {
  const bp = mkBoardHome();
  assert.throws(
    () => agent.rm(mkCtx(bp, { positionals: ['agt-404'] })),
    (e: Error & { errKind?: string }) => e.errKind === 'NotFound',
  );
});

test('rm is destructive: non-TTY without --yes refused as USAGE; --yes passes (task rm parity)', () => {
  const bp = mkBoardHome();
  agent.create(mkCtx(bp, { values: { type: 'subagent', harness: 'origin', intent: 'x' } }));
  const refused = mkCtx(bp, { positionals: ['agt-001'] });
  (refused as { isTTY: boolean }).isTTY = false;
  assert.equal(agent.rm(refused), EXIT.USAGE);
  assert.ok(refused.errBuf.join('').includes('--yes'), 'refusal explains --yes');
  assert.equal(readBoard(bp).agents.length, 1, 'nothing deleted on refusal');
  const confirmed = mkCtx(bp, { positionals: ['agt-001'], flags: { yes: true } });
  (confirmed as { isTTY: boolean }).isTTY = false;
  assert.equal(agent.rm(confirmed), EXIT.OK);
  assert.equal(readBoard(bp).agents.length, 0);
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
