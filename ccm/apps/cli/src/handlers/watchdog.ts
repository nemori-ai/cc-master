// handlers/watchdog.ts — watchdog noun handler（ADR-011 自我唤醒·cli-design §3 namespace watchdog）。
//
// 照 log.ts 范式：每 verb 导出一个 handler(ctx) → exitCode。写 verb 用 _common.runWrite，读 verb 用 runRead。
//   · arm    —— runWrite + mutations.watchdogArm（--fire-at/--mechanism/--job-id/--checklist→fireAt/mechanism/jobId/checklist）。
//   · disarm —— runWrite + mutations.watchdogDisarm（幂等·删 canonical/legacy 整字段；提示清外部调度）。
//   · status —— runRead，读 board.watchdog/legacy wakeup（缺 → 未武装；对象 → 原字段 + 派生 health）。
//
// flag 全集严格抄 registry.watchdog（不自创）；字段名照 FIELDS（board.watchdog = {armed_at, fire_at, mechanism, job_id, checklist}）。
//   mutation / discover 的 throw 不在 handler 内 catch——冒泡给 router 按 .errKind 映射退出码。handler 内绝不 process.exit。
//
// 红线1 / ADR-006：node/JS only，零 npm 依赖、纯 stdlib。
// 武装闸豁免：纯 handler 模块（无 hook 入口，只被 router 经 registry.handler 调）——见 AGENTS.md §3 / §12。
//
// T2b port 注：require → ESM import；module.exports → 命名导出。逻辑/报错文案/.errKind 逐字保持。

import * as mutations from '../mutations.js';
import { REGISTRY } from '../registry.js';
import * as render from '../render.js';
import { type BoardArg, buildFields, type Ctx, runRead, runWrite } from './_common.js';

// watchdog 对象的最小读形（渲染用）。
interface WatchdogLike {
  armed_at?: string;
  fire_at?: string;
  mechanism?: string;
  job_id?: string;
  checklist?: unknown;
  [k: string]: unknown;
}

interface WatchdogHealth {
  armed: boolean;
  code: 'armed' | 'missing-accountable-handle' | 'expired';
  action?: string;
}

interface WatchdogStatusLike extends WatchdogLike {
  health: WatchdogHealth;
}

const STRICT_ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const REARM_ACTION =
  '先运行 ccm watchdog disarm 删除旧记录；创建真实唤醒后，用 --job-id <handle> 重新 arm。';

function watchdogRecord(board: { watchdog?: unknown; wakeup?: unknown }): WatchdogLike | null {
  const value =
    board.watchdog === undefined || board.watchdog === null ? board.wakeup : board.watchdog;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as WatchdogLike;
}

function watchdogHealth(
  wd: WatchdogLike,
  nowIso = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
): WatchdogHealth {
  if (typeof wd.job_id !== 'string' || wd.job_id.trim() === '') {
    return { armed: false, code: 'missing-accountable-handle', action: REARM_ACTION };
  }
  if (typeof wd.fire_at === 'string' && STRICT_ISO_UTC.test(wd.fire_at) && wd.fire_at < nowIso) {
    return { armed: false, code: 'expired', action: REARM_ACTION };
  }
  return { armed: true, code: 'armed' };
}

// ── watchdog arm ────────────────────────────────────────────────────────────────────────────────
// flags（registry.watchdog.arm）：--fire-at（field fireAt·required）/ --mechanism（field mechanism·enum·required）/
//   --job-id（field jobId·required）/ --checklist（field checklist）。mutation 再守 nonblank，--force 不可越。
export function arm(ctx: Ctx): number {
  const spec = REGISTRY.watchdog?.arm;
  return runWrite(ctx, {
    mutate: (board) => {
      const { fields } = buildFields(ctx.values, spec, { stdin: ctx.stdin });
      const args = {
        fireAt: fields.fireAt as string | undefined,
        mechanism: fields.mechanism as string | undefined,
        jobId: fields.jobId as string | undefined,
        checklist: fields.checklist,
      };
      return mutations.watchdogArm(board as BoardArg, args);
    },
    render: (next, c, { dryRun }) => {
      const nb = next as { watchdog?: WatchdogLike };
      const wd = nb.watchdog || {};
      if (c.flags.json) return renderWatchdog(wd, { json: true });
      const prefix = dryRun ? '[dry-run] 将武装 watchdog: ' : 'watchdog 已武装: ';
      const bits = [`fire_at=${wd.fire_at || ''}`, `mechanism=${wd.mechanism || ''}`];
      if (wd.job_id) bits.push(`job_id=${wd.job_id}`);
      return prefix + bits.join(' · ');
    },
  });
}

