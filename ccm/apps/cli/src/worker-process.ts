import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  createProviderRequestDeadline,
  type ProviderChildResult,
  ProviderChildSupervisorError,
  superviseProviderChild,
} from './provider-child-supervisor.js';
import {
  type ProviderProcessIdentity,
  ProviderProcessTreeOwnershipError,
  type ProviderRuntime,
} from './provider-runtime.js';
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
  harness: string;
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

const MAX_TIMEOUT_MS = 7_200_000;
// Raw-worker output ceilings. A real agent dispatch (e.g. `codex exec --json` emitting a large
// blueprint/state JSONL, or a long claude/cursor/kimi transcript) routinely exceeds a 1 MiB stream;
// the former 1 MiB cap tripped `output_limit`, which TERM/KILLs the child mid-task and discards the
// transcript. The later 32 MiB stdout / 8 MiB stderr pair still truncated real work: a codex
// worker's stderr alone routinely runs to tens of MiB, and losing it discards exactly the
// diagnostics a failed dispatch needs. Both streams now get a 512 MiB ceiling — enough headroom
// for multi-ten-MiB payloads and diagnostics while still bounding a runaway child. The ceilings
// are caps, not allocations: a quiet worker buffers only what it actually emits.
const MAX_OUTPUT_BYTES = 536_870_912; // 512 MiB — hard ceiling for --max-output-bytes and stdout.
const STDERR_LIMIT_BYTES = 536_870_912; // 512 MiB — independent stderr cap.

// Post-close settlement / reap budget for the owned process tree. Well-behaved harnesses reap their
// tree the instant the launcher closes and never touch this window; it only applies when a launcher
// exits leaving a short-lived owned helper (observed with cursor-agent), which used to trip
// `owned_tree_survived` and throw away an otherwise-complete transcript because the former 1 s budget
// was too tight. Generous by default, still fail-closed on a tree that never drains. Overridable via
// CCM_WORKER_REAP_TIMEOUT_MS (bounded) so slow hosts can widen it and tests can shrink it.
const RAW_WORKER_REAP_TIMEOUT_MS = 5_000;
const RAW_WORKER_REAP_TIMEOUT_MIN_MS = 100;
const RAW_WORKER_REAP_TIMEOUT_MAX_MS = 60_000;

function resolveReapTimeoutMs(env: Record<string, string | undefined>): number {
  const raw = env.CCM_WORKER_REAP_TIMEOUT_MS;
  if (typeof raw === 'string' && /^\d+$/u.test(raw)) {
    const value = Number(raw);
    if (
      Number.isSafeInteger(value) &&
      value >= RAW_WORKER_REAP_TIMEOUT_MIN_MS &&
      value <= RAW_WORKER_REAP_TIMEOUT_MAX_MS
    ) {
      return value;
    }
  }
  return RAW_WORKER_REAP_TIMEOUT_MS;
}

function normalizeProcessCommandLine(commandLine: string): string {
  return commandLine.trim().replace(/\s+/gu, ' ');
}

function cursorAgentServiceTreePolicy(
  cursorExecutable: string,
  homeDir: string,
): (members: readonly ProviderProcessIdentity[]) => boolean {
  const installDir = path.dirname(cursorExecutable);
  // Cursor Agent 2026.07.16 leaves this packaged daemon in the launcher's process group after a
  // successful print-mode request: <version-dir>/node <version-dir>/index.js worker-server. Bind
  // both executables to the resolved launcher's version directory and require the exact terminal
  // subcommand. Do not consult ps(1)'s `comm`: Node 24 changes it to `MainThread` at runtime while
  // `args` remains authoritative. Cursor may also leave the exact npm/sh/node chain for its
  // TypeScript language server in the same group; it is accepted only beside this packaged server
  // and only under the caller's npm cache. Any other mixed survivor stays request-owned.
  const expectedCommandLine = `${path.join(installDir, 'node')} ${path.join(
    installDir,
    'index.js',
  )} worker-server`;
  const npmTypeScriptLsp = 'exec typesc npm exec typescript-language-server --stdio';
  const shellTypeScriptLsp = 'sh -c "typescript-language-server" --stdio';
  const npxCachePrefix = `node ${path.join(homeDir, '.npm', '_npx')}${path.sep}`;
  const npxCacheSuffix = `${path.sep}${path.join(
    'node_modules',
    '.bin',
    'typescript-language-server',
  )} --stdio`;

  return (members) => {
    if (members.length === 0) return false;
    let hasWorkerServer = false;
    for (const member of members) {
      const commandLine = normalizeProcessCommandLine(member.commandLine);
      if (commandLine === expectedCommandLine) {
        hasWorkerServer = true;
        continue;
      }
      if (commandLine === npmTypeScriptLsp || commandLine === shellTypeScriptLsp) continue;
      if (commandLine.startsWith(npxCachePrefix) && commandLine.endsWith(npxCacheSuffix)) {
        const cacheKey = commandLine.slice(npxCachePrefix.length, -npxCacheSuffix.length);
        if (/^[0-9a-f]+$/u.test(cacheKey)) continue;
      }
      return false;
    }
    // The language-service chain is accepted only as an adjunct to Cursor's packaged server. A
    // standalone lookalike LSP cannot turn an otherwise-owned tree into a benign service tree.
    return hasWorkerServer;
  };
}

function initialResult(harness: string, argv: string[], cwd: string): WorkerProcessResult {
  return {
    schema: WORKER_PROCESS_RESULT_SCHEMA,
    harness,
    executable: null,
    argv: [...argv],
    cwd,
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

function baseResult(request: WorkerProcessRequest): WorkerProcessResult {
  return initialResult(request.descriptor.harness, request.providerArgv, request.cwd);
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

export function rejectedWorkerProcess(input: {
  harness: string;
  providerArgv: string[];
  cwd: string;
  code: string;
  message: string;
}): WorkerProcessResult {
  return fail(
    initialResult(input.harness, input.providerArgv, input.cwd),
    'rejected',
    input.code,
    input.message,
  );
}

function validate(request: WorkerProcessRequest, cwd: string): string | null {
  try {
    if (!fs.statSync(cwd).isDirectory()) return '--cwd must name a directory';
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
    'KIMI_CODE_HOME',
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
  // A relative --cwd resolves against the launching process cwd (the shell the caller ran ccm in),
  // mirroring the run/help defaults that already fall back to process.cwd() when --cwd is omitted.
  // Without this, `--cwd .` was rejected before executable resolution ran, surfacing a confusing
  // executable:null envelope that masked the real "cwd" error. The child always gets an absolute,
  // realpath-normalized cwd.
  const requestedCwd = path.resolve(request.cwd);
  const validation = validate(request, requestedCwd);
  if (validation) return fail(result, 'rejected', 'request_rejected', validation);

  let cwd: string;
  try {
    cwd = fs.realpathSync(requestedCwd);
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
        reapTimeoutMs: resolveReapTimeoutMs(request.env),
      },
      signal: request.signal,
      ...(request.descriptor.harness === 'cursor-agent'
        ? {
            // Cursor's packaged worker-server and the exact TypeScript language-service chain it
            // starts are request-independent. A real task, unrelated helper, mixed tree, lookalike
            // outside the bound install/home roots, or unavailable inspection stays fail-closed.
            isBenignSurvivingTree: cursorAgentServiceTreePolicy(
              result.executable,
              request.env.HOME || os.homedir(),
            ),
          }
        : {}),
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
