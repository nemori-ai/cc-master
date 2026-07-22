import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { WorkerExecutionDirectory } from '../src/harnesses/capability-model.js';
import { createDefaultProviderRuntime, type ProviderRuntime } from '../src/provider-runtime.js';
import { run } from '../src/router.js';

const root = mkdtempSync(join(tmpdir(), 'ccm-worker-dispatch-cli-'));
const home = join(root, 'home');
const counter = join(root, 'spawns.log');

function fake(name: string, identityLine = ''): string {
  const executable = join(root, name);
  writeFileSync(
    executable,
    `#!/usr/bin/env node
const fs = require('node:fs');
fs.appendFileSync(${JSON.stringify(counter)}, ${JSON.stringify(name)} + '\\n');
const argv = process.argv.slice(2);
${identityLine ? `process.stdout.write(${JSON.stringify(`${identityLine}\n`)});` : ''}
if (argv.includes('--hang')) setInterval(() => {}, 1000);
else if (argv.includes('--hold')) setTimeout(() => process.exit(0), 350);
else {
  process.stdout.write('provider-result-not-for-board\\n');
  const flag = argv.find((arg) => arg.startsWith('--exit='));
  process.exit(flag ? Number(flag.slice(7)) : 0);
}
`,
  );
  chmodSync(executable, 0o755);
  return executable;
}

const appRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

function runChild(script: string, args: string[], childEnv = env()) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', script, ...args], {
      cwd: appRoot,
      env: childEnv as NodeJS.ProcessEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.setEncoding('utf8').on('data', (chunk) => {
      stderr += chunk;
    });
    child.once('error', reject);
    child.once('close', (code) => resolve({ code, stdout, stderr }));
  });
}

const executables = {
  codex: fake('codex', '{"type":"thread.started","thread_id":"thr_cli_175"}'),
  claude: fake('claude', '{"type":"result","subtype":"success","session_id":"claude_cli_175"}'),
  cursor: fake('cursor-agent'),
  kimi: fake('kimi', '{"role":"meta","type":"session.resume_hint","session_id":"session_cli_175"}'),
};

after(() => rmSync(root, { recursive: true, force: true }));

function env() {
  return {
    PATH: process.env.PATH || '/usr/bin:/bin',
    HOME: home,
    CCM_CODEX_BIN: executables.codex,
    CCM_CLAUDE_BIN: executables.claude,
    CCM_CURSOR_AGENT_BIN: executables.cursor,
    CCM_KIMI_BIN: executables.kimi,
  };
}

function board(name: string) {
  const boardPath = join(root, `${name}.board.json`);
  const task = {
    id: 'T-175',
    status: 'ready',
    deps: [],
    handle: 'unchanged',
    acceptance: 'unchanged',
    routing: { attempts: [{ id: 'unchanged' }] },
  };
  writeFileSync(
    boardPath,
    `${JSON.stringify({
      schema: 'cc-master/v2',
      meta: { template_version: 3 },
      goal: 'CLI tracked dispatch',
      owner: { active: true, session_id: 'owner-cli' },
      git: { worktree: root, branch: 'test' },
      tasks: [task],
    })}\n`,
  );
  return {
    path: realpathSync(boardPath),
    task,
    read: () => JSON.parse(readFileSync(boardPath, 'utf8')),
  };
}

async function invoke(input: {
  boardPath: string;
  harness?: string;
  key?: string;
  intent?: string;
  timeoutMs?: number;
  providerArgv?: string[];
  writeFileAtomicSync?: (path: string, data: string) => void;
  providerRuntime?: ProviderRuntime;
  workerExecutionDirectory?: WorkerExecutionDirectory;
}) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const harness = input.harness ?? 'codex';
  const defaultProviderArgv =
    harness === 'codex'
      ? ['exec', '--json', 'PROMPT-SHOULD-NOT-PERSIST']
      : harness === 'claude-code'
        ? ['--print', '--output-format', 'stream-json', 'PROMPT-SHOULD-NOT-PERSIST']
        : harness === 'kimi-code'
          ? ['-p', 'PROMPT-SHOULD-NOT-PERSIST', '--output-format', 'stream-json']
          : ['--print', 'PROMPT-SHOULD-NOT-PERSIST'];
  const args = [
    'worker',
    'dispatch',
    '--board',
    input.boardPath,
    '--harness',
    harness,
    '--task',
    'T-175',
    '--idempotency-key',
    input.key ?? 'cli-key-175',
    '--intent',
    input.intent ?? 'review patch',
    '--cwd',
    root,
    '--timeout-ms',
    String(input.timeoutMs ?? 2000),
    '--max-output-bytes',
    '65536',
    '--',
    ...(input.providerArgv ?? defaultProviderArgv),
  ];
  const code = await run(args, {
    env: env(),
    out: (text) => stdout.push(text),
    err: (text) => stderr.push(text),
    writeFileAtomicSync: input.writeFileAtomicSync,
    providerRuntime: input.providerRuntime,
    workerExecutionDirectory: input.workerExecutionDirectory,
  });
  return {
    code,
    stdout: stdout.join(''),
    stderr: stderr.join(''),
    envelope: stdout.length > 0 ? JSON.parse(stdout.join('')) : null,
  };
}

