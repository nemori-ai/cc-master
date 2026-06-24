// handler-cadence.test.ts — P5.2·cadence noun handler（handlers/cadence.ts）契约门。
//
// cadence.ts 四 verb：update / open / ship（runWrite）+ status（runRead）。本测试用 mkdtemp 临时 home
//   + 真 leaf（mutations / render / registry / _common）+ 临时板，端到端验证：
//     · update —— 真写 cadence.target={ship_every,min_unit} 到临时板（duration transform）+ render + --json。
//     · open   —— 真追一个 iteration（started_at 盖戳·status=open·members csv·goal/deadline）。
//     · ship   —— 成员全 done+verified → status=shipped 落盘；BIZ-CADENCE-SHIPPED 硬门拦未全 done+verified→VALIDATION；
//                 不存在的 iter-id → cadenceShip throw NotFound（router 映射 exit 5）。
//     · status —— 读出 target + iterations（human / --json）。
//
// T2b port 注：原 .mjs 经 createRequire 加载 CJS，改成 ESM import ported .ts 源。断言逻辑逐字保持。
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import type { Ctx } from '../src/handlers/_common.js';
import * as cadence from '../src/handlers/cadence.js';
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

// 两个 done+verified task（T0/T1）——满足 BIZ-CADENCE-SHIPPED 收口完整性闸。
function doneTask(id: string): Record<string, unknown> {
  return {
    id,
    status: 'done',
    verified: true,
    deps: [],
    created_at: '2026-06-24T08:00:00Z',
    started_at: '2026-06-24T08:30:00Z',
    finished_at: '2026-06-24T09:00:00Z',
  };
}

function mkBoardHome({
  tasks = [doneTask('T0'), doneTask('T1')],
  cadenceObj,
}: {
  tasks?: unknown[];
  cadenceObj?: unknown;
} = {}): string {
  const root = mkTmp('ccm-hcad-');
  const home = join(root, '.claude', 'cc-master');
  mkdirSync(home, { recursive: true });
  const boardPath = join(home, '2026-06-24-cad.board.json');
  const board: Record<string, unknown> = {
    schema: 'cc-master/v2',
    meta: { template_version: 3 },
    goal: 'cadence handler test',
    owner: { active: true, session_id: 'sid-cad', heartbeat: '2026-06-24T10:00:00Z' },
    git: { worktree: '', branch: '' },
    scheduling: { wip_limit: 4 },
    tasks,
    log: [],
  };
  if (cadenceObj !== undefined) board.cadence = cadenceObj;
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
  }: {
    values?: Record<string, unknown>;
    flags?: Partial<Ctx['flags']>;
    positionals?: string[];
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
    sid: 'sid-cad',
    env: {},
    out: (s: string) => outBuf.push(s),
    err: (s: string) => errBuf.push(s),
    outBuf,
    errBuf,
  };
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

// ══ cadence update ═══════════════════════════════════════════════════════════════════════════════
test('cadence update writes target={ship_every,min_unit} (duration transform)', () => {
  const boardPath = mkBoardHome();
  const ctx = mkCtx(boardPath, { values: { 'ship-every': '3h', 'min-unit': '1 PR' } });
  const code = cadence.update(ctx);
  assert.equal(code, EXIT.OK);

  const onDisk = JSON.parse(readFileSync(boardPath, 'utf8'));
  assert.ok(onDisk.cadence && onDisk.cadence.target, 'cadence.target written');
  // --ship-every 经 duration transform → {value, unit}
  assert.deepEqual(onDisk.cadence.target.ship_every, { value: 3, unit: 'h' });
  assert.equal(onDisk.cadence.target.min_unit, '1 PR');
  assert.ok(ctx.outBuf.join('').includes('节奏配置已更新'));
});

