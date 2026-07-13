// handler-task.test.ts — P5.2·task noun handler（handlers/task.ts）契约门。
//
// task.ts 照 log.ts 范式：写 verb（add/update/start/done/block/set-status/rm）走 runWrite + mutations.*；
//   读 verb（show/list）走 runRead + render。本测试用 mkdtemp 临时 home + 真 leaf + 临时板，端到端验证每 verb
//   happy path（写 verb 验板被改 + exit OK + render 出；读 verb 验输出）+ 关键错误：
//     · rm 非 TTY 缺 --yes → USAGE。
//     · update / set-status / done 对不存在 id → NotFound(5)。
//     · set-status 非法转移 → VALIDATION(3)（IllegalTransition），--force 越。
//     · 删后留悬挂依赖 → VALIDATION(3)（lint hard 挡）。
//
// T2b port 注：原 .mjs 经 createRequire 加载 CJS，改成 ESM import ported .ts 源。断言逻辑逐字保持。
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import type { Ctx } from '../src/handlers/_common.js';
import * as taskHandler from '../src/handlers/task.js';
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

// mkBoardHome({tasks}) → 临时 home 下写一块 active board，返回 boardPath。
function mkBoardHome({
  tasks = [] as unknown[],
  log = [] as unknown[],
  judgment_calls,
}: {
  tasks?: unknown[];
  log?: unknown[];
  judgment_calls?: unknown[];
} = {}): string {
  const root = mkTmp('ccm-htask-');
  const home = join(root, '.claude', 'cc-master');
  mkdirSync(home, { recursive: true });
  const boardPath = join(home, '2026-06-24-task.board.json');
  const board: Record<string, unknown> = {
    schema: 'cc-master/v2',
    meta: { template_version: 3 },
    goal: 'task handler test',
    owner: { active: true, session_id: 'sid-task', heartbeat: '2026-06-24T10:00:00Z' },
    git: { worktree: '', branch: '' },
    scheduling: { wip_limit: 4 },
    tasks,
    log,
  };
  if (judgment_calls) board.judgment_calls = judgment_calls;
  writeFileSync(boardPath, `${JSON.stringify(board, null, 2)}\n`, 'utf8');
  return boardPath;
}

type TestCtx = Ctx & { outBuf: string[]; errBuf: string[] };
// mkCtx(boardPath, {values, flags, positionals, isTTY}) → ctx（out/err 捕获器）。
function mkCtx(
  boardPath: string,
  {
    values = {},
    flags = {},
    positionals = [],
    isTTY,
  }: {
    values?: Record<string, unknown>;
    flags?: Partial<Ctx['flags']>;
    positionals?: string[];
    isTTY?: boolean;
  } = {},
): TestCtx {
  const outBuf: string[] = [];
  const errBuf: string[] = [];
  const ctx: TestCtx = {
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
    sid: 'sid-task',
    env: {},
    out: (s: string) => outBuf.push(s),
    err: (s: string) => errBuf.push(s),
    outBuf,
    errBuf,
  };
  // 默认注入 isTTY:false（测试是非交互环境；rm 守门据此要求 --yes）。
  ctx.isTTY = isTTY === undefined ? false : isTTY;
  return ctx;
}

// 测试侧读盘对象是 agent-shaped JSON·用 any 务实读字段（biome noExplicitAny 已 off·不影响被测源类型）。
function readBoard(boardPath: string): any {
  return JSON.parse(readFileSync(boardPath, 'utf8'));
}
function findTask(board: any, id: string): any {
  return (board.tasks || []).find((t: { id?: string }) => t?.id === id);
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

// ══ task add ══════════════════════════════════════════════════════════════════════════════════════
test('task add creates a node (status=ready default, deps, created_at stamped)', () => {
  // seed T1 (done) so the new T7 --deps T1 is a valid edge (no dangling-dep hard error).
  const boardPath = mkBoardHome({
    tasks: [
      {
        id: 'T1',
        status: 'done',
        deps: [],
        verified: true,
        artifact: '/abs/t1.md',
        created_at: '2026-06-24T08:00:00Z',
      },
    ],
  });
  const ctx = mkCtx(boardPath, {
    values: {
      type: 'development',
      deps: 'T1',
      title: '实现 estimate 接缝',
      ref: ['spec:/abs/spec.md', 'plan:/abs/plan.md'],
    },
    positionals: ['T7'],
  });
  const code = taskHandler.add(ctx);
  assert.equal(code, EXIT.OK);
  const t = findTask(readBoard(boardPath), 'T7');
  assert.ok(t, 'task T7 written');
  assert.equal(t.status, 'ready');
  assert.deepEqual(t.deps, ['T1']);
  assert.equal(t.type, 'development');
  assert.equal(t.title, '实现 estimate 接缝');
  assert.match(t.created_at, ISO_RE);
  assert.ok(ctx.outBuf.join('').includes('T7'));
});

test('task add with --estimate (duration transform) lands {value,unit}', () => {
  const boardPath = mkBoardHome();
  const ctx = mkCtx(boardPath, { values: { estimate: '3h' }, positionals: ['T8'] });
  const code = taskHandler.add(ctx);
  assert.equal(code, EXIT.OK);
  const t = findTask(readBoard(boardPath), 'T8');
  assert.deepEqual(t.estimate, { value: 3, unit: 'h' });
});

test('task add --ref (ref transform) lands references[]', () => {
  const boardPath = mkBoardHome();
  const ctx = mkCtx(boardPath, {
    values: { executor: 'external', ref: ['issue:https://github.com/o/r/issues/9'] },
    positionals: ['EXT3'],
  });
  const code = taskHandler.add(ctx);
  assert.equal(code, EXIT.OK);
  const t = findTask(readBoard(boardPath), 'EXT3');
  assert.equal(t.executor, 'external');
  assert.deepEqual(t.references, [{ kind: 'issue', ref: 'https://github.com/o/r/issues/9' }]);
});

test('task add --json renders the new task detail', () => {
  const boardPath = mkBoardHome();
  const ctx = mkCtx(boardPath, { flags: { json: true }, positionals: ['T9'] });
  const code = taskHandler.add(ctx);
  assert.equal(code, EXIT.OK);
  const parsed = JSON.parse(ctx.outBuf.join(''));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.data.id, 'T9');
});

