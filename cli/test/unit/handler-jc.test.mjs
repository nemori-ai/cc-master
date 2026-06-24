// handler-jc.test.mjs — P5.2·jc handler（handlers/jc.js）契约门。
//
// jc.js 是 judgment_calls 自决台账 handler（add/list/show/resolve），照 log.js 范式。本测试用 mkdtemp 临时板
//   + 真 leaf（mutations / render / registry / _common），端到端验证：
//     · add：自动分配 id（J1, J2…）+ 盖 raised_at + status 默认 pending_review；可选字段落字段；--set 逃生口；
//            --json / --dry-run 形态；append（不覆盖既有）。
//     · list：读全部 / 按 --status / --severity 过滤 / --json 形态 / 空台账提示。
//     · show：定位单条；--json；id 不存在 → NOT_FOUND。
//     · resolve：置 upheld/overturned + note + 盖 resolved_at；id 不存在 → NOT_FOUND。
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src');
const jcHandler = require(join(SRC, 'handlers', 'jc.js'));
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

function mkBoardHome({ judgment_calls } = {}) {
  const root = mkTmp('ccm-hjc-');
  const home = join(root, '.claude', 'cc-master');
  mkdirSync(home, { recursive: true });
  const boardPath = join(home, '2026-06-24-jc.board.json');
  const board = {
    schema: 'cc-master/v2',
    meta: { template_version: 3 },
    goal: 'jc handler test',
    owner: { active: true, session_id: 'sid-jc', heartbeat: '2026-06-24T10:00:00Z' },
    git: { worktree: '', branch: '' },
    scheduling: { wip_limit: 4 },
    tasks: [],
    log: [],
  };
  if (judgment_calls !== undefined) board.judgment_calls = judgment_calls;
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
    sid: 'sid-jc',
    env: {},
    out: (s) => outBuf.push(s),
    err: (s) => errBuf.push(s),
    outBuf,
    errBuf,
  };
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

// ══ jc add ═════════════════════════════════════════════════════════════════════════════════════════
test('jc add writes one entry (auto id J1, raised_at stamped, status default pending_review)', () => {
  const boardPath = mkBoardHome();
  const ctx = mkCtx(boardPath, {
    values: { category: 'architecture', severity: 'high', decision: '采用 ICU MessageFormat', rationale: '工业标准', impact: '触及全部翻译串', 'task-ref': 'T0' },
    positionals: ['选 ICU MessageFormat 而非自研插值层'],
  });
  const code = jcHandler.add(ctx);
  assert.equal(code, EXIT.OK);

  const onDisk = JSON.parse(readFileSync(boardPath, 'utf8'));
  assert.equal(onDisk.judgment_calls.length, 1);
  const j = onDisk.judgment_calls[0];
  assert.equal(j.id, 'J1');
  assert.equal(j.summary, '选 ICU MessageFormat 而非自研插值层');
  assert.equal(j.category, 'architecture');
  assert.equal(j.severity, 'high');
  assert.equal(j.decision, '采用 ICU MessageFormat');
  assert.equal(j.rationale, '工业标准');
  assert.equal(j.impact, '触及全部翻译串');
  assert.equal(j.task_ref, 'T0', '--task-ref maps to field task_ref');
  assert.equal(j.status, 'pending_review');
  assert.match(j.raised_at, ISO_RE, 'raised_at is strict ISO UTC');
  assert.ok(ctx.outBuf.join('').includes('J1'));
  assert.ok(ctx.outBuf.join('').includes('选 ICU MessageFormat'));
});

test('jc add with --refs (csv) lands refs array', () => {
  const boardPath = mkBoardHome();
  const ctx = mkCtx(boardPath, {
    values: { refs: ['commit a1b2c3', '/abs/notes.md'] },
    positionals: ['某自决'],
  });
  const code = jcHandler.add(ctx);
  assert.equal(code, EXIT.OK);
  const j = JSON.parse(readFileSync(boardPath, 'utf8')).judgment_calls[0];
  assert.deepEqual(j.refs, ['commit a1b2c3', '/abs/notes.md']);
});

