// handler-log.test.mjs — P5.2·reference handler（handlers/log.js）契约门。
//
// log.js 是最简 handler（作 6 个 noun handler 的范式）：add（runWrite + mutations.appendLog + render）、
//   list（runRead + 过滤 + render.renderLogList）。本测试用 mkdtemp 临时板 + 真 leaf，端到端验证：
//     · log add 真写一条到临时板（ts 盖戳·kind/task 落字段）。
//     · log add --json render 出最新 log 列表的 JSON。
//     · log list 读出全部 / 按 --kind / --task 过滤 / --json 形态。
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src');
const logHandler = require(join(SRC, 'handlers', 'log.js'));
const io = require(join(SRC, 'io.js'));
const EXIT = io.EXIT;

let TMPDIRS = [];
function mkTmp(prefix) {
  const d = mkdtempSync(join(tmpdir(), prefix));
  TMPDIRS.push(d);
  return d;
}
afterEach(() => {
  for (const d of TMPDIRS) rmSync(d, { recursive: true, force: true });
  TMPDIRS = [];
});

function mkBoardHome({ log = [] } = {}) {
  const root = mkTmp('ccm-hlog-');
  const home = join(root, '.claude', 'cc-master');
  mkdirSync(home, { recursive: true });
  const boardPath = join(home, '2026-06-24-log.board.json');
  const board = {
    schema: 'cc-master/v2',
    meta: { template_version: 3 },
    goal: 'log handler test',
    owner: { active: true, session_id: 'sid-log', heartbeat: '2026-06-24T10:00:00Z' },
    git: { worktree: '', branch: '' },
    scheduling: { wip_limit: 4 },
    tasks: [],
    log,
  };
  writeFileSync(boardPath, JSON.stringify(board, null, 2) + '\n', 'utf8');
  return boardPath;
}

function mkCtx(boardPath, { values = {}, flags = {}, positionals = [] } = {}) {
  const outBuf = [];
  const errBuf = [];
  return {
    values: { board: boardPath, ...values },
    positionals,
    flags: { json: false, dryRun: false, force: false, yes: false, quiet: false, verbose: false, color: false, ...flags },
    sid: 'sid-log',
    env: {},
    out: (s) => outBuf.push(s),
    err: (s) => errBuf.push(s),
    outBuf,
    errBuf,
  };
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

// ══ log add ══════════════════════════════════════════════════════════════════════════════════════
test('log add writes one entry to the board (ts stamped, kind/task set)', () => {
  const boardPath = mkBoardHome();
  const ctx = mkCtx(boardPath, {
    values: { kind: 'dispatch', task: 'T7' },
    positionals: ['派发 T7 给 subagent'],
  });
  const code = logHandler.add(ctx);
  assert.equal(code, EXIT.OK);

  const onDisk = JSON.parse(readFileSync(boardPath, 'utf8'));
  assert.equal(onDisk.log.length, 1);
  const e = onDisk.log[0];
  assert.equal(e.summary, '派发 T7 给 subagent');
  assert.equal(e.kind, 'dispatch');
  assert.equal(e.task, 'T7');
  assert.match(e.ts, ISO_RE, 'ts is strict ISO UTC');
  assert.ok(ctx.outBuf.join('').includes('派发 T7 给 subagent'));
});

test('log add with --detail and --ref (refs csv) lands optional fields', () => {
  const boardPath = mkBoardHome();
  const ctx = mkCtx(boardPath, {
    values: { kind: 'decision', detail: '理由: 方案 B 更省', ref: ['commit a1b2c3', '/abs/notes.md'] },
    positionals: ['改用方案 B'],
  });
  const code = logHandler.add(ctx);
  assert.equal(code, EXIT.OK);
  const e = JSON.parse(readFileSync(boardPath, 'utf8')).log[0];
  assert.equal(e.detail, '理由: 方案 B 更省');
  assert.deepEqual(e.refs, ['commit a1b2c3', '/abs/notes.md']);
});

test('log add --json renders the log list as JSON', () => {
  const boardPath = mkBoardHome();
  const ctx = mkCtx(boardPath, { values: { kind: 'note' }, flags: { json: true }, positionals: ['hi'] });
  const code = logHandler.add(ctx);
  assert.equal(code, EXIT.OK);
  const parsed = JSON.parse(ctx.outBuf.join(''));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.data.length, 1);
  assert.equal(parsed.data[0].summary, 'hi');
  assert.equal(parsed.data[0].kind, 'note');
});