test('task add --dry-run does not write', () => {
  const boardPath = mkBoardHome();
  const before = readFileSync(boardPath, 'utf8');
  const ctx = mkCtx(boardPath, { flags: { dryRun: true }, positionals: ['TX'] });
  const code = taskHandler.add(ctx);
  assert.equal(code, EXIT.OK);
  assert.equal(readFileSync(boardPath, 'utf8'), before, 'unchanged on dry-run');
  assert.ok(ctx.outBuf.join('').includes('[dry-run]'));
});

test('task add with --log also appends a log entry', () => {
  const boardPath = mkBoardHome();
  const ctx = mkCtx(boardPath, { values: { log: '建了 T7' }, positionals: ['T7'] });
  taskHandler.add(ctx);
  const board = readBoard(boardPath);
  assert.ok(findTask(board, 'T7'));
  assert.equal(board.log.length, 1);
  assert.equal(board.log[0].summary, '建了 T7');
});

test('task add --review-gate APPROVE declares an explicit review dependency gate', () => {
  const boardPath = mkBoardHome();
  const ctx = mkCtx(boardPath, {
    values: { 'review-gate': 'APPROVE' },
    positionals: ['R1'],
  });
  assert.equal(taskHandler.add(ctx), EXIT.OK);
  assert.deepEqual(findTask(readBoard(boardPath), 'R1').dependency_gate, {
    kind: 'review',
    required_verdict: 'APPROVE',
  });
});

// ══ task update ════════════════════════════════════════════════════════════════════════════════════
//   type='development' 需要 spec/plan 引用锚点才 lint-clean（BIZ-DEV-REFS 已 C1 hard 化）——两个 seed
//   task 都带一对 spec/plan references，保持既有 happy-path 测试（不涉及本次诊断/hard 化本身）不变。
const SEED_TASKS = [
  {
    id: 'T1',
    status: 'done',
    deps: [],
    verified: true,
    artifact: '/abs/t1.md',
    type: 'development',
    references: [
      { kind: 'spec', ref: '/abs/t1-spec.md' },
      { kind: 'plan', ref: '/abs/t1-plan.md' },
    ],
    created_at: '2026-06-24T08:00:00Z',
  },
  {
    id: 'T2',
    status: 'ready',
    deps: ['T1'],
    type: 'development',
    references: [
      { kind: 'spec', ref: '/abs/t2-spec.md' },
      { kind: 'plan', ref: '/abs/t2-plan.md' },
    ],
    created_at: '2026-06-24T08:30:00Z',
  },
];

test('task update overwrites fields + add/rm deps', () => {
  const boardPath = mkBoardHome({ tasks: structuredClone(SEED_TASKS) });
  const ctx = mkCtx(boardPath, {
    values: { estimate: '5h', 'add-dep': ['T1'] },
    positionals: ['T2'],
  });
  // T2 already deps on T1 — add-dep is idempotent; also rm a non-present to confirm no-op safety.
  const code = taskHandler.update(ctx);
  assert.equal(code, EXIT.OK);
  const t = findTask(readBoard(boardPath), 'T2');
  assert.deepEqual(t.estimate, { value: 5, unit: 'h' });
  assert.deepEqual(t.deps, ['T1']);
});

test('task update --rm-dep removes a dep', () => {
  const boardPath = mkBoardHome({ tasks: structuredClone(SEED_TASKS) });
  const ctx = mkCtx(boardPath, { values: { 'rm-dep': ['T1'] }, positionals: ['T2'] });
  const code = taskHandler.update(ctx);
  assert.equal(code, EXIT.OK);
  assert.deepEqual(findTask(readBoard(boardPath), 'T2').deps, []);
});

test('task update on a missing id throws → NotFound(5)', () => {
  const boardPath = mkBoardHome({ tasks: structuredClone(SEED_TASKS) });
  const ctx = mkCtx(boardPath, { values: { title: 'x' }, positionals: ['NOPE'] });
  assert.throws(
    () => taskHandler.update(ctx),
    (e: { errKind?: string }) => e.errKind === 'NotFound',
  );
});

// ── issue #57 问题2：--artifact-only on an already-done-but-unverified task → early Usage diagnostic ──
test('task update --artifact only on a done+unverified task → early Usage(2) diagnostic, board unchanged', () => {
  const tasks = structuredClone(SEED_TASKS);
  const doneTask = tasks.find((t: any) => t.id === 'T1');
  if (!doneTask) throw new Error('T1 not found in SEED_TASKS');
  doneTask.status = 'done';
  doneTask.verified = false;
  doneTask.artifact = '';
  const boardPath = mkBoardHome({ tasks });
  const before = readFileSync(boardPath, 'utf8');
  const ctx = mkCtx(boardPath, { values: { artifact: '/abs/out.md' }, positionals: ['T1'] });
  assert.throws(
    () => taskHandler.update(ctx),
    (e: { errKind?: string; message?: string }) =>
      e.errKind === 'Usage' && /--verified/.test(e.message || ''),
  );
  // Board must be untouched (thrown before mutate ran / lock released without a write).
  assert.equal(readFileSync(boardPath, 'utf8'), before);
});

