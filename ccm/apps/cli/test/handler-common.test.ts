// handler-common.test.ts — P5.2·共享读 / 写关卡 runner（handlers/_common.ts）契约门。
//
// _common.ts 是写入关卡管线（cli-design §5）的执行体：runWrite（resolve → 锁 → 读 → mutate → lint → 拒/写）、
//   runRead（resolve → 算 → render）、buildFields（flag → FIELDS dotpath 映射 + --set/--set-json 收集）。
//   本测试用 mkdtemp 临时 home + 真 leaf（io/discover/mutations/引擎 lint），断言：
//     · runWrite happy：板被原子写、render 出。
//     · lint 硬错 → EXIT.VALIDATION 不写盘。
//     · --dry-run 不写盘。
//     · --force 越硬错写盘。
//     · runRead happy。
//     · buildFields 各 transform（duration/csv/ref/input/kv/json）。
//
// T2b port 注：原 .mjs 经 createRequire 加载 CJS（cli/test/unit/handler-common.test.mjs），改成正常 ESM import
//   ported .ts 源 + node:fs/os/path helper。断言逻辑逐字保持。
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import * as common from '../src/handlers/_common.js';
import * as io from '../src/io.js';
import * as mutations from '../src/mutations.js';
import { REGISTRY } from '../src/registry.js';

const EXIT = io.EXIT;

// ── 临时目录生命周期 ──────────────────────────────────────────────────────────────────────────────
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

// 写一块有效 v2 board 到临时 home（active·sid 给定），返回 { home, boardPath }。
function mkBoardHome({
  sid = 'sid-test',
  goal = 'a goal',
  tasks = [] as unknown[],
}: {
  sid?: string;
  goal?: string;
  tasks?: unknown[];
} = {}): { home: string; boardPath: string } {
  const root = mkTmp('ccm-hc-');
  const home = join(root, '.claude', 'cc-master');
  mkdirSync(home, { recursive: true });
  const boardPath = join(home, '2026-06-24-test.board.json');
  const board = {
    schema: 'cc-master/v2',
    meta: { template_version: 3 },
    goal,
    owner: { active: true, session_id: sid, heartbeat: '2026-06-24T10:00:00Z' },
    git: { worktree: '', branch: '' },
    scheduling: { wip_limit: 4 },
    tasks,
    log: [],
  };
  writeFileSync(boardPath, `${JSON.stringify(board, null, 2)}\n`, 'utf8');
  return { home, boardPath };
}

// 造一个 ctx（注入 out/err 捕获器；resolve 经 --board 显式指定避免依赖 home walk-up）。
type TestCtx = common.Ctx & { outBuf: string[]; errBuf: string[] };
function mkCtx(
  boardPath: string,
  {
    values = {},
    flags = {},
    positionals = [],
    sid = 'sid-test',
  }: {
    values?: Record<string, unknown>;
    flags?: Partial<common.Ctx['flags']>;
    positionals?: string[];
    sid?: string;
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
    sid,
    env: {},
    out: (s: string) => outBuf.push(s),
    err: (s: string) => errBuf.push(s),
    outBuf,
    errBuf,
  };
  return ctx;
}

// ══ buildFields 各 transform ═════════════════════════════════════════════════════════════════════
test('buildFields: duration transform → {value, unit}', () => {
  const spec = REGISTRY.task?.add;
  const { fields } = common.buildFields({ estimate: '3h' }, spec);
  assert.deepEqual(fields.estimate, { value: 3, unit: 'h' });
});

test('buildFields: csv transform → trimmed array', () => {
  const spec = REGISTRY.task?.add;
  const { fields } = common.buildFields({ deps: 'T1, T2 ,T3' }, spec);
  assert.deepEqual(fields.deps, ['T1', 'T2', 'T3']);
});

test('buildFields: ref transform → [{kind, ref}] (URL with colon kept)', () => {
  const spec = REGISTRY.task?.add;
  const { fields } = common.buildFields(
    { ref: ['spec:/repo/spec.md', 'issue:https://github.com/o/r/issues/9'] },
    spec,
  );
  assert.deepEqual(fields.references, [
    { kind: 'spec', ref: '/repo/spec.md' },
    { kind: 'issue', ref: 'https://github.com/o/r/issues/9' },
  ]);
});

test('buildFields: csv on multiple flag flattens (add-dep)', () => {
  const spec = REGISTRY.task?.update;
  const { fields } = common.buildFields({ 'add-dep': ['T1', 'T2,T3'] }, spec);
  assert.deepEqual(fields.addDep, ['T1', 'T2', 'T3']);
});

test('buildFields: input transform reads @file', () => {
  const root = mkTmp('ccm-hc-input-');
  const f = join(root, 'accept.txt');
  writeFileSync(f, 'all tests green at endpoint', 'utf8');
  const spec = REGISTRY.task?.add;
  const { fields } = common.buildFields({ accept: `@${f}` }, spec);
  assert.equal(fields.acceptance, 'all tests green at endpoint');
});

