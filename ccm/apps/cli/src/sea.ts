// sea.ts — Node SEA（Single Executable Application）自包含可执行入口（T3·ADR-014 分发形态）。
//
// 定位：与 bin/ccm.cjs 等价的**可执行**入口，但形态适配 SEA——
//   bin/ccm.cjs 是「薄壳 + require('../dist/index.cjs')」，相对 require 在 SEA blob 内无法解析；
//   本文件从 production-run 导入入口，让 tsdown 把 router + handlers + registry + io + @ccm/engine
//   全内联进单 CJS bundle（dist/ccm-sea.cjs），顶层直接执行 CLI、设退出码、装进程安全网——单文件自包含。
//
// 与 bin/ccm.cjs 的行为契约逐字对齐（epipeBomb / uncaught nets / 退出码纪律 / 注入流 / stdin fd:0）：
//   · epipeBomb：吞 stdout/stderr 的 EPIPE（`ccm board show --json | head` 下游早关管道不崩）。
//   · uncaughtException / unhandledRejection 安全网：吐 stderr + 非零退出（绝不静默吞）。
//   · 全文件唯一一处设 process.exitCode（run 返回码）；唯一可 process.exit 的地方只在 uncaught 安全网里
//     （契约 §一.7：逻辑层绝不 process.exit，退出码只在入口设一次）。
//   · out=(s)=>stdout.write(s+'\n')、err=(s)=>stderr.write(s+'\n')；out 挂 _stream 供 router.io.resolveColor
//     探测 isTTY；stdin: { fd: 0 }（io.readStdinSync 直读 fd 0）。
//
// 红线1 / ADR-006：node/JS only，零 npm 依赖、纯 stdlib。tsdown format:cjs（SEA 嵌 CJS bundle）。
// 武装闸豁免：纯 CLI 入口（无 hook 入口，只被 SEA 二进制顶层执行）——见 AGENTS.md §3 红线6 / §12 grep 门豁免。
//
// 版本号：SEA blob 内 __dirname 不指向 apps/cli/，help._readVersion 的相对 package.json 读会落空 → '0.0.0'。
//   故构建期由 tsdown `define` 把 __CCM_SEA_VERSION__ 注入到 process.env.CCM_VERSION（help._readVersion 优先读它）。
//   非 SEA 路径（bin/ccm.cjs）不经本文件、不设该 env，行为不变。

import { runProduction } from './production-run.js';

// 构建期注入的版本号（tsdown define：__CCM_SEA_VERSION__ → JSON 字面量字符串）。
// 若构建未注入（直跑本文件）则为 undefined，help._readVersion 退回原 fs 逻辑。
declare const __CCM_SEA_VERSION__: string | undefined;
const _injectedVersion =
  typeof __CCM_SEA_VERSION__ === 'string' && __CCM_SEA_VERSION__ ? __CCM_SEA_VERSION__ : '';
if (_injectedVersion && !process.env.CCM_VERSION) {
  process.env.CCM_VERSION = _injectedVersion;
}

// ── epipeBomb：在 stdout/stderr 上吞 EPIPE（下游管道早关时不抛未捕获错）。──────────────────────────────
function installEpipeBomb(stream: NodeJS.WriteStream | undefined, onPipeBreak: () => void): void {
  if (!stream || typeof stream.on !== 'function') return;
  stream.on('error', (err: NodeJS.ErrnoException) => {
    if (err && err.code === 'EPIPE') {
      onPipeBreak();
      return;
    }
    throw err;
  });
}

let _exiting = false;
function gracefulPipeExit(): void {
  if (_exiting) return;
  _exiting = true;
  try {
    process.exit(0);
  } catch (_e) {
    /* noop */
  }
}

installEpipeBomb(process.stdout, gracefulPipeExit);
installEpipeBomb(process.stderr, gracefulPipeExit);

// ── uncaughtException / unhandledRejection 安全网：吐 stderr + 非零退出。────────────────────────────────
process.on('uncaughtException', (err: NodeJS.ErrnoException) => {
  if (err && err.code === 'EPIPE') {
    gracefulPipeExit();
    return;
  }
  try {
    process.stderr.write(`fatal: ${(err && err.stack) || String(err)}\n`);
  } catch (_e) {
    /* noop */
  }
  process.exit(1); // 安全网内允许 process.exit（唯一例外·契约 §一.7）
});
process.on('unhandledRejection', (reason: unknown) => {
  try {
    const r = reason as { stack?: string } | undefined;
    process.stderr.write(`fatal (unhandled rejection): ${(r && r.stack) || String(reason)}\n`);
  } catch (_e) {
    /* noop */
  }
  process.exit(1);
});

// ── 注入流 + 跑 run。──────────────────────────────────────────────────────────────────────────────
const out = ((s: string) => process.stdout.write(`${s}\n`)) as ((s: string) => void) & {
  _stream?: NodeJS.WriteStream;
};
out._stream = process.stdout; // 供 run → io.resolveColor 探测 isTTY（数据流 = stdout）。
const err = (s: string) => process.stderr.write(`${s}\n`);

// 全文件唯一一处设 process.exitCode（run 返回码）。stdin: { fd: 0 }（io.readStdinSync 直读 fd 0）。
//   sync verb 同步落码（字节级不变）；`account switch` 唯一 async（Promise<number>）→ await 后落码（同 bin/ccm.cjs）。
const _result = runProduction(process.argv.slice(2), {
  out,
  err,
  env: process.env,
  stdin: { fd: 0 },
});
if (_result && typeof (_result as { then?: unknown }).then === 'function') {
  (_result as Promise<number>).then(
    (code) => {
      process.exitCode = typeof code === 'number' ? code : 0;
    },
    (e) => {
      try {
        process.stderr.write(`fatal: ${(e && (e as Error).stack) || String(e)}\n`);
      } catch (_e) {
        /* noop */
      }
      process.exitCode = 1;
    },
  );
} else {
  process.exitCode = _result as number;
}