test('task update --artifact + --verified together on a done+unverified task succeeds (diagnostic does not fire)', () => {
  const tasks = structuredClone(SEED_TASKS);
  const doneTask = tasks.find((t: any) => t.id === 'T1');
  if (!doneTask) throw new Error('T1 not found in SEED_TASKS');
  doneTask.status = 'done';
  doneTask.verified = false;
  doneTask.artifact = '';
  const boardPath = mkBoardHome({ tasks });
  const ctx = mkCtx(boardPath, {
    values: { artifact: '/abs/out.md', verified: true },
    positionals: ['T1'],
  });
  const code = taskHandler.update(ctx);
  assert.equal(code, EXIT.OK);
  const t = findTask(readBoard(boardPath), 'T1');
  assert.equal(t.verified, true);
  assert.equal(t.artifact, '/abs/out.md');
});

// ── Finding #83：task verb 的 --set/--set-json 裸 dotpath scope 到该 task + 落点回显 ──────────────────
test('task update --set bare dotpath lands on THAT task (not board top-level) + echoes logical path', () => {
  const boardPath = mkBoardHome({ tasks: structuredClone(SEED_TASKS) });
  const ctx = mkCtx(boardPath, { values: { set: ['hitl_rounds=2'] }, positionals: ['T2'] });
  const code = taskHandler.update(ctx);
  assert.equal(code, EXIT.OK);
  const board = readBoard(boardPath);
  assert.equal(findTask(board, 'T2').hitl_rounds, '2', '值落在 T2 上');
  assert.equal(board.hitl_rounds, undefined, 'board 顶层不被污染');
  assert.ok(
    ctx.outBuf.join('').includes('set tasks[T2].hitl_rounds'),
    `render 回显实际写入的逻辑 path，got: ${ctx.outBuf.join('')}`,
  );
});

test('task update --set-json bare decision_package lands on the task (Finding #83 repro)', () => {
  const boardPath = mkBoardHome({ tasks: structuredClone(SEED_TASKS) });
  const ctx = mkCtx(boardPath, {
    values: { 'set-json': ['decision_package={"question":"merge?"}'] },
    positionals: ['T2'],
  });
  const code = taskHandler.update(ctx);
  assert.equal(code, EXIT.OK);
  const board = readBoard(boardPath);
  assert.deepEqual(findTask(board, 'T2').decision_package, { question: 'merge?' });
  assert.equal(board.decision_package, undefined, 'board 根不再被静默污染');
  assert.ok(ctx.outBuf.join('').includes('set tasks[T2].decision_package'), '回显逻辑落点');
});

test('task update --set with explicit tasks[<其它id>].field prefix still targets that task (逃生口)', () => {
  const boardPath = mkBoardHome({ tasks: structuredClone(SEED_TASKS) });
  const ctx = mkCtx(boardPath, {
    values: { set: ['tasks[T1].hitl_rounds=9'] },
    positionals: ['T2'],
  });
  const code = taskHandler.update(ctx);
  assert.equal(code, EXIT.OK);
  const board = readBoard(boardPath);
  assert.equal(findTask(board, 'T1').hitl_rounds, '9', '显式前缀写 T1');
  assert.equal(findTask(board, 'T2').hitl_rounds, undefined, 'T2 不受影响');
  assert.ok(ctx.outBuf.join('').includes('set tasks[T1].hitl_rounds'), '回显显式目标');
});

test('task update --set status=done is now REFUSED by 🔒 gate (no more silent board-top junk)', () => {
  const boardPath = mkBoardHome({ tasks: structuredClone(SEED_TASKS) });
  const before = readFileSync(boardPath, 'utf8');
  const ctx = mkCtx(boardPath, { values: { set: ['status=done'] }, positionals: ['T2'] });
  assert.throws(
    () => taskHandler.update(ctx),
    (e: { errKind?: string }) => e.errKind === 'Validation',
    '裸 status 在 task 语境命中 LB_TASK 守门（曾静默写 board 顶层 junk + exit 0）',
  );
  assert.equal(readFileSync(boardPath, 'utf8'), before, 'board 未被改');
});

test('task add --set bare dotpath lands on the NEW task', () => {
  const boardPath = mkBoardHome({ tasks: structuredClone(SEED_TASKS) });
  const ctx = mkCtx(boardPath, {
    values: { title: '新任务', set: ['hitl_rounds=1'] },
    positionals: ['T9'],
  });
  const code = taskHandler.add(ctx);
  assert.equal(code, EXIT.OK);
  const board = readBoard(boardPath);
  assert.equal(findTask(board, 'T9').hitl_rounds, '1');
  assert.equal(board.hitl_rounds, undefined);
  assert.ok(ctx.outBuf.join('').includes('set tasks[T9].hitl_rounds'), '回显逻辑落点');
});

// ══ task start / done ════════════════════════════════════════════════════════════════════════════
test('task start transitions ready→in_flight and stamps started_at', () => {
  const boardPath = mkBoardHome({ tasks: structuredClone(SEED_TASKS) });
  const ctx = mkCtx(boardPath, { positionals: ['T2'] });
  const code = taskHandler.start(ctx);
  assert.equal(code, EXIT.OK);
  const t = findTask(readBoard(boardPath), 'T2');
  assert.equal(t.status, 'in_flight');
  assert.match(t.started_at, ISO_RE);
});

