// cli.test.ts — ccm CLI 端到端契约门（P5.3·设计稿 §11 P5.7 退出码矩阵 + JSON 契约 + 别名 + 板缺失）。
//
// 真二进制冒烟：spawnSync(process.execPath, [BIN, ...args]) 跑 ported bin/ccm.cjs（**不用 execFileSync**·契约 §一.5），
//   退出码读 r.status、stdout/stderr 分道断言。每测 mkdtemp 临时 home + 每测清理（afterEach）。
//
// 关键环境事实（设计稿 §6 实测）：`ccm board init` 产出 owner.session_id:""（未武装·红线6——init 永不 arm），
//   故「读/写已武装板」的 e2e 须用一块 owner.session_id===CLAUDE_CODE_SESSION_ID 的板（模拟 bootstrap 盖戳的结果）。
//   本套件用 seedBoard() 直接写一块 active+已盖 sid 的板，并在 spawn 时把 CLAUDE_CODE_SESSION_ID 设成同值。
//
// 退出码矩阵（设计稿 §4）：0 OK / 2 USAGE / 3 VALIDATION / 5 NOT_FOUND（4 LOCKED 难在 e2e 稳定触发·留 unit）。
//
// T2b port 注：原 cli/test/e2e/cli.test.mjs spawn cli/bin/ccm.js；本套件 spawn ported ccm/apps/cli/bin/ccm.cjs
//   （它 require dist/index.cjs·tsdown 单 bundle）。**依赖 build 产物**：测前若 dist/index.cjs 缺失则就地 `pnpm build`
//   （保 `pnpm test` 自洽）。BIN 路径从 test/e2e 上溯两级到 apps/cli/bin/ccm.cjs。断言逻辑逐字保持。
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
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
import { dirname, join } from 'node:path';
import { afterEach, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(HERE, '..', '..'); // test/e2e → apps/cli
const BIN = join(PKG_ROOT, 'bin', 'ccm.cjs');
const DIST = join(PKG_ROOT, 'dist', 'index.cjs');
const SID = 'e2e-session-0001';

// 测前确保 build 产物存在（bin require dist/index.cjs）。缺则就地 pnpm build（保 pnpm test 自洽）。
before(() => {
  if (!existsSync(DIST)) {
    execFileSync('pnpm', ['build'], { cwd: PKG_ROOT, stdio: 'inherit' });
  }
});

let TMPDIRS: string[] = [];
afterEach(() => {
  for (const d of TMPDIRS) rmSync(d, { recursive: true, force: true });
  TMPDIRS = [];
});

// mkHome() → { root, home }：临时 cc-master home 目录。
function mkHome(): { root: string; home: string } {
  const root = mkdtempSync(join(tmpdir(), 'ccm-e2e-'));
  TMPDIRS.push(root);
  const home = join(root, '.claude', 'cc-master');
  mkdirSync(home, { recursive: true });
  return { root, home };
}

// seedBoard(home, {goal, tasks}) → boardPath：写一块 active + 已盖 sid 的板（模拟 bootstrap arm 后的状态）。
function seedBoard(
  home: string,
  {
    goal = 'e2e goal',
    tasks = [] as unknown[],
    log = [] as unknown[],
  }: { goal?: string; tasks?: unknown[]; log?: unknown[] } = {},
): string {
  // board 集中落 <home>/boards/（board-v2 布局）。
  const boardsDir = join(home, 'boards');
  mkdirSync(boardsDir, { recursive: true });
  const boardPath = join(boardsDir, '2026-06-24-e2e.board.json');
  const board = {
    schema: 'cc-master/v2',
    meta: { template_version: 3 },
    goal,
    owner: { active: true, session_id: SID, heartbeat: '2026-06-24T10:00:00Z' },
    git: { worktree: '', branch: '' },
    scheduling: { wip_limit: 4 },
    tasks,
    log,
  };
  writeFileSync(boardPath, `${JSON.stringify(board, null, 2)}\n`, 'utf8');
  return boardPath;
}

interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

// runCcm(args, {home, sid, input}) → { status, stdout, stderr }。spawnSync 真二进制；退出码读 status。
function runCcm(
  args: string[],
  { home, sid = SID, input }: { home?: string; sid?: string; input?: string } = {},
): RunResult {
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (home !== undefined) env.CC_MASTER_HOME = home;
  if (sid !== undefined) env.CLAUDE_CODE_SESSION_ID = sid;
  else delete env.CLAUDE_CODE_SESSION_ID;
  // 防止外部 env 串扰发现层。
  delete env.CC_MASTER_BOARD;
  delete env.CLAUDE_PROJECT_DIR;
  const r = spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8', input, env });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

function readBoard(boardPath: string) {
  return JSON.parse(readFileSync(boardPath, 'utf8'));
}

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// 1. --version / --help（顶层·无 home 也能跑）
// ══════════════════════════════════════════════════════════════════════════════════════════════════
test('--version → status 0, stdout 形如 N.N.N, stderr 空', () => {
  const r = runCcm(['--version']);
  assert.equal(r.status, 0);
  assert.match(r.stdout.trim(), /^ccm \d+\.\d+\.\d+/);
  // 版本号在末空格后（GNU 格式）——抽出来再判 SemVer 形。
  const ver = r.stdout.trim().split(/\s+/).pop() as string;
  assert.match(ver, /^\d+\.\d+\.\d+/);
  assert.equal(r.stderr.trim(), '');
});

test('--help → status 0, 列 namespaces（board/task/...）', () => {
  const r = runCcm(['--help']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /CORE NAMESPACES/);
  for (const noun of ['board', 'task', 'log', 'jc', 'cadence', 'watchdog']) {
    assert.match(r.stdout, new RegExp(`\\b${noun}\\b`), `--help should list namespace ${noun}`);
  }
});

test('无参 → 顶层 help（status 0）', () => {
  const r = runCcm([]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /USAGE/);
});

test('ccm board --help → noun 级 help（status 0·列 COMMANDS）', () => {
  const r = runCcm(['board', '--help']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /COMMANDS/);
  assert.match(r.stdout, /\binit\b/);
});

test('ccm task add --help → verb 级 help（status 0·USAGE 带 <id>）', () => {
  const r = runCcm(['task', 'add', '--help']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /ccm task add <id>/);
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// 2. 退出码矩阵（表驱动）
// ══════════════════════════════════════════════════════════════════════════════════════════════════
test('退出码矩阵：合法读 / 未知 noun / 缺 verb / 缺 required positional', () => {
  const { home } = mkHome();
  seedBoard(home, { goal: 'matrix' });

  // (a) 合法读：board show 对一块已 seed 的 active 板 → 0。
  const ok = runCcm(['board', 'show'], { home });
  assert.equal(ok.status, 0, `board show 应 0；stderr=${ok.stderr}`);
  assert.match(ok.stdout, /matrix/);

  // (b) 未知 noun → 2 + 「Did you mean」（typo 触发 suggest）。
  const unknownTypo = runCcm(['baord', 'show'], { home });
  assert.equal(unknownTypo.status, 2);
  assert.match(unknownTypo.stderr, /Did you mean/);
  assert.match(unknownTypo.stderr, /board/);

  // (b2) 完全无关 noun → 2（无近邻则不强求 Did-you-mean，但退出码必 2）。
  const unknown = runCcm(['zzzzzz', 'show'], { home });
  assert.equal(unknown.status, 2);
  assert.match(unknown.stderr, /unknown command/);

  // (c) 缺 verb → 2。
  const noVerb = runCcm(['task'], { home });
  assert.equal(noVerb.status, 2);
  assert.match(noVerb.stderr, /missing command/);

  // (d) 缺 required positional（task add 无 id）→ 2。
  const noPos = runCcm(['task', 'add'], { home });
  assert.equal(noPos.status, 2);
  assert.match(noPos.stderr, /missing required argument/);

  // (e) 未知 verb → 2 + Did you mean（typo 'stat' → 近 'start'/'show'? 至少退 2）。
  const badVerb = runCcm(['task', 'addd'], { home });
  assert.equal(badVerb.status, 2);
  assert.match(badVerb.stderr, /Did you mean|unknown command/);
});

test('未知 flag → 2（usage error）', () => {
  const { home } = mkHome();
  seedBoard(home);
  const r = runCcm(['board', 'show', '--no-such-flag'], { home });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /usage error/);
});

test('非法 enum 值（闭合枚举 --executor）→ 2（router enum 校验）', () => {
  const { home } = mkHome();
  seedBoard(home);
  const r = runCcm(['task', 'add', 'TX', '--executor', 'not-an-executor'], { home });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /invalid value for --executor/);
});

test('开放枚举 --type 未知值 → 接受（不硬拒）+ lint FMT-TYPE warn（QA #2）', () => {
  const { home } = mkHome();
  seedBoard(home);
  // taskType 是开放枚举（board-model OPEN_ENUMS）：未知值不在 flag 层硬拒，由 lint 出 FMT-TYPE warn（不 fail）。
  //   --verbose 才展开全量 warning（QA #6）——故这里加 --verbose 断言 FMT-TYPE 现身。
  const r = runCcm(['task', 'add', 'TX', '--type', 'custom-type', '--verbose'], { home });
  assert.equal(r.status, 0, `open --type 应被接受；stderr=${r.stderr}`);
  assert.match(r.stderr, /FMT-TYPE/);
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// 3. 写路径 e2e（init → add → start → done → rm）
// ══════════════════════════════════════════════════════════════════════════════════════════════════
test('board init --goal → 板文件生成（exit 0）', () => {
  const { home } = mkHome();
  const r = runCcm(['board', 'init', '--goal', 'fresh init'], { home });
  assert.equal(r.status, 0, `init stderr=${r.stderr}`);
  const files = readdirSync(join(home, 'boards')).filter((n) => n.endsWith('.board.json'));
  assert.equal(files.length, 1, 'init should create exactly one board file');
  const b = readBoard(join(home, 'boards', files[0] as string));
  assert.equal(b.goal, 'fresh init');
  // 红线6：init 永不 arm——session_id 必为空串。
  assert.equal(b.owner.session_id, '', 'init must NOT stamp session_id (never arms)');
  assert.equal(b.owner.active, true);
});

test('board init --home <不存在的多级目录> → 自建目录 + 板（QA #16）', () => {
  // init 是建板命令：home 不存在时应自建（修复前 runWrite 抢锁 openSync(.lock,wx) 先撞 ENOENT）。
  const root = mkdtempSync(join(tmpdir(), 'ccm-e2e-'));
  TMPDIRS.push(root);
  const freshHome = join(root, 'never', 'existed', 'cc-master'); // 多级且不存在
  assert.ok(!existsSync(freshHome), 'precondition: home 目录不应预先存在');
  const r = runCcm(['board', 'init', '--goal', 'mkdir me'], { home: freshHome });
  assert.equal(r.status, 0, `init into fresh home should succeed; stderr=${r.stderr}`);
  assert.ok(existsSync(freshHome), 'init should have created the home dir');
  const files = readdirSync(join(freshHome, 'boards')).filter((n) => n.endsWith('.board.json'));
  assert.equal(files.length, 1, 'exactly one board created in the freshly-made home');
  assert.equal(readBoard(join(freshHome, 'boards', files[0] as string)).goal, 'mkdir me');
});

test('task add → 0 + 板含该 task；start → done 状态机走通', () => {
  const { home } = mkHome();
  const boardPath = seedBoard(home, { goal: 'write path' });

  const add = runCcm(['task', 'add', 'T1', '--type', 'development'], { home });
  assert.equal(add.status, 0, `add stderr=${add.stderr}`);
  let b = readBoard(boardPath);
  assert.ok(
    (b.tasks || []).some((t: { id: string }) => t.id === 'T1'),
    'board should contain T1',
  );
  assert.equal(b.tasks.find((t: { id: string }) => t.id === 'T1').status, 'ready');

  // 写命令的 lint warning 进 stderr（数据/确认进 stdout）——分道断言。
  assert.match(add.stdout, /T1/, 'add confirmation should be on stdout');

  const start = runCcm(['task', 'start', 'T1'], { home });
  assert.equal(start.status, 0);
  b = readBoard(boardPath);
  assert.equal(b.tasks.find((t: { id: string }) => t.id === 'T1').status, 'in_flight');
  assert.ok(b.tasks.find((t: { id: string }) => t.id === 'T1').started_at, 'started_at stamped');

  const done = runCcm(['task', 'done', 'T1', '--verified', '--artifact', '/abs/out.md'], { home });
  assert.equal(done.status, 0);
  b = readBoard(boardPath);
  const t1 = b.tasks.find((t: { id: string }) => t.id === 'T1');
  assert.equal(t1.status, 'done');
  assert.ok(t1.finished_at, 'finished_at stamped');
});

test('非法状态转移（task done 从 ready 直接 done）→ 3（VALIDATION）', () => {
  const { home } = mkHome();
  seedBoard(home, {
    tasks: [{ id: 'T1', status: 'ready', deps: [], created_at: '2026-06-24T08:00:00Z' }],
  });
  const r = runCcm(['task', 'done', 'T1'], { home });
  assert.equal(r.status, 3, `expected VALIDATION(3); stderr=${r.stderr}`);
  assert.match(r.stderr, /illegal transition|ready/);
});

test('task rm <id> --yes → 0 + 板不再含该 task', () => {
  const { home } = mkHome();
  const boardPath = seedBoard(home, {
    tasks: [
      { id: 'T1', status: 'ready', deps: [], created_at: '2026-06-24T08:00:00Z' },
      { id: 'T2', status: 'ready', deps: [], created_at: '2026-06-24T08:00:00Z' },
    ],
  });
  const r = runCcm(['task', 'rm', 'T2', '--yes'], { home });
  assert.equal(r.status, 0, `rm stderr=${r.stderr}`);
  const b = readBoard(boardPath);
  assert.ok(!(b.tasks || []).some((t: { id: string }) => t.id === 'T2'), 'T2 should be gone');
  assert.ok(
    (b.tasks || []).some((t: { id: string }) => t.id === 'T1'),
    'T1 should remain',
  );
});

test('task rm 非 TTY 缺 --yes → 2（USAGE·破坏性须确认）', () => {
  const { home } = mkHome();
  seedBoard(home, {
    tasks: [{ id: 'T1', status: 'ready', deps: [], created_at: '2026-06-24T08:00:00Z' }],
  });
  const r = runCcm(['task', 'rm', 'T1'], { home });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--yes|refused/);
});

test('--dry-run 不落盘（add 后板仍无该 task）', () => {
  const { home } = mkHome();
  const boardPath = seedBoard(home);
  const r = runCcm(['task', 'add', 'TDRY', '--type', 'development', '--dry-run'], { home });
  assert.equal(r.status, 0, `dry-run stderr=${r.stderr}`);
  const b = readBoard(boardPath);
  assert.ok(
    !(b.tasks || []).some((t: { id: string }) => t.id === 'TDRY'),
    'dry-run must NOT persist',
  );
  assert.match(r.stdout, /dry-run/i);
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// 4. JSON 契约（--json 统一壳 + 数据进 stdout / 诊断进 stderr）
// ══════════════════════════════════════════════════════════════════════════════════════════════════
test('board show --json → JSON.parse 过、结构对（ok/data/goal/owner）', () => {
  const { home } = mkHome();
  seedBoard(home, { goal: 'json contract' });
  const r = runCcm(['board', 'show', '--json'], { home });
  assert.equal(r.status, 0, `stderr=${r.stderr}`);
  const obj = JSON.parse(r.stdout);
  assert.equal(obj.ok, true);
  assert.equal(typeof obj.data, 'object');
  assert.equal(obj.data.goal, 'json contract');
  assert.equal(obj.data.owner.session_id, SID);
});

test('board graph --json（真二进制）→ impact / rollup / nesting advisory 字段齐 + 现有字段不变', () => {
  const { home } = mkHome();
  seedBoard(home, {
    tasks: [
      {
        id: 'T1',
        status: 'ready',
        type: 'development',
        deps: [],
        created_at: '2026-06-24T08:00:00Z',
      },
      {
        id: 'T2',
        status: 'blocked',
        type: 'development',
        deps: ['T1'],
        created_at: '2026-06-24T08:00:00Z',
      },
      {
        id: 'M1',
        status: 'done',
        type: 'development',
        deps: [],
        created_at: '2026-06-24T08:00:00Z',
      },
      {
        id: 'M1.a',
        status: 'done',
        type: 'development',
        parent: 'M1',
        deps: [],
        created_at: '2026-06-24T08:00:00Z',
      },
      {
        id: 'M1.b',
        status: 'in_flight',
        type: 'development',
        parent: 'M1',
        deps: [],
        created_at: '2026-06-24T08:00:00Z',
      },
    ],
  });
  const r = runCcm(['board', 'graph', '--json'], { home });
  assert.equal(r.status, 0, `stderr=${r.stderr}`);
  const obj = JSON.parse(r.stdout);
  assert.equal(obj.ok, true);
  const d = obj.data;
  // 现有字段不变。
  assert.ok(Array.isArray(d.topoOrder) && Array.isArray(d.readySet));
  assert.ok(d.criticalPath && 'makespan' in d.criticalPath && 'weight_source' in d.criticalPath);
  assert.ok(d.parallelism && 'T1' in d.parallelism);
  // 新增 advisory 三字段。
  assert.ok(d.impact && d.impact.T1 && d.impact.T1.descendants.includes('T2'), 'impact T1→T2');
  assert.ok(d.rollup && d.rollup.owners.M1 && d.rollup.owners.M1.total === 2, 'rollup owner M1');
  assert.ok(
    d.rollup.inconsistencies.some((i: { owner: string }) => i.owner === 'M1'),
    'rollup inconsistency M1（父done子未done）',
  );
  assert.ok(d.nesting && Array.isArray(d.nesting.depth1) && Array.isArray(d.nesting.parentCycles));
});

test('task list --json → data 是任务数组（数据进 stdout）', () => {
  const { home } = mkHome();
  seedBoard(home, {
    tasks: [
      {
        id: 'T1',
        status: 'ready',
        type: 'development',
        deps: [],
        created_at: '2026-06-24T08:00:00Z',
      },
    ],
  });
  const r = runCcm(['task', 'list', '--json'], { home });
  assert.equal(r.status, 0, `stderr=${r.stderr}`);
  const obj = JSON.parse(r.stdout);
  assert.equal(obj.ok, true);
  assert.ok(Array.isArray(obj.data));
  assert.equal(obj.data[0].id, 'T1');
});

test('JSON 模式错误壳：板缺失 + --json → 5 + stdout 仍可 parse 出 ok:false', () => {
  const { home } = mkHome(); // 无板
  const r = runCcm(['board', 'show', '--json'], { home });
  assert.equal(r.status, 5);
  // 数据进 stdout / 诊断进 stderr：JSON 错误壳走 stderr（reportHandlerError wantJson→err）。
  const obj = JSON.parse(r.stderr);
  assert.equal(obj.ok, false);
  assert.equal(obj.exit, 5);
  assert.equal(r.stdout.trim(), '', 'no data on stdout for an errored read');
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// 5. 别名（顶层 next / lint·verb 级 ls）
// ══════════════════════════════════════════════════════════════════════════════════════════════════
test('ccm next（空板）→ 0（顶层别名 → board next）', () => {
  const { home } = mkHome();
  seedBoard(home, { tasks: [] });
  const r = runCcm(['next'], { home });
  assert.equal(r.status, 0, `next stderr=${r.stderr}`);
});

test('ccm lint（净板）→ 0（顶层别名 → board lint）', () => {
  const { home } = mkHome();
  seedBoard(home);
  const r = runCcm(['lint'], { home });
  assert.equal(r.status, 0, `lint stderr=${r.stderr}`);
});

test('ccm task ls --json（verb 级别名 → task list）→ 0 + JSON 数组', () => {
  const { home } = mkHome();
  seedBoard(home, {
    tasks: [
      {
        id: 'T1',
        status: 'ready',
        type: 'development',
        deps: [],
        created_at: '2026-06-24T08:00:00Z',
      },
    ],
  });
  const r = runCcm(['task', 'ls', '--json'], { home });
  assert.equal(r.status, 0, `ls stderr=${r.stderr}`);
  const obj = JSON.parse(r.stdout);
  assert.ok(Array.isArray(obj.data));
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// 6. 板缺失（无 active 板 + 无 --board → 5 NOT_FOUND）
// ══════════════════════════════════════════════════════════════════════════════════════════════════
test('无 active 板（空 home）+ 无 --board → 5（NOT_FOUND）', () => {
  const { home } = mkHome(); // 空 home，无 board 文件
  const r = runCcm(['board', 'show'], { home });
  assert.equal(r.status, 5, `expected NOT_FOUND(5); stderr=${r.stderr}`);
  assert.match(r.stderr, /No active board|not found/i);
});

test('板存在但 sid 不匹配（owner.session_id≠env sid）→ 5（绝不退化抓唯一 active）', () => {
  const { home } = mkHome();
  seedBoard(home); // owner.session_id = SID
  const r = runCcm(['board', 'show'], { home, sid: 'a-different-sid' });
  assert.equal(r.status, 5, `mismatched sid should be NOT_FOUND; stderr=${r.stderr}`);
});

test('--board 显式注入越过发现（sid 不匹配也能读）→ 0', () => {
  const { home } = mkHome();
  const boardPath = seedBoard(home, { goal: 'explicit board' });
  const r = runCcm(['board', 'show', '--board', boardPath], { home, sid: 'wrong-sid' });
  assert.equal(r.status, 0, `--board should bypass discovery; stderr=${r.stderr}`);
  assert.match(r.stdout, /explicit board/);
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// 7. stdin / 数据分道（数据进 stdout / 诊断进 stderr 至少一条·设计稿 §2）
// ══════════════════════════════════════════════════════════════════════════════════════════════════
test('写命令的 lint warning 进 stderr，确认/数据进 stdout（分道）', () => {
  const { home } = mkHome();
  seedBoard(home);
  // development task 无 spec/plan ref → BIZ-DEV-REFS warn（进 stderr）；确认进 stdout。
  const r = runCcm(['task', 'add', 'TW', '--type', 'development'], { home });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /TW/, 'confirmation on stdout');
  assert.match(r.stderr, /warn|BIZ-DEV-REFS/i, 'lint warning on stderr');
});

test('task block --on user 经 stdin 喂 decision_package（-）', () => {
  const { home } = mkHome();
  const boardPath = seedBoard(home, {
    tasks: [
      {
        id: 'T1',
        status: 'ready',
        type: 'development',
        deps: [],
        created_at: '2026-06-24T08:00:00Z',
      },
    ],
  });
  const decision = JSON.stringify({
    question: '选 A 还是 B？',
    why_it_matters: '影响后续架构',
    options: [
      { id: 'A', summary: 'A 方案' },
      { id: 'B', summary: 'B 方案' },
    ],
    recommendation: 'A',
    prepared_at: '2026-06-24T10:00:00Z',
    freshness: { inputs_hash: 'abc', checked_at: '2026-06-24T10:00:00Z' },
  });
  const r = runCcm(['task', 'block', 'T1', '--on', 'user', '--decision', '-'], {
    home,
    input: decision,
  });
  // 退出码可能 0（lint 过）或 3（decision_package 形状不全被 BIZ-AWAITING 挡）——两者都证明 stdin 被读到了。
  assert.ok(
    r.status === 0 || r.status === 3,
    `block via stdin should be 0 or 3, got ${r.status}; stderr=${r.stderr}`,
  );
  if (r.status === 0) {
    const b = readBoard(boardPath);
    const t1 = b.tasks.find((t: { id: string }) => t.id === 'T1');
    assert.equal(t1.status, 'blocked');
    assert.ok(t1.decision_package, 'decision_package should be set from stdin');
  }
});