// ── watchdog disarm ─────────────────────────────────────────────────────────────────────────────
// 幂等：删除 canonical watchdog + legacy wakeup 整字段（ABSENT·不留 null/空对象）；无记录也成功。
//   若原有 job_id → human 输出提示清理每个外部调度（板上退役不等于外部任务已取消）。
export function disarm(ctx: Ctx): number {
  // mutate 在 runWrite 内拿到盘上最新 board——捕获 canonical + legacy 退役前句柄。
  let priorJobIds: string[] = [];
  return runWrite(ctx, {
    mutate: (board) => {
      const b = board as { watchdog?: WatchdogLike; wakeup?: WatchdogLike };
      priorJobIds = [
        ...new Set(
          [b.watchdog?.job_id, b.wakeup?.job_id]
            .filter((id): id is string => typeof id === 'string' && id.trim() !== '')
            .map((id) => id.trim()),
        ),
      ];
      return mutations.watchdogDisarm(board as BoardArg);
    },
    render: (next, c, { dryRun }) => {
      const nb = next as { watchdog?: WatchdogLike | null };
      if (c.flags.json) return renderWatchdog(nb.watchdog, { json: true });
      const prefix = dryRun ? '[dry-run] 将退役 watchdog' : 'watchdog 已退役';
      const hint =
        priorJobIds.length > 0
          ? `（已删整对象，请去清理外部调度 job-id=${priorJobIds.join(',')}）`
          : '（已删整对象）';
      return prefix + hint;
    },
  });
}

// ── watchdog status ─────────────────────────────────────────────────────────────────────────────
// 读 verb：canonical 缺/null 时 fallback legacy wakeup；--json 保留对象原字段并追加派生 health。
export function status(ctx: Ctx): number {
  return runRead(ctx, {
    compute: (board) => {
      const wd = watchdogRecord(board as { watchdog?: unknown; wakeup?: unknown });
      if (!wd) return null;
      return Object.assign({}, wd, { health: watchdogHealth(wd) }) as WatchdogStatusLike;
    },
    render: (wd, c) =>
      renderWatchdog(wd as WatchdogStatusLike | null, {
        json: !!c.flags.json,
        color: c.flags.color,
      }),
  });
}

// ── renderWatchdog(wd, {json, color}) → string ────────────────────────────────────────────────────
//   wd 为 null/undefined → 「未武装」（human）/ jsonString(null)（json）。
//   人读：逐字段单列；--json：统一壳 { ok:true, data: wd|null }。
function renderWatchdog(
  wd: WatchdogLike | WatchdogStatusLike | null | undefined,
  opts?: { json?: boolean; color?: boolean },
): string {
  opts = opts || {};
  if (opts.json) return render.jsonString(wd || null);
  if (!wd) return 'watchdog: 未武装';
  const health = 'health' in wd ? (wd as WatchdogStatusLike).health : undefined;
  const lines = [health && !health.armed ? 'watchdog: 未武装（记录不健康）' : 'watchdog: 已武装'];
  if (wd.armed_at) lines.push(`  armed_at:  ${wd.armed_at}`);
  if (wd.fire_at) lines.push(`  fire_at:   ${wd.fire_at}`);
  if (wd.mechanism) lines.push(`  mechanism: ${wd.mechanism}`);
  if (wd.job_id) lines.push(`  job_id:    ${wd.job_id}`);
  if (wd.checklist) lines.push(`  checklist: ${wd.checklist}`);
  if (health && !health.armed) {
    lines.push(`  health:    ${health.code}`);
    if (health.action) lines.push(`  action:    ${health.action}`);
  }
  return lines.join('\n');
}
