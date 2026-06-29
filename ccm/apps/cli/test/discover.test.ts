// discover.test.ts — 板 / home 解析（CLI 发现层·设计稿 §6 + 契约 §三）契约门。
//
// discover.ts 是 CLI 的发现层：把「现在该读 / 写哪块 board」按确定性优先级解成 {boardPath, board}。
//   优先级（设计稿 §6）：--board/$CC_MASTER_BOARD → 指针注册表（sid→path）→ home 扫 *.board.json
//     （sid 可用 → boardMatches 精确锚·命中 0 throw NotFound·绝不退化抓唯一 active；sid 不可用 → 唯一 active）。
//   依赖反转：自带 boardMatches（不 import hooks/hook-common·守红线）。红线6：只读 owner.session_id，绝不写。
//
// T2a port 注：原 .mjs 经 createRequire 加载 CJS（cli/test/unit/discover.test.mjs），改成正常 ESM import
//   ported discover.ts。无引擎依赖（自包含发现层）。临时 home + XDG state 全程 afterEach 清。

import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import * as D from '../src/discover.js';

// ── 临时目录生命周期（afterEach 全清·rmSync recursive,force）────────────────────────────────────
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

// 造一个 .claude/cc-master home 目录，返回其绝对路径。
function mkHome(): { root: string; home: string } {
  const root = mkTmp('ccm-discover-');
  const home = join(root, '.claude', 'cc-master');
  mkdirSync(home, { recursive: true });
  return { root, home };
}

// 写一块假 board.json 到 <home>/boards/（board-v2 布局·time-sortable 文件名）；返回其绝对路径。
function writeBoard(
  home: string,
  name: string,
  {
    active = true,
    sessionId = '',
    goal = 'a goal',
  }: { active?: boolean; sessionId?: string; goal?: string } = {},
): string {
  const dir = join(home, 'boards');
  mkdirSync(dir, { recursive: true });
  const p = join(dir, name);
  const board = {
    schema: 'cc-master/v2',
    goal,
    owner: { active, session_id: sessionId, heartbeat: '2026-06-24T10:00:00Z' },
    git: {},
    tasks: [],
  };
  writeFileSync(p, JSON.stringify(board), 'utf8');
  return p;
}

// 造一个 XDG state 目录（指针注册表的根）。
function mkXdg(): string {
  return mkTmp('ccm-xdg-');
}

// ── 导出契约 ─────────────────────────────────────────────────────────────────────────────────────
test('exposes the contracted surface', () => {
  const surface = D as unknown as Record<string, unknown>;
  for (const fn of [
    'resolveHome',
    'boardsDir',
    'boardMatches',
    'pointerPath',
    'readPointer',
    'writePointer',
    'deletePointer',
    'resolveBoard',
  ]) {
    assert.equal(typeof surface[fn], 'function', `discover exports ${fn}`);
  }
});

// ── boardMatches ────────────────────────────────────────────────────────────────────────────────
test('boardMatches: active && (sid? session_id===sid : true); bad input → false', () => {
  assert.equal(D.boardMatches({ owner: { active: true, session_id: 's1' } }, 's1'), true);
  assert.equal(D.boardMatches({ owner: { active: true, session_id: 's1' } }, 's2'), false);
  assert.equal(D.boardMatches({ owner: { active: true, session_id: 's1' } }, null), true); // 无 sid → 任一 active
  assert.equal(D.boardMatches({ owner: { active: false, session_id: 's1' } }, null), false); // 非 active
  assert.equal(D.boardMatches({ owner: { active: false, session_id: 's1' } }, 's1'), false);
  // 坏输入 → false（不抛）。
  assert.equal(D.boardMatches(null, 's1'), false);
  assert.equal(D.boardMatches({}, 's1'), false);
  assert.equal(D.boardMatches({ owner: null }, 's1'), false);
  assert.equal(D.boardMatches('not-an-object', 's1'), false);
});

// ── resolveHome ─────────────────────────────────────────────────────────────────────────────────
test('resolveHome: --home wins over everything', () => {
  assert.equal(
    D.resolveHome({ homeFlag: '/explicit/home', env: { CC_MASTER_HOME: '/x' } }),
    '/explicit/home',
  );
});

