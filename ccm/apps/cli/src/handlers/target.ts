import {
  refreshDeliveryTarget,
  resolveDeliveryFacts,
  resolveTargetDeclaration,
  type TargetInput,
} from '../delivery-proof.js';
import * as io from '../io.js';
import * as mutations from '../mutations.js';
import { type BoardArg, type Ctx, runRead, runWrite } from './_common.js';

interface KindedError extends Error {
  errKind?: string;
}

function missing(id: string): never {
  const error = new Error(
    `DELIVERY_TARGET_NOT_FOUND: delivery target ${id} not found`,
  ) as KindedError;
  error.errKind = 'NotFound';
  throw error;
}

function output(value: unknown, ctx: Ctx, human: string): string {
  return ctx.flags.json ? io.jsonOk(value) : human;
}

export function set(ctx: Ctx): number {
  const id = ctx.positionals[0] as string;
  return runWrite(ctx, {
    mutate: (raw) => {
      const board = raw as BoardArg;
      const kind = ctx.values.kind as TargetInput['kind'];
      const input: TargetInput =
        kind === 'git-ref'
          ? {
              kind,
              ref: String(ctx.values.ref ?? ''),
              ...(ctx.values.repository ? { repository: String(ctx.values.repository) } : {}),
            }
          : { kind: 'artifact-set', namespace: String(ctx.values.namespace ?? '') };
      const target = resolveTargetDeclaration(board, id, input);
      return mutations.setDeliveryTarget(board, id, target);
    },
    render: (next, c, { dryRun }) => {
      const target = (next as BoardArg).delivery_contract?.targets?.[id];
      return output(
        { target_id: id, target, dry_run: dryRun },
        c,
        `${dryRun ? '[dry-run] ' : ''}delivery target ${id} 已声明：${target?.kind} snapshot=${target?.snapshot?.oid ?? target?.snapshot?.digest}`,
      );
    },
  });
}

export function show(ctx: Ctx): number {
  const id = ctx.positionals[0] as string;
  return runRead(ctx, {
    compute: (raw) => {
      const board = raw as BoardArg;
      const target = board.delivery_contract?.targets?.[id];
      if (!target) missing(id);
      return { target_id: id, target, fact: resolveDeliveryFacts(board).targets?.[id] };
    },
    render: (value, c) => {
      const result = value as Record<string, any>;
      return output(
        result,
        c,
        `delivery target ${id}: kind=${result.target.kind} fact=${result.fact?.state ?? 'unknown'} snapshot=${result.target.snapshot?.oid ?? result.target.snapshot?.digest}`,
      );
    },
  });
}

export function refresh(ctx: Ctx): number {
  const id = ctx.positionals[0] as string;
  let revalidations: unknown[] = [];
  return runWrite(ctx, {
    mutate: (raw) => {
      const result = refreshDeliveryTarget(raw as BoardArg, id);
      revalidations = result.revalidations;
      return mutations.touch(result.board);
    },
    render: (next, c, { dryRun }) => {
      const target = (next as BoardArg).delivery_contract?.targets?.[id];
      const data = { target_id: id, target, revalidations, dry_run: dryRun };
      return output(
        data,
        c,
        `${dryRun ? '[dry-run] ' : ''}delivery target ${id} 已刷新；revalidated=${revalidations.length}`,
      );
    },
  });
}
