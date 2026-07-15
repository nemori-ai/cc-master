import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { parseCursorStream } from './cursor-provider-driver.js';
import type { ProviderChildResult } from './provider-child-supervisor.js';
import {
  createProviderRequestDeadline,
  ProviderChildSupervisorError,
  superviseProviderChild,
} from './provider-child-supervisor.js';
import { redactProviderDiagnostic } from './provider-evidence.js';
import type { ProviderRuntime } from './provider-runtime.js';

export const SESSION_BOUND_WORKER_RESULT_SCHEMA = 'ccm/session-bound-worker-result/v1' as const;
export const SESSION_BOUND_READ_ONLY_WORKER_CONTRACT =
  'ccm/session-bound-read-only-worker/v1' as const;

export type SessionBoundWorkerState =
  | 'succeeded'
  | 'failed'
  | 'timed_out'
  | 'cancelled'
  | 'rejected';

export interface SessionBoundWorkerRequest {
  harness: string;
  model: string;
  effort: string;
  workspace: string;
  prompt: string;
  timeoutMs: number;
  maxOutputBytes: number;
  env: Record<string, string | undefined>;
  runtime: ProviderRuntime;
  signal?: AbortSignal;
}

export interface SessionBoundWorkerResult {
  schema: typeof SESSION_BOUND_WORKER_RESULT_SCHEMA;
  contract: typeof SESSION_BOUND_READ_ONLY_WORKER_CONTRACT;
  run_id: string;
  state: SessionBoundWorkerState;
  target: {
    harness: string;
    model: string;
    effort: string;
  };
  policy: {
    mode: 'ask';
    sandbox: 'enabled';
    account_mutation: 'forbidden';
    credential_write: 'forbidden';
    automatic_route: false;
    automatic_fallback: false;
  };
  lifecycle: {
    session_bound: true;
    survives_parent_exit: false;
    survives_handoff: false;
    survives_ccm_update: false;
  };
  handle: {
    kind: 'posix-process-group';
    id: string;
    group_id: number;
  } | null;
  terminal: {
    subtype: string;
    is_error: boolean;
    result: string;
    session_id: string;
  } | null;
  transport: {
    exit_code: number | null;
    signal: NodeJS.Signals | null;
    reaped: boolean;
    duration_ms: number | null;
    stdout_bytes: number;
    stderr_bytes: number;
  } | null;
  cleanup: { staging_removed: boolean };
  error: { code: string; message: string } | null;
}

const MAX_TIMEOUT_MS = 600_000;
const MAX_PROMPT_BYTES = 65_536;
const MAX_OUTPUT_BYTES = 1_048_576;
const STDERR_LIMIT_BYTES = 65_536;

function baseResult(request: SessionBoundWorkerRequest): SessionBoundWorkerResult {
  return {
    schema: SESSION_BOUND_WORKER_RESULT_SCHEMA,
    contract: SESSION_BOUND_READ_ONLY_WORKER_CONTRACT,
    run_id: randomUUID(),
    state: 'rejected',
    target: {
      harness: request.harness,
      model: request.model,
      effort: request.effort,
    },
    policy: {
      mode: 'ask',
      sandbox: 'enabled',
      account_mutation: 'forbidden',
      credential_write: 'forbidden',
      automatic_route: false,
      automatic_fallback: false,
    },
    lifecycle: {
      session_bound: true,
      survives_parent_exit: false,
      survives_handoff: false,
      survives_ccm_update: false,
    },
    handle: null,
    terminal: null,
    transport: null,
    cleanup: { staging_removed: true },
    error: null,
  };
}

function reject(
  request: SessionBoundWorkerRequest,
  code: string,
  message: string,
): SessionBoundWorkerResult {
  const result = baseResult(request);
  result.error = { code, message: redactProviderDiagnostic(message) };
  return result;
}

function validateRequest(request: SessionBoundWorkerRequest): string | null {
  if (request.harness !== 'cursor-agent') return 'only --harness cursor-agent is admitted';
  if (request.model !== 'composer-2.5') {
    return 'only the Cursor first-party model composer-2.5 is admitted';
  }
  if (request.effort !== 'standard') return 'only --effort standard is admitted';
  if (!path.isAbsolute(request.workspace)) return '--workspace must be an absolute path';
  try {
    if (!fs.statSync(request.workspace).isDirectory()) return '--workspace must name a directory';
  } catch {
    return '--workspace must name an existing directory';
  }
  if (request.prompt.trim().length === 0) return '--prompt must be non-empty';
  if (Buffer.byteLength(request.prompt, 'utf8') > MAX_PROMPT_BYTES) {
    return `--prompt exceeds ${MAX_PROMPT_BYTES} bytes`;
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
  return null;
}

function childEnvironment(
  source: Record<string, string | undefined>,
  stagingDirectory: string,
): Record<string, string> {
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
  ] as const;
  const env: Record<string, string> = {
    HOME: source.HOME || os.homedir(),
    NO_COLOR: '1',
    PATH: source.PATH || process.env.PATH || '/usr/bin:/bin',
    TMPDIR: stagingDirectory,
  };
  for (const name of allowed) {
    const value = source[name];
    if (value !== undefined && value !== '') env[name] = value;
  }
  return env;
}