test('resolveHome: $CC_MASTER_HOME beats $HOME default', () => {
  assert.equal(
    D.resolveHome({ env: { CC_MASTER_HOME: '/env/home', HOME: '/h' } }),
    '/env/home',
  );
});

test('resolveHome: no CC_MASTER_HOME → $HOME/.claude/cc-master (global default)', () => {
  // 统一全局口径：无 --home / 无 $CC_MASTER_HOME → 默认 $HOME/.claude/cc-master。不再 per-repo
  // （$CLAUDE_PROJECT_DIR 已不参与）、不再 walk-up。
  assert.equal(
    D.resolveHome({ env: { HOME: '/h' } }),
    join('/h', '.claude', 'cc-master'),
  );
});

test('resolveHome: $CLAUDE_PROJECT_DIR is NO LONGER a factor (per-repo home removed)', () => {
  // 旧 per-repo 优先级已废：CLAUDE_PROJECT_DIR 在场也只走全局默认（$HOME/.claude/cc-master）。
  assert.equal(
    D.resolveHome({ env: { CLAUDE_PROJECT_DIR: '/proj', HOME: '/h' } }),
    join('/h', '.claude', 'cc-master'),
  );
});

// ── boardsDir ───────────────────────────────────────────────────────────────────────────────────
test('boardsDir: <home>/boards', () => {
  assert.equal(D.boardsDir('/some/home'), join('/some/home', 'boards'));
});

// ── pointer registry ─────────────────────────────────────────────────────────────────────────────
test('pointerPath: ($XDG_STATE_HOME||~/.local/state)/cc-master/boards/<sid>.path', () => {
  const xdg = mkXdg();
  assert.equal(
    D.pointerPath('sid-1', { XDG_STATE_HOME: xdg }),
    join(xdg, 'cc-master', 'boards', 'sid-1.path'),
  );
});

test('writePointer creates parent dirs + readPointer round-trips; deletePointer removes', () => {
  const xdg = mkXdg();
  const env = { XDG_STATE_HOME: xdg };
  D.writePointer('sid-rt', '/abs/board/x.board.json', env);
  assert.ok(existsSync(D.pointerPath('sid-rt', env)), 'pointer file written (mkdir -p)');
  assert.equal(readFileSync(D.pointerPath('sid-rt', env), 'utf8'), '/abs/board/x.board.json');
  assert.equal(D.readPointer('sid-rt', env), '/abs/board/x.board.json');
  D.deletePointer('sid-rt', env);
  assert.ok(!existsSync(D.pointerPath('sid-rt', env)), 'pointer file removed');
});

test('readPointer: missing → null; deletePointer on missing → no throw', () => {
  const xdg = mkXdg();
  const env = { XDG_STATE_HOME: xdg };
  assert.equal(D.readPointer('nope', env), null);
  assert.doesNotThrow(() => D.deletePointer('nope', env));
});

// ── resolveBoard: explicit --board / $CC_MASTER_BOARD ──────────────────────────────────────────────
test('resolveBoard: --board wins (highest priority)', () => {
  const { home } = mkHome();
  const p = writeBoard(home, '01.board.json', { sessionId: 's1' });
  const { boardPath, board } = D.resolveBoard({ boardFlag: p, env: {} });
  assert.equal(boardPath, p);
  assert.equal(board.goal, 'a goal');
});

test('resolveBoard: $CC_MASTER_BOARD when no --board', () => {
  const { home } = mkHome();
  const p = writeBoard(home, '01.board.json', { sessionId: 's1' });
  const { boardPath } = D.resolveBoard({ env: { CC_MASTER_BOARD: p } });
  assert.equal(boardPath, p);
});

test('resolveBoard: --board missing file → throw NotFound', () => {
  assert.throws(
    () => D.resolveBoard({ boardFlag: '/no/such/file.board.json', env: {} }),
    (e: any) => e.errKind === 'NotFound',
  );
});

// ── resolveBoard: pointer registry ─────────────────────────────────────────────────────────────────
test('resolveBoard: pointer hit (consistent) → use it', () => {
  const { home } = mkHome();
  const p = writeBoard(home, '01.board.json', { sessionId: 's-ptr', active: true });
  const xdg = mkXdg();
  const env = { XDG_STATE_HOME: xdg, CC_MASTER_HOME: home };
  D.writePointer('s-ptr', p, env);
  const { boardPath, board } = D.resolveBoard({ sid: 's-ptr', env });
  assert.equal(boardPath, p);
  assert.equal(board.owner!.session_id, 's-ptr');
});