test('task done transitions in_flight→done, stamps finished_at, lands artifact/verified', () => {
  const tasks = [
    {
      id: 'T2',
      status: 'in_flight',
      deps: [],
      created_at: '2026-06-24T08:30:00Z',
      started_at: '2026-06-24T09:00:00Z',
    },
  ];
  const boardPath = mkBoardHome({ tasks });
  const ctx = mkCtx(boardPath, {
    values: { artifact: '/abs/out.md', verified: true },
    positionals: ['T2'],
  });
  const code = taskHandler.done(ctx);
  assert.equal(code, EXIT.OK);
  const t = findTask(readBoard(boardPath), 'T2');
  assert.equal(t.status, 'done');
  assert.match(t.finished_at, ISO_RE);
  assert.equal(t.artifact, '/abs/out.md');
  assert.equal(t.verified, true);
});

// ── 批量语义（issue #57 问题3 方案3·design_docs/plans/2026-07-07-ccm-batch-verb-spec.md）───────────────
test('task done <id1> <id2> → 一次 mutate+lint+write，两个 id 都落 done + 共享 artifact/verified', () => {
  const tasks = [
    { id: 'B1', status: 'in_flight', deps: [], created_at: '2026-06-24T08:00:00Z' },
    { id: 'B2', status: 'in_flight', deps: [], created_at: '2026-06-24T08:00:00Z' },
  ];
  const boardPath = mkBoardHome({ tasks });
  const ctx = mkCtx(boardPath, {
    values: { artifact: '/abs/shared.md', verified: true },
    positionals: ['B1', 'B2'],
  });
  const code = taskHandler.done(ctx);
  assert.equal(code, EXIT.OK);
  const board = readBoard(boardPath);
  for (const id of ['B1', 'B2']) {
    const t = findTask(board, id);
    assert.equal(t.status, 'done');
    assert.equal(t.artifact, '/abs/shared.md');
    assert.equal(t.verified, true);
  }
});

test('task done batch: one id illegal transition (still ready), no --force → throws, nothing persists (all-or-nothing)', () => {
  const tasks = [
    { id: 'B1', status: 'in_flight', deps: [], created_at: '2026-06-24T08:00:00Z' },
    { id: 'B2', status: 'ready', deps: [], created_at: '2026-06-24T08:00:00Z' }, // never started
  ];
  const boardPath = mkBoardHome({ tasks });
  const before = readFileSync(boardPath, 'utf8');
  const ctx = mkCtx(boardPath, {
    values: { artifact: '/abs/shared.md', verified: true },
    positionals: ['B1', 'B2'],
  });
  assert.throws(
    () => taskHandler.done(ctx),
    (e: { errKind?: string }) => e.errKind === 'IllegalTransition',
  );
  assert.equal(
    readFileSync(boardPath, 'utf8'),
    before,
    'B1 (which would have been legal on its own) must NOT persist either — all-or-nothing',
  );
});

test('task done batch: one id illegal transition + --force → whole batch forced through and persists', () => {
  const tasks = [
    { id: 'B1', status: 'in_flight', deps: [], created_at: '2026-06-24T08:00:00Z' },
    { id: 'B2', status: 'ready', deps: [], created_at: '2026-06-24T08:00:00Z' },
  ];
  const boardPath = mkBoardHome({ tasks });
  const ctx = mkCtx(boardPath, {
    values: { artifact: '/abs/shared.md', verified: true },
    positionals: ['B1', 'B2'],
    flags: { force: true },
  });
  const code = taskHandler.done(ctx);
  assert.equal(code, EXIT.OK);
  const board = readBoard(boardPath);
  for (const id of ['B1', 'B2']) {
    const t = findTask(board, id);
    assert.equal(t.status, 'done');
  }
});

test('task done --json: data is an array (length = id count, incl. single-id calls)', () => {
  const tasks = [
    { id: 'B1', status: 'in_flight', deps: [], created_at: '2026-06-24T08:00:00Z' },
    { id: 'B2', status: 'in_flight', deps: [], created_at: '2026-06-24T08:00:00Z' },
  ];
  const boardPath = mkBoardHome({ tasks });
  const batchCtx = mkCtx(boardPath, {
    values: { artifact: '/abs/x.md', verified: true },
    positionals: ['B1', 'B2'],
    flags: { json: true },
  });
  taskHandler.done(batchCtx);
  const batchParsed = JSON.parse(batchCtx.outBuf.join(''));
  assert.ok(Array.isArray(batchParsed.data), 'batch --json data is an array');
  assert.equal(batchParsed.data.length, 2);
  assert.deepEqual(batchParsed.data.map((t: { id: string }) => t.id).sort(), ['B1', 'B2']);

  // Single-id call: shape is still an array of length 1 (documented shape change — see mini-spec).
  const tasks2 = [{ id: 'S1', status: 'in_flight', deps: [], created_at: '2026-06-24T08:00:00Z' }];
  const boardPath2 = mkBoardHome({ tasks: tasks2 });
  const singleCtx = mkCtx(boardPath2, {
    values: { artifact: '/abs/x.md', verified: true },
    positionals: ['S1'],
    flags: { json: true },
  });
  taskHandler.done(singleCtx);
  const singleParsed = JSON.parse(singleCtx.outBuf.join(''));
  assert.ok(Array.isArray(singleParsed.data), 'single-id --json data is still an array');
  assert.equal(singleParsed.data.length, 1);
  assert.equal(singleParsed.data[0].id, 'S1');
});