test('buildFields: input transform passes literal through', () => {
  const spec = REGISTRY.task?.add;
  const { fields } = common.buildFields({ accept: 'one-liner DoD' }, spec);
  assert.equal(fields.acceptance, 'one-liner DoD');
});

test('buildFields: --set / --set-json collected as op lists (not fields)', () => {
  const spec = REGISTRY.task?.add;
  const { fields, sets, setJsons } = common.buildFields(
    { set: ['hitl_rounds=0'], 'set-json': ['output_schema={"x":1}'] },
    spec,
  );
  assert.deepEqual(sets, [{ path: 'hitl_rounds', value: '0' }]);
  assert.deepEqual(setJsons, [{ path: 'output_schema', value: '{"x":1}' }]);
  assert.equal(fields.set, undefined);
  assert.equal(fields['set-json'], undefined);
});

test('buildFields: --set-json value keeps inner = signs', () => {
  const spec = REGISTRY.task?.add;
  const { setJsons } = common.buildFields({ 'set-json': ['dep_pins={"a":"b=c"}'] }, spec);
  assert.deepEqual(setJsons, [{ path: 'dep_pins', value: '{"a":"b=c"}' }]);
});

test('buildFields: missing flags produce empty fields', () => {
  const spec = REGISTRY.task?.add;
  const { fields, sets, setJsons } = common.buildFields({}, spec);
  assert.deepEqual(fields, {});
  assert.deepEqual(sets, []);
  assert.deepEqual(setJsons, []);
});

test('buildFields: parseKv throws Usage on missing =', () => {
  const spec = REGISTRY.task?.add;
  assert.throws(
    () => common.buildFields({ set: ['nokv'] }, spec),
    (e: { errKind?: string }) => e.errKind === 'Usage',
  );
});

// ══ runWrite ═════════════════════════════════════════════════════════════════════════════════════
test('runWrite happy: board atomically written + render out', () => {
  const { boardPath } = mkBoardHome();
  const ctx = mkCtx(boardPath, { positionals: ['hello world'] });
  const code = common.runWrite(ctx, {
    mutate: (board) =>
      mutations.appendLog(board as common.BoardArg, { summary: ctx.positionals[0], kind: 'note' }),
    render: (_next, _c, { dryRun }) => (dryRun ? 'preview' : 'written'),
  });
  assert.equal(code, EXIT.OK);
  assert.deepEqual(ctx.outBuf, ['written']);
  const onDisk = JSON.parse(readFileSync(boardPath, 'utf8'));
  assert.equal(onDisk.log.length, 1);
  assert.equal(onDisk.log[0].summary, 'hello world');
  assert.equal(onDisk.log[0].kind, 'note');
  // 原子写：尾随换行 + 缩进。
  const text = readFileSync(boardPath, 'utf8');
  assert.ok(text.endsWith('\n'));
  assert.ok(text.includes('  "schema"'));
});

test('runWrite lint hard error → VALIDATION, board NOT written', () => {
  const { boardPath } = mkBoardHome();
  const before = readFileSync(boardPath, 'utf8');
  const ctx = mkCtx(boardPath);
  const code = common.runWrite(ctx, {
    // 把 goal 改成非字符串 → FMT-GOAL hard error。
    mutate: (board) => {
      const b = structuredClone(board) as Record<string, unknown>;
      b.goal = 12345;
      return b;
    },
    render: () => 'should-not-render',
  });
  assert.equal(code, EXIT.VALIDATION);
  assert.equal(readFileSync(boardPath, 'utf8'), before, 'board unchanged');
  assert.equal(ctx.outBuf.length, 0, 'no success render');
  assert.ok(ctx.errBuf.join('\n').includes('FMT-GOAL'), 'formatReport surfaced to stderr');
});

test('runWrite --dry-run: full lint runs but board NOT written', () => {
  const { boardPath } = mkBoardHome();
  const before = readFileSync(boardPath, 'utf8');
  const ctx = mkCtx(boardPath, { flags: { dryRun: true } });
  const code = common.runWrite(ctx, {
    mutate: (board) => mutations.appendLog(board as common.BoardArg, { summary: 'dryrun entry' }),
    render: (_next, _c, { dryRun }) => (dryRun ? 'preview-out' : 'written-out'),
  });
  assert.equal(code, EXIT.OK);
  assert.equal(readFileSync(boardPath, 'utf8'), before, 'board unchanged on dry-run');
  assert.deepEqual(ctx.outBuf, ['preview-out']);
});

