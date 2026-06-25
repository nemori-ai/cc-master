// handler-baseline.test.ts — P1·baseline noun handler（handlers/baseline.ts）契约门。
//
// baseline handler 照 watchdog 范式：snapshot（runWrite + mutations.baselineSnapshot + render）、
//   show（runRead + 读 board.baseline）、reset（runWrite + mutations.baselineReset·旧进 history）。
// 本测试用 mkdtemp 临时 home + 真 leaf + 临时板，端到端验证：
//   · snapshot 真把 baseline 对象写进临时板（captured_at 盖戳 + bac_h 计算）+ exit OK + render 出。
//   · snapshot --json render 出结构化 JSON；--dry-run 不落盘。
//   · snapshot 已有 baseline 时 exit VALIDATION（exit 3）；--force 强制覆盖。
//   · show 读出 baseline（human / --json）；无 baseline 报「has_baseline: false」。
//   · reset 旧 baseline 进 history[] + 建新快照（history_entries=1）；非 TTY 且无 --yes → throw Usage。
//   · reset --dry-run 不落盘。

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import type { Ctx } from '../src/handlers/_common.js';
import * as baselineHandler from '../src/handlers/baseline.js';
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
  baseline,
  tasks = [],
}: {
  baseline?: unknown;
  tasks?: unknown[];
} = {}): string {
  const root = mkTmp('ccm-hbl-');
  const home = join(root, '.claude', 'cc-master');
  mkdirSync(home, { recursive: true });
  const boardPath = join(home, '2026-06-25-bl.board.json');
  const board: Record<string, unknown> = {
    schema: 'cc-master/v2',
    meta: { template_version: 3 },
    goal: 'baseline handler test',
    owner: { active: true, session_id: 'sid-bl', heartbeat: '2026-06-25T08:00:00Z' },
    git: { worktree: '', branch: '' },
    scheduling: { wip_limit: 4 },
    tasks,
    log: [],
  };
  if (baseline !== undefined) board.baseline = baseline;
  writeFileSync(boardPath, `${JSON.stringify(board, null, 2)}\n`, 'utf8');
  return boardPath;
}

type TestCtx = Ctx & { outBuf: string[]; errBuf: string[] };
function mkCtx(
  boardPath: string | null,
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
    values: { ...(boardPath ? { board: boardPath } : {}), ...values },
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
    sid: 'sid-bl',
    env: {},
    out: (s: string) => outBuf.push(s),
    err: (s: string) => errBuf.push(s),
    isTTY,
    outBuf,
    errBuf,
  };
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

// ══ baseline snapshot ═════════════════════════════════════════════════════════════════════════════

test('baseline snapshot writes baseline object with bac_h calculated', () => {
  const boardPath = mkBoardHome({
    tasks: [
      { id: 'T1', status: 'ready', deps: [], estimate: { value: 2, unit: 'h' } },
      { id: 'T2', status: 'ready', deps: ['T1'], estimate: { value: 3, unit: 'h' } },
    ],
  });
  const ctx = mkCtx(boardPath);
  const code = baselineHandler.snapshot(ctx);
  assert.equal(code, EXIT.OK);
  const board = JSON.parse(readFileSync(boardPath, 'utf8'));
  assert.ok(board.baseline, 'baseline must be written');
  assert.ok(ISO_RE.test(board.baseline.captured_at), 'captured_at must be ISO');
  assert.ok(ISO_RE.test(board.baseline.t0), 't0 must be ISO');
  assert.equal(board.baseline.bac_h, 5);
  assert.deepEqual(Object.keys(board.baseline.task_estimates).sort(), ['T1', 'T2'].sort());
  assert.ok(Array.isArray(board.baseline.history) && board.baseline.history.length === 0);
});

test('baseline snapshot with --t0 uses provided t0', () => {
  const boardPath = mkBoardHome();
  const t0 = '2026-06-25T08:00:00Z';
  const ctx = mkCtx(boardPath, { values: { t0 } });
  const code = baselineHandler.snapshot(ctx);
  assert.equal(code, EXIT.OK);
  const board = JSON.parse(readFileSync(boardPath, 'utf8'));
  assert.equal(board.baseline.t0, t0);
});

test('baseline snapshot human render contains captured_at and bac_h', () => {
  const boardPath = mkBoardHome({
    tasks: [{ id: 'T1', status: 'ready', deps: [], estimate: { value: 4, unit: 'h' } }],
  });
  const ctx = mkCtx(boardPath);
  baselineHandler.snapshot(ctx);
  assert.ok(ctx.outBuf.join('').includes('snapshot OK'));
  assert.ok(ctx.outBuf.join('').includes('bac_h=4'));
});

