import assert from 'node:assert/strict';
import { type ChildProcess, spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, test } from 'node:test';
import {
  createProviderRequestDeadline,
  type ProviderChildLimits,
  ProviderChildSupervisorError,
  type ProviderChildSupervisorErrorCode,
  superviseProviderChild,
} from '../src/provider-child-supervisor.js';
import {
  createPosixProcessGroup,
  PROVIDER_PROCESS_TREE_SCHEMA,
  type ProviderOwnedChild,
} from '../src/provider-runtime.js';

const CHILDREN = new Set<ChildProcess>();
const DESCENDANT_PIDS = new Set<number>();

const DEFAULT_LIMITS: ProviderChildLimits = {
  startupTimeoutMs: 1_000,
  idleTimeoutMs: 1_000,
  stdoutLimitBytes: 16 * 1024,
  stderrLimitBytes: 16 * 1024,
  terminationGraceMs: 30,
  reapTimeoutMs: 500,
};

afterEach(() => {
  for (const child of CHILDREN) {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }
  for (const pid of DESCENDANT_PIDS) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
    }
  }
  CHILDREN.clear();
  DESCENDANT_PIDS.clear();
});

function spawnNode(source: string): ChildProcess {
  const child = spawn(process.execPath, ['-e', source], {
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  CHILDREN.add(child);
  child.once('close', () => CHILDREN.delete(child));
  return child;
}

async function spawnReadyNode(source: string, detached = false): Promise<ChildProcess> {
  const child = spawn(process.execPath, ['-e', source], {
    detached,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  CHILDREN.add(child);
  child.once('close', () => CHILDREN.delete(child));
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error('child readiness handshake timed out')), 2_000);
    const onMessage = (message: unknown) => {
      if (message === 'ready') finish();
    };
    const onError = (error: Error) => finish(error);
    const onClose = (exitCode: number | null, signal: NodeJS.Signals | null) =>
      finish(new Error(`child closed before ready: exit=${exitCode} signal=${signal}`));
    const finish = (error?: Error) => {
      clearTimeout(timer);
      child.off('message', onMessage);
      child.off('error', onError);
      child.off('close', onClose);
      if (error) reject(error);
      else resolve();
    };
    child.on('message', onMessage);
    child.once('error', onError);
    child.once('close', onClose);
  });
  return child;
}

function ownChild(child: ChildProcess): ProviderOwnedChild {
  if (typeof child.pid === 'number') return { child, tree: createPosixProcessGroup(child) };
  return {
    child,
    tree: {
      schema: PROVIDER_PROCESS_TREE_SCHEMA,
      kind: 'posix-process-group',
      groupId: 1,
      signal: (signal) => child.kill(signal),
      isAlive: () => child.exitCode === null && child.signalCode === null,
    },
  };
}

interface LauncherTreeFixture {
  launcher: ChildProcess;
  launcherPid: number;
  grandchildPid: number;
}

async function spawnLauncherTree(
  options: { cooperative?: boolean; launcherCooperative?: boolean; emitParserInput?: boolean } = {},
): Promise<LauncherTreeFixture> {
  const grandchildSource = `
    ${options.cooperative ? '' : "process.on('SIGTERM', () => {});"}
    setInterval(() => {}, 1_000);
  `;
  const launcherSource = `
    const { spawn } = require('node:child_process');
    ${options.cooperative || options.launcherCooperative ? '' : "process.on('SIGTERM', () => {});"}
    if (typeof process.send !== 'function') process.exit(70);
    process.send({ type: 'launcher-ready', pid: process.pid });
    const grandchild = spawn(process.execPath, ['-e', ${JSON.stringify(grandchildSource)}], {
      stdio: 'ignore',
    });
    grandchild.once('spawn', () => {
      process.send({ type: 'grandchild-ready', pid: grandchild.pid });
      ${options.emitParserInput ? "process.stdout.write('parser-input');" : ''}
    });
    setInterval(() => {}, 1_000);
  `;
  const launcher = spawn(process.execPath, ['-e', launcherSource], {
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  CHILDREN.add(launcher);
  launcher.once('close', () => CHILDREN.delete(launcher));

  return await new Promise<LauncherTreeFixture>((resolve, reject) => {
    let launcherPid: number | null = null;
    let grandchildPid: number | null = null;
    const timer = setTimeout(() => finish(new Error('launcher tree readiness timed out')), 2_000);
    const onMessage = (message: unknown) => {
      if (typeof message !== 'object' || message === null) return;
      const record = message as { type?: unknown; pid?: unknown };
      if (!Number.isSafeInteger(record.pid) || Number(record.pid) <= 0) return;
      if (record.type === 'launcher-ready') launcherPid = Number(record.pid);
      if (record.type === 'grandchild-ready') {
        grandchildPid = Number(record.pid);
        DESCENDANT_PIDS.add(grandchildPid);
      }
      if (launcherPid !== null && grandchildPid !== null) {
        finish(undefined, { launcher, launcherPid, grandchildPid });
      }
    };
    const onError = (error: Error) => finish(error);
    const onClose = (exitCode: number | null, signal: NodeJS.Signals | null) =>
      finish(new Error(`launcher closed before tree ready: exit=${exitCode} signal=${signal}`));
    const finish = (error?: Error, fixture?: LauncherTreeFixture) => {
      clearTimeout(timer);
      launcher.off('message', onMessage);
      launcher.off('error', onError);
      launcher.off('close', onClose);
      if (error) reject(error);
      else resolve(fixture as LauncherTreeFixture);
    };
    launcher.on('message', onMessage);
    launcher.once('error', onError);
    launcher.once('close', onClose);
  });
}

function pidExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
    throw error;
  }
}