test('resolveBoard: STALE pointer (board no longer active) → fall back to home discovery', () => {
  const { home } = mkHome();
  // 指针指向的板已非 active（陈旧）；home 里有另一块本 sid 的 active 板。
  const stale = writeBoard(home, '01-stale.board.json', { sessionId: 's-stale', active: false });
  const fresh = writeBoard(home, '02-fresh.board.json', { sessionId: 's-stale', active: true });
  const xdg = mkXdg();
  const env = { XDG_STATE_HOME: xdg, CC_MASTER_HOME: home };
  D.writePointer('s-stale', stale, env); // 指针陈旧
  const { boardPath } = D.resolveBoard({ sid: 's-stale', env });
  assert.equal(boardPath, fresh, 'stale pointer ignored, home discovery finds the active board');
});

test('resolveBoard: pointer to wrong-sid board → fall back (consistency check)', () => {
  const { home } = mkHome();
  const otherSid = writeBoard(home, '01-other.board.json', { sessionId: 's-other', active: true });
  const mine = writeBoard(home, '02-mine.board.json', { sessionId: 's-me', active: true });
  const xdg = mkXdg();
  const env = { XDG_STATE_HOME: xdg, CC_MASTER_HOME: home };
  D.writePointer('s-me', otherSid, env); // 指针指向别人的板（sid 不符）
  const { boardPath } = D.resolveBoard({ sid: 's-me', env });
  assert.equal(boardPath, mine, 'inconsistent pointer rejected, home discovery anchors by sid');
});

// ── resolveBoard: home discovery, sid anchored ────────────────────────────────────────────────────
test('resolveBoard: sid anchor (no pointer) → boardMatches exact', () => {
  const { home } = mkHome();
  writeBoard(home, '01.board.json', { sessionId: 's-aaa', active: true });
  const mine = writeBoard(home, '02.board.json', { sessionId: 's-bbb', active: true });
  const xdg = mkXdg();
  const { boardPath } = D.resolveBoard({
    sid: 's-bbb',
    env: { XDG_STATE_HOME: xdg, CC_MASTER_HOME: home },
  });
  assert.equal(boardPath, mine);
});

test('resolveBoard: sid given, zero matches → throw NotFound (NEVER grabs the unique active board)', () => {
  const { home } = mkHome();
  // home 里只有一块 active 板，但它属于别人的 sid。本 sid 命中 0 → 必须 NotFound，绝不抓这块唯一 active。
  writeBoard(home, '01.board.json', { sessionId: 's-someone-else', active: true });
  const xdg = mkXdg();
  assert.throws(
    () => D.resolveBoard({ sid: 's-not-here', env: { XDG_STATE_HOME: xdg, CC_MASTER_HOME: home } }),
    (e: any) => e.errKind === 'NotFound',
    'sid with no match must NOT degrade to grabbing the unique active board',
  );
});

test('resolveBoard: sid given, only an INACTIVE board with that sid → NotFound (active required)', () => {
  const { home } = mkHome();
  writeBoard(home, '01.board.json', { sessionId: 's-me', active: false });
  const xdg = mkXdg();
  assert.throws(
    () => D.resolveBoard({ sid: 's-me', env: { XDG_STATE_HOME: xdg, CC_MASTER_HOME: home } }),
    (e: any) => e.errKind === 'NotFound',
  );
});

// ── QA #1：sid given + 未认领板（session_id=""）兜底 ────────────────────────────────────────────────
//   `ccm board init` 建的板 session_id=""（非 arming）。当 sid 给定（继承 CLAUDE_CODE_SESSION_ID）但无精确
//   命中时，落「未认领」二档——这样 init→add 的 happy path 在 session 环境里也通（修复前必报 NotFound）。
test('resolveBoard: sid given, unclaimed board (session_id="") → found (QA #1 fallback)', () => {
  const { home } = mkHome();
  const unclaimed = writeBoard(home, '01.board.json', { sessionId: '', active: true });
  const xdg = mkXdg();
  const { boardPath } = D.resolveBoard({
    sid: 's-some-session',
    env: { XDG_STATE_HOME: xdg, CC_MASTER_HOME: home },
  });
  assert.equal(boardPath, unclaimed, '未认领的 active 板应被任何 sid 安全取用');
});

