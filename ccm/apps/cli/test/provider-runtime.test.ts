import assert from 'node:assert/strict';
import { type ChildProcess, type SpawnOptions, spawn } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  createDefaultProviderRuntime,
  createPosixProcessGroup,
  ProviderProcessTreeOwnershipError,
} from '../src/provider-runtime.js';

const CLI_ROOT = fileURLToPath(new URL('..', import.meta.url));

function childWithPid(pid: number): ChildProcess {
  return { pid } as ChildProcess;
}

test('POSIX tree authority addresses only the detached launcher process group', () => {
  const signals: Array<{ pid: number; signal: NodeJS.Signals | 0 }> = [];
  const tree = createPosixProcessGroup(childWithPid(4_242), (pid, signal) => {
    signals.push({ pid, signal });
    return true;
  });

  assert.equal(tree.groupId, 4_242);
  assert.equal(tree.signal('SIGTERM'), true);
  assert.equal(tree.isAlive(), true);
  assert.deepEqual(signals, [
    { pid: -4_242, signal: 'SIGTERM' },
    { pid: -4_242, signal: 0 },
  ]);
});

test('POSIX tree authority treats ESRCH as proof that the owned group is gone', () => {
  const tree = createPosixProcessGroup(childWithPid(4_243), () => {
    const error = new Error('missing') as NodeJS.ErrnoException;
    error.code = 'ESRCH';
    throw error;
  });

  assert.equal(tree.signal('SIGKILL'), false);
  assert.equal(tree.isAlive(), false);
});

test('unsupported platforms fail closed before invoking the spawn primitive', () => {
  let spawnCalls = 0;
  const runtime = createDefaultProviderRuntime(
    {},
    {
      platform: 'win32',
      spawn: ((..._args: Parameters<typeof spawn>) => {
        spawnCalls += 1;
        return childWithPid(9_999);
      }) as typeof spawn,
      signal: () => true,
    },
  );

  assert.throws(
    () =>
      runtime.process.spawnProvider({
        executable: process.execPath,
        argv: ['--version'],
        cwd: process.cwd(),
        env: {},
      }),
    (error) =>
      error instanceof ProviderProcessTreeOwnershipError &&
      error.code === 'provider_process_tree_ownership_unavailable',
  );
  assert.equal(spawnCalls, 0);
});

for (const platform of ['linux', 'darwin'] as const) {
  test(`${platform} runtime isolates every provider launcher as a detached process-group leader`, () => {
    let observedOptions: SpawnOptions | undefined;
    const runtime = createDefaultProviderRuntime(
      {},
      {
        platform,
        spawn: ((_executable: string, _argv: readonly string[], options: SpawnOptions) => {
          observedOptions = options;
          return childWithPid(5_151);
        }) as typeof spawn,
        signal: () => true,
      },
    );

    const owned = runtime.process.spawnProvider({
      executable: process.execPath,
      argv: ['--version'],
      cwd: process.cwd(),
      env: {},
    });

    assert.equal(observedOptions?.detached, true);
    assert.equal(owned.child.pid, 5_151);
    assert.ok(owned.tree);
    assert.equal(owned.tree.groupId, 5_151);
  });
}

interface SpawnErrorProbeSummary {
  endpointCode: number;
  endpointOut: string[];
  endpointErr: string[];
  uncaught: Array<{ code: string | null; message: string }>;
  unhandledRejections: string[];
  elapsedMs: number;
  spawnCalls: Array<{
    argv: string[];
    childPid: number | null;
    detached: boolean | null;
    requestedExecutable: string;
  }>;
  networkCalls: number;
  protectedEntries: Record<string, string[]>;
}

