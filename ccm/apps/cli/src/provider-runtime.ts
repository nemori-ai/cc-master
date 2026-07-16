// provider-runtime.ts — provider 探测/执行的唯一宿主能力边界。
//
// handler 只能消费此对象，不能直接 import child_process 或任何网络 API。这样 production
// transport 与 contract test 的受控 transport 走同一个 seam；默认实现只在真正调用
// `ccm provider inspect codex` 时才解析并启动本机 Codex CLI。

import { type ChildProcess, type SpawnOptions, spawn } from 'node:child_process';
import * as fs from 'node:fs';
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

export interface ProviderProcessTree {
  schema: typeof PROVIDER_PROCESS_TREE_SCHEMA;
  kind: 'posix-process-group';
  /** The detached launcher is the process-group leader, so its PID is also the exact PGID. */
  groupId: number;
  signal(signal: NodeJS.Signals): boolean;
  isAlive(): boolean;
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

export function createPosixProcessGroup(
  child: ChildProcess,
  signalProcess: ProcessSignal = process.kill.bind(process),
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
        if (provider !== 'codex' && provider !== 'claude' && provider !== 'cursor-agent') {
          return null;
        }
        const explicit =
          provider === 'codex'
            ? env.CCM_CODEX_BIN || env.CODEX_BIN
            : provider === 'claude'
              ? env.CCM_CLAUDE_BIN || env.CLAUDE_BIN
              : env.CCM_CURSOR_AGENT_BIN || env.CURSOR_AGENT_BIN;
        if (explicit) {
          try {
            fs.accessSync(explicit, fs.constants.X_OK);
            return explicit;
          } catch {
            return null;
          }
        }
        if (provider === 'codex') return executableOnPath('codex', env.PATH);
        if (provider === 'claude') return executableOnPath('claude', env.PATH);
        return executableOnPath('cursor-agent', env.PATH) ?? executableOnPath('agent', env.PATH);
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