test('cadence update --json renders the cadence object', () => {
  const boardPath = mkBoardHome();
  const ctx = mkCtx(boardPath, { values: { 'ship-every': '90m' }, flags: { json: true } });
  const code = cadence.update(ctx);
  assert.equal(code, EXIT.OK);
  const parsed = JSON.parse(ctx.outBuf.join(''));
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.data.target.ship_every, { value: 90, unit: 'm' });
});

test('cadence update --dry-run does not write the board', () => {
  const boardPath = mkBoardHome();
  const before = readFileSync(boardPath, 'utf8');
  const ctx = mkCtx(boardPath, { values: { 'ship-every': '3h' }, flags: { dryRun: true } });
  const code = cadence.update(ctx);
  assert.equal(code, EXIT.OK);
  assert.equal(readFileSync(boardPath, 'utf8'), before, 'board unchanged on dry-run');
  assert.ok(ctx.outBuf.join('').includes('[dry-run]'));
});

test('cadence update honors --set (generic flexible-path escape hatch)', () => {
  const boardPath = mkBoardHome();
  const ctx = mkCtx(boardPath, {
    values: { 'ship-every': '3h', set: ['cadence.note=experimental'] },
  });
  const code = cadence.update(ctx);
  assert.equal(code, EXIT.OK);
  const onDisk = JSON.parse(readFileSync(boardPath, 'utf8'));
  assert.equal(onDisk.cadence.note, 'experimental');
});

// ══ cadence open ═════════════════════════════════════════════════════════════════════════════════
test('cadence open adds an iteration (started_at stamped, status=open, members csv)', () => {
  const boardPath = mkBoardHome();
  const ctx = mkCtx(boardPath, {
    values: { goal: 'ship 框架+翻译切片', deadline: '2026-06-25T14:00:00Z', members: 'T0,T1' },
    positionals: ['I1'],
  });
  const code = cadence.open(ctx);
  assert.equal(code, EXIT.OK);

  const onDisk = JSON.parse(readFileSync(boardPath, 'utf8'));
  const iters = onDisk.cadence.iterations;
  assert.equal(iters.length, 1);
  const it = iters[0];
  assert.equal(it.id, 'I1');
  assert.equal(it.status, 'open');
  assert.equal(it.goal, 'ship 框架+翻译切片');
  assert.equal(it.deadline, '2026-06-25T14:00:00Z');
  assert.deepEqual(it.members, ['T0', 'T1']);
  assert.match(it.started_at, ISO_RE, 'started_at strict ISO UTC');
  assert.ok(ctx.outBuf.join('').includes('iteration 已开启'));
});

test('cadence open --json renders the new iteration', () => {
  const boardPath = mkBoardHome();
  const ctx = mkCtx(boardPath, {
    values: { goal: 'g', members: 'T0' },
    flags: { json: true },
    positionals: ['I2'],
  });
  const code = cadence.open(ctx);
  assert.equal(code, EXIT.OK);
  const parsed = JSON.parse(ctx.outBuf.join(''));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.data.id, 'I2');
  assert.equal(parsed.data.status, 'open');
});

// ══ cadence ship ═════════════════════════════════════════════════════════════════════════════════
test('cadence ship marks iteration shipped when members are all done+verified', () => {
  const boardPath = mkBoardHome({
    cadenceObj: {
      target: { ship_every: '3h', min_unit: '1 PR' },
      iterations: [
        {
          id: 'I1',
          started_at: '2026-06-24T08:00:00Z',
          deadline: '2026-06-24T14:00:00Z',
          goal: 'g',
          members: ['T0', 'T1'],
          status: 'open',
        },
      ],
    },
  });
  const ctx = mkCtx(boardPath, { positionals: ['I1'] });
  const code = cadence.ship(ctx);
  assert.equal(code, EXIT.OK);

  const onDisk = JSON.parse(readFileSync(boardPath, 'utf8'));
  const it = onDisk.cadence.iterations[0];
  assert.equal(it.status, 'shipped');
  assert.match(it.shipped_at, ISO_RE, 'shipped_at stamped');
  assert.ok(ctx.outBuf.join('').includes('iteration 已收口'));
});

