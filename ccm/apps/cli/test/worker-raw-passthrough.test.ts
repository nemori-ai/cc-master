import assert from 'node:assert/strict';
import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, test } from 'node:test';
import {
  createDefaultProviderRuntime,
  PROVIDER_PROCESS_TREE_SCHEMA,
  type ProviderRuntime,
  type ProviderSpawnSpec,
} from '../src/provider-runtime.js';
import { REGISTRY } from '../src/registry.js';
import { run } from '../src/router.js';

const root = mkdtempSync(join(tmpdir(), 'ccm-worker-raw-test-'));
const workspace = resolve(join(root, 'workspace'));
const home = resolve(join(root, 'home'));
mkdirSync(workspace, { recursive: true });
mkdirSync(home, { recursive: true });

after(() => rmSync(root, { recursive: true, force: true }));

function makeFake(name: string): string {
  const executable = resolve(join(root, name));
  writeFileSync(
    executable,
    `#!/usr/bin/env node
const fs = require('node:fs');
const argv = process.argv.slice(2);
if (argv.at(-1) === '--help') {
  process.stdout.write('REAL-HELP:' + JSON.stringify(argv) + '\\n');
  process.stderr.write('REAL-HELP-ERR\\n');
  process.exit(process.argv[1].includes('help-exit-23') ? 23 : 0);
}
if (argv.includes('--no-output-hang')) {
  setInterval(() => {}, 1000);
} else if (argv.includes('--started-hang')) {
  process.stdout.write('started');
  setInterval(() => {}, 1000);
} else if (argv.includes('--large-output')) {
  process.stdout.write('x'.repeat(4096));
} else {
  let stdin = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => { stdin += chunk; });
  process.stdin.on('end', () => {
    process.stdout.write(JSON.stringify({
      argv,
      cwd: process.cwd(),
      stdin,
      forbidden_env: Boolean(
        process.env.OPENAI_API_KEY ||
        process.env.ANTHROPIC_API_KEY ||
        process.env.CURSOR_API_KEY
      )
    }));
    const exitArg = argv.find((value) => value.startsWith('--exit='));
    process.exit(exitArg ? Number(exitArg.slice('--exit='.length)) : 0);
  });
}
`,
    'utf8',
  );
  chmodSync(executable, 0o755);
  return executable;
}

const executables = {
  codex: makeFake('codex'),
  claude: makeFake('claude'),
  cursor: makeFake('agent'),
  kimi: makeFake('kimi'),
  helpExit23: makeFake('help-exit-23'),
};

interface WorkerEnvelope {
  schema: string;
  harness: string;
  executable: string | null;
  argv: string[];
  cwd: string;
  state: string;
  exit_code: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  stdout_bytes: number;
  stderr_bytes: number;
  truncated: { stdout: boolean; stderr: boolean };
  timed_out: boolean;
  cancelled: boolean;
  reaped: boolean;
  duration_ms: number | null;
  cleanup: { temporary_resources_removed: boolean };
  error: { code: string; message: string } | null;
}

function runtime(
  env: Record<string, string | undefined>,
  spawns: ProviderSpawnSpec[],
  afterSpawn?: () => void,
): ProviderRuntime {
  const actual = createDefaultProviderRuntime(env);
  return {
    ...actual,
    process: {
      resolveExecutable: actual.process.resolveExecutable,
      spawnProvider(spec) {
        spawns.push(structuredClone(spec));
        const child = actual.process.spawnProvider(spec);
        afterSpawn?.();
        return child;
      },
    },
  };
}

function runtimeWithPostCloseTree(
  env: Record<string, string | undefined>,
  mode: 'settles' | 'survives',
): { providerRuntime: ProviderRuntime; signals: NodeJS.Signals[] } {
  const actual = createDefaultProviderRuntime(env);
  const signals: NodeJS.Signals[] = [];
  return {
    signals,
    providerRuntime: {
      ...actual,
      process: {
        resolveExecutable: actual.process.resolveExecutable,
        spawnProvider(spec) {
          const owned = actual.process.spawnProvider(spec);
          let launcherClosed = false;
          let postCloseProbes = 0;
          let survivorAlive = true;
          owned.child.once('close', () => {
            launcherClosed = true;
          });
          return {
            child: owned.child,
            tree: {
              schema: PROVIDER_PROCESS_TREE_SCHEMA,
              kind: 'posix-process-group',
              groupId: owned.tree?.groupId ?? Number(owned.child.pid),
              signal(signal) {
                signals.push(signal);
                survivorAlive = false;
                return true;
              },
              isAlive() {
                if (!launcherClosed) return true;
                if (mode === 'settles') {
                  postCloseProbes += 1;
                  // Raw workers use a 100ms TERM grace and a 1s reap budget. Keep the fake tree
                  // alive beyond the former so the regression proves close settlement is tied to
                  // full-tree reap observation, not to signal escalation timing.
                  return postCloseProbes <= 30;
                }
                return survivorAlive;
              },
            },
          };
        },
      },
    },
  };
}

