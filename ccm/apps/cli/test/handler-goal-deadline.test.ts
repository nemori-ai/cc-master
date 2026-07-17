// handler-goal-deadline.test.ts — ccm goal deadline <verb> + goal check verdict 扩展（issue #149）端到端契约门。
//
// 用 mkdtemp 临时 home + 真 leaf + 临时板，端到端验证 handler 层：
//   · deadline set|confirm|confirm-none|amend|show（写盘 + 授权闸 + rev + --json）。
//   · goal check verdict：deadline_pending（goal settled·DDL 未 settle·exit 0）、ok（都 settle）、
//     malformed（deadline 形状坏·exit 3）、none 持久（confirm-none 后 ok）。

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import type { Ctx } from '../src/handlers/_common.js';
import * as goalHandler from '../src/handlers/goal.js';
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

function mkBoardHome({
  assurance = 'asserted',
  deadline,
  tasks = [],
}: {
  assurance?: string;
  deadline?: unknown;
  tasks?: unknown[];
} = {}): string {
  const root = mkTmp('ccm-hdl-');
  const home = join(root, '.claude', 'cc-master');
  mkdirSync(home, { recursive: true });
  const boardPath = join(home, '2026-07-16-ddl.board.json');
  const goalContract: Record<string, unknown> = {
    schema: 'ccm/goal-contract/v1',
    revision: 1,
    assurance,
    updated_at: '2026-07-16T10:00:00Z',
  };
  if (deadline !== undefined) goalContract.deadline = deadline;
  const board: Record<string, unknown> = {
    schema: 'cc-master/v2',
    meta: { template_version: 3 },
    goal: 'ship the ddl feature',
    goal_contract: goalContract,
    owner: { active: true, session_id: 'sid-dl', heartbeat: '2026-07-16T08:00:00Z' },
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
    isTTY = true,
  }: {
    values?: Record<string, unknown>;
    flags?: Partial<Ctx['flags']>;
    positionals?: string[];
    isTTY?: boolean;
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
      quiet: false,
      verbose: false,
      color: false,
      ...flags,
    },
    sid: 'sid-dl',
    env: {},
    out: (s: string) => outBuf.push(s),
    err: (s: string) => errBuf.push(s),
    isTTY,
    outBuf,
    errBuf,
  };
}

function readBoard(boardPath: string): Record<string, any> {
  return JSON.parse(readFileSync(boardPath, 'utf8'));
}

// ══ deadline set ═════════════════════════════════════════════════════════════════════════════════
test('goal deadline set writes an asserted deadline to disk', () => {
  const boardPath = mkBoardHome();
  const ctx = mkCtx(boardPath, {
    positionals: ['set'],
    values: { at: '2027-08-01T09:00:00Z', source: 'cli-flag' },
  });
  const code = goalHandler.deadline(ctx);
  assert.equal(code, EXIT.OK);
  const dl = readBoard(boardPath).goal_contract.deadline;
  assert.equal(dl.state, 'asserted');
  assert.equal(dl.at, '2027-08-01T09:00:00Z');
  assert.equal(dl.rev, 1);
});

test('goal deadline set --json returns ok:true with deadline block', () => {
  const boardPath = mkBoardHome();
  const ctx = mkCtx(boardPath, {
    positionals: ['set'],
    values: { at: '2027-08-01T09:00:00Z' },
    flags: { json: true },
  });
  const code = goalHandler.deadline(ctx);
  assert.equal(code, EXIT.OK);
  const out = JSON.parse(ctx.outBuf.join(''));
  assert.equal(out.ok, true);
  assert.equal(out.data.deadline.state, 'asserted');
});

// ══ deadline confirm ═════════════════════════════════════════════════════════════════════════════
test('goal deadline confirm requires --user-authorized (mutation throws → router maps exit 3)', () => {
  const boardPath = mkBoardHome({
    deadline: {
      state: 'asserted',
      at: '2027-08-01T09:00:00Z',
      kind: 'hard',
      rev: 1,
      updated_at: '2026-07-16T10:00:00Z',
    },
  });
  const ctx = mkCtx(boardPath, { positionals: ['confirm'], values: {} });
  // 未授权时 mutation throw errKind='Validation'（router 映射 exit 3）——handler 直调时 throw 冒泡。
  assert.throws(() => goalHandler.deadline(ctx), /user-authorized/);
});

test('goal deadline confirm --user-authorized upgrades to confirmed rev+1', () => {
  const boardPath = mkBoardHome({
    deadline: {
      state: 'asserted',
      at: '2027-08-01T09:00:00Z',
      kind: 'hard',
      rev: 1,
      updated_at: '2026-07-16T10:00:00Z',
    },
  });
  const ctx = mkCtx(boardPath, { positionals: ['confirm'], values: { 'user-authorized': true } });
  const code = goalHandler.deadline(ctx);
  assert.equal(code, EXIT.OK);
  const dl = readBoard(boardPath).goal_contract.deadline;
  assert.equal(dl.state, 'confirmed');
  assert.equal(dl.rev, 2);
});

