// io.ts — ccm CLI 运行时 IO 工具箱（退出码 · TTY/颜色闸 · 输入规格 · 原子写 · 锁包装 · JSON 壳 · 时长解析）。
//
// 定位（设计稿 §2/§4/§5 + 契约 §三 io.js）：把「与外界交换字节」的机制收口到一处——退出码 enum、
//   TTY 检测与 NO_COLOR/--no-color 优先级闸、`-`/`@file` 输入规格、tmp+fsync+rename 原子写、board-lock
//   的 withLock 薄包装、`--json` 统一壳（{ok:true,data} / {ok:false,exit,error,violations}）、`3h`/`2d`
//   时长解析。逻辑层只调这些纯/sync 函数，绝不自己 process.exit()（契约 §一.7：退出码只在 bin 设一次）。
//
// 红线1 / ADR-006：node/JS only，零 npm 依赖、纯 stdlib（fs + os + path）。
// 武装闸豁免：纯 helper 库（无 hook 入口，只被 CLI / 兄弟模块 import）——与 board-model / board-lock 同类。
//
// T2a port 注：原 CJS 源（io.js）的 require('fs'/'os'/'path') 换成 ESM node import；module.exports 换成
//   命名导出。引擎 rewire：原 require('./board-lock.js') 改成从 `@ccm/engine` import withLock。逻辑/数值/
//   正则/报错文案/.errKind 逐字保持。

import * as fs from 'node:fs';
import { durableWriteFileSync, type LockOptions, withLock } from '@ccm/engine';

// 带 .errKind / .kind 的 Error（router 据此映射退出码）。
interface KindedError extends Error {
  errKind?: string;
  kind?: string;
}

// ── EXIT：稳定退出码（设计稿 §4·agent 据码机器分支）─────────────────────────────────────────────
//   0 成功 / 1 未预期(兜底) / 2 用法错 / 3 校验拒绝(写入关卡牙齿:hard 不变式/非法转移) / 4 锁超时 / 5 找不到 active board(未武装/多板未消歧)。
//   注：本 enum 是 SSOT；router 用它把 handler throw 的 .errKind 映射成 exitCode（契约 §三 router）。
export const EXIT = {
  OK: 0,
  ERROR: 1,
  USAGE: 2,
  VALIDATION: 3,
  LOCKED: 4,
  NOT_FOUND: 5,
  AUTHORIZATION: 7,
} as const;

// ── isTTY：单流 TTY 判定（契约 §一.6·每流独立）。stream 缺 / 非 TTY → false。
export function isTTY(stream: { isTTY?: boolean } | null | undefined): boolean {
  return Boolean(stream && stream.isTTY);
}

// ── 基础色 SGR 码表（raw escape·不引 npm chalk）。enabled=false 时 paint 原样返回。
const SGR: Record<string, number> = {
  red: 31,
  green: 32,
  yellow: 33,
  cyan: 36,
  gray: 90,
  dim: 2,
};

// paint(s, color, enabled) → enabled 时包 SGR、否则原样（契约 §三 io.js）。未知色名当作 enabled=false 退原样。
export function paint(s: string, color: string, enabled: boolean): string {
  if (!enabled) return s;
  const code = SGR[color];
  if (code === undefined) return s;
  return `\x1b[${code}m${s}\x1b[0m`;
}

// resolveColor 入参（全部可选·防御性默认）。
interface ResolveColorArgs {
  stream?: { isTTY?: boolean } | null;
  argv?: string[];
  env?: Record<string, string | undefined>;
}

