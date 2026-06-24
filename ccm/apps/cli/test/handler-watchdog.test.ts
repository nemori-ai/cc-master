// handler-watchdog.test.ts — P5.2·watchdog noun handler（handlers/watchdog.ts）契约门。
//
// watchdog.ts 照 log.ts 范式：arm（runWrite + mutations.watchdogArm + render）、disarm（runWrite + watchdogDisarm·幂等）、
//   status（runRead + 读 board.watchdog）。本测试用 mkdtemp 临时 home + 真 leaf + 临时板，端到端验证：
//     · arm 真把 watchdog 整对象写进临时板（armed_at 盖戳·fire_at/mechanism/job_id/checklist 落字段）+ exit OK + render 出。
//     · arm --json render 出 watchdog 的统一壳 JSON；--dry-run 不落盘。
//     · disarm 把 watchdog 置 null（删整对象不留残骸）+ 幂等（无 watchdog 也 OK）+ 带 job_id 时 human 提示清理。
//     · status 读出 watchdog（human 字段列 / --json 结构化）；无 watchdog 报「未武装」。
//     · 错误：status 找不到 active board → NOT_FOUND（discover throw NotFound 冒泡·router 才 catch，这里验 throw .errKind）。
//
// T2b port 注：原 .mjs 经 createRequire 加载 CJS，改成 ESM import ported .ts 源。断言逻辑逐字保持。
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import type { Ctx } from '../src/handlers/_common.js';
import * as wdHandler from '../src/handlers/watchdog.js';
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

function mkBoardHome({ watchdog }: { watchdog?: unknown } = {}): string {
  const root = mkTmp('ccm-hwd-');
  const home = join(root, '.claude', 'cc-master');
  mkdirSync(home, { recursive: true });
  const boardPath = join(home, '2026-06-24-wd.board.json');
  const board: Record<string, unknown> = {
    schema: 'cc-master/v2',
    meta: { template_version: 3 },
    goal: 'watchdog handler test',
    owner: { active: true, session_id: 'sid-wd', heartbeat: '2026-06-24T10:00:00Z' },
    git: { worktree: '', branch: '' },
    scheduling: { wip_limit: 4 },
    tasks: [],
    log: [],
  };
  if (watchdog !== undefined) board.watchdog = watchdog;
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
  }: {
    values?: Record<string, unknown>;
    flags?: Partial<Ctx['flags']>;
    positionals?: string[];
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
    sid: 'sid-wd',
    env: {},
    out: (s: string) => outBuf.push(s),
    err: (s: string) => errBuf.push(s),
    outBuf,
    errBuf,
  };
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

// ══ watchdog arm ═════════════════════════════════════════════════════════════════════════════════
test('watchdog arm writes the whole watchdog object (armed_at stamped, fields set)', () => {
  const boardPath = mkBoardHome();
  const ctx = mkCtx(boardPath, {
    values: {
      'fire-at': '2026-06-24T12:00:00Z',
      mechanism: 'cron',
      'job-id': 'cron-abc',
      checklist: '查后台 3 个 subagent 是否回',
    },
  });
  const code = wdHandler.arm(ctx);
  assert.equal(code, EXIT.OK);

  const onDisk = JSON.parse(readFileSync(boardPath, 'utf8'));
  const wd = onDisk.watchdog;
  assert.ok(wd && typeof wd === 'object', 'watchdog object written');
  assert.equal(wd.fire_at, '2026-06-24T12:00:00Z');
  assert.equal(wd.mechanism, 'cron');
  assert.equal(wd.job_id, 'cron-abc');
  assert.equal(wd.checklist, '查后台 3 个 subagent 是否回');
  assert.match(wd.armed_at, ISO_RE, 'armed_at is strict ISO UTC');
  assert.ok(ctx.outBuf.join('').includes('已武装'), 'human confirm rendered');
});

test('watchdog arm with only required flags (fire-at + mechanism)', () => {
  const boardPath = mkBoardHome();
  const ctx = mkCtx(boardPath, {
    values: { 'fire-at': '2026-06-24T18:00:00Z', mechanism: 'shell' },
  });
  const code = wdHandler.arm(ctx);
  assert.equal(code, EXIT.OK);
  const wd = JSON.parse(readFileSync(boardPath, 'utf8')).watchdog;
  assert.equal(wd.fire_at, '2026-06-24T18:00:00Z');
  assert.equal(wd.mechanism, 'shell');
  assert.equal(wd.job_id, undefined, 'no job_id when not given');
  assert.equal(wd.checklist, undefined, 'no checklist when not given');
});

test('watchdog arm --json renders the unified shell', () => {
  const boardPath = mkBoardHome();
  const ctx = mkCtx(boardPath, {
    values: { 'fire-at': '2026-06-24T12:00:00Z', mechanism: 'loop' },
    flags: { json: true },
  });
  const code = wdHandler.arm(ctx);
  assert.equal(code, EXIT.OK);
  const parsed = JSON.parse(ctx.outBuf.join(''));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.data.mechanism, 'loop');
  assert.equal(parsed.data.fire_at, '2026-06-24T12:00:00Z');
});

test('watchdog arm --dry-run does not write the board', () => {
  const boardPath = mkBoardHome();
  const before = readFileSync(boardPath, 'utf8');
  const ctx = mkCtx(boardPath, {
    values: { 'fire-at': '2026-06-24T12:00:00Z', mechanism: 'monitor' },
    flags: { dryRun: true },
  });
  const code = wdHandler.arm(ctx);
  assert.equal(code, EXIT.OK);
  assert.equal(readFileSync(boardPath, 'utf8'), before, 'board unchanged on dry-run');
  assert.ok(ctx.outBuf.join('').includes('[dry-run]'));
});