test('baseline snapshot --json renders structured JSON', () => {
  const boardPath = mkBoardHome();
  const ctx = mkCtx(boardPath, { flags: { json: true } });
  const code = baselineHandler.snapshot(ctx);
  assert.equal(code, EXIT.OK);
  const out = JSON.parse(ctx.outBuf.join(''));
  assert.equal(out.ok, true);
  assert.equal(typeof out.data.has_baseline, 'boolean');
});

test('baseline snapshot --dry-run does not write to disk', () => {
  const boardPath = mkBoardHome();
  const before = readFileSync(boardPath, 'utf8');
  const ctx = mkCtx(boardPath, { flags: { dryRun: true } });
  const code = baselineHandler.snapshot(ctx);
  assert.equal(code, EXIT.OK);
  const after = readFileSync(boardPath, 'utf8');
  // The board was not modified (heartbeat would change if written)
  const beforeBoard = JSON.parse(before);
  const afterBoard = JSON.parse(after);
  assert.equal(beforeBoard.owner.heartbeat, afterBoard.owner.heartbeat);
  assert.ok(ctx.outBuf.join('').includes('dry-run'));
});

test('baseline snapshot throws Validation when baseline already exists (no --force)', () => {
  const existingBaseline = {
    captured_at: '2026-06-25T08:00:00Z',
    t0: '2026-06-25T08:00:00Z',
    task_estimates: {},
    dag_snapshot: {},
    bac_h: 0,
    history: [],
  };
  const boardPath = mkBoardHome({ baseline: existingBaseline });
  const ctx = mkCtx(boardPath);
  // handler 在 mutate 内 throw errKind='Validation'（router 的 reportHandlerError 据此映射 EXIT.VALIDATION，
  // 与 reset 非 TTY throw 'Usage' 同模式）；测试直接调 handler 绕过 router，故断言 throw 而非返回码。
  assert.throws(
    () => baselineHandler.snapshot(ctx),
    (e: Error & { errKind?: string }) => {
      assert.equal(e.errKind, 'Validation');
      return true;
    },
  );
});

test('baseline snapshot --force overwrites existing baseline', () => {
  const existingBaseline = {
    captured_at: '2026-06-25T08:00:00Z',
    t0: '2026-06-25T08:00:00Z',
    task_estimates: { OLD: { value: 99, unit: 'h' } },
    dag_snapshot: {},
    bac_h: 99,
    history: [],
  };
  const boardPath = mkBoardHome({ baseline: existingBaseline });
  const ctx = mkCtx(boardPath, { flags: { force: true } });
  const code = baselineHandler.snapshot(ctx);
  assert.equal(code, EXIT.OK);
  const board = JSON.parse(readFileSync(boardPath, 'utf8'));
  // OLD task_estimates should be gone (replaced with empty since no tasks)
  assert.ok(!board.baseline.task_estimates.OLD, 'old task estimate should not be present');
});

// ══ baseline show ═══════════════════════════════════════════════════════════════════════════════

test('baseline show returns has_baseline: false when no baseline', () => {
  const boardPath = mkBoardHome();
  const ctx = mkCtx(boardPath);
  const code = baselineHandler.show(ctx);
  assert.equal(code, EXIT.OK);
  assert.ok(ctx.outBuf.join('').includes('has_baseline: false'));
});

test('baseline show renders baseline fields when present', () => {
  const bl = {
    captured_at: '2026-06-25T08:05:00Z',
    t0: '2026-06-25T08:00:00Z',
    task_estimates: { T1: { value: 2, unit: 'h' } },
    dag_snapshot: {},
    bac_h: 2,
    history: [],
  };
  const boardPath = mkBoardHome({ baseline: bl });
  const ctx = mkCtx(boardPath);
  const code = baselineHandler.show(ctx);
  assert.equal(code, EXIT.OK);
  const out = ctx.outBuf.join('');
  assert.ok(out.includes('has_baseline: true'));
  assert.ok(out.includes('bac_h: 2'));
  assert.ok(out.includes('task_estimates: 1 tasks'));
  assert.ok(out.includes('history: 0 entries'));
});