test('runWrite --force overrides hard error and writes', () => {
  const { boardPath } = mkBoardHome();
  const ctx = mkCtx(boardPath, { flags: { force: true } });
  const code = common.runWrite(ctx, {
    mutate: (board) => {
      const b = structuredClone(board) as Record<string, unknown>;
      b.goal = 999;
      return b;
    },
    render: () => 'forced-write',
  });
  assert.equal(code, EXIT.OK);
  assert.deepEqual(ctx.outBuf, ['forced-write']);
  const onDisk = JSON.parse(readFileSync(boardPath, 'utf8'));
  assert.equal(onDisk.goal, 999);
});

test('runWrite warnings → 默认只一行摘要（QA #6·不刷屏），不挡写', () => {
  // 加一个 type=development 但缺 spec/plan 引用的 task → BIZ-DEV-REFS warn（不挡）。
  const { boardPath } = mkBoardHome();
  const ctx = mkCtx(boardPath);
  const code = common.runWrite(ctx, {
    mutate: (board) =>
      mutations.addTask(board as common.BoardArg, { id: 'TW', type: 'development' }),
    render: () => 'written-with-warn',
  });
  assert.equal(code, EXIT.OK);
  assert.deepEqual(ctx.outBuf, ['written-with-warn']);
  const errStr = ctx.errBuf.join('\n');
  // QA #6：默认成功写**不**重打整板 warning 全文（不含 [warn] 段），只一行摘要（含 warning 计数 + 指路）。
  assert.ok(!errStr.includes('[warn]'), '默认不打全量 warning 报告');
  assert.ok(errStr.includes('warning') && errStr.includes('lint:'), '一行摘要含 warning 计数');
  const onDisk = JSON.parse(readFileSync(boardPath, 'utf8'));
  assert.ok(onDisk.tasks.find((t: { id: string }) => t.id === 'TW'));
});

test('runWrite warnings → --verbose 展开全量 [warn] 报告（QA #6）', () => {
  const { boardPath } = mkBoardHome();
  const ctx = mkCtx(boardPath, { flags: { verbose: true } });
  const code = common.runWrite(ctx, {
    mutate: (board) =>
      mutations.addTask(board as common.BoardArg, { id: 'TW', type: 'development' }),
    render: () => 'written-with-warn',
  });
  assert.equal(code, EXIT.OK);
  // verbose 下恢复全量 warning 报告（含 [warn] 行）——给想看细节的人。
  assert.ok(ctx.errBuf.join('\n').includes('[warn]'), 'verbose 下全量 warning surfaced');
});

test('runWrite does NOT catch mutation throw (bubbles to router)', () => {
  const { boardPath } = mkBoardHome({ tasks: [{ id: 'T1', status: 'ready', deps: [] }] });
  const ctx = mkCtx(boardPath);
  assert.throws(
    () =>
      common.runWrite(ctx, {
        // transition to non-existent task → mutations throws NotFound.
        mutate: (board) => mutations.transition(board as common.BoardArg, 'NOPE', 'in_flight', {}),
        render: () => 'x',
      }),
    (e: { errKind?: string }) => e.errKind === 'NotFound',
  );
});

// custom resolve (board.init-style: target path, no existing board on disk).
test('runWrite custom resolve creates a brand-new board file', () => {
  const root = mkTmp('ccm-hc-init-');
  const home = join(root, '.claude', 'cc-master');
  mkdirSync(home, { recursive: true });
  const boardPath = join(home, 'fresh.board.json');
  assert.equal(existsSync(boardPath), false);
  const ctx = mkCtx(boardPath);
  const code = common.runWrite(ctx, {
    resolve: () => ({ boardPath, board: null }),
    mutate: () => mutations.boardInit({ goal: 'fresh goal' }),
    render: () => 'created',
  });
  assert.equal(code, EXIT.OK);
  assert.ok(existsSync(boardPath));
  const onDisk = JSON.parse(readFileSync(boardPath, 'utf8'));
  assert.equal(onDisk.goal, 'fresh goal');
  assert.equal(onDisk.schema, 'cc-master/v2');
});

// ══ runRead ══════════════════════════════════════════════════════════════════════════════════════
test('runRead happy: resolves board, computes, renders', () => {
  const { boardPath } = mkBoardHome({ tasks: [{ id: 'T1', status: 'ready', deps: [] }] });
  const ctx = mkCtx(boardPath);
  const code = common.runRead(ctx, {
    compute: (board) =>
      (board as { tasks: Array<{ status: string }> }).tasks.filter((t) => t.status === 'ready'),
    render: (tasks) => `ready=${(tasks as unknown[]).length}`,
  });
  assert.equal(code, EXIT.OK);
  assert.deepEqual(ctx.outBuf, ['ready=1']);
});

test('runRead does NOT catch resolve throw (NotFound bubbles)', () => {
  const ctx = mkCtx('/nonexistent/path/board.json');
  assert.throws(
    () => common.runRead(ctx, { compute: (b) => b, render: () => 'x' }),
    (e: { errKind?: string }) => e.errKind === 'NotFound',
  );
});