test('router requires task, intent, and explicit idempotency key before any board/process effect', async () => {
  for (const omitted of ['task', 'intent', 'idempotency-key']) {
    const f = board(`required-${omitted}`);
    const before = readFileSync(f.path, 'utf8');
    const args = [
      'worker',
      'dispatch',
      '--board',
      f.path,
      '--harness',
      'codex',
      ...(omitted === 'task' ? [] : ['--task', 'T-175']),
      ...(omitted === 'intent' ? [] : ['--intent', 'review']),
      ...(omitted === 'idempotency-key' ? [] : ['--idempotency-key', 'required-key']),
      '--',
      'prompt',
    ];
    const code = await run(args, { env: env(), out: () => undefined, err: () => undefined });
    assert.equal(code, 2, omitted);
    assert.equal(readFileSync(f.path, 'utf8'), before, omitted);
  }
});

test('real CLI starts all four harnesses, closes agent-only lifecycle, and preserves raw worker run', async () => {
  for (const harness of ['codex', 'claude-code', 'cursor-agent', 'kimi-code']) {
    const f = board(`four-${harness}`);
    const invoked = await invoke({ boardPath: f.path, harness, key: `key-${harness}` });
    assert.equal(invoked.code, 0, `${harness}: ${invoked.stderr}`);
    assert.equal(invoked.envelope.ok, true, harness);
    assert.equal(invoked.envelope.data.trackingState, 'closed', harness);
    const current = f.read();
    assert.deepEqual(current.tasks[0], f.task, harness);
    assert.equal(current.agents[0].dispatch.phase, 'closed', harness);
    assert.equal(current.agents[0].dispatch.evidence[0].kind, 'pid', harness);
    assert.ok(Number(current.agents[0].dispatch.evidence[0].value) > 0, harness);
    if (harness === 'cursor-agent') {
      assert.equal(current.agents[0].dispatch.capabilities.identity.status, 'unsupported', harness);
    } else {
      assert.equal(current.agents[0].dispatch.capabilities.identity.status, 'supported', harness);
    }
    const persisted = readFileSync(f.path, 'utf8');
    assert.equal(persisted.includes('PROMPT-SHOULD-NOT-PERSIST'), false, harness);
    assert.equal(persisted.includes('provider-result-not-for-board'), false, harness);
  }
});

test('missing typed worker capability fails before board mutation or provider spawn', async () => {
  const f = board('missing-capability');
  const before = readFileSync(f.path, 'utf8');
  writeFileSync(counter, '');
  const workerExecutionDirectory: WorkerExecutionDirectory = {
    candidatesFor: () => [],
    forHarness: () => undefined,
  };
  const invoked = await invoke({ boardPath: f.path, workerExecutionDirectory });
  assert.equal(invoked.code, 1);
  assert.match(invoked.stderr, /worker execution capability is unavailable/u);
  assert.equal(readFileSync(f.path, 'utf8'), before);
  assert.equal(readFileSync(counter, 'utf8'), '');
});

test('CLI exact replay uses explicit business key; only non-sensitive structural digest drift conflicts', async () => {
  const f = board('replay');
  writeFileSync(counter, '');
  const first = await invoke({ boardPath: f.path, key: 'replay-key', providerArgv: ['same'] });
  const replay = await invoke({ boardPath: f.path, key: 'replay-key', providerArgv: ['same'] });
  assert.equal(first.code, 0);
  assert.equal(replay.code, 0);
  assert.equal(replay.envelope.data.replayed, true);
  assert.equal(readFileSync(counter, 'utf8').trim().split('\n').length, 1);
  const argvReplay = await invoke({
    boardPath: f.path,
    key: 'replay-key',
    providerArgv: ['changed'],
  });
  assert.equal(argvReplay.code, 0);
  assert.equal(argvReplay.envelope.data.replayed, true);
  const conflict = await invoke({
    boardPath: f.path,
    key: 'replay-key',
    providerArgv: ['same'],
    timeoutMs: 2001,
  });
  assert.equal(conflict.code, 3);
  assert.match(conflict.stderr, /different request digest/u);
  assert.equal(readFileSync(counter, 'utf8').trim().split('\n').length, 1);
});

