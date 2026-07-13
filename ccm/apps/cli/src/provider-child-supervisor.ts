// Process supervision for provider probes and executions.
//
// This module deliberately has no spawn authority. Callers create a child through their runtime
// boundary, then immediately hand the ChildProcess to this supervisor. A request creates one
// absolute deadline and shares it across every version/help/app-server/exec child.

import type { ProviderOwnedChild } from './provider-runtime.js';

export const PROVIDER_REQUEST_DEADLINE_SCHEMA = 'ccm/provider-request-deadline/v1' as const;

export interface ProviderRequestDeadline {
  schema: typeof PROVIDER_REQUEST_DEADLINE_SCHEMA;
  /** Absolute Unix epoch deadline. Reuse this object for every child in one request. */
  expiresAtMs: number;
}

export interface ProviderChildLimits {
  startupTimeoutMs: number;
  idleTimeoutMs: number;
  stdoutLimitBytes: number;
  stderrLimitBytes: number;
  /** Time from SIGTERM to SIGKILL. */
  terminationGraceMs: number;
  /** Maximum time after SIGKILL to observe close/reap proof. */
  reapTimeoutMs: number;
}

export type ProviderChildStream = 'stdout' | 'stderr';
export type ProviderChildTimeoutCode = 'startup_timeout' | 'idle_timeout' | 'hard_timeout';
export type ProviderChildSupervisorErrorCode =
  | ProviderChildTimeoutCode
  | 'cancelled'
  | 'spawn_error'
  | 'stdio_unavailable'
  | 'byte_stream_required'
  | 'invalid_utf8'
  | 'output_limit'
  | 'consumer_error'
  | 'owned_tree_survived';

export interface ProviderChildTermination {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  /** True only after launcher `close` and proof that the complete owned process tree is gone. */
  reaped: boolean;
}

interface ProviderChildSupervisorErrorInit {
  code: ProviderChildSupervisorErrorCode;
  operation: string;
  message?: string;
  stream?: ProviderChildStream;
  limitBytes?: number;
  observedBytes?: number;
  cause?: unknown;
}

export class ProviderChildSupervisorError extends Error {
  readonly code: ProviderChildSupervisorErrorCode;
  readonly operation: string;
  readonly stream?: ProviderChildStream;
  readonly limitBytes?: number;
  readonly observedBytes?: number;
  termination: ProviderChildTermination | null = null;
  /** True means bounded escalation completed but the handle never supplied close/reap proof. */
  reapTimedOut = false;

  constructor(init: ProviderChildSupervisorErrorInit) {
    super(init.message ?? `${init.operation}: ${init.code}`, { cause: init.cause });
    this.name = 'ProviderChildSupervisorError';
    this.code = init.code;
    this.operation = init.operation;
    this.stream = init.stream;
    this.limitBytes = init.limitBytes;
    this.observedBytes = init.observedBytes;
  }
}

export interface ProviderChildResult {
  operation: string;
  stdout: string;
  stderr: string;
  stdoutBytes: number;
  stderrBytes: number;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  reaped: true;
  startedAtMs: number;
  closedAtMs: number;
  durationMs: number;
}

export interface SuperviseProviderChildOptions {
  operation: string;
  /** One request-scoped absolute deadline, shared by all supervised children. */
  deadline: ProviderRequestDeadline;
  limits: ProviderChildLimits;
  signal?: AbortSignal;
  /** Decoded fragments remain incremental; callers doing JSONL must retain their own line buffer. */
  onStdoutText?: (text: string) => void;
  onStderrText?: (text: string) => void;
  /** OS-spawn notification for stdin handoff; only the first provider output byte ends startup. */
  onStarted?: () => void;
}

interface StreamCollector {
  decoder: TextDecoder;
  fragments: string[];
  bytes: number;
  ended: boolean;
}

const MAX_TIMER_DELAY_MS = 2_147_483_647;