// ── resolveColor：颜色启用闸（契约 §一.6 优先级·从高到低）──────────────────────────────────────
//   ① env.NO_COLOR 存在且非空 → false（clig.dev / no-color.org 约定·最高优先）
//   ② argv 含 --no-color → false；含 --color → true（显式 flag 压过 env FORCE_COLOR 与 TTY）
//   ③ env.FORCE_COLOR：非 '0' → true；=== '0' → false
//   ④ env.TERM === 'dumb' → false
//   ⑤ 兜底：isTTY(stream)
//   说明：① 取「存在且非空」——`NO_COLOR=''` 视为未设（按 no-color.org「任何非空值即禁色」，空串不算）。
export function resolveColor({ stream, argv, env }: ResolveColorArgs = {}): boolean {
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
export function readInputSpec(spec: string, { stdin }: { stdin?: { fd?: number } } = {}): string {
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
function readStdinSync(stdin?: { fd?: number }): string {
  const fd = stdin && typeof stdin.fd === 'number' ? stdin.fd : 0;
  const chunks: Buffer[] = [];
  const buf = Buffer.alloc(65536);
  while (true) {
    let bytes: number;
    try {
      bytes = fs.readSync(fd, buf, 0, buf.length, null);
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err && err.code === 'EAGAIN') continue; // 非阻塞管道偶发 EAGAIN → 重试
      if (err && err.code === 'EOF') break; // 某些平台 EOF 抛错
      throw e;
    }
    if (bytes === 0) break;
    chunks.push(Buffer.from(buf.subarray(0, bytes)));
  }
  return Buffer.concat(chunks).toString('utf8');
}

// ── writeFileAtomicSync：兼容 facade（durability SSOT 在 @ccm/engine）────────────────────────────
//   保留 CLI 调用面，机制统一委托 durableWriteFileSync：target-adjacent 0600 temp → file fsync →
//   rename → directory fsync attempt。soft unsupported 可观测于底层结果；硬错抛出、绝不静默吞。
export function writeFileAtomicSync(filePath: string, data: string): void {
  durableWriteFileSync(filePath, typeof data === 'string' ? data : String(data));
}

// ── withBoardLock：board-lock.withLock 的薄包装（契约 §三·串行化写入防 torn-write）。
//   引擎 rewire：withLock 从 `@ccm/engine` 取（原 require('./board-lock.js')）。
export function withBoardLock<T>(boardPath: string, fn: () => T, opts?: LockOptions): T {
  return withLock(boardPath, fn, opts);
}

// ── JSON 输出统一壳（设计稿 §4·--json 形状只增不改）──────────────────────────────────────────────
// jsonOk(data) → '{"ok":true,"data":…}'。
export function jsonOk(data: unknown): string {
  return JSON.stringify({ ok: true, data });
}
// jsonErr({exit,error,violations?}) → '{"ok":false,"exit":N,"error":"…","violations":[…]}'。
export function jsonErr({
  exit,
  error,
  violations,
}: {
  exit?: number;
  error?: string;
  violations?: unknown[];
} = {}): string {
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
export function parseDuration(str: string): { value: number; unit: string } {
  if (typeof str !== 'string')
    throw _usageError(`时长须是字符串（如 "3h" "90m" "2d" "1w"），收到 ${typeof str}`);
  const m = _DURATION_RE.exec(str.trim());
  if (!m) {
    throw _usageError(
      `无法解析时长 ${JSON.stringify(str)}——格式须为 <数字><单位>，单位 ∈ {h,m,d,w}（如 "3h" "90m" "2d" "1w"）`,
    );
  }
  const value = Number(m[1]);
  if (!Number.isFinite(value) || value <= 0) {
    throw _usageError(`时长数值须为正（收到 ${JSON.stringify(str)}）`);
  }
  // m 非空时正则的两个捕获组必匹配·m[2] 为单位字符（as string 窄断言·不改逻辑）。
  return { value, unit: m[2] as string };
}

// _usageError：造一个带 .errKind='Usage' 的 Error（router 据 .errKind/.kind 映射退出码）。
function _usageError(msg: string): KindedError {
  const e = new Error(msg) as KindedError;
  e.errKind = 'Usage';
  e.kind = 'Usage';
  return e;
}
