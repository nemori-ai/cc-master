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
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
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
  // board-v2 布局：board 集中落 <home>/boards/（discover.listBoardFiles 从那里扫·board init 也写那里）。
  const boardsDir = join(home, 'boards');
  mkdirSync(boardsDir, { recursive: true });
  const boardPath = join(boardsDir, '2026-06-24-bh.board.json');
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
//   默认 type='development' 需要 spec/plan 引用锚点才 lint-clean（BIZ-DEV-REFS 已 C1 hard 化）——
//   工厂默认带一对 spec/plan references，除非调用方显式覆写 references（如改 type 为非 development 的
//   测试用例不需要它们，多余的 spec/plan ref 对非 development task 也无害，lint 只在 type=development 时判）。
function task(id: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id,
    status: 'ready',
    deps: [],
    type: 'development',
    executor: 'subagent',
    handle: 'h',
    title: `task ${id}`,
    references: [
      { kind: 'spec', ref: '/abs/spec.md' },
      { kind: 'plan', ref: '/abs/plan.md' },
    ],
    ...over,
  };
  if (out.status === 'done') {
    if (out.verified === undefined) out.verified = true;
    if (out.artifact === undefined) out.artifact = `/abs/${id}.md`;
  }
  return out;
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

// ── board lint --json: data.report 字段（T4-1b·board-lint hook 支撑）────────────────────────────────
// --json 的 data 折进 report（= formatReport 文本，与人读模式同一份）。board-lint hook 一次调用既拿
//   violations（判有无 findings）又拿 report（直接注入 agent 的文本），无须再跑一次文本模式。
test('board lint --json: data.report carries formatReport text when findings exist', () => {
  const { boardPath } = mkBoardHome({ tasks: [task('T1', { deps: ['NOPE'] })] });
  const ctx = mkCtx({ boardPath, flags: { json: true } });
  boardHandler.lint(ctx);
  const parsed = JSON.parse(ctx.outBuf.join(''));
  assert.equal(typeof parsed.data.report, 'string', 'data.report 是字符串');
  assert.ok(parsed.data.report.length > 0, 'report 非空（有 findings）');
  assert.ok(parsed.data.report.includes('FAIL'), 'report 含 FAIL 头');
  assert.ok(parsed.data.report.includes('[hard]'), 'report 列出 hard finding');
});

test('board lint --json: truly clean board (no warns) → data.report present but empty (formatReport 静默)', () => {
  // type:'design' 不触发 BIZ-DEV-REFS / BIZ-ACCEPTANCE-REQUIRED warn → 0 finding → formatReport 返 ''。
  const { boardPath } = mkBoardHome({ tasks: [task('T1', { type: 'design' })] });
  const ctx = mkCtx({ boardPath, flags: { json: true } });
  boardHandler.lint(ctx);
  const parsed = JSON.parse(ctx.outBuf.join(''));
  assert.equal(parsed.data.ok, true, '净板 data.ok=true');
  assert.equal(parsed.data.violations.length, 0, '0 finding');
  assert.equal(parsed.data.report, '', '0 finding → report 空串（formatReport 无 finding → ""）');
});

test('board lint (human, no --json): unchanged — no report key, renders PASS/FAIL header', () => {
  const { boardPath } = mkBoardHome({ tasks: [task('T1')] });
  const ctx = mkCtx({ boardPath });
  boardHandler.lint(ctx);
  const out = ctx.outBuf.join('');
  assert.ok(out.includes('PASS'), '人读模式仍渲 PASS');
  assert.ok(!out.includes('"report"'), '人读模式不是 JSON、无 report 键');
});

// ══ board lint --raw（坏 JSON 容忍 / hook 支撑·T4-1a）══════════════════════════════════════════════
// --raw 直读 --board 指定文件的原始字节喂 lintBoard，绕过 discover 的 JSON 预校验：
//   坏 JSON → lint 成 FMT-JSON 错（exit 3）而非 discover 提前 exit 5（board-lint hook 的本职）。