export function createProviderRequestDeadline(hardTimeoutMs: number): ProviderRequestDeadline {
  assertPositiveFinite(hardTimeoutMs, 'hardTimeoutMs');
  const expiresAtMs = Date.now() + hardTimeoutMs;
  if (!Number.isSafeInteger(expiresAtMs)) {
    throw new RangeError('hardTimeoutMs produces an unsafe absolute deadline');
  }
  return Object.freeze({
    schema: PROVIDER_REQUEST_DEADLINE_SCHEMA,
    expiresAtMs,
  });
}

/**
 * Supervise one already-spawned provider child.
 *
 * The promise resolves only after `close`; nonzero exit is preserved for the caller to reject.
 * OS spawn and provider activity are separate states: `onStarted` permits stdin handoff, while the
 * startup timer remains armed until the first non-empty stdout/stderr byte and idle begins there.
 * Failures trigger TERM, bounded escalation to KILL, and normally reject only after `close`. If a
 * broken/custom ChildProcess never emits `close` after KILL, the same primary error is returned
 * with `reapTimedOut=true` and `termination.reaped=false` rather than silently claiming a reap.
 */
export function superviseProviderChild(
  ownedChild: ProviderOwnedChild,
  options: SuperviseProviderChildOptions,
): Promise<ProviderChildResult> {
  validateOptions(options);
  validateOwnedChild(ownedChild);
  const { child, tree } = ownedChild;

  return new Promise((resolve, reject) => {
    const supervisionStartedAtMs = Date.now();
    const stdout: StreamCollector = {
      decoder: new TextDecoder('utf-8', { fatal: true }),
      fragments: [],
      bytes: 0,
      ended: false,
    };
    const stderr: StreamCollector = {
      decoder: new TextDecoder('utf-8', { fatal: true }),
      fragments: [],
      bytes: 0,
      ended: false,
    };

    let spawned = false;
    let activityObserved = false;
    let startedAtMs = supervisionStartedAtMs;
    let lastActivityAtMs = supervisionStartedAtMs;
    let closed = false;
    let treeGone = false;
    let settled = false;
    let primaryFailure: ProviderChildSupervisorError | null = null;
    let startupTimer: NodeJS.Timeout | null = null;
    let idleTimer: NodeJS.Timeout | null = null;
    let hardTimer: NodeJS.Timeout | null = null;
    let terminationTimer: NodeJS.Timeout | null = null;
    let reapTimer: NodeJS.Timeout | null = null;
    let reapPollTimer: NodeJS.Timeout | null = null;

    // A pending promise does not keep Node alive. These timers intentionally remain ref'ed until
    // clearAllTimers() so timeout and process-tree cleanup still reach a bounded terminal state
    // when the caller has no unrelated active handle.

    const clearTimer = (timer: NodeJS.Timeout | null): void => {
      if (timer) clearTimeout(timer);
    };

    const clearOperationalTimers = (): void => {
      clearTimer(startupTimer);
      startupTimer = null;
      clearTimer(idleTimer);
      idleTimer = null;
      clearTimer(hardTimer);
      hardTimer = null;
    };

    const clearAllTimers = (): void => {
      clearOperationalTimers();
      clearTimer(terminationTimer);
      terminationTimer = null;
      clearTimer(reapTimer);
      reapTimer = null;
      clearTimer(reapPollTimer);
      reapPollTimer = null;
    };

    const terminationSnapshot = (reaped: boolean): ProviderChildTermination => ({
      exitCode: child.exitCode,
      signal: child.signalCode,
      reaped,
    });

    const rejectPrimaryFailure = (): void => {
      if (settled || !primaryFailure) return;
      settled = true;
      clearAllTimers();
      options.signal?.removeEventListener('abort', onAbort);
      reject(primaryFailure);
    };

    const observeTreeGone = (): boolean => {
      if (treeGone) return true;
      if (tree === null) {
        treeGone = true;
        return true;
      }
      try {
        treeGone = !tree.isAlive();
      } catch {
        // Losing kill/probe authority is not proof of termination. The bounded reap watchdog will
        // report the original failure without silently claiming tree cleanup.
        treeGone = false;
      }
      return treeGone;
    };

    const maybeRejectAfterCleanup = (): boolean => {
      if (!primaryFailure || !closed || !observeTreeGone()) return false;
      primaryFailure.termination = terminationSnapshot(true);
      rejectPrimaryFailure();
      return true;
    };

    const pollForCleanup = (): void => {
      if (settled || !primaryFailure || maybeRejectAfterCleanup()) return;
      clearTimer(reapPollTimer);
      reapPollTimer = setTimeout(pollForCleanup, 5);
    };

    const armReapWatchdog = (): void => {
      if (reapTimer || settled) return;
      reapTimer = setTimeout(() => {
        if (settled || !primaryFailure || maybeRejectAfterCleanup()) return;
        primaryFailure.reapTimedOut = true;
        primaryFailure.termination = terminationSnapshot(false);
        rejectPrimaryFailure();
      }, options.limits.reapTimeoutMs);
    };

    const beginTermination = (): void => {
      if (tree === null) {
        treeGone = true;
        armReapWatchdog();
        pollForCleanup();
        return;
      }
      try {
        if (!tree.signal('SIGTERM')) treeGone = true;
      } catch {
        // A failed TERM attempt still advances to the bounded KILL step.
      }
      pollForCleanup();
      terminationTimer = setTimeout(() => {
        if (maybeRejectAfterCleanup()) return;
        try {
          if (!tree.signal('SIGKILL')) treeGone = true;
        } catch {
          // The reap watchdog below reports that close proof was unavailable.
        }
        armReapWatchdog();
        pollForCleanup();
      }, options.limits.terminationGraceMs);
    };

    const fail = (error: ProviderChildSupervisorError): void => {
      if (settled || primaryFailure) return;
      primaryFailure = error;
      clearOperationalTimers();
      beginTermination();
    };

    const timeoutFailure = (requested: ProviderChildTimeoutCode): void => {
      if (settled || primaryFailure || closed) return;
      const now = Date.now();
      let code: ProviderChildTimeoutCode = requested;
      if (now >= options.deadline.expiresAtMs) code = 'hard_timeout';
      else if (requested === 'startup_timeout' && activityObserved) return;
      else if (requested === 'idle_timeout') {
        if (!activityObserved) return;
        if (now < lastActivityAtMs + options.limits.idleTimeoutMs) {
          armIdleTimer();
          return;
        }
      }
      fail(
        new ProviderChildSupervisorError({
          code,
          operation: options.operation,
          message: `${options.operation}: ${code}`,
        }),
      );
    };

    const scheduleAt = (
      atMs: number,
      action: () => void,
      setCurrentTimer: (timer: NodeJS.Timeout | null) => void,
    ): void => {
      const run = (): void => {
        const remainingMs = atMs - Date.now();
        if (remainingMs <= 0) {
          setCurrentTimer(null);
          action();
          return;
        }
        setCurrentTimer(setTimeout(run, Math.min(remainingMs, MAX_TIMER_DELAY_MS)));
      };
      setCurrentTimer(
        setTimeout(run, Math.min(Math.max(0, atMs - Date.now()), MAX_TIMER_DELAY_MS)),
      );
    };

    const armIdleTimer = (): void => {
      if (!activityObserved) return;
      clearTimer(idleTimer);
      scheduleAt(
        lastActivityAtMs + options.limits.idleTimeoutMs,
        () => timeoutFailure('idle_timeout'),
        (timer) => {
          idleTimer = timer;
        },
      );
    };

    const markSpawned = (): void => {
      if (spawned || settled || closed) return;
      spawned = true;
      startedAtMs = Date.now();
      if (options.onStarted) {
        try {
          options.onStarted();
        } catch (cause) {
          fail(
            new ProviderChildSupervisorError({
              code: 'consumer_error',
              operation: options.operation,
              message: `${options.operation}: onStarted callback failed`,
              cause,
            }),
          );
        }
      }
    };

    const observeActivity = (): void => {
      if (!activityObserved) {
        activityObserved = true;
        clearTimer(startupTimer);
        startupTimer = null;
      }
      lastActivityAtMs = Date.now();
      armIdleTimer();
    };

    const emitText = (stream: ProviderChildStream, text: string): void => {
      if (!text || primaryFailure) return;
      const callback = stream === 'stdout' ? options.onStdoutText : options.onStderrText;
      if (!callback) return;
      try {
        callback(text);
      } catch (cause) {
        fail(
          new ProviderChildSupervisorError({
            code: 'consumer_error',
            operation: options.operation,
            stream,
            message: `${options.operation}: ${stream} consumer failed`,
            cause,
          }),
        );
      }
    };

    const collect = (
      stream: ProviderChildStream,
      collector: StreamCollector,
      chunk: unknown,
    ): void => {
      if (settled || primaryFailure) return;
      markSpawned();
      if (typeof chunk === 'string') {
        fail(
          new ProviderChildSupervisorError({
            code: 'byte_stream_required',
            operation: options.operation,
            stream,
            message: `${options.operation}: ${stream} arrived after lossy string decoding`,
          }),
        );
        return;
      }
      if (!(chunk instanceof Uint8Array)) {
        fail(
          new ProviderChildSupervisorError({
            code: 'byte_stream_required',
            operation: options.operation,
            stream,
            message: `${options.operation}: ${stream} emitted a non-byte chunk`,
          }),
        );
        return;
      }
      if (chunk.byteLength > 0) observeActivity();

      collector.bytes += chunk.byteLength;
      const limitBytes =
        stream === 'stdout' ? options.limits.stdoutLimitBytes : options.limits.stderrLimitBytes;
      if (collector.bytes > limitBytes) {
        fail(
          new ProviderChildSupervisorError({
            code: 'output_limit',
            operation: options.operation,
            stream,
            limitBytes,
            observedBytes: collector.bytes,
            message: `${options.operation}: ${stream} exceeded ${limitBytes} bytes`,
          }),
        );
        return;
      }

      try {
        const text = collector.decoder.decode(chunk, { stream: true });
        if (text) collector.fragments.push(text);
        emitText(stream, text);
      } catch (cause) {
        fail(
          new ProviderChildSupervisorError({
            code: 'invalid_utf8',
            operation: options.operation,
            stream,
            message: `${options.operation}: ${stream} contains invalid UTF-8`,
            cause,
          }),
        );
        return;
      }
    };

    const finalizeCollector = (stream: ProviderChildStream, collector: StreamCollector): void => {
      if (collector.ended || primaryFailure) return;
      collector.ended = true;
      try {
        const text = collector.decoder.decode();
        if (text) collector.fragments.push(text);
        emitText(stream, text);
      } catch (cause) {
        fail(
          new ProviderChildSupervisorError({
            code: 'invalid_utf8',
            operation: options.operation,
            stream,
            message: `${options.operation}: ${stream} ends with incomplete UTF-8`,
            cause,
          }),
        );
      }
    };

    const onClose = (exitCode: number | null, signal: NodeJS.Signals | null): void => {
      if (closed) return;
      closed = true;
      clearOperationalTimers();
      finalizeCollector('stdout', stdout);
      finalizeCollector('stderr', stderr);
      const closedAtMs = Date.now();
      if (primaryFailure) {
        maybeRejectAfterCleanup();
        return;
      }
      if (!observeTreeGone()) {
        primaryFailure = new ProviderChildSupervisorError({
          code: 'owned_tree_survived',
          operation: options.operation,
          message: `${options.operation}: launcher closed while its owned process tree remained alive`,
        });
        beginTermination();
        return;
      }
      if (settled) return;
      settled = true;
      clearAllTimers();
      options.signal?.removeEventListener('abort', onAbort);
      resolve({
        operation: options.operation,
        stdout: stdout.fragments.join(''),
        stderr: stderr.fragments.join(''),
        stdoutBytes: stdout.bytes,
        stderrBytes: stderr.bytes,
        exitCode,
        signal,
        reaped: true,
        startedAtMs,
        closedAtMs,
        durationMs: closedAtMs - supervisionStartedAtMs,
      });
    };

    const onError = (cause: Error): void => {
      fail(
        new ProviderChildSupervisorError({
          code: 'spawn_error',
          operation: options.operation,
          message: `${options.operation}: child process error: ${cause.message}`,
          cause,
        }),
      );
    };

    function onAbort(): void {
      fail(
        new ProviderChildSupervisorError({
          code: 'cancelled',
          operation: options.operation,
          message: `${options.operation}: cancelled`,
          cause: options.signal?.reason,
        }),
      );
    }

    const hardTimeoutAction = (): void => timeoutFailure('hard_timeout');

    child.once('spawn', markSpawned);
    child.once('error', onError);
    child.once('close', onClose);
    child.stdout?.on('data', (chunk: unknown) => collect('stdout', stdout, chunk));
    child.stderr?.on('data', (chunk: unknown) => collect('stderr', stderr, chunk));
    child.stdout?.once('end', () => finalizeCollector('stdout', stdout));
    child.stderr?.once('end', () => finalizeCollector('stderr', stderr));

    if (options.signal) {
      options.signal.addEventListener('abort', onAbort, { once: true });
    }

    scheduleAt(options.deadline.expiresAtMs, hardTimeoutAction, (timer) => {
      hardTimer = timer;
    });
    scheduleAt(
      supervisionStartedAtMs + options.limits.startupTimeoutMs,
      () => timeoutFailure('startup_timeout'),
      (timer) => {
        startupTimer = timer;
      },
    );

    if (child.stdout === null || child.stderr === null) {
      fail(
        new ProviderChildSupervisorError({
          code: 'stdio_unavailable',
          operation: options.operation,
          message: `${options.operation}: stdout and stderr must both be piped`,
        }),
      );
      return;
    }
    if (child.stdout.readableEncoding !== null || child.stderr.readableEncoding !== null) {
      fail(
        new ProviderChildSupervisorError({
          code: 'byte_stream_required',
          operation: options.operation,
          message: `${options.operation}: provider streams must remain in raw byte mode`,
        }),
      );
      return;
    }
    if (options.signal?.aborted) {
      onAbort();
      return;
    }
    if (child.exitCode !== null || child.signalCode !== null) {
      queueMicrotask(() => onClose(child.exitCode, child.signalCode));
      return;
    }
    if (typeof child.pid === 'number') markSpawned();
  });
}

