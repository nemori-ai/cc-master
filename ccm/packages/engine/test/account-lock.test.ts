// account-lock.test.ts — @ccm/engine·account registry 锁原语（Phase 1 移植）契约门。
//   钉住：O_EXCL 独占 / owner-token compare-and-delete / livePid 存活判优先于 mtime / mtime 兜底 stale 回收 /
//   env CCM_REGISTRY_LOCK_TIMEOUT_MS·STALE_MS 覆写 / mutateRegistry 锁内 RMW + finally 释放。

import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { account } from '../dist/index.mjs';

const SCHEMA = 'cc-master/accounts/v1';

function tmpDir(): { dir: string; reg: string; lock: string } {
  const d = mkdtempSync(join(tmpdir(), 'ccm-lock-'));
  const reg = join(d, 'accounts.json');
  return { dir: d, reg, lock: `${reg}.lock` };
}

function backdate(p: string, secondsAgo: number): void {
  const t = new Date(Date.now() - secondsAgo * 1000);
  utimesSync(p, t, t);
}

// ── 基础：取/释放 + O_EXCL 互斥 ───────────────────────────────────────────────────
test('acquire creates a lockfile with non-secret meta; release removes it', () => {
  const { dir, reg, lock } = tmpDir();
  try {
    const h = account.acquireRegistryLock(reg, { timeoutMs: 500 });
    assert.ok(h.owner && h.path === lock);
    assert.ok(existsSync(lock));
    const meta = JSON.parse(readFileSync(lock, 'utf8'));
    assert.ok(
      typeof meta.pid === 'number' && typeof meta.owner === 'string' && typeof meta.at === 'string',
    );
    assert.ok(!('token' in meta), 'lock meta is token-blind');
    account.releaseRegistryLock(h);
    assert.ok(!existsSync(lock));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a held lock blocks a second acquire → timeout (opts.timeoutMs)', () => {
  const { dir, reg } = tmpDir();
  try {
    const h = account.acquireRegistryLock(reg, { timeoutMs: 500 });
    // 第二次取锁：持锁者是本进程（pid 存活）→ 永不 stale → 超时抛错。
    assert.throws(() => account.acquireRegistryLock(reg, { timeoutMs: 50 }), /取 registry 锁超时/);
    account.releaseRegistryLock(h);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── owner-token compare-and-delete ────────────────────────────────────────────────
test('release does NOT remove the lock if owner token changed (CAD guard)', () => {
  const { dir, reg, lock } = tmpDir();
  try {
    const h = account.acquireRegistryLock(reg, { timeoutMs: 500 });
    // 模拟「我被判 stale、别人抢了锁」：把 owner 改成别人。
    writeFileSync(
      lock,
      JSON.stringify({ pid: 1, at: '2026-06-25T00:00:00Z', owner: 'someone-else' }),
    );
    account.releaseRegistryLock(h);
    assert.ok(existsSync(lock), 'lock NOT deleted because owner mismatched');
    // 收尾：清掉那把「别人的」锁。
    rmSync(lock, { force: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── livePid 存活判优先于 mtime（活持有者绝不因老 mtime 被破）──────────────────────
test('stale: a DEAD pid lock is reclaimed (even with recent mtime)', () => {
  const { dir, reg, lock } = tmpDir();
  try {
    writeFileSync(lock, JSON.stringify({ pid: 999999, at: '2026-06-25T00:00:00Z', owner: 'dead' }));
    const h = account.acquireRegistryLock(reg, { timeoutMs: 500 });
    assert.ok(h.owner, 'dead-pid lock reclaimed → acquire succeeds');
    account.releaseRegistryLock(h);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('stale: a LIVE pid lock is NEVER reclaimed, even past staleMs (mtime ignored)', () => {
  const { dir, reg, lock } = tmpDir();
  try {
    // pid = 本进程（活），但 mtime 远超 staleMs。旧 mtime-only 逻辑会误破；新逻辑 pid-alive 优先 → 不破 → 超时。
    writeFileSync(
      lock,
      JSON.stringify({ pid: process.pid, at: '2020-01-01T00:00:00Z', owner: 'live' }),
    );
    backdate(lock, 9999);
    assert.throws(
      () => account.acquireRegistryLock(reg, { staleMs: 1, timeoutMs: 60 }),
      /取 registry 锁超时/,
      'live-pid lock survives old mtime',
    );
    rmSync(lock, { force: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('stale: an unreadable-pid lock falls back to mtime (old → reclaimed; recent → blocks)', () => {
  const { dir, reg, lock } = tmpDir();
  try {
    // 坏锁（无 pid）+ 老 mtime → mtime 兜底回收。
    writeFileSync(lock, 'garbage-not-json');
    backdate(lock, 9999);
    const h = account.acquireRegistryLock(reg, { staleMs: 1000, timeoutMs: 500 });
    assert.ok(h.owner, 'bad-pid + old mtime → reclaimed');
    account.releaseRegistryLock(h);

    // 坏锁（无 pid）+ 新 mtime → 不 stale → 超时。
    writeFileSync(lock, 'garbage-not-json');
    assert.throws(
      () => account.acquireRegistryLock(reg, { staleMs: 100000, timeoutMs: 60 }),
      /取 registry 锁超时/,
    );
    rmSync(lock, { force: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── env 覆写 ──────────────────────────────────────────────────────────────────────
test('env CCM_REGISTRY_LOCK_TIMEOUT_MS overrides default timeout', () => {
  const { dir, reg, lock } = tmpDir();
  const prev = process.env.CCM_REGISTRY_LOCK_TIMEOUT_MS;
  try {
    // 占住锁（活 pid·不会被回收）。
    writeFileSync(
      lock,
      JSON.stringify({ pid: process.pid, at: '2026-06-25T00:00:00Z', owner: 'held' }),
    );
    process.env.CCM_REGISTRY_LOCK_TIMEOUT_MS = '40';
    const t0 = Date.now();
    assert.throws(() => account.acquireRegistryLock(reg), /取 registry 锁超时（40ms）/);
    assert.ok(Date.now() - t0 < 2000, 'env timeout honored (fast fail)');
    rmSync(lock, { force: true });
  } finally {
    if (prev === undefined) delete process.env.CCM_REGISTRY_LOCK_TIMEOUT_MS;
    else process.env.CCM_REGISTRY_LOCK_TIMEOUT_MS = prev;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('env CCM_REGISTRY_LOCK_STALE_MS overrides stale window (unreadable-pid path)', () => {
  const { dir, reg, lock } = tmpDir();
  const prev = process.env.CCM_REGISTRY_LOCK_STALE_MS;
  try {
    writeFileSync(lock, 'garbage'); // 无 pid → 走 mtime 兜底。
    backdate(lock, 5); // 5s 前。
    process.env.CCM_REGISTRY_LOCK_STALE_MS = '1000'; // staleMs=1s < 5s → 视作 stale → 回收。
    const h = account.acquireRegistryLock(reg, { timeoutMs: 500 });
    assert.ok(h.owner, 'env stale window applied → reclaimed');
    account.releaseRegistryLock(h);
  } finally {
    if (prev === undefined) delete process.env.CCM_REGISTRY_LOCK_STALE_MS;
    else process.env.CCM_REGISTRY_LOCK_STALE_MS = prev;
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── acquireFileLock/releaseFileLock 别名 ──────────────────────────────────────────
test('acquireFileLock/releaseFileLock alias the registry lock primitive', () => {
  const { dir } = tmpDir();
  const target = join(dir, 'accounts.env');
  try {
    const h = account.acquireFileLock(target, { timeoutMs: 500 });
    assert.ok(existsSync(`${target}.lock`));
    account.releaseFileLock(h);
    assert.ok(!existsSync(`${target}.lock`));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── mutateRegistry：锁内 load→mutate→save + finally 释放 ──────────────────────────
test('mutateRegistry: runs load→mutate→save under lock; lock released after', () => {
  const { dir, reg, lock } = tmpDir();
  try {
    account.saveRegistry({ schema: SCHEMA, accounts: {} }, reg);
    const out = account.mutateRegistry(reg, (r) => {
      account.upsertAccount(r, 'a@x.com', {
        vault: { kind: 'keychain', service: 's', account: 'a@x.com' },
      });
    });
    assert.equal(out, reg);
    assert.ok(!existsSync(lock), 'lock released after mutate');
    const saved = account.loadRegistry(reg);
    assert.ok('a@x.com' in saved.accounts);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('mutateRegistry: releases the lock even when the mutator throws', () => {
  const { dir, reg, lock } = tmpDir();
  try {
    account.saveRegistry({ schema: SCHEMA, accounts: {} }, reg);
    assert.throws(
      () =>
        account.mutateRegistry(reg, () => {
          throw new Error('boom');
        }),
      /boom/,
    );
    assert.ok(!existsSync(lock), 'lock released in finally even on throw');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