function testEnv(): Record<string, string | undefined> {
  return {
    PATH: process.env.PATH || '/usr/bin:/bin',
    HOME: home,
    CCM_CODEX_BIN: executables.codex,
    CCM_CLAUDE_BIN: executables.claude,
    CCM_CURSOR_AGENT_BIN: executables.cursor,
    CCM_KIMI_BIN: executables.kimi,
    OPENAI_API_KEY: 'must-not-forward-openai',
    ANTHROPIC_API_KEY: 'must-not-forward-anthropic',
    CURSOR_API_KEY: 'must-not-forward-cursor',
  };
}

async function invokeHelp(
  harness: string,
  input: { scope?: 'agent' | 'root'; overrideEnv?: Record<string, string | undefined> } = {},
): Promise<{
  code: number;
  stdout: string;
  stderr: string;
  spawns: ProviderSpawnSpec[];
}> {
  const env = { ...testEnv(), ...input.overrideEnv };
  const stdout: string[] = [];
  const stderr: string[] = [];
  const spawns: ProviderSpawnSpec[] = [];
  const code = await run(
    [
      'worker',
      'help',
      '--harness',
      harness,
      ...(input.scope === undefined ? [] : ['--scope', input.scope]),
    ],
    {
      env,
      out: (value) => stdout.push(value),
      err: (value) => stderr.push(value),
      providerRuntime: runtime(env, spawns),
    },
  );
  return { code, stdout: stdout.join(''), stderr: stderr.join(''), spawns };
}

async function invokeRun(input: {
  harness: string;
  providerArgv: string[];
  stdin?: string;
  cwd?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
  signal?: AbortSignal;
  processSignal?: NodeJS.Signals;
  providerRuntime?: ProviderRuntime;
}): Promise<{
  code: number;
  envelope: WorkerEnvelope | null;
  stderr: string;
  spawns: ProviderSpawnSpec[];
}> {
  const env = testEnv();
  const stdout: string[] = [];
  const stderr: string[] = [];
  const spawns: ProviderSpawnSpec[] = [];
  const stdinPath = resolve(join(root, `stdin-${Date.now()}-${Math.random()}`));
  writeFileSync(stdinPath, input.stdin ?? '', 'utf8');
  const fd = openSync(stdinPath, 'r');
  try {
    const args = [
      'worker',
      'run',
      '--harness',
      input.harness,
      ...(input.cwd === undefined ? [] : ['--cwd', input.cwd]),
      '--timeout-ms',
      String(input.timeoutMs ?? 2_000),
      '--max-output-bytes',
      String(input.maxOutputBytes ?? 65_536),
      '--',
      ...input.providerArgv,
    ];
    const code = await run(args, {
      env,
      stdin: { fd },
      out: (value) => stdout.push(value),
      err: (value) => stderr.push(value),
      providerRuntime:
        input.providerRuntime ??
        runtime(env, spawns, () => {
          if (input.processSignal) {
            queueMicrotask(() =>
              process.emit(input.processSignal as NodeJS.Signals, input.processSignal),
            );
          }
        }),
      workerSignal: input.signal,
    });
    const text = stdout.join('');
    const envelope = text ? (JSON.parse(text) as { ok: true; data: WorkerEnvelope }).data : null;
    return { code, envelope, stderr: stderr.join(''), spawns };
  } finally {
    closeSync(fd);
    rmSync(stdinPath, { force: true });
  }
}

