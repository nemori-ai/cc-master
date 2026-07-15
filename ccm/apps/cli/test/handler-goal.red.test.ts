import assert from 'node:assert/strict';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import type { Ctx } from '../src/handlers/_common.js';
import * as goalHandler from '../src/handlers/goal.js';
import * as io from '../src/io.js';
import { boardInit } from '../src/mutations.js';

const roots: string[] = [];
function root(): string {
  const value = mkdtempSync(join(tmpdir(), 'ccm-goal-'));
  roots.push(value);
  return value;
}
afterEach(() => {
  for (const value of roots) rmSync(value, { recursive: true, force: true });
  roots.length = 0;
});

function fixture(): { root: string; home: string; boardPath: string; briefPath: string } {
  const base = root();
  const home = join(base, 'home');
  const boardPath = join(home, 'boards', '20260715-100000-42.board.json');
  const briefPath = join(base, 'brief.md');
  mkdirSync(join(home, 'boards'), { recursive: true });
  writeFileSync(boardPath, `${JSON.stringify(boardInit(), null, 2)}\n`, 'utf8');
  writeFileSync(briefPath, '# Goal Brief\n\n验收：交付 draft PR。\n', 'utf8');
  return { root: base, home, boardPath, briefPath };
}

function ctx(
  boardPath: string,
  home: string,
  values: Record<string, unknown> = {},
  json = true,
): Ctx & { outBuf: string[]; errBuf: string[] } {
  const outBuf: string[] = [];
  const errBuf: string[] = [];
  return {
    values: { board: boardPath, home, ...values },
    positionals: [],
    flags: {
      json,
      dryRun: false,
      force: false,
      yes: false,
      quiet: false,
      verbose: false,
      color: false,
    },
    sid: '',
    env: { HOME: home, CC_MASTER_HOME: home },
    out: (value) => outBuf.push(value),
    err: (value) => errBuf.push(value),
    outBuf,
    errBuf,
  };
}

test('GC-10: managed Brief copies exact UTF-8 bytes under home with mode 0600', () => {
  const f = fixture();
  const result = goalHandler.prepareManagedBrief({
    sourcePath: f.briefPath,
    home: f.home,
    boardPath: f.boardPath,
    revision: 1,
  });
  assert.equal(result.ref, 'goals/20260715-100000-42/r0001.goal.md');
  assert.equal(readFileSync(result.path, 'utf8'), readFileSync(f.briefPath, 'utf8'));
  assert.match(result.sha256, /^sha256:[0-9a-f]{64}$/);
  assert.equal(lstatSync(result.path).mode & 0o777, 0o600);
});

test('GC-10: managed Brief rejects symlink, directory, invalid UTF-8 and files over 1 MiB', () => {
  const f = fixture();
  const link = join(f.root, 'brief-link.md');
  symlinkSync(f.briefPath, link);
  assert.throws(
    () =>
      goalHandler.prepareManagedBrief({
        sourcePath: link,
        home: f.home,
        boardPath: f.boardPath,
        revision: 1,
      }),
    /regular file|symlink/,
  );
  assert.throws(
    () =>
      goalHandler.prepareManagedBrief({
        sourcePath: f.root,
        home: f.home,
        boardPath: f.boardPath,
        revision: 1,
      }),
    /regular file/,
  );

  const invalid = join(f.root, 'invalid.md');
  writeFileSync(invalid, Buffer.from([0xc3, 0x28]));
  assert.throws(
    () =>
      goalHandler.prepareManagedBrief({
        sourcePath: invalid,
        home: f.home,
        boardPath: f.boardPath,
        revision: 1,
      }),
    /UTF-8/,
  );

  const huge = join(f.root, 'huge.md');
  writeFileSync(huge, Buffer.alloc(1024 * 1024 + 1, 0x61));
  assert.throws(
    () =>
      goalHandler.prepareManagedBrief({
        sourcePath: huge,
        home: f.home,
        boardPath: f.boardPath,
        revision: 1,
      }),
    /1 MiB/,
  );
});

