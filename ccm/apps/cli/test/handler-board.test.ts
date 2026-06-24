// handler-board.test.ts — P5.2·board noun handler（handlers/board.ts）契约门。
//
// 用 mkdtemp 临时 home + 真 leaf（mutations / render / discover + 引擎 lint / graph）+ 临时板，端到端验证每 verb：
//   读 verb（show/lint/graph/critical-path/next）：验输出 + exit。
//   写 verb（init/update）：验板被改 / 新建 + exit OK + render 出 + --dry-run 不落盘。
//   关键错误：lint 有 hard error → EXIT.VALIDATION；update 全无 flag → USAGE；update 坏 wip-limit → USAGE；
//             show 解不出板（无 active）→ NotFound 冒泡（router 后映射 exit 5·此处验 throw .errKind）。
//
// T2b port 注：原 .mjs 经 createRequire 加载 CJS，改成 ESM import ported .ts 源。断言逻辑逐字保持。
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import type { Ctx } from '../src/handlers/_common.js';
import * as boardHandler from '../src/handlers/board.js';
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

// 一块合法 v2 板：goal/owner/git/scheduling/tasks/log。tasks 可注入。
function mkBoardHome({
  tasks = [] as unknown[],
  goal = 'board handler test',
  extra = {},
}: {
  tasks?: unknown[];
  goal?: string;
  extra?: Record<string, unknown>;
} = {}): {
  boardPath: string;
  home: string;
} {
  const root = mkTmp('ccm-hboard-');
  const home = join(root, '.claude', 'cc-master');
  mkdirSync(home, { recursive: true });
  const boardPath = join(home, '2026-06-24-bh.board.json');
  const board = {
    schema: 'cc-master/v2',
    meta: { template_version: 3 },
    goal,
    owner: { active: true, session_id: 'sid-bh', heartbeat: '2026-06-24T10:00:00Z' },
    git: { worktree: '', branch: '' },
    scheduling: { wip_limit: 4 },
    tasks,
    log: [],
    ...extra,
  };
  writeFileSync(boardPath, `${JSON.stringify(board, null, 2)}\n`, 'utf8');
  return { boardPath, home };
}

type TestCtx = Ctx & { outBuf: string[]; errBuf: string[] };
function mkCtx({
  boardPath,
  home,
  values = {},
  flags = {},
  positionals = [],
  sid = 'sid-bh',
  env,
}: {
  boardPath?: string;
  home?: string;
  values?: Record<string, unknown>;
  flags?: Partial<Ctx['flags']>;
  positionals?: string[];
  sid?: string;
  env?: Record<string, string | undefined>;
} = {}): TestCtx {
  const outBuf: string[] = [];
  const errBuf: string[] = [];
  const v: Record<string, unknown> = { ...values };
  if (boardPath !== undefined) v.board = boardPath;
  if (home !== undefined) v.home = home;
  return {
    values: v,
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
    env: env || {},
    out: (s: string) => outBuf.push(s),
    err: (s: string) => errBuf.push(s),
    outBuf,
    errBuf,
  };
}

// 一个 ready task 工厂（deps 空 + status ready → 进 readySet）。
function task(id: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    status: 'ready',
    deps: [],
    type: 'development',
    executor: 'subagent',
    handle: 'h',
    title: `task ${id}`,
    ...over,
  };
}

// ══ board show ═════════════════════════════════════════════════════════════════════════════════════
test('board show: human summary prints goal / owner / task counts / lint clean', () => {
  const { boardPath } = mkBoardHome({ tasks: [task('T1'), task('T2', { status: 'done' })] });
  const ctx = mkCtx({ boardPath });
  const code = boardHandler.show(ctx);
  assert.equal(code, EXIT.OK);
  const out = ctx.outBuf.join('\n');
  assert.ok(out.includes('board handler test'), 'goal shown');
  assert.ok(out.includes('owner'), 'owner shown');
  assert.ok(/ready=1/.test(out) && /done=1/.test(out), 'status counts shown');
  assert.ok(/lint:.*clean/.test(out), 'lint clean shown');
});

