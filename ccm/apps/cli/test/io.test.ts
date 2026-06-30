// io.test.ts — io.ts（运行时 IO 工具箱）契约门。
//
// 钉死：EXIT enum、isTTY、resolveColor 优先级矩阵全覆盖、paint、readInputSpec（- / @file / 字面量）、
//   writeFileAtomicSync（内容完整 + temp 清理）、withBoardLock（引擎 withLock 薄包装）、jsonOk/jsonErr 壳、
//   parseDuration（happy + 坏）。
//
// T2a port 注：原 .mjs 经 createRequire 加载 CJS（cli/test/unit/io.test.mjs），改成正常 ESM import ported
//   .ts 源 + node:fs/os/path helper。原「io.js exists in cli/src」纯路径存在性 case 已删（旧布局产物·与
//   行为无关）。withBoardLock 走引擎 withLock（rewire 后真链路验证）。

import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import * as io from '../src/io.js';

// ── EXIT enum ────────────────────────────────────────────────────────────────────────────────────
test('EXIT enum carries the agreed distinct codes', () => {
  assert.deepEqual(
    { ...io.EXIT },
    {
      OK: 0,
      ERROR: 1,
      USAGE: 2,
      VALIDATION: 3,
      LOCKED: 4,
      NOT_FOUND: 5,
    },
  );
});

// ── isTTY ──────────────────────────────────────────────────────────────────────────────────────────
test('isTTY: Boolean(stream && stream.isTTY)', () => {
  assert.equal(io.isTTY({ isTTY: true }), true);
  assert.equal(io.isTTY({ isTTY: false }), false);
  assert.equal(io.isTTY({}), false);
  assert.equal(io.isTTY(null), false);
  assert.equal(io.isTTY(undefined), false);
});

// ── resolveColor：优先级矩阵全覆盖 ────────────────────────────────────────────────────────────────
//   优先级：NO_COLOR(非空) > --no-color/--color > FORCE_COLOR > TERM=dumb > isTTY。
const ttyStream = { isTTY: true };
const noTtyStream = { isTTY: false };

test('resolveColor ① NO_COLOR non-empty → false (highest, overrides everything)', () => {
  // 即便 --color + FORCE_COLOR=1 + TTY，NO_COLOR 非空仍禁色。
  assert.equal(
    io.resolveColor({
      stream: ttyStream,
      argv: ['--color'],
      env: { NO_COLOR: '1', FORCE_COLOR: '1', TERM: 'xterm' },
    }),
    false,
  );
  assert.equal(
    io.resolveColor({ stream: noTtyStream, argv: [], env: { NO_COLOR: 'anything' } }),
    false,
  );
});

test('resolveColor ① NO_COLOR="" is treated as UNSET (empty → falls through)', () => {
  // NO_COLOR='' 不算「设了」——落到 isTTY：TTY → true。
  assert.equal(io.resolveColor({ stream: ttyStream, argv: [], env: { NO_COLOR: '' } }), true);
  // NO_COLOR='' + non-TTY → isTTY false → false（不是因 NO_COLOR，是因无 TTY）。
  assert.equal(io.resolveColor({ stream: noTtyStream, argv: [], env: { NO_COLOR: '' } }), false);
});

test('resolveColor ② --no-color → false (over FORCE_COLOR & TTY, NO_COLOR unset)', () => {
  assert.equal(
    io.resolveColor({
      stream: ttyStream,
      argv: ['--no-color'],
      env: { FORCE_COLOR: '1', TERM: 'xterm' },
    }),
    false,
  );
});

test('resolveColor ② --color → true (over FORCE_COLOR=0, TERM=dumb, non-TTY)', () => {
  assert.equal(
    io.resolveColor({
      stream: noTtyStream,
      argv: ['--color'],
      env: { FORCE_COLOR: '0', TERM: 'dumb' },
    }),
    true,
  );
});

test('resolveColor ② --no-color beats --color when both present (no-color earlier in chain)', () => {
  assert.equal(
    io.resolveColor({ stream: ttyStream, argv: ['--color', '--no-color'], env: {} }),
    false,
  );
});

