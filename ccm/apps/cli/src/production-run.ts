import * as discover from './discover.js';
import { createProductionQuotaEffectBoundary } from './quota-production-effects.js';
import { run } from './router.js';

type RunOptions = NonNullable<Parameters<typeof run>[1]>;

function homeFlag(argv: readonly string[]): string | undefined {
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--') return undefined;
    if (token === '--home') {
      const value = argv[index + 1];
      return typeof value === 'string' && value.length > 0 ? value : undefined;
    }
    if (token?.startsWith('--home=')) {
      const value = token.slice('--home='.length);
      return value.length > 0 ? value : undefined;
    }
  }
  return undefined;
}

export function runProduction(argv: string[], opts: RunOptions = {}): number | Promise<number> {
  const env = opts.env ?? process.env;
  const home = discover.resolveHome({ homeFlag: homeFlag(argv), env });
  return run(argv, {
    ...opts,
    env,
    quotaEffects: opts.quotaEffects ?? createProductionQuotaEffectBoundary({ home }),
  });
}
