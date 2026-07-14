import type { Ctx } from '../../../../src/handlers/_common.js';
import { consumeBoundaryResult } from './controlled-quota-helper.js';

export interface ControlledQuotaHandlerOptions {
  readonly effects: Readonly<Record<string, () => void>>;
  readonly beforeControlledWork?: string;
}

export function createControlledQuotaHandler(
  options: ControlledQuotaHandlerOptions,
): Readonly<Record<'controlled', (ctx: Ctx) => number>> {
  const effects = Object.freeze({ ...options.effects });
  const beforeControlledWork = options.beforeControlledWork;
  const beforeControlledEffect =
    beforeControlledWork === undefined ? undefined : effects[beforeControlledWork];
  if (beforeControlledWork !== undefined && typeof beforeControlledEffect !== 'function') {
    throw new Error(`controlled quota effect is not instrumented: ${beforeControlledWork}`);
  }

  return Object.freeze({
    controlled(ctx: Ctx): number {
      if (beforeControlledEffect) beforeControlledEffect();
      if (!ctx.quotaEffects) throw new Error('QUOTA_CAPABILITY_UNAVAILABLE: boundary missing');
      const capability = String(ctx.values.capability ?? '');
      const result = ctx.quotaEffects.execute(capability, {
        source: 'controlled-router-fixture',
      });
      if (result && typeof (result as { then?: unknown }).then === 'function') {
        throw new Error('controlled quota fixture requires a synchronous boundary handler');
      }
      ctx.out(JSON.stringify({ ok: true, data: consumeBoundaryResult(result) }));
      return 0;
    },
  });
}