function validateOptions(options: SuperviseProviderChildOptions): void {
  if (!options.operation.trim()) throw new TypeError('operation must be non-empty');
  if (options.deadline.schema !== PROVIDER_REQUEST_DEADLINE_SCHEMA) {
    throw new TypeError('deadline schema is unsupported');
  }
  if (!Number.isSafeInteger(options.deadline.expiresAtMs)) {
    throw new TypeError('deadline expiresAtMs must be a safe integer');
  }
  assertPositiveFinite(options.limits.startupTimeoutMs, 'startupTimeoutMs');
  assertPositiveFinite(options.limits.idleTimeoutMs, 'idleTimeoutMs');
  assertNonNegativeInteger(options.limits.stdoutLimitBytes, 'stdoutLimitBytes');
  assertNonNegativeInteger(options.limits.stderrLimitBytes, 'stderrLimitBytes');
  assertPositiveFinite(options.limits.terminationGraceMs, 'terminationGraceMs');
  assertPositiveFinite(options.limits.reapTimeoutMs, 'reapTimeoutMs');
}

function validateOwnedChild(ownedChild: ProviderOwnedChild): void {
  if (!ownedChild || typeof ownedChild !== 'object') {
    throw new TypeError('owned provider child is required');
  }
  if (!ownedChild.child) {
    throw new TypeError('owned provider child must include a child handle');
  }
  if (ownedChild.tree === null) {
    if (Number.isSafeInteger(ownedChild.child.pid) && Number(ownedChild.child.pid) > 0) {
      throw new TypeError('spawned provider child with a PID must include a tree handle');
    }
    return;
  }
  if (ownedChild.tree.kind !== 'posix-process-group') {
    throw new TypeError('owned provider child tree kind is unsupported');
  }
  if (!Number.isSafeInteger(ownedChild.tree.groupId) || ownedChild.tree.groupId <= 0) {
    throw new TypeError('owned provider child process group must be a positive safe integer');
  }
}

function assertPositiveFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive finite number`);
  }
}

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer`);
  }
}
