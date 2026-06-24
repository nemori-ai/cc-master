// board-lock.test.ts — @ccm/engine·board 写入并发保护（轻量 advisory 文件锁）契约门。
//   T1 port：从 cli/test/unit/board-lock.test.mjs 移植，CJS createRequire 加载改为对 ported TS 源的 ESM import。

import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
// 测 build 后的 dist 公开 API barrel（见 board-model.test.ts 注：源 NodeNext `.js` specifier 直跑解析不了）。
import * as lock from '../dist/index.mjs';

function tmpBoard() {
  const d = mkdtempSync(join(tmpdir(), 'ccm-lock-'));
  return { dir: d, board: join(d, 'x.board.json') };
}

test('exposes acquire/release/withLock/lockPathFor/isLocked', () => {
  assert.equal(typeof lock.acquire, 'function', 'board-lock exports acquire');
  assert.equal(typeof lock.release, 'function', 'board-lock exports release');
  assert.equal(typeof lock.withLock, 'function', 'board-lock exports withLock');
  assert.equal(typeof lock.lockPathFor, 'function', 'board-lock exports lockPathFor');
  assert.equal(typeof lock.isLocked, 'function', 'board-lock exports isLocked');
});

test('lockPathFor: <board>.lock', () => {
  assert.equal(lock.lockPathFor('/a/b/x.board.json'), '/a/b/x.board.json.lock');
});

test('acquire returns a token + creates the lockfile; release removes it', () => {
  const { dir, board } = tmpBoard();
  try {
    const tok = lock.acquire(board, { retries: 2, retryMs: 10 });
    assert.ok(typeof tok === 'string' && tok.length > 0, 'acquire returns a non-empty token');
    assert.ok(existsSync(lock.lockPathFor(board)), 'lockfile exists while held');
    assert.equal(lock.isLocked(board), true);
    assert.equal(lock.release(board, tok), true, 'release ours → true');
    assert.ok(!existsSync(lock.lockPathFor(board)), 'lockfile gone after release');
    assert.equal(lock.isLocked(board), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a held lock blocks a second acquire → LOCK_TIMEOUT (bounded retries)', () => {
  const { dir, board } = tmpBoard();
  try {
    const tok = lock.acquire(board, { retries: 2, retryMs: 5 });
    assert.throws(() => lock.acquire(board, { retries: 1, retryMs: 5 }), /LOCK_TIMEOUT/);
    lock.release(board, tok);
    // released → next acquire succeeds.
    const tok2 = lock.acquire(board, { retries: 2, retryMs: 5 });
    assert.ok(tok2);
    lock.release(board, tok2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('release with a wrong token does NOT remove the lock (advisory ownership)', () => {
  const { dir, board } = tmpBoard();
  try {
    const tok = lock.acquire(board, { retries: 2, retryMs: 5 });
    assert.equal(lock.release(board, 'not-mine'), false, 'wrong token → false');
    assert.ok(existsSync(lock.lockPathFor(board)), 'lock still held after wrong-token release');
    lock.release(board, tok);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a STALE lock (mtime older than staleMs) is stolen, not deadlocked', () => {
  const { dir, board } = tmpBoard();
  try {
    // 手工写一个「很久以前」的锁（模拟崩溃遗留的死锁）。
    writeFileSync(
      lock.lockPathFor(board),
      JSON.stringify({ token: 'old', pid: 999999, ts: Date.now() - 10 * 60 * 1000 }),
    );
    const tok = lock.acquire(board, { staleMs: 1000, retries: 3, retryMs: 5 });
    assert.ok(tok, 'stale lock stolen → acquire succeeds');
    lock.release(board, tok);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('withLock runs fn and releases even when fn throws', () => {
  const { dir, board } = tmpBoard();
  try {
    const out = lock.withLock(board, () => 42, { retries: 2, retryMs: 5 });
    assert.equal(out, 42);
    assert.ok(!existsSync(lock.lockPathFor(board)), 'released after success');
    assert.throws(
      () =>
        lock.withLock(
          board,
          () => {
            throw new Error('boom');
          },
          { retries: 2, retryMs: 5 },
        ),
      /boom/,
    );
    assert.ok(!existsSync(lock.lockPathFor(board)), 'released even after fn throws (finally)');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
