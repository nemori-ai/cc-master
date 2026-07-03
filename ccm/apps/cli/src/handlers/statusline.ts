// handlers/statusline.ts — statusline noun handler（render / install / uninstall·self-contained status line·0.10.0）。
//
// 三个 verb：
//   · render     （`ccm statusline` 的默认 verb·这是 status-line 命令本身）：读 stdin JSON → 把 5h/7d rate_limits
//                  落 sidecar（subsume 退役的 statusline-capture.js）+ 渲染单行 ANSI 状态行到 stdout。
//                  **铁律**：任何失败 / 缺字段一律静默 exit 0、绝不污染 UI（缺段优雅省略·ctx=null 不显 ctx 段）。
//   · install    幂等把 `ccm statusline` 写进**全局** settings.json 的 statusLine（绝对命令路径·备份用户原值·清 opt-out）。
//   · uninstall  从备份恢复用户原 statusLine（无备份则删字段）+ 落 opt-out 标记让自动安装不再覆盖回去。
//
// **不是 board 操作**——不走 discover / runWrite / runRead；render 读 stdin、install/uninstall 写 settings.json
//   （全跟随 CLAUDE_CONFIG_DIR·env 注入可测）。逻辑全在 `@ccm/engine` 的 statusline/（render/capture/install），
//   handler 只做薄接线 + 输出。
//
// 红线1 / ADR-006：node/JS only，零 npm 依赖、纯 stdlib + @ccm/engine。武装闸豁免：纯 handler（无 hook 入口）。

import {
  autoInstallStatuslineOnce,
  captureRateLimits,
  installStatusline,
  renderStatusline,
  type StatuslineActionResult,
  uninstallStatusline,
} from '@ccm/engine';
import { resolveHarnessAdapter } from '../harnesses/registry.js';
import * as io from '../io.js';
import { resolveSelfBinPath, resolveStatuslineCommand } from '../self.js';
import type { Ctx } from './_common.js';

const EXIT = io.EXIT;

// renderColorEnabled(ctx) → status line 默认上色（stdout 非 TTY 也上色·官方 status-line 支持 ANSI）；
//   仅 --no-color / NO_COLOR 显式关，--color 显式开。**不**退回 io.resolveColor 的 TTY 兜底（那会在非 TTY 误关）。
function renderColorEnabled(ctx: Ctx): boolean {
  if (ctx.values['no-color'] === true) return false;
  if (ctx.values.color === true) return true;
  const nc = ctx.env.NO_COLOR;
  if (nc !== undefined && nc !== '') return false;
  return true;
}

// ── render：status-line 命令本身（读 stdin → 捕获 sidecar + 渲染单行）─────────────────────────────────
export function render(ctx: Ctx): number {
  try {
    // 读 stdin（fd 0·io.readInputSpec('-') 走同步读到 EOF）。读不到 → 空。
    let raw = '';
    try {
      raw = io.readInputSpec('-', { stdin: ctx.stdin });
    } catch {
      raw = '';
    }
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(raw || '{}');
    } catch {
      parsed = null; // 坏 stdin → 按缺失处理（不捕获、不渲染）。
    }
    // 捕获账户权威用量到 sidecar（best-effort·缺 rate_limits 不抹旧值）。
    try {
      captureRateLimits(parsed, ctx.env);
    } catch {
      /* 落盘失败不致命·继续渲染 */
    }
    // 渲染单行（缺段优雅省略·全缺 → 空串 → 不输出）。
    const line = renderStatusline(parsed, { color: renderColorEnabled(ctx) });
    if (line) ctx.out(line);
  } catch {
    /* 铁律：任何未预期异常都不得污染 status line UI */
  }
  return EXIT.OK; // status line 永远 exit 0
}

