import * as io from '../io.js';
import { workerDescriptor } from '../worker-descriptors.js';
import {
  runWorkerProcess,
  type WorkerProcessRequest,
  type WorkerProcessResult,
} from '../worker-process.js';
import type { Ctx } from './_common.js';

const HELP_TIMEOUT_MS = 10_000;
const RUN_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_OUTPUT_BYTES = 1_048_576;

function positiveInteger(value: unknown, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^\d+$/u.test(value)) return Number.NaN;
  return Number(value);
}

function signalExitCode(signal: NodeJS.Signals | null): number | null {
  switch (signal) {
    case 'SIGHUP':
      return 129;
    case 'SIGINT':
      return 130;
    case 'SIGTERM':
      return 143;
    default:
      return signal === null ? null : io.EXIT.ERROR;
  }
}

function mirrorExit(result: WorkerProcessResult, processSignal: NodeJS.Signals | null): number {
  if (result.state === 'cancelled') return signalExitCode(processSignal) ?? io.EXIT.ERROR;
  if (result.state !== 'exited') return io.EXIT.ERROR;
  const signalCode = signalExitCode(result.signal);
  if (signalCode !== null) return signalCode;
  const code = result.exit_code;
  return Number.isSafeInteger(code) && Number(code) >= 0 && Number(code) <= 255
    ? Number(code)
    : io.EXIT.ERROR;
}

async function withSignalRelay(
  ctx: Ctx,
  request: Omit<WorkerProcessRequest, 'signal'>,
): Promise<{ result: WorkerProcessResult; processSignal: NodeJS.Signals | null }> {
  const controller = new AbortController();
  let processSignal: NodeJS.Signals | null = null;
  const abortWith = (signal: NodeJS.Signals): void => {
    processSignal = signal;
    controller.abort();
  };
  const onInterrupt = (): void => abortWith('SIGINT');
  const onTerminate = (): void => abortWith('SIGTERM');
  const onHangup = (): void => abortWith('SIGHUP');
  const relayInjectedAbort = (): void => controller.abort();
  process.once('SIGINT', onInterrupt);
  process.once('SIGTERM', onTerminate);
  process.once('SIGHUP', onHangup);
  ctx.workerSignal?.addEventListener('abort', relayInjectedAbort, { once: true });
  if (ctx.workerSignal?.aborted) controller.abort();
  try {
    const result = await runWorkerProcess({ ...request, signal: controller.signal });
    return { result, processSignal };
  } finally {
    process.removeListener('SIGINT', onInterrupt);
    process.removeListener('SIGTERM', onTerminate);
    process.removeListener('SIGHUP', onHangup);
    ctx.workerSignal?.removeEventListener('abort', relayInjectedAbort);
  }
}

function commonRequest(
  ctx: Ctx,
  providerArgv: string[],
  help: boolean,
): Omit<WorkerProcessRequest, 'signal'> | null {
  if (!ctx.providerRuntime) return null;
  const descriptor = workerDescriptor(String(ctx.values.harness || ''));
  if (!descriptor) return null;
  return {
    descriptor,
    providerArgv,
    cwd: help ? process.cwd() : String(ctx.values.cwd || process.cwd()),
    timeoutMs: positiveInteger(ctx.values['timeout-ms'], help ? HELP_TIMEOUT_MS : RUN_TIMEOUT_MS),
    maxOutputBytes: positiveInteger(ctx.values['max-output-bytes'], DEFAULT_MAX_OUTPUT_BYTES),
    stdinFd: help ? 'ignore' : (ctx.stdin?.fd ?? 0),
    env: ctx.env,
    runtime: ctx.providerRuntime,
  };
}

export async function help(ctx: Ctx): Promise<number> {
  const request = commonRequest(ctx, ['--help'], true);
  if (!request) {
    ctx.err('worker runtime or harness descriptor is unavailable');
    return io.EXIT.ERROR;
  }
  const { result, processSignal } = await withSignalRelay(ctx, request);
  if (result.stdout) ctx.out(result.stdout);
  if (result.stderr) ctx.err(result.stderr);
  if (result.state !== 'exited' && result.error) {
    ctx.err(`${result.error.code}: ${result.error.message}\n`);
  }
  return mirrorExit(result, processSignal);
}

export async function run(ctx: Ctx): Promise<number> {
  const request = commonRequest(ctx, ctx.positionals.slice(), false);
  if (!request) {
    ctx.err('worker runtime or harness descriptor is unavailable');
    return io.EXIT.ERROR;
  }
  const { result, processSignal } = await withSignalRelay(ctx, request);
  ctx.out(`${io.jsonOk(result)}\n`);
  return mirrorExit(result, processSignal);
}
