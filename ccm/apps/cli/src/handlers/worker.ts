import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  BoardIdentity,
  BoardWriteAuthority,
  canonicalSha256Digest,
  DispatchKey,
  TaskRef,
} from '@ccm/engine';
import * as io from '../io.js';
import { redactProviderDiagnostic } from '../provider-evidence.js';
import { BoardAgentRegistryRepository } from '../tracked-dispatch-repository.js';
import { dispatchTrackedWorker } from '../tracked-worker-dispatcher.js';
import { workerDescriptor } from '../worker-descriptors.js';
import {
  rejectedWorkerProcess,
  runWorkerProcess,
  type WorkerProcessRequest,
  type WorkerProcessResult,
} from '../worker-process.js';
import { type Ctx, resolveBoardIgnoringGoal } from './_common.js';

const HELP_TIMEOUT_MS = 10_000;
// A real agent dispatch (codex/claude/cursor/kimi producing a plan, diff, or state) routinely runs
// well past two minutes; the former 120 s default silently killed long tasks whenever the caller
// omitted --timeout-ms. Default generously (still bounded by MAX_TIMEOUT_MS = 2 h) so the common
// documented `ccm worker run ... -- <argv>` path does not truncate honest long-running work.
const RUN_TIMEOUT_MS = 600_000;
// Match worker-process MAX_OUTPUT_BYTES so callers that omit --max-output-bytes get the full stdout
// ceiling instead of a 1 MiB cap that kills large-output dispatches mid-task.
const DEFAULT_MAX_OUTPUT_BYTES = 536_870_912;

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
  descriptor: NonNullable<ReturnType<typeof workerDescriptor>>,
  providerArgv: string[],
  help: boolean,
): Omit<WorkerProcessRequest, 'signal'> | null {
  if (!ctx.providerRuntime) return null;
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
  const descriptor = workerDescriptor(String(ctx.values.harness || ''));
  const scope = String(ctx.values.scope || 'agent');
  const providerArgv = [
    ...(scope === 'root' ? [] : (descriptor?.defaultAgentHelpPrefix ?? [])),
    '--help',
  ];
  const request = descriptor ? commonRequest(ctx, descriptor, providerArgv, true) : null;
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
  const harness = String(ctx.values.harness || '');
  const descriptor = workerDescriptor(harness);
  if (!descriptor) {
    ctx.out(
      `${io.jsonOk(
        rejectedWorkerProcess({
          harness,
          providerArgv: ctx.positionals.slice(),
          cwd: String(ctx.values.cwd || process.cwd()),
          code: 'unknown_harness',
          message: `unsupported worker harness: ${harness}`,
        }),
      )}\n`,
    );
    return io.EXIT.ERROR;
  }
  const request = commonRequest(ctx, descriptor, ctx.positionals.slice(), false);
  if (!request) {
    ctx.err('worker runtime or harness descriptor is unavailable');
    return io.EXIT.ERROR;
  }
  const { result, processSignal } = await withSignalRelay(ctx, request);
  ctx.out(`${io.jsonOk(result)}\n`);
  return mirrorExit(result, processSignal);
}

export async function dispatch(ctx: Ctx): Promise<number> {
  const harness = String(ctx.values.harness || '');
  const descriptor = workerDescriptor(harness);
  if (!descriptor || !ctx.providerRuntime) {
    ctx.err(`worker runtime or harness descriptor is unavailable: ${harness}\n`);
    return io.EXIT.ERROR;
  }
  const execution = ctx.workerExecutionDirectory?.forHarness(harness, 'headless-cli');
  if (!execution) {
    ctx.err(`worker execution capability is unavailable: ${harness}\n`);
    return io.EXIT.ERROR;
  }
  const resolved = resolveBoardIgnoringGoal(ctx);
  const canonicalBoardPath = fs.realpathSync(resolved.boardPath);
  const identity = BoardIdentity.fromCanonicalPath(canonicalBoardPath);
  const selectionSource = ctx.values.board ? 'explicit-board' : 'active-board-resolution';
  const board = resolved.board as { owner?: { session_id?: unknown } };
  const ownerSessionId =
    selectionSource === 'active-board-resolution' &&
    typeof board.owner?.session_id === 'string' &&
    board.owner.session_id !== ''
      ? board.owner.session_id
      : undefined;
  const authority = BoardWriteAuthority.create({
    canonicalBoardPath,
    boardIdentity: identity,
    ownerSessionId,
    selectionSource,
  });
  const cwd = fs.realpathSync(path.resolve(String(ctx.values.cwd || process.cwd())));
  const request = commonRequest(ctx, descriptor, ctx.positionals.slice(), false);
  if (!request) {
    ctx.err('worker runtime is unavailable\n');
    return io.EXIT.ERROR;
  }
  request.cwd = cwd;
  const transcriptRef =
    typeof ctx.values.transcript === 'string' && ctx.values.transcript.trim() !== ''
      ? ctx.values.transcript.trim()
      : null;
  const key = DispatchKey.create(String(ctx.values['idempotency-key'] || ''));
  const task = TaskRef.create(identity, String(ctx.values.task || ''));
  const requestDigest = canonicalSha256Digest({
    schema: 'ccm/tracked-worker-request-digest/v1',
    harness,
    task_id: task.taskId,
    cwd,
    timeout_ms: request.timeoutMs,
    max_output_bytes: request.maxOutputBytes,
    stdin_mode: request.stdinFd === 'ignore' ? 'ignore' : 'inherited-fd',
    // The explicit key owns business idempotency. Persisted digest material is deliberately
    // structural and non-sensitive: never hash prompts, provider argv content, stdin, or env into
    // the board where equality/dictionary attacks could recover low-entropy secrets.
    provider_argv_count: request.providerArgv.length,
    // An explicit transcript path is intentionally board-visible evidence (the same value is
    // persisted on handle.transcript_ref); unlike provider argv/prompt/env it is not secret input.
    transcript_ref: transcriptRef,
  });

  const controller = new AbortController();
  const relay = (): void => controller.abort();
  const onInterrupt = (): void => relay();
  const onTerminate = (): void => relay();
  const onHangup = (): void => relay();
  process.once('SIGINT', onInterrupt);
  process.once('SIGTERM', onTerminate);
  process.once('SIGHUP', onHangup);
  ctx.workerSignal?.addEventListener('abort', relay, { once: true });
  if (ctx.workerSignal?.aborted) controller.abort();
  try {
    const dispatchResult = await dispatchTrackedWorker(
      {
        authority,
        task,
        key,
        requestDigest,
        harness: descriptor.harness,
        intent: redactProviderDiagnostic(String(ctx.values.intent || '')),
        workerRequest: { ...request, signal: controller.signal },
        transcriptRef,
      },
      {
        repository: new BoardAgentRegistryRepository({
          writeFileAtomicSync: ctx.writeFileAtomicSync,
        }),
        execution: execution.face,
        now: () => new Date().toISOString().replace(/\.\d{3}Z$/u, 'Z'),
        claimToken: randomUUID,
        launcherPid: process.pid,
      },
    );
    ctx.out(`${io.jsonOk(dispatchResult)}\n`);
    return dispatchResult.exitCode;
  } finally {
    process.removeListener('SIGINT', onInterrupt);
    process.removeListener('SIGTERM', onTerminate);
    process.removeListener('SIGHUP', onHangup);
    ctx.workerSignal?.removeEventListener('abort', relay);
  }
}