test('task start <id1> <id2> → batch ready→in_flight', () => {
  const tasks = [
    { id: 'B1', status: 'ready', deps: [], created_at: '2026-06-24T08:00:00Z' },
    { id: 'B2', status: 'ready', deps: [], created_at: '2026-06-24T08:00:00Z' },
  ];
  const boardPath = mkBoardHome({ tasks });
  const ctx = mkCtx(boardPath, { positionals: ['B1', 'B2'] });
  const code = taskHandler.start(ctx);
  assert.equal(code, EXIT.OK);
  const board = readBoard(boardPath);
  for (const id of ['B1', 'B2']) {
    const t = findTask(board, id);
    assert.equal(t.status, 'in_flight');
    assert.match(t.started_at, ISO_RE);
  }
});

test('task done without verified/artifact is rejected by write validation and does not persist', () => {
  const tasks = [
    {
      id: 'T2',
      status: 'in_flight',
      deps: [],
      created_at: '2026-06-24T08:30:00Z',
      started_at: '2026-06-24T09:00:00Z',
    },
  ];
  const boardPath = mkBoardHome({ tasks });
  const before = readFileSync(boardPath, 'utf8');
  const ctx = mkCtx(boardPath, { positionals: ['T2'] });
  const code = taskHandler.done(ctx);
  assert.equal(code, EXIT.VALIDATION);
  assert.equal(readFileSync(boardPath, 'utf8'), before, 'board unchanged on validation failure');
  assert.match(ctx.errBuf.join('\n'), /BIZ-DONE-VERIFIED/);
});

test('task done with only verified or only artifact is rejected by write validation', () => {
  for (const values of [{ verified: true }, { artifact: '/abs/out.md' }]) {
    const tasks = [
      {
        id: 'T2',
        status: 'in_flight',
        deps: [],
        created_at: '2026-06-24T08:30:00Z',
        started_at: '2026-06-24T09:00:00Z',
      },
    ];
    const boardPath = mkBoardHome({ tasks });
    const before = readFileSync(boardPath, 'utf8');
    const ctx = mkCtx(boardPath, { values, positionals: ['T2'] });
    const code = taskHandler.done(ctx);
    assert.equal(code, EXIT.VALIDATION);
    assert.equal(readFileSync(boardPath, 'utf8'), before, 'board unchanged on validation failure');
    assert.match(ctx.errBuf.join('\n'), /BIZ-DONE-VERIFIED/);
  }
});

test('task start on a missing id → NotFound(5)', () => {
  const boardPath = mkBoardHome({ tasks: structuredClone(SEED_TASKS) });
  const ctx = mkCtx(boardPath, { positionals: ['NOPE'] });
  assert.throws(
    () => taskHandler.start(ctx),
    (e: { errKind?: string }) => e.errKind === 'NotFound',
  );
});

// ══ task block ════════════════════════════════════════════════════════════════════════════════════
test('task block --on <task> sets blocked + blocked_on', () => {
  const boardPath = mkBoardHome({ tasks: structuredClone(SEED_TASKS) });
  const ctx = mkCtx(boardPath, { values: { on: 'T1' }, positionals: ['T2'] });
  const code = taskHandler.block(ctx);
  assert.equal(code, EXIT.OK);
  const t = findTask(readBoard(boardPath), 'T2');
  assert.equal(t.status, 'blocked');
  assert.equal(t.blocked_on, 'T1');
});

test('task block --on user with --decision (literal JSON) lands decision_package', () => {
  const boardPath = mkBoardHome({ tasks: structuredClone(SEED_TASKS) });
  const dp = JSON.stringify({ ask_type: 'decision', question: '选哪个方案?' });
  const ctx = mkCtx(boardPath, { values: { on: 'user', decision: dp }, positionals: ['T2'] });
  const code = taskHandler.block(ctx);
  assert.equal(code, EXIT.OK);
  const t = findTask(readBoard(boardPath), 'T2');
  assert.equal(t.status, 'blocked');
  assert.equal(t.blocked_on, 'user');
  assert.equal(t.decision_package.question, '选哪个方案?');
});

// ══ task unblock ══════════════════════════════════════════════════════════════════════════════════
test('task unblock clears blocked_on; reconcileGating → ready when deps all done', () => {
  // T1 done, T2 blocked_on=user (deps [T1] done). unblock → reconcile flips to ready.
  const tasks = [
    {
      id: 'T1',
      status: 'done',
      deps: [],
      verified: true,
      artifact: '/abs/t1.md',
      created_at: '2026-06-24T08:00:00Z',
    },
    {
      id: 'T2',
      status: 'blocked',
      deps: ['T1'],
      blocked_on: 'user',
      decision_package: { ask_type: 'advice', question: 'x' },
      created_at: '2026-06-24T08:30:00Z',
    },
  ];
  const boardPath = mkBoardHome({ tasks });
  const ctx = mkCtx(boardPath, { positionals: ['T2'] });
  const code = taskHandler.unblock(ctx);
  assert.equal(code, EXIT.OK);
  const t = findTask(readBoard(boardPath), 'T2');
  assert.equal(t.blocked_on, undefined, 'blocked_on cleared');
  assert.equal(t.decision_package, undefined, 'decision_package cleared');
  assert.equal(t.status, 'ready', 'deps all done → reconcile to ready');
});

test('task unblock → reconcileGating → blocked when deps NOT all done', () => {
  const tasks = [
    { id: 'T1', status: 'in_flight', deps: [], created_at: '2026-06-24T08:00:00Z' },
    {
      id: 'T2',
      status: 'blocked',
      deps: ['T1'],
      blocked_on: 'T1',
      created_at: '2026-06-24T08:30:00Z',
    },
  ];
  const boardPath = mkBoardHome({ tasks });
  const ctx = mkCtx(boardPath, { positionals: ['T2'] });
  const code = taskHandler.unblock(ctx);
  assert.equal(code, EXIT.OK);
  const t = findTask(readBoard(boardPath), 'T2');
  assert.equal(t.blocked_on, undefined);
  assert.equal(t.status, 'blocked', 'deps not done → reconcile keeps blocked');
});