// 把动作结果渲染成人类可读一行（含 settings 路径 + 动作语义）。
function humanResult(r: StatuslineActionResult): string {
  const where = r.settingsPath;
  switch (r.action) {
    case 'installed':
      return `已安装 ccm status line → ${where}${r.backedUp ? '（已备份你原有的 statusLine·ccm statusline uninstall 可恢复）' : ''}`;
    case 'updated':
      return `已更新 ccm status line 命令 → ${where}`;
    case 'noop':
      return `ccm status line 已是最新，无需改动 → ${where}`;
    case 'restored':
      return `已恢复你原有的 statusLine（并 opt-out·自动安装不再覆盖）→ ${where}`;
    case 'removed':
      return `已移除 ccm status line（你原本就没有 statusLine·并 opt-out）→ ${where}`;
    case 'skipped':
      return `跳过（${r.reason || 'n/a'}）→ ${where}`;
    case 'error':
      return `未改动：settings.json 无法解析（${r.reason || 'n/a'}），为安全起见未覆写 → ${where}`;
    default:
      return `${r.action} → ${where}`;
  }
}

// ── install ────────────────────────────────────────────────────────────────────────────────────
export function install(ctx: Ctx): number {
  const harness = resolveHarnessAdapter({
    env: ctx.env,
    harnessFlag: typeof ctx.values.harness === 'string' ? ctx.values.harness : undefined,
  });
  if (!harness.externalStatusline.supported) {
    const r = {
      action: 'skipped',
      settingsPath: '',
      reason: `NotImplemented: ${harness.externalStatusline.reason || `${harness.displayName} harness has no external status line adapter.`}`,
    } as const;
    if (ctx.flags.json) ctx.out(io.jsonOk(r));
    else ctx.out(`未改动：${r.reason}\n`);
    return EXIT.USAGE;
  }
  const command = resolveStatuslineCommand();
  const r = installStatusline(ctx.env, command);
  if (ctx.flags.json) ctx.out(io.jsonOk(r));
  else ctx.out(humanResult(r));
  return r.action === 'error' ? EXIT.ERROR : EXIT.OK;
}

// ── uninstall ──────────────────────────────────────────────────────────────────────────────────
export function uninstall(ctx: Ctx): number {
  const harness = resolveHarnessAdapter({
    env: ctx.env,
    harnessFlag: typeof ctx.values.harness === 'string' ? ctx.values.harness : undefined,
  });
  if (!harness.externalStatusline.supported) {
    const r = {
      action: 'skipped',
      settingsPath: '',
      reason: `NotImplemented: ${harness.externalStatusline.reason || `${harness.displayName} harness has no external status line adapter.`}`,
    } as const;
    if (ctx.flags.json) ctx.out(io.jsonOk(r));
    else ctx.out(`未改动：${r.reason}\n`);
    return EXIT.USAGE;
  }
  const r = uninstallStatusline(ctx.env);
  if (ctx.flags.json) ctx.out(io.jsonOk(r));
  else ctx.out(humanResult(r));
  return r.action === 'error' ? EXIT.ERROR : EXIT.OK;
}

// autoInstall(env) — 供 router 在每条非-statusline 命令首次跑时无感知调用（marker 守·静默·绝不抛）。
//   放这里让 handler 层统一拥有 statusline 接线；router 只调一次、不关心结果。
export function autoInstall(env: Ctx['env'], harnessFlag?: string): void {
  try {
    const harness = resolveHarnessAdapter({ env, harnessFlag });
    if (!harness.externalStatusline.supported) return;
    // 第三参 binPath 注入 DEV-GUARD：从 worktree / 仓库内跑（dev 自测）时 autoInstall 自动 skip（reason
    // `dev-invocation`），绝不污染真实 ~/.claude/settings.json；真实用户（稳定安装路径）不受影响。
    // binPath 经 resolveSelfBinPath(env) 解析（honor env.CCM_BIN·见 self.ts）。
    autoInstallStatuslineOnce(env, resolveStatuslineCommand(), resolveSelfBinPath(env));
  } catch {
    /* 绝不让自动安装影响任何命令 */
  }
}
