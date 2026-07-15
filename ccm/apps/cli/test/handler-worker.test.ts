import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, test } from 'node:test';
import {
  createDefaultProviderRuntime,
  type ProviderRuntime,
  type ProviderSpawnSpec,
} from '../src/provider-runtime.js';
import { run } from '../src/router.js';

const root = mkdtempSync(join(tmpdir(), 'ccm-session-bound-worker-test-'));
const workspace = resolve(join(root, 'workspace'));
const home = resolve(join(root, 'home'));
const fakeCursor = resolve(join(root, 'cursor-agent'));
mkdirSync(workspace, { recursive: true });
mkdirSync(home, { recursive: true });
writeFileSync(
  fakeCursor,
  `#!/usr/bin/env node
const argv = process.argv.slice(2);
const prompt = argv.at(-1);
const valueAfter = (flag) => argv[argv.indexOf(flag) + 1];
const emit = (value) => process.stdout.write(JSON.stringify(value) + '\\n');
const init = () => emit({
  type: 'system',
  subtype: 'init',
  model: valueAfter('--model'),
  cwd: valueAfter('--workspace'),
  session_id: 'fixture-session-1',
  permissionMode: valueAfter('--mode'),
  sandboxMode: valueAfter('--sandbox'),
});
const terminal = (result, isError = false) => emit({
  type: 'result',
  subtype: isError ? 'error' : 'success',
  is_error: isError,
  result,
  session_id: 'fixture-session-1',
});
if (prompt === 'fixture:nonzero') {
  process.stderr.write('api_key=topsecret user@example.com\\n');
  process.exit(42);
}
if (prompt === 'fixture:hang') setInterval(() => {}, 1_000);
else if (prompt === 'fixture:cancel') {
  init();
  setInterval(() => {}, 1_000);
} else if (prompt === 'fixture:large') {
  init();
  terminal('x'.repeat(4_096));
} else {
  init();
  terminal(prompt === 'fixture:secret'
    ? 'api_key=topsecret user@example.com'
    : JSON.stringify({
        staging_cwd: process.cwd(),
        argv,
        has_forbidden_env: Boolean(
          process.env.CURSOR_API_KEY ||
          process.env.OPENAI_API_KEY ||
          process.env.ANTHROPIC_API_KEY
        ),
      }));
}
`,
  'utf8',
);
chmodSync(fakeCursor, 0o755);

after(() => rmSync(root, { recursive: true, force: true }));

interface WorkerResult {
  schema: string;
  contract: string;
  state: string;
  target: { harness: string; model: string; effort: string };
  lifecycle: {
    session_bound: boolean;
    survives_parent_exit: boolean;
    survives_handoff: boolean;
    survives_ccm_update: boolean;
  };
  handle: { kind: string; group_id: number; id: string } | null;
  terminal: { result: string; is_error: boolean; session_id: string } | null;
  transport: {
    exit_code: number | null;
    reaped: boolean;
    stdout_bytes: number;
    stderr_bytes: number;
  } | null;
  cleanup: { staging_removed: boolean };
  error: { code: string; message: string } | null;
}

function recordingRuntime(
  env: Record<string, string | undefined>,
  spawns: ProviderSpawnSpec[],
): ProviderRuntime {
  const actual = createDefaultProviderRuntime(env);
  return {
    ...actual,
    process: {
      resolveExecutable: actual.process.resolveExecutable,
      spawnProvider(spec) {
        spawns.push(structuredClone(spec));
        return actual.process.spawnProvider(spec);
      },
    },
  };
}

async function invoke(
  prompt: string,
  options: {
    timeoutMs?: number;
    maxOutputBytes?: number;
    signal?: AbortSignal;
  } = {},
): Promise<{
  code: number;
  result: WorkerResult;
  spawns: ProviderSpawnSpec[];
  stderr: string;
}> {
  const env = {
    PATH: process.env.PATH || '/usr/bin:/bin',
    HOME: home,
    CCM_CURSOR_AGENT_BIN: fakeCursor,
    CURSOR_API_KEY: 'must-not-be-forwarded',
    OPENAI_API_KEY: 'must-not-be-forwarded',
    ANTHROPIC_API_KEY: 'must-not-be-forwarded',
  };
  const spawns: ProviderSpawnSpec[] = [];
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = await run(
    [
      'worker',
      'run',
      '--harness',
      'cursor-agent',
      '--model',
      'composer-2.5',
      '--effort',
      'standard',
      '--workspace',
      workspace,
      '--prompt',
      prompt,
      '--timeout-ms',
      String(options.timeoutMs ?? 2_000),
      '--max-output-bytes',
      String(options.maxOutputBytes ?? 65_536),
      '--json',
    ],
    {
      env,
      out: (value) => stdout.push(value),
      err: (value) => stderr.push(value),
      providerRuntime: recordingRuntime(env, spawns),
      workerSignal: options.signal,
    },
  );
  const envelope = JSON.parse(stdout.join('')) as { ok: true; data: WorkerResult };
  assert.equal(envelope.ok, true);
  return { code, result: envelope.data, spawns, stderr: stderr.join('') };
}

