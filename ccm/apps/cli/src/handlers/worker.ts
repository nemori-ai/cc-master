import * as io from '../io.js';
import { runSessionBoundCursorWorker } from '../session-bound-worker.js';
import type { Ctx } from './_common.js';

function positiveInteger(value: unknown): number {
  if (typeof value !== 'string' || !/^\d+$/u.test(value)) return Number.NaN;
  return Number(value);
}

export async function run(ctx: Ctx): Promise<number> {
  if (!ctx.providerRuntime) {
    ctx.err('worker runtime is unavailable');
    return io.EXIT.ERROR;
  }

  const controller = new AbortController();
  let processSignal: NodeJS.Signals | null = null;
  const onInterrupt = (): void => {
    processSignal = 'SIGINT';
    controller.abort();
  };
  const onTerminate = (): void => {
    processSignal = 'SIGTERM';
    controller.abort();
  };
  const relayInjectedAbort = (): void => controller.abort();
  process.once('SIGINT', onInterrupt);
  process.once('SIGTERM', onTerminate);
  ctx.workerSignal?.addEventListener('abort', relayInjectedAbort, { once: true });
  if (ctx.workerSignal?.aborted) controller.abort();

  try {
    const prompt = io.readInputSpec(String(ctx.values.prompt), { stdin: ctx.stdin });
    const result = await runSessionBoundCursorWorker({
      harness: String(ctx.values.harness || ''),
      model: String(ctx.values.model || ''),
      effort: String(ctx.values.effort || ''),
      workspace: String(ctx.values.workspace || ''),
      prompt,
      timeoutMs: positiveInteger(ctx.values['timeout-ms']),
      maxOutputBytes: positiveInteger(ctx.values['max-output-bytes']),
      env: ctx.env,
      runtime: ctx.providerRuntime,
      signal: controller.signal,
    });
    ctx.out(`${io.jsonOk(result)}\n`);
    if (result.state === 'succeeded') return io.EXIT.OK;
    if (result.state === 'cancelled' && processSignal === 'SIGINT') return 130;
    if (result.state === 'cancelled' && processSignal === 'SIGTERM') return 143;
    return io.EXIT.ERROR;
  } finally {
    process.removeListener('SIGINT', onInterrupt);
    process.removeListener('SIGTERM', onTerminate);
    ctx.workerSignal?.removeEventListener('abort', relayInjectedAbort);
  }
}
