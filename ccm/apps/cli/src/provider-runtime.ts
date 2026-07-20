// provider-runtime.ts — provider 探测/执行的唯一宿主能力边界。
//
// handler 只能消费此对象，不能直接 import child_process 或任何网络 API。这样 production
// transport 与 contract test 的受控 transport 走同一个 seam；默认实现只在真正调用
// `ccm provider inspect codex` 时才解析并启动本机 Codex CLI。

import { type ChildProcess, type SpawnOptions, spawn, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export const PROVIDER_RUNTIME_SCHEMA = 'ccm/provider-runtime-capabilities/v1';

export interface ProviderSpawnSpec {
  executable: string;
  argv: string[];
  cwd: string;
  env: Record<string, string>;
  stdio?: SpawnOptions['stdio'];
}

export const PROVIDER_PROCESS_TREE_SCHEMA = 'ccm/provider-owned-process-tree/v1' as const;

export interface ProviderProcessIdentity {
  pid: number;
  name: string;
  commandLine: string;
}

export interface ProviderProcessTree {
  schema: typeof PROVIDER_PROCESS_TREE_SCHEMA;
  kind: 'posix-process-group';
  /** The detached launcher is the process-group leader, so its PID is also the exact PGID. */
  groupId: number;
  signal(signal: NodeJS.Signals): boolean;
  isAlive(): boolean;
  /** Read-only best effort. Null means the host could not prove the group's exact membership. */
  listMembers?(): ProviderProcessIdentity[] | null;
}

export interface ProviderOwnedChild {
  child: ChildProcess;
  /** Null only when spawn returned no PID and its asynchronous error/close is still pending. */
  tree: ProviderProcessTree | null;
}

export class ProviderProcessTreeOwnershipError extends Error {
  readonly code = 'provider_process_tree_ownership_unavailable';

  constructor(message: string) {
    super(message);
    this.name = 'ProviderProcessTreeOwnershipError';
  }
}

type ProcessSignal = (pid: number, signal: NodeJS.Signals | 0) => boolean;
type ProcessGroupMembers = (groupId: number) => ProviderProcessIdentity[] | null;

interface ProviderRuntimeHost {
  platform: NodeJS.Platform;
  spawn: typeof spawn;
  signal: ProcessSignal;
}

export interface ProviderRuntime {
  schema: typeof PROVIDER_RUNTIME_SCHEMA;
  process: {
    resolveExecutable(provider: string): string | null;
    spawnProvider(spec: ProviderSpawnSpec): ProviderOwnedChild;
  };
  // 预留成显式拒绝面，避免 handler 为了“方便”绕到 host 网络；本 candidate 不请求网络。
  network: { request(operation: string): never };
}

function processMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === 'ESRCH';
}

function listPosixProcessGroupMembers(groupId: number): ProviderProcessIdentity[] | null {
  // Provider-tree classification is advisory only when the complete snapshot is available. POSIX
  // `ps` is present on every host supported by this process-group runtime; a missing binary,
  // truncated output, nonzero exit, or unparsable row returns null so callers fail closed.
  const ps = firstExecutable(['/bin/ps', '/usr/bin/ps']);
  if (!ps) return null;
  const inspected = spawnSync(
    ps,
    ['-ww', '-A', '-o', 'pid=', '-o', 'pgid=', '-o', 'comm=', '-o', 'args='],
    {
      encoding: 'utf8',
      maxBuffer: 1_048_576,
      stdio: ['ignore', 'pipe', 'ignore'],
    },
  );
  if (inspected.error || inspected.status !== 0 || typeof inspected.stdout !== 'string')
    return null;

  const members: ProviderProcessIdentity[] = [];
  for (const line of inspected.stdout.split('\n')) {
    if (!line.trim()) continue;
    const match = /^\s*(\d+)\s+(\d+)\s+(\S+)(?:\s+(.*))?$/u.exec(line);
    if (!match) return null;
    const pid = Number(match[1]);
    const pgid = Number(match[2]);
    if (!Number.isSafeInteger(pid) || !Number.isSafeInteger(pgid)) return null;
    if (pgid !== groupId) continue;
    members.push({ pid, name: match[3] as string, commandLine: match[4] ?? '' });
  }
  return members;
}

export function createPosixProcessGroup(
  child: ChildProcess,
  signalProcess: ProcessSignal = process.kill.bind(process),
  listMembers: ProcessGroupMembers = listPosixProcessGroupMembers,
): ProviderProcessTree {
  const groupId = child.pid;
  if (!Number.isSafeInteger(groupId) || Number(groupId) <= 0) {
    throw new ProviderProcessTreeOwnershipError(
      'provider launcher did not expose a positive process-group leader PID',
    );
  }

  const signalGroup = (signal: NodeJS.Signals | 0): boolean => {
    try {
      signalProcess(-Number(groupId), signal);
      return true;
    } catch (error) {
      if (processMissing(error)) return false;
      throw error;
    }
  };

  return Object.freeze({
    schema: PROVIDER_PROCESS_TREE_SCHEMA,
    kind: 'posix-process-group' as const,
    groupId: Number(groupId),
    signal: (signal: NodeJS.Signals) => signalGroup(signal),
    isAlive: () => signalGroup(0),
    listMembers: () => listMembers(Number(groupId)),
  });
}