async function runSpawnErrorEndpointProbe(): Promise<SpawnErrorProbeSummary> {
  const runtimeUrl = new URL('../src/provider-runtime.ts', import.meta.url).href;
  const routerUrl = new URL('../src/router.ts', import.meta.url).href;
  const source = `
    import { spawn } from 'node:child_process';
    import { mkdtempSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
    import { tmpdir } from 'node:os';
    import { join } from 'node:path';
    import { createDefaultProviderRuntime } from ${JSON.stringify(runtimeUrl)};
    import { run } from ${JSON.stringify(routerUrl)};

    const root = mkdtempSync(join(tmpdir(), 'ccm-provider-spawn-error-'));
    const homes = {
      account: join(root, 'codex-home'),
      board: join(root, 'cc-master-home'),
      credential: join(root, 'home'),
      run: join(root, 'run'),
    };
    for (const directory of Object.values(homes)) mkdirSync(directory, { recursive: true });
    const env = {
      CCM_CODEX_BIN: process.execPath,
      CCM_CODEX_PROVIDER_NOW: '2026-07-13T08:01:00Z',
      CC_MASTER_HOME: homes.board,
      CODEX_HOME: homes.account,
      HOME: homes.credential,
      NO_COLOR: '1',
      PATH: process.env.PATH || '/usr/bin:/bin',
      TMPDIR: homes.run,
    };
    const missingExecutable = join(root, 'missing-provider-executable');
    const spawnCalls = [];
    const runtime = createDefaultProviderRuntime(env, {
      platform: 'linux',
      spawn: (requestedExecutable, argv, options) => {
        const child = spawn(missingExecutable, argv, options);
        spawnCalls.push({
          argv: [...argv],
          childPid: child.pid ?? null,
          detached: options.detached ?? null,
          requestedExecutable,
        });
        return child;
      },
      signal: () => {
        throw new Error('no process group exists for an ENOENT spawn');
      },
    });
    let networkCalls = 0;
    const deniedNetworkRequest = runtime.network.request;
    runtime.network.request = (operation) => {
      networkCalls += 1;
      return deniedNetworkRequest(operation);
    };
    const endpointOut = [];
    const endpointErr = [];
    const uncaught = [];
    const unhandledRejections = [];
    process.on('uncaughtException', (error) => {
      uncaught.push({ code: error?.code ?? null, message: error?.message ?? String(error) });
    });
    process.on('unhandledRejection', (reason) => {
      unhandledRejections.push(reason instanceof Error ? reason.message : String(reason));
    });
    const request = {
      schema: 'ccm/codex-provider-inspect-request/v1',
      request_id: 'real-no-pid-spawn-error',
      provider: 'codex',
      model: 'gpt-5.2-codex',
      effort: 'high',
      workspace: ${JSON.stringify(CLI_ROOT)},
      prompt: 'Return one read-only structured inspection result.',
      output_schema: { type: 'object' },
      permission: {
        sandbox: 'read-only',
        approval: 'never',
        network: 'provider-only',
        account_mutation: 'forbidden',
        credential_write: 'forbidden',
      },
      timeouts_ms: { startup: 100, idle: 100, hard: 500 },
    };
    const startedAt = Date.now();
    const endpointCode = await run(
      ['provider', 'inspect', 'codex', '--request', JSON.stringify(request), '--json'],
      {
        env,
        providerRuntime: runtime,
        out: (value) => endpointOut.push(value),
        err: (value) => endpointErr.push(value),
      },
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    const elapsedMs = Date.now() - startedAt;
    const protectedEntries = Object.fromEntries(
      ['account', 'board', 'credential'].map((key) => [
        key,
        readdirSync(homes[key], { recursive: true }).map(String).sort(),
      ]),
    );
    rmSync(root, { recursive: true, force: true });
    process.stdout.write(JSON.stringify({
      endpointCode,
      endpointOut,
      endpointErr,
      uncaught,
      unhandledRejections,
      elapsedMs,
      spawnCalls,
      networkCalls,
      protectedEntries,
    }));
  `;

  return await new Promise<SpawnErrorProbeSummary>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', '--input-type=module', '--eval', source],
      { cwd: CLI_ROOT, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('spawn-error endpoint probe exceeded 5 seconds'));
    }, 5_000);
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      if (code !== 0 || signal !== null) {
        reject(
          new Error(
            `spawn-error endpoint probe failed: code=${code} signal=${signal} stderr=${stderr}`,
          ),
        );
        return;
      }
      if (stderr !== '') {
        reject(new Error(`spawn-error endpoint probe wrote harness stderr: ${stderr}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout) as SpawnErrorProbeSummary);
      } catch (error) {
        reject(
          new Error(`spawn-error endpoint probe emitted invalid JSON: ${stdout}`, { cause: error }),
        );
      }
    });
  });
}

test('supported endpoint normalizes a real no-PID asynchronous spawn error exactly once', {
  timeout: 10_000,
}, async () => {
  const probe = await runSpawnErrorEndpointProbe();

  assert.equal(probe.endpointCode, 0, JSON.stringify(probe));
  assert.equal(probe.endpointOut.length, 1, 'endpoint must emit exactly one normalized result');
  assert.deepEqual(probe.endpointErr, [], 'normalized spawn failure must not emit generic stderr');
  assert.deepEqual(probe.uncaught, [], 'child error escaped as an uncaughtException');
  assert.deepEqual(
    probe.unhandledRejections,
    [],
    'spawn failure escaped as an unhandled rejection',
  );
  assert.ok(probe.elapsedMs < 1_000, `spawn failure settled after ${probe.elapsedMs}ms`);
  assert.deepEqual(probe.spawnCalls, [
    {
      argv: ['--version'],
      childPid: null,
      detached: true,
      requestedExecutable: process.execPath,
    },
  ]);
  assert.equal(probe.networkCalls, 0);
  assert.deepEqual(probe.protectedEntries, { account: [], board: [], credential: [] });

  const envelope = JSON.parse(probe.endpointOut[0] as string);
  assert.equal(envelope.ok, true);
  assert.equal(envelope.data.candidate.automatic_eligible, false);
  assert.equal(envelope.data.error.code, 'spawn_error');
  assert.equal(envelope.data.error.phase, 'version');
  assert.equal(envelope.data.execution.attempted, false);
  assert.equal(envelope.data.execution.invocation_compiled, false);
  assert.equal(envelope.data.execution.parser_exercised, false);
  assert.deepEqual(envelope.data.side_effects, {
    board_writes: 0,
    remote_mutations: 0,
    account_mutations: 0,
    credential_writes: 0,
  });
});
