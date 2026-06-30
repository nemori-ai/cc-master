// handlers/baseline.ts — baseline noun handler（snapshot / show / reset）。
//
// EVM plan-baseline CRUD：
//   · snapshot  → runWrite：从当前 tasks 的 estimate+deps 快照写 board.baseline；已有则 exit 3（--force/--dry-run）。
//   · show      → runRead：只读当前 baseline 段，无 board 也 exit 0（has_baseline:false）。
//   · reset     → runWrite：旧 baseline 进 history[]（只增不删）+ 建新；非 TTY 须 --yes。
//
// exit codes：0 OK · 2 USAGE · 3 VALIDATION（已有 baseline 时 snapshot 无 --force） · 4 LOCK · 5 NOT_FOUND。
//
// 红线1 / ADR-006：node/JS only，零 npm 依赖、纯 stdlib。
// 武装闸豁免：纯 handler 模块（无 hook 入口）。

import * as mutations from '../mutations.js';
import { type BoardArg, type Ctx, runRead, runWrite } from './_common.js';

// 带 errKind 的 Error（router 据此映射退出码）。
interface KindedError extends Error {
  errKind?: string;
}

// ── baseline snapshot ──────────────────────────────────────────────────────
export function snapshot(ctx: Ctx): number {
  return runWrite(ctx, {
    mutate: (board) => {
      const b = board as BoardArg;
      const hasBaseline = b.baseline && typeof b.baseline === 'object';
      const force = ctx.flags.force;
      const dryRun = ctx.flags.dryRun;

      if (hasBaseline && !force && !dryRun) {
        const e = new Error(
          'board.baseline 已存在（用 --force 覆盖，或 baseline reset 移入 history）',
        ) as KindedError;
        e.errKind = 'Validation';
        throw e;
      }

      const t0 = (ctx.values && (ctx.values.t0 as string)) || mutations.stampNow();
      const note = ctx.values && (ctx.values.note as string);
      return mutations.baselineSnapshot(b, { t0, note });
    },
    render: (next, c, { dryRun }) => {
      const n = next as BoardArg;
      const bl = n.baseline as Record<string, unknown> | undefined;
      if (c.flags.json) {
        return JSON.stringify({
          ok: true,
          data: {
            dry_run: dryRun,
            has_baseline: !!bl,
            baseline: bl || null,
          },
        });
      }
      return dryRun
        ? `baseline snapshot --dry-run: bac_h=${bl?.bac_h ?? '?'}, tasks=${Object.keys((bl?.task_estimates as object) || {}).length}\n`
        : `baseline snapshot OK: captured_at=${bl?.captured_at}, bac_h=${bl?.bac_h ?? '?'}\n`;
    },
  });
}

// ── baseline show ──────────────────────────────────────────────────────────
export function show(ctx: Ctx): number {
  return runRead(ctx, {
    render: (board, c) => {
      const b = board as BoardArg;
      const bl = b && typeof b === 'object' ? b.baseline : undefined;
      const hasBaseline = !!bl && typeof bl === 'object';
      if (c.flags.json) {
        return JSON.stringify({
          ok: true,
          data: {
            has_baseline: hasBaseline,
            baseline: hasBaseline ? bl : null,
          },
        });
      }
      if (!hasBaseline) return 'has_baseline: false\n';
      const blo = bl as Record<string, unknown>;
      const taskCount = Object.keys((blo.task_estimates as object) || {}).length;
      const histCount = Array.isArray(blo.history) ? blo.history.length : 0;
      return `has_baseline: true\ncaptured_at: ${blo.captured_at}\nt0: ${blo.t0}\nbac_h: ${blo.bac_h ?? '?'}\ntask_estimates: ${taskCount} tasks\nhistory: ${histCount} entries\n`;
    },
  });
}

// ── baseline reset ──────────────────────────────────────────────────────────
export function reset(ctx: Ctx): number {
  if (!ctx.isTTY && !ctx.flags.yes) {
    const e = new Error('baseline reset 非 TTY 须 --yes（破坏性操作）') as KindedError;
    e.errKind = 'Usage';
    throw e;
  }
  return runWrite(ctx, {
    mutate: (board) => {
      const b = board as BoardArg;
      const t0 = (ctx.values && (ctx.values.t0 as string)) || mutations.stampNow();
      const note = ctx.values && (ctx.values.note as string);
      return mutations.baselineReset(b, { t0, note });
    },
    render: (next, c, { dryRun }) => {
      const n = next as BoardArg;
      const bl = n.baseline as Record<string, unknown> | undefined;
      const histCount = Array.isArray((n.baseline as any)?.history)
        ? (n.baseline as any).history.length
        : 0;
      if (c.flags.json) {
        return JSON.stringify({
          ok: true,
          data: {
            dry_run: dryRun,
            baseline: bl || null,
            history_entries: histCount,
          },
        });
      }
      return dryRun
        ? `baseline reset --dry-run: new baseline would be captured, history_entries=${histCount}\n`
        : `baseline reset OK: new captured_at=${bl?.captured_at}, history_entries=${histCount}\n`;
    },
  });
}