test('persisted intent is redacted diagnostic text rather than credential values', async () => {
  const f = board('intent-redaction');
  const invoked = await invoke({
    boardPath: f.path,
    harness: 'claude-code',
    intent: 'review patch token=super-secret-intent',
  });
  assert.equal(invoked.code, 0);
  const persisted = readFileSync(f.path, 'utf8');
  assert.equal(persisted.includes('super-secret-intent'), false);
  assert.match(f.read().agents[0].intent, /\[REDACTED\]/u);
});

test('provider nonzero is terminal evidence and mirrors exit without changing task status', async () => {
  const f = board('nonzero');
  const invoked = await invoke({
    boardPath: f.path,
    harness: 'claude-code',
    providerArgv: ['--exit=23'],
  });
  assert.equal(invoked.code, 23);
  assert.equal(f.read().agents[0].dispatch.terminal.exit_code, 23);
  assert.deepEqual(f.read().tasks[0], f.task);
});

test('pre-spawn executable failure closes without PID; bind persistence failure reaps then reconciles', async () => {
  const f = board('startup-failure');
  const actual = createDefaultProviderRuntime(env());
  const unavailable: ProviderRuntime = {
    ...actual,
    process: { ...actual.process, resolveExecutable: () => null },
  };
  const startup = await invoke({ boardPath: f.path, providerRuntime: unavailable });
  assert.equal(startup.code, 1);
  assert.equal(f.read().agents[0].dispatch.phase, 'closed');
  assert.equal(f.read().agents[0].dispatch.runtime_pid, undefined);

  const g = board('bind-failure');
  let writes = 0;
  const bind = await invoke({
    boardPath: g.path,
    harness: 'claude-code',
    providerArgv: ['--hang'],
    writeFileAtomicSync(path, data) {
      writes += 1;
      if (writes === 3) throw new Error('injected bind persistence failure');
      writeFileSync(path, data);
    },
  });
  assert.equal(bind.code, 1);
  assert.equal(bind.envelope.data.worker.error.code, 'consumer_error');
  assert.equal(bind.envelope.data.worker.reaped, true);
  assert.equal(g.read().agents[0].dispatch.phase, 'reconciliation-required');
  assert.equal(g.read().agents[0].handle.kind, 'none');
});

test('terminal persistence retry succeeds; persistent terminal tracking failure dominates worker zero', async () => {
  const f = board('terminal-retry');
  let writes = 0;
  let closedWrites = 0;
  const recovered = await invoke({
    boardPath: f.path,
    harness: 'claude-code',
    writeFileAtomicSync(path, data) {
      writes += 1;
      const phase = JSON.parse(String(data)).agents[0]?.dispatch?.phase;
      if (phase === 'closed') {
        closedWrites += 1;
        if (closedWrites === 1) throw new Error('transient close write');
      }
      writeFileSync(path, data);
    },
  });
  assert.equal(recovered.code, 0);
  assert.ok(writes >= 6);
  assert.equal(closedWrites, 2);
  assert.equal(f.read().agents[0].dispatch.phase, 'closed');

  const g = board('terminal-persistent');
  let persistentWrites = 0;
  let terminalFailures = 0;
  const failed = await invoke({
    boardPath: g.path,
    harness: 'claude-code',
    writeFileAtomicSync(path, data) {
      persistentWrites += 1;
      const phase = JSON.parse(String(data)).agents[0]?.dispatch?.phase;
      if (phase === 'closed' || phase === 'reconciliation-required') {
        terminalFailures += 1;
        throw new Error('persistent terminal tracking failure');
      }
      writeFileSync(path, data);
    },
  });
  assert.equal(failed.envelope.data.worker.exit_code, 0);
  assert.equal(failed.code, 1);
  assert.ok(persistentWrites >= 10);
  assert.equal(terminalFailures, 6);
  assert.equal(failed.envelope.data.trackingState, 'tracking-persistence-failed');
  assert.equal(failed.envelope.data.dispatch.reconciliation_required, false);
  assert.equal(failed.envelope.data.dispatch.phase, 'closing');
  assert.equal(failed.envelope.data.trackingError.code, 'tracking_write_failure');
  assert.equal(g.read().agents[0].dispatch.phase, 'closing');
  assert.equal(g.read().agents[0].dispatch.reconciliation_required, false);
});