test('registry freezes one raw worker namespace with help and run', () => {
  assert.deepEqual(Object.keys(REGISTRY.worker ?? {}).sort(), ['help', 'run']);
  assert.deepEqual(REGISTRY.worker?.help?.options.harness?.enum, [
    'codex',
    'claude-code',
    'cursor-agent',
    'kimi-code',
  ]);
  assert.deepEqual(REGISTRY.worker?.help?.options.scope?.enum, ['agent', 'root']);
  assert.equal(REGISTRY.worker?.run?.options.harness?.enum, undefined);
  assert.equal(REGISTRY.worker?.run?.options.model, undefined);
  assert.equal(REGISTRY.worker?.run?.options.effort, undefined);
  assert.equal(REGISTRY.worker?.run?.options.cwd?.required, false);
  assert.equal(REGISTRY.dispatch, undefined);
});

test('worker help defaults to agent scope and root scope launches executable help', async () => {
  const expected = {
    codex: ['exec', '--help'],
    'claude-code': ['--help'],
    'cursor-agent': ['--help'],
    'kimi-code': ['--help'],
  } as const;
  for (const [harness, argv] of Object.entries(expected)) {
    const invoked = await invokeHelp(harness);
    assert.equal(invoked.code, 0, harness);
    assert.equal(invoked.spawns.length, 1, harness);
    assert.deepEqual(invoked.spawns[0]?.argv, argv, harness);
    assert.equal(invoked.stdout, `REAL-HELP:${JSON.stringify(argv)}\n`, harness);
    assert.equal(invoked.stderr, 'REAL-HELP-ERR\n', harness);
  }

  for (const harness of Object.keys(expected)) {
    const invoked = await invokeHelp(harness, { scope: 'root' });
    assert.equal(invoked.code, 0, harness);
    assert.equal(invoked.spawns.length, 1, harness);
    assert.deepEqual(invoked.spawns[0]?.argv, ['--help'], harness);
    assert.equal(invoked.stdout, 'REAL-HELP:["--help"]\n', harness);
    assert.equal(invoked.stderr, 'REAL-HELP-ERR\n', harness);
  }

  const unknown = await invokeHelp('unknown');
  assert.equal(unknown.code, 2);
  assert.equal(unknown.spawns.length, 0);
});

test('worker help raw-mirrors a provider nonzero exit', async () => {
  const invoked = await invokeHelp('claude-code', {
    overrideEnv: { CCM_CLAUDE_BIN: executables.helpExit23 },
  });
  assert.equal(invoked.code, 23);
  assert.equal(invoked.spawns.length, 1);
  assert.deepEqual(invoked.spawns[0]?.argv, ['--help']);
  assert.equal(invoked.stdout, 'REAL-HELP:["--help"]\n');
  assert.equal(invoked.stderr, 'REAL-HELP-ERR\n');
});

test('worker run --help renders wrapper help without launching a provider', async () => {
  const env = testEnv();
  const stdout: string[] = [];
  let spawnCount = 0;
  const actual = createDefaultProviderRuntime(env);
  const providerRuntime: ProviderRuntime = {
    ...actual,
    process: {
      resolveExecutable: actual.process.resolveExecutable,
      spawnProvider() {
        spawnCount += 1;
        throw new Error('wrapper help must not spawn');
      },
    },
  };
  const code = await run(['worker', 'run', '--help'], {
    env,
    out: (value) => stdout.push(value),
    err: () => undefined,
    providerRuntime,
  });
  assert.equal(code, 0);
  assert.equal(spawnCount, 0);
  assert.match(stdout.join(''), /ccm worker run/u);
  assert.match(stdout.join(''), /--cwd/u);
});

test('worker run preserves raw argv order/metacharacters, inherited stdin bytes, and explicit cwd', async () => {
  const sentinel = resolve(join(root, 'shell-must-not-run'));
  const rawArgv = [
    '--model',
    'model with spaces',
    '',
    `$(touch ${sentinel})`,
    ';',
    '|',
    '>',
    'quoted"value',
    "single'value",
  ];
  const invoked = await invokeRun({
    harness: 'codex',
    providerArgv: rawArgv,
    stdin: 'byte-for-byte stdin\nsecond line\u0000tail',
    cwd: workspace,
  });

  assert.equal(invoked.code, 0);
  assert.equal(invoked.spawns.length, 1);
  assert.deepEqual(invoked.spawns[0]?.argv, rawArgv);
  assert.equal(invoked.spawns[0]?.cwd, realpathSync(workspace));
  assert.equal(existsSync(sentinel), false);
  assert.equal(invoked.envelope?.schema, 'ccm/worker-process-result/v1');
  assert.equal(invoked.envelope?.state, 'exited');
  assert.equal(invoked.envelope?.exit_code, 0);
  assert.equal(invoked.envelope?.reaped, true);
  const child = JSON.parse(invoked.envelope?.stdout ?? '{}') as {
    argv: string[];
    cwd: string;
    stdin: string;
    forbidden_env: boolean;
  };
  assert.deepEqual(child.argv, rawArgv);
  assert.equal(child.cwd, realpathSync(workspace));
  assert.equal(child.stdin, 'byte-for-byte stdin\nsecond line\u0000tail');
  assert.equal(child.forbidden_env, false);
  assert.equal(invoked.envelope?.stderr, '');
  assert.deepEqual(invoked.envelope?.truncated, { stdout: false, stderr: false });
  assert.equal(invoked.envelope?.timed_out, false);
  assert.equal(invoked.envelope?.cancelled, false);
});