test('board show --json includes goal / statusCounts / lint', () => {
  const { boardPath } = mkBoardHome({ tasks: [task('T1')] });
  const ctx = mkCtx({ boardPath, flags: { json: true } });
  boardHandler.show(ctx);
  const parsed = JSON.parse(ctx.outBuf.join(''));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.data.goal, 'board handler test');
  assert.equal(parsed.data.taskCount, 1);
  assert.equal(parsed.data.statusCounts.ready, 1);
  assert.equal(parsed.data.lint.ok, true);
});

// ══ board lint ═════════════════════════════════════════════════════════════════════════════════════
test('board lint: clean board → EXIT.OK + PASS', () => {
  const { boardPath } = mkBoardHome({ tasks: [task('T1')] });
  const ctx = mkCtx({ boardPath });
  const code = boardHandler.lint(ctx);
  assert.equal(code, EXIT.OK);
  assert.ok(ctx.outBuf.join('').includes('PASS'));
});

test('board lint: board with hard error → EXIT.VALIDATION', () => {
  // 一个 task 依赖不存在的 dep（GRAPH 类 hard error），强制制造 hard error。
  const { boardPath } = mkBoardHome({ tasks: [task('T1', { deps: ['NOPE'] })] });
  const ctx = mkCtx({ boardPath });
  const code = boardHandler.lint(ctx);
  assert.equal(code, EXIT.VALIDATION, 'hard error → exit 3');
  assert.ok(ctx.outBuf.join('').includes('FAIL'));
});

test('board lint --json emits violations array', () => {
  const { boardPath } = mkBoardHome({ tasks: [task('T1', { deps: ['NOPE'] })] });
  const ctx = mkCtx({ boardPath, flags: { json: true } });
  const code = boardHandler.lint(ctx);
  assert.equal(code, EXIT.VALIDATION);
  const parsed = JSON.parse(ctx.outBuf.join(''));
  assert.equal(parsed.ok, true); // 外壳 ok:true，data.ok=false 表示 lint 不净
  assert.equal(parsed.data.ok, false);
  assert.ok(Array.isArray(parsed.data.violations) && parsed.data.violations.length > 0);
});

// ══ board graph ════════════════════════════════════════════════════════════════════════════════════
test('board graph: human prints topo order + ready', () => {
  const { boardPath } = mkBoardHome({
    tasks: [task('T1'), task('T2', { deps: ['T1'], status: 'blocked' })],
  });
  const ctx = mkCtx({ boardPath });
  const code = boardHandler.graph(ctx);
  assert.equal(code, EXIT.OK);
  const out = ctx.outBuf.join('\n');
  assert.ok(out.includes('topo order'), 'topo shown');
  assert.ok(out.includes('ready'), 'ready shown');
  assert.ok(out.includes('T1'), 'task id present');
});

test('board graph --json has topoOrder / readySet / criticalPath', () => {
  const { boardPath } = mkBoardHome({
    tasks: [task('T1'), task('T2', { deps: ['T1'], status: 'blocked' })],
  });
  const ctx = mkCtx({ boardPath, flags: { json: true } });
  boardHandler.graph(ctx);
  const parsed = JSON.parse(ctx.outBuf.join(''));
  assert.equal(parsed.ok, true);
  assert.ok(Array.isArray(parsed.data.topoOrder));
  assert.deepEqual(parsed.data.readySet, ['T1']);
  assert.ok(parsed.data.criticalPath && typeof parsed.data.criticalPath === 'object');
});

// ══ board critical-path ════════════════════════════════════════════════════════════════════════════
test('board critical-path: human prints chain + makespan + weight_source', () => {
  const { boardPath } = mkBoardHome({
    tasks: [
      task('T1', { estimate: { value: 3, unit: 'h' } }),
      task('T2', { deps: ['T1'], estimate: { value: 2, unit: 'h' } }),
    ],
  });
  const ctx = mkCtx({ boardPath });
  const code = boardHandler.criticalPath(ctx);
  assert.equal(code, EXIT.OK);
  const out = ctx.outBuf.join('\n');
  assert.ok(out.includes('critical path'), 'chain label shown');
  assert.ok(out.includes('makespan'), 'makespan shown');
  assert.ok(out.includes('weight_source'), 'weight_source shown');
});

