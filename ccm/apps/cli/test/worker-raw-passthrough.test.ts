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
} else if (argv.find((value) => value.startsWith('--emit-bytes='))) {
  const spec = argv.find((value) => value.startsWith('--emit-bytes='));
  process.stdout.write('x'.repeat(Number(spec.slice('--emit-bytes='.length))));
} else if (argv.find((value) => value.startsWith('--emit-stderr-bytes='))) {
  const spec = argv.find((value) => value.startsWith('--emit-stderr-bytes='));
  process.stderr.write('e'.repeat(Number(spec.slice('--emit-stderr-bytes='.length))));
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
  settleProbes = 30,
  survivors?: Array<{ pid: number; name: string; commandLine: string }>,
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
                  // Keep the fake tree alive across `settleProbes` post-close polls (~5ms each) so the
                  // regression proves close settlement is tied to full-tree reap observation across the
                  // configurable reap window, not to signal escalation timing.
                  return postCloseProbes <= settleProbes;
                }
                return survivorAlive;
              },
              ...(survivors === undefined
                ? {}
                : {
                    listMembers: () => (launcherClosed && survivorAlive ? survivors : []),
                  }),
            },
          };
        },
      },
    },
  };
}

function realCursorServiceSurvivors(cursorInstallDir: string, cursorHome: string) {
  return [
    {
      pid: 7_001,
      // Node 24 reports `MainThread` in ps(1)'s comm column even though args starts with the
      // packaged node binary. Classification must be bound to the exact argv, not this mutable
      // process title.
      name: 'MainThread',
      commandLine: `${join(cursorInstallDir, 'node')} ${join(
        cursorInstallDir,
        'index.js',
      )} worker-server`,
    },
    {
      pid: 7_002,
      name: 'npm',
      commandLine: 'exec typesc npm exec typescript-language-server --stdio',
    },
    {
      pid: 7_003,
      name: 'sh',
      commandLine: 'sh -c "typescript-language-server" --stdio',
    },
    {
      pid: 7_004,
      name: 'MainThread',
      commandLine: `node ${join(
        cursorHome,
        '.npm',
        '_npx',
        '94207acffe67148d',
        'node_modules',
        '.bin',
        'typescript-language-server',
      )} --stdio`,
    },
  ];
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
  omitMaxOutputBytes?: boolean;
  envOverride?: Record<string, string | undefined>;
  signal?: AbortSignal;
  processSignal?: NodeJS.Signals;
  providerRuntime?: ProviderRuntime;
}): Promise<{
  code: number;
  envelope: WorkerEnvelope | null;
  stderr: string;
  spawns: ProviderSpawnSpec[];
}> {
  const env = { ...testEnv(), ...input.envOverride };
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
      ...(input.omitMaxOutputBytes
        ? []
        : ['--max-output-bytes', String(input.maxOutputBytes ?? 65_536)]),
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

test('registry preserves raw help/run and adds tracked dispatch without changing raw contracts', () => {
  assert.deepEqual(Object.keys(REGISTRY.worker ?? {}).sort(), ['dispatch', 'help', 'run']);
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
  assert.match(REGISTRY.worker?.run?.options['timeout-ms']?.desc ?? '', /50\.\.7200000/u);
  assert.equal(REGISTRY.dispatch, undefined);
  assert.equal(REGISTRY.worker?.dispatch?.options['idempotency-key']?.required, true);
  assert.equal(REGISTRY.worker?.dispatch?.options.task?.required, true);
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

test('worker run defaults sandbox OFF for every harness yet preserves a caller-supplied sandbox flag', async () => {
  // Default dispatch is a raw argv/env passthrough (registry R0): ccm must never inject a sandbox
  // for any harness. The spawned argv carries no `--sandbox` and the child env carries no
  // `CODEX_SANDBOX` unless the caller put them there. This pins "dispatch defaults to no sandbox".
  for (const harness of ['codex', 'claude-code', 'cursor-agent', 'kimi-code'] as const) {
    const providerArgv = harness === 'codex' ? ['exec', '--flag', 'value'] : ['--flag', 'value'];
    const invoked = await invokeRun({ harness, providerArgv });
    assert.equal(invoked.code, 0, harness);
    assert.equal(invoked.spawns.length, 1, harness);
    const spec = invoked.spawns[0];
    assert.equal(spec?.argv.includes('--sandbox'), false, `${harness}: no injected --sandbox`);
    assert.deepEqual(spec?.argv, providerArgv, harness);
    assert.equal(spec?.env.CODEX_SANDBOX, undefined, `${harness}: no injected CODEX_SANDBOX`);
  }

  // Explicit opt-in is untouched: a caller-supplied `--sandbox <mode>` flows through verbatim, so
  // users who *want* a sandbox keep that capability — only the default changed, not the ability.
  const explicit = await invokeRun({
    harness: 'codex',
    providerArgv: ['exec', '--sandbox', 'read-only', '--flag', 'value'],
  });
  assert.equal(explicit.code, 0);
  assert.equal(explicit.spawns.length, 1);
  assert.deepEqual(explicit.spawns[0]?.argv, ['exec', '--sandbox', 'read-only', '--flag', 'value']);
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
  const cursorInstallDir = resolve(join(executables.cursor, '..'));
  const fixture = runtimeWithPostCloseTree(testEnv(), 'survives', 30, [
    ...realCursorServiceSurvivors(cursorInstallDir, home),
    { pid: 7_005, name: 'bash', commandLine: 'bash -c run-real-worker-task-forever' },
  ]);
  const invoked = await invokeRun({
    harness: 'cursor-agent',
    providerArgv: ['--model', 'cursor-first-party-test'],
    stdin: 'offline cursor request',
    // Shrink the reap window so this fail-closed regression stays fast; also proves
    // CCM_WORKER_REAP_TIMEOUT_MS is honored and bounded.
    envOverride: { CCM_WORKER_REAP_TIMEOUT_MS: '300' },
    providerRuntime: fixture.providerRuntime,
  });

  assert.equal(invoked.code, 1);
  assert.equal(invoked.envelope?.state, 'failed');
  assert.equal(invoked.envelope?.error?.code, 'owned_tree_survived');
  assert.equal(invoked.envelope?.reaped, true);
  assert.deepEqual(fixture.signals, ['SIGTERM']);
});

test('cursor worker treats its exact packaged worker-server as benign after launcher close', async () => {
  const cursorInstallDir = resolve(join(executables.cursor, '..'));
  const fixture = runtimeWithPostCloseTree(testEnv(), 'survives', 30, [
    {
      pid: 7_001,
      // Ground truth from the real Cursor 2026.07.16 worker-server on Node 24.
      name: 'MainThread',
      commandLine: `${join(cursorInstallDir, 'node')} ${join(
        cursorInstallDir,
        'index.js',
      )} worker-server`,
    },
  ]);
  const invoked = await invokeRun({
    harness: 'cursor-agent',
    providerArgv: ['--model', 'cursor-first-party-test'],
    stdin: 'offline cursor request',
    envOverride: { CCM_WORKER_REAP_TIMEOUT_MS: '300' },
    providerRuntime: fixture.providerRuntime,
  });

  assert.equal(invoked.code, 0);
  assert.equal(invoked.envelope?.state, 'exited');
  assert.equal(invoked.envelope?.exit_code, 0);
  assert.equal(invoked.envelope?.error, null);
  assert.equal(invoked.envelope?.reaped, true);
  assert.deepEqual(fixture.signals, [], 'the exact Cursor worker-server is not request-owned');
});

test('cursor worker treats the real worker-server plus TypeScript language-service tree as benign', async () => {
  const cursorInstallDir = resolve(join(executables.cursor, '..'));
  const fixture = runtimeWithPostCloseTree(
    testEnv(),
    'survives',
    30,
    realCursorServiceSurvivors(cursorInstallDir, home),
  );
  const invoked = await invokeRun({
    harness: 'cursor-agent',
    providerArgv: ['--model', 'cursor-first-party-test'],
    stdin: 'offline cursor request',
    envOverride: { CCM_WORKER_REAP_TIMEOUT_MS: '300' },
    providerRuntime: fixture.providerRuntime,
  });

  assert.equal(invoked.code, 0);
  assert.equal(invoked.envelope?.state, 'exited');
  assert.equal(invoked.envelope?.exit_code, 0);
  assert.equal(invoked.envelope?.error, null);
  assert.equal(invoked.envelope?.reaped, true);
  assert.deepEqual(fixture.signals, [], 'Cursor-owned language services are not request work');
});

test('worker preserves a completed transcript when a benign helper drains past the former 1s window', async () => {
  // Regression: cursor-agent's launcher can exit leaving a short-lived owned helper that outlives the
  // old 1s reap budget. That tripped owned_tree_survived and discarded an otherwise-complete
  // transcript. With a generous (here overridden) reap window the helper drains naturally, so the run
  // succeeds with its transcript intact and no termination signal is ever sent.
  const fixture = runtimeWithPostCloseTree(testEnv(), 'settles', 260); // ~1.3s drain, past the old 1s.
  const invoked = await invokeRun({
    harness: 'cursor-agent',
    providerArgv: ['--model', 'cursor-first-party-test'],
    stdin: 'offline cursor request',
    envOverride: { CCM_WORKER_REAP_TIMEOUT_MS: '3000' },
    providerRuntime: fixture.providerRuntime,
  });

  assert.equal(invoked.code, 0);
  assert.equal(invoked.envelope?.state, 'exited');
  assert.equal(invoked.envelope?.exit_code, 0);
  assert.equal(invoked.envelope?.reaped, true);
  assert.equal(invoked.envelope?.error, null);
  const transcript = JSON.parse(invoked.envelope?.stdout ?? '{}') as { stdin: string };
  assert.equal(transcript.stdin, 'offline cursor request');
  assert.deepEqual(fixture.signals, [], 'a naturally-draining helper must not be force-terminated');
});

test('worker no longer kills a large-output dispatch: raised ceiling + default accept multi-MiB stdout', async () => {
  // Regression: the former 1 MiB per-stream cap tripped output_limit and TERM/KILLed large-output
  // dispatches (e.g. codex emitting a big blueprint/state) mid-task. A 1.5 MiB stdout must now flow
  // through both an explicit >1 MiB budget and the default budget without truncation.
  const emitBytes = 1_572_864; // 1.5 MiB, over the former 1 MiB ceiling.
  const explicit = await invokeRun({
    harness: 'codex',
    providerArgv: [`--emit-bytes=${emitBytes}`],
    maxOutputBytes: 2_097_152, // 2 MiB — previously rejected as above the 1 MiB ceiling.
  });
  assert.equal(explicit.code, 0);
  assert.equal(explicit.envelope?.state, 'exited');
  assert.deepEqual(explicit.envelope?.truncated, { stdout: false, stderr: false });
  assert.equal(explicit.envelope?.stdout_bytes, emitBytes);

  const byDefault = await invokeRun({
    harness: 'codex',
    providerArgv: [`--emit-bytes=${emitBytes}`],
    omitMaxOutputBytes: true, // exercise DEFAULT_MAX_OUTPUT_BYTES (now 512 MiB, was 1 MiB).
  });
  assert.equal(byDefault.code, 0);
  assert.equal(byDefault.envelope?.state, 'exited');
  assert.deepEqual(byDefault.envelope?.truncated, { stdout: false, stderr: false });
  assert.equal(byDefault.envelope?.stdout_bytes, emitBytes);
});

test('worker default budget now flows stdout past the former 32 MiB ceiling without truncation', async () => {
  // Regression: the 32 MiB ceiling truncated real multi-ten-MiB payloads mid-task. One byte over
  // the former ceiling must now stream through the default (512 MiB) budget with no output_limit.
  const emitBytes = 33_554_433; // one byte over the former 32 MiB ceiling.
  const invoked = await invokeRun({
    harness: 'codex',
    providerArgv: [`--emit-bytes=${emitBytes}`],
    omitMaxOutputBytes: true,
  });
  assert.equal(invoked.code, 0);
  assert.equal(invoked.envelope?.state, 'exited');
  assert.deepEqual(invoked.envelope?.truncated, { stdout: false, stderr: false });
  assert.equal(invoked.envelope?.stdout_bytes, emitBytes);
});

test('worker default budget now flows a multi-MiB stderr past the former 8 MiB cap', async () => {
  // Regression: a codex worker's stderr routinely runs to tens of MiB; the former 8 MiB
  // independent cap discarded exactly the diagnostics a failed dispatch needs. 16 MiB must now
  // pass untruncated.
  const emitBytes = 16_777_216; // 16 MiB, over the former 8 MiB stderr cap.
  const invoked = await invokeRun({
    harness: 'codex',
    providerArgv: [`--emit-stderr-bytes=${emitBytes}`],
    omitMaxOutputBytes: true,
  });
  assert.equal(invoked.code, 0);
  assert.equal(invoked.envelope?.state, 'exited');
  assert.deepEqual(invoked.envelope?.truncated, { stdout: false, stderr: false });
  assert.equal(invoked.envelope?.stderr_bytes, emitBytes);
});

test('worker still bounds --max-output-bytes at the 512 MiB ceiling', async () => {
  // Values over the former 32 MiB ceiling but under the new 512 MiB one must now be accepted,
  // exactly at the ceiling included; one byte above must still be rejected before any spawn.
  const underCeiling = await invokeRun({
    harness: 'codex',
    providerArgv: ['--flag', 'value'],
    maxOutputBytes: 268_435_456, // 256 MiB — over the former 32 MiB ceiling, under the new one.
  });
  assert.equal(underCeiling.code, 0);
  assert.equal(underCeiling.envelope?.state, 'exited');

  const atCeiling = await invokeRun({
    harness: 'codex',
    providerArgv: ['--flag', 'value'],
    maxOutputBytes: 536_870_912, // exactly the 512 MiB ceiling.
  });
  assert.equal(atCeiling.code, 0);
  assert.equal(atCeiling.envelope?.state, 'exited');

  const rejected = await invokeRun({
    harness: 'codex',
    providerArgv: ['--flag', 'value'],
    maxOutputBytes: 536_870_913, // one byte over the 512 MiB ceiling.
  });
  assert.equal(rejected.code, 1);
  assert.equal(rejected.envelope?.state, 'rejected');
  assert.equal(rejected.envelope?.error?.code, 'request_rejected');
  assert.equal(rejected.spawns.length, 0);
});

test('worker accepts a two-hour timeout and rejects one millisecond above it', async () => {
  const accepted = await invokeRun({
    harness: 'codex',
    providerArgv: ['--flag', 'value'],
    timeoutMs: 7_200_000,
  });
  assert.equal(accepted.code, 0);
  assert.equal(accepted.envelope?.state, 'exited');

  const rejected = await invokeRun({
    harness: 'codex',
    providerArgv: ['--flag', 'value'],
    timeoutMs: 7_200_001,
  });
  assert.equal(rejected.code, 1);
  assert.equal(rejected.envelope?.state, 'rejected');
  assert.equal(rejected.envelope?.error?.code, 'request_rejected');
  assert.equal(rejected.spawns.length, 0);
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
