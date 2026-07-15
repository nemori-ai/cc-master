import * as io from '../io.js';
import * as render from '../render.js';
import type { Ctx } from './_common.js';

export const CAPABILITIES = ['board-init/structured-board-path-v1', 'goal-contract/v1'] as const;

export function check(ctx: Ctx): number {
  const capability = String(ctx.positionals[0] || '');
  if (!CAPABILITIES.includes(capability as (typeof CAPABILITIES)[number])) {
    const error = `unsupported capability: ${capability}`;
    ctx.err(ctx.flags.json ? io.jsonErr({ exit: io.EXIT.VALIDATION, error }) : error);
    return io.EXIT.VALIDATION;
  }
  const data = { capability, supported: true };
  ctx.out(ctx.flags.json ? render.jsonString(data) : `${capability}: supported`);
  return io.EXIT.OK;
}