test('baseline show --json returns structured data', () => {
  const bl = {
    captured_at: '2026-06-25T08:05:00Z',
    t0: '2026-06-25T08:00:00Z',
    task_estimates: {},
    dag_snapshot: {},
    bac_h: 0,
    history: [],
  };
  const boardPath = mkBoardHome({ baseline: bl });
  const ctx = mkCtx(boardPath, { flags: { json: true } });
  const code = baselineHandler.show(ctx);
  assert.equal(code, EXIT.OK);
  const out = JSON.parse(ctx.outBuf.join(''));
  assert.equal(out.ok, true);
  assert.equal(out.data.has_baseline, true);
  assert.ok(out.data.baseline);
});

// ══ baseline reset ═══════════════════════════════════════════════════════════════════════════════

test('baseline reset throws Usage in non-TTY without --yes', () => {
  const boardPath = mkBoardHome();
  const ctx = mkCtx(boardPath, { isTTY: false });
  assert.throws(
    () => baselineHandler.reset(ctx),
    (e: Error & { errKind?: string }) => {
      assert.equal(e.errKind, 'Usage');
      return true;
    },
  );
});

test('baseline reset moves old baseline to history and creates new', () => {
  const existingBaseline = {
    captured_at: '2026-06-25T08:05:00Z',
    t0: '2026-06-25T08:00:00Z',
    task_estimates: { T1: { value: 2, unit: 'h' } },
    dag_snapshot: { T1: { deps: [] } },
    bac_h: 2,
    history: [],
  };
  const boardPath = mkBoardHome({
    baseline: existingBaseline,
    tasks: [{ id: 'T2', status: 'ready', deps: [], estimate: { value: 5, unit: 'h' } }],
  });
  const ctx = mkCtx(boardPath, { flags: { yes: true }, isTTY: false });
  const code = baselineHandler.reset(ctx);
  assert.equal(code, EXIT.OK);
  const board = JSON.parse(readFileSync(boardPath, 'utf8'));
  assert.ok(board.baseline, 'new baseline must exist');
  assert.equal(board.baseline.bac_h, 5, 'new bac_h from T2');
  assert.ok(
    Array.isArray(board.baseline.history) && board.baseline.history.length === 1,
    'old baseline moved to history',
  );
  assert.ok(ISO_RE.test(board.baseline.history[0].reset_at), 'history entry has ISO reset_at');
  assert.equal(board.baseline.history[0].bac_h, 2, 'history preserves old bac_h');
});

test('baseline reset with no existing baseline creates fresh baseline', () => {
  const boardPath = mkBoardHome({
    tasks: [{ id: 'T1', status: 'ready', deps: [], estimate: { value: 3, unit: 'h' } }],
  });
  const ctx = mkCtx(boardPath, { isTTY: true });
  const code = baselineHandler.reset(ctx);
  assert.equal(code, EXIT.OK);
  const board = JSON.parse(readFileSync(boardPath, 'utf8'));
  assert.ok(board.baseline, 'baseline must be created');
  assert.equal(board.baseline.bac_h, 3);
  assert.deepEqual(board.baseline.history, []);
});

test('baseline reset --dry-run does not write to disk', () => {
  const boardPath = mkBoardHome();
  const before = readFileSync(boardPath, 'utf8');
  const ctx = mkCtx(boardPath, { flags: { dryRun: true, yes: true }, isTTY: false });
  const code = baselineHandler.reset(ctx);
  assert.equal(code, EXIT.OK);
  const after = readFileSync(boardPath, 'utf8');
  const beforeBoard = JSON.parse(before);
  const afterBoard = JSON.parse(after);
  assert.equal(beforeBoard.owner.heartbeat, afterBoard.owner.heartbeat);
  assert.ok(ctx.outBuf.join('').includes('dry-run'));
});

test('baseline reset human render includes history_entries count', () => {
  const boardPath = mkBoardHome({ isTTY: true } as any);
  const ctx = mkCtx(boardPath, { isTTY: true });
  baselineHandler.reset(ctx);
  assert.ok(ctx.outBuf.join('').includes('history_entries=0'));
});

test('baseline reset --json renders structured JSON', () => {
  const boardPath = mkBoardHome();
  const ctx = mkCtx(boardPath, { flags: { json: true }, isTTY: true });
  const code = baselineHandler.reset(ctx);
  assert.equal(code, EXIT.OK);
  const out = JSON.parse(ctx.outBuf.join(''));
  assert.equal(out.ok, true);
  assert.equal(typeof out.data.history_entries, 'number');
});