test('jc add allocates next id sequentially (J1 exists → J2)', () => {
  const boardPath = mkBoardHome({ judgment_calls: [{ id: 'J1', summary: 'old', status: 'upheld', raised_at: '2026-06-24T09:00:00Z' }] });
  const ctx = mkCtx(boardPath, { positionals: ['新自决'] });
  jcHandler.add(ctx);
  const onDisk = JSON.parse(readFileSync(boardPath, 'utf8'));
  assert.equal(onDisk.judgment_calls.length, 2);
  assert.equal(onDisk.judgment_calls[0].id, 'J1', 'existing untouched');
  assert.equal(onDisk.judgment_calls[1].id, 'J2', 'new id is J2');
});

test('jc add --set escape hatch writes a ✎ flexible board-level field', () => {
  const boardPath = mkBoardHome();
  // --set 作用于 board 顶层 dotpath（非 🔒 path）：buildFields 收集成 sets → addJc 后逐条 applySet。
  //   用 board 顶层 flexible 标量（meta.extra）证明 --set 管线（buildFields → applySet）端到端贯通。
  const ctx = mkCtx(boardPath, {
    values: { set: ['meta.extra=hello'] },
    positionals: ['可逃生口自决'],
  });
  const code = jcHandler.add(ctx);
  assert.equal(code, EXIT.OK);
  const onDisk = JSON.parse(readFileSync(boardPath, 'utf8'));
  assert.equal(onDisk.judgment_calls[0].id, 'J1', 'jc still written');
  assert.equal(onDisk.meta.extra, 'hello', '--set wrote the board-level flexible field');
});

test('jc add --json renders the jc list as JSON', () => {
  const boardPath = mkBoardHome();
  const ctx = mkCtx(boardPath, { values: { severity: 'critical' }, flags: { json: true }, positionals: ['hi'] });
  const code = jcHandler.add(ctx);
  assert.equal(code, EXIT.OK);
  const parsed = JSON.parse(ctx.outBuf.join(''));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.data.length, 1);
  assert.equal(parsed.data[0].id, 'J1');
  assert.equal(parsed.data[0].severity, 'critical');
});

test('jc add --dry-run does not write the board', () => {
  const boardPath = mkBoardHome();
  const before = readFileSync(boardPath, 'utf8');
  const ctx = mkCtx(boardPath, { flags: { dryRun: true }, positionals: ['preview only'] });
  const code = jcHandler.add(ctx);
  assert.equal(code, EXIT.OK);
  assert.equal(readFileSync(boardPath, 'utf8'), before, 'board unchanged on dry-run');
  assert.ok(ctx.outBuf.join('').includes('[dry-run]'));
});

// ══ jc list ════════════════════════════════════════════════════════════════════════════════════════
const SEED_JC = [
  { id: 'J1', summary: 'chose A', status: 'pending_review', severity: 'high', category: 'architecture', raised_at: '2026-06-24T09:00:00Z' },
  { id: 'J2', summary: 'drift B', status: 'upheld', severity: 'critical', category: 'drift', raised_at: '2026-06-24T09:30:00Z' },
  { id: 'J3', summary: 'misalign C', status: 'pending_review', severity: 'low', category: 'other', raised_at: '2026-06-24T10:00:00Z' },
];

test('jc list reads all entries (human table)', () => {
  const boardPath = mkBoardHome({ judgment_calls: SEED_JC });
  const ctx = mkCtx(boardPath);
  const code = jcHandler.list(ctx);
  assert.equal(code, EXIT.OK);
  const out = ctx.outBuf.join('\n');
  assert.ok(out.includes('chose A'));
  assert.ok(out.includes('drift B'));
  assert.ok(out.includes('misalign C'));
});

test('jc list --json returns the full array', () => {
  const boardPath = mkBoardHome({ judgment_calls: SEED_JC });
  const ctx = mkCtx(boardPath, { flags: { json: true } });
  jcHandler.list(ctx);
  const parsed = JSON.parse(ctx.outBuf.join(''));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.data.length, 3);
});

test('jc list --status filters by status', () => {
  const boardPath = mkBoardHome({ judgment_calls: SEED_JC });
  const ctx = mkCtx(boardPath, { values: { status: 'pending_review' }, flags: { json: true } });
  jcHandler.list(ctx);
  const parsed = JSON.parse(ctx.outBuf.join(''));
  assert.equal(parsed.data.length, 2);
});

