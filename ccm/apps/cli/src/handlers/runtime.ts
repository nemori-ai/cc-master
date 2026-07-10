import * as io from '../io.js';
import { createRuntimeSupplyChain } from '../runtime-supply-chain.js';
import type { Ctx } from './_common.js';

function runtimeFor(ctx: Ctx) {
  const env = { ...ctx.env };
  if (typeof ctx.values.home === 'string' && ctx.values.home) env.CC_MASTER_HOME = ctx.values.home;
  return createRuntimeSupplyChain({ env });
}

function emit(ctx: Ctx, data: unknown, human: string): void {
  ctx.out(ctx.flags.json ? io.jsonOk(data) : human);
}

function rejectMutationDryRun(ctx: Ctx, verb: string): void {
  if (!ctx.flags.dryRun) return;
  const error = new Error(
    `--dry-run is not supported for runtime ${verb}; use runtime doctor --installed-path <binary> --dry-run for a read-only migration plan`,
  ) as Error & { errKind?: string };
  error.errKind = 'Usage';
  throw error;
}

export function stage(ctx: Ctx): number {
  rejectMutationDryRun(ctx, 'stage');
  const artifactPath = ctx.positionals[0] as string;
  const provenancePath = ctx.values.provenance as string;
  const data = runtimeFor(ctx).stage({ artifactPath, provenancePath });
  emit(
    ctx,
    data,
    `runtime staged: tx=${data.transaction_id} sha256=${data.sha256} image=${data.image_path}`,
  );
  return io.EXIT.OK;
}

export function activate(ctx: Ctx): number {
  rejectMutationDryRun(ctx, 'activate');
  const data = runtimeFor(ctx).activate(ctx.positionals[0] as string);
  emit(
    ctx,
    data,
    `runtime activated: sequence=${data.sequence} current=${data.current.sha256} previous=${data.previous?.sha256 || 'none'}`,
  );
  return io.EXIT.OK;
}

export function resolve(ctx: Ctx): number {
  const data = runtimeFor(ctx).resolve();
  emit(
    ctx,
    data,
    `runtime current: sequence=${data.sequence} sha256=${data.sha256} image=${data.image_path}`,
  );
  return io.EXIT.OK;
}

export function invoke(ctx: Ctx): number {
  rejectMutationDryRun(ctx, 'invoke');
  return runtimeFor(ctx).invoke(ctx.positionals).exit_code;
}

export function doctor(ctx: Ctx): number {
  if (ctx.values.repair === true) rejectMutationDryRun(ctx, 'doctor --repair');
  const data = runtimeFor(ctx).doctor({
    installedPath:
      typeof ctx.values['installed-path'] === 'string' ? ctx.values['installed-path'] : undefined,
    repair: ctx.values.repair === true,
  });
  emit(
    ctx,
    data,
    `runtime doctor: backend=${data.backend.id} supported=${data.backend.activation_supported} activations=${data.activation_count} incomplete=${data.incomplete_transactions.length}`,
  );
  return io.EXIT.OK;
}

export function rollback(ctx: Ctx): number {
  rejectMutationDryRun(ctx, 'rollback');
  const data = runtimeFor(ctx).rollback();
  emit(
    ctx,
    data,
    `runtime rolled back: sequence=${data.sequence} current=${data.current.sha256} previous=${data.previous?.sha256 || 'none'}`,
  );
  return io.EXIT.OK;
}