test('resolveColor ③ FORCE_COLOR non-"0" → true; "0" → false (no flags, NO_COLOR unset)', () => {
  assert.equal(io.resolveColor({ stream: noTtyStream, argv: [], env: { FORCE_COLOR: '1' } }), true);
  assert.equal(io.resolveColor({ stream: noTtyStream, argv: [], env: { FORCE_COLOR: '2' } }), true);
  assert.equal(io.resolveColor({ stream: ttyStream, argv: [], env: { FORCE_COLOR: '0' } }), false);
});

test('resolveColor ③ FORCE_COLOR beats TERM=dumb', () => {
  assert.equal(
    io.resolveColor({ stream: noTtyStream, argv: [], env: { FORCE_COLOR: '1', TERM: 'dumb' } }),
    true,
  );
});

test('resolveColor ④ TERM=dumb → false (no NO_COLOR / flags / FORCE_COLOR)', () => {
  assert.equal(io.resolveColor({ stream: ttyStream, argv: [], env: { TERM: 'dumb' } }), false);
});

test('resolveColor ⑤ falls back to isTTY (no overrides at all)', () => {
  assert.equal(io.resolveColor({ stream: ttyStream, argv: [], env: {} }), true);
  assert.equal(io.resolveColor({ stream: noTtyStream, argv: [], env: {} }), false);
  assert.equal(
    io.resolveColor({ stream: ttyStream, argv: [], env: { TERM: 'xterm-256color' } }),
    true,
  );
});

test('resolveColor tolerates missing argv/env/stream (defensive defaults)', () => {
  assert.equal(io.resolveColor({}), false); // no stream → isTTY false
  assert.equal(io.resolveColor(), false); // no args at all
  assert.equal(io.resolveColor({ stream: ttyStream }), true);
});

// ── paint ──────────────────────────────────────────────────────────────────────────────────────────
test('paint: wraps SGR when enabled, raw when disabled', () => {
  assert.equal(io.paint('x', 'red', true), '\x1b[31mx\x1b[0m');
  assert.equal(io.paint('x', 'green', true), '\x1b[32mx\x1b[0m');
  assert.equal(io.paint('x', 'yellow', true), '\x1b[33mx\x1b[0m');
  assert.equal(io.paint('x', 'cyan', true), '\x1b[36mx\x1b[0m');
  assert.equal(io.paint('x', 'gray', true), '\x1b[90mx\x1b[0m');
  assert.equal(io.paint('x', 'dim', true), '\x1b[2mx\x1b[0m');
  assert.equal(io.paint('x', 'red', false), 'x'); // disabled → raw
  assert.equal(io.paint('x', 'bogus', true), 'x'); // unknown color → raw
});

// ── readInputSpec ─────────────────────────────────────────────────────────────────────────────────
test('readInputSpec: literal value passes through', () => {
  assert.equal(io.readInputSpec('一句话 DoD', {}), '一句话 DoD');
  assert.equal(io.readInputSpec('plain', {}), 'plain');
});