test('jc list --severity filters by severity', () => {
  const boardPath = mkBoardHome({ judgment_calls: SEED_JC });
  const ctx = mkCtx(boardPath, { values: { severity: 'critical' }, flags: { json: true } });
  jcHandler.list(ctx);
  const parsed = JSON.parse(ctx.outBuf.join(''));
  assert.equal(parsed.data.length, 1);
  assert.equal(parsed.data[0].id, 'J2');
});

test('jc list on empty/absent judgment_calls → human placeholder', () => {
  const boardPath = mkBoardHome();
  const ctx = mkCtx(boardPath);
  const code = jcHandler.list(ctx);
  assert.equal(code, EXIT.OK);
  assert.ok(ctx.outBuf.join('').includes('无自决台账条目'));
});

// ══ jc show ════════════════════════════════════════════════════════════════════════════════════════
test('jc show renders single entry detail (human)', () => {
  const boardPath = mkBoardHome({ judgment_calls: SEED_JC });
  const ctx = mkCtx(boardPath, { positionals: ['J2'] });
  const code = jcHandler.show(ctx);
  assert.equal(code, EXIT.OK);
  const out = ctx.outBuf.join('\n');
  assert.ok(out.includes('J2'));
  assert.ok(out.includes('drift B'));
  assert.ok(out.includes('critical'));
});

test('jc show --json returns the full object', () => {
  const boardPath = mkBoardHome({ judgment_calls: SEED_JC });
  const ctx = mkCtx(boardPath, { positionals: ['J1'], flags: { json: true } });
  jcHandler.show(ctx);
  const parsed = JSON.parse(ctx.outBuf.join(''));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.data.id, 'J1');
  assert.equal(parsed.data.summary, 'chose A');
});

test('jc show on non-existent id → NOT_FOUND', () => {
  const boardPath = mkBoardHome({ judgment_calls: SEED_JC });
  const ctx = mkCtx(boardPath, { positionals: ['J99'] });
  let caught = null;
  try {
    jcHandler.show(ctx);
  } catch (e) {
    caught = e;
  }
  assert.ok(caught, 'show throws on missing id (bubbles to router)');
  assert.equal(caught.errKind, 'NotFound', "errKind 'NotFound' → router maps to NOT_FOUND(5)");
});

// ══ jc resolve ═════════════════════════════════════════════════════════════════════════════════════
test('jc resolve sets status upheld + note + resolved_at', () => {
  const boardPath = mkBoardHome({ judgment_calls: SEED_JC });
  const ctx = mkCtx(boardPath, { values: { status: 'upheld', note: '事后看是对的' }, positionals: ['J1'] });
  const code = jcHandler.resolve(ctx);
  assert.equal(code, EXIT.OK);
  const onDisk = JSON.parse(readFileSync(boardPath, 'utf8'));
  const j = onDisk.judgment_calls.find((x) => x.id === 'J1');
  assert.equal(j.status, 'upheld');
  assert.equal(j.note, '事后看是对的');
  assert.match(j.resolved_at, ISO_RE, 'resolved_at is strict ISO UTC');
  assert.ok(ctx.outBuf.join('').includes('J1'));
  assert.ok(ctx.outBuf.join('').includes('upheld'));
});

test('jc resolve overturned (no note) works', () => {
  const boardPath = mkBoardHome({ judgment_calls: SEED_JC });
  const ctx = mkCtx(boardPath, { values: { status: 'overturned' }, positionals: ['J3'] });
  const code = jcHandler.resolve(ctx);
  assert.equal(code, EXIT.OK);
  const j = JSON.parse(readFileSync(boardPath, 'utf8')).judgment_calls.find((x) => x.id === 'J3');
  assert.equal(j.status, 'overturned');
});

test('jc resolve on non-existent id → NOT_FOUND', () => {
  const boardPath = mkBoardHome({ judgment_calls: SEED_JC });
  const ctx = mkCtx(boardPath, { values: { status: 'upheld' }, positionals: ['J99'] });
  let caught = null;
  try {
    jcHandler.resolve(ctx);
  } catch (e) {
    caught = e;
  }
  assert.ok(caught, 'resolve throws on missing id (bubbles to router)');
  assert.equal(caught.errKind, 'NotFound', "errKind 'NotFound' → router maps to NOT_FOUND(5)");
});
