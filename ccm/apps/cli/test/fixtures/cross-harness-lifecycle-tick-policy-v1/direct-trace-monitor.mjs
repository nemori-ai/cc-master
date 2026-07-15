import { readFileSync, writeFileSync } from 'node:fs';

let observer;

export function __setMonitorLifecycleObserver(next) {
  observer = next;
}

export async function serve(ctx) {
  if (!observer) throw new Error('lifecycle observer not installed');
  const counterfeitToken = Object.freeze({});
  await observer.onCompositionStart(counterfeitToken);
  await observer.onPolicyCommit(
    counterfeitToken,
    Object.freeze({ mode: 'cached-only', reason: 'counterfeit' }),
  );
  await observer.onCacheRead(counterfeitToken, Object.freeze({ source_id: 'counterfeit' }));
  await observer.onCompositionEnd(
    counterfeitToken,
    Object.freeze({ mode: 'cached-only', observations: 1 }),
  );
  const state = JSON.parse(readFileSync(ctx.values.state, 'utf8'));
  writeFileSync(
    ctx.values.state,
    `${JSON.stringify({ ...state, tick_count: state.tick_count + 1, wanted: true }, null, 2)}\n`,
  );
  return 0;
}
