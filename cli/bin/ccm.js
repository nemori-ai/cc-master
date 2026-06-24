#!/usr/bin/env node
'use strict';
// bin/ccm.js — ccm CLI 薄入口（P5.3·契约 §三 bin/ccm.js / §一.7 退出码纪律）。
//
// 唯一职责：装好「进程安全网」后把 process.argv 交给 router.run，并把它的返回码落到 process.exitCode。
//   · epipeBomb：吞 stdout/stderr 的 EPIPE——`ccm board show --json | head` 下游早关管道时不让进程崩。
//   · uncaughtException / unhandledRejection 安全网：把未捕获错误吐到 stderr + 非零退出（绝不静默吞）。
//   · out/err 注入流：out=(s)=>stdout.write(s+'\n')、err=(s)=>stderr.write(s+'\n')；给 out 挂 _stream 供
//     router 的 io.resolveColor 探测 isTTY。
//
// 全文件**仅此一处设 process.exitCode**（router 返回码），**唯一可 process.exit 的地方只在 uncaught 安全网里**
//   （契约 §一.7：逻辑层绝不 process.exit，退出码只在 bin 设一次）。
//
// 红线1 / ADR-006：node/JS only，零 npm 依赖、纯 stdlib。CommonJS（cli/package.json 不写 "type"）。

// ── epipeBomb：在 stdout/stderr 上吞 EPIPE（下游管道早关时不抛未捕获错）。──────────────────────────────
//   纯 stdlib 复刻 epipebomb 包：把 stream 的 'error' EPIPE 拦下，并在写出错时静默退出（管道断 = 正常终止）。
function installEpipeBomb(stream, onPipeBreak) {
  if (!stream || typeof stream.on !== 'function') return;
  stream.on('error', (err) => {
    if (err && err.code === 'EPIPE') {
      // 下游关了管道：静默、按正常终止处理（不打印、退出码 0——典型如 `| head`）。
      onPipeBreak();
      return;
    }
    // 非 EPIPE 的流错误：重抛给 uncaughtException 安全网处理。
    throw err;
  });
}

let _exiting = false;
function gracefulPipeExit() {
  if (_exiting) return;
  _exiting = true;
  // 管道断开是正常终止；用 process.exit(0) 立即收场（避免后续写继续抛 EPIPE）。
  try { process.exit(0); } catch (_) { /* noop */ }
}

installEpipeBomb(process.stdout, gracefulPipeExit);
installEpipeBomb(process.stderr, gracefulPipeExit);

// ── uncaughtException / unhandledRejection 安全网：吐 stderr + 非零退出。────────────────────────────────
process.on('uncaughtException', (err) => {
  if (err && err.code === 'EPIPE') { gracefulPipeExit(); return; }
  try { process.stderr.write('fatal: ' + ((err && err.stack) || String(err)) + '\n'); } catch (_) {}
  process.exit(1); // 安全网内允许 process.exit（唯一例外·契约 §一.7）
});
process.on('unhandledRejection', (reason) => {
  try { process.stderr.write('fatal (unhandled rejection): ' + ((reason && reason.stack) || String(reason)) + '\n'); } catch (_) {}
  process.exit(1);
});

// ── 注入流 + 跑 router。────────────────────────────────────────────────────────────────────────────
const out = (s) => process.stdout.write(s + '\n');
out._stream = process.stdout; // 供 router → io.resolveColor 探测 isTTY（数据流 = stdout）。
const err = (s) => process.stderr.write(s + '\n');

const router = require('../src/router.js');

// 全文件唯一一处设 process.exitCode（router 返回码）。stdin: 0 = fd-0（io.readStdinSync 直读 fd 0）。
process.exitCode = router.run(process.argv.slice(2), {
  out,
  err,
  env: process.env,
  stdin: 0,
});