function traceTreeLifecycle(
  label: string,
  fixture: LauncherTreeFixture,
  elapsedMs: number,
  sentinelPid?: number,
): void {
  if (process.env.CCM_PROVIDER_TREE_TRACE !== '1') return;
  console.log(
    `TREE_LIFECYCLE ${JSON.stringify({
      label,
      launcher_pid: fixture.launcherPid,
      grandchild_pid: fixture.grandchildPid,
      sentinel_pid: sentinelPid ?? null,
      elapsed_ms: elapsedMs,
      launcher_alive_after_return: pidExists(fixture.launcherPid),
      grandchild_alive_after_return: pidExists(fixture.grandchildPid),
      sentinel_alive_after_return: sentinelPid === undefined ? null : pidExists(sentinelPid),
    })}`,
  );
}

function fakeUnstartedChild(): ChildProcess & { signals: NodeJS.Signals[] } {
  const child = new EventEmitter();
  const signals: NodeJS.Signals[] = [];
  let signalCode: NodeJS.Signals | null = null;
  Object.defineProperties(child, {
    stdout: { value: new PassThrough() },
    stderr: { value: new PassThrough() },
    stdin: { value: null },
    pid: { value: undefined },
    exitCode: { get: () => null },
    signalCode: { get: () => signalCode },
    signals: { value: signals },
  });
  Object.defineProperty(child, 'kill', {
    value: (signal: NodeJS.Signals = 'SIGTERM') => {
      signals.push(signal);
      queueMicrotask(() => {
        signalCode = signal;
        child.emit('exit', null, signal);
        child.emit('close', null, signal);
      });
      return true;
    },
  });
  return child as ChildProcess & { signals: NodeJS.Signals[] };
}

async function expectSupervisorError(
  promise: Promise<unknown>,
  code: ProviderChildSupervisorErrorCode,
  operation: string,
): Promise<ProviderChildSupervisorError> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof ProviderChildSupervisorError);
    assert.equal(error.code, code);
    assert.equal(error.operation, operation);
    return error;
  }
  assert.fail(`expected ${operation} to fail with ${code}`);
}

test('collects raw bytes with incremental fatal UTF-8 and preserves a nonzero exit', async () => {
  const observed: string[] = [];
  const child = spawnNode(`
    process.stdout.write(Buffer.from([0x41, 0xe2]));
    setTimeout(() => process.stdout.write(Buffer.from([0x82])), 5);
    setTimeout(() => process.stdout.write(Buffer.from([0xac, 0x5a])), 10);
    setTimeout(() => { process.stderr.write('diagnostic'); process.exit(42); }, 15);
  `);

  const result = await superviseProviderChild(ownChild(child), {
    operation: 'version',
    deadline: createProviderRequestDeadline(1_000),
    limits: DEFAULT_LIMITS,
    onStdoutText: (text) => observed.push(text),
  });

  assert.equal(result.stdout, 'A€Z');
  assert.equal(observed.join(''), 'A€Z');
  assert.equal(result.stderr, 'diagnostic');
  assert.equal(result.stdoutBytes, 5);
  assert.equal(result.stderrBytes, 10);
  assert.equal(result.exitCode, 42);
  assert.equal(result.signal, null);
  assert.equal(result.reaped, true);
});