test('cadence ship → VALIDATION (3) when a member is not done+verified (BIZ-CADENCE-SHIPPED hard gate)', () => {
  // T1 未 verified → 成员未全 done+verified → lint 硬门拦，不落盘。
  const t1 = doneTask('T1');
  t1.verified = false;
  const boardPath = mkBoardHome({
    tasks: [doneTask('T0'), t1],
    cadenceObj: {
      target: { ship_every: '3h' },
      iterations: [
        { id: 'I1', started_at: '2026-06-24T08:00:00Z', members: ['T0', 'T1'], status: 'open' },
      ],
    },
  });
  const before = readFileSync(boardPath, 'utf8');
  const ctx = mkCtx(boardPath, { positionals: ['I1'] });
  const code = cadence.ship(ctx);
  assert.equal(code, EXIT.VALIDATION, 'ship blocked by BIZ-CADENCE-SHIPPED → exit 3');
  assert.equal(readFileSync(boardPath, 'utf8'), before, 'board unchanged when lint rejects');
  assert.ok(
    ctx.errBuf.join('').includes('BIZ-CADENCE-SHIPPED'),
    'lint report names the rule on stderr',
  );
});

test('cadence ship on a non-existent iter-id throws NotFound (router → exit 5)', () => {
  const boardPath = mkBoardHome({
    cadenceObj: {
      target: { ship_every: '3h' },
      iterations: [
        { id: 'I1', started_at: '2026-06-24T08:00:00Z', members: ['T0'], status: 'open' },
      ],
    },
  });
  const ctx = mkCtx(boardPath, { positionals: ['NOPE'] });
  let thrown: { errKind?: string } | undefined;
  try {
    cadence.ship(ctx);
  } catch (e) {
    thrown = e as { errKind?: string };
  }
  assert.ok(thrown, 'cadenceShip throws on missing iteration');
  assert.equal(thrown?.errKind, 'NotFound', "errKind='NotFound' → router maps to NOT_FOUND(5)");
});

// ══ cadence status ═══════════════════════════════════════════════════════════════════════════════
test('cadence status renders target + iterations (human)', () => {
  const boardPath = mkBoardHome({
    cadenceObj: {
      target: { ship_every: '3h', min_unit: '1 PR' },
      iterations: [
        {
          id: 'I1',
          started_at: '2026-06-24T08:00:00Z',
          goal: 'slice 1',
          members: ['T0', 'T1'],
          status: 'open',
        },
      ],
    },
  });
  const ctx = mkCtx(boardPath);
  const code = cadence.status(ctx);
  assert.equal(code, EXIT.OK);
  const out = ctx.outBuf.join('\n');
  assert.ok(out.includes('ship_every=3h'), 'target line shows ship_every');
  assert.ok(out.includes('1 PR'), 'target line shows min_unit');
  assert.ok(out.includes('I1'), 'iteration id listed');
  assert.ok(out.includes('slice 1'), 'iteration goal listed');
});

test('cadence status --json returns the cadence object', () => {
  const boardPath = mkBoardHome({
    cadenceObj: {
      target: { ship_every: '3h' },
      iterations: [{ id: 'I1', started_at: '2026-06-24T08:00:00Z', members: [], status: 'open' }],
    },
  });
  const ctx = mkCtx(boardPath, { flags: { json: true } });
  const code = cadence.status(ctx);
  assert.equal(code, EXIT.OK);
  const parsed = JSON.parse(ctx.outBuf.join(''));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.data.iterations.length, 1);
  assert.equal(parsed.data.iterations[0].id, 'I1');
});

test('cadence status on a board with no cadence → empty placeholder', () => {
  const boardPath = mkBoardHome(); // no cadence
  const ctx = mkCtx(boardPath);
  const code = cadence.status(ctx);
  assert.equal(code, EXIT.OK);
  assert.ok(ctx.outBuf.join('\n').includes('(无)'), 'no iterations placeholder');
});
