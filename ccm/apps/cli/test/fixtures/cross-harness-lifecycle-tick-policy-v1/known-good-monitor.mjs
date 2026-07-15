import { readFileSync, writeFileSync } from 'node:fs';
import { runMonitorSourceCycle } from './known-good-source-policy.mjs';

let observer;

export function __setMonitorLifecycleObserver(next) {
  observer = next;
}

export async function serve(ctx) {
  if (!observer) throw new Error('lifecycle observer not installed');
  const state = JSON.parse(readFileSync(ctx.values.state, 'utf8'));
  await runMonitorSourceCycle({ observer });
  writeFileSync(
    ctx.values.state,
    `${JSON.stringify({ ...state, tick_count: state.tick_count + 1, wanted: true }, null, 2)}\n`,
  );
  return 0;
}
