import * as io from '../io.js';
import { modelPolicyAdvice, modelPolicyReadModel } from '../model-policy.js';
import type { Ctx } from './_common.js';

function asOf(ctx: Ctx): string {
  const value = ctx.values['as-of'];
  return typeof value === 'string' && value ? value : new Date().toISOString();
}

export function show(ctx: Ctx): number {
  const task = typeof ctx.values.task === 'string' ? ctx.values.task : '';
  ctx.out(`${io.jsonOk(modelPolicyReadModel(task, asOf(ctx)))}\n`);
  return io.EXIT.OK;
}

export function advise(ctx: Ctx): number {
  const input = typeof ctx.values.input === 'string' ? ctx.values.input : '';
  const value = JSON.parse(io.readInputSpec(input, { stdin: ctx.stdin }));
  ctx.out(`${io.jsonOk(modelPolicyAdvice(value, asOf(ctx)))}\n`);
  return io.EXIT.OK;
}
