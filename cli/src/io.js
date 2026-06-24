'use strict';
// io.js — ccm CLI 运行时 IO 工具箱（退出码 · TTY/颜色闸 · 输入规格 · 原子写 · 锁包装 · JSON 壳 · 时长解析）。
//
// 定位（设计稿 §2/§4/§5 + 契约 §三 io.js）：把「与外界交换字节」的机制收口到一处——退出码 enum、
//   TTY 检测与 NO_COLOR/--no-color 优先级闸、`-`/`@file` 输入规格、tmp+fsync+rename 原子写、board-lock
//   的 withLock 薄包装、`--json` 统一壳（{ok:true,data} / {ok:false,exit,error,violations}）、`3h`/`2d`
//   时长解析。逻辑层只调这些纯/sync 函数，绝不自己 process.exit()（契约 §一.7：退出码只在 bin 设一次）。
//
// 红线1 / ADR-006：node/JS only，零 npm 依赖、纯 stdlib（fs + os + path）。
// 武装闸豁免：纯 helper 库（无 hook 入口，只被 CLI / 兄弟模块 require）——与 board-model / board-lock 同类，
//   永不作为 hook 入口被 Claude Code 调用，故无需自带 arming gate（见 AGENTS.md §3 红线6 / §12 grep 门豁免）。

const fs = require('fs');
const os = require('os');
const path = require('path');

// ── EXIT：稳定退出码（设计稿 §4·agent 据码机器分支）─────────────────────────────────────────────
//   0 成功 / 1 未预期(兜底) / 2 用法错 / 3 校验拒绝(写入关卡牙齿:hard 不变式/非法转移) / 4 锁超时 / 5 找不到 active board(未武装/多板未消歧)。
//   注：本 enum 是 SSOT；router 用它把 handler throw 的 .errKind 映射成 exitCode（契约 §三 router）。
const EXIT = {
  OK: 0,
  ERROR: 1,
  USAGE: 2,
  VALIDATION: 3,
  LOCKED: 4,
  NOT_FOUND: 5,
};

// ── isTTY：单流 TTY 判定（契约 §一.6·每流独立）。stream 缺 / 非 TTY → false。
function isTTY(stream) {
  return Boolean(stream && stream.isTTY);
}

// ── 基础色 SGR 码表（raw escape·不引 npm chalk）。enabled=false 时 paint 原样返回。
const SGR = {
  red: 31,
  green: 32,
  yellow: 33,
  cyan: 36,
  gray: 90,
  dim: 2,
};

// paint(s, color, enabled) → enabled 时包 SGR、否则原样（契约 §三 io.js）。未知色名当作 enabled=false 退原样。
function paint(s, color, enabled) {
  if (!enabled) return s;
  const code = SGR[color];
  if (code === undefined) return s;
  return `\x1b[${code}m${s}\x1b[0m`;
}

// ── resolveColor：颜色启用闸（契约 §一.6 优先级·从高到低）──────────────────────────────────────
//   ① env.NO_COLOR 存在且非空 → false（clig.dev / no-color.org 约定·最高优先）
//   ② argv 含 --no-color → false；含 --color → true（显式 flag 压过 env FORCE_COLOR 与 TTY）
//   ③ env.FORCE_COLOR：非 '0' → true；=== '0' → false
//   ④ env.TERM === 'dumb' → false
//   ⑤ 兜底：isTTY(stream)
//   说明：① 取「存在且非空」——`NO_COLOR=''` 视为未设（按 no-color.org「任何非空值即禁色」，空串不算）。
function resolveColor({ stream, argv, env } = {}) {
  const e = env || {};
  // ① NO_COLOR 非空 → 禁色（最高优先）。
  if (e.NO_COLOR !== undefined && e.NO_COLOR !== '') return false;
  // ② 显式 flag。
  const args = Array.isArray(argv) ? argv : [];
  if (args.includes('--no-color')) return false;
  if (args.includes('--color')) return true;
  // ③ FORCE_COLOR。
  if (e.FORCE_COLOR !== undefined) return e.FORCE_COLOR !== '0';
  // ④ dumb 终端。
  if (e.TERM === 'dumb') return false;
  // ⑤ 兜底 TTY。
  return isTTY(stream);
}

// ── readInputSpec：输入规格解析（契约 §三 io.js）───────────────────────────────────────────────
//   '-'        → 读 stdin（fd-0 readSync 循环，直到 EOF）
//   '@/path'   → readFileSync(spec.slice(1))（'@' 前缀 = 从文件读）
//   其余       → 返回字面量（spec 本身就是值，如 `--accept '一句话'`）
//   注：纯 '@' 无路径 → 当字面量（slice 后空串 readFile 会抛，故守住当字面量更友好）。
function readInputSpec(spec, { stdin } = {}) {
  if (spec === '-') {
    return readStdinSync(stdin);
  }
  if (typeof spec === 'string' && spec.length > 1 && spec[0] === '@') {
    return fs.readFileSync(spec.slice(1), 'utf8');
  }
  return spec;
}