test('board critical-path --json has chain / makespan / weight_source', () => {
  const { boardPath } = mkBoardHome({
    tasks: [
      task('T1', { estimate: { value: 3, unit: 'h' } }),
      task('T2', { deps: ['T1'], estimate: { value: 2, unit: 'h' } }),
    ],
  });
  const ctx = mkCtx({ boardPath, flags: { json: true } });
  boardHandler.criticalPath(ctx);
  const parsed = JSON.parse(ctx.outBuf.join(''));
  assert.equal(parsed.ok, true);
  assert.ok(Array.isArray(parsed.data.chain));
  assert.ok('makespan' in parsed.data);
  assert.ok('weight_source' in parsed.data);
});

// ══ board next ═════════════════════════════════════════════════════════════════════════════════════
test('board next: human lists ready ids; blocked-by-dep not ready', () => {
  const { boardPath } = mkBoardHome({
    tasks: [task('T1'), task('T2', { deps: ['T1'], status: 'ready' })],
  });
  const ctx = mkCtx({ boardPath });
  const code = boardHandler.next(ctx);
  assert.equal(code, EXIT.OK);
  const out = ctx.outBuf.join('\n');
  assert.ok(out.includes('T1'), 'T1 ready');
  assert.ok(!out.includes('T2'), 'T2 not ready (dep T1 not done)');
});

test('board next --json returns id array', () => {
  const { boardPath } = mkBoardHome({ tasks: [task('T1'), task('T2')] });
  const ctx = mkCtx({ boardPath, flags: { json: true } });
  boardHandler.next(ctx);
  const parsed = JSON.parse(ctx.outBuf.join(''));
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.data.sort(), ['T1', 'T2']);
});

test('board next: no ready tasks → human placeholder', () => {
  const { boardPath } = mkBoardHome({ tasks: [task('T1', { status: 'done' })] });
  const ctx = mkCtx({ boardPath });
  const code = boardHandler.next(ctx);
  assert.equal(code, EXIT.OK);
  assert.ok(ctx.outBuf.join('').includes('没有可派发'));
});

// ══ board init ═════════════════════════════════════════════════════════════════════════════════════
test('board init: creates a new board file in home (owner.active:true / session_id:"")', () => {
  const root = mkTmp('ccm-hinit-');
  const home = join(root, '.claude', 'cc-master');
  mkdirSync(home, { recursive: true });
  const ctx = mkCtx({ home, values: { goal: '试验性编排' } });
  const code = boardHandler.init(ctx);
  assert.equal(code, EXIT.OK);
  const files = readdirSync(home).filter((n) => n.endsWith('.board.json'));
  assert.equal(files.length, 1, 'one board file created');
  const onDisk = JSON.parse(readFileSync(join(home, files[0] as string), 'utf8'));
  assert.equal(onDisk.goal, '试验性编排');
  assert.equal(onDisk.owner.active, true, 'owner.active:true');
  assert.equal(onDisk.owner.session_id, '', 'session_id empty (non-arming·红线6)');
  assert.equal(onDisk.schema, 'cc-master/v2');
  assert.deepEqual(onDisk.tasks, []);
  assert.ok(ctx.outBuf.join('').includes('已建'));
});

test('board init --board <path> writes to the explicit path', () => {
  const root = mkTmp('ccm-hinit2-');
  const home = join(root, '.claude', 'cc-master');
  mkdirSync(home, { recursive: true });
  const target = join(home, 'custom.board.json');
  const ctx = mkCtx({ values: { goal: 'g', board: target } });
  const code = boardHandler.init(ctx);
  assert.equal(code, EXIT.OK);
  const onDisk = JSON.parse(readFileSync(target, 'utf8'));
  assert.equal(onDisk.goal, 'g');
});