test('GC-10: managed Brief rejects a symlinked managed parent before writing outside home', () => {
  const f = fixture();
  const stem = '20260715-100000-42';
  const outside = join(f.root, 'outside');
  const goals = join(f.home, 'goals');
  mkdirSync(goals, { recursive: true });
  mkdirSync(outside, { recursive: true });
  symlinkSync(outside, join(goals, stem));

  assert.throws(
    () =>
      goalHandler.prepareManagedBrief({
        sourcePath: f.briefPath,
        home: f.home,
        boardPath: f.boardPath,
        revision: 1,
      }),
    /symlink|outside|trusted|managed/i,
  );
  assert.equal(
    existsSync(join(outside, 'r0001.goal.md')),
    false,
    'a rejected parent symlink must never receive Goal Brief bytes',
  );
});

test('GC-10: immutable revision refuses different bytes and preserves r1 when r2 is written', () => {
  const f = fixture();
  const r1 = goalHandler.prepareManagedBrief({
    sourcePath: f.briefPath,
    home: f.home,
    boardPath: f.boardPath,
    revision: 1,
  });
  writeFileSync(f.briefPath, '# changed\n', 'utf8');
  assert.throws(
    () =>
      goalHandler.prepareManagedBrief({
        sourcePath: f.briefPath,
        home: f.home,
        boardPath: f.boardPath,
        revision: 1,
      }),
    /immutable|already exists/,
  );
  const r2 = goalHandler.prepareManagedBrief({
    sourcePath: f.briefPath,
    home: f.home,
    boardPath: f.boardPath,
    revision: 2,
  });
  assert.equal(readFileSync(r1.path, 'utf8').startsWith('# Goal Brief'), true);
  assert.equal(readFileSync(r2.path, 'utf8'), '# changed\n');
});

test('GC-04/07: set, confirm, amend and check form one auditable lifecycle', () => {
  const f = fixture();
  const setCtx = ctx(f.boardPath, f.home, {
    summary: '交付 draft PR',
    assurance: 'asserted',
    'brief-file': f.briefPath,
  });
  assert.equal(goalHandler.set(setCtx), io.EXIT.OK);
  let board = JSON.parse(readFileSync(f.boardPath, 'utf8'));
  assert.equal(board.goal_contract.revision, 1);
  assert.equal(board.goal_contract.assurance, 'asserted');
  assert.equal(board.log.at(-1).kind, 'decision');

  const confirmCtx = ctx(f.boardPath, f.home, { 'user-authorized': true });
  assert.equal(goalHandler.confirm(confirmCtx), io.EXIT.OK);
  board = JSON.parse(readFileSync(f.boardPath, 'utf8'));
  assert.equal(board.goal_contract.assurance, 'confirmed');

  writeFileSync(f.briefPath, '# Goal Brief r2\n\n范围收窄：不发布。\n', 'utf8');
  const amendCtx = ctx(f.boardPath, f.home, {
    summary: '交付 draft PR，不发布',
    reason: '用户收窄范围',
    assurance: 'asserted',
    'brief-file': f.briefPath,
  });
  assert.equal(goalHandler.amend(amendCtx), io.EXIT.OK);
  board = JSON.parse(readFileSync(f.boardPath, 'utf8'));
  assert.equal(board.goal_contract.revision, 2);
  assert.equal(board.goal_contract.assurance, 'asserted');
  assert.equal(goalHandler.check(ctx(f.boardPath, f.home)), io.EXIT.OK);
});

test('GC-10: check reports missing and hash-mismatched Brief as exit 3', () => {
  const f = fixture();
  goalHandler.set(
    ctx(f.boardPath, f.home, { summary: 'goal', assurance: 'asserted', 'brief-file': f.briefPath }),
  );
  const board = JSON.parse(readFileSync(f.boardPath, 'utf8'));
  const managed = join(f.home, board.goal_contract.brief.ref);
  writeFileSync(managed, 'tampered', 'utf8');
  assert.equal(goalHandler.check(ctx(f.boardPath, f.home)), io.EXIT.VALIDATION);
  rmSync(managed);
  assert.equal(goalHandler.check(ctx(f.boardPath, f.home)), io.EXIT.VALIDATION);
});

test('GC-03: confirm without explicit user authorization is rejected', () => {
  const f = fixture();
  goalHandler.set(ctx(f.boardPath, f.home, { summary: 'goal', assurance: 'asserted' }));
  assert.throws(() => goalHandler.confirm(ctx(f.boardPath, f.home)), /user-authorized/);
});