test('task unblock on missing id → NotFound (router maps exit 5)', () => {
  const boardPath = mkBoardHome({ tasks: structuredClone(SEED_TASKS) });
  const ctx = mkCtx(boardPath, { positionals: ['NOPE'] });
  assert.throws(() => taskHandler.unblock(ctx), /not found/i);
});

// ══ reconcileGating 接入 runWrite（所有写 verb 自动门控归一·ADR-023）═══════════════════════════════════
test('task add with unmet deps → reconcile auto-blocks the new node', () => {
  // T1 in_flight (not done); add T2 --deps T1 (addTask defaults status=ready) → reconcile → blocked.
  const boardPath = mkBoardHome({
    tasks: [{ id: 'T1', status: 'in_flight', deps: [], created_at: '2026-06-24T08:00:00Z' }],
  });
  const ctx = mkCtx(boardPath, { values: { deps: 'T1' }, positionals: ['T2'] });
  const code = taskHandler.add(ctx);
  assert.equal(code, EXIT.OK);
  assert.equal(findTask(readBoard(boardPath), 'T2').status, 'blocked');
});

test('completing deps via task done → reconcile auto-readies the dependent', () => {
  // T1 in_flight, T2 blocked (deps [T1]). Mark T1 done → reconcile flips T2 → ready.
  const tasks = [
    {
      id: 'T1',
      status: 'in_flight',
      deps: [],
      created_at: '2026-06-24T08:00:00Z',
      started_at: '2026-06-24T08:10:00Z',
    },
    { id: 'T2', status: 'blocked', deps: ['T1'], created_at: '2026-06-24T08:30:00Z' },
  ];
  const boardPath = mkBoardHome({ tasks });
  const ctx = mkCtx(boardPath, {
    values: { verified: true, artifact: '/abs/t1.md' },
    positionals: ['T1'],
  });
  const code = taskHandler.done(ctx);
  assert.equal(code, EXIT.OK);
  const b = readBoard(boardPath);
  assert.equal(findTask(b, 'T1').status, 'done');
  assert.equal(findTask(b, 'T2').status, 'ready', 'dependent auto-readied by reconcile');
});

test('task done records REQUEST-CHANGES but keeps review-gated downstream blocked', () => {
  const tasks = [
    {
      id: 'R1',
      status: 'in_flight',
      deps: [],
      dependency_gate: { kind: 'review', required_verdict: 'APPROVE' },
      created_at: '2026-06-24T08:00:00Z',
      started_at: '2026-06-24T08:10:00Z',
    },
    { id: 'I1', status: 'blocked', deps: ['R1'], created_at: '2026-06-24T08:30:00Z' },
  ];
  const boardPath = mkBoardHome({ tasks });
  const ctx = mkCtx(boardPath, {
    values: {
      verified: true,
      artifact: '/abs/review.md',
      'review-verdict': 'REQUEST-CHANGES',
    },
    positionals: ['R1'],
  });
  assert.equal(taskHandler.done(ctx), EXIT.OK);
  const b = readBoard(boardPath);
  assert.equal(findTask(b, 'R1').status, 'done', 'review execution completed');
  assert.equal(findTask(b, 'R1').review_verdict, 'REQUEST-CHANGES');
  assert.equal(findTask(b, 'I1').status, 'blocked', 'approval gate remains closed');
});

test('task done without a verdict completes review execution but keeps gate closed', () => {
  const tasks = [
    {
      id: 'R1',
      status: 'in_flight',
      deps: [],
      dependency_gate: { kind: 'review', required_verdict: 'APPROVE' },
      created_at: '2026-06-24T08:00:00Z',
      started_at: '2026-06-24T08:10:00Z',
    },
    { id: 'I1', status: 'blocked', deps: ['R1'], created_at: '2026-06-24T08:30:00Z' },
  ];
  const boardPath = mkBoardHome({ tasks });
  const ctx = mkCtx(boardPath, {
    values: { verified: true, artifact: '/abs/review.md' },
    positionals: ['R1'],
  });
  assert.equal(taskHandler.done(ctx), EXIT.OK);
  const b = readBoard(boardPath);
  assert.equal(findTask(b, 'R1').status, 'done');
  assert.equal(findTask(b, 'R1').review_verdict, undefined);
  assert.equal(findTask(b, 'I1').status, 'blocked');
});

test('task done records APPROVE and auto-readies review-gated downstream', () => {
  const tasks = [
    {
      id: 'R1',
      status: 'in_flight',
      deps: [],
      dependency_gate: { kind: 'review', required_verdict: 'APPROVE' },
      created_at: '2026-06-24T08:00:00Z',
      started_at: '2026-06-24T08:10:00Z',
    },
    { id: 'I1', status: 'blocked', deps: ['R1'], created_at: '2026-06-24T08:30:00Z' },
  ];
  const boardPath = mkBoardHome({ tasks });
  const ctx = mkCtx(boardPath, {
    values: { verified: true, artifact: '/abs/review.md', 'review-verdict': 'APPROVE' },
    positionals: ['R1'],
  });
  assert.equal(taskHandler.done(ctx), EXIT.OK);
  const b = readBoard(boardPath);
  assert.equal(findTask(b, 'R1').review_verdict, 'APPROVE');
  assert.equal(findTask(b, 'I1').status, 'ready');
});