test('watchdog arm replaces an existing watchdog (whole-object write)', () => {
  const boardPath = mkBoardHome({
    watchdog: {
      armed_at: '2026-06-23T00:00:00Z',
      fire_at: '2026-06-23T01:00:00Z',
      mechanism: 'cron',
      job_id: 'old',
    },
  });
  const ctx = mkCtx(boardPath, {
    values: { 'fire-at': '2026-06-25T00:00:00Z', mechanism: 'loop' },
  });
  wdHandler.arm(ctx);
  const wd = JSON.parse(readFileSync(boardPath, 'utf8')).watchdog;
  assert.equal(wd.fire_at, '2026-06-25T00:00:00Z');
  assert.equal(wd.mechanism, 'loop');
  assert.equal(wd.job_id, undefined, 'stale job_id from old watchdog gone (whole-object replace)');
});

// ══ watchdog disarm ══════════════════════════════════════════════════════════════════════════════
test('watchdog disarm sets watchdog to null (no residue)', () => {
  const boardPath = mkBoardHome({
    watchdog: {
      armed_at: '2026-06-24T10:00:00Z',
      fire_at: '2026-06-24T12:00:00Z',
      mechanism: 'cron',
    },
  });
  const ctx = mkCtx(boardPath);
  const code = wdHandler.disarm(ctx);
  assert.equal(code, EXIT.OK);
  const onDisk = JSON.parse(readFileSync(boardPath, 'utf8'));
  assert.equal(onDisk.watchdog, null, 'watchdog removed (null)');
  assert.ok(ctx.outBuf.join('').includes('已退役'));
});

test('watchdog disarm is idempotent (no watchdog → still OK)', () => {
  const boardPath = mkBoardHome(); // no watchdog field
  const ctx = mkCtx(boardPath);
  const code = wdHandler.disarm(ctx);
  assert.equal(code, EXIT.OK);
  const onDisk = JSON.parse(readFileSync(boardPath, 'utf8'));
  assert.equal(onDisk.watchdog, null);
});

test('watchdog disarm hints external job-id cleanup when one existed', () => {
  const boardPath = mkBoardHome({
    watchdog: {
      armed_at: '2026-06-24T10:00:00Z',
      fire_at: '2026-06-24T12:00:00Z',
      mechanism: 'cron',
      job_id: 'cron-xyz',
    },
  });
  const ctx = mkCtx(boardPath);
  wdHandler.disarm(ctx);
  assert.ok(ctx.outBuf.join('').includes('cron-xyz'), 'prior job-id surfaced for cleanup');
});

// ══ watchdog status ══════════════════════════════════════════════════════════════════════════════
test('watchdog status reads an armed watchdog (human field list)', () => {
  const boardPath = mkBoardHome({
    watchdog: {
      armed_at: '2026-06-24T10:00:00Z',
      fire_at: '2026-06-24T12:00:00Z',
      mechanism: 'cron',
      job_id: 'cron-abc',
      checklist: '查后台',
    },
  });
  const ctx = mkCtx(boardPath);
  const code = wdHandler.status(ctx);
  assert.equal(code, EXIT.OK);
  const out = ctx.outBuf.join('\n');
  assert.ok(out.includes('已武装'));
  assert.ok(out.includes('2026-06-24T12:00:00Z'));
  assert.ok(out.includes('cron'));
  assert.ok(out.includes('cron-abc'));
  assert.ok(out.includes('查后台'));
});

test('watchdog status --json returns the watchdog object in the shell', () => {
  const boardPath = mkBoardHome({
    watchdog: {
      armed_at: '2026-06-24T10:00:00Z',
      fire_at: '2026-06-24T12:00:00Z',
      mechanism: 'cron',
    },
  });
  const ctx = mkCtx(boardPath, { flags: { json: true } });
  wdHandler.status(ctx);
  const parsed = JSON.parse(ctx.outBuf.join(''));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.data.mechanism, 'cron');
});

test('watchdog status with no watchdog → 未武装 (human) / null (json)', () => {
  const boardPath = mkBoardHome(); // no watchdog
  const ctx = mkCtx(boardPath);
  const code = wdHandler.status(ctx);
  assert.equal(code, EXIT.OK);
  assert.ok(ctx.outBuf.join('').includes('未武装'));

  const ctxJson = mkCtx(boardPath, { flags: { json: true } });
  wdHandler.status(ctxJson);
  const parsed = JSON.parse(ctxJson.outBuf.join(''));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.data, null);
});

// ══ error path ═══════════════════════════════════════════════════════════════════════════════════
// status 找不到 active board → discover throw .errKind='NotFound'（router 才 catch→NOT_FOUND·5）。
//   handler 不 catch（冒泡）——这里验 throw 的 .errKind 与 router 的映射一致。
test('watchdog status with no resolvable board throws NotFound (router → NOT_FOUND 5)', () => {
  const emptyRoot = mkTmp('ccm-hwd-empty-');
  const home = join(emptyRoot, '.claude', 'cc-master');
  mkdirSync(home, { recursive: true }); // home 存在但无任何 board
  // 不给 --board；走 discover：home 无 active 板 → NotFound。env 锚到这个空 home。
  const ctx = mkCtx(null, { values: { home }, flags: {} });
  ctx.sid = 'sid-none';
  let thrown: { errKind?: string } | null = null;
  try {
    wdHandler.status(ctx);
  } catch (e) {
    thrown = e as { errKind?: string };
  }
  assert.ok(thrown, 'status throws when no board resolves');
  assert.equal(thrown?.errKind, 'NotFound', 'errKind=NotFound maps to NOT_FOUND(5) at router');
});