test('worker run passes the complete provider argv unchanged and defaults cwd to process.cwd()', async () => {
  for (const harness of ['codex', 'claude-code', 'cursor-agent', 'kimi-code'] as const) {
    const providerArgv =
      harness === 'codex'
        ? ['--ask-for-approval', 'never', 'exec', '--flag', 'value']
        : ['--flag', 'value'];
    const invoked = await invokeRun({ harness, providerArgv });
    assert.equal(invoked.code, 0, harness);
    assert.equal(invoked.spawns.length, 1, harness);
    assert.deepEqual(invoked.spawns[0]?.argv, providerArgv, harness);
    assert.equal(invoked.spawns[0]?.cwd, realpathSync(process.cwd()), harness);
  }
});

test('worker run resolves a relative --cwd against the process cwd instead of rejecting it', async () => {
  // Regression: `--cwd .` (any relative path) used to fail cwd validation before executable
  // resolution ran, returning an executable:null / request_rejected envelope that masked the real
  // cause and read as a per-harness "executable resolution regression". A relative --cwd now
  // resolves against process.cwd() (mirroring the omitted-cwd default), so the worker launches with
  // an absolute, realpath-normalized cwd for every harness.
  for (const harness of ['codex', 'claude-code', 'cursor-agent', 'kimi-code'] as const) {
    const invoked = await invokeRun({ harness, providerArgv: ['--flag', 'value'], cwd: '.' });
    assert.equal(invoked.code, 0, harness);
    assert.equal(invoked.spawns.length, 1, harness);
    assert.notEqual(invoked.envelope?.executable, null, harness);
    assert.equal(invoked.envelope?.state, 'exited', harness);
    assert.equal(invoked.envelope?.error, null, harness);
    assert.equal(invoked.spawns[0]?.cwd, realpathSync(process.cwd()), harness);
    assert.equal(invoked.envelope?.cwd, realpathSync(process.cwd()), harness);
  }
});

test('worker rejects unknown harness, bad cwd, and unavailable executable before spawn', async () => {
  const unknown = await invokeRun({ harness: 'unknown', providerArgv: ['--mystery'] });
  assert.equal(unknown.code, 1);
  assert.equal(unknown.envelope?.schema, 'ccm/worker-process-result/v1');
  assert.equal(unknown.envelope?.state, 'rejected');
  assert.equal(unknown.envelope?.error?.code, 'unknown_harness');
  assert.equal(unknown.envelope?.harness, 'unknown');
  assert.deepEqual(unknown.envelope?.argv, ['--mystery']);
  assert.equal(unknown.spawns.length, 0);

  // A relative --cwd is resolved against process.cwd(); a cwd that resolves to a non-existent
  // directory is still rejected before spawn (request_rejected), just not for being relative.
  const badCwd = await invokeRun({
    harness: 'codex',
    providerArgv: [],
    cwd: 'no-such-dir-worker-regression',
  });
  assert.equal(badCwd.code, 1);
  assert.equal(badCwd.envelope?.state, 'rejected');
  assert.equal(badCwd.envelope?.error?.code, 'request_rejected');
  assert.equal(badCwd.spawns.length, 0);

  const env = testEnv();
  const unavailable: ProviderRuntime = {
    ...createDefaultProviderRuntime(env),
    process: {
      resolveExecutable: () => null,
      spawnProvider: () => {
        throw new Error('must not spawn');
      },
    },
  };
  const missing = await invokeRun({
    harness: 'codex',
    providerArgv: [],
    providerRuntime: unavailable,
  });
  assert.equal(missing.code, 1);
  assert.equal(missing.envelope?.state, 'rejected');
  assert.equal(missing.envelope?.error?.code, 'executable_unavailable');
});