test('fails closed on a raw invalid UTF-8 byte and reaps the terminated child', async () => {
  const child = spawnNode(`
    process.on('SIGTERM', () => {});
    process.stdout.write(Buffer.from([0x7b, 0x22, 0x78, 0x22, 0x3a, 0x80, 0x7d, 0x0a]));
    setInterval(() => {}, 1_000);
  `);

  const error = await expectSupervisorError(
    superviseProviderChild(ownChild(child), {
      operation: 'exec',
      deadline: createProviderRequestDeadline(1_000),
      limits: DEFAULT_LIMITS,
    }),
    'invalid_utf8',
    'exec',
  );

  assert.equal(error.stream, 'stdout');
  assert.deepEqual(error.termination, {
    exitCode: null,
    signal: 'SIGKILL',
    reaped: true,
  });
});

test('rejects a stream that was put in lossy string-decoding mode before supervision', async () => {
  const child = spawnNode(`
    process.on('SIGTERM', () => {});
    setInterval(() => {}, 1_000);
  `);
  child.stdout?.setEncoding('utf8');

  const error = await expectSupervisorError(
    superviseProviderChild(ownChild(child), {
      operation: 'app-server',
      deadline: createProviderRequestDeadline(1_000),
      limits: DEFAULT_LIMITS,
    }),
    'byte_stream_required',
    'app-server',
  );

  assert.equal(error.termination?.reaped, true);
  assert.ok(error.termination?.signal === 'SIGTERM' || error.termination?.signal === 'SIGKILL');
});

test('enforces a strict byte limit before decoding', async () => {
  const child = spawnNode(`
    process.stdout.write(Buffer.alloc(33, 0x61));
    setInterval(() => {}, 1_000);
  `);

  const error = await expectSupervisorError(
    superviseProviderChild(ownChild(child), {
      operation: 'help',
      deadline: createProviderRequestDeadline(1_000),
      limits: { ...DEFAULT_LIMITS, stdoutLimitBytes: 32 },
    }),
    'output_limit',
    'help',
  );

  assert.equal(error.stream, 'stdout');
  assert.equal(error.limitBytes, 32);
  assert.equal(error.observedBytes, 33);
});

test('reports startup timeout with the exact operation and waits for close', async () => {
  const child = fakeUnstartedChild();
  const error = await expectSupervisorError(
    superviseProviderChild(ownChild(child), {
      operation: 'help',
      deadline: createProviderRequestDeadline(1_000),
      limits: { ...DEFAULT_LIMITS, startupTimeoutMs: 20 },
    }),
    'startup_timeout',
    'help',
  );

  assert.deepEqual(child.signals, ['SIGTERM']);
  assert.deepEqual(error.termination, {
    exitCode: null,
    signal: 'SIGTERM',
    reaped: true,
  });
});

test('supervision keeps its timeout lifecycle alive without unrelated refed handles', async () => {
  const supervisorUrl = new URL('../src/provider-child-supervisor.ts', import.meta.url).href;
  const runtime = `
    import { EventEmitter } from 'node:events';
    import { PassThrough } from 'node:stream';
    import {
      createProviderRequestDeadline,
      superviseProviderChild,
    } from ${JSON.stringify(supervisorUrl)};

    const child = new EventEmitter();
    let signalCode = null;
    Object.defineProperties(child, {
      stdout: { value: new PassThrough() },
      stderr: { value: new PassThrough() },
      stdin: { value: null },
      pid: { value: undefined },
      exitCode: { get: () => null },
      signalCode: { get: () => signalCode },
    });
    Object.defineProperty(child, 'kill', {
      value: (signal = 'SIGTERM') => {
        queueMicrotask(() => {
          signalCode = signal;
          child.emit('exit', null, signal);
          child.emit('close', null, signal);
        });
        return true;
      },
    });

    const tree = {
      schema: 'ccm/provider-process-tree/v1',
      kind: 'posix-process-group',
      groupId: 1,
      signal: (signal) => child.kill(signal),
      isAlive: () => signalCode === null,
    };

    try {
      await superviseProviderChild({ child, tree }, {
        operation: 'liveness-probe',
        deadline: createProviderRequestDeadline(1_000),
        limits: {
          startupTimeoutMs: 20,
          idleTimeoutMs: 1_000,
          stdoutLimitBytes: 1_024,
          stderrLimitBytes: 1_024,
          terminationGraceMs: 30,
          reapTimeoutMs: 100,
        },
      });
      process.exitCode = 91;
    } catch (error) {
      if (error?.code !== 'startup_timeout' || error?.termination?.reaped !== true) {
        console.error(error);
        process.exitCode = 92;
      } else {
        process.stdout.write('startup_timeout:reaped\\n');
      }
    }
  `;
  const probe = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', runtime], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  probe.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
  probe.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));

  const [exitCode, signal] = await new Promise<[number | null, NodeJS.Signals | null]>((resolve) =>
    probe.once('close', (code, closedSignal) => resolve([code, closedSignal])),
  );

  assert.equal(signal, null);
  assert.equal(
    exitCode,
    0,
    `isolated liveness probe exited ${exitCode}: ${Buffer.concat(stderr).toString('utf8')}`,
  );
  assert.equal(Buffer.concat(stdout).toString('utf8'), 'startup_timeout:reaped\n');
});

