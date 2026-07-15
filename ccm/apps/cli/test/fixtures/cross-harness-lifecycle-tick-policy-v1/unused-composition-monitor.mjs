// A production-shaped counterfeit: the composition seam exists and is imported, but the public
// monitor tick never consumes it. The oracle must reject this exact false-green shape.
import './known-good-source-policy.mjs';
import { readFileSync, writeFileSync } from 'node:fs';

let observer;

export function __setMonitorLifecycleObserver(next) {
  observer = next;
}

export async function serve(ctx) {
  if (!observer) throw new Error('lifecycle observer not installed');
  const state = JSON.parse(readFileSync(ctx.values.state, 'utf8'));
  writeFileSync(
    ctx.values.state,
    `${JSON.stringify({ ...state, tick_count: state.tick_count + 1, wanted: true }, null, 2)}\n`,
  );
  return 0;
}
