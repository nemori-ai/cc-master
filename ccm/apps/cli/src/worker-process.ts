import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  createProviderRequestDeadline,
  type ProviderChildResult,
  ProviderChildSupervisorError,
  superviseProviderChild,
} from './provider-child-supervisor.js';
import { ProviderProcessTreeOwnershipError, type ProviderRuntime } from './provider-runtime.js';
import type { WorkerDescriptor } from './worker-descriptors.js';

export const WORKER_PROCESS_RESULT_SCHEMA = 'ccm/worker-process-result/v1' as const;

export type WorkerProcessState = 'exited' | 'timed_out' | 'cancelled' | 'failed' | 'rejected';

export interface WorkerProcessRequest {
  descriptor: WorkerDescriptor;
  providerArgv: string[];
  cwd: string;
  timeoutMs: number;
  maxOutputBytes: number;
  stdinFd: number | 'ignore';
  env: Record<string, string | undefined>;
  runtime: ProviderRuntime;
  signal?: AbortSignal;
}

export interface WorkerProcessResult {
  schema: typeof WORKER_PROCESS_RESULT_SCHEMA;
  harness: WorkerDescriptor['harness'];
  executable: string | null;
  argv: string[];
  cwd: string;
  state: WorkerProcessState;
  exit_code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  stdout_bytes: number;
  stderr_bytes: number;
  truncated: { stdout: boolean; stderr: boolean };
  timed_out: boolean;
  cancelled: boolean;
  reaped: boolean;
  duration_ms: number | null;
  cleanup: { temporary_resources_removed: true };
  error: { code: string; message: string } | null;
}

const MAX_TIMEOUT_MS = 600_000;
const MAX_OUTPUT_BYTES = 1_048_576;
const STDERR_LIMIT_BYTES = 1_048_576;

function baseResult(request: WorkerProcessRequest): WorkerProcessResult {
  return {
    schema: WORKER_PROCESS_RESULT_SCHEMA,
    harness: request.descriptor.harness,
    executable: null,
    argv: [...request.descriptor.agentPrefix, ...request.providerArgv],
    cwd: request.cwd,
    state: 'rejected',
    exit_code: null,
    signal: null,
    stdout: '',
    stderr: '',
    stdout_bytes: 0,
    stderr_bytes: 0,
    truncated: { stdout: false, stderr: false },
    timed_out: false,
    cancelled: false,
    reaped: false,
    duration_ms: null,
    cleanup: { temporary_resources_removed: true },
    error: null,
  };
}

function fail(
  result: WorkerProcessResult,
  state: WorkerProcessState,
  code: string,
  message: string,
): WorkerProcessResult {
  result.state = state;
  result.error = { code, message };
  return result;
}

function validate(request: WorkerProcessRequest): string | null {
  if (!path.isAbsolute(request.cwd)) return '--cwd must be an absolute path';
  try {
    if (!fs.statSync(request.cwd).isDirectory()) return '--cwd must name a directory';
  } catch {
    return '--cwd must name an existing directory';
  }
  if (
    !Number.isSafeInteger(request.timeoutMs) ||
    request.timeoutMs < 50 ||
    request.timeoutMs > MAX_TIMEOUT_MS
  ) {
    return `--timeout-ms must be an integer from 50 through ${MAX_TIMEOUT_MS}`;
  }
  if (
    !Number.isSafeInteger(request.maxOutputBytes) ||
    request.maxOutputBytes < 256 ||
    request.maxOutputBytes > MAX_OUTPUT_BYTES
  ) {
    return `--max-output-bytes must be an integer from 256 through ${MAX_OUTPUT_BYTES}`;
  }
  if (request.stdinFd !== 'ignore' && !Number.isSafeInteger(request.stdinFd)) {
    return 'stdin fd must be a safe integer';
  }
  return null;
}

function childEnvironment(source: Record<string, string | undefined>): Record<string, string> {
  const allowed = [
    'HOME',
    'USER',
    'LOGNAME',
    'SHELL',
    'XDG_CONFIG_HOME',
    'XDG_CACHE_HOME',
    'XDG_DATA_HOME',
    'XDG_STATE_HOME',
    'LANG',
    'LC_ALL',
    'TERM',
    'CLAUDE_CONFIG_DIR',
    'CODEX_HOME',
  ] as const;
  const env: Record<string, string> = {
    HOME: source.HOME || os.homedir(),
    NO_COLOR: '1',
    PATH: source.PATH || process.env.PATH || '/usr/bin:/bin',
  };
  for (const name of allowed) {
    const value = source[name];
    if (value !== undefined && value !== '') env[name] = value;
  }
  return env;
}