// readStdinSync：从 fd-0 同步读到 EOF（CLI 同步语境·不引 async）。stdin 形参仅为可测注入；
//   实际读取走 fd 0（process.stdin 在 sync 路径不可靠，clig/node 惯例直读 fd 0）。
function readStdinSync(stdin) {
  const fd = stdin && typeof stdin.fd === 'number' ? stdin.fd : 0;
  const chunks = [];
  const buf = Buffer.alloc(65536);
  while (true) {
    let bytes;
    try {
      bytes = fs.readSync(fd, buf, 0, buf.length, null);
    } catch (e) {
      if (e && e.code === 'EAGAIN') continue; // 非阻塞管道偶发 EAGAIN → 重试
      if (e && e.code === 'EOF') break;        // 某些平台 EOF 抛错
      throw e;
    }
    if (bytes === 0) break;
    chunks.push(Buffer.from(buf.subarray(0, bytes)));
  }
  return Buffer.concat(chunks).toString('utf8');
}

// ── writeFileAtomicSync：原子写（契约 §一.8 / §三）──────────────────────────────────────────────
//   同目录 mkdtemp → temp 文件 openSync/writeSync/fsyncSync/closeSync → renameSync（POSIX 原子）
//   → best-effort dir fsync（落元数据）。任一步失败 → unlinkSync 清 temp 再 throw（不留半截文件）。
//   同目录建 temp 避免跨设备 rename 的 EXDEV。
function writeFileAtomicSync(filePath, data) {
  const dir = path.dirname(filePath);
  let tmpDir = null;
  let tmpFile = null;
  let fd = null;
  try {
    tmpDir = fs.mkdtempSync(path.join(dir, '.ccm-tmp-'));
    tmpFile = path.join(tmpDir, 'board.tmp');
    fd = fs.openSync(tmpFile, 'w');
    fs.writeSync(fd, typeof data === 'string' ? data : String(data));
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;
    fs.renameSync(tmpFile, filePath);
    tmpFile = null;
    // best-effort 目录 fsync（落 rename 的目录项；部分平台 dir 不可 fsync → 吞）。
    try {
      const dfd = fs.openSync(dir, 'r');
      try { fs.fsyncSync(dfd); } finally { fs.closeSync(dfd); }
    } catch (_) { /* 目录 fsync 非关键，best-effort */ }
  } catch (e) {
    // 失败清理：关 fd、删半截 temp 文件、删 temp 目录，再抛原错。
    if (fd !== null) { try { fs.closeSync(fd); } catch (_) {} }
    if (tmpFile) { try { fs.unlinkSync(tmpFile); } catch (_) {} }
    throw e;
  } finally {
    // 成功路径下 temp 文件已被 rename 走，只剩空 temp 目录待清；失败路径上面已删 temp 文件。
    if (tmpDir) { try { fs.rmdirSync(tmpDir); } catch (_) {} }
  }
}

// ── withBoardLock：board-lock.withLock 的薄包装（契约 §三·串行化写入防 torn-write）。
function withBoardLock(boardPath, fn, opts) {
  const lock = require('./board-lock.js');
  return lock.withLock(boardPath, fn, opts);
}

// ── JSON 输出统一壳（设计稿 §4·--json 形状只增不改）──────────────────────────────────────────────
// jsonOk(data) → '{"ok":true,"data":…}'。
function jsonOk(data) {
  return JSON.stringify({ ok: true, data });
}
// jsonErr({exit,error,violations?}) → '{"ok":false,"exit":N,"error":"…","violations":[…]}'。
function jsonErr({ exit, error, violations } = {}) {
  return JSON.stringify({
    ok: false,
    exit,
    error,
    violations: violations || [],
  });
}

// ── parseDuration：'3h'/'90m'/'2d'/'1w' → {value:Number, unit}（契约 §三）──────────────────────────
//   单位 h(小时)/m(分)/d(天)/w(周)；value 须为正整数或正小数；坏 → throw 带 .errKind='Usage'（router 映射 exit 2）。
const _DURATION_RE = /^(\d+(?:\.\d+)?)\s*([hmdw])$/;
function parseDuration(str) {
  if (typeof str !== 'string') throw _usageError(`时长须是字符串（如 "3h" "90m" "2d" "1w"），收到 ${typeof str}`);
  const m = _DURATION_RE.exec(str.trim());
  if (!m) {
    throw _usageError(`无法解析时长 ${JSON.stringify(str)}——格式须为 <数字><单位>，单位 ∈ {h,m,d,w}（如 "3h" "90m" "2d" "1w"）`);
  }
  const value = Number(m[1]);
  if (!Number.isFinite(value) || value <= 0) {
    throw _usageError(`时长数值须为正（收到 ${JSON.stringify(str)}）`);
  }
  return { value, unit: m[2] };
}

// _usageError：造一个带 .errKind='Usage' 的 Error（router 据 .errKind/.kind 映射退出码）。
function _usageError(msg) {
  const e = new Error(msg);
  e.errKind = 'Usage';
  e.kind = 'Usage';
  return e;
}

module.exports = {
  EXIT,
  isTTY,
  resolveColor,
  paint,
  readInputSpec,
  writeFileAtomicSync,
  withBoardLock,
  jsonOk,
  jsonErr,
  parseDuration,
};
