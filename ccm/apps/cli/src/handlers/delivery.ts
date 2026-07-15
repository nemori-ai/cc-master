import { dependencyQualified, targetDelivered } from '@ccm/engine';
import { resolveDeliveryFacts } from '../delivery-proof.js';
import * as io from '../io.js';
import { type BoardArg, type Ctx, runRead } from './_common.js';

interface KindedError extends Error {
  errKind?: string;
}

function task(board: BoardArg, id: string): Record<string, any> {
  const value = Array.isArray(board.tasks) ? board.tasks.find((entry) => entry?.id === id) : null;
  if (!value) {
    const error = new Error(`DELIVERY_TASK_NOT_FOUND: task ${id} not found`) as KindedError;
    error.errKind = 'NotFound';
    throw error;
  }
  return value;
}

function renderQualification(value: any, ctx: Ctx, label: string): string {
  if (ctx.flags.json) return io.jsonOk(value);
  const codes = value.reasons?.map((reason: any) => reason.code).join(',') || 'none';
  return `${label}: state=${value.state} basis=${value.basis} target_delivered=${String(value.target_delivered ?? false)} qualified_by=${value.qualified_by ?? 'none'} diagnostics=${codes}`;
}

export function check(ctx: Ctx): number {
  const taskId = ctx.positionals[0] as string;
  const targetId = ctx.positionals[1] as string;
  return runRead(ctx, {
    compute: (raw) => {
      const board = raw as BoardArg;
      return targetDelivered(board, task(board, taskId), targetId, resolveDeliveryFacts(board));
    },
    render: (value, c) => renderQualification(value, c, `delivery ${taskId} -> ${targetId}`),
  });
}

export function audit(ctx: Ctx): number {
  return runRead(ctx, {
    compute: (raw) => {
      const board = raw as BoardArg;
      const facts = { ...resolveDeliveryFacts(board), strict_preview: true };
      const edges: Array<Record<string, unknown>> = [];
      for (const downstream of Array.isArray(board.tasks) ? board.tasks : []) {
        for (const upstreamId of Array.isArray(downstream?.deps) ? downstream.deps : []) {
          edges.push({
            downstream: downstream.id,
            dependency: upstreamId,
            qualification: dependencyQualified(board, downstream.id, upstreamId, facts),
          });
        }
      }
      return {
        strict_preview: true,
        persisted_mode: board.delivery_contract?.mode ?? 'legacy',
        edges,
      };
    },
    render: (value, c) => {
      const report = value as { persisted_mode: string; edges: Array<Record<string, any>> };
      if (c.flags.json) return io.jsonOk(report);
      const lines = [
        `delivery strict dry-run: persisted_mode=${report.persisted_mode} edges=${report.edges.length}`,
      ];
      for (const edge of report.edges) {
        const q = edge.qualification;
        lines.push(
          `  ${edge.downstream} <- ${edge.dependency}: ${q.state} [${q.reasons.map((r: any) => r.code).join(',') || 'none'}]`,
        );
      }
      return lines.join('\n');
    },
  });
}