function executableOnPath(name: string, pathValue: string | undefined): string | null {
  for (const dir of String(pathValue || '').split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, name);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // continue through PATH; an absent binary is an ordinary ineligible fact.
    }
  }
  return null;
}

// Well-known per-harness install locations, consulted only after an explicit CCM_*_BIN override and
// a PATH scan both miss. Every harness installs into a home-relative dir that is routinely absent
// from a non-interactive / hook / subagent PATH (fnm shim dirs, ~/.local/bin, ~/.kimi-code/bin get
// stripped): a CLI that is genuinely installed then resolves to null and dispatch rejects with
// executable_unavailable. kimi's ~/.kimi-code/bin is essentially never on a default PATH, so it is
// the most visible victim, but the gap is identical for all four. Locations are deterministic
// per-installer facts (kimi's home bin, cursor-agent's ~/.local/bin symlink, claude's migrate-
// installer ~/.claude/local) plus a best-effort ~/.local/bin for the npm/global installers.
function firstExecutable(candidates: string[]): string | null {
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // continue; a missing well-known location is an ordinary ineligible fact.
    }
  }
  return null;
}

function executableInWellKnownLocations(
  provider: string,
  env: Record<string, string | undefined>,
): string | null {
  const home = env.HOME || os.homedir();
  const localBin = path.join(home, '.local', 'bin');
  switch (provider) {
    case 'codex':
      return firstExecutable([path.join(localBin, 'codex')]);
    case 'claude':
      return firstExecutable([
        path.join(localBin, 'claude'),
        path.join(home, '.claude', 'local', 'claude'),
      ]);
    case 'kimi':
      return firstExecutable([
        path.join(home, '.kimi-code', 'bin', 'kimi'),
        path.join(localBin, 'kimi'),
      ]);
    case 'cursor-agent':
      return firstExecutable([path.join(localBin, 'cursor-agent'), path.join(localBin, 'agent')]);
    default:
      return null;
  }
}

export function createDefaultProviderRuntime(
  env: Record<string, string | undefined>,
  host: ProviderRuntimeHost = {
    platform: process.platform,
    spawn,
    signal: process.kill.bind(process),
  },
): ProviderRuntime {
  return {
    schema: PROVIDER_RUNTIME_SCHEMA,
    process: {
      resolveExecutable(provider: string): string | null {
        if (
          provider !== 'codex' &&
          provider !== 'claude' &&
          provider !== 'cursor-agent' &&
          provider !== 'kimi'
        ) {
          return null;
        }
        const explicit =
          provider === 'codex'
            ? env.CCM_CODEX_BIN || env.CODEX_BIN
            : provider === 'claude'
              ? env.CCM_CLAUDE_BIN || env.CLAUDE_BIN
              : provider === 'kimi'
                ? env.CCM_KIMI_BIN || env.KIMI_BIN
                : env.CCM_CURSOR_AGENT_BIN || env.CURSOR_AGENT_BIN;
        if (explicit) {
          // An explicit CCM_*_BIN / *_BIN override is authoritative: if the operator points it at a
          // bad path we surface that as unavailable rather than silently resolving something else.
          try {
            fs.accessSync(explicit, fs.constants.X_OK);
            return explicit;
          } catch {
            return null;
          }
        }
        const onPath =
          provider === 'codex'
            ? executableOnPath('codex', env.PATH)
            : provider === 'claude'
              ? executableOnPath('claude', env.PATH)
              : provider === 'kimi'
                ? executableOnPath('kimi', env.PATH)
                : (executableOnPath('cursor-agent', env.PATH) ??
                  executableOnPath('agent', env.PATH));
        // PATH stays primary; well-known home-relative install locations are the last-resort fallback
        // so a genuinely-installed CLI missing from a stripped PATH is not misjudged as absent.
        return onPath ?? executableInWellKnownLocations(provider, env);
      },
      spawnProvider(spec: ProviderSpawnSpec): ProviderOwnedChild {
        if (host.platform === 'win32') {
          throw new ProviderProcessTreeOwnershipError(
            'Codex provider spawn requires an owned process tree; Windows Job Object support is unavailable',
          );
        }
        const child = host.spawn(spec.executable, spec.argv, {
          cwd: spec.cwd,
          env: spec.env,
          stdio: spec.stdio ?? ['pipe', 'pipe', 'pipe'],
          detached: true,
        });
        const tree =
          Number.isSafeInteger(child.pid) && Number(child.pid) > 0
            ? createPosixProcessGroup(child, host.signal)
            : null;
        return { child, tree };
      },
    },
    network: {
      request(operation: string): never {
        throw new Error(`provider network capability is denied: ${operation}`);
      },
    },
  };
}