test('board lint --raw: bad JSON file → FMT-JSON error + EXIT.VALIDATION (not discover exit 5)', () => {
  const root = mkTmp('ccm-rawlint-');
  const badPath = join(root, 'bad.board.json');
  writeFileSync(badPath, '{ "schema": "cc-master/v2", "goal": "x", BROKEN ', 'utf8');
  const ctx = mkCtx({ values: { board: badPath, raw: true } });
  const code = boardHandler.lint(ctx);
  assert.equal(code, EXIT.VALIDATION, '坏 JSON → exit 3（lint 跑了），而非 discover exit 5');
  assert.ok(ctx.outBuf.join('').includes('FMT-JSON'), '人类报告含 FMT-JSON');
});

test('board lint --raw --json: bad JSON file → violations carry rule FMT-JSON on stdout', () => {
  const root = mkTmp('ccm-rawlint-');
  const badPath = join(root, 'bad.board.json');
  writeFileSync(badPath, '{ not json at all', 'utf8');
  const ctx = mkCtx({ values: { board: badPath, raw: true }, flags: { json: true } });
  const code = boardHandler.lint(ctx);
  assert.equal(code, EXIT.VALIDATION);
  const parsed = JSON.parse(ctx.outBuf.join(''));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.data.ok, false);
  const rules = parsed.data.violations.map((v: { rule: string }) => v.rule);
  assert.ok(rules.includes('FMT-JSON'), 'violations 含 rule FMT-JSON');
});

test('board lint --raw: well-formed valid board file → clean / EXIT.OK', () => {
  const { boardPath } = mkBoardHome({ tasks: [task('T1')] });
  const ctx = mkCtx({ values: { board: boardPath, raw: true } });
  const code = boardHandler.lint(ctx);
  assert.equal(code, EXIT.OK);
  assert.ok(ctx.outBuf.join('').includes('PASS'));
});

test('board lint --raw --json: violations carry rule field per finding (GRAPH-ROLLUP filterable)', () => {
  // 父 done 子未 done → GRAPH-ROLLUP（warn·level 字段可见、rule 可 filter）。
  const tasks = [
    task('M1', { status: 'done', deps: [] }),
    task('M1.a', { status: 'done', parent: 'M1', deps: [] }),
    task('M1.b', { status: 'in_flight', parent: 'M1', deps: [] }),
  ];
  const { boardPath } = mkBoardHome({ tasks });
  const ctx = mkCtx({ values: { board: boardPath, raw: true }, flags: { json: true } });
  boardHandler.lint(ctx);
  const parsed = JSON.parse(ctx.outBuf.join(''));
  const rollup = parsed.data.violations.find((v: { rule: string }) => v.rule === 'GRAPH-ROLLUP');
  assert.ok(rollup, 'GRAPH-ROLLUP 在 violations 里·rule 字段可 filter');
  assert.equal(rollup.level, 'warn', 'rollup 是 warn 级（每条 finding 带 level 字段）');
  assert.equal(rollup.task, 'M1', '带 task 字段');
});

test('board lint --raw without --board → throws Usage (router maps to exit 2)', () => {
  const ctx = mkCtx({ values: { raw: true } });
  assert.throws(
    () => boardHandler.lint(ctx),
    (e: { errKind?: string }) => e.errKind === 'Usage',
    '--raw 缺 --board → Usage',
  );
});

test('board lint --raw: missing file → throws NotFound (router maps to exit 5)', () => {
  const root = mkTmp('ccm-rawlint-');
  const missing = join(root, 'does-not-exist.board.json');
  const ctx = mkCtx({ values: { board: missing, raw: true } });
  assert.throws(
    () => boardHandler.lint(ctx),
    (e: { errKind?: string }) => e.errKind === 'NotFound',
    '读不到文件 → NotFound',
  );
});