// ══ deadline confirm-none ════════════════════════════════════════════════════════════════════════
test('goal deadline confirm-none persists none (≠ 未询问)', () => {
  const boardPath = mkBoardHome();
  const ctx = mkCtx(boardPath, {
    positionals: ['confirm-none'],
    values: { 'user-authorized': true },
  });
  const code = goalHandler.deadline(ctx);
  assert.equal(code, EXIT.OK);
  const dl = readBoard(boardPath).goal_contract.deadline;
  assert.equal(dl.state, 'none');
  assert.equal(dl.at, undefined);
});

// ══ deadline amend ═══════════════════════════════════════════════════════════════════════════════
test('goal deadline amend requires --reason + --user-authorized and records audit', () => {
  const boardPath = mkBoardHome({
    deadline: {
      state: 'confirmed',
      at: '2027-08-01T09:00:00Z',
      kind: 'hard',
      rev: 2,
      updated_at: '2026-07-16T10:00:00Z',
    },
  });
  const ctx = mkCtx(boardPath, {
    positionals: ['amend'],
    values: { at: '2027-08-10T09:00:00Z', reason: '用户批准延期', 'user-authorized': true },
  });
  const code = goalHandler.deadline(ctx);
  assert.equal(code, EXIT.OK);
  const board = readBoard(boardPath);
  assert.equal(board.goal_contract.deadline.at, '2027-08-10T09:00:00Z');
  assert.equal(board.goal_contract.deadline.rev, 3);
  assert.ok(board.log.some((e: any) => /Delivery deadline amended/.test(e.summary)));
});

// ══ deadline show ════════════════════════════════════════════════════════════════════════════════
test('goal deadline show --json reports the deadline block + time_remaining_hours', () => {
  const boardPath = mkBoardHome({
    deadline: {
      state: 'confirmed',
      at: '2027-08-01T09:00:00Z',
      kind: 'hard',
      rev: 2,
      updated_at: '2026-07-16T10:00:00Z',
    },
  });
  const ctx = mkCtx(boardPath, { positionals: ['show'], flags: { json: true } });
  const code = goalHandler.deadline(ctx);
  assert.equal(code, EXIT.OK);
  const out = JSON.parse(ctx.outBuf.join(''));
  assert.equal(out.data.state, 'confirmed');
  assert.equal(out.data.at, '2027-08-01T09:00:00Z');
  assert.ok('time_remaining_hours' in out.data);
});

// ══ deadline unknown subcommand ══════════════════════════════════════════════════════════════════
test('goal deadline with no/unknown subcommand throws Usage', () => {
  const boardPath = mkBoardHome();
  const ctx = mkCtx(boardPath, { positionals: [] });
  assert.throws(() => goalHandler.deadline(ctx), /subcommand/);
});

// ══ goal check verdict 扩展 ═══════════════════════════════════════════════════════════════════════
// goal check --json 输出经 render.jsonString 包成 {ok:true, data:{...GoalCheckResult}}。
function checkData(ctx: TestCtx): Record<string, any> {
  return JSON.parse(ctx.outBuf.join('')).data;
}

test('goal check → deadline_pending when goal settled but deadline unset (exit 0)', () => {
  const boardPath = mkBoardHome({ assurance: 'asserted' }); // no deadline
  const ctx = mkCtx(boardPath, { positionals: [], flags: { json: true } });
  const code = goalHandler.check(ctx);
  assert.equal(code, EXIT.OK);
  const data = checkData(ctx);
  assert.equal(data.verdict, 'deadline_pending');
  assert.equal(data.deadline.present, false);
});

test('goal check → ok once deadline settled (asserted)', () => {
  const boardPath = mkBoardHome({
    assurance: 'asserted',
    deadline: {
      state: 'asserted',
      at: '2027-08-01T09:00:00Z',
      kind: 'hard',
      rev: 1,
      updated_at: '2026-07-16T10:00:00Z',
    },
  });
  const ctx = mkCtx(boardPath, { positionals: [], flags: { json: true } });
  const code = goalHandler.check(ctx);
  assert.equal(code, EXIT.OK);
  const data = checkData(ctx);
  assert.equal(data.verdict, 'ok');
  assert.equal(data.deadline.settled, true);
});

test('goal check → ok when no-DDL confirmed (none is settled)', () => {
  const boardPath = mkBoardHome({
    assurance: 'asserted',
    deadline: { state: 'none', kind: 'hard', rev: 1, updated_at: '2026-07-16T10:00:00Z' },
  });
  const ctx = mkCtx(boardPath, { positionals: [], flags: { json: true } });
  const code = goalHandler.check(ctx);
  assert.equal(code, EXIT.OK);
  assert.equal(checkData(ctx).verdict, 'ok');
});

test('goal check → still pending when goal itself unsettled (goal pending dominates)', () => {
  const boardPath = mkBoardHome({ assurance: 'pending' });
  const ctx = mkCtx(boardPath, { positionals: [], flags: { json: true } });
  const code = goalHandler.check(ctx);
  assert.equal(code, EXIT.OK);
  assert.equal(checkData(ctx).verdict, 'pending');
});

test('goal check → malformed (exit 3) on bad deadline shape', () => {
  const boardPath = mkBoardHome({
    assurance: 'asserted',
    deadline: { state: 'confirmed' }, // confirmed without at → FMT-DEADLINE hard
  });
  const ctx = mkCtx(boardPath, { positionals: [], flags: { json: true } });
  const code = goalHandler.check(ctx);
  assert.equal(code, EXIT.VALIDATION);
  assert.equal(checkData(ctx).verdict, 'malformed');
});