test('reports startup timeout when a real spawned child produces no provider bytes', async () => {
  const child = spawnNode('setInterval(() => {}, 1_000);');
  const error = await expectSupervisorError(
    superviseProviderChild(ownChild(child), {
      operation: 'app-server',
      deadline: createProviderRequestDeadline(1_000),
      limits: { ...DEFAULT_LIMITS, startupTimeoutMs: 30, idleTimeoutMs: 500 },
    }),
    'startup_timeout',
    'app-server',
  );

  assert.equal(error.termination?.reaped, true);
  assert.equal(error.termination?.signal, 'SIGTERM');
});

test('reports idle timeout only after the first provider byte then silence', async () => {
  const child = spawnNode(`
    process.stdout.write('.');
    setInterval(() => {}, 1_000);
  `);
  const error = await expectSupervisorError(
    superviseProviderChild(ownChild(child), {
      operation: 'exec',
      deadline: createProviderRequestDeadline(1_000),
      limits: { ...DEFAULT_LIMITS, startupTimeoutMs: 250, idleTimeoutMs: 30 },
    }),
    'idle_timeout',
    'exec',
  );

  assert.equal(error.termination?.reaped, true);
  assert.equal(error.termination?.signal, 'SIGTERM');
});

test('hard=100ms escalates a real SIGTERM-ignoring child to SIGKILL and settles below 1s', {
  timeout: 4_000,
}, async () => {
  const child = await spawnReadyNode(
    `
      process.on('SIGTERM', () => {});
      if (typeof process.send !== 'function') process.exit(70);
      process.send('ready');
      setInterval(() => {}, 1_000);
    `,
    true,
  );
  const startedAt = Date.now();
  const error = await expectSupervisorError(
    superviseProviderChild(ownChild(child), {
      operation: 'exec',
      deadline: createProviderRequestDeadline(100),
      limits: { ...DEFAULT_LIMITS, idleTimeoutMs: 500 },
    }),
    'hard_timeout',
    'exec',
  );
  const elapsedMs = Date.now() - startedAt;

  assert.ok(elapsedMs < 1_000, `hard timeout settled after ${elapsedMs}ms`);
  assert.ok(elapsedMs >= 90, `hard timeout fired too early after ${elapsedMs}ms`);
  assert.deepEqual(error.termination, {
    exitCode: null,
    signal: 'SIGKILL',
    reaped: true,
  });
});

test('hard timeout does not return until an uncooperative launcher and grandchild are both gone', {
  timeout: 4_000,
}, async () => {
  const sentinel = await spawnReadyNode(`
    process.on('SIGTERM', () => {});
    if (typeof process.send !== 'function') process.exit(70);
    process.send('ready');
    setInterval(() => {}, 1_000);
  `);
  const fixture = await spawnLauncherTree();
  const startedAt = Date.now();
  const error = await expectSupervisorError(
    superviseProviderChild(ownChild(fixture.launcher), {
      operation: 'exec',
      deadline: createProviderRequestDeadline(100),
      limits: { ...DEFAULT_LIMITS, idleTimeoutMs: 500 },
    }),
    'hard_timeout',
    'exec',
  );
  const elapsedMs = Date.now() - startedAt;
  traceTreeLifecycle('hard-timeout-uncooperative', fixture, elapsedMs, sentinel.pid);

  assert.ok(elapsedMs < 1_000, `owned tree cleanup settled after ${elapsedMs}ms`);
  assert.equal(pidExists(fixture.launcherPid), false, 'launcher survived supervisor return');
  assert.equal(pidExists(fixture.grandchildPid), false, 'grandchild survived supervisor return');
  assert.equal(pidExists(sentinel.pid as number), true, 'unrelated sentinel entered kill scope');
  assert.equal(error.termination?.reaped, true);
});

