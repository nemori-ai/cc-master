'use strict';
// board-lock.js — board 写入并发保护（轻量 advisory 文件锁·ADR-013 §2.5）。
//
// board 的唯一写入关卡是 CLI（ADR-013 §2.3）。多写者并发（极少见——现实几乎无 human 手写，但 agent + human
//   理论上能撞）经这把锁串行化，防 torn-write。设计原则：**轻，不重**（用户明确「不要过度设计、不要实现成
//   非常重的」）——一把 advisory 文件锁（O_EXCL 原子创建 + 简单 stale 处理），不引入重型锁服务/守护进程。
//
// 红线1 / ADR-006：node/JS only，零 npm 依赖、纯 stdlib（fs + crypto）。
// 红线2：本文件**不碰 board 内容**——只管「能不能写」这把闸，board 的读写在 CLI 里做。
// 武装闸豁免：纯 helper 库（无 hook 入口，只被 CLI require）——与 board-model / board-graph-core 同类，
//   永不作为 hook 入口被 Claude Code 调用，故无需自带 arming gate（见 AGENTS.md §3 红线6 / §12 grep 门豁免）。
//
// 机制：lockfile = `<board>.lock`，用 fs.openSync(path,'wx')（O_CREAT|O_EXCL·原子）抢占——存在即 EEXIST = 被占。
//   占住者把 {token, pid, ts} 写进去；release 只在 token 匹配时删（advisory 归属，防误删别人的锁）。
//   stale 处理：EEXIST 时读已有锁，若 now-ts 超过 staleMs（默认 30s，远长于一次 CLI 写）→ 视为崩溃遗留、偷锁重试。
//   sync sleep 用 Atomics.wait（零 spawn·不 busy-spin·CLI 同步语境适用）。

const fs = require('fs');
const crypto = require('crypto');

const DEFAULTS = { staleMs: 30000, retries: 50, retryMs: 100 };

// lockPathFor(boardPath) → 锁文件路径。
function lockPathFor(boardPath) { return `${boardPath}.lock`; }

// 同步 sleep（无 spawn、不 busy-spin）：Atomics.wait 阻塞当前线程 ms 毫秒。
function sleepSync(ms) {
  if (!(ms > 0)) return;
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch (_) {
    // 极端环境无 SharedArrayBuffer 时退化为短忙等（仅作兜底，正常路径不走）。
    const end = Date.now() + ms;
    while (Date.now() < end) { /* spin */ }
  }
}

// 读已有锁的 meta（{token,pid,ts}），坏/缺 → null。
function readLockMeta(lockPath) {
  try {
    const raw = fs.readFileSync(lockPath, 'utf8');
    const m = JSON.parse(raw);
    return (m && typeof m === 'object' && !Array.isArray(m)) ? m : null;
  } catch (_) { return null; }
}

// acquire(boardPath, opts) → token（成功）或抛 Error('LOCK_TIMEOUT: …')（超过 retries 仍占用）。
function acquire(boardPath, opts = {}) {
  const { staleMs, retries, retryMs } = { ...DEFAULTS, ...opts };
  const lockPath = lockPathFor(boardPath);
  const token = `${process.pid}:${crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex')}`;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const fd = fs.openSync(lockPath, 'wx'); // O_CREAT|O_EXCL：原子抢占，存在即抛 EEXIST
      try {
        fs.writeFileSync(fd, JSON.stringify({ token, pid: process.pid, ts: Date.now() }));
      } finally {
        fs.closeSync(fd);
      }
      return token;
    } catch (e) {
      if (!e || e.code !== 'EEXIST') throw e; // 非「被占」错误（权限/路径）→ 直接抛
      // 被占：检查是否 stale（崩溃遗留）。stale → 偷锁（unlink）后立即重试，不耗 retry 配额。
      const meta = readLockMeta(lockPath);
      const ts = meta && Number.isFinite(meta.ts) ? meta.ts : null;
      if (ts == null || (Date.now() - ts) > staleMs) {
        try { fs.unlinkSync(lockPath); } catch (_) { /* 已被别人清/偷，继续重试 */ }
        continue;
      }
      if (attempt < retries) sleepSync(retryMs);
    }
  }
  throw new Error(`LOCK_TIMEOUT: ${lockPath} 被占用超过 ${retries} 次重试（可能另一个写者在写，或锁未被释放——必要时手动删 .lock）`);
}

// release(boardPath, token) → true（删了我们自己的锁）/ false（不是我们的锁 或 已不存在·advisory 归属保护）。
function release(boardPath, token) {
  const lockPath = lockPathFor(boardPath);
  const meta = readLockMeta(lockPath);
  if (!meta) return false;            // 锁不存在/坏 → 没东西可释放
  if (meta.token !== token) return false; // 不是我们的锁 → 不删（防误删别人的）
  try { fs.unlinkSync(lockPath); return true; } catch (_) { return false; }
}

// withLock(boardPath, fn, opts) → 跑 fn 并在 finally 里释放（即便 fn 抛也释放）。返回 fn 的返回值。
function withLock(boardPath, fn, opts = {}) {
  const token = acquire(boardPath, opts);
  try {
    return fn();
  } finally {
    release(boardPath, token);
  }
}

// isLocked(boardPath) → 当前是否被占（best-effort：存在且未 stale）。
function isLocked(boardPath, opts = {}) {
  const { staleMs } = { ...DEFAULTS, ...opts };
  const lockPath = lockPathFor(boardPath);
  if (!fs.existsSync(lockPath)) return false;
  const meta = readLockMeta(lockPath);
  const ts = meta && Number.isFinite(meta.ts) ? meta.ts : null;
  if (ts == null) return true; // 锁在但 meta 坏 → 保守当占用
  return (Date.now() - ts) <= staleMs;
}

module.exports = { acquire, release, withLock, isLocked, lockPathFor };