test('resolveBoard: sid given, exact-sid board PREFERRED over unclaimed (QA #1 precedence)', () => {
  const { home } = mkHome();
  writeBoard(home, '01-unclaimed.board.json', { sessionId: '', active: true });
  const mine = writeBoard(home, '02-mine.board.json', { sessionId: 's-me', active: true });
  const xdg = mkXdg();
  const { boardPath } = D.resolveBoard({
    sid: 's-me',
    env: { XDG_STATE_HOME: xdg, CC_MASTER_HOME: home },
  });
  // 本 session 已认领的板永远盖过未认领板（exact 档非空时不落 unclaimed 档）。
  assert.equal(boardPath, mine);
});

test('resolveBoard: sid given, multiple unclaimed (no exact) → Ambiguous (QA #1)', () => {
  const { home } = mkHome();
  writeBoard(home, '01.board.json', { sessionId: '', active: true, goal: 'first' });
  writeBoard(home, '02.board.json', { sessionId: '', active: true, goal: 'second' });
  const xdg = mkXdg();
  assert.throws(
    () => D.resolveBoard({ sid: 's-x', env: { XDG_STATE_HOME: xdg, CC_MASTER_HOME: home } }),
    (e: any) => e.errKind === 'Ambiguous',
  );
});

// ── resolveBoard: home discovery, no sid (human terminal) ──────────────────────────────────────────
test('resolveBoard: no sid → unique active board', () => {
  const { home } = mkHome();
  const active = writeBoard(home, '02-active.board.json', { active: true });
  writeBoard(home, '01-archived.board.json', { active: false }); // 归档板不算
  const { boardPath } = D.resolveBoard({ env: { CC_MASTER_HOME: home } });
  assert.equal(boardPath, active);
});

test('resolveBoard: no sid, multiple active → throw Ambiguous', () => {
  const { home } = mkHome();
  writeBoard(home, '01.board.json', { active: true, goal: 'first goal' });
  writeBoard(home, '02.board.json', { active: true, goal: 'second goal' });
  assert.throws(
    () => D.resolveBoard({ env: { CC_MASTER_HOME: home } }),
    (e: any) => e.errKind === 'Ambiguous',
  );
});

test('resolveBoard: no sid, multiple active disambiguated by goalSubstr', () => {
  const { home } = mkHome();
  writeBoard(home, '01.board.json', { active: true, goal: 'internationalize the app' });
  const b2 = writeBoard(home, '02.board.json', {
    active: true,
    goal: 'refactor the database layer',
  });
  const { boardPath } = D.resolveBoard({ goalSubstr: 'DATABASE', env: { CC_MASTER_HOME: home } }); // 大小写不敏感
  assert.equal(boardPath, b2);
});

test('resolveBoard: no sid, no active board → throw NotFound', () => {
  const { home } = mkHome();
  writeBoard(home, '01.board.json', { active: false });
  assert.throws(
    () => D.resolveBoard({ env: { CC_MASTER_HOME: home } }),
    (e: any) => e.errKind === 'NotFound',
  );
});

// ── resolveBoard: bad / corrupt boards skipped ────────────────────────────────────────────────────
test('resolveBoard: corrupt board.json is skipped (JSON.parse failure → skip, not throw)', () => {
  const { home } = mkHome();
  mkdirSync(join(home, 'boards'), { recursive: true });
  writeFileSync(join(home, 'boards', '01-corrupt.board.json'), '{ not valid json', 'utf8');
  const good = writeBoard(home, '02-good.board.json', { active: true });
  const { boardPath } = D.resolveBoard({ env: { CC_MASTER_HOME: home } });
  assert.equal(boardPath, good, 'corrupt board skipped, falls through to the valid active one');
});

test('resolveBoard: home resolves but <home>/boards/ has no *.board.json → NotFound', () => {
  const { home } = mkHome();
  // home 存在但 boards/ 为空（或不存在）。
  assert.throws(
    () => D.resolveBoard({ env: { CC_MASTER_HOME: home } }),
    (e: any) => e.errKind === 'NotFound',
  );
});