// 默认 lint（无 --raw）行为零变化的回归保险：坏 JSON 文件经 discover 仍 throw NotFound（exit 5），
//   而非被 --raw 路径吃成 lint 结果——证明默认契约未被本次改动破坏。
test('board lint (no --raw): bad JSON file still throws NotFound via discover (exit 5 契约不变)', () => {
  const root = mkTmp('ccm-rawlint-');
  const badPath = join(root, 'bad.board.json');
  writeFileSync(badPath, '{ broken json', 'utf8');
  const ctx = mkCtx({ values: { board: badPath } });
  assert.throws(
    () => boardHandler.lint(ctx),
    (e: { errKind?: string }) => e.errKind === 'NotFound',
    '默认路径坏 JSON 仍走 discover → NotFound（行为零变化）',
  );
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

// board graph --json 暴露 impact / rollup / nesting advisory（additive·端到端经 handler → analyzeGraph 句柄）。
test('board graph --json exposes impact / rollup / nesting advisory', () => {
  // T1 → T2 依赖链（impact）；M1(done) 有子 M1.a(done)/M1.b(in_flight)（rollup 不一致·父done子未done）。
  const tasks = [
    task('T1'),
    task('T2', { deps: ['T1'], status: 'blocked' }),
    task('M1', { status: 'done', deps: [] }),
    task('M1.a', { status: 'done', parent: 'M1', deps: [] }),
    task('M1.b', { status: 'in_flight', parent: 'M1', deps: [] }),
  ];
  const { boardPath } = mkBoardHome({ tasks });
  const ctx = mkCtx({ boardPath, flags: { json: true } });
  boardHandler.graph(ctx);
  const parsed = JSON.parse(ctx.outBuf.join(''));
  assert.equal(parsed.ok, true);
  const d = parsed.data;
  // impact：T1 的传递后代含 T2。
  assert.ok(d.impact && d.impact.T1, 'impact 含 T1');
  assert.ok(d.impact.T1.descendants.includes('T2'), 'T1 → T2');
  assert.equal(
    d.impact.T1.count,
    d.impact.T1.descendants.length,
    'impact count = descendants.length',
  );
  // rollup：M1 是 owner（{done:1,total:2,children:[M1.a,M1.b]}）+ inconsistencies 含 M1。
  assert.ok(d.rollup && d.rollup.owners && d.rollup.owners.M1, 'rollup.owners 含 M1');
  assert.equal(d.rollup.owners.M1.total, 2);
  assert.equal(d.rollup.owners.M1.done, 1);
  const inc = d.rollup.inconsistencies.find((i: { owner: string }) => i.owner === 'M1');
  assert.ok(inc, 'M1 在 rollup.inconsistencies');
  assert.ok(inc.nonDoneChildren.includes('M1.b'));
  // nesting：本板无 depth>1 / 无 parent 环 → 两空数组（字段存在·形状稳定）。
  assert.ok(d.nesting && Array.isArray(d.nesting.depth1) && Array.isArray(d.nesting.parentCycles));
  assert.deepEqual(d.nesting.depth1, []);
  assert.deepEqual(d.nesting.parentCycles, []);
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
  // board-v2 布局：init 把新板写进 <home>/boards/（非 home 根）。
  const boardsDir = join(home, 'boards');
  const files = readdirSync(boardsDir).filter((n) => n.endsWith('.board.json'));
  assert.equal(files.length, 1, 'one board file created');
  const onDisk = JSON.parse(readFileSync(join(boardsDir, files[0] as string), 'utf8'));
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
  // QA #13：建板输出应含板路径 + 下一步提示（免得用户不知道板在哪 / 怎么接着加任务）。
  const out = ctx.outBuf.join('');
  assert.ok(out.includes(target), 'init 输出含板路径');
  assert.ok(out.includes('下一步'), 'init 输出含下一步提示');
});

test('board init --github-issue records issue source and derives default goal', () => {
  const root = mkTmp('ccm-hinit-gh-');
  const home = join(root, '.claude', 'cc-master');
  mkdirSync(home, { recursive: true });
  const issueUrl = 'https://github.com/owner/repo/issues/123';
  const ctx = mkCtx({ home, values: { 'github-issue': issueUrl } });
  const code = boardHandler.init(ctx);
  assert.equal(code, EXIT.OK);
  const boardsDir = join(home, 'boards');
  const files = readdirSync(boardsDir).filter((n) => n.endsWith('.board.json'));
  assert.equal(files.length, 1, 'one board file created');
  const onDisk = JSON.parse(readFileSync(join(boardsDir, files[0] as string), 'utf8'));
  assert.equal(onDisk.goal, `GitHub issue: ${issueUrl}`);
  assert.deepEqual(onDisk.source, { kind: 'github_issue', url: issueUrl });
  assert.deepEqual(onDisk.tasks, [], 'board init records source, not a synthetic task');
});

test('board init --github-issue rejects non-GitHub issue URLs', () => {
  const root = mkTmp('ccm-hinit-gh-bad-');
  const home = join(root, '.claude', 'cc-master');
  mkdirSync(home, { recursive: true });
  const ctx = mkCtx({ home, values: { 'github-issue': 'https://github.com/owner/repo/pull/123' } });
  assert.throws(
    () => boardHandler.init(ctx),
    (err: unknown) => {
      assert.equal((err as { errKind?: string }).errKind, 'Usage');
      assert.match((err as Error).message, /--github-issue/);
      return true;
    },
  );
});

test('board init --dry-run does not create any file', () => {
  const root = mkTmp('ccm-hinit3-');
  const home = join(root, '.claude', 'cc-master');
  mkdirSync(home, { recursive: true });
  const ctx = mkCtx({ home, values: { goal: 'g' }, flags: { dryRun: true } });
  const code = boardHandler.init(ctx);
  assert.equal(code, EXIT.OK);
  // dry-run 不落盘——boards/ 目录可能已被 initResolve 预建，但里面绝无 *.board.json。
  assert.equal(
    readdirSync(join(home, 'boards')).filter((n) => n.endsWith('.board.json')).length,
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

// ══ board archive（带锁归档·翻 owner.active=false·非破坏·幂等）════════════════════════════════════════
test('board archive: 翻 owner.active=false·保留 goal/tasks/log·刷 heartbeat', () => {
  const { boardPath } = mkBoardHome({ tasks: [{ id: 'T1', status: 'ready', deps: [] }] });
  const ctx = mkCtx({ boardPath });
  const code = boardHandler.archive(ctx);
  assert.equal(code, EXIT.OK);
  const onDisk = JSON.parse(readFileSync(boardPath, 'utf8'));
  assert.equal(onDisk.owner.active, false, 'owner.active 翻 false');
  assert.equal(onDisk.goal, 'board handler test', 'goal 保留');
  assert.equal(onDisk.tasks.length, 1, 'tasks 保留（非破坏）');
  assert.notEqual(onDisk.owner.heartbeat, '2026-06-24T10:00:00Z', 'heartbeat 已刷新');
  assert.ok(ctx.outBuf.join('').includes('已归档'));
});

test('board archive --dry-run: 不落盘（owner.active 仍 true）', () => {
  const { boardPath } = mkBoardHome();
  const ctx = mkCtx({ boardPath, flags: { dryRun: true } });
  const code = boardHandler.archive(ctx);
  assert.equal(code, EXIT.OK);
  const onDisk = JSON.parse(readFileSync(boardPath, 'utf8'));
  assert.equal(onDisk.owner.active, true, 'dry-run 不落盘');
});

test('board archive: 幂等（已 active:false 再 archive 仍 false·无副作用）', () => {
  const { boardPath } = mkBoardHome();
  boardHandler.archive(mkCtx({ boardPath }));
  const code = boardHandler.archive(mkCtx({ boardPath }));
  assert.equal(code, EXIT.OK);
  const onDisk = JSON.parse(readFileSync(boardPath, 'utf8'));
  assert.equal(onDisk.owner.active, false);
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

// ── Finding #77：board update 的 board-discovery 不得因 flag 不同而分叉 ──────────────────────────────
//   旧坑：`--goal` 是全局消歧 flag，默认 resolve 把它当 goalSubstr 喂 discover；但 board update 的 `--goal`
//   是 payload（重定 goal）。implicit 发现（无 --board）一块 fresh-init 未认领板（owner.session_id:""·现有
//   goal 不含新串）时，goalSubstr 过滤把它滤掉 → 假 NotFound——而 `--wip-limit`（无 --goal）却成功。修复后
//   update 全 flag 走同一条两层匹配（精确 sid → 未认领兜底），与 task add / board next 等一致。
//
//   未认领板工厂：owner.session_id:""（如 `ccm board init` 建的），命令 sid 故意不同（不精确命中→落未认领档）。
function mkUnclaimedHome(goal = 'existing goal text') {
  return mkBoardHome({ goal, extra: { owner: { active: true, session_id: '' } } });
}
// implicit 发现（home 而非 boardPath）+ 隔离 XDG（指针注册表不污染 / 不读真机陈旧指针）。
function mkImplicitCtx(home: string, values: Record<string, unknown>) {
  const xdg = mkTmp('ccm-hboard-xdg-');
  return mkCtx({ home, values, sid: 'sid-runner', env: { XDG_STATE_HOME: xdg } });
}

test('board update --goal: implicit discovery on fresh-init unclaimed board → OK (Finding #77 repro)', () => {
  const { boardPath, home } = mkUnclaimedHome('v0.9 旧目标');
  // 新 goal 不含旧 goal 任何子串——旧坑下会被 goalSubstr 过滤滤掉 → 假 NotFound。
  const ctx = mkImplicitCtx(home, { goal: 'v0.10.0 全新目标' });
  const code = boardHandler.update(ctx);
  assert.equal(
    code,
    EXIT.OK,
    '未认领板上 implicit `update --goal` 必须成功（不再 flag-dependent NotFound）',
  );
  const onDisk = JSON.parse(readFileSync(boardPath, 'utf8'));
  assert.equal(onDisk.goal, 'v0.10.0 全新目标');
});

test('board update: --goal and --wip-limit discover the SAME board implicitly (flag-consistent)', () => {
  // --goal 路径。
  const goalHome = mkUnclaimedHome('某编排目标');
  const gCode = boardHandler.update(mkImplicitCtx(goalHome.home, { goal: '改后目标' }));
  // --wip-limit 路径（独立 home·同形未认领板）。
  const wipHome = mkUnclaimedHome('某编排目标');
  const wCode = boardHandler.update(mkImplicitCtx(wipHome.home, { 'wip-limit': '6' }));
  assert.equal(gCode, EXIT.OK, '--goal 隐式发现成功');
  assert.equal(wCode, EXIT.OK, '--wip-limit 隐式发现成功');
  // 两 flag 都命中各自 home 里唯一的未认领板（发现路径一致·均落盘）。
  assert.equal(JSON.parse(readFileSync(goalHome.boardPath, 'utf8')).goal, '改后目标');
  assert.equal(JSON.parse(readFileSync(wipHome.boardPath, 'utf8')).scheduling.wip_limit, 6);
});

// ══ board set-param（ADR-020·hook-owned runtime 参数区·带锁字段级 setter）══════════════════════════
test('board set-param: 白名单 key + ISO → 写 board.runtime.<key> + EXIT.OK + render 出', () => {
  const { boardPath } = mkBoardHome();
  const ctx = mkCtx({ boardPath, positionals: ['last_identity_remind', '2026-06-29T12:34:56Z'] });
  const code = boardHandler.setParam(ctx);
  assert.equal(code, EXIT.OK);
  const onDisk = JSON.parse(readFileSync(boardPath, 'utf8'));
  assert.equal(onDisk.runtime.last_identity_remind, '2026-06-29T12:34:56Z');
  assert.ok(ctx.outBuf.join('').includes('runtime 参数已设'));
});

test('board set-param --json renders { ok:true, data:{ runtime } }', () => {
  const { boardPath } = mkBoardHome();
  const ctx = mkCtx({
    boardPath,
    positionals: ['last_identity_remind', '2026-06-29T12:34:56Z'],
    flags: { json: true },
  });
  const code = boardHandler.setParam(ctx);
  assert.equal(code, EXIT.OK);
  const out = JSON.parse(ctx.outBuf.join(''));
  assert.equal(out.ok, true);
  assert.equal(out.data.runtime.last_identity_remind, '2026-06-29T12:34:56Z');
});

// last_critpath_remind 白名单第二成员（critpath-nudge·hooks-enhancements-v2 ②）：端到端经 router 写盘。
test('board set-param: last_critpath_remind 白名单 key + ISO → 写盘 + EXIT.OK', () => {
  const { boardPath } = mkBoardHome();
  const ctx = mkCtx({ boardPath, positionals: ['last_critpath_remind', '2026-06-30T08:00:00Z'] });
  const code = boardHandler.setParam(ctx);
  assert.equal(code, EXIT.OK);
  const onDisk = JSON.parse(readFileSync(boardPath, 'utf8'));
  assert.equal(onDisk.runtime.last_critpath_remind, '2026-06-30T08:00:00Z');
});

test('board set-param: stop_allow_until 白名单 key + ISO → 写盘 + EXIT.OK', () => {
  const { boardPath } = mkBoardHome();
  const ctx = mkCtx({ boardPath, positionals: ['stop_allow_until', '2026-07-03T15:30:00Z'] });
  const code = boardHandler.setParam(ctx);
  assert.equal(code, EXIT.OK);
  const onDisk = JSON.parse(readFileSync(boardPath, 'utf8'));
  assert.equal(onDisk.runtime.stop_allow_until, '2026-07-03T15:30:00Z');
});

test('board set-param: 非白名单 key → throws Usage (router maps to exit 2)', () => {
  const { boardPath } = mkBoardHome();
  const ctx = mkCtx({ boardPath, positionals: ['bogus_key', 'x'] });
  assert.throws(
    () => boardHandler.setParam(ctx),
    (e: { errKind?: string }) => e.errKind === 'Usage',
  );
});

test('board set-param: 白名单 key 但非法 ISO → throws Usage (exit 2)', () => {
  const { boardPath } = mkBoardHome();
  const ctx = mkCtx({ boardPath, positionals: ['last_identity_remind', 'not-iso'] });
  assert.throws(
    () => boardHandler.setParam(ctx),
    (e: { errKind?: string }) => e.errKind === 'Usage',
  );
});

test('board set-param --dry-run does not write the board', () => {
  const { boardPath } = mkBoardHome();
  const before = readFileSync(boardPath, 'utf8');
  const ctx = mkCtx({
    boardPath,
    positionals: ['last_identity_remind', '2026-06-29T12:34:56Z'],
    flags: { dryRun: true },
  });
  const code = boardHandler.setParam(ctx);
  assert.equal(code, EXIT.OK);
  assert.equal(readFileSync(boardPath, 'utf8'), before, 'board unchanged on dry-run');
  assert.ok(ctx.outBuf.join('').includes('[dry-run]'));
});

test('board set-param 走 runWrite 带锁管线：写后锁释放（不留 .lock 残骸）+ heartbeat 刷新', () => {
  const { boardPath } = mkBoardHome();
  const before = JSON.parse(readFileSync(boardPath, 'utf8'));
  const ctx = mkCtx({ boardPath, positionals: ['last_identity_remind', '2026-06-29T12:34:56Z'] });
  const code = boardHandler.setParam(ctx);
  assert.equal(code, EXIT.OK);
  // 带锁写后 .lock 应已在 finally 释放（runWrite → withBoardLock → 原子写 → 解锁）。
  assert.equal(existsSync(`${boardPath}.lock`), false, 'lock released after locked write');
  const after = JSON.parse(readFileSync(boardPath, 'utf8'));
  assert.ok(
    Date.parse(after.owner.heartbeat) >= Date.parse(before.owner.heartbeat),
    'owner.heartbeat refreshed (任何写 → heartbeat=now·与所有写 verb 同口径)',
  );
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
