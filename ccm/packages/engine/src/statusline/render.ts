// statusline/render.ts — 把 status-line stdin JSON 渲染成单行 ANSI 状态行（self-contained status line·0.10.0）。
//
// 这是 `ccm statusline`（status-line 命令本身）的渲染核心：吃官方喂给 status-line 脚本的 JSON（schema 见下），
//   产一行 `ctx ████████░░ 78%   5h 64%   7d 14%`——context 进度条（10 格）+ 5h/7d 配额用量，**按阈值变色**。
//
// 权威 schema（statusline-setup agent 确证）：
//   · context_window.used_percentage   0–100·**首条消息前为 null**（此时 ctx 段优雅省略）
//   · context_window.context_window_size  token（当前未直接渲染·留作扩展）
//   · rate_limits.five_hour.{used_percentage(0–100), resets_at(epoch 秒)}   均 Optional（非 Pro/Max 或窗口未现 → 缺席）
//   · rate_limits.seven_day.{...}                                            同上
//   · rate_limits.model_scoped[] → { display_name, utilization, resets_at }  独立模型周窗（Fable 5 等·additive）
//   · model.display_name / workspace.current_dir
//   **无 cost 字段。**
//
// 阈值变色（绿/黄/红·ANSI）:
//   · context  绿 <60 · 黄 60–85 · 红 >85
//   · 5h       绿 <70 · 黄 70–90 · 红 >90
//   · 7d       绿 <70 · 黄 70–85 · 红 >85
//
// 铁律（status-line 绝不污染 UI）：任何缺字段 / 非数值的段**优雅省略**；renderStatusline 自身不抛
//   （坏输入 → 尽力渲染已有段，全缺 → 返回空串）。调用方（handler）再把任何异常兜成 exit 0 + 空输出。
//   **单行**：返回串内绝无换行。
//
// 红线1 / ADR-006：node/JS only，纯计算、零 fs / 零网络 / 零依赖（webview IIFE 也能安全 bundle）。

import { pickFableSevenDayFromRateLimits } from './rate-limits-parse.js';

// ── ANSI SGR（raw escape·不引 npm）─────────────────────────────────────────────────────────────────
const ANSI = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  gray: '\x1b[90m',
  dim: '\x1b[2m',
} as const;

export interface RenderOptions {
  // color=false → 输出纯文本（无 ANSI·测试 / NO_COLOR 用）。默认 true（status-line 支持 ANSI）。
  color?: boolean;
}

// 三个窗口各自的阈值（[green<lo, yellow≤hi, red>hi]）。
type Band = 'green' | 'yellow' | 'red';
function bandFor(kind: 'ctx' | '5h' | '7d', pct: number): Band {
  // 闭区间归属：< lo → green；≤ hi → yellow；否则 red。
  let lo: number;
  let hi: number;
  if (kind === 'ctx') {
    lo = 60;
    hi = 85;
  } else if (kind === '5h') {
    lo = 70;
    hi = 90;
  } else {
    lo = 70;
    hi = 85;
  }
  if (pct < lo) return 'green';
  if (pct <= hi) return 'yellow';
  return 'red';
}

function colorOf(band: Band): string {
  return band === 'green' ? ANSI.green : band === 'yellow' ? ANSI.yellow : ANSI.red;
}

// paint(s, code, enabled) → enabled 时包 SGR，否则原样。
function paint(s: string, code: string, enabled: boolean): string {
  return enabled ? `${code}${s}${ANSI.reset}` : s;
}

// 从一个对象安全取「0–100 数值」字段（NaN / 非 number / 越界 → null）。
function pctField(obj: unknown, key: string): number | null {
  if (!obj || typeof obj !== 'object') return null;
  const v = (obj as Record<string, unknown>)[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  // 容忍轻微越界（如 100.4）→ 夹到 0–100；负数 / 明显非法 → null。
  if (v < 0) return null;
  return v > 100 ? 100 : v;
}

// 10 格进度条：filled = round(pct/10)·夹 0–10。
function progressBar(pct: number, enabled: boolean, band: Band): string {
  const filledN = Math.max(0, Math.min(10, Math.round(pct / 10)));
  const filled = '█'.repeat(filledN);
  const empty = '░'.repeat(10 - filledN);
  return `${paint(filled, colorOf(band), enabled)}${paint(empty, ANSI.gray, enabled)}`;
}

// model.display_name 简写（去掉常见 "Claude " 前缀·让前缀极简）。缺 → ''。
function shortModel(input: Record<string, unknown>): string {
  const model = input.model;
  if (!model || typeof model !== 'object') return '';
  const name = (model as Record<string, unknown>).display_name;
  if (typeof name !== 'string' || !name.trim()) return '';
  return name.replace(/^Claude\s+/i, '').trim();
}

// ── renderStatusline(input, opts) → 单行字符串 ──────────────────────────────────────────────────────
//   各段独立判存在：ctx（context_window.used_percentage 为数值才显）/ 5h / 7d（rate_limits.*.used_percentage
//   为数值才显）。全缺 → 返回 ''。
export function renderStatusline(input: unknown, opts: RenderOptions = {}): string {
  const enabled = opts.color !== false;
  const obj = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};

  const segments: string[] = [];

  // 极简前缀：model 简写（dim·非核心·缺则省）。
  const model = shortModel(obj);
  if (model) segments.push(paint(model, ANSI.dim, enabled));

  // ctx 段：context_window.used_percentage（首条消息前为 null → 省略）。
  const ctxPct = pctField(obj.context_window, 'used_percentage');
  if (ctxPct !== null) {
    const band = bandFor('ctx', ctxPct);
    const bar = progressBar(ctxPct, enabled, band);
    const num = paint(`${Math.round(ctxPct)}%`, colorOf(band), enabled);
    segments.push(`ctx ${bar} ${num}`);
  }

  // 5h / 7d 段：rate_limits.{five_hour,seven_day}.used_percentage。
  const rl = obj.rate_limits;
  const rlObj = rl && typeof rl === 'object' ? (rl as Record<string, unknown>) : null;
  if (rlObj) {
    const fh = pctField(rlObj.five_hour, 'used_percentage');
    if (fh !== null) {
      const band = bandFor('5h', fh);
      segments.push(`5h ${paint(`${Math.round(fh)}%`, colorOf(band), enabled)}`);
    }
    const sd = pctField(rlObj.seven_day, 'used_percentage');
    if (sd !== null) {
      const band = bandFor('7d', sd);
      segments.push(`7d ${paint(`${Math.round(sd)}%`, colorOf(band), enabled)}`);
    }
    const fableWindow = pickFableSevenDayFromRateLimits(rlObj);
    if (fableWindow !== null) {
      const band = bandFor('7d', fableWindow.used_percentage);
      segments.push(
        `fab ${paint(`${Math.round(fableWindow.used_percentage)}%`, colorOf(band), enabled)}`,
      );
    }
  }

  // 段间留 3 空格的视觉分隔（与示例 `ctx … 78%   5h 64%   7d 14%` 对齐）。绝无换行（单行铁律）。
  return segments.join('   ');
}
