import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { normalizeCodexRateLimits, readCodexUsageSignal } from '../src/codex-rate-limits.js';

interface FakeCodexFixture {
  root: string;
  binary: string;
  pidFile: string;
}

interface RecordedProcess {
  role: string;
  pid: number;
}

type FakeCodexMode =
  | 'success'
  | 'success-resist'
  | 'success-tree-resist'
  | 'rpc-error-resist'
  | 'exit-early'
  | 'silent-resist';

function createFakeCodex(): FakeCodexFixture {
  const root = mkdtempSync(join(tmpdir(), 'ccm-codex-rate-limits-'));
  const binary = join(root, 'fake-codex.mjs');
  const pidFile = join(root, 'pids');
  writeFileSync(
    binary,
    `#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const mode = process.env.CCM_TEST_CODEX_MODE || 'success';
const pidFile = process.env.CCM_TEST_CODEX_PID_FILE;
appendFileSync(pidFile, 'launcher:' + process.pid + '\\n');

if (mode.includes('tree')) {
  const descendant = spawn(
    process.execPath,
    [
      '-e',
      "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);",
    ],
    { env: process.env, stdio: 'ignore' },
  );
  appendFileSync(pidFile, 'descendant:' + descendant.pid + '\\n');
}

if (mode.includes('resist')) process.on('SIGTERM', () => {});

const lines = createInterface({ input: process.stdin });
lines.on('line', (line) => {
  let request;
  try {
    request = JSON.parse(line);
  } catch {
    return;
  }
  if (request.id === 0) {
    process.stdout.write(JSON.stringify({ id: 0, result: {} }) + '\\n');
    return;
  }
  if (request.id === 6 && mode !== 'silent-resist') {
    if (mode === 'exit-early') process.exit(7);
    if (mode === 'rpc-error-resist') {
      process.stdout.write(
        JSON.stringify({ id: 6, error: { code: -32000, message: 'fixture failure' } }) + '\\n',
      );
      return;
    }
    process.stdout.write(
      JSON.stringify({
        id: 6,
        result: {
          rateLimits: {
            primary: {
              usedPercent: 12,
              windowDurationMins: 300,
              resetsAt: 1925078400,
            },
          },
        },
      }) + '\\n',
    );
  }
});
`,
    { mode: 0o755 },
  );
  chmodSync(binary, 0o755);
  return { root, binary, pidFile };
}

function recordedProcesses(fixture: FakeCodexFixture): RecordedProcess[] {
  const contents = readFileSync(fixture.pidFile, 'utf8');
  return contents
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [role, rawPid] = line.split(':');
      const pid = Number(rawPid);
      assert.ok(role);
      assert.ok(Number.isSafeInteger(pid) && pid > 0, `invalid fixture pid line: ${line}`);
      return { role, pid };
    });
}

function processState(pid: number): string | null {
  if (process.platform === 'linux') {
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
      const commandEnd = stat.lastIndexOf(') ');
      return commandEnd === -1 ? 'unknown' : stat.slice(commandEnd + 2, commandEnd + 3);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }
  try {
    process.kill(pid, 0);
    return 'alive';
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return null;
    throw error;
  }
}

function assertProcessesGone(fixture: FakeCodexFixture): void {
  const processes = recordedProcesses(fixture);
  assert.ok(
    processes.some((entry) => entry.role === 'launcher'),
    'fixture recorded launcher pid',
  );
  for (const entry of processes) {
    const state = processState(entry.pid);
    assert.equal(
      state,
      null,
      `${entry.role} pid ${entry.pid} still exists after quota read (state=${state}; Z means zombie)`,
    );
  }
}

function killFixtureProcesses(fixture: FakeCodexFixture): void {
  let processes: RecordedProcess[] = [];
  try {
    processes = recordedProcesses(fixture);
  } catch {
    return;
  }
  for (const entry of processes.reverse()) {
    try {
      process.kill(entry.pid, 'SIGKILL');
    } catch {
      /* already gone */
    }
  }
}

function readFromFixture(fixture: FakeCodexFixture, mode: FakeCodexMode, timeoutMs = 1_000) {
  return readCodexUsageSignal({
    CCM_CODEX_BIN: fixture.binary,
    CCM_CODEX_APP_SERVER_TIMEOUT_MS: String(timeoutMs),
    CCM_TEST_CODEX_MODE: mode,
    CCM_TEST_CODEX_PID_FILE: fixture.pidFile,
  });
}