function recordChild(result: WorkerProcessResult, child: ProviderChildResult): WorkerProcessResult {
  result.state = 'exited';
  result.exit_code = child.exitCode;
  result.signal = child.signal;
  result.stdout = child.stdout;
  result.stderr = child.stderr;
  result.stdout_bytes = child.stdoutBytes;
  result.stderr_bytes = child.stderrBytes;
  result.reaped = child.reaped;
  result.duration_ms = child.durationMs;
  return result;
}

function recordSupervisorFailure(
  result: WorkerProcessResult,
  error: ProviderChildSupervisorError,
): WorkerProcessResult {
  const timedOut = error.code.endsWith('_timeout');
  const cancelled = error.code === 'cancelled';
  result.state = timedOut ? 'timed_out' : cancelled ? 'cancelled' : 'failed';
  result.exit_code = error.termination?.exitCode ?? null;
  result.signal = error.termination?.signal ?? null;
  result.stdout_bytes = error.stream === 'stdout' ? (error.observedBytes ?? 0) : 0;
  result.stderr_bytes = error.stream === 'stderr' ? (error.observedBytes ?? 0) : 0;
  result.truncated = {
    stdout: error.code === 'output_limit' && error.stream === 'stdout',
    stderr: error.code === 'output_limit' && error.stream === 'stderr',
  };
  result.timed_out = timedOut;
  result.cancelled = cancelled;
  result.reaped = error.termination?.reaped ?? false;
  result.error = { code: error.code, message: error.message };
  return result;
}

export async function runWorkerProcess(
  request: WorkerProcessRequest,
): Promise<WorkerProcessResult> {
  const result = baseResult(request);
  const validation = validate(request);
  if (validation) return fail(result, 'rejected', 'request_rejected', validation);

  let cwd: string;
  try {
    cwd = fs.realpathSync(request.cwd);
  } catch (error) {
    return fail(result, 'rejected', 'request_rejected', String((error as Error)?.message || error));
  }
  result.cwd = cwd;

  const executable = request.runtime.process.resolveExecutable(request.descriptor.executableKey);
  if (!executable) {
    return fail(
      result,
      'rejected',
      'executable_unavailable',
      `${request.descriptor.executableKey} is unavailable`,
    );
  }
  try {
    result.executable = fs.realpathSync(executable);
  } catch (error) {
    return fail(
      result,
      'rejected',
      'executable_unavailable',
      String((error as Error)?.message || error),
    );
  }

  try {
    const owned = request.runtime.process.spawnProvider({
      executable: result.executable,
      argv: result.argv,
      cwd,
      env: childEnvironment(request.env),
      stdio: [request.stdinFd, 'pipe', 'pipe'],
    });
    const child = await superviseProviderChild(owned, {
      operation: `raw ${request.descriptor.harness} worker`,
      deadline: createProviderRequestDeadline(request.timeoutMs),
      limits: {
        // Raw workers have one caller-visible timeout. A shorter hidden startup/idle budget would
        // terminate a legitimately quiet agent before the public --timeout-ms contract expires.
        startupTimeoutMs: request.timeoutMs,
        idleTimeoutMs: request.timeoutMs,
        stdoutLimitBytes: request.maxOutputBytes,
        stderrLimitBytes: Math.min(request.maxOutputBytes, STDERR_LIMIT_BYTES),
        terminationGraceMs: 100,
        reapTimeoutMs: 1_000,
      },
      signal: request.signal,
    });
    return recordChild(result, child);
  } catch (error) {
    if (error instanceof ProviderChildSupervisorError) {
      return recordSupervisorFailure(result, error);
    }
    if (error instanceof ProviderProcessTreeOwnershipError) {
      return fail(result, 'rejected', error.code, error.message);
    }
    return fail(result, 'failed', 'spawn_error', String((error as Error)?.message || error));
  }
}