test('readInputSpec: @file reads file content', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ccm-io-'));
  try {
    const f = join(dir, 'payload.json');
    writeFileSync(f, '{"k":1}', 'utf8');
    assert.equal(io.readInputSpec(`@${f}`, {}), '{"k":1}');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('readInputSpec: lone "@" with no path is treated as literal (not a file read)', () => {
  assert.equal(io.readInputSpec('@', {}), '@');
});

// ── writeFileAtomicSync ───────────────────────────────────────────────────────────────────────────
test('writeFileAtomicSync: writes full content and leaves no temp residue', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ccm-atomic-'));
  try {
    const target = join(dir, 'board.json');
    const payload = `${JSON.stringify({ schema: 'cc-master/v2', tasks: [] })}\n`;
    io.writeFileAtomicSync(target, payload);
    // 内容完整。
    assert.equal(readFileSync(target, 'utf8'), payload);
    // 目录里只剩目标文件——无 .ccm-tmp-* 目录 / .tmp 残骸。
    const entries = readdirSync(dir);
    assert.deepEqual(
      entries,
      ['board.json'],
      `dir should hold only board.json, got ${JSON.stringify(entries)}`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('writeFileAtomicSync: overwrites existing file atomically', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ccm-atomic2-'));
  try {
    const target = join(dir, 'board.json');
    writeFileSync(target, 'OLD', 'utf8');
    io.writeFileAtomicSync(target, 'NEW-CONTENT');
    assert.equal(readFileSync(target, 'utf8'), 'NEW-CONTENT');
    assert.deepEqual(readdirSync(dir), ['board.json']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('writeFileAtomicSync: throws on bad dir and leaves no temp behind', () => {
  // 不存在的目录 → mkdtempSync 抛；不应在别处留残骸（异常即可，本测只验抛）。
  assert.throws(() => io.writeFileAtomicSync('/no/such/dir/deeply/board.json', 'x'));
});

// ── withBoardLock（引擎 withLock 薄包装·rewire 真链路）────────────────────────────────────────────
test('withBoardLock: runs fn under a board lock and returns its value', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ccm-lock-'));
  try {
    const board = join(dir, 'board.json');
    writeFileSync(board, '{}', 'utf8');
    const result = io.withBoardLock(board, () => 'inside-lock');
    assert.equal(result, 'inside-lock');
    // 锁应在 finally 释放——不留 .lock 文件。
    assert.equal(existsSync(`${board}.lock`), false, 'lock released after withBoardLock');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── jsonOk / jsonErr ──────────────────────────────────────────────────────────────────────────────
test('jsonOk: {ok:true,data}', () => {
  assert.equal(io.jsonOk({ a: 1 }), '{"ok":true,"data":{"a":1}}');
  assert.deepEqual(JSON.parse(io.jsonOk([1, 2])), { ok: true, data: [1, 2] });
});

test('jsonErr: {ok:false,exit,error,violations}; violations defaults to []', () => {
  assert.deepEqual(JSON.parse(io.jsonErr({ exit: 5, error: 'boom' })), {
    ok: false,
    exit: 5,
    error: 'boom',
    violations: [],
  });
  const v = [{ rule: 'GRAPH-CYCLE', level: 'hard', task: 'T1', message: 'cycle' }];
  assert.deepEqual(JSON.parse(io.jsonErr({ exit: 5, error: 'lint failed', violations: v })), {
    ok: false,
    exit: 5,
    error: 'lint failed',
    violations: v,
  });
});

// ── parseDuration ─────────────────────────────────────────────────────────────────────────────────
test('parseDuration: happy path h/m/d/w', () => {
  assert.deepEqual(io.parseDuration('3h'), { value: 3, unit: 'h' });
  assert.deepEqual(io.parseDuration('90m'), { value: 90, unit: 'm' });
  assert.deepEqual(io.parseDuration('2d'), { value: 2, unit: 'd' });
  assert.deepEqual(io.parseDuration('1w'), { value: 1, unit: 'w' });
  assert.deepEqual(io.parseDuration('1.5h'), { value: 1.5, unit: 'h' });
  assert.deepEqual(io.parseDuration(' 4d '), { value: 4, unit: 'd' }); // trims
});

test('parseDuration: bad input throws with .errKind="Usage"', () => {
  // 非字符串入参经 (str as never) 透传——验证 runtime 防御分支（原 JS 同 case）。
  const bads: unknown[] = [
    '',
    'h',
    '3',
    '3x',
    'abc',
    '3 hours',
    '-2h',
    '0h',
    '3hm',
    null,
    42,
    undefined,
  ];
  for (const bad of bads) {
    assert.throws(
      () => io.parseDuration(bad as never),
      (e: unknown) => {
        assert.equal(
          (e as { errKind?: string }).errKind,
          'Usage',
          `bad input ${JSON.stringify(bad)} → .errKind Usage`,
        );
        return true;
      },
      `parseDuration(${JSON.stringify(bad)}) should throw`,
    );
  }
});