test('worker run launches one explicit first-party Cursor Agent in read-only session-bound mode', async () => {
  const { code, result, spawns, stderr } = await invoke('fixture:success');

  assert.equal(code, 0);
  assert.equal(stderr, '');
  assert.equal(result.schema, 'ccm/session-bound-worker-result/v1');
  assert.equal(result.contract, 'ccm/session-bound-read-only-worker/v1');
  assert.equal(result.state, 'succeeded');
  assert.deepEqual(result.target, {
    harness: 'cursor-agent',
    model: 'composer-2.5',
    effort: 'standard',
  });
  assert.deepEqual(result.lifecycle, {
    session_bound: true,
    survives_parent_exit: false,
    survives_handoff: false,
    survives_ccm_update: false,
  });
  assert.equal(spawns.length, 1);
  const spawn = spawns[0];
  assert.ok(spawn);
  assert.deepEqual(spawn.argv, [
    '--workspace',
    workspace,
    '--print',
    '--output-format',
    'stream-json',
    '--stream-partial-output',
    '--trust',
    '--sandbox',
    'enabled',
    '--mode',
    'ask',
    '--model',
    'composer-2.5',
    'fixture:success',
  ]);
  assert.equal(spawn.env.CURSOR_API_KEY, undefined);
  assert.equal(spawn.env.OPENAI_API_KEY, undefined);
  assert.equal(spawn.env.ANTHROPIC_API_KEY, undefined);
  assert.equal(result.handle?.kind, 'posix-process-group');
  assert.match(result.handle?.id || '', /^pgid:\d+$/u);
  assert.equal(result.transport?.reaped, true);
  assert.equal(result.cleanup.staging_removed, true);
  assert.ok(result.terminal);
  const terminal = JSON.parse(result.terminal.result) as {
    staging_cwd: string;
    argv: string[];
    has_forbidden_env: boolean;
  };
  assert.equal(terminal.has_forbidden_env, false);
  assert.equal(existsSync(terminal.staging_cwd), false);
});

test('worker run returns a redacted structured failure for a nonzero provider exit', async () => {
  const { code, result, stderr } = await invoke('fixture:nonzero');
  assert.equal(code, 1);
  assert.equal(stderr, '');
  assert.equal(result.state, 'failed');
  assert.equal(result.transport?.exit_code, 42);
  assert.equal(result.transport?.reaped, true);
  assert.doesNotMatch(JSON.stringify(result), /topsecret|user@example\.com/u);
  assert.match(result.error?.message || '', /\[REDACTED\]/u);
  assert.equal(result.cleanup.staging_removed, true);
});

test('worker run bounds timeout, cancellation, and provider output while reaping the process group', async () => {
  const timedOut = await invoke('fixture:hang', { timeoutMs: 100 });
  assert.equal(timedOut.code, 1);
  assert.equal(timedOut.result.state, 'timed_out');
  assert.equal(timedOut.result.transport?.reaped, true);
  assert.equal(timedOut.result.cleanup.staging_removed, true);

  const abort = new AbortController();
  const cancellation = invoke('fixture:cancel', { timeoutMs: 2_000, signal: abort.signal });
  setTimeout(() => abort.abort(), 100);
  const cancelled = await cancellation;
  assert.equal(cancelled.code, 1);
  assert.equal(cancelled.result.state, 'cancelled');
  assert.equal(cancelled.result.transport?.reaped, true);
  assert.equal(cancelled.result.cleanup.staging_removed, true);

  const bounded = await invoke('fixture:large', { maxOutputBytes: 512 });
  assert.equal(bounded.code, 1);
  assert.equal(bounded.result.state, 'failed');
  assert.equal(bounded.result.error?.code, 'output_limit');
  assert.equal(bounded.result.transport?.reaped, true);
  assert.equal(bounded.result.cleanup.staging_removed, true);
});

test('worker run redacts secrets from a successful provider result', async () => {
  const { code, result } = await invoke('fixture:secret');
  assert.equal(code, 0);
  assert.equal(result.state, 'succeeded');
  assert.doesNotMatch(JSON.stringify(result), /topsecret|user@example\.com/u);
  assert.match(result.terminal?.result || '', /\[REDACTED\]/u);
});
