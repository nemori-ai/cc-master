import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { createDefaultProviderRuntime } from '../src/provider-runtime.js';
import { workerDescriptor } from '../src/worker-descriptors.js';
import { runWorkerProcess } from '../src/worker-process.js';

const root = mkdtempSync(join(tmpdir(), 'ccm-worker-observer-'));
const fake = join(root, 'codex');
writeFileSync(
  fake,
  `#!/usr/bin/env node
if (process.argv.includes('--hang')) {
  process.stdout.write('{"type":"thread.started","thread_id":"thr_observed"}\\n');
  setInterval(() => {}, 1000);
} else {
  process.stdout.write('out-one\\nout-two\\n');
  process.stderr.write('err-one\\n');
}
`,
);
chmodSync(fake, 0o755);
after(() => rmSync(root, { recursive: true, force: true }));

function request(providerArgv: string[]) {
  const env = { ...process.env, CCM_CODEX_BIN: fake };
  const descriptor = workerDescriptor('codex');
  assert.ok(descriptor);
  return {
    descriptor,
    providerArgv,
    cwd: root,
    timeoutMs: 2_000,
    maxOutputBytes: 65_536,
    stdinFd: 'ignore' as const,
    env,
    runtime: createDefaultProviderRuntime(env),
  };
}

test('worker execution observer receives the exact positive spawned PID and decoded stream fragments', async () => {
  let pid = 0;
  const stdout: string[] = [];
  const stderr: string[] = [];
  const result = await runWorkerProcess(request([]), {
    onStarted(started) {
      pid = started.pid;
    },
    onStdoutText: (text) => stdout.push(text),
    onStderrText: (text) => stderr.push(text),
  });
  assert.equal(result.state, 'exited');
  assert.equal(result.exit_code, 0);
  assert.ok(Number.isSafeInteger(pid) && pid > 0);
  assert.equal(stdout.join(''), result.stdout);
  assert.equal(stderr.join(''), result.stderr);
});

test('started-observer bind failure dominates and synchronously cancels/reaps the owned process tree', async () => {
  let observedPid = 0;
  const result = await runWorkerProcess(request(['--hang']), {
    onStarted(started) {
      observedPid = started.pid;
      throw new Error('injected atomic bind failure');
    },
  });
  assert.ok(observedPid > 0);
  assert.equal(result.state, 'failed');
  assert.equal(result.error?.code, 'consumer_error');
  assert.equal(result.reaped, true);
  assert.notEqual(result.exit_code, 0);
});