function retryApprovedReview(verdict?: 'APPROVE' | 'REQUEST-CHANGES'): {
  boardPath: string;
  board: any;
} {
  const tasks = [
    {
      id: 'R1',
      status: 'done',
      deps: [],
      dependency_gate: { kind: 'review', required_verdict: 'APPROVE' },
      review_verdict: 'APPROVE',
      verified: true,
      artifact: '/abs/review-v1.md',
      created_at: '2026-06-24T08:00:00Z',
      started_at: '2026-06-24T08:10:00Z',
      finished_at: '2026-06-24T08:20:00Z',
    },
    { id: 'I1', status: 'ready', deps: ['R1'], created_at: '2026-06-24T08:30:00Z' },
  ];
  const boardPath = mkBoardHome({ tasks });
  assert.equal(taskHandler.setStatus(mkCtx(boardPath, { positionals: ['R1', 'stale'] })), EXIT.OK);
  assert.equal(findTask(readBoard(boardPath), 'I1').status, 'blocked');
  assert.equal(taskHandler.setStatus(mkCtx(boardPath, { positionals: ['R1', 'ready'] })), EXIT.OK);
  assert.equal(taskHandler.start(mkCtx(boardPath, { positionals: ['R1'] })), EXIT.OK);
  const values: Record<string, unknown> = {
    verified: true,
    artifact: '/abs/review-v2.md',
  };
  if (verdict !== undefined) values['review-verdict'] = verdict;
  assert.equal(taskHandler.done(mkCtx(boardPath, { values, positionals: ['R1'] })), EXIT.OK);
  return { boardPath, board: readBoard(boardPath) };
}

test('retry completed without a new verdict does not preserve old APPROVE or unlock downstream', () => {
  const { board } = retryApprovedReview();
  assert.equal(findTask(board, 'R1').status, 'done');
  assert.equal(findTask(board, 'R1').review_verdict, undefined);
  assert.equal(findTask(board, 'I1').status, 'blocked');
});

test('retry uses only the current attempt verdict: REQUEST-CHANGES blocks and a new APPROVE unlocks', () => {
  for (const [verdict, expected] of [
    ['REQUEST-CHANGES', 'blocked'],
    ['APPROVE', 'ready'],
  ] as const) {
    const { board } = retryApprovedReview(verdict);
    assert.equal(findTask(board, 'R1').review_verdict, verdict);
    assert.equal(findTask(board, 'I1').status, expected);
  }
});

test('task done --review-verdict without an explicit review gate fails loud and does not persist', () => {
  const tasks = [
    {
      id: 'R1',
      status: 'in_flight',
      deps: [],
      created_at: '2026-06-24T08:00:00Z',
      started_at: '2026-06-24T08:10:00Z',
    },
  ];
  const boardPath = mkBoardHome({ tasks });
  const before = readFileSync(boardPath, 'utf8');
  const ctx = mkCtx(boardPath, {
    values: { verified: true, artifact: '/abs/review.md', 'review-verdict': 'APPROVE' },
    positionals: ['R1'],
  });
  assert.throws(() => taskHandler.done(ctx), /review gate/i);
  assert.equal(readFileSync(boardPath, 'utf8'), before);
});

// ══ task set-status ════════════════════════════════════════════════════════════════════════════════
test('task set-status legal transition (in_flight→escalated)', () => {
  const tasks = [{ id: 'T2', status: 'in_flight', deps: [], created_at: '2026-06-24T08:30:00Z' }];
  const boardPath = mkBoardHome({ tasks });
  const ctx = mkCtx(boardPath, { positionals: ['T2', 'escalated'] });
  const code = taskHandler.setStatus(ctx);
  assert.equal(code, EXIT.OK);
  assert.equal(findTask(readBoard(boardPath), 'T2').status, 'escalated');
});

test('task set-status illegal transition throws → IllegalTransition (VALIDATION 3)', () => {
  // done→in_flight is not in STATUS_MACHINE; expect throw, router maps to VALIDATION.
  const tasks = [
    {
      id: 'T1',
      status: 'done',
      deps: [],
      verified: true,
      artifact: '/abs/t1.md',
      created_at: '2026-06-24T08:00:00Z',
    },
  ];
  const boardPath = mkBoardHome({ tasks });
  const ctx = mkCtx(boardPath, { positionals: ['T1', 'in_flight'] });
  assert.throws(
    () => taskHandler.setStatus(ctx),
    (e: { errKind?: string }) => e.errKind === 'IllegalTransition',
  );
});

test('task set-status --force crosses an illegal transition', () => {
  const tasks = [
    {
      id: 'T1',
      status: 'done',
      deps: [],
      verified: true,
      artifact: '/abs/t1.md',
      created_at: '2026-06-24T08:00:00Z',
    },
  ];
  const boardPath = mkBoardHome({ tasks });
  const ctx = mkCtx(boardPath, { flags: { force: true }, positionals: ['T1', 'in_flight'] });
  const code = taskHandler.setStatus(ctx);
  assert.equal(code, EXIT.OK);
  assert.equal(findTask(readBoard(boardPath), 'T1').status, 'in_flight');
});

// ══ task rm ════════════════════════════════════════════════════════════════════════════════════════
test('task rm non-TTY without --yes → USAGE(2), board unchanged', () => {
  const boardPath = mkBoardHome({ tasks: structuredClone(SEED_TASKS) });
  const before = readFileSync(boardPath, 'utf8');
  const ctx = mkCtx(boardPath, { positionals: ['T2'] }); // isTTY:false default, no --yes
  const code = taskHandler.rm(ctx);
  assert.equal(code, EXIT.USAGE);
  assert.equal(readFileSync(boardPath, 'utf8'), before, 'board unchanged when refused');
  assert.ok(ctx.errBuf.join('').includes('--yes'));
});