test('worker mirrors provider nonzero exit inside the generic envelope', async () => {
  const invoked = await invokeRun({ harness: 'claude-code', providerArgv: ['--exit=17'] });
  assert.equal(invoked.code, 17);
  assert.equal(invoked.envelope?.state, 'exited');
  assert.equal(invoked.envelope?.exit_code, 17);
  assert.equal(invoked.envelope?.signal, null);
  assert.equal(invoked.envelope?.reaped, true);
});

test('worker preserves a completed provider transcript while its owned tree naturally settles', async () => {
  const fixture = runtimeWithPostCloseTree(testEnv(), 'settles');
  const invoked = await invokeRun({
    harness: 'cursor-agent',
    providerArgv: ['--model', 'cursor-first-party-test'],
    stdin: 'offline cursor request',
    providerRuntime: fixture.providerRuntime,
  });

  assert.equal(invoked.code, 0);
  assert.equal(invoked.envelope?.state, 'exited');
  assert.equal(invoked.envelope?.exit_code, 0);
  assert.equal(invoked.envelope?.reaped, true);
  assert.equal(invoked.envelope?.error, null);
  const transcript = JSON.parse(invoked.envelope?.stdout ?? '{}') as {
    argv: string[];
    stdin: string;
  };
  assert.deepEqual(transcript.argv, ['--model', 'cursor-first-party-test']);
  assert.equal(transcript.stdin, 'offline cursor request');
  assert.deepEqual(fixture.signals, [], 'natural settlement must not terminate the provider tree');
});

test('worker still fails closed when an owned descendant survives the post-close settlement window', async () => {
  const fixture = runtimeWithPostCloseTree(testEnv(), 'survives');
  const invoked = await invokeRun({
    harness: 'cursor-agent',
    providerArgv: ['--model', 'cursor-first-party-test'],
    stdin: 'offline cursor request',
    providerRuntime: fixture.providerRuntime,
  });

  assert.equal(invoked.code, 1);
  assert.equal(invoked.envelope?.state, 'failed');
  assert.equal(invoked.envelope?.error?.code, 'owned_tree_survived');
  assert.equal(invoked.envelope?.reaped, true);
  assert.deepEqual(fixture.signals, ['SIGTERM']);
});

test('worker reports bounded timeout, cancellation, and output truncation after reaping', async () => {
  const timedOut = await invokeRun({
    harness: 'cursor-agent',
    providerArgv: ['--no-output-hang'],
    timeoutMs: 60,
  });
  assert.equal(timedOut.code, 1);
  assert.equal(timedOut.envelope?.state, 'timed_out');
  assert.equal(timedOut.envelope?.timed_out, true);
  assert.equal(timedOut.envelope?.reaped, true);

  const controller = new AbortController();
  const cancellation = invokeRun({
    harness: 'cursor-agent',
    providerArgv: ['--started-hang'],
    signal: controller.signal,
  });
  setTimeout(() => controller.abort(), 50);
  const cancelled = await cancellation;
  assert.equal(cancelled.code, 1);
  assert.equal(cancelled.envelope?.state, 'cancelled');
  assert.equal(cancelled.envelope?.cancelled, true);
  assert.equal(cancelled.envelope?.reaped, true);

  const truncated = await invokeRun({
    harness: 'cursor-agent',
    providerArgv: ['--large-output'],
    maxOutputBytes: 256,
  });
  assert.equal(truncated.code, 1);
  assert.equal(truncated.envelope?.state, 'failed');
  assert.equal(truncated.envelope?.error?.code, 'output_limit');
  assert.deepEqual(truncated.envelope?.truncated, { stdout: true, stderr: false });
  assert.equal(truncated.envelope?.reaped, true);
});

test('worker endpoint relays SIGINT, SIGTERM, and SIGHUP with conventional exits', async () => {
  for (const [processSignal, expectedExit] of [
    ['SIGINT', 130],
    ['SIGTERM', 143],
    ['SIGHUP', 129],
  ] as const) {
    const invoked = await invokeRun({
      harness: 'cursor-agent',
      providerArgv: ['--started-hang'],
      processSignal,
    });
    assert.equal(invoked.code, expectedExit, processSignal);
    assert.equal(invoked.envelope?.state, 'cancelled', processSignal);
    assert.equal(invoked.envelope?.cancelled, true, processSignal);
    assert.equal(invoked.envelope?.reaped, true, processSignal);
  }
});