test('cancellation shares the owned-tree terminator and waits for descendant cleanup', {
  timeout: 4_000,
}, async () => {
  const fixture = await spawnLauncherTree();
  const cancellation = new AbortController();
  const startedAt = Date.now();
  const supervised = superviseProviderChild(ownChild(fixture.launcher), {
    operation: 'exec',
    deadline: createProviderRequestDeadline(1_000),
    limits: DEFAULT_LIMITS,
    signal: cancellation.signal,
  });
  cancellation.abort(new Error('controlled cancellation'));
  const error = await expectSupervisorError(supervised, 'cancelled', 'exec');
  const elapsedMs = Date.now() - startedAt;
  traceTreeLifecycle('cancel-uncooperative', fixture, elapsedMs);

  assert.ok(elapsedMs < 1_000, `cancel cleanup settled after ${elapsedMs}ms`);
  assert.equal(pidExists(fixture.launcherPid), false, 'launcher survived cancellation');
  assert.equal(pidExists(fixture.grandchildPid), false, 'grandchild survived cancellation');
  assert.equal(error.termination?.reaped, true);
});

test('a SIGTERM-cooperative launcher tree exits during grace without force-kill', {
  timeout: 4_000,
}, async () => {
  const fixture = await spawnLauncherTree({ cooperative: true });
  const startedAt = Date.now();
  const error = await expectSupervisorError(
    superviseProviderChild(ownChild(fixture.launcher), {
      operation: 'exec',
      deadline: createProviderRequestDeadline(100),
      limits: { ...DEFAULT_LIMITS, idleTimeoutMs: 500 },
    }),
    'hard_timeout',
    'exec',
  );
  const elapsedMs = Date.now() - startedAt;
  traceTreeLifecycle('hard-timeout-cooperative', fixture, elapsedMs);

  assert.ok(elapsedMs < 1_000, `cooperative cleanup settled after ${elapsedMs}ms`);
  assert.equal(pidExists(fixture.launcherPid), false);
  assert.equal(pidExists(fixture.grandchildPid), false);
  assert.equal(error.termination?.signal, 'SIGTERM');
  assert.equal(error.termination?.reaped, true);
});

test('launcher close cannot resolve while its uncooperative grandchild remains alive', {
  timeout: 4_000,
}, async () => {
  const fixture = await spawnLauncherTree({ launcherCooperative: true });
  const startedAt = Date.now();
  const error = await expectSupervisorError(
    superviseProviderChild(ownChild(fixture.launcher), {
      operation: 'exec',
      deadline: createProviderRequestDeadline(100),
      limits: { ...DEFAULT_LIMITS, idleTimeoutMs: 500 },
    }),
    'hard_timeout',
    'exec',
  );
  const elapsedMs = Date.now() - startedAt;
  traceTreeLifecycle('launcher-close-grandchild-uncooperative', fixture, elapsedMs);

  assert.ok(elapsedMs < 1_000, `post-launcher cleanup settled after ${elapsedMs}ms`);
  assert.equal(pidExists(fixture.launcherPid), false);
  assert.equal(pidExists(fixture.grandchildPid), false, 'grandchild survived launcher close');
  assert.equal(error.termination?.signal, 'SIGTERM');
  assert.equal(error.termination?.reaped, true);
});

test('parser failure uses the same bounded owned-tree terminator as timeout paths', {
  timeout: 4_000,
}, async () => {
  const fixture = await spawnLauncherTree({ emitParserInput: true });
  const startedAt = Date.now();
  const error = await expectSupervisorError(
    superviseProviderChild(ownChild(fixture.launcher), {
      operation: 'exec',
      deadline: createProviderRequestDeadline(1_000),
      limits: DEFAULT_LIMITS,
      onStdoutText: () => {
        throw new Error('controlled parser failure');
      },
    }),
    'consumer_error',
    'exec',
  );
  const elapsedMs = Date.now() - startedAt;
  traceTreeLifecycle('parser-failure-uncooperative', fixture, elapsedMs);

  assert.ok(elapsedMs < 1_000, `parser cleanup settled after ${elapsedMs}ms`);
  assert.equal(pidExists(fixture.launcherPid), false, 'launcher survived parser failure');
  assert.equal(pidExists(fixture.grandchildPid), false, 'grandchild survived parser failure');
  assert.equal(error.termination?.reaped, true);
});

test('an expired shared absolute deadline is not reset for the next child', async () => {
  const deadline = createProviderRequestDeadline(15);
  await new Promise((resolve) => setTimeout(resolve, 30));
  const child = fakeUnstartedChild();
  const startedAt = Date.now();

  const error = await expectSupervisorError(
    superviseProviderChild(ownChild(child), {
      operation: 'version',
      deadline,
      limits: DEFAULT_LIMITS,
    }),
    'hard_timeout',
    'version',
  );

  assert.ok(Date.now() - startedAt < 50, 'expired request budget must fail immediately');
  assert.deepEqual(child.signals, ['SIGTERM']);
  assert.equal(error.termination?.reaped, true);
});