test('normalizeCodexRateLimits preserves rateLimitsByLimitId as independent model pools', () => {
  const out = normalizeCodexRateLimits({
    rateLimits: {
      limitId: 'codex',
      limitName: 'Codex default',
      primary: null,
      secondary: { usedPercent: 38, windowDurationMins: 10_080, resetsAt: 1_925_078_400 },
    },
    rateLimitsByLimitId: {
      codex: {
        limitId: 'codex',
        limitName: 'Codex default',
        primary: null,
        secondary: { usedPercent: 38, windowDurationMins: 10_080, resetsAt: 1_925_078_400 },
      },
      codex_bengalfox: {
        limitId: 'codex_bengalfox',
        limitName: 'GPT-5.3-Codex-Spark',
        primary: null,
        secondary: { usedPercent: 0, windowDurationMins: 10_080, resetsAt: 1_925_078_400 },
      },
    },
  });
  assert.ok(out);
  assert.equal(out.signal.five_hour?.used_percentage, null, 'missing 5h stays honestly empty');
  assert.equal(
    out.signal.seven_day?.used_percentage,
    38,
    'legacy top-level window remains compatible',
  );
  assert.deepEqual(out.signal.pools, [
    {
      id: 'codex',
      label: 'Codex default',
      kind: 'first_party',
      used_percentage: 38,
      resets_at: 1_925_078_400,
    },
    {
      id: 'codex_bengalfox',
      label: 'GPT-5.3-Codex-Spark',
      kind: 'first_party',
      used_percentage: 0,
      resets_at: 1_925_078_400,
    },
  ]);
  assert.equal(Object.hasOwn(out.signal, 'rolling_24h'), false, 'do not fabricate a 24h window');
});

test('normalizeCodexRateLimits can use a named pool as the compatible window when legacy is absent', () => {
  const out = normalizeCodexRateLimits({
    rateLimitsByLimitId: {
      codex: {
        limitName: 'Codex default',
        secondary: { usedPercent: 41, windowDurationMins: 10_080, resetsAt: 1_925_078_400 },
      },
    },
  });
  assert.ok(out);
  assert.equal(out.signal.seven_day?.used_percentage, 41);
  assert.equal(out.signal.pools?.[0]?.id, 'codex');
});

test('readCodexUsageSignal publishes a successful result only after its launcher is reaped', () => {
  const fixture = createFakeCodex();
  try {
    const out = readFromFixture(fixture, 'success-resist');
    assert.ok(out);
    assert.equal(out.signal.five_hour?.used_percentage, 12);
    assertProcessesGone(fixture);
  } finally {
    killFixtureProcesses(fixture);
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('readCodexUsageSignal reaps the complete POSIX app-server process group', {
  skip: process.platform === 'win32' ? 'POSIX process groups are unavailable on Windows' : false,
}, () => {
  const fixture = createFakeCodex();
  try {
    const out = readFromFixture(fixture, 'success-tree-resist');
    assert.ok(out);
    assert.equal(recordedProcesses(fixture).length, 2);
    assertProcessesGone(fixture);
  } finally {
    killFixtureProcesses(fixture);
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('readCodexUsageSignal timeout returns null only after its launcher is reaped', () => {
  const fixture = createFakeCodex();
  try {
    const startedAt = Date.now();
    assert.equal(readFromFixture(fixture, 'silent-resist', 250), null);
    assert.ok(Date.now() - startedAt < 3_000, 'timeout cleanup stays bounded');
    assertProcessesGone(fixture);
  } finally {
    killFixtureProcesses(fixture);
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('readCodexUsageSignal reaps its launcher after RPC errors and early exits', () => {
  for (const mode of ['rpc-error-resist', 'exit-early'] as const) {
    const fixture = createFakeCodex();
    try {
      assert.equal(readFromFixture(fixture, mode), null);
      assertProcessesGone(fixture);
    } finally {
      killFixtureProcesses(fixture);
      rmSync(fixture.root, { recursive: true, force: true });
    }
  }
});

test('readCodexUsageSignal handles a spawn failure without waiting for the business timeout', () => {
  const root = mkdtempSync(join(tmpdir(), 'ccm-codex-rate-limits-missing-'));
  try {
    const startedAt = Date.now();
    assert.equal(
      readCodexUsageSignal({
        CCM_CODEX_BIN: join(root, 'missing-codex'),
        CCM_CODEX_APP_SERVER_TIMEOUT_MS: '4_000',
      }),
      null,
    );
    assert.ok(Date.now() - startedAt < 3_000, 'spawn failure returns before the business timeout');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('repeated Codex quota reads do not leave recorded launcher zombies', () => {
  for (let iteration = 0; iteration < 4; iteration += 1) {
    const fixture = createFakeCodex();
    try {
      assert.ok(readFromFixture(fixture, 'success'));
      assertProcessesGone(fixture);
    } finally {
      killFixtureProcesses(fixture);
      rmSync(fixture.root, { recursive: true, force: true });
    }
  }
});