test('log add --dry-run does not write the board', () => {
  const boardPath = mkBoardHome();
  const before = readFileSync(boardPath, 'utf8');
  const ctx = mkCtx(boardPath, { flags: { dryRun: true }, positionals: ['preview only'] });
  const code = logHandler.add(ctx);
  assert.equal(code, EXIT.OK);
  assert.equal(readFileSync(boardPath, 'utf8'), before, 'board unchanged on dry-run');
  assert.ok(ctx.outBuf.join('').includes('[dry-run]'));
});

test('log add appends (does not clobber existing entries)', () => {
  const boardPath = mkBoardHome({ log: [{ ts: '2026-06-24T09:00:00Z', summary: 'old', kind: 'note' }] });
  const ctx = mkCtx(boardPath, { positionals: ['new entry'] });
  logHandler.add(ctx);
  const onDisk = JSON.parse(readFileSync(boardPath, 'utf8'));
  assert.equal(onDisk.log.length, 2);
  assert.equal(onDisk.log[0].summary, 'old');
  assert.equal(onDisk.log[1].summary, 'new entry');
});

// ══ log list ═════════════════════════════════════════════════════════════════════════════════════
const SEED_LOG = [
  { ts: '2026-06-24T09:00:00Z', summary: 'dispatched T1', kind: 'dispatch', task: 'T1' },
  { ts: '2026-06-24T09:30:00Z', summary: 'verified T1', kind: 'verify', task: 'T1' },
  { ts: '2026-06-24T10:00:00Z', summary: 'chose plan B', kind: 'decision' },
];

test('log list reads all entries (human table)', () => {
  const boardPath = mkBoardHome({ log: SEED_LOG });
  const ctx = mkCtx(boardPath);
  const code = logHandler.list(ctx);
  assert.equal(code, EXIT.OK);
  const out = ctx.outBuf.join('\n');
  assert.ok(out.includes('dispatched T1'));
  assert.ok(out.includes('verified T1'));
  assert.ok(out.includes('chose plan B'));
});

test('log list --json returns the full array', () => {
  const boardPath = mkBoardHome({ log: SEED_LOG });
  const ctx = mkCtx(boardPath, { flags: { json: true } });
  logHandler.list(ctx);
  const parsed = JSON.parse(ctx.outBuf.join(''));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.data.length, 3);
});

test('log list --kind filters by kind', () => {
  const boardPath = mkBoardHome({ log: SEED_LOG });
  const ctx = mkCtx(boardPath, { values: { kind: 'decision' }, flags: { json: true } });
  logHandler.list(ctx);
  const parsed = JSON.parse(ctx.outBuf.join(''));
  assert.equal(parsed.data.length, 1);
  assert.equal(parsed.data[0].summary, 'chose plan B');
});

test('log list --task filters by task', () => {
  const boardPath = mkBoardHome({ log: SEED_LOG });
  const ctx = mkCtx(boardPath, { values: { task: 'T1' }, flags: { json: true } });
  logHandler.list(ctx);
  const parsed = JSON.parse(ctx.outBuf.join(''));
  assert.equal(parsed.data.length, 2);
});

test('log list on empty log → human placeholder', () => {
  const boardPath = mkBoardHome({ log: [] });
  const ctx = mkCtx(boardPath);
  const code = logHandler.list(ctx);
  assert.equal(code, EXIT.OK);
  assert.ok(ctx.outBuf.join('').includes('无 log 条目'));
});