function cursorArgv(workspace: string, model: string, prompt: string): string[] {
  return [
    '--workspace',
    workspace,
    '--print',
    '--output-format',
    'stream-json',
    '--stream-partial-output',
    // Installed CLI help defines --trust as workspace trust acknowledgement in headless mode.
    // Read-only behavior is independently fixed by --mode ask plus --sandbox enabled below.
    '--trust',
    '--sandbox',
    'enabled',
    '--mode',
    'ask',
    '--model',
    model,
    prompt,
  ];
}

function transportFromSuccess(
  child: ProviderChildResult,
): NonNullable<SessionBoundWorkerResult['transport']> {
  return {
    exit_code: child.exitCode,
    signal: child.signal,
    reaped: child.reaped,
    duration_ms: child.durationMs,
    stdout_bytes: child.stdoutBytes,
    stderr_bytes: child.stderrBytes,
  };
}

function supervisorFailureResult(
  request: SessionBoundWorkerRequest,
  error: ProviderChildSupervisorError,
): SessionBoundWorkerResult {
  const result = baseResult(request);
  result.state =
    error.code === 'cancelled'
      ? 'cancelled'
      : error.code.endsWith('_timeout')
        ? 'timed_out'
        : 'failed';
  result.transport = {
    exit_code: error.termination?.exitCode ?? null,
    signal: error.termination?.signal ?? null,
    reaped: error.termination?.reaped ?? false,
    duration_ms: null,
    stdout_bytes: error.stream === 'stdout' ? (error.observedBytes ?? 0) : 0,
    stderr_bytes: error.stream === 'stderr' ? (error.observedBytes ?? 0) : 0,
  };
  result.error = {
    code: error.code,
    message: redactProviderDiagnostic(error.message),
  };
  return result;
}

export async function runSessionBoundCursorWorker(
  request: SessionBoundWorkerRequest,
): Promise<SessionBoundWorkerResult> {
  const validation = validateRequest(request);
  if (validation) return reject(request, 'request_rejected', validation);
  const executable = request.runtime.process.resolveExecutable('cursor-agent');
  if (!executable) return reject(request, 'executable_unavailable', 'cursor-agent is unavailable');

  const workspace = fs.realpathSync(request.workspace);
  let stagingDirectory: string | null = null;
  let result = baseResult(request);
  try {
    stagingDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-worker-'));
    const owned = request.runtime.process.spawnProvider({
      executable,
      argv: cursorArgv(workspace, request.model, request.prompt),
      cwd: stagingDirectory,
      env: childEnvironment(request.env, stagingDirectory),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (owned.tree) {
      result.handle = {
        kind: owned.tree.kind,
        id: `pgid:${owned.tree.groupId}`,
        group_id: owned.tree.groupId,
      };
    }
    try {
      const child = await superviseProviderChild(owned, {
        operation: 'session-bound cursor-agent worker',
        deadline: createProviderRequestDeadline(request.timeoutMs),
        limits: {
          startupTimeoutMs: Math.min(5_000, request.timeoutMs),
          idleTimeoutMs: Math.min(30_000, request.timeoutMs),
          stdoutLimitBytes: request.maxOutputBytes,
          stderrLimitBytes: STDERR_LIMIT_BYTES,
          terminationGraceMs: 100,
          reapTimeoutMs: 1_000,
        },
        signal: request.signal,
      });
      result.transport = transportFromSuccess(child);
      if (child.exitCode !== 0) {
        result.state = 'failed';
        result.error = {
          code: 'provider_nonzero_exit',
          message: redactProviderDiagnostic(
            `cursor-agent exited with code ${String(child.exitCode)}: ${child.stderr}`,
          ),
        };
      } else {
        const parsed = parseCursorStream(child.stdout, {
          permissionMode: 'ask',
          sandboxMode: 'enabled',
        });
        if (!parsed.valid || !parsed.terminal) {
          result.state = 'failed';
          result.error = {
            code: 'provider_stream_invalid',
            message: redactProviderDiagnostic(
              parsed.blockers.join(', ') || 'invalid provider stream',
            ),
          };
        } else {
          result.terminal = {
            ...parsed.terminal,
            result: redactProviderDiagnostic(parsed.terminal.result),
          };
          if (parsed.terminal.is_error) {
            result.state = 'failed';
            result.error = {
              code: 'provider_reported_error',
              message: redactProviderDiagnostic(parsed.terminal.result),
            };
          } else {
            result.state = 'succeeded';
          }
        }
      }
    } catch (error) {
      result =
        error instanceof ProviderChildSupervisorError
          ? supervisorFailureResult(request, error)
          : reject(request, 'worker_failed', String((error as Error)?.message || error));
      if (owned.tree && result.handle === null) {
        result.handle = {
          kind: owned.tree.kind,
          id: `pgid:${owned.tree.groupId}`,
          group_id: owned.tree.groupId,
        };
      }
    }
  } catch (error) {
    result = reject(request, 'worker_failed', String((error as Error)?.message || error));
  } finally {
    if (stagingDirectory) fs.rmSync(stagingDirectory, { recursive: true, force: true });
    result.cleanup.staging_removed = stagingDirectory === null || !fs.existsSync(stagingDirectory);
    if (!result.cleanup.staging_removed) {
      result.state = 'failed';
      result.error = {
        code: 'cleanup_failed',
        message: 'session-bound worker staging directory was not removed',
      };
    }
  }
  return result;
}