test('board init --dry-run does not create any file', () => {
  const root = mkTmp('ccm-hinit3-');
  const home = join(root, '.claude', 'cc-master');
  mkdirSync(home, { recursive: true });
  const ctx = mkCtx({ home, values: { goal: 'g' }, flags: { dryRun: true } });
  const code = boardHandler.init(ctx);
  assert.equal(code, EXIT.OK);
  assert.equal(
    readdirSync(home).filter((n) => n.endsWith('.board.json')).length,
    0,
    'no file written',
  );
  assert.ok(ctx.outBuf.join('').includes('[dry-run]'));
});

// ══ board update ═══════════════════════════════════════════════════════════════════════════════════
test('board update: --goal rewrites goal and writes board', () => {
  const { boardPath } = mkBoardHome();
  const ctx = mkCtx({ boardPath, values: { goal: 'v0.10.0 收尾' } });
  const code = boardHandler.update(ctx);
  assert.equal(code, EXIT.OK);
  const onDisk = JSON.parse(readFileSync(boardPath, 'utf8'));
  assert.equal(onDisk.goal, 'v0.10.0 收尾');
  assert.ok(ctx.outBuf.join('').includes('已更新'));
});

test('board update: --wip-limit coerces to number; --branch/--worktree land git', () => {
  const { boardPath } = mkBoardHome();
  const ctx = mkCtx({
    boardPath,
    values: { 'wip-limit': '6', 'owner-wip': '2', branch: 'feat/x', worktree: '/ww' },
  });
  const code = boardHandler.update(ctx);
  assert.equal(code, EXIT.OK);
  const onDisk = JSON.parse(readFileSync(boardPath, 'utf8'));
  assert.equal(onDisk.scheduling.wip_limit, 6);
  assert.equal(typeof onDisk.scheduling.wip_limit, 'number', 'wip_limit is number (not string)');
  assert.equal(onDisk.scheduling.owner_wip_limit, 2);
  assert.equal(onDisk.git.branch, 'feat/x');
  assert.equal(onDisk.git.worktree, '/ww');
});

test('board update: no flags → throws Usage (router maps to exit 2)', () => {
  const { boardPath } = mkBoardHome();
  const ctx = mkCtx({ boardPath });
  assert.throws(
    () => boardHandler.update(ctx),
    (e: { errKind?: string }) => e.errKind === 'Usage',
  );
});

test('board update: bad --wip-limit (non-int) → throws Usage', () => {
  const { boardPath } = mkBoardHome();
  const ctx = mkCtx({ boardPath, values: { 'wip-limit': 'abc' } });
  assert.throws(
    () => boardHandler.update(ctx),
    (e: { errKind?: string }) => e.errKind === 'Usage',
  );
});

test('board update --dry-run does not write the board', () => {
  const { boardPath } = mkBoardHome();
  const before = readFileSync(boardPath, 'utf8');
  const ctx = mkCtx({ boardPath, values: { goal: 'preview' }, flags: { dryRun: true } });
  const code = boardHandler.update(ctx);
  assert.equal(code, EXIT.OK);
  assert.equal(readFileSync(boardPath, 'utf8'), before, 'board unchanged on dry-run');
  assert.ok(ctx.outBuf.join('').includes('[dry-run]'));
});

// ══ 发现失败（read verb 解不出 active board）═══════════════════════════════════════════════════════
test('board show: no active board → throws NotFound (router maps to exit 5)', () => {
  const root = mkTmp('ccm-hnone-');
  const home = join(root, '.claude', 'cc-master');
  mkdirSync(home, { recursive: true }); // 空 home·无板
  const ctx = mkCtx({ home, sid: 'sid-missing' });
  assert.throws(
    () => boardHandler.show(ctx),
    (e: { errKind?: string }) => e.errKind === 'NotFound',
  );
});