test('two independent OS processes racing one key spawn exactly once under the board lock', async () => {
  const f = board('os-race');
  writeFileSync(counter, '');
  const helper = join(root, 'dispatch-child.mjs');
  writeFileSync(
    helper,
    `import { run } from ${JSON.stringify(pathToFileURL(join(appRoot, 'src', 'router.ts')).href)};
const out = (text) => process.stdout.write(String(text));
const err = (text) => process.stderr.write(String(text));
process.exitCode = await run(process.argv.slice(2), { out, err, env: process.env, stdin: { fd: 0 } });
`,
  );
  const args = [
    'worker',
    'dispatch',
    '--board',
    f.path,
    '--harness',
    'claude-code',
    '--task',
    'T-175',
    '--idempotency-key',
    'os-race-key',
    '--intent',
    'race safely',
    '--cwd',
    root,
    '--timeout-ms',
    '2000',
    '--max-output-bytes',
    '65536',
    '--',
    '--hold',
  ];
  const [one, two] = await Promise.all([runChild(helper, args), runChild(helper, args)]);
  assert.equal(one.code, 0, one.stderr);
  assert.equal(two.code, 0, two.stderr);
  assert.equal(readFileSync(counter, 'utf8').trim().split('\n').length, 1);
  const agent = f.read().agents[0];
  assert.equal(agent.dispatch.phase, 'closed');
  assert.equal(
    agent.dispatch.evidence.filter((entry: { kind: string }) => entry.kind === 'pid').length,
    1,
  );
});

test('a real post-claim pre-PID process crash becomes reconciliation-required and never respawns', async () => {
  const f = board('claim-crash');
  writeFileSync(counter, '');
  const helper = join(root, 'claim-crash-child.mjs');
  const engineUrl = pathToFileURL(
    join(appRoot, '..', '..', 'packages', 'engine', 'dist', 'index.mjs'),
  ).href;
  const repositoryUrl = pathToFileURL(join(appRoot, 'src', 'tracked-dispatch-repository.ts')).href;
  writeFileSync(
    helper,
    `import { realpathSync } from 'node:fs';
import { BoardIdentity, BoardWriteAuthority, canonicalSha256Digest, DispatchKey, TaskRef } from ${JSON.stringify(engineUrl)};
import { BoardAgentRegistryRepository } from ${JSON.stringify(repositoryUrl)};
const [boardPath, cwd] = process.argv.slice(2);
const canonical = realpathSync(boardPath);
const identity = BoardIdentity.fromCanonicalPath(canonical);
const authority = BoardWriteAuthority.create({ canonicalBoardPath: canonical, boardIdentity: identity, selectionSource: 'explicit-board' });
const key = DispatchKey.create('crash-key');
const digest = canonicalSha256Digest({ schema: 'ccm/tracked-worker-request-digest/v1', harness: 'claude-code', task_id: 'T-175', cwd, timeout_ms: 2000, max_output_bytes: 65536, stdin_mode: 'inherited-fd', provider_argv_count: 1, transcript_ref: null });
const repository = new BoardAgentRegistryRepository();
repository.prepareOrReplay({ authority, task: TaskRef.create(identity, 'T-175'), key, requestDigest: digest, harness: 'claude-code', intent: 'review patch', cwd, createdAt: '2026-07-22T08:00:00Z' });
repository.claimLaunch({ authority, key, requestDigest: digest, claimToken: 'dead-launcher', claimedAt: '2026-07-22T08:00:01Z', launcherPid: process.pid });
`,
  );
  const crashed = await runChild(helper, [f.path, root]);
  assert.equal(crashed.code, 0, crashed.stderr);
  assert.equal(f.read().agents[0].dispatch.phase, 'launch-claimed');
  const replay = await invoke({
    boardPath: f.path,
    harness: 'claude-code',
    key: 'crash-key',
    providerArgv: ['same'],
  });
  assert.equal(replay.code, 1);
  assert.equal(replay.envelope.data.trackingState, 'reconciliation-required');
  assert.equal(readFileSync(counter, 'utf8'), '');
  assert.equal(f.read().agents[0].dispatch.reconciliation_reason, 'ambiguous-launch');
});