test('task rm with --yes deletes a task (no dangling deps left)', () => {
  // remove T2 (a leaf — nothing depends on T2) → lint clean.
  const boardPath = mkBoardHome({ tasks: structuredClone(SEED_TASKS) });
  const ctx = mkCtx(boardPath, { flags: { yes: true }, positionals: ['T2'] });
  const code = taskHandler.rm(ctx);
  assert.equal(code, EXIT.OK);
  const board = readBoard(boardPath);
  assert.equal(findTask(board, 'T2'), undefined, 'T2 removed');
  assert.ok(findTask(board, 'T1'), 'T1 kept');
});

test('task rm leaving a dangling dep → VALIDATION(3) (lint hard error), board unchanged', () => {
  // T2 deps on T1; removing T1 leaves T2 dangling → GRAPH dangling-dep lint hard error.
  const boardPath = mkBoardHome({ tasks: structuredClone(SEED_TASKS) });
  const before = readFileSync(boardPath, 'utf8');
  const ctx = mkCtx(boardPath, { flags: { yes: true }, positionals: ['T1'] });
  const code = taskHandler.rm(ctx);
  assert.equal(code, EXIT.VALIDATION, 'lint hard error on dangling dep');
  assert.equal(readFileSync(boardPath, 'utf8'), before, 'board unchanged when lint refuses');
});

test('task rm on a missing id throws → NotFound(5)', () => {
  const boardPath = mkBoardHome({ tasks: structuredClone(SEED_TASKS) });
  const ctx = mkCtx(boardPath, { flags: { yes: true }, positionals: ['NOPE'] });
  assert.throws(
    () => taskHandler.rm(ctx),
    (e: { errKind?: string }) => e.errKind === 'NotFound',
  );
});

// ══ task show ══════════════════════════════════════════════════════════════════════════════════════
test('task show renders a single task (human + json)', () => {
  const boardPath = mkBoardHome({ tasks: structuredClone(SEED_TASKS) });
  const ctxH = mkCtx(boardPath, { positionals: ['T2'] });
  assert.equal(taskHandler.show(ctxH), EXIT.OK);
  assert.ok(ctxH.outBuf.join('').includes('T2'));

  const ctxJ = mkCtx(boardPath, { flags: { json: true }, positionals: ['T2'] });
  assert.equal(taskHandler.show(ctxJ), EXIT.OK);
  const parsed = JSON.parse(ctxJ.outBuf.join(''));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.data.id, 'T2');
});

test('task show on a missing id → human placeholder / json data:null', () => {
  const boardPath = mkBoardHome({ tasks: structuredClone(SEED_TASKS) });
  const ctx = mkCtx(boardPath, { flags: { json: true }, positionals: ['NOPE'] });
  assert.equal(taskHandler.show(ctx), EXIT.OK);
  const parsed = JSON.parse(ctx.outBuf.join(''));
  assert.equal(parsed.data, null);
});

// ══ task list ══════════════════════════════════════════════════════════════════════════════════════
const LIST_TASKS = [
  {
    id: 'T1',
    status: 'done',
    deps: [],
    verified: true,
    artifact: '/abs/t1.md',
    type: 'development',
    executor: 'subagent',
    created_at: '2026-06-24T08:00:00Z',
  },
  {
    id: 'T2',
    status: 'ready',
    deps: ['T1'],
    type: 'development',
    executor: 'subagent',
    created_at: '2026-06-24T08:30:00Z',
  },
  {
    id: 'T3',
    status: 'ready',
    deps: [],
    type: 'pr',
    executor: 'workflow',
    created_at: '2026-06-24T09:00:00Z',
  },
];

test('task list returns all (human table)', () => {
  const boardPath = mkBoardHome({ tasks: LIST_TASKS });
  const ctx = mkCtx(boardPath);
  assert.equal(taskHandler.list(ctx), EXIT.OK);
  const out = ctx.outBuf.join('\n');
  assert.ok(out.includes('T1') && out.includes('T2') && out.includes('T3'));
});

test('task list --status filters (multiple values)', () => {
  const boardPath = mkBoardHome({ tasks: LIST_TASKS });
  const ctx = mkCtx(boardPath, { values: { status: ['ready'] }, flags: { json: true } });
  taskHandler.list(ctx);
  const parsed = JSON.parse(ctx.outBuf.join(''));
  assert.equal(parsed.data.length, 2);
  assert.ok(parsed.data.every((t: { status: string }) => t.status === 'ready'));
});

test('task list --executor / --type filter', () => {
  const boardPath = mkBoardHome({ tasks: LIST_TASKS });
  const ctxE = mkCtx(boardPath, { values: { executor: 'workflow' }, flags: { json: true } });
  taskHandler.list(ctxE);
  assert.equal(JSON.parse(ctxE.outBuf.join('')).data.length, 1);

  const ctxT = mkCtx(boardPath, { values: { type: 'development' }, flags: { json: true } });
  taskHandler.list(ctxT);
  assert.equal(JSON.parse(ctxT.outBuf.join('')).data.length, 2);
});

test('task list --parent filters by owner', () => {
  const tasks = [
    { id: 'P1', status: 'ready', deps: [], created_at: '2026-06-24T08:00:00Z' },
    { id: 'C1', status: 'ready', deps: [], parent: 'P1', created_at: '2026-06-24T08:10:00Z' },
  ];
  const boardPath = mkBoardHome({ tasks });
  const ctx = mkCtx(boardPath, { values: { parent: 'P1' }, flags: { json: true } });
  taskHandler.list(ctx);
  const parsed = JSON.parse(ctx.outBuf.join(''));
  assert.equal(parsed.data.length, 1);
  assert.equal(parsed.data[0].id, 'C1');
});
