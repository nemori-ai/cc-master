// statusline/capture.ts — 把账户权威用量信号（5h/7d rate_limits）从 status-line stdin 落 sidecar。
//
// 取代退役的 `statusline-capture.js`（旧带外脚本）：订阅账户的 5h/7d `used_percentage` + `resets_at` 是**权威**
//   用量信号，但官方核实结论是它**只**出现在 status-line 脚本的 stdin 里——所有 hook stdin / transcript JSONL /
//   任何 CLI 子命令落盘都没有。于是 `ccm statusline`（status-line 命令本身）在被调用时把它捕获到账户级 sidecar，
//   下游（`ccm usage` / usage-pacing hook）再读 sidecar（权威优先，本地 JSONL 反推退为 fallback·Finding #37）。
//
// sidecar 落点：resolveRateCachePath(env)（`$CC_MASTER_RATE_CACHE` > `<cc-master-home>/.cc-master-rate-limits.json`·
//   账户级、跨 project 共享）——这是 usage handler / usage-pacing hook 钉死读的同一路径。
//   落盘形态（与旧脚本逐字一致·下游 normalizeSignal 直接采纳）：
//     `{ captured_at:<epoch秒>, five_hour:{used_percentage:<num>, resets_at?:<epoch秒>}, seven_day:{...} }`
//
// 铁律：
//   · 缺 rate_limits（非 Pro/Max，或窗口尚未在本 session 出现）→ **不写 sidecar**（不抹掉上次捕获的权威值）。
//   · 原子写（同目录 temp + rename·同文件系统 rename 原子）——读取方永不会看到半写内容。
//   · 任何失败一律吞掉（return false）——status-line 渲染绝不能因落盘失败而中断 / 污染 UI。
//
// 红线1 / ADR-006：node/JS only，纯 node stdlib（fs/path/os），零网络、零第三方依赖。

import * as fs from 'node:fs';
import * as path from 'node:path';
import { type PathEnv, resolveRateCachePath } from '../paths.js';

// nowEpoch(env) → 现在（epoch 秒）。`CC_MASTER_NOW`（ISO-8601）覆写让 captured_at 确定可复现（测试用）。
function nowEpoch(env: PathEnv): number {
  const o = env.CC_MASTER_NOW;
  if (o) {
    const t = Date.parse(o.replace('Z', '+00:00'));
    if (!Number.isNaN(t)) return Math.floor(t / 1000);
  }
  return Math.floor(Date.now() / 1000);
}

// pickWindow(w) → 只收一个「真出现且带数值 used_percentage」的窗口；resets_at 有就一并带上。其余视缺失（null）。
function pickWindow(w: unknown): { used_percentage: number; resets_at?: number } | null {
  if (!w || typeof w !== 'object') return null;
  const o = w as Record<string, unknown>;
  if (typeof o.used_percentage !== 'number' || !Number.isFinite(o.used_percentage)) return null;
  const out: { used_percentage: number; resets_at?: number } = {
    used_percentage: o.used_percentage,
  };
  if (typeof o.resets_at === 'number' && Number.isFinite(o.resets_at)) out.resets_at = o.resets_at;
  return out;
}

// writeAtomic(file, data) → 同目录 temp + rename 原子写。失败抛（由 captureRateLimits 外层兜）。
function writeAtomic(file: string, data: string): void {
  const dir = path.dirname(file);
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    /* 目录已存在 / 不可建 → 让后续 write 自己失败并被外层兜住 */
  }
  const tmp = path.join(dir, `.rate-${process.pid}-${Math.random().toString(36).slice(2)}.tmp`);
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

export interface CaptureResult {
  captured: boolean; // 是否真落了 sidecar（缺 rate_limits → false·不抹旧值）
  path: string; // sidecar 落点（即便没写也回路径·便于调试 / 测试）
}

// ── captureRateLimits(input, env) → CaptureResult ───────────────────────────────────────────────────
//   仅当 input.rate_limits 真带至少一个可用窗口（数值 used_percentage）才落 sidecar。任何异常吞掉（captured:false）。
export function captureRateLimits(input: unknown, env?: PathEnv): CaptureResult {
  const e = env || (process.env as PathEnv);
  const file = resolveRateCachePath(e);
  try {
    const obj = input && typeof input === 'object' ? (input as Record<string, unknown>) : null;
    const rl =
      obj && obj.rate_limits && typeof obj.rate_limits === 'object'
        ? (obj.rate_limits as Record<string, unknown>)
        : null;
    if (!rl) return { captured: false, path: file };
    const fh = pickWindow(rl.five_hour);
    const sd = pickWindow(rl.seven_day);
    if (!fh && !sd) return { captured: false, path: file };
    const payload: Record<string, unknown> = { captured_at: nowEpoch(e) };
    if (fh) payload.five_hour = fh;
    if (sd) payload.seven_day = sd;
    writeAtomic(file, JSON.stringify(payload));
    return { captured: true, path: file };
  } catch {
    return { captured: false, path: file };
  }
}
