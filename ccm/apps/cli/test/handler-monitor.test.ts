import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import * as monitor from '../src/handlers/monitor.js';
import { readVersion } from '../src/help.js';
import * as io from '../src/io.js';
import { run } from '../src/router.js';

const EXIT = io.EXIT;

let TMPDIRS: string[] = [];

afterEach(() => {
  monitor.__resetMonitorTestHooks();
  for (const d of TMPDIRS) rmSync(d, { recursive: true, force: true });
  TMPDIRS = [];
});

function mkHome(): string {
  const root = mkdtempSync(join(tmpdir(), 'ccm-monitor-'));
  TMPDIRS.push(root);
  const home = join(root, '.cc_master');
  mkdirSync(join(home, 'boards'), { recursive: true });
  return home;
}

function invoke(args: string[], home: string): { code: number; stdout: string; stderr: string } {
  const out: string[] = [];
  const err: string[] = [];
  const code = run(args, {
    env: { HOME: join(home, '..'), CC_MASTER_HOME: home },
    out: (s: string) => out.push(s),
    err: (s: string) => err.push(s),
  });
  assert.equal(typeof code, 'number', 'monitor lifecycle commands are sync except serve');
  return { code: code as number, stdout: out.join('\n'), stderr: err.join('\n') };
}

function json(stdout: string): any {
  return JSON.parse(stdout);
}

test('monitor start/status exposes binary_match and reuses healthy current-binary service', () => {
  const home = mkHome();
  let spawnCount = 0;
  monitor.__setMonitorTestHooks({
    now: () => new Date('2026-07-09T10:00:00Z'),
    spawnService: ({ statePath }) => {
      spawnCount += 1;
      const state = JSON.parse(readFileSync(statePath, 'utf8'));
      writeFileSync(statePath, `${JSON.stringify({ ...state, pid: 1234 }, null, 2)}\n`, 'utf8');
      return { pid: 1234 };
    },
    isPidAlive: (pid) => pid === 1234,
  });

  const first = invoke(['monitor', 'start', '--json'], home);
  assert.equal(first.code, EXIT.OK, first.stderr);
  assert.equal(json(first.stdout).reused, false);
  assert.equal(json(first.stdout).service.wanted, true);
  assert.equal(json(first.stdout).service.binary_match, true);
  assert.equal(spawnCount, 1);

  const second = invoke(['monitor', 'start', '--json'], home);
  assert.equal(second.code, EXIT.OK, second.stderr);
  assert.equal(json(second.stdout).reused, true);
  assert.equal(spawnCount, 1);

  const status = invoke(['monitor', 'status', '--json'], home);
  assert.equal(status.code, EXIT.OK);
  assert.equal(json(status.stdout).binary_match, true);
  assert.equal(json(status.stdout).running_ccm_version, readVersion());
});

test('monitor start forces restart when running service has stale ccm binary', () => {
  const home = mkHome();
  let pid = 2001;
  let spawnCount = 0;
  monitor.__setMonitorTestHooks({
    now: () => new Date('2026-07-09T10:00:00Z'),
    spawnService: ({ statePath }) => {
      spawnCount += 1;
      const state = JSON.parse(readFileSync(statePath, 'utf8'));
      writeFileSync(statePath, `${JSON.stringify({ ...state, pid }, null, 2)}\n`, 'utf8');
      return { pid };
    },
    isPidAlive: (candidate) => candidate === pid || candidate === 2001,
    kill: () => true,
  });

  const first = invoke(['monitor', 'start', '--json'], home);
  const statePath = json(first.stdout).service.state_path;
  const stale = JSON.parse(readFileSync(statePath, 'utf8'));
  writeFileSync(
    statePath,
    `${JSON.stringify({ ...stale, server: { ...stale.server, ccm_version: '0.0.1' } }, null, 2)}\n`,
    'utf8',
  );

  const status = invoke(['monitor', 'status', '--json'], home);
  assert.equal(json(status.stdout).binary_match, false);

  pid = 2002;
  const restarted = invoke(['monitor', 'start', '--json'], home);
  assert.equal(restarted.code, EXIT.OK, restarted.stderr);
  assert.equal(json(restarted.stdout).reused, false);
  assert.equal(json(restarted.stdout).service.pid, 2002);
  assert.equal(json(restarted.stdout).service.binary_match, true);
  assert.equal(spawnCount, 2);
});

test('monitor serve runs bounded ticks and records tick state without touching real home', async () => {
  const home = mkHome();
  const statePath = join(home, 'services', 'monitor', 'state.json');
  mkdirSync(join(home, 'services', 'monitor'), { recursive: true });
  writeFileSync(
    statePath,
    `${JSON.stringify(
      {
        schema: 'ccm/monitor-service/v1',
        id: 'monitor',
        pid: 0,
        wanted: true,
        home,
        state_path: statePath,
        pid_path: join(home, 'services', 'monitor', 'pid'),
        log_path: join(home, 'services', 'monitor', 'log'),
        interval_sec: 5,
        server: { started_at: '2026-07-09T10:00:00Z', ccm_version: readVersion() },
        last_tick_at: null,
        last_error: null,
        tick_count: 0,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  monitor.__setMonitorTestHooks({
    now: () => new Date('2026-07-09T10:00:01Z'),
    tick: () => ({
      registry: {
        schema: 'ccm/machine-harness-registry/v1',
        installed: [],
        installedSurfaces: [],
        harnesses: [],
        pools: [],
      },
      checked_boards: 0,
      writes: 0,
      errors: [],
    }),
  });

  const out: string[] = [];
  const code = await monitor.serve({
    values: { state: statePath, iterations: '1' },
    positionals: [],
    flags: {
      json: false,
      dryRun: false,
      force: false,
      yes: false,
      quiet: false,
      verbose: false,
      color: false,
    },
    sid: '',
    env: { CC_MASTER_HOME: home },
    out: (s) => out.push(s),
    err: () => {},
  });
  assert.equal(code, EXIT.OK);
  assert.equal(out.length, 1);
  const state = JSON.parse(readFileSync(statePath, 'utf8'));
  assert.equal(state.pid, process.pid);
  assert.equal(state.tick_count, 1);
  assert.equal(state.last_error, null);
});
